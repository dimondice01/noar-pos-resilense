import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore'; 

// 🔥 GENERADOR DE ID GLOBAL ÚNICO (Blindaje Multi-Caja)
const generateGlobalId = (prefix) => {
    const { activeBranchId } = useAuthStore.getState();
    const branchClean = String(activeBranchId || 'main').substring(0, 4);
    const ts = Date.now();
    const rand = Math.random().toString(36).substr(2, 4);
    return `${prefix}_${branchClean}_${ts}_${rand}`;
};

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
        
        if (!branchId || branchId === 'ALL') throw new Error("Error Crítico: No se ha seleccionado una sucursal válida para abrir caja.");

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
            id: generateGlobalId('shift'),
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
            id: generateGlobalId('mov'),
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
                
                manualIn: currentAudit.manualIn,   
                manualOut: currentAudit.manualOut, 
                
                digitalIn: currentAudit.digitalIn, 
                digitalInByMethod: currentAudit.digitalInByMethod, 
                
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
                id: generateGlobalId('mov'),
                shiftId: shift.id,
                
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
                await setDoc(doc(db, `companies/${user.companyId}/shifts`, String(shiftId)), { 
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
            const { syncStatus, localId, ...cloudData } = data;
            const path = `companies/${user.companyId}/${collectionName}`;
            
            // Forzamos String para evitar bugs de Firebase
            const cloudId = String(data.firestoreId || data.id);

            setDoc(doc(db, path, cloudId), {
                ...cloudData,
                firestoreId: cloudId,
                syncedAt: new Date().toISOString(),
                syncStatus: 'synced',
                lastUpdatedBy: user.uid
            }, { merge: true }).catch(err => console.warn("Background Sync Error:", err));

            const dbLocal = await getDB();
            await dbLocal.table(collectionName).update(data.id, { syncStatus: 'synced', firestoreId: cloudId });

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
            id: generateGlobalId('mov'),
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

    async registerIncome(amount, method, description = 'Ingreso Manual') {
        const shift = await this.getCurrentShift();
        if (!shift) throw new Error("⚠️ CAJA CERRADA: Abra turno para cobrar.");

        return this.addMovement({
            shiftId: shift.id,
            branchId: shift.branchId, 
            type: 'IN', 
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
            referenceId: reference,
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
            referenceId: reference, 
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
            if (branchId && branchId !== 'main' && branchId !== 'ALL') {
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
                if (branchId && branchId !== 'main' && branchId !== 'ALL') {
                    q = query(shiftsRef, where('branchId', '==', branchId), orderBy('openedAt', 'desc'), limit(50));
                } else {
                    q = query(shiftsRef, orderBy('openedAt', 'desc'), limit(50));
                }
            } else {
                q = query(shiftsRef, where('userId', '==', user.uid), orderBy('openedAt', 'desc'), limit(20));
            }

            const snapshot = await getDocs(q);
            const cloudShifts = [];
            
            snapshot.docs.forEach(d => {
                cloudShifts.push({ 
                    ...d.data(), 
                    id: d.id, 
                    firestoreId: d.id,
                    syncStatus: 'synced',
                    branchId: d.data().branchId || 'main' 
                });
            });

            if (cloudShifts.length > 0) {
                await dbLocal.shifts.bulkPut(cloudShifts);
            }
        } catch (e) { console.warn("Background history sync warning:", e); }
    },

    // =========================================
    // ⚖️ BALANCE Y AUDITORÍA (EL CEREBRO DEL CIERRE Z BLINDADO)
    // =========================================
    
    async _calculateShiftState(shift, dbLocal) {
        if (!shift) return null;

        // 1. OBTENEMOS VENTAS REALES (Fuente de Verdad Única para Ingresos por Ventas)
        const sales = await dbLocal.sales
            .filter(s => s.shiftId === shift.id && s.status === 'COMPLETED' && s.type !== 'INTERNAL' && s.type !== 'BUDGET')
            .toArray();

        // 🔥 EL ESCUDO ANTI-DUPLICACIÓN: Guardamos los IDs de todas las ventas contadas
        const countedSalesIds = new Set(sales.map(s => s.id));

        // 2. OBTENEMOS MOVIMIENTOS DE CAJA
        const movements = await dbLocal.cash_movements
            .filter(m => m.shiftId === shift.id)
            .toArray();

        let state = {
            initialAmount: Number(shift.initialAmount) || 0,
            
            // Ventas
            salesCash: 0,
            salesDigital: 0,
            totalSales: 0,
            salesCount: 0,
            salesByMethod: { 
                cash: 0, cash_from_account: 0, transfer: 0, transfer_from_account: 0,
                mercadopago: 0, clover: 0, point: 0, manual_card: 0, card: 0, 
                digitalOther: 0, account: 0, employee_account: 0, debt: 0
            },
            
            // Movimientos Manuales (Dinero Físico Extra)
            manualIn: 0, 
            manualOut: 0,

            // Movimientos Digitales Extra (Transferencias, Pagos con código QR)
            digitalIn: 0, 
            digitalInByMethod: { transfer: 0, mercadopago: 0, clover: 0, point: 0, card: 0, digitalOther: 0 },

            // Totales visuales
            totalCash: 0, 
            totalDigital: 0
        };

        // A. PROCESAR VENTAS PERFECTAMENTE (Evita la duplicación)
        sales.forEach(sale => {
            state.salesCount++;
            
            // Reconstruimos los pagos, si es mixto o único
            const payments = Array.isArray(sale.payments) && sale.payments.length > 0 
                ? sale.payments 
                : [{ method: sale.method || sale.paymentMethod || 'cash', amount: sale.total, total: sale.total }];

            payments.forEach(p => {
                const pAmount = Number(p.total || p.amount || 0);
                const pMethod = String(p.method || 'cash').toLowerCase().trim();
                
                state.totalSales += pAmount;
                state.salesByMethod[pMethod] = (state.salesByMethod[pMethod] || 0) + pAmount;

                if (['cash', 'efectivo'].includes(pMethod)) {
                    state.salesCash += pAmount;
                } else if (!['account', 'employee_account', 'budget', 'debt', 'current_account'].includes(pMethod)) {
                    state.totalDigital += pAmount;
                }
            });
        });

        // B. PROCESAR MOVIMIENTOS MANUALES (Blindaje total contra colisiones)
        movements.forEach(m => {
            // 1. Ignorar aperturas y cierres (la apertura ya está en initialAmount)
            if (m.subtype === 'OPENING' || m.description?.includes('Fondo Inicial')) return;
            if (m.subtype === 'CLOSING' || m.description?.toLowerCase().includes('rendición de cierre')) return;
            
            // 2. 🔥 REGLA ANTI-DUPLICACIÓN: 
            // Si este movimiento tiene como referencia una venta que ya sumamos arriba, LO IGNORAMOS.
            if (m.type === 'SALE' || m.subtype === 'SALE' || countedSalesIds.has(m.referenceId)) return;

            const amount = Number(m.amount) || 0;
            const methodRaw = String(m.method || 'cash').toLowerCase().trim();
            const isCash = ['cash', 'efectivo'].includes(methodRaw);
            
            const isIncome = m.type === 'IN' || m.type === 'DEPOSIT' || m.type === 'RECEIPT';
            const isOutcome = m.type === 'OUT' || m.type === 'EXPENSE' || m.type === 'WITHDRAWAL' || m.type === 'PURCHASE' || m.type === 'REFUND';

            if (isIncome) {
                if (isCash) state.manualIn += amount;
                else {
                    state.digitalIn += amount;
                    if (['mercadopago', 'mp', 'qr'].includes(methodRaw)) state.digitalInByMethod.mercadopago += amount;
                    else if (['transfer', 'transferencia'].includes(methodRaw)) state.digitalInByMethod.transfer += amount;
                    else state.digitalInByMethod.digitalOther += amount;
                }
            } else if (isOutcome) {
                if (isCash) state.manualOut += amount;
            }
        });

        // C. CÁLCULO FINAL DE CAJA TEÓRICA 🔥 (AHORA SÍ ES PERFECTO)
        // Fondo Inicial + Ventas Efectivo + Ingresos Manuales (Efectivo) - Salidas Manuales/Proveedores (Efectivo)
        state.totalCash = state.initialAmount + state.salesCash + state.manualIn - state.manualOut;

        // Redondeo de seguridad para evitar bugs de coma flotante de JS
        const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
        state.totalCash = round(state.totalCash);
        state.totalSales = round(state.totalSales);
        state.totalDigital = round(state.totalDigital + state.digitalIn);
        
        return state;
    },

    // Obtener Balance Visual (Para Auditoría Detallada)
    async getShiftBalance(shiftId) {
        const dbLocal = await getDB();
        
        return await dbLocal.transaction('r', [dbLocal.cash_movements, dbLocal.shifts, dbLocal.sales], async () => {
            const shift = await dbLocal.shifts.get(shiftId);
            if (!shift) return { totalCash: 0, movements: [] };
            
            const state = await this._calculateShiftState(shift, dbLocal);
            
            // 🔥 UNIFICAMOS VISUALMENTE VENTAS Y MOVIMIENTOS PARA EL DASHBOARD
            const sales = await dbLocal.sales.filter(s => s.shiftId === shiftId && s.status === 'COMPLETED').toArray();
            const countedSalesIds = new Set(sales.map(s => s.id));
            
            const movements = await dbLocal.cash_movements.filter(m => m.shiftId === shiftId).toArray();
            
            let allOperations = [];
            
            sales.forEach(s => {
                const method = s.payment?.method || s.method || s.paymentMethod || 'cash';
                allOperations.push({
                    id: s.id, type: 'SALE', method: method, amount: s.total,
                    description: `Venta ${s.ticketNumber || s.number || ''}`,
                    date: s.date || s.createdAt
                });
            });
            
            movements.forEach(m => {
                if (m.subtype === 'OPENING' || m.description?.includes('Fondo Inicial')) return;
                // No mostrar movimientos duplicados de ventas en el listado visual
                if (m.type === 'SALE' || m.subtype === 'SALE' || countedSalesIds.has(m.referenceId)) return;
                allOperations.push(m);
            });

            // Ordenamos todo por fecha descendente
            allOperations.sort((a, b) => new Date(b.date) - new Date(a.date));

            return {
                ...state,
                movements: allOperations
            };
        });
    },

    // Obtener Datos para Auditoría (Para Ticket Z)
    async getShiftAuditData(shiftId) {
        const dbLocal = await getDB();
        const shift = await dbLocal.shifts.get(shiftId);
        if (!shift) throw new Error("Turno no encontrado");

        // 🔥 Si ya se cerró, DEVOLVEMOS EL SNAPSHOT EXACTO. NO RECALCULAMOS NADA.
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

        // Si está ABIERTO, recalculamos en vivo
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
                
                // Desglose para Ticket Z
                manualIn: state.manualIn,
                digitalIn: state.digitalIn,
                digitalInByMethod: state.digitalInByMethod, 
                manualOut: state.manualOut, // 🔥 INCLUYE GASTOS, RETIROS Y PAGOS A PROVEEDORES
                
                cashIn: state.manualIn + state.salesCash, 
                cashOut: state.manualOut, 
                
                totalExpenses: 0, // Reemplazado por la suma unificada de manualOut
                totalWithdrawals: 0,
                totalDigital: state.totalDigital,
                
                expectedCash: state.totalCash, // 🔥 EL NÚMERO MÁGICO DE CAJA PERFECTO
                
                leftInCash: Number(shift.leftInCash) || 0,
                declaredCash: Number(shift.finalCash) || 0,
                withdrawn: Number(shift.withdrawn) || 0
            };
        });
    }
};