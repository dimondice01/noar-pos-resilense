import { doc, runTransaction, serverTimestamp, increment } from 'firebase/firestore';
import { db } from '../../../database/firebase';

// =================================================================
// 🔥 SUPPLIER LEDGER — Contador atómico de saldo de proveedor
// =================================================================
// Mismo patrón que customerLedgerService.js (clientes) y
// shiftLedgerService.js (caja): suppliers/{id}.balance nunca depende
// de un read-then-write entre dispositivos/sucursales. Cada movimiento
// de supplier_ledger suma/resta, atómicamente y exactamente-una-vez,
// sobre suppliers/{supplierId}.balance.

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

function sanitizeEntry(entry) {
    // eslint-disable-next-line no-unused-vars
    const { syncStatus, syncRetries, localId, id, ...clean } = entry;
    return stripUndefined(clean);
}

/**
 * Sube un movimiento de supplier_ledger a Firestore e incrementa
 * atómicamente suppliers/{supplierId}.balance en la MISMA transacción.
 * Idempotente vía el marcador _appliedToBalance (mismo criterio que
 * customerLedgerService.js).
 *
 * Regla de signo (igual a la que ya calculaba purchaseRepository.js en
 * runningBalance local): PURCHASE suma deuda, cualquier otro tipo
 * (PAYMENT, VOID, REFUND) resta.
 */
export async function pushSupplierLedgerWithBalanceIncrement(companyId, entry) {
    if (!companyId || !entry?.id || !entry?.supplierId) {
        throw new Error('pushSupplierLedgerWithBalanceIncrement: faltan companyId, entry.id o entry.supplierId');
    }

    const cleanEntry = sanitizeEntry(entry);
    const entryId = String(entry.id);
    const entryRef = doc(db, `companies/${companyId}/supplier_ledger`, entryId);
    const supplierRef = doc(db, `companies/${companyId}/suppliers`, String(entry.supplierId));
    const nowIso = new Date().toISOString();

    const amount = Number(entry.amount) || 0;
    const signedAmount = entry.type === 'PURCHASE' ? amount : -amount;

    const applied = await runTransaction(db, async (tx) => {
        const entrySnap = await tx.get(entryRef);
        const alreadyApplied = entrySnap.exists() && entrySnap.data()?._appliedToBalance === true;

        tx.set(entryRef, {
            ...cleanEntry,
            firestoreId: entryId,
            updatedAt: nowIso,
            syncedAt: nowIso,
            syncStatus: 'synced',
            _appliedToBalance: true
        }, { merge: true });

        if (alreadyApplied) return false;

        tx.set(supplierRef, {
            balance: increment(signedAmount),
            updatedAt: serverTimestamp()
        }, { merge: true });

        return true;
    });

    return { applied };
}
