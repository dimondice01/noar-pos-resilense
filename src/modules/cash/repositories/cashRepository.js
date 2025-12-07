// src/modules/cash/repositories/cashRepository.js

import { getDB } from '../../../database/db';
// Importación requerida para poder consultar ventas en el Reporte Z
import { salesRepository } from '../../sales/repositories/salesRepository'; 

// 💡 Nuevo: Clave de configuración para el PIN de IndexedDB 'config' (requiere DB v4)
const CASH_PIN_KEY = 'adminCashPin';

export const cashRepository = {
    
    // 1. Abrir Turno
    async openShift(initialAmount, userName) {
        const db = await getDB();
        
        const active = await this.getCurrentShift();
        if (active) throw new Error("Ya tienes un turno abierto.");

        const shift = {
            id: `shift_${Date.now()}`,
            userId: userName || 'Sistema',
            status: 'OPEN',
            openedAt: new Date(),
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

    // 2. Cerrar Turno (Cierre Ciego del Cajero)
    async closeShift(shiftId, closingData) {
        const db = await getDB();
        const shift = await db.get('shifts', shiftId);
        if (!shift) throw new Error("Turno no encontrado");

        const difference = closingData.declaredCash - closingData.expectedCash;

        const closedShift = {
            ...shift,
            status: 'CLOSED',
            closedAt: new Date(),
            finalCash: closingData.declaredCash,
            expectedCash: closingData.expectedCash,
            difference: difference,
            audited: false,
        };

        await db.put('shifts', closedShift);
        return closedShift;
    },
    
    // 3. Actualizar Turno (CRÍTICO: Usado por el Admin para setear audited: true)
    async updateShift(shift) {
        const db = await getDB();
        return db.put('shifts', shift);
    },

    // 4. Obtener Turno Activo
    async getCurrentShift() {
        const db = await getDB();
        const all = await db.getAll('shifts');
        return all.find(s => s.status === 'OPEN');
    },

    // 5. Obtener Todos
    async getAllShifts() {
        const db = await getDB();
        return await db.getAll('shifts');
    },

    // 6. Agregar Movimiento Genérico (Helper Interno)
    async addMovement(movement) {
        const db = await getDB();
        const newMov = {
            ...movement,
            id: `mov_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            date: new Date()
        };
        // Nota: El amount se guarda POSITIVO, la lógica de balance resta según el 'type'
        await db.put('cash_movements', newMov);
        return newMov;
    },

    // 7. Registrar INGRESO por Venta (Conecta POS -> Caja)
    async registerIncome(amount, method, description = 'Venta') {
        const shift = await this.getCurrentShift();
        if (!shift) throw new Error("⚠️ CAJA CERRADA: No se puede cobrar sin abrir turno.");

        return this.addMovement({
            shiftId: shift.id,
            type: 'SALE', 
            method: method, 
            amount: parseFloat(amount),
            description: description
        });
    },

    // 8. Registrar GASTO OPERATIVO (EXPENSE: Rests cash, Afecta P&L - Usado por Cajero)
    async registerExpense(amount, description, reference = '', user = 'Cajero') { // 💡 CRÍTICO: Modificado para registrar EXPENSE
        const shift = await this.getCurrentShift();
        if (!shift) throw new Error("Caja Cerrada: No se puede registrar un gasto sin turno abierto.");

        return this.addMovement({
            shiftId: shift.id,
            type: 'EXPENSE', // 💡 Nuevo Tipo de movimiento
            method: 'cash', 
            amount: parseFloat(amount),
            description: description,
            reference: reference, // Nro. de Boleta / Detalle
            user: user
        });
    },
    
    // 8.1. Registrar RETIRO DE FONDOS (WITHDRAWAL: Rests cash, NO Afecta P&L - Usado por Admin)
    async registerWithdrawal(amount, description, reference = '', user = 'Administrador') { // 💡 Nuevo
        const shift = await this.getCurrentShift();
        if (!shift) throw new Error("Caja Cerrada: No se puede registrar un retiro sin turno abierto.");

        return this.addMovement({
            shiftId: shift.id,
            type: 'WITHDRAWAL', // Tipo para retiros de gerencia
            method: 'cash', 
            amount: parseFloat(amount),
            description: description,
            reference: reference, 
            user: user
        });
    },

    // 10. CONFIGURACIÓN DEL PIN (Admin Security)
    async setAdminCashPin(pin) { // 💡 Nuevo
        const db = await getDB();
        // Guardamos en la nueva tabla 'config' (requiere DB v4)
        await db.put('config', { key: CASH_PIN_KEY, value: pin.toString() });
        console.log("✅ PIN de Administración de Caja guardado.");
    },

    // 11. OBTENER PIN
    async getAdminCashPin() { // 💡 Nuevo
        const db = await getDB();
        const config = await db.get('config', CASH_PIN_KEY);
        return config ? config.value : null;
    },

    // 12. MOTOR DE CÁLCULO (Balance en tiempo real - Usado por Cajero)
    async getShiftBalance(shiftId) { // 💡 Actualizado para EXPENSE
        const db = await getDB();
        const tx = db.transaction(['cash_movements', 'shifts'], 'readonly');
        
        const shift = await tx.objectStore('shifts').get(shiftId);
        const allMovements = await tx.objectStore('cash_movements').index('shiftId').getAll(shiftId);
        
        let balance = {
            initialAmount: Number(shift?.initialAmount) || 0, // FIX 1: Forzar a Number
            salesCash: 0,
            salesDigital: 0,
            withdrawals: 0,
            expenses: 0, // 💡 Nuevo contador
            deposits: 0,
            totalCash: 0,      
            totalDigital: 0,
            movements: allMovements.sort((a, b) => new Date(b.date) - new Date(a.date))
        };

        balance.totalCash = balance.initialAmount;

        for (const m of allMovements) {
            // 🔥 FIX CRÍTICO: Forzar a Number y fallback a 0.
            const amount = Number(m.amount) || 0; 
            const method = m.method || 'unknown'; 

            if (m.type === 'SALE') {
                const isDigitalKnown = method === 'mercadopago' || method === 'clover' || method === 'digitalother';
                
                if (method === 'cash' || !isDigitalKnown) { 
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
            } else if (m.type === 'EXPENSE') { // 💡 Nuevo: Resta de Cash
                balance.totalCash -= amount;
                balance.expenses += amount; // 💡 Conteo separado
            }
        }
        
        const round2 = (num) => Number(num.toFixed(2));
        balance.totalCash = round2(balance.totalCash);
        balance.salesCash = round2(balance.salesCash);
        balance.salesDigital = round2(balance.salesDigital);
        balance.withdrawals = round2(balance.withdrawals);
        balance.expenses = round2(balance.expenses); // 💡 Redondeo de Expenses
        balance.deposits = round2(balance.deposits);

        return balance;
    },
    
    // 13. MOTOR DE REPORTE Z / AUDITORÍA (Ticket Z - Usado por Admin)
    async getShiftAuditData(shiftId) { // 💡 Actualizado para EXPENSE y WITHDRAWAL
        const db = await getDB();
        const tx = db.transaction(['cash_movements', 'shifts', 'sales'], 'readonly'); 
        
        const shift = await tx.objectStore('shifts').get(shiftId);
        if (!shift) throw new Error("Turno no encontrado");

        const allMovements = await tx.objectStore('cash_movements').index('shiftId').getAll(shiftId);

        // --- Simulación de fetch de Ventas (para métricas AFIP) ---
        const allSales = await tx.objectStore('sales').getAll(); 
        const shiftSales = allSales.filter(s => {
            const saleDate = new Date(s.date).getTime();
            const openedAt = new Date(shift.openedAt).getTime();
            const closedAt = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now();
            return saleDate >= openedAt && saleDate <= closedAt;
        });
        // -----------------------------------------------------------

        let audit = {
            shiftId: shift.id,
            shiftName: shift.userId,
            startTime: shift.openedAt,
            closeTime: shift.closedAt || new Date(),
            initialAmount: shift.initialAmount, 
            totalSales: 0,
            salesCount: shiftSales.length,
            salesByMethod: { cash: 0, mercadopago: 0, clover: 0, digitalOther: 0 },
            cashIn: 0,
            cashOut: 0,
            totalExpenses: 0, // 💡 Nuevo contador
            totalWithdrawals: 0, // 💡 Nuevo contador
            expectedCash: Number(shift.initialAmount) || 0, // Inicia con el fondo inicial forzado a number
            totalDigital: 0,
            pendingAfip: 0,
            totalAfip: 0,
            lastCbte: 'N/A'
        };

        let lastAfipCbte = null;
        const round2 = (num) => Number(num.toFixed(2));

        // 5. Procesar Ventas y Movimientos
        for (const sale of shiftSales) {
            const total = parseFloat(sale.total) || 0;
            audit.totalSales += total;
            const method = sale.payment?.method; 
            
            if (!method) {
                audit.salesByMethod.digitalOther += total; 
            } else if (method === 'cash') {
                audit.salesByMethod.cash += total;
            } else if (method === 'mercadopago') {
                audit.salesByMethod.mercadopago += total;
            } else if (method === 'clover') {
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

        // 6. Procesar Movimientos de Caja (Calcula EXPECTED CASH)
        for (const m of allMovements) {
            // 🔥 FIX CRÍTICO: Forzar a Number y fallback a 0.
            const amount = Number(m.amount) || 0;
            const method = m.method || 'unknown'; 

            if (m.type === 'SALE') {
                const isDigitalKnown = method === 'mercadopago' || method === 'clover' || method === 'digitalother';
                
                if (method === 'cash' || !isDigitalKnown) { 
                    audit.expectedCash += amount;
                }
            } else if (m.type === 'DEPOSIT') {
                if (m.description !== 'Fondo Inicial de Caja') { 
                    audit.expectedCash += amount;
                    audit.cashIn += amount;
                }
            } else if (m.type === 'WITHDRAWAL') { // 💡 Retiros
                audit.expectedCash -= amount;
                audit.cashOut += amount; // CashOut incluye ambos
                audit.totalWithdrawals += amount;
            } else if (m.type === 'EXPENSE') { // 💡 Gastos Operativos
                audit.expectedCash -= amount;
                audit.cashOut += amount; // CashOut incluye ambos
                audit.totalExpenses += amount;
            }
        }

        // 7. Aplicar redondeo final a todas las métricas
        audit.expectedCash = round2(audit.expectedCash);
        audit.totalSales = round2(audit.totalSales);
        audit.totalDigital = round2(audit.totalDigital);
        audit.totalAfip = round2(audit.totalAfip);
        audit.cashIn = round2(audit.cashIn);
        audit.cashOut = round2(audit.cashOut);
        audit.totalExpenses = round2(audit.totalExpenses); // 💡 Redondeo de Expenses
        audit.totalWithdrawals = round2(audit.totalWithdrawals); // 💡 Redondeo de Withdrawals
        
        Object.keys(audit.salesByMethod).forEach(key => {
            audit.salesByMethod[key] = round2(audit.salesByMethod[key]);
        });

        // 8. Calcular Desvío Final (Usa el valor guardado en el shift si está cerrado)
        const declaredCash = shift.status === 'CLOSED' ? shift.finalCash : audit.expectedCash; 
        audit.actualCash = declaredCash;
        audit.deviation = round2(audit.actualCash - audit.expectedCash);
        
        return audit;
    }
};