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
            expectedCash: 0,     
            finalCash: 0,       
            leftInCash: 0, 
            withdrawn: 0,  
            difference: 0,       
            audited: false,
            syncStatus: 'pending' 
        };

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
    // 🔴 GESTIÓN DE TURNO (CIERRE)
    // =========================================
    async closeShift(shiftId, closingData) {
        const dbLocal = await getDB();
        const shift = await dbLocal.shifts.get(shiftId);
        if (!shift) throw new Error("Turno no encontrado");

        const { user } = useAuthStore.getState();
        
        // Validación estricta de permisos
        if (shift.userId !== user?.uid && user?.role !== 'ADMIN' && user?.role !== 'OWNER') {
             throw new Error("No tienes permisos para cerrar esta caja.");
        }

        const declared = closingData.declaredCash ? parseFloat(closingData.declaredCash) : 0;
        const expected = closingData.expectedCash ? parseFloat(closingData.expectedCash) : 0;
        const left = closingData.leftInCash ? parseFloat(closingData.leftInCash) : 0;
        
        // El dinero retirado es lo declarado MENOS lo que se deja de cambio
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
                subtype: 'CLOSING' // 🔥 CRÍTICO: Marca para que la auditoría no lo reste del teórico
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
    // 🔥 GET CURRENT SHIFT
    // =========================================
    async getCurrentShift() {
        const dbLocal = await getDB();
        const { user, branchId } = this._getContext();

        try {
            const openShifts = await dbLocal.shifts
                .where('status').equals('OPEN')
                .filter(s => s.userId === user.uid)
                .toArray();

            // Buscamos coincidencia estricta de branch
            const activeInBranch = openShifts.find(s => s.branchId === branchId);

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
    // 📊 HISTORIAL
    // =========================================
    async getAllShifts() {
        const { user, branchId } = this._getContext();
        const dbLocal = await getDB();

        let shifts = await dbLocal.shifts.toArray();

        // 📡 Hidratación: Si soy Admin, necesito ver lo de la nube
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

    // =========================================
    // ☁️ SYNC HELPERS (PROTEGIDO)
    // =========================================
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
    // 💰 MOVIMIENTOS
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
        const { branchId, user } = this._getContext();
        let shifts = await dbLocal.shifts.where('status').equals('OPEN').toArray();
        if ((user.role === 'ADMIN' || user.role === 'OWNER') && branchId) {
            return shifts.filter(s => s.branchId === branchId);
        }
        return shifts;
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
        
        return await dbLocal.transaction('r', [dbLocal.cash_movements, dbLocal.shifts], async () => {
            const shift = await dbLocal.shifts.get(shiftId);
            
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
                
                const description = (m.description || '').toLowerCase();
                const isClosingWithdrawal = m.subtype === 'CLOSING' || description.includes('rendición de cierre');

                if (m.type === 'SALE' || m.type === 'IN') { 
                    if (method === 'cash' || method === 'efectivo' || !isDigitalKnown) { 
                        balance.salesCash += amount;
                        balance.totalCash += amount;
                    } else {
                        balance.salesDigital += amount;
                        balance.totalDigital += amount;
                    }
                } else if (m.type === 'DEPOSIT') {
                    if (!description.includes('fondo inicial') && m.subtype !== 'OPENING') { 
                        balance.totalCash += amount;
                        balance.deposits += amount;
                    }
                } else if (m.type === 'WITHDRAWAL') {
                    if (!isClosingWithdrawal) {
                        balance.totalCash -= amount;
                        balance.withdrawals += amount;
                    }
                } else if (m.type === 'EXPENSE') {
                    balance.totalCash -= amount;
                    balance.expenses += amount;
                }
            }
            
            const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;
            const theoreticalTotal = balance.initialAmount + balance.salesCash + balance.deposits - balance.withdrawals - balance.expenses;

            return {
                ...balance,
                totalCash: round2(theoreticalTotal), 
                physicalCash: round2(balance.totalCash), 
                salesCash: round2(balance.salesCash),
                salesDigital: round2(balance.salesDigital),
                expenses: round2(balance.expenses)
            };
        });
    },
    
    // 🔥🔥 INGENIERÍA PURA: HIDRATACIÓN DE AUDITORÍA 🔥🔥
    // Esta función garantiza que antes de auditar, la PC tenga los datos del turno
    // aunque hayan sido generados en otra PC.
    async _ensureAuditDataConsistency(shift, dbLocal) {
        if (!navigator.onLine) return; // Si no hay red, usamos lo que hay
        
        try {
            const { user } = useAuthStore.getState();
            if (!user.companyId) return;

            // 1. Definir rango temporal del turno con margen de seguridad
            const start = new Date(shift.openedAt);
            const end = shift.closedAt ? new Date(shift.closedAt) : new Date();
            start.setMinutes(start.getMinutes() - 2); 
            end.setMinutes(end.getMinutes() + 2);

            // 2. Traer VENTAS de la nube para este turno específico
            const salesQuery = query(
                collection(db, `companies/${user.companyId}/sales`),
                where('date', '>=', start.toISOString()),
                where('date', '<=', end.toISOString()),
                where('userId', '==', shift.userId) // Clave: Ventas de ESTE usuario
            );

            // 3. Traer MOVIMIENTOS de caja de la nube
            const movsQuery = query(
                collection(db, `companies/${user.companyId}/cash_movements`),
                where('shiftId', '==', shift.id) // Clave: Movimientos con ESTE shiftId
            );

            const [salesSnap, movsSnap] = await Promise.all([
                getDocs(salesQuery),
                getDocs(movsQuery)
            ]);

            const salesToSync = salesSnap.docs.map(d => ({ ...d.data(), localId: d.id, syncStatus: 'synced' }));
            const movsToSync = movsSnap.docs.map(d => ({ ...d.data(), id: d.id, syncStatus: 'synced' }));

            // 4. Inyectar en Dexie (Solo lo que no esté o esté desactualizado)
            if (salesToSync.length > 0) await dbLocal.sales.bulkPut(salesToSync);
            if (movsToSync.length > 0) await dbLocal.cash_movements.bulkPut(movsToSync);

            // console.log(`✅ Auditoría Hidratada: ${salesToSync.length} ventas, ${movsToSync.length} movimientos.`);

        } catch (e) {
            console.warn("⚠️ Error hidratando auditoría (Se usaran datos locales):", e);
        }
    },

    async getShiftAuditData(shiftId) {
        const dbLocal = await getDB();
        
        // 1. Obtener datos básicos del turno
        const shift = await dbLocal.shifts.get(shiftId);
        if (!shift) throw new Error("Turno no encontrado");

        // 🔥 2. Hidratar datos (Cloud -> Dexie) ANTES de calcular
        await this._ensureAuditDataConsistency(shift, dbLocal);

        // 3. Transacción de Lectura y Cálculo
        return await dbLocal.transaction('r', [dbLocal.cash_movements, dbLocal.shifts, dbLocal.sales], async () => {
            
            // Recargar shift (por si la hidratación trajo actualizaciones)
            const freshShift = await dbLocal.shifts.get(shiftId);
            
            const openedAt = new Date(freshShift.openedAt).toISOString();
            const closedAt = freshShift.closedAt ? new Date(freshShift.closedAt).toISOString() : new Date().toISOString();

            // Filtro de Ventas: Por Fecha Y Usuario (Independiente de Branch para seguridad histórica)
            const shiftSales = await dbLocal.sales
                .where('date').between(openedAt, closedAt, true, true)
                .filter(s => {
                    const isValidStatus = s.status !== 'CANCELLED';
                    const isSameUser = s.userId === freshShift.userId;
                    // La sucursal es un filtro secundario, si coincide el usuario es suficiente propiedad
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
                expectedCash: Number(freshShift.initialAmount) || 0,
                totalDigital: 0,
                leftInCash: Number(freshShift.leftInCash) || 0,
                declaredCash: Number(freshShift.finalCash) || 0,
                withdrawn: Number(freshShift.withdrawn) || 0
            };

            const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

            // Procesar Ventas (Acumuladores)
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

            // Procesar Movimientos de Caja
            for (const m of allMovements) {
                const amount = Number(m.amount) || 0;
                const method = (m.method || 'unknown').toLowerCase();
                const isCash = method === 'cash';
                const description = (m.description || '').toLowerCase();
                const isClosingWithdrawal = m.subtype === 'CLOSING' || description.includes('rendición de cierre');

                if (isCash) {
                    if (m.type === 'SALE' || m.type === 'IN') {
                        audit.expectedCash += amount;
                    }
                    if (m.type === 'DEPOSIT') {
                        if (!description.includes('fondo inicial') && m.subtype !== 'OPENING') {
                            audit.expectedCash += amount;
                            audit.cashIn += amount; 
                        }
                    }
                    if (m.type === 'WITHDRAWAL' || m.type === 'EXPENSE') {
                        // FIX MATEMÁTICO: No restar el retiro de cierre
                        if (!isClosingWithdrawal) {
                            audit.expectedCash -= amount;
                            audit.cashOut += amount; 
                        }
                    }
                }
                
                if (m.type === 'DEPOSIT' && !description.includes('fondo inicial') && m.subtype !== 'OPENING') audit.totalExpenses += 0; 
                if (m.type === 'WITHDRAWAL' || m.type === 'EXPENSE') {
                     if (!isClosingWithdrawal) audit.totalWithdrawals += amount;
                }
            }

            audit.expectedCash = round2(audit.expectedCash);
            audit.totalSales = round2(audit.totalSales);
            audit.totalDigital = round2(audit.totalDigital);
            
            if (freshShift.status === 'OPEN') {
                audit.declaredCash = audit.expectedCash;
            }
            
            audit.deviation = round2(audit.declaredCash - audit.expectedCash);
            
            return audit;
        });
    }
};