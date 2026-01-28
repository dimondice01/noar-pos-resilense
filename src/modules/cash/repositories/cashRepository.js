import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore'; 

// Helper para IDs únicos consistentes
const generateId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

export const cashRepository = {
    
    // =========================================
    // 🛠️ HELPER DE CONTEXTO (CLAVE DEL FIX)
    // =========================================
    // Normaliza qué sucursal se está usando para evitar inconsistencias
    _getContext() {
        const { user, activeBranchId } = useAuthStore.getState();
        if (!user) throw new Error("No hay usuario autenticado");

        // Prioridad: 
        // 1. Selector Manual (Admin cambiando de sucursal)
        // 2. Sucursal asignada al usuario (Cajero fijo)
        // 3. 'main' (Fallback)
        let targetBranch = activeBranchId;
        
        if (!targetBranch) {
            targetBranch = user.branchId || 'main';
        }
        
        return { user, branchId: targetBranch };
    },

    // =========================================
    // 🟢 GESTIÓN DE TURNO (APERTURA)
    // =========================================
    async openShift(initialAmount, userName) {
        const { user, branchId } = this._getContext();
        const dbLocal = await getDB();
        
        // 1. Verificar si ya tiene turno abierto (EN ESTA SUCURSAL)
        const active = await dbLocal.shifts
            .where('status').equals('OPEN')
            .filter(s => s.userId === user.uid && s.branchId === branchId)
            .first();

        // Si ya existe, lo devolvemos (Idempotencia) en vez de error, 
        // o lanzamos error si queremos ser estrictos.
        if (active) return active; 

        // 2. Crear Objeto Turno
        const shift = {
            id: generateId('shift'),
            userId: user.uid,
            userEmail: user.email,
            userName: userName || user.name || 'Cajero',
            companyId: user.companyId,
            branchId: branchId, // 🔥 USAMOS EL ID NORMALIZADO
            status: 'OPEN',
            openedAt: new Date().toISOString(),
            initialAmount: parseFloat(initialAmount),
            expectedCash: 0,     
            finalCash: 0,       
            leftInCash: 0, 
            withdrawn: 0,  
            difference: 0,       
            audited: false,
            syncStatus: 'pending' 
        };

        // 3. Transacción Atómica
        await dbLocal.transaction('rw', [dbLocal.shifts, dbLocal.cash_movements], async () => {
            await dbLocal.shifts.put(shift);
            
            await this._addMovementLocal(dbLocal, {
                shiftId: shift.id,
                type: 'DEPOSIT', 
                method: 'cash',
                amount: parseFloat(initialAmount),
                description: 'Fondo Inicial de Caja',
                branchId: branchId
            }, user);
        });

        this._syncToCloud('shifts', shift);
        return shift;
    },

    // =========================================
    // 🔴 GESTIÓN DE TURNO (CIERRE)
    // =========================================
    async closeShift(shiftId, closingData) {
        const dbLocal = await getDB();
        const shift = await dbLocal.shifts.get(shiftId);
        if (!shift) throw new Error("Turno no encontrado");

        const { user } = useAuthStore.getState();
        // Permitimos cerrar si es el dueño del turno O si es Admin
        if (shift.userId !== user?.uid && user?.role !== 'ADMIN' && user?.role !== 'OWNER') {
             throw new Error("No puedes cerrar la caja de otro usuario.");
        }

        const declared = parseFloat(closingData.declaredCash); 
        const expected = parseFloat(closingData.expectedCash); 
        const left = parseFloat(closingData.leftInCash || 0); 
        
        // Cálculo de retiro: Lo que tengo - Lo que dejo
        // Usamos Math.max para evitar negativos si el cajero se equivocó
        const withdrawn = Math.max(0, declared - left); 
        const difference = declared - expected;

        const closedShift = {
            ...shift,
            status: 'CLOSED',
            closedAt: new Date().toISOString(),
            finalCash: declared,      
            leftInCash: left,         
            withdrawn: withdrawn,     
            expectedCash: expected,
            expectedDigital: parseFloat(closingData.expectedDigital || 0),
            difference: difference,
            audited: false,
            syncStatus: 'pending'
        };

        await dbLocal.transaction('rw', [dbLocal.shifts, dbLocal.cash_movements], async () => {
            await dbLocal.shifts.put(closedShift);

            // Solo registramos retiro si efectivamente se retiró dinero
            if (withdrawn > 0) {
                await this._addMovementLocal(dbLocal, {
                    shiftId: shift.id,
                    type: 'WITHDRAWAL',
                    method: 'cash',
                    amount: withdrawn,
                    description: `Rendición de Cierre (Dejado: $${left})`,
                    branchId: shift.branchId
                }, user);
            }
        });

        this._syncToCloud('shifts', closedShift);
        return closedShift;
    },
    
    // =========================================
    // 🔥 GET CURRENT SHIFT (EL CORAZÓN DEL PROBLEMA)
    // =========================================
    async getCurrentShift() {
        const dbLocal = await getDB();
        
        try {
            const { user, branchId } = this._getContext();

            // 1. Búsqueda Exacta (Ideal)
            const exactShift = await dbLocal.shifts
                .where('status').equals('OPEN')
                .filter(s => s.userId === user.uid && s.branchId === branchId)
                .first();

            if (exactShift) return exactShift;

            // 2. Fallback de Emergencia (Auto-Healing)
            // Si el usuario tiene un turno abierto pero con OTRO branchId (por error de migración o config),
            // lo recuperamos igual para no bloquear la venta, pero hacemos console.warn
            const looseShift = await dbLocal.shifts
                .where('status').equals('OPEN')
                .filter(s => s.userId === user.uid)
                .first();

            if (looseShift) {
                console.warn(`⚠️ Recuperado turno de sucursal cruzada: ${looseShift.branchId} (Actual: ${branchId})`);
                return looseShift; 
            }

            return null;

        } catch (e) {
            console.error("Error buscando turno:", e);
            return null;
        }
    },

    async updateShift(shiftData) {
        const dbLocal = await getDB();
        const updated = { ...shiftData, syncStatus: 'pending' };
        await dbLocal.shifts.put(updated);
        this._syncToCloud('shifts', updated);
        return updated;
    },

    // =========================================
    // 📊 HISTORIAL
    // =========================================
    async getAllShifts() {
        const { user, branchId } = this._getContext();
        const dbLocal = await getDB();

        if (user.role === 'ADMIN' || user.role === 'OWNER') {
            return await dbLocal.shifts
                .filter(s => s.branchId === branchId)
                .reverse()
                .toArray();
        } else {
            return await dbLocal.shifts
                .where('userId').equals(user.uid)
                .filter(s => s.branchId === branchId)
                .reverse()
                .toArray();
        }
    },

    async getAllActiveShifts() {
        const dbLocal = await getDB();
        return await dbLocal.shifts
            .where('status').equals('OPEN')
            .toArray();
    },

    // =========================================
    // 💰 MOVIMIENTOS
    // =========================================
    
    async _addMovementLocal(dbLocal, movement, user) {
        const newMov = {
            id: generateId('mov'),
            ...movement,
            userId: user?.uid,
            companyId: user?.companyId,
            date: new Date().toISOString(),
            syncStatus: 'pending'
        };
        await dbLocal.cash_movements.put(newMov);
        this._syncToCloud('cash_movements', newMov);
        return newMov;
    },

    async addMovement(movement) {
        const { user } = useAuthStore.getState(); // Aquí no necesitamos branch forzado, usamos el del turno
        const dbLocal = await getDB();
        return this._addMovementLocal(dbLocal, movement, user);
    },

    async _syncToCloud(collectionName, data) {
        if (!navigator.onLine) return; 
        const { user } = useAuthStore.getState();
        if (!user || !user.companyId) return;

        try {
            const { syncStatus, ...cloudData } = data;
            const path = `companies/${user.companyId}/${collectionName}`;

            setDoc(doc(db, path, data.id), {
                ...cloudData,
                firestoreId: data.id,
                syncedAt: new Date().toISOString(),
                syncStatus: 'synced'
            }, { merge: true }).then(async () => {
                try {
                    const dbLocal = await getDB();
                    const table = collectionName === 'shifts' ? dbLocal.shifts : dbLocal.cash_movements;
                    await table.update(data.id, { syncStatus: 'synced' });
                } catch (e) { }
            });
        } catch (e) { console.warn(`Sync error ${collectionName}:`, e); }
    },

    async registerIncome(amount, method, description = 'Venta') {
        const shift = await this.getCurrentShift();
        if (!shift) throw new Error("⚠️ CAJA CERRADA: Abra turno para cobrar.");

        return this.addMovement({
            shiftId: shift.id,
            branchId: shift.branchId, 
            type: 'SALE', 
            method: method, 
            amount: parseFloat(amount),
            description: description
        });
    },

    async registerExpense(amount, description, reference = '', user = 'Cajero') {
        const shift = await this.getCurrentShift();
        if (!shift) throw new Error("Caja Cerrada: No se puede registrar gasto.");

        return this.addMovement({
            shiftId: shift.id,
            branchId: shift.branchId,
            type: 'EXPENSE',
            method: 'cash', 
            amount: parseFloat(amount),
            description: description,
            reference: reference,
            user: user
        });
    },
    
    async registerWithdrawal(amount, description, reference = '', user = 'Admin') {
        const shift = await this.getCurrentShift();
        if (!shift) throw new Error("Caja Cerrada: No se puede registrar retiro.");

        return this.addMovement({
            shiftId: shift.id,
            branchId: shift.branchId,
            type: 'WITHDRAWAL',
            method: 'cash', 
            amount: parseFloat(amount),
            description: description,
            reference: reference, 
            user: user
        });
    },

    // =========================================
    // ⚖️ BALANCE
    // =========================================
    async getShiftBalance(shiftId) {
        const dbLocal = await getDB();
        const { user } = useAuthStore.getState();

        return await dbLocal.transaction('r', [dbLocal.cash_movements, dbLocal.shifts], async () => {
            const shift = await dbLocal.shifts.get(shiftId);
            
            // Permiso laxo para admins o dueños
            const isOwner = shift.userId === user?.uid;
            const isAdmin = user?.role === 'ADMIN' || user?.role === 'OWNER';
            
            if (!isOwner && !isAdmin) {
                 // return { totalCash: 0, movements: [] }; // Opcional: Bloquear acceso
            }

            const allMovements = await dbLocal.cash_movements
                .where('shiftId').equals(shiftId)
                .toArray();
            
            allMovements.sort((a, b) => new Date(b.date) - new Date(a.date));

            let balance = {
                initialAmount: Number(shift?.initialAmount) || 0,
                salesCash: 0,
                salesDigital: 0,
                withdrawals: 0,
                expenses: 0,
                deposits: 0,
                totalCash: 0,      
                totalDigital: 0,
                movements: allMovements
            };

            balance.totalCash = balance.initialAmount;

            for (const m of allMovements) {
                const amount = Number(m.amount) || 0; 
                const method = (m.method || 'unknown').toLowerCase(); 
                const isDigitalKnown = method.includes('mercado') || method.includes('clover') || method.includes('card') || method === 'point' || method === 'qr';

                if (m.type === 'SALE' || m.type === 'IN') { 
                    if (method === 'cash' || method === 'efectivo' || !isDigitalKnown) { 
                        balance.salesCash += amount;
                        balance.totalCash += amount;
                    } else {
                        balance.salesDigital += amount;
                        balance.totalDigital += amount;
                    }
                } else if (m.type === 'DEPOSIT') {
                    if (m.description !== 'Fondo Inicial de Caja') { 
                        balance.totalCash += amount;
                        balance.deposits += amount;
                    }
                } else if (m.type === 'WITHDRAWAL') {
                    balance.totalCash -= amount;
                    balance.withdrawals += amount;
                } else if (m.type === 'EXPENSE') {
                    balance.totalCash -= amount;
                    balance.expenses += amount;
                }
            }
            
            const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;
            
            return {
                ...balance,
                totalCash: round2(balance.totalCash),
                salesCash: round2(balance.salesCash),
                salesDigital: round2(balance.salesDigital),
                expenses: round2(balance.expenses)
            };
        });
    },
    
    // =========================================
    // 📊 AUDITORÍA (FIXED: Encuentra las ventas)
    // =========================================
    async getShiftAuditData(shiftId) {
        const dbLocal = await getDB();
        
        return await dbLocal.transaction('r', [dbLocal.cash_movements, dbLocal.shifts, dbLocal.sales], async () => {
            const shift = await dbLocal.shifts.get(shiftId);
            if (!shift) throw new Error("Turno no encontrado");

            // Rango de Tiempo
            const openedAt = new Date(shift.openedAt).toISOString();
            const closedAt = shift.closedAt ? new Date(shift.closedAt).toISOString() : new Date().toISOString();

            // 🔥 ESTRATEGIA HÍBRIDA DE BÚSQUEDA DE VENTAS
            // Buscamos por fecha Y (usuario O branch)
            // Esto arregla el problema de que "no aparecen las ventas" si el shiftId se perdió
            const shiftSales = await dbLocal.sales
                .where('date').between(openedAt, closedAt, true, true)
                .filter(s => {
                    const isValidStatus = s.status !== 'CANCELLED';
                    const isSameUser = s.userId === shift.userId;
                    const isSameBranch = s.branchId === shift.branchId;
                    return isValidStatus && (isSameUser || isSameBranch);
                })
                .toArray();

            // Movimientos de Caja (Estos sí suelen tener el shiftId bien puesto)
            const allMovements = await dbLocal.cash_movements
                .where('shiftId').equals(shiftId)
                .toArray();

            let audit = {
                shiftId: shift.id,
                shiftName: shift.userName || shift.userId,
                status: shift.status,
                startTime: shift.openedAt,
                closeTime: shift.closedAt || new Date().toISOString(),
                initialAmount: Number(shift.initialAmount) || 0, 
                totalSales: 0,
                salesCount: shiftSales.length,
                salesByMethod: { cash: 0, mercadopago: 0, clover: 0, digitalOther: 0 },
                cashIn: 0,
                cashOut: 0,
                totalExpenses: 0,
                totalWithdrawals: 0,
                expectedCash: Number(shift.initialAmount) || 0,
                totalDigital: 0,
                // 🔥 Aseguramos que se devuelva el dato crítico
                leftInCash: Number(shift.leftInCash) || 0,
                declaredCash: Number(shift.finalCash) || 0,
                withdrawn: Number(shift.withdrawn) || 0
            };

            const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

            // Procesar Ventas
            for (const sale of shiftSales) {
                const total = parseFloat(sale.total) || 0;
                audit.totalSales += total;
                const methodRaw = sale.payment?.method || 'unknown';
                const method = methodRaw.toLowerCase();
                
                if (method === 'cash' || method === 'efectivo') {
                    audit.salesByMethod.cash += total;
                } else if (method.includes('mercado') || method === 'mp') {
                    audit.salesByMethod.mercadopago += total;
                } else if (method.includes('clover')) {
                    audit.salesByMethod.clover += total;
                } else {
                    audit.salesByMethod.digitalOther += total;
                }
            }
            
            audit.totalDigital = audit.salesByMethod.mercadopago + audit.salesByMethod.clover + audit.salesByMethod.digitalOther;

            // Procesar Movimientos para Calcular Caja Esperada
            for (const m of allMovements) {
                const amount = Number(m.amount) || 0;
                const method = (m.method || 'unknown').toLowerCase();
                const isCash = method === 'cash';

                // Solo sumamos al "Efectivo Esperado" si el movimiento fue en efectivo
                if (isCash) {
                    if (m.type === 'SALE' || m.type === 'IN') audit.expectedCash += amount;
                    if (m.type === 'DEPOSIT' && m.description !== 'Fondo Inicial') audit.expectedCash += amount; // Fondo ya sumado
                    if (m.type === 'WITHDRAWAL' || m.type === 'EXPENSE') audit.expectedCash -= amount;
                }
                
                if (m.type === 'DEPOSIT') audit.cashIn += amount;
                if (m.type === 'WITHDRAWAL' || m.type === 'EXPENSE') audit.cashOut += amount;
            }

            audit.expectedCash = round2(audit.expectedCash);
            audit.totalSales = round2(audit.totalSales);
            audit.totalDigital = round2(audit.totalDigital);
            
            // Si está abierta, Declarado = Esperado (provisional)
            if (shift.status === 'OPEN') {
                audit.declaredCash = audit.expectedCash;
            }
            
            audit.deviation = round2(audit.declaredCash - audit.expectedCash);
            
            return audit;
        });
    }
};