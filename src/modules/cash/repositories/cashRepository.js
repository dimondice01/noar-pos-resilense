// src/modules/cash/repositories/cashRepository.js

import { getDB } from '../../../database/db';

// 💡 Clave de configuración para el PIN de IndexedDB 'config'
const CASH_PIN_KEY = 'adminCashPin';

export const cashRepository = {
    
    // =========================================
    // 🟢 GESTIÓN DE TURNO (APERTURA)
    // =========================================
    async openShift(initialAmount, userName) {
        const db = await getDB();
        
        const active = await this.getCurrentShift();
        if (active) throw new Error("Ya tienes un turno abierto. Ciérralo antes de abrir otro.");

        const shift = {
            id: `shift_${Date.now()}`,
            userId: userName || 'Sistema',
            status: 'OPEN',
            openedAt: new Date().toISOString(), // Guardamos siempre en ISO
            initialAmount: parseFloat(initialAmount),
            expectedCash: 0,     
            finalCash: 0,       
            difference: 0,       
            audited: false
        };

        await db.put('shifts', shift);
        
        await this.addMovement({
            shiftId: shift.id,
            type: 'DEPOSIT', 
            method: 'cash',
            amount: parseFloat(initialAmount),
            description: 'Fondo Inicial de Caja'
        });

        return shift;
    },

    // =========================================
    // 🔴 GESTIÓN DE TURNO (CIERRE)
    // =========================================
    async closeShift(shiftId, closingData) {
        const db = await getDB();
        const shift = await db.get('shifts', shiftId);
        if (!shift) throw new Error("Turno no encontrado");

        const difference = closingData.declaredCash - closingData.expectedCash;

        const closedShift = {
            ...shift,
            status: 'CLOSED',
            closedAt: new Date().toISOString(),
            finalCash: parseFloat(closingData.declaredCash),
            expectedCash: parseFloat(closingData.expectedCash),
            difference: difference,
            audited: false,
        };

        await db.put('shifts', closedShift);
        return closedShift;
    },
    
    async updateShift(shift) {
        const db = await getDB();
        return db.put('shifts', shift);
    },

    async getCurrentShift() {
        const db = await getDB();
        const all = await db.getAll('shifts');
        return all.find(s => s.status === 'OPEN');
    },

    async getAllShifts() {
        const db = await getDB();
        return await db.getAll('shifts');
    },

    // =========================================
    // 💰 MOVIMIENTOS DE CAJA
    // =========================================
    async addMovement(movement) {
        const db = await getDB();
        const newMov = {
            ...movement,
            id: `mov_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            date: new Date().toISOString()
        };
        await db.put('cash_movements', newMov);
        return newMov;
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
    // 🔐 SEGURIDAD (PIN)
    // =========================================
    async setAdminCashPin(pin) {
        const db = await getDB();
        await db.put('config', { key: CASH_PIN_KEY, value: pin.toString() });
    },

    async getAdminCashPin() {
        const db = await getDB();
        const config = await db.get('config', CASH_PIN_KEY);
        return config ? config.value : null;
    },

    // =========================================
    // ⚖️ BALANCE EN TIEMPO REAL (Para el Cajero)
    // =========================================
    async getShiftBalance(shiftId) {
        const db = await getDB();
        const tx = db.transaction(['cash_movements', 'shifts'], 'readonly');
        
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

            // Normalización de método digital
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
        
        // Redondeo final
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
    // 🧾 MOTOR DE REPORTE Z (FIX CRÍTICO APLICADO)
    // =========================================
    async getShiftAuditData(shiftId) {
        const db = await getDB();
        const tx = db.transaction(['cash_movements', 'shifts', 'sales'], 'readonly'); 
        
        const shift = await tx.objectStore('shifts').get(shiftId);
        if (!shift) throw new Error("Turno no encontrado");

        const allMovements = await tx.objectStore('cash_movements').index('shiftId').getAll(shiftId);
        const allSales = await tx.objectStore('sales').getAll(); 

        // Definir límites de tiempo del turno
        const openedAt = new Date(shift.openedAt).getTime();
        const closedAt = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now();

        // 🔥 FILTRO CRÍTICO: Solo ventas dentro del rango de tiempo Y activas
        const shiftSales = allSales.filter(s => {
            const rawDate = s.date || s.createdAt; // Soporte legacy
            if (!rawDate) return false;

            const saleDate = new Date(rawDate).getTime();
            const isActive = s.status !== 'CANCELLED'; // Ignorar anuladas
            const isInRange = saleDate >= openedAt && saleDate <= closedAt;

            return isActive && isInRange;
        });

        console.log(`🔍 Auditoría Z: ${shiftSales.length} ventas encontradas para el turno.`);

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

        // 1. Procesar Ventas del Turno
        for (const sale of shiftSales) {
            const total = parseFloat(sale.total) || 0;
            audit.totalSales += total;
            
            // Normalización de método
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
            
            // Métricas AFIP
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

        // 2. Procesar Movimientos de Caja (Calcula EXPECTED CASH)
        for (const m of allMovements) {
            const amount = Number(m.amount) || 0;
            const method = (m.method || 'unknown').toLowerCase(); 

            // Detectar ventas en efectivo registradas como movimiento
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

        // 3. Redondeo Final
        audit.expectedCash = round2(audit.expectedCash);
        audit.totalSales = round2(audit.totalSales);
        audit.totalDigital = round2(audit.totalDigital);
        
        // 4. Calcular Desvío
        const declaredCash = shift.status === 'CLOSED' ? shift.finalCash : audit.expectedCash; 
        audit.actualCash = declaredCash;
        audit.deviation = round2(declaredCash - audit.expectedCash);
        
        return audit;
    }
};