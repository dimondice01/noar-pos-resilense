import React, { useState, useMemo } from 'react';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, 
    PieChart, Pie, Cell
} from 'recharts';
import { 
    TrendingUp, DollarSign, ShoppingBag, Calendar, Building2, 
    ArrowUpRight, Truck, Wallet, Activity, Layers, HandCoins, CreditCard, AlertCircle, RotateCcw,
    Zap, ShoppingCart, BarChart as BarChartIcon, LayoutDashboard, LineChart, Package, Search, RefreshCw
} from 'lucide-react';
import { useBusinessIntelligence } from '../hooks/useBusinessIntelligence';
import { useAuthStore } from '../../auth/store/useAuthStore';

// =================================================================
// 🎨 SISTEMA DE DISEÑO NEXUS PRO (PREMIUM)
// =================================================================
const COLORS = {
    sales: '#2563eb',      // Blue
    cogs: '#f59e0b',       // Orange
    profit: '#10b981',     // Green
    supplier: '#9333ea',   // Purple
    expense: '#f43f5e',    // Rose
    pie: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6366f1']
};

const formatCurrency = (val) => {
    if (!val || isNaN(val)) return '$ 0';
    return '$ ' + Number(val).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

export const AnalyticsDashboard = () => {
    const { activeBranchId, activeBranchName } = useAuthStore();
    const [viewMode, setViewMode] = useState('ECONOMIC'); 
    
    const { 
        metrics, loading, period, setPeriod, refetch 
    } = useBusinessIntelligence();

    // 🛡️ ACCESO DIRECTO A MÉTRICAS (Auditoría Nexus)
    const stats = metrics.global || {};
    const payments = metrics.paymentChart || [];
    const suppliers = metrics.topSuppliers || [];
    const products = metrics.topProfit || [];
    const history = metrics.historyChart || [];

    // 🕯️ EL MOTOR DE LAS VELAS (Mapeo Inteligente por Modo)
    const historyData = useMemo(() => {
        const rawChart = metrics.historyChart || [];
        return rawChart.map(h => {
            if (viewMode === 'ECONOMIC') {
                return {
                    name: h.name || '---',
                    Ventas: Number(h.Ingresos || 0),
                    Costos: Number(h.CostoVenta || 0),
                    Ganancia: Number((h.Ingresos || 0) - (h.CostoVenta || 0) - (h.Gastos || 0))
                };
            } else {
                return {
                    name: h.name || '---',
                    Entradas: Number(h.Ingresos || 0),
                    Salidas: Number((h.Compras || 0) + (h.Gastos || 0)),
                    CajaNeta: Number((h.Ingresos || 0) - ((h.Compras || 0) + (h.Gastos || 0)))
                };
            }
        });
    }, [metrics.historyChart, viewMode]);

    if (loading) return (
        <div className="h-screen flex flex-col items-center justify-center bg-sys-50 dark:bg-sys-900">
            <div className="w-16 h-16 border-4 border-border-default border-t-primary-500 rounded-full animate-spin"></div>
            <p className="mt-4 text-sys-500 font-bold animate-pulse tracking-widest uppercase text-xs">Sincronizando BI...</p>
        </div>
    );

    const periods = [
        { id: 'today', label: 'HOY' },
        { id: 'week', label: 'SEMANA' },
        { id: 'month', label: 'MES' },
        { id: 'year', label: 'AÑO' }
    ];

    return (
        <div className="min-h-screen bg-sys-50 dark:bg-sys-900 p-4 md:p-8 space-y-8 overflow-y-auto custom-scrollbar">
            
            {/* === HEADER DE COMANDO === */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                    <h1 className="text-4xl font-black text-sys-900 dark:text-white tracking-tighter flex items-center gap-3">
                        <Activity className="text-primary-500" size={36} />
                        INTELIGENCIA NEXUS
                    </h1>
                    <div className="flex items-center gap-2 mt-2">
                        <span className="px-2 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 rounded-md text-[10px] font-black uppercase">
                            {activeBranchId === 'ALL' ? 'Audit Consolidada' : activeBranchName}
                        </span>
                        <p className="text-sm text-sys-500 dark:text-sys-400 font-medium italic">Visión financiera y flujo de caja en tiempo real</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex bg-sys-100 dark:bg-sys-900 p-1.5 rounded-2xl shadow-inner border border-border-default dark:border-sys-800">
                        {periods.map(p => (
                            <button
                                key={p.id}
                                onClick={() => setPeriod(p.id)}
                                className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all ${
                                    period === p.id
                                    ? 'bg-sys-900 dark:bg-white text-white dark:text-sys-900 shadow-xl scale-105'
                                    : 'text-sys-500 dark:text-sys-400 hover:bg-white dark:hover:bg-sys-800'
                                }`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={refetch}
                        title="Actualizar desde la nube"
                        className="p-2.5 rounded-xl bg-sys-100 dark:bg-sys-900 border border-border-default dark:border-sys-800 text-sys-500 hover:text-sys-900 dark:hover:text-white transition-all"
                    >
                        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* SWITCHER DE MODO (ECONÓMICO vs FINANCIERO) */}
            <div className="flex justify-center">
                <div className="bg-sys-100 dark:bg-sys-900 p-2 rounded-[2rem] border border-border-default dark:border-sys-800 flex gap-2">
                    <button 
                        onClick={() => setViewMode('ECONOMIC')}
                        className={`flex items-center gap-3 px-8 py-4 rounded-2xl text-[10px] font-black tracking-widest transition-all ${
                            viewMode === 'ECONOMIC' 
                            ? 'bg-sys-900 dark:bg-white text-white dark:text-sys-900 shadow-2xl scale-105' 
                            : 'text-sys-500 dark:text-sys-400 hover:bg-sys-200 dark:hover:bg-sys-800'
                        }`}
                    >
                        <TrendingUp size={18} /> RENTABILIDAD (P&L)
                    </button>
                    <button 
                        onClick={() => setViewMode('FINANCIAL')}
                        className={`flex items-center gap-3 px-8 py-4 rounded-2xl text-[10px] font-black tracking-widest transition-all ${
                            viewMode === 'FINANCIAL' 
                            ? 'bg-sys-900 dark:bg-white text-white dark:text-sys-900 shadow-2xl scale-105' 
                            : 'text-sys-500 dark:text-sys-400 hover:bg-sys-200 dark:hover:bg-sys-800'
                        }`}
                    >
                        <Wallet size={18} /> FLUJO DE EFECTIVO
                    </button>
                </div>
            </div>

            {/* === KPI GRID === */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {viewMode === 'ECONOMIC' ? (
                    <>
                        <KPICard title="Ventas Netas" value={stats.revenue} icon={DollarSign} color="blue" sub="Ventas del periodo" />
                        <KPICard title="Costo Mercadería" value={stats.cost} icon={Package} color="amber" sub="Costo de Venta (COGS)" />
                        <KPICard title="Gastos Operativos" value={stats.expenses} icon={Zap} color="rose" sub="Gastos Fijos" />
                        <KPICard title="Utilidad Bruta" value={stats.revenue - stats.cost} icon={TrendingUp} color="emerald" sub="Margen Bruto Real" isProfit />
                    </>
                ) : (
                    <>
                        <KPICard title="Ingresos Caja" value={stats.revenue} icon={ArrowUpRight} color="blue" sub="Dinero Entrante" />
                        <KPICard title="Pagos Proveedor" value={stats.purchases} icon={Truck} color="amber" sub="Salida por Mercadería" />
                        <KPICard title="Pagos Fijos" value={stats.expenses} icon={HandCoins} color="rose" sub="Luz, Sueldos, etc." />
                        <KPICard title="Caja Neta" value={stats.revenue - (stats.purchases + stats.expenses)} icon={Wallet} color="emerald" sub="Disponible en Mano" isProfit />
                    </>
                )}
            </div>

            {/* === MAIN CHARTS === */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                <div className="lg:col-span-2 bg-white dark:bg-sys-900 p-8 rounded-[2.5rem] border border-border-subtle dark:border-sys-800">
                    <div className="flex justify-between items-center mb-10">
                        <div>
                            <h3 className="text-xl font-black text-sys-900 dark:text-white uppercase">
                                {viewMode === 'ECONOMIC' ? 'Evolución de Rentabilidad' : 'Movimientos de Tesorería'}
                            </h3>
                            <p className="text-sm text-sys-400 font-medium">{viewMode === 'ECONOMIC' ? 'Ventas vs Costos de Producto' : 'Entradas vs Salidas Reales'}</p>
                        </div>
                        <div className="flex gap-4">
                            {viewMode === 'ECONOMIC' ? (
                                <>
                                    <LegendDot color={COLORS.sales} label="Ventas" />
                                    <LegendDot color={COLORS.cogs} label="Costo Venta" />
                                    <LegendDot color={COLORS.profit} label="Ganancia" />
                                </>
                            ) : (
                                <>
                                    <LegendDot color={COLORS.sales} label="Ingresos" />
                                    <LegendDot color={COLORS.supplier} label="Pagos" />
                                    <LegendDot color={COLORS.profit} label="Neto" />
                                </>
                            )}
                        </div>
                    </div>

                    <div className="w-full flex justify-center" style={{ minHeight: '350px' }}>
                        <BarChart width={700} height={350} data={historyData}>
                            <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e2e8f0" />
                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11, fontWeight: 700}} dy={10} />
                            <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11}} tickFormatter={(v) => `$${v >= 1000 ? (v/1000).toFixed(0) + 'k' : v}`} />
                            <RechartsTooltip cursor={{fill: '#f1f5f9', opacity: 0.4}} formatter={(v) => formatCurrency(v)} />
                            
                            {viewMode === 'ECONOMIC' ? (
                                <>
                                    <Bar dataKey="Ventas" fill={COLORS.sales} radius={[6,6,0,0]} barSize={40} minPointSize={10} />
                                    <Bar dataKey="Costos" fill={COLORS.cogs} radius={[6,6,0,0]} barSize={30} minPointSize={10} />
                                    <Bar dataKey="Ganancia" fill={COLORS.profit} radius={[6,6,0,0]} barSize={20} minPointSize={10} />
                                </>
                            ) : (
                                <>
                                    <Bar dataKey="Entradas" fill={COLORS.sales} radius={[6,6,0,0]} barSize={40} minPointSize={10} />
                                    <Bar dataKey="Salidas" fill={COLORS.supplier} radius={[6,6,0,0]} barSize={30} minPointSize={10} />
                                    <Bar dataKey="CajaNeta" fill={COLORS.profit} radius={[6,6,0,0]} barSize={20} minPointSize={10} />
                                </>
                            )}
                        </BarChart>
                    </div>
                </div>

                {/* 🛒 MIX DE COBROS */}
                <div className="bg-white dark:bg-sys-900 p-8 rounded-[2.5rem] shadow-2xl shadow-soft dark:shadow-none border border-border-subtle dark:border-sys-800 flex flex-col">
                    <h3 className="text-xl font-black text-sys-900 dark:text-white uppercase tracking-tight mb-8">Métodos de Cobro</h3>
                    <div className="flex-1 min-h-[300px]">
                        {payments.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie 
                                        data={payments} dataKey="value" nameKey="name" cx="50%" cy="50%" 
                                        innerRadius="65%" outerRadius="85%" paddingAngle={6}
                                    >
                                        {payments.map((_, i) => <Cell key={i} fill={COLORS.pie[i % COLORS.pie.length]} />)}
                                    </Pie>
                                    <RechartsTooltip 
                                        formatter={(v) => formatCurrency(v)}
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                                    />
                                    <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: '800', paddingTop: '20px' }}/>
                                </PieChart>
                            </ResponsiveContainer>
                        ) : <p className="text-center text-sys-400 mt-20 font-bold">Sin datos de cobros</p>}
                    </div>
                </div>

            </div>

            {/* === BOTTOM RANKINGS === */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pb-10">
                
                {/* TOP PROVEEDORES */}
                <div className="bg-white dark:bg-sys-900 p-8 rounded-[2.5rem] border border-border-subtle dark:border-sys-800">
                    <h4 className="text-lg font-black text-sys-900 dark:text-white uppercase mb-6 flex items-center gap-2">
                        <Truck size={20} className="text-primary-500"/> Mayores Pagos a Proveedores
                    </h4>
                    <div className="space-y-4">
                        {suppliers.length > 0 ? suppliers.map((s, i) => (
                            <div key={i} className="flex items-center justify-between p-4 bg-sys-50 dark:bg-sys-800/50 rounded-2xl">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 font-black text-xs">#{i+1}</div>
                                    <span className="font-bold text-sys-700 dark:text-sys-300 uppercase text-xs">{s.name}</span>
                                </div>
                                <span className="font-black text-sys-900 dark:text-white">{formatCurrency(s.value)}</span>
                            </div>
                        )) : <p className="text-center text-sys-400 italic py-10">Sin movimientos registrados</p>}
                    </div>
                </div>

                {/* TOP PRODUCTOS */}
                <div className="bg-white dark:bg-sys-900 p-8 rounded-[2.5rem] border border-border-subtle dark:border-sys-800">
                    <h4 className="text-lg font-black text-sys-900 dark:text-white uppercase mb-6 flex items-center gap-2">
                        <Package size={20} className="text-emerald-500"/> Productos Más Rentables
                    </h4>
                    <div className="space-y-4">
                        {products.length > 0 ? products.map((p, i) => (
                            <div key={i} className="flex items-center justify-between p-4 bg-emerald-50/50 dark:bg-emerald-900/10 rounded-2xl group hover:bg-emerald-500 transition-all cursor-default">
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-emerald-400 group-hover:bg-white"></div>
                                    <span className="font-bold text-sys-700 dark:text-sys-300 uppercase text-xs group-hover:text-white">{p.name}</span>
                                </div>
                                <span className="font-black text-emerald-600 dark:text-emerald-400 group-hover:text-white">+{formatCurrency(p.profit)}</span>
                            </div>
                        )) : <p className="text-center text-sys-400 italic py-10">Sin datos de rentabilidad</p>}
                    </div>
                </div>

            </div>

        </div>
    );
};

// =================================================================
// 🧩 SUBCOMPONENTES UI
// =================================================================

const KPICard = ({ title, value, icon: Icon, color, sub, isProfit }) => {
    const colorClasses = {
        blue: 'bg-primary-50 dark:bg-primary-900/10 text-primary-600',
        amber: 'bg-amber-50 dark:bg-amber-900/10 text-amber-600',
        rose: 'bg-rose-50 dark:bg-rose-900/10 text-rose-600',
        emerald: 'bg-emerald-50 dark:bg-emerald-900/10 text-emerald-600'
    };

    return (
        <div className="bg-white dark:bg-sys-900 p-6 rounded-[2rem] shadow-xl shadow-soft dark:shadow-none border border-border-subtle dark:border-sys-800 transition-all hover:scale-[1.02] duration-300">
            <div className="flex justify-between items-start mb-4">
                <div className={`p-4 rounded-2xl ${colorClasses[color]}`}>
                    <Icon size={24} />
                </div>
                {isProfit && (
                    <div className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-tighter">
                        Utilidad Final
                    </div>
                )}
            </div>
            <h3 className="text-sm font-black text-sys-400 uppercase tracking-wider mb-1">{title}</h3>
            <p className="text-3xl font-black text-sys-900 dark:text-white tracking-tighter">{formatCurrency(value)}</p>
            <p className="text-[10px] font-bold text-sys-400 mt-2 flex items-center gap-1">
                <Activity size={10} /> {sub}
            </p>
        </div>
    );
};

const LegendDot = ({ color, label }) => (
    <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: color }}></div>
        <span className="text-[10px] font-black text-sys-400 uppercase tracking-widest">{label}</span>
    </div>
);