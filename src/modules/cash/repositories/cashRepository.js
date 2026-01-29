import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore'; 

// Helper para IDs únicos consistentes
const generateId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

export const cashRepository = {
    
    // =========================================
    // 🛠️ HELPER DE CONTEXTO
    // =========================================
    _getContext() {
        const { user, activeBranchId } = useAuthStore.getState();
        if (!user) throw new Error("No hay usuario autenticado");

        // Prioridad: Selector Manual > Asignación Usuario > Fallback
        let targetBranch = activeBranchId;
        
        if (!targetBranch) {
            targetBranch = user.branchId || 'main';
        }
        
        return { user, branchId: targetBranch };
    },

    // =========================================
    // ☁️ SYNC: RECUPERACIÓN DE HISTORIAL (FIX CRÍTICO)
    // =========================================
    // Esta función permite bajar datos antiguos si el PC es nuevo o se borró el caché
    async _fetchHistoryFromCloud(dbLocal, user) {
        if (!navigator.onLine) return;

        try {
            // console.log("☁️ Sincronizando historial desde Firebase...");
            const shiftsRef = collection(db, `companies/${user.companyId}/shifts`);
            let q;

            if (user.role === 'ADMIN' || user.role === 'OWNER') {
                // Admin: Traer últimos 50 turnos de TODA la empresa para llenar la tabla
                q = query(shiftsRef, orderBy('openedAt', 'desc'), limit(50));
            } else {
                // Cajero: Traer solo sus últimos 20 turnos
                q = query(shiftsRef, where('userId', '==', user.uid), orderBy('openedAt', 'desc'), limit(20));
            }

            const snapshot = await getDocs(q);
            const cloudShifts = snapshot.docs.map(d => ({ 
                ...d.data(), 
                id: d.id, 
                syncStatus: 'synced',
                // Si el dato viene viejo de la nube sin branch, le ponemos 'main' para que se vea
                branchId: d.data().branchId || 'main' 
            }));

            if (cloudShifts.length > 0) {
                await dbLocal.shifts.bulkPut(cloudShifts);
            }
        } catch (e) {
            console.error("⚠️ Error sync historial:", e);
        }
    },

    // =========================================
    // 🟢 GESTIÓN DE TURNO (APERTURA)
    // =========================================
    async openShift(initialAmount, userName) {
        const { user, branchId } = this._getContext();
        const dbLocal = await getDB();
        
        // Verificar si ya tiene turno abierto
        const active = await dbLocal.shifts
            .where('status').equals('OPEN')
            .filter(s => s.userId === user.uid)
            .first();

        if (active) return active; 

        const shift = {
            id: generateId('shift'),
            userId: user.uid,
            userEmail: user.email,
            userName: userName || user.name || 'Cajero',
            companyId: user.companyId,
            branchId: branchId, // 🔥 Se guarda con la sucursal actual
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
        
        // Permisos
        if (shift.userId !== user?.uid && user?.role !== 'ADMIN' && user?.role !== 'OWNER') {
             throw new Error("No puedes cerrar la caja de otro usuario.");
        }

        const declared = parseFloat(closingData.declaredCash); 
        const expected = parseFloat(closingData.expectedCash); 
        const left = parseFloat(closingData.leftInCash || 0); 
        
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
    // 🔥 GET CURRENT SHIFT (Auto-Healing)
    // =========================================
    async getCurrentShift() {
        const dbLocal = await getDB();
        const { user, branchId } = this._getContext();

        try {
            // Buscamos cualquier turno abierto del usuario, sin importar branchId primero
            // Esto es para detectar inconsistencias
            const openShift = await dbLocal.shifts
                .where('status').equals('OPEN')
                .filter(s => s.userId === user.uid)
                .first();

            if (openShift) {
                // Si el turno no tiene branchId (Legacy) o está null, lo reparamos
                if (!openShift.branchId) {
                    // console.warn("⚠️ Reparando turno activo sin sucursal...");
                    const fixed = { ...openShift, branchId: branchId };
                    await dbLocal.shifts.put(fixed); // Guardamos la corrección
                    return fixed;
                }
                return openShift;
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
    // 📊 HISTORIAL (FIX: Carga Híbrida)
    // =========================================
    async getAllShifts() {
        const { user } = useAuthStore.getState();
        const dbLocal = await getDB();

        // 1. Intentar leer de base de datos local
        let shifts = await dbLocal.shifts.toArray();

        // 2. Si hay muy pocos datos (cache vacío) y hay internet, hidratamos desde Firebase
        // Esto soluciona que el admin no vea nada en una PC limpia
        if (shifts.length < 5 && navigator.onLine) {
             await this._fetchHistoryFromCloud(dbLocal, user);
             shifts = await dbLocal.shifts.toArray(); // Recargamos
        }

        // 3. Filtrado Lógico (Sin ser estricto con branchId para no ocultar Legacy)
        let filteredShifts = [];

        if (user.role === 'ADMIN' || user.role === 'OWNER') {
            // Admin ve TODO. No filtramos por branchId para asegurar que vea datos viejos o de otras sucursales.
            filteredShifts = shifts; 
        } else {
            // Cajero ve solo SUS turnos
            filteredShifts = shifts.filter(s => s.userId === user.uid);
        }

        // 4. Ordenamiento final
        return filteredShifts.sort((a, b) => {
            const dateA = new Date(a.closedAt || a.openedAt || 0);
            const dateB = new Date(b.closedAt || b.openedAt || 0);
            return dateB - dateA;
        });
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
        const { user } = useAuthStore.getState();
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
    // ⚖️ BALANCE Y AUDITORÍA
    // =========================================
    async getShiftBalance(shiftId) {
        const dbLocal = await getDB();
        const { user } = useAuthStore.getState();

        return await dbLocal.transaction('r', [dbLocal.cash_movements, dbLocal.shifts], async () => {
            const shift = await dbLocal.shifts.get(shiftId);
            
            // Si el turno no está en local (puede pasar en modo admin remoto), intentamos no explotar
            // Idealmente deberíamos hidratar aquí también, pero para no bloquear UI devolvemos vacío
            if (!shift) return { totalCash: 0, movements: [], salesCash: 0, salesDigital: 0 };

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
    
    async getShiftAuditData(shiftId) {
        const dbLocal = await getDB();
        
        return await dbLocal.transaction('r', [dbLocal.cash_movements, dbLocal.shifts, dbLocal.sales], async () => {
            const shift = await dbLocal.shifts.get(shiftId);
            if (!shift) throw new Error("Turno no encontrado");

            const openedAt = new Date(shift.openedAt).toISOString();
            const closedAt = shift.closedAt ? new Date(shift.closedAt).toISOString() : new Date().toISOString();

            // Buscar ventas asociadas por fecha (Robusto para legacy)
            const shiftSales = await dbLocal.sales
                .where('date').between(openedAt, closedAt, true, true)
                .filter(s => {
                    const isValidStatus = s.status !== 'CANCELLED';
                    const isSameUser = s.userId === shift.userId;
                    // Solo filtramos por branch si el turno tiene branch
                    const isSameBranch = shift.branchId ? s.branchId === shift.branchId : true;
                    return isValidStatus && (isSameUser || isSameBranch);
                })
                .toArray();

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

            // Procesar Movimientos
            for (const m of allMovements) {
                const amount = Number(m.amount) || 0;
                const method = (m.method || 'unknown').toLowerCase();
                const isCash = method === 'cash';

                if (isCash) {
                    if (m.type === 'SALE' || m.type === 'IN') audit.expectedCash += amount;
                    if (m.type === 'DEPOSIT' && m.description !== 'Fondo Inicial de Caja') audit.expectedCash += amount; 
                    if (m.type === 'WITHDRAWAL' || m.type === 'EXPENSE') audit.expectedCash -= amount;
                }
                
                if (m.type === 'DEPOSIT') audit.cashIn += amount;
                if (m.type === 'WITHDRAWAL' || m.type === 'EXPENSE') audit.cashOut += amount;
            }

            audit.expectedCash = round2(audit.expectedCash);
            audit.totalSales = round2(audit.totalSales);
            audit.totalDigital = round2(audit.totalDigital);
            
            if (shift.status === 'OPEN') {
                audit.declaredCash = audit.expectedCash;
            }
            
            audit.deviation = round2(audit.declaredCash - audit.expectedCash);
            
            return audit;
        });
    }
};