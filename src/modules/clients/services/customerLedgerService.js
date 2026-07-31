import { doc, runTransaction, serverTimestamp, increment } from 'firebase/firestore';
import { db } from '../../../database/firebase';

// =================================================================
// 🔥 CUSTOMER LEDGER — Contador atómico de saldo de cliente
// =================================================================
// Módulo hoja: NO importar clientRepository / syncService desde acá
// (evita ciclos).
//
// Objetivo: que clients/{id}.balance nunca dependa de un read-then-write
// entre dispositivos. Cada movimiento de customer_ledger suma/resta,
// atómicamente y exactamente-una-vez, sobre clients/{clientId}.balance —
// mismo patrón que shiftLedgerService.js para shifts.runningTotals.

// Firestore rechaza valores `undefined`. Centralizado acá, mismo criterio
// que shiftLedgerService.js.
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

/**
 * Sube un movimiento de customer_ledger a Firestore e incrementa
 * atómicamente clients/{clientId}.balance en la MISMA transacción.
 * Idempotente: un mismo movimiento re-subido (reintento, doble dispositivo)
 * nunca incrementa dos veces, vía el marcador _appliedToBalance.
 *
 * Regla de signo (igual a la que ya usaba clientRepository.registerMovement
 * y a la que usa ClientDashboard.currentDebt): SALE_DEBT suma, cualquier
 * otro tipo (PAYMENT, REFUND, LIQUIDATION) resta.
 */
export async function pushLedgerMovementWithBalanceIncrement(companyId, movement) {
    if (!companyId || !movement?.id || !movement?.clientId) {
        throw new Error('pushLedgerMovementWithBalanceIncrement: faltan companyId, movement.id o movement.clientId');
    }

    const cleanMovement = sanitizeMovement(movement);
    const movId = String(movement.id);
    const movRef = doc(db, `companies/${companyId}/customer_ledger`, movId);
    const clientRef = doc(db, `companies/${companyId}/clients`, String(movement.clientId));
    const nowIso = new Date().toISOString();

    const amount = Number(movement.amount) || 0;
    const signedAmount = movement.type === 'SALE_DEBT' ? amount : -amount;

    const applied = await runTransaction(db, async (tx) => {
        // Única lectura necesaria (regla de Firestore transactions: reads antes que writes).
        const movSnap = await tx.get(movRef);
        const alreadyApplied = movSnap.exists() && movSnap.data()?._appliedToBalance === true;

        tx.set(movRef, {
            ...cleanMovement,
            firestoreId: movId,
            updatedAt: nowIso,
            syncedAt: nowIso,
            syncStatus: 'synced',
            _appliedToBalance: true
        }, { merge: true });

        if (alreadyApplied) return false;

        // tx.set + merge (no tx.update): funciona igual si clients/{id} ya
        // existe en Firestore o si todavía no llegó (cliente creado offline
        // sin cola de reintento — no existe syncPendingClients — y la venta
        // fiada se sincroniza antes que el alta del cliente).
        tx.set(clientRef, {
            balance: increment(signedAmount),
            updatedAt: serverTimestamp()
        }, { merge: true });

        return true;
    });

    return { applied };
}
