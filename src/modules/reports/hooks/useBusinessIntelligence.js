import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { useAuthStore } from '../../auth/store/useAuthStore';

/**
 * Helper para rangos de fechas (Flexible)
 */
const getDateRange = (period) => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const start = new Date();
    start.setHours(0, 0, 0, 0);

    switch (period) {
        case 'today':
            break; // Start ya es hoy 00:00
        case 'week':
            start.setDate(end.getDate() - 7);
            break;
        case 'month':
            start.setDate(1); // Primer día del mes actual
            break;
        case 'last_6_months':
            start.setMonth(end.getMonth() - 5);
            start.setDate(1);
            break;
        case 'year':
            start.setMonth(0, 1);
            break;
        default: 
            start.setFullYear(2023); 
    }
    return { start, end };
};

// Formateador de fechas para el gráfico según el periodo
const getGroupKeyAndLabel = (dateObj, period) => {
    if (period === 'today') {
        const hour = String(dateObj.getHours()).padStart(2, '0');
        return { key: `${hour}:00`, label: `${hour}:00` };
    }
    if (period === 'week' || period === 'month') {
        const day = String(dateObj.getDate()).padStart(2, '0');
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        return { 
            key: `${dateObj.getFullYear()}-${month}-${day}`, 
            label: dateObj.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }) 
        };
    }
    // Año o 6 meses (Agrupar por mes)
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    return { 
        key: `${dateObj.getFullYear()}-${month}`, 
        label: dateObj.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' }) 
    };
};

export const useBusinessIntelligence = () => {
    // 1. Centralización por BranchId (Consumiendo directamente de Zustand)
    const { user, activeBranchId } = useAuthStore();
    
    // ESTADOS DE DATOS
    const [salesData, setSalesData] = useState([]);
    const [movementsData, setMovementsData] = useState([]);
    
    // ESTADOS DE UI
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // FILTROS ACTIVOS
    const [period, setPeriod] = useState('month'); 

    // 2. Data Fetching con filtrado estricto por Sucursal
    useEffect(() => {
        if (!user?.companyId) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                const { start, end } = getDateRange(period);
                const companyPath = `companies/${user.companyId}`;
                
                // ------------------------------------------------
                // QUERY A: VENTAS (Ingresos Teóricos y Costos)
                // ------------------------------------------------
                let salesQ = query(
                    collection(db, companyPath, 'sales'),
                    where('date', '>=', start.toISOString()),
                    where('date', '<=', end.toISOString())
                );

                if (activeBranchId && activeBranchId !== 'ALL') {
                    salesQ = query(salesQ, where('branchId', '==', activeBranchId));
                }

                // ------------------------------------------------
                // QUERY B: MOVIMIENTOS (Caja Real: Gastos, Compras, Recibos)
                // ------------------------------------------------
                let movQ = query(
                    collection(db, companyPath, 'cash_movements'),
                    where('date', '>=', start.toISOString()),
                    where('date', '<=', end.toISOString())
                );

                if (activeBranchId && activeBranchId !== 'ALL') {
                    movQ = query(movQ, where('branchId', '==', activeBranchId));
                }

                // EJECUCIÓN PARALELA
                const [salesSnap, movSnap] = await Promise.all([
                    getDocs(salesQ),
                    getDocs(movQ)
                ]);
                
                // NORMALIZACIÓN VENTAS
                const sales = salesSnap.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        ...data,
                        total: parseFloat(data.total || 0),
                        totalCost: parseFloat(data.totalCost || 0), 
                        dateObj: new Date(data.date)
                    };
                });

                // NORMALIZACIÓN MOVIMIENTOS
                const movements = movSnap.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        ...data,
                        amount: parseFloat(data.amount || 0),
                        dateObj: new Date(data.date)
                    };
                });

                setSalesData(sales);
                setMovementsData(movements);

            } catch (err) {
                console.error("BI Fetch Error:", err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [user?.companyId, period, activeBranchId]); 

    // 3. PROCESAMIENTO DE KPIs (El Cerebro Financiero)
    const metrics = useMemo(() => {
        if (!salesData.length && !movementsData.length) {
            return {
                global: { revenue: 0, cost: 0, expenses: 0, profit: 0, margin: 0, avgTicket: 0, purchases: 0, cashFlow: 0 },
                historyChart: [],
                paymentChart: [],
                topSuppliers: [],
                topProfit: []
            };
        }

        // ----------------------------------------------------
        // A. CÁLCULO DE TOTALES GLOBALES (ECONÓMICO)
        // ----------------------------------------------------
        let totalRevenue = 0; 
        let totalCogs = 0;
        const productMap = {};
        const paymentMap = {};

        salesData.forEach(sale => {
            if (sale.type === 'INTERNAL' || sale.type === 'BUDGET') return;
            if (sale.status === 'CANCELLED' || sale.afip?.status === 'VOIDED') return;

            totalRevenue += sale.total;
            
            // Costo de Mercadería
            totalCogs += sale.totalCost || (sale.items?.reduce((sum, item) => sum + (parseFloat(item.cost || 0) * parseFloat(item.quantity || 0)), 0) || 0);

            // Rentabilidad por Producto (80/20)
            sale.items?.forEach(item => {
                const id = item.productId || item.id || item.name;
                if (!productMap[id]) productMap[id] = { name: item.name || 'Desconocido', qty: 0, revenue: 0, profit: 0 };
                const qty = parseFloat(item.quantity || 0);
                const unitPrice = parseFloat(item.price || 0);
                const unitCost = parseFloat(item.cost || 0);
                
                productMap[id].qty += qty;
                productMap[id].revenue += parseFloat(item.subtotal || item.total || 0);
                productMap[id].profit += (unitPrice - unitCost) * qty;
            });

            // Mix de Pagos
            const payments = Array.isArray(sale.payments) && sale.payments.length > 0 
                ? sale.payments 
                : [{ method: sale.payment?.method || sale.paymentMethod || sale.method || 'cash', amount: sale.total }];
            
            payments.forEach(p => {
                const methodRaw = String(p.method || 'cash').toLowerCase().trim();
                const amount = parseFloat(p.amount || p.total || 0);
                
                let label = methodRaw;
                if (['cash', 'efectivo'].includes(methodRaw)) label = 'EFECTIVO';
                else if (['transfer', 'transferencia'].includes(methodRaw)) label = 'TRANSFERENCIA';
                else if (['mercadopago', 'mp', 'qr'].includes(methodRaw)) label = 'MERCADOPAGO QR';
                else if (['clover', 'point', 'manual_card', 'card', 'tarjeta', 'credit', 'debit'].includes(methodRaw)) label = 'TARJETA';
                else if (['account', 'current_account', 'debt'].includes(methodRaw)) label = 'CTA CORRIENTE';
                else if (['employee_account'].includes(methodRaw)) label = 'CTA EMPLEADO';
                else label = 'OTROS';

                paymentMap[label] = (paymentMap[label] || 0) + amount;
            });
        });

        // ----------------------------------------------------
        // B. CÁLCULO DE FLUJO DE CAJA (FINANCIERO)
        // ----------------------------------------------------
        let totalInflow = 0;     // Plata Real Entrante (Ventas Efectivas + Cobros Deudas)
        let totalExpenses = 0;   // Gastos Operativos Reales
        let totalPurchases = 0;  // Pago a Proveedores Reales
        const supplierMap = {};

        movementsData.forEach(m => {
            const amount = m.amount;
            const type = m.type;
            const subtype = m.subtype;
            const isClosing = m.description && m.description.toLowerCase().includes('rendición de cierre');
            const isDuplicatedIn = type === 'IN' && m.description?.toLowerCase().includes('cobro cta cte');

            // Ignoramos retiros de cierre y duplicados manuales de recibos
            if (isClosing || isDuplicatedIn || subtype === 'OPENING') return;

            if (type === 'SALE' || type === 'RECEIPT' || type === 'IN' || type === 'DEPOSIT') {
                // Como los pagos a cuenta corriente NO están en cash_movements, 
                // esto ya representa la liquidez perfecta.
                totalInflow += amount;
            } else if (type === 'PURCHASE') {
                totalPurchases += amount;
                
                // Ranking Proveedores
                let supName = 'Varios';
                if (m.supplierName) supName = m.supplierName;
                else if (m.description && m.description.includes(':')) supName = m.description.split(':')[1].split('-')[0].trim();
                else if (m.description) supName = m.description;
                
                supplierMap[supName] = (supplierMap[supName] || 0) + amount;
            } else if (type === 'EXPENSE' || type === 'OUT' || type === 'WITHDRAWAL') {
                totalExpenses += amount;
            }
        });

        // ----------------------------------------------------
        // C. CONSOLIDACIÓN GLOBAL
        // ----------------------------------------------------
        const economicProfit = totalRevenue - totalCogs - totalExpenses; // Rentabilidad
        const cashFlow = totalInflow - (totalPurchases + totalExpenses); // Liquidez
        const margin = totalRevenue > 0 ? ((economicProfit / totalRevenue) * 100).toFixed(1) : 0;

        const global = {
            revenue: totalRevenue,
            cost: totalCogs,
            expenses: totalExpenses,
            purchases: totalPurchases,
            profit: economicProfit, 
            cashFlow: cashFlow, 
            margin: margin,
            avgTicket: salesData.length > 0 ? totalRevenue / salesData.length : 0
        };

        // ----------------------------------------------------
        // D. ARMADO DEL GRÁFICO HISTÓRICO (DOBLE VISIÓN)
        // ----------------------------------------------------
        const historyMap = {};

        salesData.forEach(sale => {
            if (sale.type === 'INTERNAL' || sale.type === 'BUDGET' || sale.status === 'CANCELLED') return;
            const { key, label } = getGroupKeyAndLabel(sale.dateObj, period);

            if (!historyMap[key]) historyMap[key] = { name: label, Ventas: 0, COGS: 0, Gastos: 0, Compras: 0, IngresosReales: 0, order: key };
            
            historyMap[key].Ventas += sale.total;
            historyMap[key].COGS += (sale.totalCost || 0);
        });

        movementsData.forEach(m => {
            const { key, label } = getGroupKeyAndLabel(m.dateObj, period);
            
            if (!historyMap[key]) historyMap[key] = { name: label, Ventas: 0, COGS: 0, Gastos: 0, Compras: 0, IngresosReales: 0, order: key };

            const isClosing = m.description && m.description.toLowerCase().includes('rendición de cierre');
            const isDuplicatedIn = m.type === 'IN' && m.description?.toLowerCase().includes('cobro cta cte');
            if (isClosing || isDuplicatedIn || m.subtype === 'OPENING') return;

            if (m.type === 'PURCHASE') {
                historyMap[key].Compras += m.amount;
            } else if (m.type === 'EXPENSE' || m.type === 'WITHDRAWAL' || m.type === 'OUT') {
                historyMap[key].Gastos += m.amount;
            } else if (m.type === 'SALE' || m.type === 'RECEIPT' || m.type === 'IN' || m.type === 'DEPOSIT') {
                historyMap[key].IngresosReales += m.amount;
            }
        });

        const historyChart = Object.values(historyMap)
            .map(item => ({
                name: item.name,
                order: item.order,
                // Visión Económica
                Ingresos: item.Ventas,
                CostoVenta: item.COGS,
                Gastos: item.Gastos,
                Resultado: item.Ventas - item.COGS - item.Gastos,
                // Visión Financiera
                Entradas: item.IngresosReales,
                SalidasStock: item.Compras,
                SalidasFijas: item.Gastos,
                FlujoNeto: item.IngresosReales - item.Compras - item.Gastos 
            }))
            .sort((a, b) => a.order.localeCompare(b.order));

        // ----------------------------------------------------
        // E. RANKINGS FINALES
        // ----------------------------------------------------
        const topSuppliers = Object.entries(supplierMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 5);

        const topProfit = Object.values(productMap)
            .sort((a, b) => b.profit - a.profit)
            .slice(0, 5);

        const paymentChart = Object.entries(paymentMap)
            .map(([name, value]) => ({ name, value }))
            .filter(p => p.value > 0);

        return {
            global,
            historyChart,
            topSuppliers,
            topProfit,
            paymentChart
        };

    }, [salesData, movementsData, period]);

    return {
        metrics,
        loading,
        error,
        period,
        setPeriod,
        activeBranchId
    };
};