import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { useAuthStore } from '../../auth/store/useAuthStore';

// Helper para rangos de fechas (Flexible)
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

export const useBusinessIntelligence = () => {
    const { user } = useAuthStore();
    
    // ESTADOS DE DATOS
    const [salesData, setSalesData] = useState([]);
    const [movementsData, setMovementsData] = useState([]);
    
    // ESTADOS DE UI
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // FILTROS ACTIVOS
    const [period, setPeriod] = useState('month'); 
    const [targetBranch, setTargetBranch] = useState('ALL');

    // 1. DATA FETCHING (Doble Vía: Ventas + Movimientos)
    useEffect(() => {
        if (!user?.companyId) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                const { start, end } = getDateRange(period);
                const companyPath = `companies/${user.companyId}`;
                
                // ------------------------------------------------
                // QUERY A: VENTAS (Ingresos y Costos de Venta)
                // ------------------------------------------------
                let salesQ = query(
                    collection(db, companyPath, 'sales'),
                    where('date', '>=', start.toISOString()),
                    where('date', '<=', end.toISOString())
                );

                if (targetBranch !== 'ALL') {
                    salesQ = query(salesQ, where('branchId', '==', targetBranch));
                }

                // ------------------------------------------------
                // QUERY B: MOVIMIENTOS (Gastos, Compras, Retiros)
                // ------------------------------------------------
                let movQ = query(
                    collection(db, companyPath, 'cash_movements'),
                    where('date', '>=', start.toISOString()),
                    where('date', '<=', end.toISOString())
                );

                if (targetBranch !== 'ALL') {
                    movQ = query(movQ, where('branchId', '==', targetBranch));
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
                        // Si no hay totalCost guardado, lo calculamos si hay items
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
    }, [user?.companyId, period, targetBranch]); // 🔥 Se dispara al cambiar filtros

    // 2. PROCESAMIENTO DE KPIs (El Cerebro Financiero)
    const metrics = useMemo(() => {
        // Si no hay datos, retornamos estructura vacía segura
        if (!salesData.length && !movementsData.length) {
            return {
                global: { revenue: 0, cost: 0, expenses: 0, profit: 0, margin: 0, avgTicket: 0, purchases: 0 },
                historyChart: [],
                paymentChart: [],
                topSuppliers: [],
                topProfit: []
            };
        }

        // ----------------------------------------------------
        // A. CÁLCULO DE TOTALES GLOBALES
        // ----------------------------------------------------
        
        // INGRESOS (VENTAS REALES)
        const totalRevenue = salesData.reduce((acc, s) => acc + s.total, 0);
        
        // COSTO DE LO VENDIDO (COGS) - Calculado desde las ventas
        // Si la venta no tiene 'totalCost', intentamos sumar costo de items
        const totalCogs = salesData.reduce((acc, s) => {
            if (s.totalCost) return acc + s.totalCost;
            // Fallback: Sumar costos de items si existen
            if (s.items && Array.isArray(s.items)) {
                return acc + s.items.reduce((sum, item) => sum + (parseFloat(item.cost || 0) * parseFloat(item.quantity || 0)), 0);
            }
            return acc;
        }, 0);

        // CLASIFICACIÓN DE SALIDAS DE CAJA
        let totalExpenses = 0; // Gastos operativos (Luz, etc)
        let totalPurchases = 0; // Reposición de Stock

        movementsData.forEach(m => {
            // 'EXPENSE' = Gastos Varios, 'WITHDRAWAL' = Retiros, 'PURCHASE' = Pago a Proveedores
            if (m.type === 'EXPENSE' || m.type === 'WITHDRAWAL') {
                totalExpenses += m.amount;
            } else if (m.type === 'PURCHASE') {
                totalPurchases += m.amount;
            }
        });

        // GANANCIA OPERATIVA (ECONÓMICA): Ventas - CostoVenta - GastosFijos
        // No incluye compras de stock porque eso es cambio de activo (Caja -> Mercadería)
        const economicProfit = totalRevenue - totalCogs - totalExpenses;
        
        // MARGEN %
        const margin = totalRevenue > 0 ? ((economicProfit / totalRevenue) * 100).toFixed(1) : 0;

        const global = {
            revenue: totalRevenue,
            cost: totalCogs, // COGS (Costo Venta)
            expenses: totalExpenses, // Gastos Fijos
            purchases: totalPurchases, // Compras Stock (Para Cash Flow)
            profit: economicProfit, // Resultado Económico
            margin: margin,
            avgTicket: salesData.length > 0 ? totalRevenue / salesData.length : 0
        };

        // ----------------------------------------------------
        // B. HISTÓRICO MENSUAL (VELAS)
        // ----------------------------------------------------
        const historyMap = {};
        
        // Inicializar últimos X meses para que el gráfico no se vea vacío
        if (period === 'last_6_months' || period === 'year') {
             // Lógica simple para rellenar meses vacíos si se desea
        }

        // 1. Sumar Ventas y COGS por mes
        salesData.forEach(sale => {
            const d = sale.dateObj;
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            // Etiqueta legible (Ene 24)
            const label = d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });

            if (!historyMap[key]) historyMap[key] = { name: label, Ventas: 0, CostoMercaderia: 0, Gastos: 0, Compras: 0, order: key };
            
            historyMap[key].Ventas += sale.total;
            historyMap[key].CostoMercaderia += (sale.totalCost || 0);
        });

        // 2. Sumar Egresos por mes
        movementsData.forEach(m => {
            const d = m.dateObj;
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });

            if (!historyMap[key]) historyMap[key] = { name: label, Ventas: 0, CostoMercaderia: 0, Gastos: 0, Compras: 0, order: key };

            if (m.type === 'PURCHASE') {
                historyMap[key].Compras += m.amount;
            } else if (m.type === 'EXPENSE' || m.type === 'WITHDRAWAL') {
                historyMap[key].Gastos += m.amount;
            }
        });

        // 3. Calcular Ganancia Mensual y Aplanar Array
        const historyChart = Object.values(historyMap)
            .map(item => ({
                ...item,
                // Ganancia Económica del mes
                Ganancia: item.Ventas - item.CostoMercaderia - item.Gastos,
                // Salidas Totales (Para Cash Flow)
                Egresos: item.Compras + item.Gastos 
            }))
            .sort((a, b) => a.order.localeCompare(b.order));

        // ----------------------------------------------------
        // C. RANKING PROVEEDORES (Compras)
        // ----------------------------------------------------
        const supplierMap = {};
        movementsData.forEach(m => {
            if (m.type === 'PURCHASE') {
                // Buscamos nombre proveedor en description. Formato: "Compra: [Nombre]"
                // Si no hay formato, usamos 'Varios'
                let name = 'Varios';
                if (m.description && m.description.includes(':')) {
                    name = m.description.split(':')[1].split('-')[0].trim();
                } else if (m.description) {
                    name = m.description;
                }
                
                if (!supplierMap[name]) supplierMap[name] = 0;
                supplierMap[name] += m.amount;
            }
        });

        const topSuppliers = Object.entries(supplierMap)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([name, value]) => ({ name, value }));

        // ----------------------------------------------------
        // D. PRODUCTOS (Top Selling & Top Profit)
        // ----------------------------------------------------
        const productMap = {};
        salesData.forEach(sale => {
            if (sale.items && Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                    const id = item.productId || item.id || item.name; // ID único
                    const name = item.name || 'Desconocido';
                    
                    if (!productMap[id]) productMap[id] = { name, qty: 0, revenue: 0, profit: 0 };
                    
                    const qty = parseFloat(item.quantity || 0);
                    const total = parseFloat(item.subtotal || item.total || 0);
                    // Profit por item = (Precio - Costo) * Cantidad
                    const unitCost = parseFloat(item.cost || 0);
                    const unitPrice = parseFloat(item.price || 0);
                    const itemProfit = (unitPrice - unitCost) * qty;

                    productMap[id].qty += qty;
                    productMap[id].revenue += total;
                    productMap[id].profit += itemProfit;
                });
            }
        });

        const productsArray = Object.values(productMap);
        const topProfit = [...productsArray].sort((a, b) => b.profit - a.profit).slice(0, 5);

        // ----------------------------------------------------
        // E. MIX DE PAGOS
        // ----------------------------------------------------
        const paymentMap = {};
        salesData.forEach(sale => {
            let methods = [];
            // Soporte para estructura nueva (array) o vieja (objeto único)
            if (sale.payments && Array.isArray(sale.payments)) {
                methods = sale.payments;
            } else if (sale.paymentMethod) {
                 // Estructura simple antigua
                 methods = [{ method: sale.paymentMethod, amount: sale.total }];
            }

            methods.forEach(p => {
                const key = (p.method || 'cash').toUpperCase();
                // Normalizar nombres
                const label = key === 'CASH' ? 'EFECTIVO' : 
                              key === 'CARD' ? 'TARJETA' : 
                              key === 'TRANSFER' ? 'TRANSFERENCIA' : key;

                if (!paymentMap[label]) paymentMap[label] = 0;
                paymentMap[label] += parseFloat(p.amount || p.total || 0);
            });
        });

        const paymentChart = Object.keys(paymentMap).map(key => ({
            name: key,
            value: paymentMap[key]
        }));

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
        targetBranch,
        setTargetBranch
    };
};