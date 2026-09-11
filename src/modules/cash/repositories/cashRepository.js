import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, getDoc, collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { pushCashMovementWithShiftCounter, closeShiftAtomic } from '../services/shiftLedgerService';

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

        // 🔥 NUNCA adivinar la sucursal: un cajero siempre tiene user.branchId fijo,
        // y un OWNER/admin sin sucursal fija depende de que BranchSelector ya haya
        // resuelto activeBranchId. Si ninguno está seteado, antes esto caía en
        // 'main' silenciosamente — con más de una sucursal real, 'main' no matchea
        // ninguna y el registro queda huérfano (invisible en reportes). Mejor fallar
        // fuerte acá que perder de qué sucursal era una venta/movimiento de caja.
        const targetBranch = activeBranchId || user.branchId;
        if (!targetBranch) throw new Error("Error Crítico: No se pudo determinar la sucursal activa. Volvé a seleccionarla o recargá la página.");

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
        // 🔥 Índice compuesto [userId+status] — evita full-scan de shifts
        const activeInBranch = await dbLocal.shifts
            .where('[userId+status]').equals([user.uid, 'OPEN'])
            .filter(s => s.branchId === branchId)
            .first();

        if (activeInBranch) {
            // 🔥 FIX: antes esto confiaba ciegamente en Dexie local. Si el turno ya
            // se cerró en la nube (desde otro dispositivo, o un sync que no llegó a
            // bajar acá) pero esta compu nunca se enteró, el cajero quedaba sin
            // poder abrir uno nuevo — el síntoma real era "recurrir a otro
            // navegador" (Dexie vacío = sin el fantasma). Si hay internet,
            // verificamos contra la nube antes de confiar; si offline, seguimos
            // confiando en local como siempre (nunca bloquear por falta de red).
            if (navigator.onLine) {
                try {
                    const cloudSnap = await getDoc(doc(db, 'companies', user.companyId, 'shifts', String(activeInBranch.id)));
                    const cloudStatus = cloudSnap.exists() ? cloudSnap.data().status : null;
                    if (cloudStatus && cloudStatus !== 'OPEN') {
                        console.warn(`⚠️ Turno local "${activeInBranch.id}" figuraba OPEN pero la nube dice ${cloudStatus} — corrigiendo local y abriendo uno nuevo.`);
                        await dbLocal.shifts.update(activeInBranch.id, { status: cloudStatus, syncStatus: 'synced' });
                    } else {
                        console.log("⚠️ Turno ya abierto recuperado localmente (confirmado contra la nube):", activeInBranch.id);
                        return activeInBranch;
                    }
                } catch (e) {
                    console.warn("No se pudo verificar el turno contra la nube, confío en local:", e);
                    return activeInBranch;
                }
            } else {
                console.log("⚠️ Turno ya abierto recuperado localmente (offline, sin poder verificar):", activeInBranch.id);
                return activeInBranch;
            }
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

            // 🔥 CONTADOR ATÓMICO DE CAJA (ver shiftLedgerService) — arranca en cero,
            // se incrementa transaccionalmente en cada cash_movement, nunca se re-sube
            // completo (ver exclusión en _syncToCloud) para no pisar el valor del servidor.
            runningTotals: {
                cash: 0,
                digital: 0,
                byMethod: {},
                movementsCount: 0
            },

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
        this._pushCashMovement(initialMovement);

        return shift;
    },

    // =========================================
    // 🔴 GESTIÓN DE TURNO (CIERRE BLINDADO Z)
    // =========================================
    async closeShift(shiftId, closingData) {
        const dbLocal = await getDB();
        const shift = await dbLocal.shifts.get(shiftId);
        if (!shift) throw new Error("Turno no encontrado");
        if (shift.status === 'CLOSED') throw new Error("Este turno ya fue cerrado.");

        const { user } = useAuthStore.getState();
        
        if (shift.userId !== user?.uid && user?.role !== 'ADMIN' && user?.role !== 'OWNER') {
             throw new Error("No tienes permisos para cerrar esta caja.");
        }

        // 1. 🔥 CÁLCULO DE LA VERDAD (Expected Cash) — 100% LOCAL, instantáneo (rediseño
        // 2026-09-08). Ya no se descarga nada de la nube antes de cerrar: este turno es
        // de este dispositivo, todo lo que pasó ya está en Dexie. El contador remoto se
        // sigue leyendo (si ya está en `shift` local) solo para el aviso de drift, no
        // para calcular expectedCash — ver _calculateShiftState.
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
            closeAttemptId: generateGlobalId('close'), // 🔥 distingue "ya cerrado por otro" de "reintento propio"
            
            // Valores Finales
            finalCash: declared,      // Lo que dijo el cajero que hay
            leftInCash: left,         // Lo que deja para mañana
            withdrawn: withdrawn,     // Lo que se retira
            expectedCash: currentAudit.expectedCash, // Lo que el sistema dice que debería haber
            
            expectedDigital: parseFloat(closingData.expectedDigital || 0), // Referencia digital
            difference: difference,   // El veredicto del arqueo
            
            // 🔥 MARCADOR DE DISCREPANCIA (RESILIENCIA)
            discrepancyStatus: difference > 0 ? 'SURPLUS' : (difference < 0 ? 'SHORTAGE' : 'MATCH'),

            audited: false, 
            
            // 🔥🔥 SNAPSHOT CONGELADO (Evidence Locker) 🔥🔥
            auditSnapshot: {
                totalSales: currentAudit.totalSales,
                salesCount: currentAudit.salesCount,
                salesByMethod: currentAudit.salesByMethod, 
                
                manualIn: currentAudit.manualIn,   
                manualOut: currentAudit.manualOut,
                // 🔥 DETALLES INDIVIDUALES para Ticket Z
                manualInItems: currentAudit.manualInItems || [],
                manualOutItems: currentAudit.manualOutItems || [],
                
                digitalIn: currentAudit.digitalIn, 
                digitalInByMethod: currentAudit.digitalInByMethod, 
                
                cashIn: currentAudit.cashIn,
                cashOut: currentAudit.cashOut,
                
                totalExpenses: currentAudit.totalExpenses, 
                totalWithdrawals: currentAudit.totalWithdrawals,
                totalDigital: currentAudit.totalDigital,
                
                expectedCash: currentAudit.expectedCash,
                initialAmount: currentAudit.initialAmount,

                // 🔥 EVIDENCIA DE DRIFT: si el contador remoto (fuente de verdad) difirió
                // del detalle sumado localmente en este dispositivo, queda registrado acá
                // para siempre — esto es justo lo que hubiera evitado el incidente real.
                totalCashLocalCrossCheck: currentAudit.totalCashLocalCrossCheck,
                totalCashDrift: currentAudit.totalCashDrift,
                hasDriftWarning: currentAudit.hasDriftWarning,

                declaredCash: declared,
                leftInCash: left,
                difference: difference,

                // 🔥 Trazabilidad: si hubo que tildar el checkbox de "diferencia grande"
                // en CashClosingModal, queda registrado permanentemente acá.
                overrideConfirmed: !!closingData.overrideConfirmed,

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

        // 4. 🔥 Sync de pendientes del turno — EN SEGUNDO PLANO, no bloquea el cierre
        // (antes era un `for` secuencial con `await` uno por uno, ahí vivía la lentitud
        // real de "cerrar caja tarda". El ciclo de fondo de syncService (cada ~15s) ya
        // los toma solo, y con el fix de _shouldAttemptSync ninguno se abandona.)
        (async () => {
            try {
                const pendingMovs = await dbLocal.cash_movements
                    .where('shiftId').equals(shiftId)
                    .filter(m => m.syncStatus === 'pending')
                    .toArray();
                await Promise.all(pendingMovs.map(mov => this._pushCashMovement(mov)));
            } catch (e) {
                console.warn("⚠️ Error en sync de fondo post-cierre:", e);
            }
        })();

        // Sync Background del turno cerrado (atómico, vía transacción — ver _syncShiftCloseToCloud)
        this._syncShiftCloseToCloud(closedShift);
        if (withdrawalMovement) {
            this._pushCashMovement(withdrawalMovement);
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
    // 🔥 CIERRE ATÓMICO — SYNC ESPECÍFICO (BACKGROUND)
    // =========================================
    // No usa _syncToCloud genérico (setDoc plano): un cierre necesita
    // transacción para no pisar el cierre de otro dispositivo (last-write-wins).
    async _syncShiftCloseToCloud(closedShift) {
        if (!navigator.onLine) return; // offline: queda 'pending', lo retoma syncPendingShifts
        const { user } = useAuthStore.getState();
        if (!user?.companyId) return;
        try {
            const result = await closeShiftAtomic(user.companyId, closedShift.id, closedShift);
            const dbLocal = await getDB();
            if (result.won) {
                await dbLocal.shifts.update(closedShift.id, { syncStatus: 'synced', firestoreId: String(closedShift.id) });
            } else {
                // Perdimos la carrera: convergemos al cierre ganador remoto para no dejar
                // un auditSnapshot fantasma en este dispositivo.
                const winner = { ...result.remoteShift, id: closedShift.id, syncStatus: 'synced', firestoreId: String(closedShift.id) };
                await dbLocal.shifts.put(winner);
                console.warn('⚠️ Cierre en carrera: otro dispositivo cerró primero.', closedShift.id);
                window.dispatchEvent(new CustomEvent('noar:shift-close-conflict', { detail: { shiftId: closedShift.id, winner } }));
            }
        } catch (e) {
            console.warn('Sync start error (closeShift):', e); // queda 'pending' local, lo retoma syncPendingShifts
        }
    },

    // =========================================
    // 🔥 SYNC INTERNO (BACKGROUND)
    // =========================================
    async _syncToCloud(collectionName, data) {
        if (!navigator.onLine) return;
        const { user } = useAuthStore.getState();
        if (!user || !user.companyId) return;

        try {
            // 🔥 runningTotals SOLO se muta vía shiftLedgerService (transacción con increment()).
            // Si un objeto 'shift' local se re-sube acá con un runningTotals plano, PISA el valor
            // ya incrementado en el servidor (merge reemplaza el subcampo entero, no lo combina).
            const { syncStatus, localId, runningTotals, ...cloudData } = data;
            const path = `companies/${user.companyId}/${collectionName}`;
            
            // Forzamos String para evitar bugs de Firebase
            const cloudId = String(data.firestoreId || data.id);

            setDoc(doc(db, path, cloudId), {
                ...cloudData,
                firestoreId: cloudId,
                updatedAt: new Date().toISOString(),
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
    // 🔥 SYNC DE CASH_MOVEMENTS (CONTADOR ATÓMICO)
    // =========================================
    // Reemplaza _syncToCloud para 'cash_movements': escribe el movimiento y, si
    // corresponde, incrementa shifts/{shiftId}.runningTotals atómicamente (ver
    // shiftLedgerService). Idempotente frente a reintentos duplicados.
    async _pushCashMovement(movement) {
        if (!navigator.onLine) return;
        const { user } = useAuthStore.getState();
        if (!user || !user.companyId) return;

        try {
            await pushCashMovementWithShiftCounter(user.companyId, movement);
            const dbLocal = await getDB();
            await dbLocal.cash_movements.update(movement.id, { syncStatus: 'synced' });
        } catch (e) {
            console.warn('Background Sync Error (cash_movements):', e);
        }
    },

    // =========================================
    // 🔥 GETTERS Y UPDATERS (LOCAL FIRST)
    // =========================================
    async getCurrentShift() {
        const dbLocal = await getDB();
        const { user, branchId } = this._getContext();

        try {
            // 🔥 Índice compuesto [userId+status] — evita full-scan
            const openShifts = await dbLocal.shifts
                .where('[userId+status]').equals([user.uid, 'OPEN'])
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
        this._pushCashMovement(newMov);
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

    async registerExpense(amount, description, reference = '', user = 'Cajero', subtype = null) {
        const shift = await this.getCurrentShift();
        if (!shift) throw new Error("Caja Cerrada: No se puede registrar gasto.");

        return this.addMovement({
            shiftId: shift.id,
            branchId: shift.branchId,
            type: 'EXPENSE',
            subtype: subtype,
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

        // 2. Hidratación Cloud en background
        if ((user.role === 'ADMIN' || user.role === 'OWNER') && navigator.onLine) {
             this._fetchHistoryFromCloud(dbLocal, user).then(async () => {
                 // Silent update
             });
        }

        // 🔥 Consultas por índice — evita cargar toda la tabla de turnos
        let filteredShifts;
        if (user.role === 'ADMIN' || user.role === 'OWNER') {
            if (branchId && branchId !== 'main' && branchId !== 'ALL') {
                filteredShifts = await dbLocal.shifts.where('branchId').equals(branchId).toArray();
            } else {
                filteredShifts = await dbLocal.shifts.toArray();
            }
        } else {
            filteredShifts = await dbLocal.shifts.where('userId').equals(user.uid).toArray();
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
                const pendingSet = new Set(
                    (await dbLocal.shifts.where('syncStatus').equals('pending').toArray())
                        .map(s => String(s.id))
                );
                const safeShifts = cloudShifts.filter(s => !pendingSet.has(String(s.id)));
                if (safeShifts.length > 0) await dbLocal.shifts.bulkPut(safeShifts);
            }
        } catch (e) { console.warn("Background history sync warning:", e); }
    },

    // =========================================
    // ⚖️ BALANCE Y AUDITORÍA (EL CEREBRO DEL CIERRE Z BLINDADO)
    // =========================================
    
    async _calculateShiftState(shift, dbLocal) {
        if (!shift) return null;

        // 1. OBTENEMOS VENTAS REALES — 🔥 índice shiftId evita full-scan
        const sales = await dbLocal.sales
            .where('shiftId').equals(shift.id)
            .filter(s => s.status === 'COMPLETED' && s.type !== 'INTERNAL' && s.type !== 'BUDGET')
            .toArray();

        // 🔥 EL ESCUDO ANTI-DUPLICACIÓN: Guardamos los IDs de todas las ventas contadas
        const countedSalesIds = new Set(sales.map(s => s.id));

        // 2. OBTENEMOS MOVIMIENTOS DE CAJA — 🔥 índice shiftId
        const movements = await dbLocal.cash_movements
            .where('shiftId').equals(shift.id)
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
            // 🔥 LISTAS DETALLADAS para el Ticket Z
            manualInItems: [],   // [{ description, amount, type }]
            manualOutItems: [],  // [{ description, amount, type }]

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
            
            // 2. Ignoramos movimientos tipo SALE (ya contados arriba en la sección A)
            if (m.type === 'SALE' || m.subtype === 'SALE') return;

            const amount = Number(m.amount) || 0;
            const methodRaw = String(m.method || 'cash').toLowerCase().trim();
            const isCash = ['cash', 'efectivo'].includes(methodRaw);

            const isIncome = m.type === 'IN' || m.type === 'DEPOSIT' || m.type === 'RECEIPT';
            const isOutcome = m.type === 'OUT' || m.type === 'EXPENSE' || m.type === 'WITHDRAWAL' || m.type === 'PURCHASE' || m.type === 'REFUND';

            // 🔥 REGLA ANTI-DUPLICACIÓN (solo para INGRESOS): si este ingreso referencia una venta
            // que ya sumamos arriba, es un duplicado y lo ignoramos. NO aplica a egresos: un
            // reintegro/anulación usa referenceId solo para trazabilidad (apunta a la venta que
            // originó la devolución) y SIEMPRE debe descontarse de la caja, aunque esa venta
            // siga con status COMPLETED (handleAnular no lo cambia, solo marca afip.status VOIDED).
            if (isIncome && countedSalesIds.has(m.referenceId)) return;

            if (isIncome) {
                if (isCash) {
                    state.manualIn += amount;
                    // 🔥 Guardamos el item individual para el Ticket Z
                    state.manualInItems.push({
                        id: m.id,
                        description: m.description || 'Ingreso Efectivo',
                        amount,
                        type: m.type,
                        date: m.date
                    });
                } else {
                    state.digitalIn += amount;
                    if (['mercadopago', 'mp', 'qr'].includes(methodRaw)) state.digitalInByMethod.mercadopago += amount;
                    else if (['transfer', 'transferencia'].includes(methodRaw)) state.digitalInByMethod.transfer += amount;
                    else state.digitalInByMethod.digitalOther += amount;
                }
            } else if (isOutcome) {
                if (isCash) {
                    state.manualOut += amount;
                    // 🔥 Guardamos el item individual para el Ticket Z
                    state.manualOutItems.push({
                        id: m.id,
                        description: m.description || 'Gasto / Retiro',
                        amount,
                        type: m.type,
                        date: m.date
                    });
                }
            }
        });

        // C. CÁLCULO LOCAL — 🔥 FUENTE DE VERDAD de expectedCash (rediseño 2026-09-08).
        // Un turno es de UN cajero + UNA sucursal + UN dispositivo: todo lo que pasó
        // en este turno ya está completo acá, en Dexie, porque cada venta/movimiento
        // se escribe local primero, siempre. Antes se prefería el contador remoto
        // (runningTotals) como "verdad" — pero si un cash_movement nunca llega a
        // sincronizar (bug de reintentos, ver syncService._shouldAttemptSync), el
        // contador remoto queda de menos y el cierre reporta un "sobrante" falso con
        // plata real que el cajero sí tiene. Local nunca miente sobre lo que pasó acá.
        // Redondeo de seguridad para evitar bugs de coma flotante de JS
        const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
        const localTotalCash = round(state.initialAmount + state.salesCash + state.manualIn - state.manualOut);

        state.totalCash = localTotalCash;
        state.totalCashLocalCrossCheck = localTotalCash;
        state.totalCashDrift = 0;
        state.hasDriftWarning = false;

        // 🔥 CONTADOR ATÓMICO (shiftLedgerService): ya NO decide expectedCash — queda
        // como cross-check asíncrono. Si diverge de lo local, es señal de que hay
        // movimientos de OTRO dispositivo (turno compartido) o de sync pendiente —
        // se expone como aviso (hasDriftWarning) para que un admin lo revise, nunca
        // para sobreescribir el número que ve el cajero.
        if (shift?.runningTotals && typeof shift.runningTotals.cash === 'number') {
            const counterTotalCash = round(state.initialAmount + shift.runningTotals.cash);
            state.remoteCounterTotalCash = counterTotalCash;
            state.totalCashDrift = round(counterTotalCash - localTotalCash);
            state.hasDriftWarning = Math.abs(state.totalCashDrift) > 1; // tolerancia $1 por redondeo
        }

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
            
            // 🔥 UNIFICAMOS VISUALMENTE VENTAS Y MOVIMIENTOS — índices shiftId
            const sales = await dbLocal.sales
                .where('shiftId').equals(shiftId)
                .filter(s => s.status === 'COMPLETED' && s.type !== 'BUDGET' && s.type !== 'INTERNAL')
                .toArray();
            const countedSalesIds = new Set(sales.map(s => s.id));

            const movements = await dbLocal.cash_movements
                .where('shiftId').equals(shiftId)
                .toArray();
            
            let allOperations = [];

            // 🔥 PASO 1: FONDO INICIAL — aparece primero como ingreso para que la matemática sea visible
            const fondoMov = movements.find(m => m.subtype === 'OPENING' || m.description?.includes('Fondo Inicial'));
            if (fondoMov) {
                allOperations.push({
                    ...fondoMov,
                    type: 'DEPOSIT',           // Se renderiza como INGRESO en el componente
                    subtype: 'OPENING_SHOW',   // Marcador para que no se filtre
                    description: 'Fondo Inicial de Caja',
                    _isOpening: true
                });
            } else if (state.initialAmount > 0) {
                // Fallback: si el movimiento no se guardó, lo reconstruimos
                allOperations.push({
                    id: `${shiftId}_opening_virtual`,
                    type: 'DEPOSIT',
                    method: 'cash',
                    amount: state.initialAmount,
                    description: 'Fondo Inicial de Caja',
                    date: shift.openedAt,
                    _isOpening: true
                });
            }

            // PASO 2: Ventas (sin BUDGET ni INTERNAL)
            sales.forEach(s => {
                // 🔥 SPLIT: Mostrar cada método de pago como línea separada
                const isSplit = s.method === 'SPLIT' || (Array.isArray(s.payments) && s.payments.length > 1);
                if (isSplit && Array.isArray(s.payments) && s.payments.length > 1) {
                    s.payments.forEach((p, idx) => {
                        allOperations.push({
                            id: `${s.id}_p${idx}`,
                            type: 'SALE',
                            method: p.method || 'cash',
                            amount: Number(p.total || p.amount || 0),
                            description: `Venta ${s.ticketNumber || s.number || ''} (Combinado ${idx + 1}/${s.payments.length})`,
                            date: s.date || s.createdAt
                        });
                    });
                } else {
                    const method = s.payment?.method || s.method || s.paymentMethod || 'cash';
                    allOperations.push({
                        id: s.id, type: 'SALE', method: method, amount: s.total,
                        description: `Venta ${s.ticketNumber || s.number || ''}`,
                        date: s.date || s.createdAt
                    });
                }
            });

            // PASO 3: Movimientos manuales (gastos, retiros, ingresos, etc.)
            // Excluimos OPENING (ya lo mostramos arriba) y duplicados de ventas
            movements.forEach(m => {
                // Ya mostramos el fondo arriba
                if (m.subtype === 'OPENING' || m.description?.includes('Fondo Inicial')) return;
                // No duplicar ventas
                if (m.type === 'SALE' || m.subtype === 'SALE') return;
                // 🔥 El chequeo de duplicado por referenceId solo aplica a INGRESOS (un 'IN'/'DEPOSIT'
                // que redunda con una venta ya listada arriba). NO debe ocultar egresos como
                // anulaciones/reintegros, que usan referenceId solo para trazabilidad y son
                // movimientos reales que sí deben verse en el Ticket Z.
                if (['IN', 'DEPOSIT', 'RECEIPT'].includes(m.type) && countedSalesIds.has(m.referenceId)) return;
                // La Rendición de Cierre la mostramos al final con tipo especial
                if (m.subtype === 'CLOSING' || m.description?.toLowerCase().includes('rendición de cierre')) {
                    allOperations.push({ ...m, type: 'TREASURY', _isClosing: true });
                    return;
                }
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
                manualOut: state.manualOut,
                // 🔥 LISTAS DETALLADAS — FALTABAN AQUÍ (bug corregido)
                manualInItems: state.manualInItems || [],
                manualOutItems: state.manualOutItems || [],

                digitalIn: state.digitalIn,
                digitalInByMethod: state.digitalInByMethod, 
                
                cashIn: state.manualIn + state.salesCash, 
                cashOut: state.manualOut, 
                
                totalExpenses: 0, // Reemplazado por la suma unificada de manualOut
                totalWithdrawals: 0,
                totalDigital: state.totalDigital,
                
                expectedCash: state.totalCash, // 🔥 EL NÚMERO MÁGICO DE CAJA PERFECTO

                totalCashLocalCrossCheck: state.totalCashLocalCrossCheck,
                totalCashDrift: state.totalCashDrift,
                hasDriftWarning: state.hasDriftWarning,

                leftInCash: Number(shift.leftInCash) || 0,
                declaredCash: Number(shift.finalCash) || 0,
                withdrawn: Number(shift.withdrawn) || 0
            };
        });
    }
};

// 🔧 DEBUG: compara el auditSnapshot.totalSales que quedó CONGELADO al cerrar un turno
// (calculado en ese momento con datos LOCALES de la PC que cerró la caja — ver
// _calculateShiftState, lee dbLocal.sales) contra la suma real en la nube de las
// ventas de ese mismo shiftId AHORA MISMO. Si difieren, confirma que ese cierre se
// hizo con ventas del turno todavía sin sincronizar a esa PC. Solo lectura.
// Uso: window.__noarDebugShift('shift_xxxx') (ID completo) o
//      window.__noarDebugShift('f2ab6c') (sufijo de 6 chars, el mismo que muestra
//      la UI en "Auditoría Detallada... ID: xxxxxx" — busca entre los últimos 300
//      turnos el que termina así).
if (typeof window !== 'undefined') {
  window.__noarDebugShift = async (shiftIdOrSuffix) => {
    const { user } = useAuthStore.getState();
    const companyId = user?.companyId || user?.tenantId;
    if (!companyId) { console.warn('[debugShift] No hay companyId en sesión'); return; }

    const input = String(shiftIdOrSuffix);
    let shiftId = input;
    let shiftData = null;

    if (input.length <= 10) {
      // ID corto = el sufijo que muestra la UI (shift.id.slice(-6)). Buscamos entre
      // los turnos recientes de la empresa el que termina así.
      const recentSnap = await getDocs(query(
        collection(db, 'companies', companyId, 'shifts'),
        orderBy('closedAt', 'desc'),
        limit(300)
      ));
      const match = recentSnap.docs.find(d => d.id.endsWith(input));
      if (!match) {
        console.warn(`[debugShift] No encontré, entre los últimos 300 turnos cerrados, ninguno que termine en "${input}". Probá con el ID completo del documento.`);
        return;
      }
      shiftId = match.id;
      shiftData = match.data();
    } else {
      const shiftSnap = await getDoc(doc(db, 'companies', companyId, 'shifts', shiftId));
      if (!shiftSnap.exists()) { console.warn(`[debugShift] Turno ${shiftId} no existe en la nube`); return; }
      shiftData = shiftSnap.data();
    }

    const shift = shiftData;

    const salesRef = collection(db, 'companies', companyId, 'sales');
    const q = query(salesRef, where('shiftId', '==', String(shiftId)));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => d.data());
    const completed = docs.filter(s => s.status === 'COMPLETED' && s.type !== 'INTERNAL' && s.type !== 'BUDGET');
    const cloudTotal = completed.reduce((acc, s) => acc + (parseFloat(s.total) || 0), 0);
    const snapshotTotal = shift.auditSnapshot?.totalSales;

    // 🔥 LOCAL EN VIVO: lo que hay AHORA en el Dexie de ESTA máquina para ese shiftId,
    // ignorando el auditSnapshot congelado (que puede ser de otro momento/dispositivo).
    // Esto es lo que responde "¿cuánto tiene realmente esta PC ahora mismo?".
    const dbLocal = await getDB();
    const localSales = await dbLocal.sales.where('shiftId').equals(String(shiftId)).toArray();
    const localCompleted = localSales.filter(s => s.status === 'COMPLETED' && s.type !== 'INTERNAL' && s.type !== 'BUDGET');
    const localTotal = localCompleted.reduce((acc, s) => acc + (parseFloat(s.total) || 0), 0);
    const localShift = await dbLocal.shifts.get(String(shiftId));

    console.log(`[debugShift] Turno ${shiftId} — estado nube: ${shift.status}${localShift ? `, estado local: ${localShift.status}` : ' (sin registro local en esta PC)'}`);
    console.log(`[debugShift] LOCAL AHORA en esta PC (${localCompleted.length} ventas COMPLETED de ${localSales.length} con ese shiftId en Dexie):`, Number(localTotal.toFixed(2)));
    console.log(`[debugShift] NUBE AHORA (${completed.length} ventas COMPLETED de ${docs.length} con ese shiftId):`, Number(cloudTotal.toFixed(2)));
    console.log(`[debugShift] Diferencia (nube - local):`, Number((cloudTotal - localTotal).toFixed(2)));
    console.log(`[debugShift] (referencia) auditSnapshot.totalSales congelado al cerrar, ${shift.auditSnapshot?.salesCount ?? '?'} ventas contadas:`, snapshotTotal);

    // 🔎 Si hay menos ventas en la nube (por shiftId) que las que contó el cierre,
    // buscamos TODAS las ventas de esa sucursal en la ventana horaria del turno,
    // sin filtrar por shiftId — para ver si las que faltan existen con OTRO shiftId
    // (desfasaje de ID) o directamente no existen en la nube (pérdida real).
    if (shift.openedAt && shift.branchId) {
      const windowEnd = shift.closedAt || new Date().toISOString();
      const windowQ = query(
        salesRef,
        where('branchId', '==', shift.branchId),
        where('date', '>=', shift.openedAt),
        where('date', '<=', windowEnd)
      );
      const windowSnap = await getDocs(windowQ);
      const windowDocs = windowSnap.docs.map(d => d.data());
      const windowCompleted = windowDocs.filter(s => s.status === 'COMPLETED' && s.type !== 'INTERNAL' && s.type !== 'BUDGET');
      const otherShiftIds = new Set(windowCompleted.filter(s => s.shiftId !== String(shiftId)).map(s => s.shiftId));
      console.log(`[debugShift] Ventas COMPLETED de esa sucursal en la ventana horaria del turno (${shift.openedAt} → ${windowEnd}), SIN filtrar por shiftId: ${windowCompleted.length}`);
      if (windowCompleted.length > completed.length) {
        console.log(`[debugShift] ⚠️ Hay ${windowCompleted.length - completed.length} ventas más en esa ventana horaria que no tienen este shiftId. shiftId encontrados en esas ventas:`, Array.from(otherShiftIds));
        console.log('[debugShift] Esto sugiere desfasaje de shiftId, NO pérdida de ventas — revisar esos otros shiftId.');
      } else {
        console.log('[debugShift] No hay ventas extra en la ventana horaria — las 28 (o las que falten) NO están en la nube bajo ningún shiftId de esta sucursal en ese rango. Esto sugiere pérdida real de datos, no un desfasaje de ID.');
      }
    }

    if (typeof snapshotTotal === 'number') {
      console.log(`[debugShift] Diferencia (nube - cierre):`, Number((cloudTotal - snapshotTotal).toFixed(2)));
    } else {
      console.log('[debugShift] Este turno no tiene auditSnapshot.totalSales (¿sigue abierto?).');
    }

    return { localTotal, cloudTotal, snapshotTotal, salesCountLocal: localCompleted.length, salesCountCloud: completed.length, salesCountSnapshot: shift.auditSnapshot?.salesCount };
  };
}