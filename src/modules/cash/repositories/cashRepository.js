import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore'; 

// Helper para IDs únicos consistentes
const generateId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

export const cashRepository = {
    
    // =========================================
    // 🟢 GESTIÓN DE TURNO (APERTURA)
    // =========================================
    async openShift(initialAmount, userName) {
        const { user } = useAuthStore.getState();
        if (!user) throw new Error("No hay usuario autenticado");

        const dbLocal = await getDB();
        
        // Check for existing open shift for THIS user
        const active = await this.getCurrentShift();
        if (active) throw new Error("Ya tienes un turno abierto. Ciérralo antes de abrir otro.");

        const shift = {
            id: generateId('shift'),
            userId: user.uid,
            userEmail: user.email,
            userName: userName || user.name || 'Cajero',
            companyId: user.companyId,
            status: 'OPEN',
            openedAt: new Date().toISOString(),
            initialAmount: parseFloat(initialAmount),
            expectedCash: 0,     
            finalCash: 0,       
            difference: 0,       
            audited: false,
            syncStatus: 'pending' 
        };

        // Transaction: Create Shift + Initial Movement
        await dbLocal.transaction('rw', [dbLocal.shifts, dbLocal.cash_movements], async () => {
            await dbLocal.shifts.put(shift);
            
            await this._addMovementLocal(dbLocal, {
                shiftId: shift.id,
                type: 'DEPOSIT', 
                method: 'cash',
                amount: parseFloat(initialAmount),
                description: 'Fondo Inicial de Caja'
            }, user);
        });

        // 3. ☁️ Subir a Nube (Optimista)
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

        // Validación de Propiedad
        const { user } = useAuthStore.getState();
        if (shift.userId !== user?.uid && user?.role !== 'ADMIN') {
             throw new Error("No puedes cerrar la caja de otro usuario.");
        }

        const difference = parseFloat(closingData.declaredCash) - parseFloat(closingData.expectedCash);

        const closedShift = {
            ...shift,
            status: 'CLOSED',
            closedAt: new Date().toISOString(),
            finalCash: parseFloat(closingData.declaredCash),
            expectedCash: parseFloat(closingData.expectedCash),
            expectedDigital: parseFloat(closingData.expectedDigital || 0),
            difference: difference,
            audited: false,
            syncStatus: 'pending'
        };

        await dbLocal.shifts.put(closedShift);
        this._syncToCloud('shifts', closedShift);

        return closedShift;
    },
    
    // Método auxiliar
    async updateShift(shiftData) {
        const dbLocal = await getDB();
        const updated = { ...shiftData, syncStatus: 'pending' };
        await dbLocal.shifts.put(updated);
        this._syncToCloud('shifts', updated);
        return updated;
    },

    // 🔥 BLINDAJE: Solo devuelve turnos del usuario actual
    async getCurrentShift() {
        const { user } = useAuthStore.getState();
        if (!user) return null;

        const dbLocal = await getDB();
        
        // Dexie optimization: find in memory is fast enough for single record search
        return await dbLocal.shifts
            .where('status').equals('OPEN')
            .filter(s => s.userId === user.uid)
            .first();
    },

    // 🔥 BLINDAJE: Solo devuelve historial del usuario actual (salvo Admin)
    async getAllShifts() {
        const { user } = useAuthStore.getState();
        if (!user) return [];

        const dbLocal = await getDB();

        if (user.role === 'ADMIN') {
            // Admin can see everything, sorted by date desc
            return await dbLocal.shifts.reverse().toArray();
        } else {
            // Cashier only sees their own
            return await dbLocal.shifts
                .where('userId').equals(user.uid)
                .reverse()
                .toArray();
        }
    },

    // 🔥 NUEVO: Obtener TODAS las cajas activas (Para Dashboard de Admin)
    async getAllActiveShifts() {
        const dbLocal = await getDB();
        return await dbLocal.shifts
            .where('status').equals('OPEN')
            .toArray();
    },

    // =========================================
    // 💰 MOVIMIENTOS DE CAJA
    // =========================================
    
    // Internal helper to reuse logic inside transactions
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
        // Sync trigger must be outside if possible, but for simplicity we call it here 
        // (it won't block transaction completion)
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

            // Fire and forget
            setDoc(doc(db, path, data.id), {
                ...cloudData,
                firestoreId: data.id,
                syncedAt: new Date().toISOString(),
                syncStatus: 'synced'
            }, { merge: true }).then(async () => {
                // Update local status on success
                try {
                    const dbLocal = await getDB();
                    // Dynamic table access
                    const table = collectionName === 'shifts' ? dbLocal.shifts : dbLocal.cash_movements;
                    await table.update(data.id, { syncStatus: 'synced' });
                } catch (e) { /* ignore */ }
            });
            
        } catch (e) {
            console.warn(`⚠️ Error subiendo ${collectionName}:`, e);
        }
    },

    async registerIncome(amount, method, description = 'Venta') {
        const shift = await this.getCurrentShift();
        if (!shift) throw new Error("⚠️ CAJA CERRADA: Abra turno para cobrar.");

        return this.addMovement({
            shiftId: shift.id,
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
            type: 'EXPENSE',
            method: 'cash', 
            amount: parseFloat(amount),
            description: description,
            reference: reference,
            user: user
        });
    },
    
    async registerWithdrawal(amount, description, reference = '', user = 'Administrador') {
        const shift = await this.getCurrentShift();
        if (!shift) throw new Error("Caja Cerrada: No se puede registrar retiro.");

        return this.addMovement({
            shiftId: shift.id,
            type: 'WITHDRAWAL',
            method: 'cash', 
            amount: parseFloat(amount),
            description: description,
            reference: reference, 
            user: user
        });
    },

    // =========================================
    // ⚖️ BALANCE (Dexie Optimized)
    // =========================================
    async getShiftBalance(shiftId) {
        const dbLocal = await getDB();
        const { user } = useAuthStore.getState();

        return await dbLocal.transaction('r', [dbLocal.cash_movements, dbLocal.shifts], async () => {
            const shift = await dbLocal.shifts.get(shiftId);
            
            if (shift.userId !== user?.uid && user?.role !== 'ADMIN') {
                 console.warn("Intento de acceso no autorizado a balance ajeno");
                 return { totalCash: 0, movements: [] };
            }

            // Index 'shiftId' is crucial here
            const allMovements = await dbLocal.cash_movements
                .where('shiftId')
                .equals(shiftId)
                .reverse() // Sort by date desc (implicit because ID usually correlates or insertion order)
                .toArray();
            
            // Re-sort to be absolutely sure about date order
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
                const isDigitalKnown = method.includes('mercado') || method.includes('clover') || method.includes('card') || method === 'point';

                if (m.type === 'SALE') {
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
        
        // Transaction across 3 tables for consistent snapshot
        return await dbLocal.transaction('r', [dbLocal.cash_movements, dbLocal.shifts, dbLocal.sales], async () => {
            const shift = await dbLocal.shifts.get(shiftId);
            if (!shift) throw new Error("Turno no encontrado");

            const allMovements = await dbLocal.cash_movements.where('shiftId').equals(shiftId).toArray();
            
            const openedAt = new Date(shift.openedAt).getTime();
            const closedAt = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now();

            // Filter sales by date range and user using Dexie
            // Optimized: We fetch sales in the date range first
            const shiftSales = await dbLocal.sales
                .where('date')
                .between(new Date(openedAt).toISOString(), new Date(closedAt).toISOString(), true, true)
                .filter(s => {
                    const isActive = s.status !== 'CANCELLED';
                    // Extra security check for ownership
                    const isSameUser = (s.userId === shift.userId) || (s.createdBy === shift.userEmail); 
                    return isActive && isSameUser;
                })
                .toArray();

            let audit = {
                shiftId: shift.id,
                shiftName: shift.userName || shift.userId,
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
                pendingAfip: 0,
                totalAfip: 0,
                lastCbte: 'N/A'
            };

            let lastAfipCbte = null;
            const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

            // Process Sales
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
                
                if (sale.afip?.status === 'APPROVED') {
                    audit.totalAfip += total;
                    if (!lastAfipCbte || sale.afip.cbteNumero > lastAfipCbte.cbteNumero) {
                        lastAfipCbte = sale.afip;
                    }
                } else if (sale.afip?.status === 'PENDING') {
                    audit.pendingAfip += 1;
                }
            }
            
            audit.totalDigital = audit.salesByMethod.mercadopago + audit.salesByMethod.clover + audit.salesByMethod.digitalOther;
            
            if (lastAfipCbte) {
                audit.lastCbte = `FC-${lastAfipCbte.cbteLetra} ${String(lastAfipCbte.cbteNumero).padStart(5, '0')}`;
            }

            // Process Cash Movements
            for (const m of allMovements) {
                const amount = Number(m.amount) || 0;
                const method = (m.method || 'unknown').toLowerCase(); 

                if (m.type === 'SALE') {
                    const isDigitalKnown = method.includes('mercado') || method.includes('clover') || method.includes('card');
                    if ((method === 'cash' || !isDigitalKnown) && !m.isVirtual) { 
                        audit.expectedCash += amount;
                    }
                } else if (m.type === 'DEPOSIT') {
                    if (m.description !== 'Fondo Inicial de Caja') { 
                        audit.expectedCash += amount;
                        audit.cashIn += amount;
                    }
                } else if (m.type === 'WITHDRAWAL') {
                    audit.expectedCash -= amount;
                    audit.cashOut += amount;
                    audit.totalWithdrawals += amount;
                } else if (m.type === 'EXPENSE') {
                    audit.expectedCash -= amount;
                    audit.cashOut += amount;
                    audit.totalExpenses += amount;
                }
            }

            audit.expectedCash = round2(audit.expectedCash);
            audit.totalSales = round2(audit.totalSales);
            audit.totalDigital = round2(audit.totalDigital);
            
            const declaredCash = shift.status === 'CLOSED' ? shift.finalCash : audit.expectedCash; 
            audit.actualCash = declaredCash;
            audit.deviation = round2(declaredCash - audit.expectedCash);
            
            return audit;
        });
    }
};