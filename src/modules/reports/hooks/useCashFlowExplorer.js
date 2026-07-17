import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { getDB } from '../../../database/db';
import { useAuthStore } from '../../auth/store/useAuthStore';

// 🔥 Mismo esquema de presets que useTopProductsExplorer.js
const getDateRange = (period, customStart, customEnd) => {
    const start = new Date();
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    if (period === 'today') {
        start.setHours(0, 0, 0, 0);
    } else if (period === 'yesterday') {
        start.setDate(start.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        end.setDate(end.getDate() - 1);
        end.setHours(23, 59, 59, 999);
    } else if (period === 'week') {
        const day = start.getDay() || 7;
        if (day !== 1) start.setDate(start.getDate() - (day - 1));
        start.setHours(0, 0, 0, 0);
    } else if (period === 'month') {
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
    } else if (period === 'year') {
        start.setMonth(0);
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
    } else if (period === 'custom') {
        return {
            start: new Date(customStart + 'T00:00:00'),
            end: new Date(customEnd + 'T23:59:59')
        };
    }
    return { start, end };
};

const toInputDate = (d) => d.toISOString().split('T')[0];

// Mismas reglas de exclusión que useBusinessIntelligence.js (un reintegro/anulación
// no es un gasto nuevo, es la reversa de una venta ya excluida de "revenue").
const isRealExpense = (m) => {
    const type = (m.type || '').toUpperCase();
    if (!['EXPENSE', 'OUT', 'WITHDRAWAL'].includes(type)) return false;
    const desc = (m.description || '').toLowerCase();
    if (desc.includes('rendición')) return false;
    if (m.subtype === 'REFUND') return false;
    if (desc.includes('anulación ticket')) return false;
    if (desc.includes('reintegro venta')) return false;
    return true;
};

const isSupplierPayment = (m) => (m.type || '').toUpperCase() === 'PURCHASE';

// Explora los movimientos de caja del período (gastos fijos + pagos a proveedores) para el
// modal "Ver más" del Analytics Dashboard. Una sola query de cash_movements por rango,
// las dos pestañas (Gastos / Proveedores) se derivan del mismo set ya traído.
export const useCashFlowExplorer = (isOpen) => {
    const { user, activeBranchId } = useAuthStore();
    const [period, setPeriod] = useState('month');
    const [customStart, setCustomStart] = useState(toInputDate(new Date()));
    const [customEnd, setCustomEnd] = useState(toInputDate(new Date()));
    const [searchTerm, setSearchTerm] = useState('');
    const [rawMovements, setRawMovements] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchMovements = useCallback(async () => {
        if (!user?.companyId) return;
        setLoading(true);
        try {
            const localDb = await getDB();
            const { start, end } = getDateRange(period, customStart, customEnd);
            const startIso = start.toISOString();
            const endIso = end.toISOString();

            // 🔥 Siempre se confirma contra la nube (acotado por rango + limit): el histórico local
            // de cash_movements no está garantizado completo (ver fix en useBusinessIntelligence.js).
            const companyPath = `companies/${user.companyId}`;
            let movQ = query(collection(db, companyPath, 'cash_movements'), where('date', '>=', startIso), where('date', '<=', endIso), limit(1000));
            if (activeBranchId && activeBranchId !== 'ALL') movQ = query(movQ, where('branchId', '==', activeBranchId));

            const snap = await getDocs(movQ);
            const cloudMovements = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));

            if (cloudMovements.length > 0) {
                const pendingSet = new Set(
                    (await localDb.cash_movements.where('syncStatus').equals('pending').toArray())
                        .map(m => m.id)
                );
                const safeItems = cloudMovements
                    .filter(m => !pendingSet.has(m.id))
                    .map(m => ({ ...m, syncStatus: 'synced' }));
                if (safeItems.length > 0) await localDb.cash_movements.bulkPut(safeItems);
            }

            let localMovements = await localDb.cash_movements
                .where('date').between(startIso, endIso, true, true)
                .toArray();
            if (activeBranchId && activeBranchId !== 'ALL') {
                localMovements = localMovements.filter(m => m.branchId === activeBranchId);
            }

            setRawMovements(localMovements.sort((a, b) => new Date(b.date) - new Date(a.date)));
        } catch (e) {
            console.error("Error cargando flujo de caja:", e);
        } finally {
            setLoading(false);
        }
    }, [user?.companyId, period, customStart, customEnd, activeBranchId]);

    useEffect(() => {
        if (!isOpen) return;
        fetchMovements();
    }, [isOpen, fetchMovements]);

    const term = searchTerm.trim().toLowerCase();

    const expenseItems = useMemo(() => {
        const list = rawMovements.filter(isRealExpense);
        if (!term) return list;
        return list.filter(m =>
            (m.description || '').toLowerCase().includes(term) ||
            (m.user || '').toLowerCase().includes(term)
        );
    }, [rawMovements, term]);

    const supplierItems = useMemo(() => {
        const list = rawMovements.filter(isSupplierPayment);
        if (!term) return list;
        return list.filter(m =>
            (m.description || '').toLowerCase().includes(term) ||
            (m.supplierName || '').toLowerCase().includes(term)
        );
    }, [rawMovements, term]);

    const expenseTotal = useMemo(() => expenseItems.reduce((sum, m) => sum + (parseFloat(m.amount) || 0), 0), [expenseItems]);
    const supplierTotal = useMemo(() => supplierItems.reduce((sum, m) => sum + (parseFloat(m.amount) || 0), 0), [supplierItems]);

    return {
        expenseItems, expenseTotal,
        supplierItems, supplierTotal,
        loading,
        period, setPeriod,
        customStart, setCustomStart,
        customEnd, setCustomEnd,
        searchTerm, setSearchTerm
    };
};
