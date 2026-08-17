import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, where, getDocs, limit, Timestamp } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { getDB } from '../../../database/db';
import { useAuthStore } from '../../auth/store/useAuthStore';

const getDateRange = (period, customRange) => {
    if (period === 'custom' && customRange?.start && customRange?.end) {
        const start = new Date(customRange.start); start.setHours(0, 0, 0, 0);
        const end = new Date(customRange.end); end.setHours(23, 59, 59, 999);
        return { start, end };
    }
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    switch (period) {
        case 'today': break;
        case 'week':
            const day = start.getDay() || 7;
            if (day !== 1) start.setDate(start.getDate() - (day - 1));
            break;
        case 'month': start.setDate(1); break;
        case 'last_6_months': start.setMonth(start.getMonth() - 6); start.setDate(1); break;
        case 'year': start.setMonth(0); start.setDate(1); break;
        default: start.setDate(1);
    }
    return { start, end };
};

const getGroupKeyAndLabel = (dateObj, period) => {
    if (!dateObj || isNaN(dateObj.getTime())) return { key: 'T', label: 'T' };
    if (period === 'today') return { key: 'T', label: 'HOY' };
    if (period === 'week') return { key: 'W', label: 'SEMANA' };
    if (period === 'month') return { key: 'M', label: 'MES' };
    if (period === 'last_6_months' || period === 'year') {
        const m = dateObj.getMonth() + 1;
        return { key: `${dateObj.getFullYear()}-${m}`, label: `${m}/${dateObj.getFullYear().toString().slice(-2)}` };
    }
    if (period === 'custom') {
        const d = dateObj.getDate().toString().padStart(2, '0');
        const m = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        return { key: `${dateObj.getFullYear()}-${m}-${d}`, label: `${d}/${m}` };
    }
    return { key: 'T', label: 'TOTAL' };
};

export const useBusinessIntelligence = () => {
    const { user, activeBranchId } = useAuthStore();
    const [period, setPeriod] = useState('month');
    const [customRange, setCustomRange] = useState({ start: null, end: null });
    const [forceRefresh, setForceRefresh] = useState(0);
    const [salesData, setSalesData] = useState([]);
    const [movementsData, setMovementsData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const parseDate = useCallback((d) => {
        if (!d) return new Date();
        if (d instanceof Timestamp) return d.toDate();
        const p = new Date(d); return isNaN(p.getTime()) ? new Date() : p;
    }, []);

    useEffect(() => {
        const fetchBI = async () => {
            if (!user?.companyId) return;
            setLoading(true);
            try {
                if (period === 'custom' && (!customRange.start || !customRange.end)) { setLoading(false); return; }
                const { start, end } = getDateRange(period, customRange);
                const companyPath = `companies/${user.companyId}`;
                const localDb = await getDB();

                // 1 y 2. Ventas: SIEMPRE se confirman contra la nube para el rango pedido (mismo
                // criterio que cash_movements más abajo) — no confiar en "hay algo en Dexie" como
                // señal de que está completo, porque el delta-sync general no garantiza historial
                // completo en dispositivos que recién visitan un rango viejo (ver fix de movimientos
                // debajo, mismo bug pattern).
                // 🔥 limit() para acotar el costo de esta lectura (mismo criterio que
                // masterRepository.js/syncService.js).
                let salesQ = query(collection(db, companyPath, 'sales'), where('date', '>=', start.toISOString()), where('date', '<=', end.toISOString()), limit(1000));
                if (activeBranchId && activeBranchId !== 'ALL') salesQ = query(salesQ, where('branchId', '==', activeBranchId));
                const salesSnapPromise = getDocs(salesQ);

                // 3. Movimientos de caja (gastos, compras, retiros): SIEMPRE se confirman contra la
                // nube (acotado a rango + limit), nunca solo con lo que haya en Dexie.
                // 🔥 FIX: (a) la colección real es 'cash_movements' (snake_case, ver
                // cashRepository._syncToCloud) — acá se consultaba 'cashMovements', que no existe.
                // (b) el listener en vivo de cash_movements (syncService.js) solo cubre la sucursal
                // activa y ~60s hacia atrás, y el delta-sync inicial se salta directamente si la
                // sucursal es 'ALL' — así que Dexie NUNCA garantiza tener el histórico completo.
                // Confiar en "hay algo local" como señal de "está completo" hacía que un período más
                // largo (Mes) mostrara MENOS gastos que uno más corto (Semana): en Mes, Dexie ya tenía
                // un subconjunto parcial que alcanzaba para saltarse la baja de la nube.
                let movQ = query(collection(db, companyPath, 'cash_movements'), where('date', '>=', start.toISOString()), where('date', '<=', end.toISOString()), limit(1000));
                if (activeBranchId && activeBranchId !== 'ALL') movQ = query(movQ, where('branchId', '==', activeBranchId));

                const [sSnap, mSnap] = await Promise.all([salesSnapPromise, getDocs(movQ)]);

                const cloudSales = sSnap.docs.map(doc => ({ ...doc.data(), id: doc.id }));

                // Nunca sobreescribir ventas con syncStatus: 'pending' (creadas offline aún no subidas)
                if (cloudSales.length > 0) {
                    const pendingSet = new Set(
                        (await localDb.sales.where('syncStatus').equals('pending').toArray())
                            .map(s => s.id)
                    );
                    const safeItems = cloudSales
                        .filter(s => !pendingSet.has(s.id))
                        .map(s => ({ ...s, syncStatus: 'synced' }));
                    if (safeItems.length > 0) await localDb.sales.bulkPut(safeItems);
                }

                // Releemos Dexie ya mergeado (incluye lo recién bajado + lo 'pending' local sin subir)
                let finalSales = await localDb.sales
                    .where('date').between(start.toISOString(), end.toISOString(), true, true)
                    .toArray();
                if (activeBranchId && activeBranchId !== 'ALL') {
                    finalSales = finalSales.filter(s => s.branchId === activeBranchId);
                }
                setSalesData(finalSales.map(s => ({ ...s, dateObj: parseDate(s.date || s.createdAt) })));

                const cloudMovements = mSnap.docs.map(doc => ({ ...doc.data(), id: doc.id }));

                // Nunca sobreescribir movimientos con syncStatus: 'pending' (creados offline aún no subidos)
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

                // Releemos Dexie ya mergeado (incluye lo recién bajado + lo 'pending' local sin subir)
                let finalMovements = await localDb.cash_movements
                    .where('date').between(start.toISOString(), end.toISOString(), true, true)
                    .toArray();
                if (activeBranchId && activeBranchId !== 'ALL') {
                    finalMovements = finalMovements.filter(m => m.branchId === activeBranchId);
                }
                setMovementsData(finalMovements.map(m => ({ ...m, dateObj: parseDate(m.date || m.createdAt) })));

            } catch (err) { setError(err.message); } finally { setLoading(false); }
        };
        fetchBI();
    }, [user?.companyId, period, activeBranchId, forceRefresh, parseDate, customRange.start, customRange.end]);

    const metrics = useMemo(() => {
        let revenue = 0; let cost = 0; let expenses = 0; let purchases = 0;
        const paymentMap = { 'Efectivo': 0, 'Tarjeta': 0, 'Transferencia': 0, 'MercadoPago': 0, 'Cuenta Corriente': 0, 'Otros': 0 };
        const supplierMap = {}; const productMap = {}; const historyMap = {};
        const expenseDetails = [];

        salesData.forEach(s => {
            const status = (s.status || '').toUpperCase();
            // 🔥 FIX: handleAnular marca afip.status='VOIDED' (no status='CANCELLED', que nunca se usa)
            if (status === 'CANCELLED' || status === 'ABANDONED' || status === 'REFUNDED') return;
            if (s.afip?.status === 'VOIDED') return;

            const total = parseFloat(s.total || 0);
            const totalCost = parseFloat(s.totalCost || 0);
            
            revenue += total;
            cost += totalCost;

            // Medios de pago
            const m = (s.method || s.payment?.method || 'otros').toLowerCase();
            if (m.includes('efectivo') || m.includes('cash')) paymentMap['Efectivo'] += total;
            else if (m.includes('tarjeta') || m.includes('card')) paymentMap['Tarjeta'] += total;
            else if (m.includes('transfer')) paymentMap['Transferencia'] += total;
            else if (m.includes('mp') || m.includes('mercadopago')) paymentMap['MercadoPago'] += total;
            else if (m.includes('cuenta') || m.includes('corriente')) paymentMap['Cuenta Corriente'] += total;
            else paymentMap['Otros'] += total;

            // Historial (CORREGIDO: Incluye CostoVenta)
            const { key, label } = getGroupKeyAndLabel(s.dateObj, period);
            if (!historyMap[key]) historyMap[key] = { name: label, Ingresos: 0, CostoVenta: 0, Gastos: 0, Compras: 0, order: key };
            historyMap[key].Ingresos += total;
            historyMap[key].CostoVenta += totalCost;

            // Top Productos
            (s.items || []).forEach(item => {
                const pid = item.id || 'n/a';
                if (!productMap[pid]) productMap[pid] = { name: item.name || 'Prodn', profit: 0 };
                productMap[pid].profit += (parseFloat(item.price || 0) - parseFloat(item.cost || 0)) * parseFloat(item.quantity || 1);
            });
        });

        movementsData.forEach(m => {
            const amt = parseFloat(m.amount || 0);
            const type = (m.type || '').toUpperCase();
            if (type === 'PURCHASE') {
                purchases += amt;
                const sup = m.supplierName || 'Varios';
                supplierMap[sup] = (supplierMap[sup] || 0) + amt;
                
                const { key, label } = getGroupKeyAndLabel(m.dateObj, period);
                if (!historyMap[key]) historyMap[key] = { name: label, Ingresos: 0, CostoVenta: 0, Gastos: 0, Compras: 0, order: key };
                historyMap[key].Compras += amt;
            } else if (['EXPENSE', 'OUT', 'WITHDRAWAL'].includes(type) && !m.description?.toLowerCase().includes('rendición')
                && m.subtype !== 'REFUND'
                && !m.description?.toLowerCase().includes('anulación ticket')
                && !m.description?.toLowerCase().includes('reintegro venta')) {
                // 🔥 FIX: un reintegro/anulación no es un gasto nuevo, es la reversa de una venta que
                // ya excluimos de "revenue" arriba (afip.status VOIDED / status REFUNDED). Contarlo acá
                // restaba dos veces la misma plata. Chequeamos también por descripción para movimientos
                // viejos (previos a este fix) que no tienen subtype.
                expenses += amt;
                const { key, label } = getGroupKeyAndLabel(m.dateObj, period);
                if (!historyMap[key]) historyMap[key] = { name: label, Ingresos: 0, CostoVenta: 0, Gastos: 0, Compras: 0, order: key };
                historyMap[key].Gastos += amt;

                expenseDetails.push({
                    date: m.date,
                    description: m.description || 'Gasto',
                    user: m.user || 'Cajero',
                    type,
                    amount: amt
                });
            }
        });

        return {
            global: { revenue, cost, expenses, purchases, profit: revenue - cost - expenses, avgTicket: salesData.length > 0 ? revenue / salesData.length : 0 },
            historyChart: Object.values(historyMap).sort((a,b) => a.order.localeCompare(b.order)),
            paymentChart: Object.entries(paymentMap).map(([name, value]) => ({ name, value })).filter(p => p.value > 0),
            topSuppliers: Object.entries(supplierMap).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value).slice(0, 5),
            topProfit: Object.values(productMap).sort((a,b) => b.profit - a.profit).slice(0, 5),
            expenseDetails: expenseDetails.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 30)
        };
    }, [salesData, movementsData, period]);

    return { metrics, loading, error, period, setPeriod, customRange, setCustomRange, refetch: () => setForceRefresh(n => n + 1), activeBranchId };
};