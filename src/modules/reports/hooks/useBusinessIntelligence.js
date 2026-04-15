import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { useAuthStore } from '../../auth/store/useAuthStore';

const getDateRange = (period) => {
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
    return { key: 'T', label: 'TOTAL' };
};

export const useBusinessIntelligence = () => {
    const { user, activeBranchId } = useAuthStore();
    const [period, setPeriod] = useState('month'); 
    const [salesData, setSalesData] = useState([]);
    const [movementsData, setMovementsData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchBI = async () => {
            if (!user?.companyId) return;
            setLoading(true);
            try {
                const { start, end } = getDateRange(period);
                const companyPath = `companies/${user.companyId}`;

                let salesQ = query(collection(db, companyPath, 'sales'), where('date', '>=', start.toISOString()), where('date', '<=', end.toISOString()));
                if (activeBranchId && activeBranchId !== 'ALL') salesQ = query(salesQ, where('branchId', '==', activeBranchId));

                let movQ = query(collection(db, companyPath, 'cashMovements'), where('date', '>=', start.toISOString()), where('date', '<=', end.toISOString()));
                if (activeBranchId && activeBranchId !== 'ALL') movQ = query(movQ, where('branchId', '==', activeBranchId));

                const [sSnap, mSnap] = await Promise.all([getDocs(salesQ), getDocs(movQ)]);

                const parseDate = (d) => {
                    if (!d) return new Date();
                    if (d instanceof Timestamp) return d.toDate();
                    const p = new Date(d); return isNaN(p.getTime()) ? new Date() : p;
                };

                setSalesData(sSnap.docs.map(doc => ({ ...doc.data(), id: doc.id, dateObj: parseDate(doc.data().date || doc.data().createdAt) })));
                setMovementsData(mSnap.docs.map(doc => ({ ...doc.data(), id: doc.id, dateObj: parseDate(doc.data().date || doc.data().createdAt) })));

            } catch (err) { setError(err.message); } finally { setLoading(false); }
        };
        fetchBI();
    }, [user?.companyId, period, activeBranchId]);

    const metrics = useMemo(() => {
        let revenue = 0; let cost = 0; let expenses = 0; let purchases = 0;
        const paymentMap = { 'Efectivo': 0, 'Tarjeta': 0, 'Transferencia': 0, 'MercadoPago': 0, 'Cuenta Corriente': 0, 'Otros': 0 };
        const supplierMap = {}; const productMap = {}; const historyMap = {};

        salesData.forEach(s => {
            const status = (s.status || '').toUpperCase();
            if (status === 'CANCELLED' || status === 'ABANDONED') return;

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
            } else if (['EXPENSE', 'OUT', 'WITHDRAWAL'].includes(type) && !m.description?.toLowerCase().includes('rendición')) {
                expenses += amt;
                const { key, label } = getGroupKeyAndLabel(m.dateObj, period);
                if (!historyMap[key]) historyMap[key] = { name: label, Ingresos: 0, CostoVenta: 0, Gastos: 0, Compras: 0, order: key };
                historyMap[key].Gastos += amt;
            }
        });

        return {
            global: { revenue, cost, expenses, purchases, profit: revenue - cost - expenses, avgTicket: salesData.length > 0 ? revenue / salesData.length : 0 },
            historyChart: Object.values(historyMap).sort((a,b) => a.order.localeCompare(b.order)),
            paymentChart: Object.entries(paymentMap).map(([name, value]) => ({ name, value })).filter(p => p.value > 0),
            topSuppliers: Object.entries(supplierMap).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value).slice(0, 5),
            topProfit: Object.values(productMap).sort((a,b) => b.profit - a.profit).slice(0, 5)
        };
    }, [salesData, movementsData, period]);

    return { metrics, loading, error, period, setPeriod, refetch: () => setLoading(true), activeBranchId };
};