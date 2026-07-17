import { useState, useEffect, useMemo, useCallback } from 'react';
import { getDB } from '../../../database/db';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { salesRepository } from '../../sales/repositories/salesRepository';

// 🔥 Mismo esquema de presets que SalesPage.jsx (Hoy/Ayer/Semana/Mes/Custom)
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
    } else if (period === 'custom') {
        return {
            start: new Date(customStart + 'T00:00:00'),
            end: new Date(customEnd + 'T23:59:59')
        };
    }
    return { start, end };
};

const toInputDate = (d) => d.toISOString().split('T')[0];

export const useTopProductsExplorer = (isOpen) => {
    const { activeBranchId } = useAuthStore();
    const [period, setPeriod] = useState('today');
    const [customStart, setCustomStart] = useState(toInputDate(new Date()));
    const [customEnd, setCustomEnd] = useState(toInputDate(new Date()));
    const [searchTerm, setSearchTerm] = useState('');
    const [rawProducts, setRawProducts] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchTopProducts = useCallback(async () => {
        setLoading(true);
        try {
            const dbLocal = await getDB();
            const { start, end } = getDateRange(period, customStart, customEnd);

            let sales = await dbLocal.sales
                .where('date').between(start.toISOString(), end.toISOString(), true, true)
                .toArray();

            if (activeBranchId && activeBranchId !== 'ALL') {
                sales = sales.filter(s => s.branchId === activeBranchId);
            }

            // 🔥 Dispositivo sin historial local para este rango (ej: revisión remota desde otro
            // dispositivo/navegador) → fallback puntual y acotado a Firestore, cacheado en Dexie
            if (sales.length === 0) {
                sales = await salesRepository.fetchRemoteSalesRange(start, end);
            }

            const productMap = {};
            sales.forEach(sale => {
                const type = (sale.type || '').toUpperCase();
                const status = (sale.status || '').toUpperCase();
                if (type === 'BUDGET' || type === 'INTERNAL') return;
                if (status === 'CANCELLED' || status === 'ABANDONED' || status === 'REFUNDED') return;
                if (sale.afip?.status === 'VOIDED') return;

                (sale.items || []).forEach(item => {
                    const key = item.id || item.name || 'n/a';
                    if (!productMap[key]) {
                        productMap[key] = { productId: item.id || null, name: item.name || 'Producto', quantity: 0, revenue: 0, cost: 0 };
                    }
                    const qty = parseFloat(item.quantity || 0);
                    productMap[key].quantity += qty;
                    productMap[key].revenue += parseFloat(item.subtotal || 0);
                    productMap[key].cost += parseFloat(item.cost || 0) * qty;
                });
            });

            const sorted = Object.values(productMap).sort((a, b) => b.quantity - a.quantity);
            setRawProducts(sorted);
        } catch (e) {
            console.error("Error agregando top productos:", e);
        } finally {
            setLoading(false);
        }
    }, [period, customStart, customEnd, activeBranchId]);

    useEffect(() => {
        if (!isOpen) return;
        fetchTopProducts();
    }, [isOpen, fetchTopProducts]);

    // 🔄 REACTIVO: recalcular ante nuevas ventas locales o bajadas del cloud
    useEffect(() => {
        if (!isOpen) return;
        const handler = () => fetchTopProducts();
        window.addEventListener('noar:sale-created', handler);
        window.addEventListener('noar:sales-synced', handler);
        return () => {
            window.removeEventListener('noar:sale-created', handler);
            window.removeEventListener('noar:sales-synced', handler);
        };
    }, [isOpen, fetchTopProducts]);

    const items = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) return rawProducts;
        return rawProducts.filter(p => p.name.toLowerCase().includes(term));
    }, [rawProducts, searchTerm]);

    return {
        items, loading,
        period, setPeriod,
        customStart, setCustomStart,
        customEnd, setCustomEnd,
        searchTerm, setSearchTerm
    };
};
