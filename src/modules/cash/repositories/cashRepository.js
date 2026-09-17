import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, getDoc, collection, query, where, getDocs, limit, orderBy, onSnapshot } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { useShiftStore } from '../store/useShiftStore';
import { pushCashMovementWithShiftCounter, closeShiftAtomic } from '../services/shiftLedgerService';
import { syncService } from '../../sync/services/syncService';

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
                        this.watchForCloseRequests(activeInBranch);
                        return activeInBranch;
                    }
                } catch (e) {
                    console.warn("No se pudo verificar el turno contra la nube, confío en local:", e);
                    this.watchForCloseRequests(activeInBranch);
                    return activeInBranch;
                }
            } else {
                console.log("⚠️ Turno ya abierto recuperado localmente (offline, sin poder verificar):", activeInBranch.id);
                this.watchForCloseRequests(activeInBranch);
                return activeInBranch;
            }
        }

        // 1.5 🔥 FIX (blindaje multi-PC): si no hay nada local, puede ser porque OTRA
        // PC (mismo cajero, misma sucursal) ya abrió esta caja y el sync/listener de
        // este dispositivo todavía no bajó ese turno. Sin este chequeo se crea un
        // shiftId duplicado y las ventas quedan repartidas entre dos turnos distintos
        // (arqueo roto al cierre). Solo aplica cuando el chequeo local no encontró nada.
        if (!activeInBranch && navigator.onLine) {
            try {
                const remoteQ = query(
                    collection(db, 'companies', user.companyId, 'shifts'),
                    where('userId', '==', user.uid),
                    where('branchId', '==', branchId),
                    where('status', '==', 'OPEN'),
                    limit(1)
                );
                const remoteSnap = await getDocs(remoteQ);
                if (!remoteSnap.empty) {
                    const remoteDoc = remoteSnap.docs[0];
                    const remoteShift = { ...remoteDoc.data(), id: remoteDoc.id, syncStatus: 'synced' };
                    await dbLocal.shifts.put(remoteShift);
                    console.warn('⚠️ Turno ya abierto en otro dispositivo, adoptado localmente:', remoteShift.id);
                    this.watchForCloseRequests(remoteShift);
                    return remoteShift;
                }
            } catch (e) {
                console.warn('No se pudo verificar turno remoto antes de abrir, se continúa con creación local:', e);
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
        this.watchForCloseRequests(shift);

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

        // 0. 🔥 BLINDAJE MULTI-PC (CRÍTICO): local puede decir OPEN aunque la nube
        // ya lo haya cerrado hace rato (ej. otra PC ya cerró y fusionó este turno).
        // El listener real-time de shifts no siempre llega a tiempo (compara
        // `updatedAt` como Timestamp contra un campo que se escribe como string —
        // ver bug documentado). Sin este chequeo, el cajero re-cierra un turno YA
        // cerrado: vuelve a declarar el mismo efectivo, pisa el auditSnapshot
        // fusionado y quedan dos "cierres" para la misma plata física.
        if (navigator.onLine) {
            let cloudShiftData = null;
            try {
                const cloudSnap = await getDoc(doc(db, 'companies', shift.companyId, 'shifts', String(shiftId)));
                if (cloudSnap.exists()) cloudShiftData = cloudSnap.data();
            } catch (e) {
                console.warn('No se pudo verificar el turno contra la nube antes de cerrar, sigo con local:', e);
            }
            if (cloudShiftData?.status === 'CLOSED') {
                await dbLocal.shifts.put({ ...cloudShiftData, id: shiftId, syncStatus: 'synced' });
                throw new Error(cloudShiftData.mergedInto
                    ? '⚠️ Este turno ya fue cerrado (se fusionó con la otra caja al cerrarla desde el otro dispositivo). Recargá la página.'
                    : '⚠️ Este turno ya fue cerrado desde otro dispositivo. Recargá la página.');
            }
        }

        // 1. 🔥 FUSIÓN MULTI-PC: si hay un turno hermano OPEN (misma caja abierta en
        // 2 dispositivos por la carrera al abrir), le pedimos que fuerce el sync de
        // sus pendientes AHORA (handshake vía Firestore, ver _requestSiblingFlush)
        // y esperamos su confirmación con timeout antes de calcular. Después leemos
        // sus ventas/movimientos DIRECTO DE LA NUBE (no de Dexie local) para no
        // depender de que el listener de este dispositivo ya los haya bajado.
        const siblingShift = await this._findOpenSiblingShift(shift);
        if (siblingShift) {
            await this._requestSiblingFlush(siblingShift);
        }

        // 2. 🔥 CÁLCULO DE LA VERDAD (Expected Cash). Sin turno hermano, sigue siendo
        // 100% local/instantáneo (rediseño 2026-09-08): este turno es de este
        // dispositivo, todo lo que pasó ya está en Dexie. Con turno hermano, se suma
        // lo de la nube (recién forzado a subir arriba). El contador remoto
        // (runningTotals) se sigue leyendo solo para el aviso de drift, nunca para
        // calcular expectedCash — ver _calculateShiftState.
        const currentAudit = await this.getShiftAuditData(shiftId, siblingShift ? { siblingShift, freshSiblingFromCloud: true } : {});

        // 3. Datos declarados por el humano (lo que contaron)
        const declared = closingData.declaredCash ? parseFloat(closingData.declaredCash) : 0;
        const left = closingData.leftInCash ? parseFloat(closingData.leftInCash) : 0;

        // 4. Cálculos finales
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

                // 🔥 FUSIÓN MULTI-PC: si este cierre incluyó un turno hermano (misma
                // caja abierta por error en 2 dispositivos), queda registrado acá cuáles
                // IDs se fusionaron — el detalle de ventas/movimientos de ambos ya está
                // sumado arriba, esto es solo trazabilidad.
                mergedShiftIds: currentAudit.mergedShiftIds || null,

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

        // 5. 🔥 Sync de pendientes del turno — EN SEGUNDO PLANO, no bloquea el cierre
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

        // 🔥 FUSIÓN MULTI-PC: si getShiftAuditData detectó un turno hermano OPEN
        // (misma caja abierta por error en 2 dispositivos), lo cerramos también acá.
        // Sus ventas/movimientos YA fueron sumados arriba (ver _calculateShiftState) —
        // este turno hermano queda marcado CLOSED con total en $0 para no duplicar el
        // arqueo en los reportes: la plata real vive en el snapshot del turno principal.
        if (currentAudit.mergedShiftIds && currentAudit.siblingShift) {
            this._closeSiblingShift(currentAudit.siblingShift, shift.id, closedShift.closedAt);
        }

        return closedShift;
    },

    // Cierra en segundo plano el turno "hermano" fusionado al cerrar el principal.
    // No bloquea el cierre del cajero — si falla, queda como turno OPEN huérfano y
    // hay que cerrarlo a mano desde CashPage (admin), pero el arqueo del principal
    // ya quedó bien porque sus ventas ya fueron sumadas al calcular currentAudit.
    async _closeSiblingShift(siblingShift, primaryShiftId, closedAt) {
        const closedSibling = {
            ...siblingShift,
            status: 'CLOSED',
            closedAt,
            mergedInto: primaryShiftId,
            finalCash: 0,
            leftInCash: 0,
            withdrawn: 0,
            expectedCash: 0,
            difference: 0,
            discrepancyStatus: 'MATCH',
            audited: false,
            auditSnapshot: {
                mergedInto: primaryShiftId,
                note: 'Turno fusionado — ver arqueo completo en el turno principal.',
                generatedAt: new Date().toISOString()
            },
            syncStatus: 'pending'
        };

        try {
            const dbLocal = await getDB();
            await dbLocal.shifts.put(closedSibling);
        } catch (e) {
            console.warn('No se pudo cachear localmente el cierre del turno hermano:', e);
        }

        if (!navigator.onLine) return; // queda 'pending', lo retoma syncPendingShifts
        try {
            await setDoc(doc(db, 'companies', siblingShift.companyId, 'shifts', String(siblingShift.id)), closedSibling, { merge: true });
            const dbLocal = await getDB();
            await dbLocal.shifts.update(siblingShift.id, { syncStatus: 'synced' });
        } catch (e) {
            console.warn('Error cerrando turno hermano en la nube (queda pending):', e);
        }
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
            const found = activeInBranch || (openShifts.length > 0 ? openShifts[0] : null);

            // 🔥 Este es el punto de descubrimiento que usa casi toda la app
            // (Sidebar, PosPage, usePosController, dashboards) — armamos acá el
            // watcher de cierre fusionado sin importar por dónde se enteró el
            // dispositivo de que tiene un turno abierto.
            if (found) this.watchForCloseRequests(found);

            return found;

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
    
    // 🔥 FUSIÓN MULTI-PC: busca otro turno OPEN del mismo cajero+sucursal (nace de
    // la carrera al abrir caja casi simultáneo en 2 dispositivos). Solo lectura,
    // requiere conexión. No migra ningún dato, solo permite sumar ambos al cerrar.
    async _findOpenSiblingShift(shift) {
        if (!navigator.onLine || !shift?.companyId || !shift?.branchId || !shift?.userId) return null;
        try {
            const siblingQ = query(
                collection(db, 'companies', shift.companyId, 'shifts'),
                where('userId', '==', shift.userId),
                where('branchId', '==', shift.branchId),
                where('status', '==', 'OPEN'),
                limit(5)
            );
            const snap = await getDocs(siblingQ);
            const siblingDoc = snap.docs.find(d => d.id !== String(shift.id));
            if (!siblingDoc) return null;
            return { ...siblingDoc.data(), id: siblingDoc.id };
        } catch (e) {
            console.warn('No se pudo verificar turno hermano (fusión multi-PC):', e);
            return null;
        }
    },

    // 🔥 FUSIÓN MULTI-PC: ventas del turno hermano DIRECTO DE LA NUBE. Solo se usa
    // en el cierre real (post-handshake) — el listener real-time de sales SÍ
    // funciona bien (filtra por updatedAt con Timestamp consistente), así que en
    // la vista previa alcanza con lo que ya haya en Dexie; acá solo evitamos el
    // último tramo de latencia justo en el momento crítico del cierre.
    async _fetchSiblingSalesFromCloud(siblingShift) {
        const toIso = (v) => (v && typeof v.toDate === 'function') ? v.toDate().toISOString() : v;
        try {
            const salesQ = query(collection(db, 'companies', siblingShift.companyId, 'sales'), where('shiftId', '==', String(siblingShift.id)));
            const salesSnap = await getDocs(salesQ);
            return salesSnap.docs.map(d => { const data = d.data(); return { ...data, id: d.id, date: toIso(data.date), createdAt: toIso(data.createdAt) }; });
        } catch (e) {
            console.warn('No se pudo leer ventas del turno hermano desde la nube, sigo solo con lo que haya local:', e);
            return [];
        }
    },

    // 🔥 FUSIÓN MULTI-PC: movimientos de caja del turno hermano, SIEMPRE directo
    // de la nube (no solo al cerrar). A diferencia de ventas, el listener
    // real-time de cash_movements (syncService.js) y su delta-sync filtran por
    // `date` comparándolo como Timestamp, pero el campo se escribe como string
    // ISO (mismo bug ya conocido en este proyecto para sales/movements de
    // inventario, nunca corregido acá) — así que un movimiento manual de OTRO
    // dispositivo NUNCA baja a Dexie local por esa vía, no es un tema de timing.
    // Sin esto, un ingreso/gasto/retiro cargado en la otra PC quedaría afuera del
    // arqueo fusionado siempre, no solo "a veces".
    async _fetchSiblingMovementsFromCloud(siblingShift) {
        const toIso = (v) => (v && typeof v.toDate === 'function') ? v.toDate().toISOString() : v;
        try {
            const movsQ = query(collection(db, 'companies', siblingShift.companyId, 'cash_movements'), where('shiftId', '==', String(siblingShift.id)));
            const movsSnap = await getDocs(movsQ);
            return movsSnap.docs.map(d => { const data = d.data(); return { ...data, id: d.id, date: toIso(data.date) }; });
        } catch (e) {
            console.warn('No se pudo leer movimientos del turno hermano desde la nube, sigo solo con lo que haya local:', e);
            return [];
        }
    },

    // 🔥 FUSIÓN MULTI-PC: resuelve TODO lo que necesita red (turno hermano + sus
    // ventas/movimientos) ANTES de tocar Dexie. CRÍTICO: nunca llamar esto (ni
    // nada que haga getDocs/setDoc) desde ADENTRO de un dbLocal.transaction() —
    // Dexie corta la transacción en cuanto detecta una promesa no-Dexie de por
    // medio (un fetch de red), y cualquier operación de Dexie que venga después
    // tira "TransactionInactiveError: Transaction has already completed or
    // failed" (bug real, reproducido 2026-09-15 al cerrar turno). Por eso
    // getShiftBalance/getShiftAuditData resuelven esto ANTES de abrir su
    // transacción de lectura, y _calculateShiftState ya no hace ninguna llamada
    // de red — solo consume lo que le llega acá ya resuelto.
    async _resolveSiblingContext(shift, opts = {}) {
        if (!shift || shift.status !== 'OPEN') return { siblingShift: null, siblingSales: null, siblingMovements: null };

        const siblingShift = opts.siblingShift !== undefined ? opts.siblingShift : await this._findOpenSiblingShift(shift);
        if (!siblingShift) return { siblingShift: null, siblingSales: null, siblingMovements: null };

        // Ventas: solo se releen de la nube en el cierre real (post-handshake) —
        // en la vista previa, `null` le indica a quien consuma esto que use Dexie.
        const siblingSales = opts.freshSiblingFromCloud ? await this._fetchSiblingSalesFromCloud(siblingShift) : null;

        // Movimientos: siempre de la nube (bug de sync ya documentado arriba).
        const siblingMovements = await this._fetchSiblingMovementsFromCloud(siblingShift);

        return { siblingShift, siblingSales, siblingMovements };
    },

    // 🔥 HANDSHAKE DE CIERRE FUSIONADO: le avisa al turno hermano (vía su propio
    // documento en Firestore, que ese dispositivo ya escucha en tiempo real) que
    // están por cerrarlo, para que fuerce YA el sync de sus pendientes en vez de
    // esperar el ciclo de fondo (~15s). Espera una confirmación corta con timeout
    // — si no llega (esa PC está offline/cerrada), sigue igual: la lectura directa
    // a la nube de todas formas toma lo que ya haya alcanzado a subir.
    async _requestSiblingFlush(siblingShift, timeoutMs = 6000) {
        const requestId = generateGlobalId('closereq');
        try {
            const siblingRef = doc(db, 'companies', siblingShift.companyId, 'shifts', String(siblingShift.id));
            await setDoc(siblingRef, { closeRequestId: requestId }, { merge: true });

            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                await new Promise(r => setTimeout(r, 700));
                const snap = await getDoc(siblingRef);
                if (snap.exists() && snap.data().closeRequestAckId === requestId) {
                    return true; // confirmado: la otra PC ya forzó su sync
                }
            }
            console.warn('⚠️ Turno hermano no confirmó el flush a tiempo (posible offline) — cierro igual con lo que haya en la nube.');
            return false;
        } catch (e) {
            console.warn('No se pudo pedir flush al turno hermano:', e);
            return false;
        }
    },

    // 🔥 LADO RECEPTOR del handshake: se activa sola desde openShift() y
    // getCurrentShift() (cualquier punto donde este dispositivo confirma que
    // tiene un turno abierto) y escucha SU PROPIO documento de turno. Si otro
    // dispositivo pide cerrar (closeRequestId nuevo), fuerza el sync de todo lo
    // pendiente de esta PC y confirma. No bloquea nada de la venta normal.
    watchForCloseRequests(shift) {
        if (!shift?.companyId || !shift?.id) return;
        if (this._watchedShiftId === shift.id) return; // ya escuchando este mismo turno
        // Turno distinto al que veníamos escuchando (ej. se cerró y se abrió uno
        // nuevo sin recargar la página) — soltamos el listener viejo primero.
        if (this._closeRequestUnsub) {
            try { this._closeRequestUnsub(); } catch (e) { console.warn('Error liberando watcher de close-request anterior:', e); }
        }
        this._watchedShiftId = shift.id;
        this._lastAckedCloseRequestId = null;
        try {
            const shiftRef = doc(db, 'companies', shift.companyId, 'shifts', String(shift.id));
            this._closeRequestUnsub = onSnapshot(shiftRef, async (snap) => {
                if (!snap.exists()) return;
                const data = snap.data();

                // 🔥 FIX (reactividad multi-PC): si este turno ya se cerró — acá mismo
                // o fusionado desde la otra PC — la UI de este dispositivo (Sidebar,
                // POS) lee `activeShift` de useShiftStore, que NO se entera solo. El
                // listener genérico de shifts (syncService.js) no sirve de red de
                // seguridad para esto porque compara `updatedAt` como Timestamp contra
                // un campo que se escribe como string (bug ya documentado) — nunca
                // llega. Este listener puntual (documento propio, sin filtro de fecha)
                // no tiene ese problema, así que lo usamos también para esto: limpiar
                // el turno en RAM apenas se detecta el cierre, sin esperar a que el
                // cajero navegue a otra pantalla.
                if (data.status !== 'OPEN') {
                    if (useShiftStore.getState().activeShift?.id === shift.id) {
                        console.log('🔔 Este turno se cerró (fusionado o desde otro dispositivo) — actualizando UI.');
                        useShiftStore.getState().clearShift();
                    }
                    try { this._closeRequestUnsub(); } catch (e) { console.warn('Error liberando watcher tras detectar cierre:', e); }
                    this._closeRequestUnsub = null;
                    this._watchedShiftId = null;
                    return;
                }

                const reqId = data.closeRequestId;
                if (!reqId || reqId === this._lastAckedCloseRequestId) return;
                this._lastAckedCloseRequestId = reqId; // marcar antes del await, evita doble disparo
                console.log('🔔 El turno hermano está por cerrar — forzando sync de pendientes...');
                try { await syncService.syncAll(); } catch (e) { console.warn('Error forzando sync por close-request:', e); }
                try {
                    await setDoc(shiftRef, { closeRequestAckId: reqId, closeRequestAckAt: new Date().toISOString() }, { merge: true });
                } catch (e) {
                    console.warn('No se pudo confirmar (ack) el close-request:', e);
                }
            });
        } catch (e) {
            console.warn('No se pudo activar el watcher de close-request:', e);
        }
    },

    // siblingContext viene YA RESUELTO por _resolveSiblingContext (llamado antes
    // de abrir cualquier transacción de Dexie, ver comentario ahí). Esta función
    // no hace ninguna llamada de red — solo Dexie, para poder correr adentro de
    // un dbLocal.transaction() sin cortarlo.
    async _calculateShiftState(shift, dbLocal, siblingContext = {}) {
        if (!shift) return null;

        const { siblingShift = null, siblingSales = null, siblingMovements = null } = siblingContext;

        // 🔥 FUSIÓN MULTI-PC (blindaje "misma caja en 2 PCs"): si hay un turno
        // hermano OPEN del mismo cajero+sucursal, lo sumamos acá. NO migramos el
        // shiftId de ninguna venta — solo sumamos sus datos.
        let initialAmount = Number(shift.initialAmount) || 0;
        if (siblingShift) {
            // 🔥 Mismo fondo declarado en los dos = el cajero cargó el mismo
            // efectivo físico dos veces (un solo cajón real, apertura duplicada
            // por la carrera). Ahí NO se suma, se usa un solo fondo. Si son
            // distintos, sí son dos cajones reales y corresponde sumarlos.
            const siblingInitial = Number(siblingShift.initialAmount) || 0;
            initialAmount = (siblingInitial === initialAmount)
                ? initialAmount
                : initialAmount + siblingInitial;
            // Cacheamos localmente para trazabilidad (debugShift, historial, etc.)
            try {
                await dbLocal.shifts.put({ ...siblingShift, syncStatus: 'synced' });
            } catch (e) {
                console.warn('No se pudo cachear turno hermano localmente:', e);
            }
        }

        const saleIsValid = s => s.status === 'COMPLETED' && s.type !== 'INTERNAL' && s.type !== 'BUDGET';

        // 1. OBTENEMOS VENTAS REALES — 🔥 índice shiftId evita full-scan
        const sales = await dbLocal.sales
            .where('shiftId').equals(shift.id)
            .filter(saleIsValid)
            .toArray();

        // 2. OBTENEMOS MOVIMIENTOS DE CAJA — 🔥 índice shiftId
        const movements = await dbLocal.cash_movements
            .where('shiftId').equals(shift.id)
            .toArray();

        // 🔥 Datos del turno hermano (ya resueltos por _resolveSiblingContext):
        // - Ventas: si `siblingSales` viene null (vista previa), leemos Dexie local
        //   (el listener real-time de sales funciona bien, alcanza y sobra). Si
        //   viene un array (cierre real, post-handshake), son las de la nube.
        // - Movimientos: siempre los que resolvió _resolveSiblingContext (nube).
        if (siblingShift) {
            if (siblingSales) {
                sales.push(...siblingSales.filter(saleIsValid));
            } else {
                const localSiblingSales = await dbLocal.sales.where('shiftId').equals(siblingShift.id).filter(saleIsValid).toArray();
                sales.push(...localSiblingSales);
            }
            movements.push(...(siblingMovements || []));
        }

        // 🔥 EL ESCUDO ANTI-DUPLICACIÓN: Guardamos los IDs de todas las ventas contadas
        const countedSalesIds = new Set(sales.map(s => s.id));

        let state = {
            initialAmount,
            mergedShiftIds: siblingShift ? [shift.id, siblingShift.id] : null,
            siblingShift,

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
        const shift = await dbLocal.shifts.get(shiftId);
        if (!shift) return { totalCash: 0, movements: [] };

        // 🔥 Resolvemos la fusión multi-PC ANTES de la transacción de Dexie — ver
        // _resolveSiblingContext (nunca red adentro de un transaction()).
        const siblingContext = await this._resolveSiblingContext(shift);
        const saleIsValidForList = s => s.status === 'COMPLETED' && s.type !== 'BUDGET' && s.type !== 'INTERNAL';

        return await dbLocal.transaction('r', [dbLocal.cash_movements, dbLocal.shifts, dbLocal.sales], async () => {
            const state = await this._calculateShiftState(shift, dbLocal, siblingContext);

            // 🔥 UNIFICAMOS VISUALMENTE VENTAS Y MOVIMIENTOS — índices shiftId
            const sales = await dbLocal.sales
                .where('shiftId').equals(shiftId)
                .filter(saleIsValidForList)
                .toArray();

            const movements = await dbLocal.cash_movements
                .where('shiftId').equals(shiftId)
                .toArray();

            // 🔥 FUSIÓN MULTI-PC: sumamos también al listado visual (Ticket Z /
            // Auditoría Detallada) — antes solo se sumaban a los TOTALES en
            // _calculateShiftState, el detalle de operaciones no incluía al hermano.
            if (siblingContext.siblingShift) {
                if (siblingContext.siblingSales) {
                    sales.push(...siblingContext.siblingSales.filter(saleIsValidForList));
                } else {
                    const localSiblingSales = await dbLocal.sales
                        .where('shiftId').equals(siblingContext.siblingShift.id)
                        .filter(saleIsValidForList)
                        .toArray();
                    sales.push(...localSiblingSales);
                }
                if (siblingContext.siblingMovements) movements.push(...siblingContext.siblingMovements);
            }

            const countedSalesIds = new Set(sales.map(s => s.id));

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
    // opts.siblingShift / opts.freshSiblingFromCloud: usados por closeShift para
    // forzar la lectura del turno hermano directo de la nube (post-handshake).
    async getShiftAuditData(shiftId, opts = {}) {
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

        // 🔥 Resolvemos la fusión multi-PC ANTES de la transacción de Dexie — ver
        // _resolveSiblingContext (nunca red adentro de un transaction()).
        const siblingContext = await this._resolveSiblingContext(shift, opts);

        // Si está ABIERTO, recalculamos en vivo
        return await dbLocal.transaction('r', [dbLocal.cash_movements, dbLocal.shifts, dbLocal.sales], async () => {
            const state = await this._calculateShiftState(shift, dbLocal, siblingContext);

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

                // 🔥 FUSIÓN MULTI-PC: si hay un turno hermano OPEN, viaja acá para que
                // closeShift lo pueda cerrar también y la UI avise "ambos turnos".
                mergedShiftIds: state.mergedShiftIds,
                siblingShift: state.siblingShift,

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

  // 🔧 DEBUG: dispara EXACTAMENTE la consulta que usa la fusión multi-PC
  // (_findOpenSiblingShift) — userId + branchId + status sobre `shifts` — con la
  // sesión actual. Si falta el índice compuesto, Firestore tira acá mismo el
  // error con el link para crearlo con un clic. Si ya existe, solo informa
  // cuántos turnos OPEN hay para este usuario/sucursal. Solo lectura.
  // Uso: window.__noarForceSiblingIndex()
  window.__noarForceSiblingIndex = async () => {
    const { user, activeBranchId } = useAuthStore.getState();
    const companyId = user?.companyId;
    const branchId = activeBranchId || user?.branchId;
    if (!companyId || !branchId) { console.warn('[forceSiblingIndex] Falta companyId o branchId en la sesión actual.'); return; }
    try {
      const q = query(
        collection(db, 'companies', companyId, 'shifts'),
        where('userId', '==', user.uid),
        where('branchId', '==', branchId),
        where('status', '==', 'OPEN'),
        limit(5)
      );
      const snap = await getDocs(q);
      console.log(`[forceSiblingIndex] ✅ El índice ya existe. ${snap.size} turno(s) OPEN encontrados para este usuario/sucursal.`);
    } catch (e) {
      console.error('[forceSiblingIndex] Si falta el índice, el link para crearlo está en este error 👇', e);
    }
  };
}