import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore'; // 🔑 IMPORTANTE

// Helper para IDs únicos consistentes
const generateId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

export const cashRepository = {
    
    // =========================================
    // 🟢 GESTIÓN DE TURNO (APERTURA)
    // =========================================
    async openShift(initialAmount, userName) {
        const { user } = useAuthStore.getState(); // 🔥 Acceso directo al usuario actual
        if (!user) throw new Error("No hay usuario autenticado");

        const dbLocal = await getDB();
        
        const active = await this.getCurrentShift();
        if (active) throw new Error("Ya tienes un turno abierto. Ciérralo antes de abrir otro.");

        const shift = {
            id: generateId('shift'),
            userId: user.uid, // 🔥 Guardamos UID para filtrar después
            userEmail: user.email, // Backup visual
            userName: userName || user.name || 'Cajero',
            companyId: user.companyId, // Para separar empresas
            status: 'OPEN',
            openedAt: new Date().toISOString(),
            initialAmount: parseFloat(initialAmount),
            expectedCash: 0,     
            finalCash: 0,       
            difference: 0,       
            audited: false,
            syncStatus: 'PENDING' 
        };

        // 1. Guardar Local
        await dbLocal.put('shifts', shift);
        
        // 2. Movimiento Inicial
        await this.addMovement({
            shiftId: shift.id,
            type: 'DEPOSIT', 
            method: 'cash',
            amount: parseFloat(initialAmount),
            description: 'Fondo Inicial de Caja'
        });

        // 3. ☁️ Subir a Nube
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

        // Validación de Propiedad
        const { user } = useAuthStore.getState();
        if (shift.userId !== user?.uid && user?.role !== 'ADMIN') {
             throw new Error("No puedes cerrar la caja de otro usuario.");
        }

        const difference = closingData.declaredCash - closingData.expectedCash;

        const closedShift = {
            ...shift,
            status: 'CLOSED',
            closedAt: new Date().toISOString(),
            finalCash: parseFloat(closingData.declaredCash),
            expectedCash: parseFloat(closingData.expectedCash),
            expectedDigital: parseFloat(closingData.expectedDigital || 0),
            difference: difference,
            audited: false,
            syncStatus: 'PENDING'
        };

        await dbLocal.put('shifts', closedShift);
        this._syncToCloud('shifts', closedShift);

        return closedShift;
    },
    
    // Método auxiliar
    async updateShift(shiftData) {
        const dbLocal = await getDB();
        await dbLocal.put('shifts', { ...shiftData, syncStatus: 'PENDING' });
        this._syncToCloud('shifts', shiftData);
        return shiftData;
    },

    // 🔥 BLINDAJE: Solo devuelve turnos del usuario actual
    async getCurrentShift() {
        const { user } = useAuthStore.getState();
        if (!user) return null;

        const dbLocal = await getDB();
        const all = await dbLocal.getAll('shifts');
        
        // Filtramos en memoria (IndexedDB es rápido, no problem)
        return all.find(s => s.status === 'OPEN' && s.userId === user.uid);
    },

    // 🔥 BLINDAJE: Solo devuelve historial del usuario actual (salvo Admin)
    async getAllShifts() {
        const { user } = useAuthStore.getState();
        if (!user) return [];

        const dbLocal = await getDB();
        const all = await dbLocal.getAll('shifts');

        if (user.role === 'ADMIN') {
            // Admin ve todo lo de su empresa
            return all.filter(s => s.companyId === user.companyId);
        } else {
            // Cajero solo ve lo suyo
            return all.filter(s => s.userId === user.uid);
        }
    },

    // =========================================
    // 💰 MOVIMIENTOS DE CAJA
    // =========================================
    async addMovement(movement) {
        const { user } = useAuthStore.getState();
        const dbLocal = await getDB();
        
        const newMov = {
            id: generateId('mov'),
            ...movement,
            userId: user?.uid, // Trazabilidad
            companyId: user?.companyId,
            date: new Date().toISOString(),
            syncStatus: 'PENDING'
        };

        await dbLocal.put('cash_movements', newMov);
        this._syncToCloud('cash_movements', newMov);

        return newMov;
    },

    // ... (El resto de _syncToCloud se mantiene igual, está perfecto)
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
                syncedAt: new Date().toISOString()
            }, { merge: true });

            const dbLocal = await getDB();
            await dbLocal.put(collectionName, { ...data, syncStatus: 'SYNCED' });
            
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
    // ⚖️ BALANCE (Sin cambios lógicos, solo usa métodos blindados)
    // =========================================
    async getShiftBalance(shiftId) {
        const dbLocal = await getDB();
        const tx = dbLocal.transaction(['cash_movements', 'shifts'], 'readonly');
        
        const shift = await tx.objectStore('shifts').get(shiftId);
        
        // Validación extra de seguridad
        const { user } = useAuthStore.getState();
        if (shift.userId !== user?.uid && user?.role !== 'ADMIN') {
             // Si intenta ver el balance de otro y no es admin, devolvemos vacío o error
             console.warn("Intento de acceso no autorizado a balance ajeno");
             return { totalCash: 0, movements: [] };
        }

        const allMovements = await tx.objectStore('cash_movements').index('shiftId').getAll(shiftId);
        
        // ... (El resto del cálculo matemático se mantiene idéntico) ...
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
    
    // ... (getShiftAuditData se mantiene igual, confiando en que el ID ya fue validado antes de llamar)
    async getShiftAuditData(shiftId) {
        // ... (Tu código existente)
        const dbLocal = await getDB();
        const tx = dbLocal.transaction(['cash_movements', 'shifts', 'sales'], 'readonly'); 
        
        const shift = await tx.objectStore('shifts').get(shiftId);
        if (!shift) throw new Error("Turno no encontrado");

        const allMovements = await tx.objectStore('cash_movements').index('shiftId').getAll(shiftId);
        const allSales = await tx.objectStore('sales').getAll(); 

        const openedAt = new Date(shift.openedAt).getTime();
        const closedAt = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now();

        // Filtramos ventas por tiempo y usuario (DOBLE SEGURIDAD)
        const shiftSales = allSales.filter(s => {
            const rawDate = s.date || s.createdAt;
            if (!rawDate) return false;
            const saleDate = new Date(rawDate).getTime();
            const isActive = s.status !== 'CANCELLED';
            const isInRange = saleDate >= openedAt && saleDate <= closedAt;
            // 🔥 Asegurar que la venta corresponda a la caja/usuario del turno
            // (Opcional si confías en el rango de tiempo, pero mejor prevenir)
            const isSameUser = (s.userId === shift.userId) || (s.createdBy === shift.userEmail); 
            
            return isActive && isInRange && isSameUser;
        });

        // ... (Resto del cálculo de auditoría idéntico al que me pasaste) ...
        let audit = {
            shiftId: shift.id,
            shiftName: shift.userName || shift.userId, // Mejor mostrar nombre
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