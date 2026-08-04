import { doc, runTransaction, setDoc, serverTimestamp, increment } from 'firebase/firestore';
import { db } from '../../../database/firebase';

// =================================================================
// 🔥 SHIFT LEDGER — Contador atómico de caja (runningTotals)
// =================================================================
// Módulo hoja: NO importar cashRepository / salesRepository / syncService
// desde acá (evita ciclos, ver salesRepository -> cashRepository).
//
// Objetivo: que el "esperado" de un turno no dependa de qué filas de
// cash_movements tiene replicadas localmente el dispositivo que cierra
// la caja. Cada cash_movement que afecta caja física suma/resta,
// atómicamente y exactamente-una-vez, sobre shifts/{shiftId}.runningTotals.

const CLOSED_SUBTYPES = ['OPENING', 'CLOSING'];
const EXCLUDED_METHODS = ['account', 'debt', 'employee_account', 'current_account', 'budget'];
const INCOME_TYPES = ['IN', 'DEPOSIT', 'RECEIPT'];
const OUTCOME_TYPES = ['OUT', 'EXPENSE', 'WITHDRAWAL', 'PURCHASE', 'REFUND'];

// Firestore rechaza valores `undefined` (a diferencia de `null`, que sí acepta).
// Los 3+ call sites que alimentan este módulo no siempre pre-sanitizan, así que
// se hace acá una vez, centralizado, para todos.
function stripUndefined(value) {
    if (Array.isArray(value)) return value.map(stripUndefined);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k, stripUndefined(v)])
        );
    }
    return value;
}

function sanitizeMovement(movement) {
    // eslint-disable-next-line no-unused-vars
    const { syncStatus, syncRetries, localId, id, ...clean } = movement;
    return stripUndefined(clean);
}

// Decide si este movimiento debe impactar runningTotals, y con qué signo/bucket.
// Debe reflejar EXACTAMENTE las mismas exclusiones que cashRepository._calculateShiftState
// aplica sobre cash_movements, para que el contador remoto y el detalle local no diverjan.
function resolveCounting(movement) {
    const amount = Number(movement.amount) || 0;
    const method = String(movement.method || 'cash').toLowerCase().trim();
    const subtype = movement.subtype;
    const type = movement.type;

    if (!movement.shiftId) return { shouldCount: false };
    if (CLOSED_SUBTYPES.includes(subtype)) return { shouldCount: false };
    if (EXCLUDED_METHODS.includes(method)) return { shouldCount: false };
    if (amount <= 0) return { shouldCount: false };

    let sign = 0;
    if (INCOME_TYPES.includes(type)) sign = 1;
    else if (OUTCOME_TYPES.includes(type)) sign = -1;
    else return { shouldCount: false }; // tipo desconocido: no se cuenta (igual que hoy en _calculateShiftState)

    const isCash = ['cash', 'efectivo'].includes(method);
    return { shouldCount: true, isCash, method, signedAmount: sign * amount };
}

/**
 * Sube un cash_movement a Firestore y, si corresponde, incrementa
 * atómicamente shifts/{shiftId}.runningTotals en la MISMA transacción.
 * Idempotente: un mismo movimiento re-subido (reintento, doble dispositivo)
 * nunca incrementa dos veces, vía el marcador _countedInShift.
 */
export async function pushCashMovementWithShiftCounter(companyId, movement) {
    if (!companyId || !movement?.id) {
        throw new Error('pushCashMovementWithShiftCounter: faltan companyId o movement.id');
    }

    const cleanMovement = sanitizeMovement(movement);
    const movId = String(movement.id);
    const movRef = doc(db, `companies/${companyId}/cash_movements`, movId);
    const nowIso = new Date().toISOString();
    const counting = resolveCounting(movement);

    // Sin turno asociado, o el movimiento no impacta caja física: escritura simple.
    if (!movement.shiftId || !counting.shouldCount) {
        await setDoc(movRef, {
            ...cleanMovement,
            firestoreId: movId,
            updatedAt: nowIso,
            syncedAt: nowIso,
            syncStatus: 'synced'
        }, { merge: true });
        return { counted: false };
    }

    const shiftRef = doc(db, `companies/${companyId}/shifts`, String(movement.shiftId));

    const counted = await runTransaction(db, async (tx) => {
        // Todas las lecturas primero (regla de Firestore transactions).
        const movSnap = await tx.get(movRef);
        const shiftSnap = await tx.get(shiftRef);
        const alreadyCounted = movSnap.exists() && movSnap.data()?._countedInShift === true;

        tx.set(movRef, {
            ...cleanMovement,
            firestoreId: movId,
            updatedAt: nowIso,
            syncedAt: nowIso,
            syncStatus: 'synced',
            _countedInShift: true
        }, { merge: true });

        if (alreadyCounted) return false;

        const bucket = counting.isCash ? 'cash' : 'digital';

        if (shiftSnap.exists()) {
            tx.update(shiftRef, {
                [`runningTotals.${bucket}`]: increment(counting.signedAmount),
                [`runningTotals.byMethod.${counting.method}`]: increment(counting.signedAmount),
                'runningTotals.movementsCount': increment(1),
                'runningTotals.lastUpdatedAt': serverTimestamp()
            });
        } else {
            // Turno todavía no replicado en Firestore (carrera con openShift):
            // creamos el doc parcial; openShift lo completa después con merge
            // sin pisar este campo (ver exclusión de runningTotals en _syncToCloud).
            tx.set(shiftRef, {
                runningTotals: {
                    cash: bucket === 'cash' ? counting.signedAmount : 0,
                    digital: bucket === 'digital' ? counting.signedAmount : 0,
                    byMethod: { [counting.method]: counting.signedAmount },
                    movementsCount: 1,
                    lastUpdatedAt: serverTimestamp()
                }
            }, { merge: true });
        }

        return true;
    });

    return { counted };
}

/**
 * Cierra un turno de forma atómica e idempotente vía transacción Firestore.
 * Si otro dispositivo ya cerró este turno primero, NO lo pisa (evita el
 * last-write-wins de un setDoc plano) — devuelve { won:false, remoteShift }
 * para que el caller converja su Dexie local al cierre real.
 * `closedShiftPayload.closeAttemptId` distingue "ya cerrado por otro" de
 * "reintento de mi propio cierre" (mismo dispositivo, offline -> online).
 */
export async function closeShiftAtomic(companyId, shiftId, closedShiftPayload) {
    if (!companyId || !shiftId) {
        throw new Error('closeShiftAtomic: faltan companyId o shiftId');
    }

    const shiftRef = doc(db, `companies/${companyId}/shifts`, String(shiftId));
    // eslint-disable-next-line no-unused-vars
    const { syncStatus, syncRetries, localId, id, runningTotals, ...cleanShift } = closedShiftPayload;
    const nowIso = new Date().toISOString();

    return await runTransaction(db, async (tx) => {
        // Única lectura antes de cualquier escritura (regla de Firestore transactions).
        const snap = await tx.get(shiftRef);

        const remoteAlreadyClosed = snap.exists() && snap.data()?.status === 'CLOSED';
        const isOurOwnRetry = remoteAlreadyClosed && snap.data()?.closeAttemptId === closedShiftPayload.closeAttemptId;

        if (remoteAlreadyClosed && !isOurOwnRetry) {
            // Otro dispositivo cerró primero. No pisamos su cierre.
            return { won: false, remoteShift: snap.data() };
        }

        tx.set(shiftRef, {
            ...stripUndefined(cleanShift),
            firestoreId: String(shiftId),
            updatedAt: nowIso,
            syncedAt: nowIso,
            syncStatus: 'synced'
        }, { merge: true });

        return { won: true };
    });
}
