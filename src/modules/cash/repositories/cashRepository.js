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
        if (!user) throw new Error("Sistema: No hay sesión de usuario activa.");

        const targetBranch = activeBranchId || user.branchId || 'main';
        return { user, branchId: targetBranch };
    },

    // =========================================
    // 🟢 GESTIÓN DE TURNO (APERTURA BLINDADA LOCAL-FIRST)
    // =========================================
    async openShift(initialAmount, userName) {
        const { user, branchId } = this._getContext();
        
        if (!branchId) throw new Error("Error Crítico: No se ha seleccionado una sucursal válida.");

        const dbLocal = await getDB();
        
        // 1. Verificar LOCALMENTE si ya hay uno abierto
        const activeInBranch = await dbLocal.shifts
            .where('status').equals('OPEN')
            .filter(s => s.userId === user.uid && s.branchId === branchId)
            .first();

        if (activeInBranch) {
            console.log("⚠️ Turno ya abierto recuperado localmente:", activeInBranch.id);
            return activeInBranch; 
        }

        const shift = {
            id: generateId('shift'),
            userId: user.uid,
            userEmail: user.email,
            userName: userName || user.name || 'Cajero',
            companyId: user.companyId,
            branchId: branchId,
            status: 'OPEN',
            openedAt: new Date().toISOString(),
            initialAmount: parseFloat(initialAmount),
            
            // Valores que se llenan al cerrar
            expectedCash: 0,     
            finalCash: 0,       
            leftInCash: 0, 
            withdrawn: 0,  
            difference: 0,       
            
            audited: false,
            syncStatus: 'pending' 
        };

        // Movimiento inicial de "Fondo de Caja"
        const initialMovement = {
            id: generateId('mov'),
            shiftId: shift.id,
            type: 'DEPOSIT', 
            method: 'cash',
            amount: parseFloat(initialAmount),
            description: 'Fondo Inicial de Caja',
            branchId: branchId,
            userId: user.uid,
            companyId: user.companyId,
            date: new Date().toISOString(),
            syncStatus: 'pending',
            subtype: 'OPENING' 
        };

        // 2. Guardado Atómico Local (Instantáneo)
        await dbLocal.transaction('rw', [dbLocal.shifts, dbLocal.cash_movements], async () => {
            await dbLocal.shifts.put(shift);
            await dbLocal.cash_movements.put(initialMovement);
        });

        // 3. Sincronización en Segundo Plano (No bloqueante)
        this._syncToCloud('shifts', shift);
        this._syncToCloud('cash_movements', initialMovement);
        
        return shift;
    },

    // =========================================
    // 🔴 GESTIÓN DE TURNO (CIERRE BLINDADO Z)
    // =========================================
    async closeShift(shiftId, closingData) {
        const dbLocal = await getDB();
        const shift = await dbLocal.shifts.get(shiftId);
        if (!shift) throw new Error("Turno no encontrado");

        const { user } = useAuthStore.getState();
        
        // Validación de permisos básica
        if (shift.userId !== user?.uid && user?.role !== 'ADMIN' && user?.role !== 'OWNER') {
             throw new Error("No tienes permisos para cerrar esta caja.");
        }

        // 1. 🔥 CÁLCULO DE LA VERDAD (Expected Cash)
        const currentAudit = await this.getShiftAuditData(shiftId);

        // 2. Datos declarados por el humano (lo que contaron)
        const declared = closingData.declaredCash ? parseFloat(closingData.declaredCash) : 0;
        const left = closingData.leftInCash ? parseFloat(closingData.leftInCash) : 0;
        
        // 3. Cálculos finales
        const withdrawn = Math.max(0, declared - left); // Lo que se llevan
        const difference = declared - currentAudit.expectedCash; // Sobrante (+) o Faltante (-)

        const closedShift = {
            ...shift,
            status: 'CLOSED',
            closedAt: new Date().toISOString(),
            
            // Valores Finales
            finalCash: declared,      // Lo que dijo el cajero que hay
            leftInCash: left,         // Lo que deja para mañana
            withdrawn: withdrawn,     // Lo que se retira
            expectedCash: currentAudit.expectedCash, // Lo que el sistema dice que debería haber
            
            expectedDigital: parseFloat(closingData.expectedDigital || 0), // Referencia digital
            difference: difference,   // El veredicto del arqueo
            
            audited: false, 
            
            // 🔥🔥 SNAPSHOT CONGELADO (Evidence Locker) 🔥🔥
            auditSnapshot: {
                totalSales: currentAudit.totalSales,
                salesCount: currentAudit.salesCount,
                salesByMethod: currentAudit.salesByMethod,
                
                cashIn: currentAudit.cashIn,
                cashOut: currentAudit.cashOut,
                
                totalExpenses: currentAudit.totalExpenses, 
                totalWithdrawals: currentAudit.totalWithdrawals,
                totalDigital: currentAudit.totalDigital,
                
                expectedCash: currentAudit.expectedCash,
                initialAmount: currentAudit.initialAmount,
                
                declaredCash: declared,
                leftInCash: left,
                difference: difference,
                
                generatedAt: new Date().toISOString()
            },

            syncStatus: 'pending' 
        };

        // Si se retira dinero, generamos el movimiento de salida automático
        let withdrawalMovement = null;
        if (withdrawn > 0) {
            withdrawalMovement = {
                id: generateId('mov'),
                shiftId: shift.id,
                
                // 🔥 FIX: 'TREASURY' para ignorar en reportes de gastos operativos
                type: 'TREASURY', 
                
                method: 'cash',
                amount: withdrawn,
                description: `Rendición de Cierre (Dejado: $${left})`,
                branchId: shift.branchId,
                userId: user.uid,
                companyId: user.companyId,
                date: new Date().toISOString(),
                syncStatus: 'pending',
                subtype: 'CLOSING' 
            };
        }

        // Guardado Atómico
        await dbLocal.transaction('rw', [dbLocal.shifts, dbLocal.cash_movements], async () => {
            await dbLocal.shifts.put(closedShift);
            if (withdrawalMovement) {
                await dbLocal.cash_movements.put(withdrawalMovement);
            }
        });

        // Sync Background
        this._syncToCloud('shifts', closedShift);
        if (withdrawalMovement) {
            this._syncToCloud('cash_movements', withdrawalMovement);
        }

        return closedShift;
    },

    // =========================================
    // ✅ CONFIRMAR AUDITORÍA (ADMIN)
    // =========================================
    async confirmShiftAudit(shiftId) {
        const dbLocal = await getDB();
        const shift = await dbLocal.shifts.get(shiftId);
        
        if (!shift) {
            const { user } = useAuthStore.getState();
            if (user?.companyId) {
                await setDoc(doc(db, `companies/${user.companyId}/shifts`, shiftId), { 
                    audited: true,
                    auditedAt: new Date().toISOString()
                }, { merge: true });
                return true;
            }
            throw new Error("No se pudo auditar el turno.");
        }

        const auditedShift = {
            ...shift,
            audited: true,
            auditedAt: new Date().toISOString(),
            syncStatus: 'pending'
        };

        await dbLocal.shifts.put(auditedShift);
        this._syncToCloud('shifts', auditedShift);
        return auditedShift;
    },
    
    // =========================================
    // 🔥 SYNC INTERNO (BACKGROUND)
    // =========================================
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
            }, { merge: true }).catch(err => console.warn("Background Sync Error:", err));

        } catch (e) { 
            console.warn(`Sync start error ${collectionName}:`, e); 
        }
    },

    // =========================================
    // 🔥 GETTERS Y UPDATERS (LOCAL FIRST)
    // =========================================
    async getCurrentShift() {
        const dbLocal = await getDB();
        const { user, branchId } = this._getContext();

        try {
            const openShifts = await dbLocal.shifts
                .where('status').equals('OPEN')
                .filter(s => s.userId === user.uid)
                .toArray();

            const activeInBranch = openShifts.find(s => s.branchId === branchId);

            if (!activeInBranch && openShifts.length > 0) return openShifts[0];

            return activeInBranch || null;

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
    // 💰 MOVIMIENTOS E INSERCIONES
    // =========================================
    async addMovement(movement) {
        const { user } = useAuthStore.getState();
        const dbLocal = await getDB();
        
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

    async getAllActiveShifts() {
        const dbLocal = await getDB();
        return await dbLocal.shifts.where('status').equals('OPEN').toArray();
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
    // 📊 HISTORIAL DE TURNOS
    // =========================================
    async getAllShifts() {
        const { user, branchId } = this._getContext();
        const dbLocal = await getDB();

        // 1. Carga Local Inmediata
        let shifts = await dbLocal.shifts.toArray();

        // 2. Hidratación Cloud en background
        if ((user.role === 'ADMIN' || user.role === 'OWNER') && navigator.onLine) {
             this._fetchHistoryFromCloud(dbLocal, user).then(async () => {
                 // Silent update
             });
        }

        let filteredShifts = [];

        if (user.role === 'ADMIN' || user.role === 'OWNER') {
            if (branchId) {
                filteredShifts = shifts.filter(s => s.branchId === branchId);
            } else {
                filteredShifts = shifts;
            }
        } else {
            filteredShifts = shifts.filter(s => s.userId === user.uid);
        }

        return filteredShifts.sort((a, b) => {
            const dateA = new Date(a.closedAt || a.openedAt || 0);
            const dateB = new Date(b.closedAt || b.openedAt || 0);
            return dateB - dateA;
        });
    },

    async _fetchHistoryFromCloud(dbLocal, user) {
        try {
            const { branchId } = this._getContext();
            const shiftsRef = collection(db, `companies/${user.companyId}/shifts`);
            let q;

            if (user.role === 'ADMIN' || user.role === 'OWNER') {
                if (branchId && branchId !== 'main') {
                    q = query(shiftsRef, where('branchId', '==', branchId), orderBy('openedAt', 'desc'), limit(50));
                } else {
                    q = query(shiftsRef, orderBy('openedAt', 'desc'), limit(50));
                }
            } else {
                q = query(shiftsRef, where('userId', '==', user.uid), orderBy('openedAt', 'desc'), limit(20));
            }

            const snapshot = await getDocs(q);
            const pendingIds = await dbLocal.shifts.where('syncStatus').equals('pending').primaryKeys();
            const pendingSet = new Set(pendingIds);

            const cloudShifts = snapshot.docs
                .map(d => ({ 
                    ...d.data(), 
                    id: d.id, 
                    syncStatus: 'synced',
                    branchId: d.data().branchId || 'main' 
                }))
                .filter(cloudItem => !pendingSet.has(cloudItem.id));

            if (cloudShifts.length > 0) {
                await dbLocal.shifts.bulkPut(cloudShifts);
            }
        } catch (e) { console.warn("Background history sync warning:", e); }
    },

    // =========================================
    // ⚖️ BALANCE Y AUDITORÍA (EL CEREBRO DEL CIERRE Z)
    // =========================================
    
    // Función Helper para calcular totales
    // 🔥 ESTA ES LA CLAVE: Calcula ventas desde 'sales' y movimientos extra desde 'cash_movements'
    async _calculateShiftState(shift, dbLocal) {
        if (!shift) return null;

        // 🔥 CORRECCIÓN DEL ERROR "SchemaError": Usamos filter() en lugar de where()
        // porque shiftId no está indexado en la tabla 'sales' ni 'cash_movements' en el esquema actual.
        // Esto es un poco más lento pero evita que la app explote.
        
        const sales = await dbLocal.sales
            .filter(s => s.shiftId === shift.id)
            .toArray();

        const movements = await dbLocal.cash_movements
            .filter(m => m.shiftId === shift.id)
            .toArray();

        // Inicializamos contadores
        let state = {
            initialAmount: Number(shift.initialAmount) || 0,
            
            // Ventas
            salesCash: 0,
            salesDigital: 0,
            totalSales: 0,
            salesCount: 0,
            salesByMethod: { cash: 0, mercadopago: 0, clover: 0, digitalOther: 0, account: 0 },
            
            // Movimientos
            deposits: 0,
            expenses: 0,
            withdrawals: 0,
            
            // Totales
            totalCash: 0,    // Efectivo Teórico Actual
            totalDigital: 0
        };

        // A. PROCESAR VENTAS (Excluyendo Internas y Anuladas)
        sales.forEach(sale => {
            if (sale.type === 'INTERNAL') return; // 🛡️ Ignorar consumo interno
            if (sale.afip?.status === 'VOIDED' || sale.status === 'CANCELLED' || sale.status === 'REFUNDED') return; // Ignorar anuladas/devueltas

            const amount = parseFloat(sale.total) || 0;
            state.totalSales += amount;
            state.salesCount++;

            // Normalización de método de pago
            const methodRaw = sale.payment?.method || sale.paymentMethod || 'cash';
            const method = String(methodRaw).toLowerCase().trim();

            if (['cash', 'efectivo'].includes(method)) {
                state.salesByMethod.cash += amount;
                state.salesCash += amount;
            } else if (['mercadopago', 'mp', 'qr'].includes(method)) {
                state.salesByMethod.mercadopago += amount;
                state.salesDigital += amount;
            } else if (['clover', 'card', 'tarjeta', 'credit', 'debit'].includes(method)) {
                state.salesByMethod.clover += amount;
                state.salesDigital += amount;
            } else if (['current_account', 'cuenta_corriente'].includes(method)) {
                state.salesByMethod.account += amount;
                // Cta Corriente no suma a caja ni digital
            } else {
                state.salesByMethod.digitalOther += amount;
                state.salesDigital += amount;
            }
        });

        // B. PROCESAR MOVIMIENTOS (Solo Cash y No-Ventas)
        movements.forEach(m => {
            const amount = Number(m.amount) || 0;
            const isCash = (m.method || 'cash') === 'cash';
            
            // Ignoramos SALE porque ya las sumamos desde la tabla 'sales' (más preciso)
            if (m.type === 'SALE' || m.type === 'INTERNAL') return; 

            // Ignoramos movimientos de cierre/tesorería para el cálculo de "lo que debería haber"
            if (m.type === 'TREASURY' || m.subtype === 'CLOSING') return;

            if (m.type === 'DEPOSIT') {
                if (m.subtype !== 'OPENING') { // Fondo inicial ya está en initialAmount
                    state.deposits += amount;
                    if (isCash) state.salesCash += amount; // Lo tratamos como entrada de efectivo
                }
            } else if (m.type === 'EXPENSE') {
                state.expenses += amount;
            } else if (m.type === 'WITHDRAWAL') {
                state.withdrawals += amount;
            } else if (m.type === 'IN') { // Ingreso manual vario
                if (isCash) state.salesCash += amount;
            }
        });

        // C. CÁLCULO FINAL DE CAJA TEÓRICA
        // Caja Teórica = Inicial + VentasEfvo + Depositos - Gastos - Retiros
        state.totalCash = state.initialAmount + state.salesByMethod.cash + state.deposits - state.expenses - state.withdrawals;
        state.totalDigital = state.salesDigital;

        // Redondeo de seguridad
        const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
        state.totalCash = round(state.totalCash);
        state.totalSales = round(state.totalSales);
        
        return state;
    },

    // Obtener Balance Visual (Para UI en vivo)
    async getShiftBalance(shiftId) {
        const dbLocal = await getDB();
        
        return await dbLocal.transaction('r', [dbLocal.cash_movements, dbLocal.shifts, dbLocal.sales], async () => {
            const shift = await dbLocal.shifts.get(shiftId);
            if (!shift) return { totalCash: 0 };
            
            // Usamos el motor de cálculo unificado
            const state = await this._calculateShiftState(shift, dbLocal);
            
            // Corrección: Usar filter también aquí
            const movements = await dbLocal.cash_movements.filter(m => m.shiftId === shiftId).reverse().toArray();
            
            return {
                ...state,
                movements: movements
            };
        });
    },

    // Obtener Datos para Auditoría (Foto Fija)
    async getShiftAuditData(shiftId) {
        const dbLocal = await getDB();
        const shift = await dbLocal.shifts.get(shiftId);
        if (!shift) throw new Error("Turno no encontrado");

        // 1. Si ya está cerrado y tiene foto, devolvemos la foto (Inmutable)
        if (shift.status === 'CLOSED' && shift.auditSnapshot) {
            return {
                shiftId: shift.id,
                shiftName: shift.userName || shift.userId,
                status: shift.status,
                startTime: shift.openedAt,
                closeTime: shift.closedAt,
                initialAmount: Number(shift.initialAmount),
                ...shift.auditSnapshot, 
                auditSnapshot: shift.auditSnapshot
            };
        }

        // 2. Si está abierto, calculamos
        return await dbLocal.transaction('r', [dbLocal.cash_movements, dbLocal.shifts, dbLocal.sales], async () => {
            const state = await this._calculateShiftState(shift, dbLocal);
            
            return {
                shiftId: shift.id,
                shiftName: shift.userName || shift.userId,
                status: shift.status,
                startTime: shift.openedAt,
                closeTime: new Date().toISOString(),
                initialAmount: state.initialAmount,
                
                totalSales: state.totalSales,
                salesCount: state.salesCount,
                salesByMethod: state.salesByMethod,
                
                cashIn: state.deposits, // Entradas extras
                cashOut: state.expenses + state.withdrawals, // Salidas
                
                totalExpenses: state.expenses,
                totalWithdrawals: state.withdrawals,
                totalDigital: state.totalDigital,
                
                expectedCash: state.totalCash, // EL NÚMERO MÁGICO
                
                // Valores de cierre (si existieran, o 0)
                leftInCash: Number(shift.leftInCash) || 0,
                declaredCash: Number(shift.finalCash) || 0,
                withdrawn: Number(shift.withdrawn) || 0
            };
        });
    }
};