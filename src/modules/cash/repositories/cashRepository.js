import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

// Helper para IDs únicos consistentes (Local + Nube)
const generateId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

export const cashRepository = {
    
    // =========================================
    // 🟢 GESTIÓN DE TURNO (APERTURA)
    // =========================================
    async openShift(initialAmount, userName) {
        const dbLocal = await getDB();
        
        const active = await this.getCurrentShift();
        if (active) throw new Error("Ya tienes un turno abierto. Ciérralo antes de abrir otro.");

        const shift = {
            id: generateId('shift'), // ID robusto
            userId: userName || 'Sistema',
            status: 'OPEN',
            openedAt: new Date().toISOString(),
            initialAmount: parseFloat(initialAmount),
            expectedCash: 0,     
            finalCash: 0,       
            difference: 0,       
            audited: false,
            syncStatus: 'PENDING' // 🔥 Marcamos para sincronizar
        };

        // 1. Guardar Local (Prioridad Absoluta)
        await dbLocal.put('shifts', shift);
        
        // 2. Movimiento Inicial (Fondo de Caja)
        await this.addMovement({
            shiftId: shift.id,
            type: 'DEPOSIT', 
            method: 'cash',
            amount: parseFloat(initialAmount),
            description: 'Fondo Inicial de Caja'
        });

        // 3. ☁️ Intentar subir a Nube (Background)
        this._syncToCloud('shifts', shift);

        return shift;
    },

    // =========================================
    // 🔴 GESTIÓN DE TURNO (CIERRE)
    // =========================================
    async closeShift(shiftId, closingData) {
        const dbLocal = await getDB();
        const shift = await dbLocal.get('shifts', shiftId);
        if (!shift) throw new Error("Turno no encontrado");

        const difference = closingData.declaredCash - closingData.expectedCash;

        const closedShift = {
            ...shift,
            status: 'CLOSED',
            closedAt: new Date().toISOString(),
            finalCash: parseFloat(closingData.declaredCash),
            expectedCash: parseFloat(closingData.expectedCash),
            expectedDigital: parseFloat(closingData.expectedDigital || 0), // Guardamos total digital también
            difference: difference,
            audited: false,
            syncStatus: 'PENDING'
        };

        // 1. Actualizar Local
        await dbLocal.put('shifts', closedShift);

        // 2. ☁️ Subir Cierre a Nube
        this._syncToCloud('shifts', closedShift);

        return closedShift;
    },
    
    // Método auxiliar para actualizar (ej: Auditoría)
    async updateShift(shiftData) {
        const dbLocal = await getDB();
        await dbLocal.put('shifts', { ...shiftData, syncStatus: 'PENDING' });
        this._syncToCloud('shifts', shiftData);
        return shiftData;
    },

    async getCurrentShift() {
        const dbLocal = await getDB();
        const all = await dbLocal.getAll('shifts');
        return all.find(s => s.status === 'OPEN');
    },

    async getAllShifts() {
        const dbLocal = await getDB();
        return await dbLocal.getAll('shifts');
    },

    // =========================================
    // 💰 MOVIMIENTOS DE CAJA (CLOUD ENABLED)
    // =========================================
    async addMovement(movement) {
        const dbLocal = await getDB();
        const newMov = {
            id: generateId('mov'),
            ...movement,
            date: new Date().toISOString(),
            syncStatus: 'PENDING'
        };

        // 1. Guardar Local
        await dbLocal.put('cash_movements', newMov);

        // 2. ☁️ Subir a Nube
        this._syncToCloud('cash_movements', newMov);

        return newMov;
    },

    // Helper privado para subir sin bloquear la UI
    async _syncToCloud(collectionName, data) {
        if (!navigator.onLine) return; // Si offline, lo agarra el syncService después
        
        try {
            const { syncStatus, ...cloudData } = data;
            // Usamos setDoc con el mismo ID para mantener consistencia
            await setDoc(doc(db, collectionName, data.id), {
                ...cloudData,
                firestoreId: data.id,
                syncedAt: new Date().toISOString()
            }, { merge: true });

            // Si subió éxito, marcamos local como SYNCED
            const dbLocal = await getDB();
            await dbLocal.put(collectionName, { ...data, syncStatus: 'SYNCED' });
            
        } catch (e) {
            console.warn(`⚠️ Error subiendo ${collectionName} (se reintentará):`, e);
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
    // 🧹 LIMPIEZA DE CÓDIGO (PIN OBSOLETO)
    // =========================================
    // Eliminamos setAdminCashPin y getAdminCashPin 
    // porque ahora usamos securityService para todo.

    // =========================================
    // ⚖️ BALANCE EN TIEMPO REAL (Para el Cajero)
    // =========================================
    async getShiftBalance(shiftId) {
        const dbLocal = await getDB();
        const tx = dbLocal.transaction(['cash_movements', 'shifts'], 'readonly');
        
        const shift = await tx.objectStore('shifts').get(shiftId);
        const allMovements = await tx.objectStore('cash_movements').index('shiftId').getAll(shiftId);
        
        let balance = {
            initialAmount: Number(shift?.initialAmount) || 0,
            salesCash: 0,
            salesDigital: 0,
            withdrawals: 0,
            expenses: 0,
            deposits: 0,
            totalCash: 0,      
            totalDigital: 0,
            movements: allMovements.sort((a, b) => new Date(b.date) - new Date(a.date))
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
    },
    
    // =========================================
    // 🧾 MOTOR DE REPORTE Z
    // =========================================
    async getShiftAuditData(shiftId) {
        const dbLocal = await getDB();
        const tx = dbLocal.transaction(['cash_movements', 'shifts', 'sales'], 'readonly'); 
        
        const shift = await tx.objectStore('shifts').get(shiftId);
        if (!shift) throw new Error("Turno no encontrado");

        const allMovements = await tx.objectStore('cash_movements').index('shiftId').getAll(shiftId);
        const allSales = await tx.objectStore('sales').getAll(); 

        const openedAt = new Date(shift.openedAt).getTime();
        const closedAt = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now();

        const shiftSales = allSales.filter(s => {
            const rawDate = s.date || s.createdAt;
            if (!rawDate) return false;
            const saleDate = new Date(rawDate).getTime();
            const isActive = s.status !== 'CANCELLED';
            const isInRange = saleDate >= openedAt && saleDate <= closedAt;
            return isActive && isInRange;
        });

        let audit = {
            shiftId: shift.id,
            shiftName: shift.userId,
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

        // 1. Procesar Ventas
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

        // 2. Procesar Movimientos
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
    }
};