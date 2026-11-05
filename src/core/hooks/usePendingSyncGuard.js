import { useEffect, useRef, useState } from 'react';
import { getDB } from '../../database/db';

// Tablas con syncStatus indexado (ver database/db.js)
const SYNC_TABLES = [
    'products', 'inventory', 'categories', 'brands', 'suppliers', 'promotions',
    'purchases', 'sales', 'shifts', 'cash_movements', 'clients',
    'customer_ledger', 'supplier_ledger', 'movements'
];

const POLL_MS = 10000;

// Cuenta registros locales sin subir y avisa al cerrar la pestaña si quedan.
// Solo lectura: usa el índice syncStatus (count() sin cargar registros).
export const usePendingSyncGuard = (enabled = true) => {
    const [pendingCount, setPendingCount] = useState(0);
    const countRef = useRef(0);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;

        const refresh = async () => {
            try {
                const dbLocal = await getDB();
                const counts = await Promise.all(SYNC_TABLES.map(t =>
                    dbLocal.table(t).where('syncStatus').notEqual('synced').count().catch(() => 0)
                ));
                const total = counts.reduce((s, n) => s + n, 0);
                if (!cancelled) {
                    countRef.current = total;
                    setPendingCount(total);
                }
            } catch (e) {
                console.warn('⚠️ No se pudo contar pendientes de sync.', e);
            }
        };

        // beforeunload es sincrónico → usa el último conteo cacheado
        const onBeforeUnload = (e) => {
            if (countRef.current > 0) {
                e.preventDefault();
                // Los navegadores modernos muestran su propio texto genérico
                e.returnValue = `¿Seguro quieres cerrar? Quedan ${countRef.current} cambios por subir.`;
                return e.returnValue;
            }
        };

        refresh();
        const interval = setInterval(refresh, POLL_MS);
        window.addEventListener('beforeunload', onBeforeUnload);
        window.addEventListener('online', refresh);

        return () => {
            cancelled = true;
            clearInterval(interval);
            window.removeEventListener('beforeunload', onBeforeUnload);
            window.removeEventListener('online', refresh);
        };
    }, [enabled]);

    return pendingCount;
};
