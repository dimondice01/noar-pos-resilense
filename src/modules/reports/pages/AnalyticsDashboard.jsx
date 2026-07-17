import React, { useState, useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell
} from 'recharts';
import {
    TrendingUp, DollarSign, Package,
    ArrowUpRight, Truck, Wallet, Activity, HandCoins, RefreshCw
} from 'lucide-react';
import { useBusinessIntelligence } from '../hooks/useBusinessIntelligence';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { CashFlowExplorerModal } from '../components/CashFlowExplorerModal';

const COLORS = {
    sales: '#2563eb',
    cogs: '#f59e0b',
    profit: '#10b981',
    supplier: '#9333ea',
    pie: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6366f1']
};

const formatCurrency = (val) => {
    if (!val || isNaN(val)) return '$ 0';
    return '$ ' + Number(val).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

export const AnalyticsDashboard = () => {
    const { activeBranchId, activeBranchName } = useAuthStore();
    const [viewMode, setViewMode] = useState('ECONOMIC');
    const [cashFlowModal, setCashFlowModal] = useState({ open: false, tab: 'expenses' });

    const { metrics, loading, period, setPeriod, refetch } = useBusinessIntelligence();

    const stats      = metrics.global       || {};
    const payments   = metrics.paymentChart  || [];
    const suppliers  = metrics.topSuppliers  || [];
    const products   = metrics.topProfit     || [];
    const expenseList = metrics.expenseDetails || [];

    const historyData = useMemo(() => {
        const rawChart = metrics.historyChart || [];
        return rawChart.map(h => {
            if (viewMode === 'ECONOMIC') {
                return {
                    name: h.name || '---',
                    Ventas:   Number(h.Ingresos   || 0),
                    Costos:   Number(h.CostoVenta  || 0),
                    Ganancia: Number((h.Ingresos || 0) - (h.CostoVenta || 0) - (h.Gastos || 0))
                };
            }
            return {
                name:     h.name || '---',
                Entradas: Number(h.Ingresos || 0),
                Salidas:  Number((h.Compras || 0) + (h.Gastos || 0)),
                CajaNeta: Number((h.Ingresos || 0) - ((h.Compras || 0) + (h.Gastos || 0)))
            };
        });
    }, [metrics.historyChart, viewMode]);

    if (loading) return (
        <div className="h-screen flex flex-col items-center justify-center bg-sys-50">
            <div className="w-12 h-12 border-4 border-sys-200 border-t-brand rounded-full animate-spin"></div>
            <p className="mt-4 text-sys-500 font-bold animate-pulse tracking-widest uppercase text-xs">Cargando analytics...</p>
        </div>
    );

    const periods = [
        { id: 'today', label: 'Hoy'   },
        { id: 'week',  label: 'Semana' },
        { id: 'month', label: 'Mes'    },
        { id: 'year',  label: 'Año'    }
    ];

    return (
        <div className="min-h-screen bg-sys-50 p-4 md:p-8 space-y-8 overflow-y-auto">

            {/* HEADER */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-black text-sys-900 tracking-tighter flex items-center gap-3">
                        <Activity className="text-brand" size={30} />
                        Analytics
                    </h1>
                    <p className="text-sm text-sys-500 font-medium mt-1">
                        {activeBranchId === 'ALL' ? 'Consolidado todas las sucursales' : activeBranchName}
                        {' · '}Visión financiera en tiempo real
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex bg-white border border-sys-200 p-1 rounded-xl shadow-sm gap-1">
                        {periods.map(p => (
                            <button
                                key={p.id}
                                onClick={() => setPeriod(p.id)}
                                className={`px-4 py-2 rounded-lg text-xs font-black transition-all ${
                                    period === p.id
                                    ? 'bg-brand text-white shadow-sm'
                                    : 'text-sys-500 hover:bg-sys-100'
                                }`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={refetch}
                        title="Actualizar"
                        className="p-2.5 rounded-xl bg-white border border-sys-200 text-sys-500 hover:text-sys-900 hover:bg-sys-100 transition-all"
                    >
                        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* SWITCHER DE MODO */}
            <div className="flex justify-center">
                <div className="bg-white border border-sys-200 p-1.5 rounded-2xl flex gap-1 shadow-sm">
                    <button
                        onClick={() => setViewMode('ECONOMIC')}
                        className={`flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-black tracking-wide transition-all ${
                            viewMode === 'ECONOMIC'
                            ? 'bg-brand text-white shadow-md'
                            : 'text-sys-500 hover:bg-sys-100'
                        }`}
                    >
                        <TrendingUp size={16} /> Rentabilidad (P&amp;L)
                    </button>
                    <button
                        onClick={() => setViewMode('FINANCIAL')}
                        className={`flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-black tracking-wide transition-all ${
                            viewMode === 'FINANCIAL'
                            ? 'bg-brand text-white shadow-md'
                            : 'text-sys-500 hover:bg-sys-100'
                        }`}
                    >
                        <Wallet size={16} /> Flujo de Efectivo
                    </button>
                </div>
            </div>

            {/* KPI GRID */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {viewMode === 'ECONOMIC' ? (
                    <>
                        <KPICard title="Ventas Netas"       value={stats.revenue}                                    icon={DollarSign}  color="blue"    sub="Ingresos del periodo" />
                        <KPICard title="Costo Mercadería"   value={stats.cost}                                       icon={Package}     color="amber"   sub="Costo de Venta (COGS)" />
                        <KPICard title="Gastos Operativos"  value={stats.expenses}                                   icon={HandCoins}   color="rose"    sub="Gastos Fijos" />
                        <KPICard title="Utilidad Bruta"     value={stats.revenue - stats.cost}                       icon={TrendingUp}  color="emerald" sub="Margen Bruto Real" isProfit />
                    </>
                ) : (
                    <>
                        <KPICard title="Ingresos Caja"      value={stats.revenue}                                    icon={ArrowUpRight} color="blue"   sub="Dinero Entrante" />
                        <KPICard title="Pagos Proveedor"    value={stats.purchases}                                  icon={Truck}        color="amber"  sub="Salida por Mercadería" />
                        <KPICard title="Pagos Fijos"        value={stats.expenses}                                   icon={HandCoins}    color="rose"   sub="Luz, Sueldos, etc." />
                        <KPICard title="Caja Neta"          value={stats.revenue - (stats.purchases + stats.expenses)} icon={Wallet}     color="emerald" sub="Disponible en Mano" isProfit />
                    </>
                )}
            </div>

            {/* CHARTS */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* BARCHART */}
                <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-sys-200 shadow-sm">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h3 className="text-base font-black text-sys-900 uppercase">
                                {viewMode === 'ECONOMIC' ? 'Evolución de Rentabilidad' : 'Movimientos de Tesorería'}
                            </h3>
                            <p className="text-xs text-sys-400 font-medium mt-0.5">
                                {viewMode === 'ECONOMIC' ? 'Ventas vs Costos de Producto' : 'Entradas vs Salidas Reales'}
                            </p>
                        </div>
                        <div className="flex gap-4">
                            {viewMode === 'ECONOMIC' ? (
                                <>
                                    <LegendDot color={COLORS.sales}    label="Ventas" />
                                    <LegendDot color={COLORS.cogs}     label="Costo" />
                                    <LegendDot color={COLORS.profit}   label="Ganancia" />
                                </>
                            ) : (
                                <>
                                    <LegendDot color={COLORS.sales}    label="Ingresos" />
                                    <LegendDot color={COLORS.supplier} label="Pagos" />
                                    <LegendDot color={COLORS.profit}   label="Neto" />
                                </>
                            )}
                        </div>
                    </div>

                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={historyData} barGap={4}>
                            <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 700 }} dy={8} />
                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `$${v >= 1000 ? (v/1000).toFixed(0) + 'k' : v}`} />
                            <RechartsTooltip cursor={{ fill: '#f8fafc' }} formatter={v => formatCurrency(v)} contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }} />
                            {viewMode === 'ECONOMIC' ? (
                                <>
                                    <Bar dataKey="Ventas"   fill={COLORS.sales}    radius={[6,6,0,0]} barSize={36} minPointSize={4} />
                                    <Bar dataKey="Costos"   fill={COLORS.cogs}     radius={[6,6,0,0]} barSize={28} minPointSize={4} />
                                    <Bar dataKey="Ganancia" fill={COLORS.profit}   radius={[6,6,0,0]} barSize={18} minPointSize={4} />
                                </>
                            ) : (
                                <>
                                    <Bar dataKey="Entradas" fill={COLORS.sales}    radius={[6,6,0,0]} barSize={36} minPointSize={4} />
                                    <Bar dataKey="Salidas"  fill={COLORS.supplier} radius={[6,6,0,0]} barSize={28} minPointSize={4} />
                                    <Bar dataKey="CajaNeta" fill={COLORS.profit}   radius={[6,6,0,0]} barSize={18} minPointSize={4} />
                                </>
                            )}
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* PIE — MÉTODOS DE COBRO */}
                <div className="bg-white p-6 rounded-2xl border border-sys-200 shadow-sm flex flex-col">
                    <h3 className="text-base font-black text-sys-900 uppercase mb-4">Métodos de Cobro</h3>
                    <div className="flex-1 min-h-[260px]">
                        {payments.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={payments} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="60%" outerRadius="80%" paddingAngle={5}>
                                        {payments.map((_, i) => <Cell key={i} fill={COLORS.pie[i % COLORS.pie.length]} />)}
                                    </Pie>
                                    <RechartsTooltip formatter={v => formatCurrency(v)} contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }} />
                                    <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: '800', paddingTop: '16px' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <p className="text-center text-sys-400 mt-20 font-bold text-sm">Sin datos de cobros</p>
                        )}
                    </div>
                </div>

            </div>

            {/* RANKINGS */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-10">

                {/* TOP PROVEEDORES */}
                <div className="bg-white p-6 rounded-2xl border border-sys-200 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="text-sm font-black text-sys-900 uppercase flex items-center gap-2">
                            <Truck size={16} className="text-amber-500" /> Mayores Pagos a Proveedores
                        </h4>
                        <button
                            onClick={() => setCashFlowModal({ open: true, tab: 'suppliers' })}
                            className="text-[10px] font-black text-brand hover:underline uppercase tracking-wide"
                        >
                            Ver más
                        </button>
                    </div>
                    <div className="space-y-3">
                        {suppliers.length > 0 ? suppliers.map((s, i) => (
                            <div key={i} className="flex items-center justify-between px-4 py-3 bg-sys-50 rounded-xl border border-sys-100">
                                <div className="flex items-center gap-3">
                                    <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center text-amber-600 font-black text-[10px]">#{i+1}</div>
                                    <span className="font-bold text-sys-700 uppercase text-xs">{s.name}</span>
                                </div>
                                <span className="font-black text-sys-900 text-sm font-mono">{formatCurrency(s.value)}</span>
                            </div>
                        )) : <p className="text-center text-sys-400 italic py-8 text-sm">Sin movimientos registrados</p>}
                    </div>
                </div>

                {/* TOP PRODUCTOS */}
                <div className="bg-white p-6 rounded-2xl border border-sys-200 shadow-sm">
                    <h4 className="text-sm font-black text-sys-900 uppercase mb-4 flex items-center gap-2">
                        <Package size={16} className="text-emerald-500" /> Productos Más Rentables
                    </h4>
                    <div className="space-y-3">
                        {products.length > 0 ? products.map((p, i) => (
                            <div key={i} className="flex items-center justify-between px-4 py-3 bg-emerald-50 rounded-xl border border-emerald-100 hover:bg-emerald-500 hover:border-emerald-500 transition-all cursor-default group">
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-emerald-400 group-hover:bg-white transition-colors"></div>
                                    <span className="font-bold text-sys-700 uppercase text-xs group-hover:text-white transition-colors">{p.name}</span>
                                </div>
                                <span className="font-black text-emerald-600 text-sm font-mono group-hover:text-white transition-colors">+{formatCurrency(p.profit)}</span>
                            </div>
                        )) : <p className="text-center text-sys-400 italic py-8 text-sm">Sin datos de rentabilidad</p>}
                    </div>
                </div>

                {/* DETALLE DE GASTOS */}
                <div className="bg-white p-6 rounded-2xl border border-sys-200 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="text-sm font-black text-sys-900 uppercase flex items-center gap-2">
                            <HandCoins size={16} className="text-rose-500" /> Detalle de Gastos
                        </h4>
                        <button
                            onClick={() => setCashFlowModal({ open: true, tab: 'expenses' })}
                            className="text-[10px] font-black text-brand hover:underline uppercase tracking-wide"
                        >
                            Ver más
                        </button>
                    </div>
                    <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                        {expenseList.length > 0 ? expenseList.map((e, i) => (
                            <div key={i} className="flex items-center justify-between px-4 py-3 bg-sys-50 rounded-xl border border-sys-100">
                                <div className="min-w-0">
                                    <p className="font-bold text-sys-700 text-xs truncate">{e.description}</p>
                                    <p className="text-[10px] text-sys-400 font-mono mt-0.5">
                                        {new Date(e.date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })} · {e.user}
                                    </p>
                                </div>
                                <span className="font-black text-rose-600 text-sm font-mono shrink-0 ml-3">-{formatCurrency(e.amount)}</span>
                            </div>
                        )) : <p className="text-center text-sys-400 italic py-8 text-sm">Sin gastos registrados</p>}
                    </div>
                </div>

            </div>

            <CashFlowExplorerModal
                isOpen={cashFlowModal.open}
                initialTab={cashFlowModal.tab}
                onClose={() => setCashFlowModal(prev => ({ ...prev, open: false }))}
            />

        </div>
    );
};

// =================================================================
// SUBCOMPONENTES
// =================================================================

const KPICard = ({ title, value, icon: Icon, color, sub, isProfit }) => {
    const colorMap = {
        blue:    { bg: 'bg-blue-50',    text: 'text-blue-600',    val: 'text-blue-700'    },
        amber:   { bg: 'bg-amber-50',   text: 'text-amber-600',   val: 'text-amber-700'   },
        rose:    { bg: 'bg-rose-50',    text: 'text-rose-600',    val: 'text-rose-700'    },
        emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', val: 'text-emerald-700' },
    };
    const c = colorMap[color] || colorMap.blue;

    return (
        <div className="bg-white p-5 rounded-2xl border border-sys-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-3">
                <div className={`p-3 rounded-xl ${c.bg} ${c.text}`}>
                    <Icon size={20} />
                </div>
                {isProfit && (
                    <span className="bg-emerald-100 text-emerald-600 text-[9px] font-black px-2 py-1 rounded-lg uppercase tracking-wide">
                        Utilidad
                    </span>
                )}
            </div>
            <p className="text-[10px] font-black text-sys-400 uppercase tracking-widest mb-1">{title}</p>
            <p className={`text-2xl font-black tracking-tighter ${c.val}`}>{formatCurrency(value)}</p>
            <p className="text-[10px] font-bold text-sys-400 mt-1.5 flex items-center gap-1">
                <Activity size={9} /> {sub}
            </p>
        </div>
    );
};

const LegendDot = ({ color, label }) => (
    <div className="flex items-center gap-1.5">
        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }}></div>
        <span className="text-[10px] font-black text-sys-500 uppercase tracking-wide">{label}</span>
    </div>
);
