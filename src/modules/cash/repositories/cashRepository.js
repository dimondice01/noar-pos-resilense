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
    // 🟢 GESTIÓN DE TURNO (APERTURA)
    // =========================================
    async openShift(initialAmount, userName) {
        const { user, branchId } = this._getContext();
        
        if (!branchId) throw new Error("Error Crítico: No se ha seleccionado una sucursal válida.");

        const dbLocal = await getDB();
        
        // Verificar si ya hay uno abierto para este usuario en esta sucursal
        const activeInBranch = await dbLocal.shifts
            .where('status').equals('OPEN')
            .filter(s => s.userId === user.uid && s.branchId === branchId)
            .first();

        if (activeInBranch) return activeInBranch; 

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

        await dbLocal.transaction('rw', [dbLocal.shifts, dbLocal.cash_movements], async () => {
            await dbLocal.shifts.put(shift);
            await dbLocal.cash_movements.put(initialMovement);
        });

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
        // Obtenemos la auditoría interna del sistema antes de cerrar
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
            
            audited: false, // Requiere revisión de un admin si hay diferencia
            
            // 🔥🔥 SNAPSHOT CONGELADO (Evidence Locker) 🔥🔥
            // Guardamos la foto exacta de los contadores en este momento
            auditSnapshot: {
                totalSales: currentAudit.totalSales,
                salesCount: currentAudit.salesCount,
                salesByMethod: currentAudit.salesByMethod,
                
                cashIn: currentAudit.cashIn,
                cashOut: currentAudit.cashOut,
                
                totalExpenses: currentAudit.totalExpenses, // Aquí entran las COMPRAS en efectivo
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
                type: 'WITHDRAWAL',
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

        await dbLocal.transaction('rw', [dbLocal.shifts, dbLocal.cash_movements], async () => {
            await dbLocal.shifts.put(closedShift);
            if (withdrawalMovement) {
                await dbLocal.cash_movements.put(withdrawalMovement);
            }
        });

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
            // Fallback cloud para Owners remotos
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
    // 🔥 SYNC INTERNO
    // =========================================
    async _syncToCloud(collectionName, data) {
        if (!navigator.onLine) return; 
        const { user } = useAuthStore.getState();
        if (!user || !user.companyId) return;

        try {
            const { syncStatus, ...cloudData } = data;
            const path = `companies/${user.companyId}/${collectionName}`;

            await setDoc(doc(db, path, data.id), {
                ...cloudData,
                firestoreId: data.id,
                syncedAt: new Date().toISOString(),
                syncStatus: 'synced'
            }, { merge: true });

        } catch (e) { 
            console.warn(`Sync error ${collectionName}:`, e); 
        }
    },

    // =========================================
    // 🔥 GETTERS Y UPDATERS
    // =========================================
    async getCurrentShift() {
        const dbLocal = await getDB();
        const { user, branchId } = this._getContext();

        try {
            const openShifts = await dbLocal.shifts
                .where('status').equals('OPEN')
                .filter(s => s.userId === user.uid)
                .toArray();

            // Priorizamos la sucursal actual, sino devolvemos cualquiera abierta del usuario
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
            type: 'EXPENSE', // Aquí caerán las COMPRAS en efectivo
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

        let shifts = await dbLocal.shifts.toArray();

        // Si es admin, intentamos traer historial de la nube para hidratar local
        if ((user.role === 'ADMIN' || user.role === 'OWNER') && navigator.onLine) {
             await this._fetchHistoryFromCloud(dbLocal, user);
             shifts = await dbLocal.shifts.toArray(); 
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
        if (!navigator.onLine) return;
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
        } catch (e) { console.error("Sync error:", e); }
    },

    // =========================================
    // ⚖️ BALANCE Y AUDITORÍA (EL CEREBRO DEL CIERRE Z)
    // =========================================
    
    // Función auxiliar para traer datos faltantes de la nube si el turno es viejo
    async _ensureAuditDataConsistency(shift, dbLocal) {
        if (!navigator.onLine) return;
        try {
            const { user } = useAuthStore.getState();
            if (!user.companyId) return;

            const start = new Date(shift.openedAt);
            const end = shift.closedAt ? new Date(shift.closedAt) : new Date();
            start.setMinutes(start.getMinutes() - 10); 
            end.setMinutes(end.getMinutes() + 10);

            // A. Movimientos de Caja
            const movsQuery = query(
                collection(db, `companies/${user.companyId}/cash_movements`),
                where('shiftId', '==', shift.id)
            );

            // B. Ventas por ShiftID (Prioridad)
            const salesQueryId = query(
                collection(db, `companies/${user.companyId}/sales`),
                where('shiftId', '==', shift.id)
            );

            const [movsSnap, salesIdSnap] = await Promise.all([
                getDocs(movsQuery),
                getDocs(salesQueryId)
            ]);

            const movsToSync = movsSnap.docs.map(d => ({ ...d.data(), id: d.id, syncStatus: 'synced' }));
            const salesToSync = salesIdSnap.docs.map(d => ({ ...d.data(), localId: d.id, syncStatus: 'synced' }));

            if (salesToSync.length > 0) await dbLocal.sales.bulkPut(salesToSync).catch(() => {});
            if (movsToSync.length > 0) await dbLocal.cash_movements.bulkPut(movsToSync).catch(() => {});

        } catch (e) {
            console.warn("⚠️ Audit sync warning:", e);
        }
    },

    // Obtener Balance Visual (Para UI en vivo)
    async getShiftBalance(shiftId) {
        const dbLocal = await getDB();
        
        // Aseguramos consistencia de datos antes de calcular
        const shift = await dbLocal.shifts.get(shiftId);
        if (shift) await this._ensureAuditDataConsistency(shift, dbLocal);

        return await dbLocal.transaction('r', [dbLocal.cash_movements, dbLocal.shifts], async () => {
            const s = await dbLocal.shifts.get(shiftId);
            if (!s) return { totalCash: 0, movements: [], salesCash: 0, totalDigital: 0 };

            const allMovements = await dbLocal.cash_movements
                .where('shiftId').equals(shiftId)
                .toArray();
            
            allMovements.sort((a, b) => new Date(b.date) - new Date(a.date));

            let balance = {
                initialAmount: Number(s.initialAmount) || 0,
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
                
                // Detección de Métodos Digitales
                const isDigitalKnown = 
                    method.includes('mercado') || 
                    method.includes('clover') || 
                    method.includes('card') || 
                    method.includes('tarjeta') || 
                    method === 'point' || 
                    method === 'qr' || 
                    method === 'transfer' ||
                    method === 'manual_card';

                const description = (m.description || '').toLowerCase();
                const isClosingWithdrawal = m.subtype === 'CLOSING' || description.includes('rendición de cierre');

                if (m.type === 'SALE' || m.type === 'IN') { 
                    if (method === 'cash' || method === 'efectivo' || (!isDigitalKnown && method !== 'debt')) { 
                        balance.salesCash += amount;
                        balance.totalCash += amount;
                    } else {
                        balance.salesDigital += amount;
                        balance.totalDigital += amount;
                    }
                } else if (m.type === 'DEPOSIT') {
                    if (m.subtype !== 'OPENING') { 
                        balance.totalCash += amount;
                        balance.deposits += amount;
                    }
                } else if (m.type === 'WITHDRAWAL') {
                    if (!isClosingWithdrawal) {
                        balance.totalCash -= amount;
                        balance.withdrawals += amount;
                    }
                } else if (m.type === 'EXPENSE') {
                    // 🔥 AQUÍ SE RESTAN LAS COMPRAS EN EFECTIVO
                    if (method === 'cash' || method === 'efectivo') {
                        balance.totalCash -= amount;
                    }
                    balance.expenses += amount;
                }
            }
            
            const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;
            
            return {
                ...balance,
                totalCash: round2(balance.totalCash), // Efectivo Teórico en Caja
                salesCash: round2(balance.salesCash),
                salesDigital: round2(balance.salesDigital),
                expenses: round2(balance.expenses)
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

        // 2. Si está abierto o re-calculando, hidratamos y procesamos
        await this._ensureAuditDataConsistency(shift, dbLocal);
        
        return await dbLocal.transaction('r', [dbLocal.cash_movements, dbLocal.shifts, dbLocal.sales], async () => {
            const freshShift = await dbLocal.shifts.get(shiftId);
            const openedAt = new Date(freshShift.openedAt).toISOString();
            const closedAt = freshShift.closedAt ? new Date(freshShift.closedAt).toISOString() : new Date().toISOString();

            // Obtenemos todas las ventas del turno
            const shiftSales = await dbLocal.sales
                .where('date').between(openedAt, closedAt, true, true)
                .filter(s => {
                    const isValidStatus = s.status !== 'CANCELLED';
                    if (s.shiftId && s.shiftId === shiftId) return isValidStatus;
                    // Fallback por tiempo y usuario si no tiene shiftId
                    const isSameUser = s.userId === freshShift.userId;
                    return isValidStatus && isSameUser;
                })
                .toArray();

            const allMovements = await dbLocal.cash_movements
                .where('shiftId').equals(shiftId)
                .toArray();

            let audit = {
                shiftId: freshShift.id,
                shiftName: freshShift.userName || freshShift.userId,
                status: freshShift.status,
                startTime: freshShift.openedAt,
                closeTime: freshShift.closedAt || new Date().toISOString(),
                initialAmount: Number(freshShift.initialAmount) || 0, 
                
                totalSales: 0,
                salesCount: shiftSales.length,
                salesByMethod: { cash: 0, mercadopago: 0, clover: 0, digitalOther: 0 },
                
                cashIn: 0,
                cashOut: 0,
                totalExpenses: 0,
                totalWithdrawals: 0,
                
                expectedCash: Number(freshShift.initialAmount) || 0, // Inicia con el fondo
                totalDigital: 0,
                
                leftInCash: Number(freshShift.leftInCash) || 0,
                declaredCash: Number(freshShift.finalCash) || 0,
                withdrawn: Number(freshShift.withdrawn) || 0
            };

            const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

            // Procesar Ventas
            for (const sale of shiftSales) {
                const total = parseFloat(sale.totalSale || sale.total) || 0;
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

            // Procesar Movimientos de Caja (Aquí está el blindaje)
            for (const m of allMovements) {
                const amount = Number(m.amount) || 0;
                const method = (m.method || 'unknown').toLowerCase();
                const isCash = method === 'cash' || method === 'efectivo';
                const description = (m.description || '').toLowerCase();
                const isClosingWithdrawal = m.subtype === 'CLOSING' || description.includes('rendición de cierre');

                if (isCash) {
                    if (m.type === 'SALE' || m.type === 'IN') {
                        audit.expectedCash += amount;
                    }
                    if (m.type === 'DEPOSIT') {
                        if (m.subtype !== 'OPENING') {
                            audit.expectedCash += amount;
                            audit.cashIn += amount; 
                        }
                    }
                    if (m.type === 'WITHDRAWAL') {
                        if (!isClosingWithdrawal) {
                            audit.expectedCash -= amount;
                            audit.totalWithdrawals += amount;
                            audit.cashOut += amount; 
                        }
                    }
                    // 🔥 EXPENSE = COMPRAS O GASTOS (Resta de la caja)
                    if (m.type === 'EXPENSE') {
                        audit.expectedCash -= amount;
                        audit.totalExpenses += amount;
                        audit.cashOut += amount; 
                    }
                }
            }

            audit.expectedCash = round2(audit.expectedCash);
            audit.totalSales = round2(audit.totalSales);
            audit.totalDigital = round2(audit.totalDigital);
            
            // Si está abierto, asumimos declarado = esperado provisionalmente
            if (freshShift.status === 'OPEN') {
                audit.declaredCash = audit.expectedCash;
            }
            
            audit.deviation = round2(audit.declaredCash - audit.expectedCash);
            
            return audit;
        });
    }
};