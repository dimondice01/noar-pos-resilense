import React, { useState, useMemo } from 'react';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, 
    PieChart, Pie, Cell
} from 'recharts';
import { 
    TrendingUp, DollarSign, ShoppingBag, Calendar, Building2, 
    ArrowUpRight, Truck, Wallet, Activity, Layers, HandCoins, CreditCard, AlertCircle
} from 'lucide-react';
import { useBusinessIntelligence } from '../hooks/useBusinessIntelligence';
import { useAuthStore } from '../../auth/store/useAuthStore';

// =================================================================
// 🎨 SISTEMA DE DISEÑO & PALETA FINANCIERA
// =================================================================
const COLORS = {
    sales: '#2563eb',      // Azul (Ingresos)
    cogs: '#f59e0b',       // Naranja (Costo Mercadería Vendida)
    profit: '#10b981',     // Verde (Ganancia Neta)
    supplier: '#ef4444',   // Rojo (Pago a Proveedores - Salida de Caja)
    expense: '#f43f5e',    // Rojo Rosado (Gastos Operativos)
    pie: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6366f1']
};

// 🛡️ FORMATEADORES BLINDADOS
const money = (val) => {
    if (val === undefined || val === null || isNaN(val)) return '$ 0';
    return '$ ' + Number(val).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const percent = (val) => {
    if (val === undefined || val === null || isNaN(val)) return '0%';
    return Number(val).toFixed(1) + '%';
};

export const AnalyticsDashboard = () => {
    // 1. CONEXIÓN AL STORE GLOBAL (Zustand)
    const { activeBranchId, activeBranchName } = useAuthStore();
    
    // --- ESTADOS DE UI LOCAL ---
    const [viewMode, setViewMode] = useState('ECONOMIC'); // 'ECONOMIC' | 'FINANCIAL'

    // --- HOOK DE INTELIGENCIA (Consumo Automático) ---
    const { 
        metrics, loading, period, setPeriod 
    } = useBusinessIntelligence();

    // 2. PROCESAMIENTO DE LÓGICA DE NEGOCIO (EL CEREBRO)
    const intelligence = useMemo(() => {
        const raw = metrics || {};
        const global = raw.global || {};

        // --- EXTRACCIÓN DE DATOS CRUDOS ---
        const VENTA_TOTAL = Number(global.revenue || 0);
        
        // ECONOMÍA (Teoría - Estado de Resultados):
        const COSTO_MERCADERIA_VENDIDA = Number(global.cost || 0); // COGS
        
        // FINANZAS (Realidad - Flujo de Caja):
        const PAGOS_PROVEEDORES = Number(global.purchases || 0); // Dinero real saliente a proveedores
        const GASTOS_OPERATIVOS = Number(global.expenses || 0); // Luz, Agua, Alquiler

        // --- CÁLCULOS VISIÓN ECONÓMICA (Rentabilidad) ---
        const utilidadBruta = VENTA_TOTAL - COSTO_MERCADERIA_VENDIDA; 
        const utilidadNetaOperativa = utilidadBruta - GASTOS_OPERATIVOS; 
        const margenNeto = VENTA_TOTAL > 0 ? (utilidadNetaOperativa / VENTA_TOTAL) * 100 : 0;

        // --- CÁLCULOS VISIÓN FINANCIERA (Caja / Cash Flow) ---
        const totalSalidasCaja = PAGOS_PROVEEDORES + GASTOS_OPERATIVOS;
        const flujoNetoCaja = VENTA_TOTAL - totalSalidasCaja;

        // --- PREPARACIÓN GRÁFICO HISTÓRICO ---
        const historyData = (raw.historyChart || []).map(h => {
            const vta = Number(h.Ventas || 0);
            
            if (viewMode === 'ECONOMIC') {
                const cogs = Number(h.COGS || 0); 
                const gas = Number(h.Gastos || 0);
                return {
                    name: h.name || '---',
                    Ingresos: vta,
                    CostoVenta: cogs,
                    Gastos: gas,
                    Resultado: vta - cogs - gas 
                };
            } else {
                const compras = Number(h.Compras || 0);
                const gas = Number(h.Gastos || 0);
                return {
                    name: h.name || '---',
                    Ingresos: vta,
                    SalidasStock: compras,
                    SalidasFijas: gas,
                    FlujoNeto: vta - (compras + gas) 
                };
            }
        });

        // --- PREPARACIÓN GRÁFICO TORTA ---
        const pieData = Array.isArray(raw.paymentChart) 
            ? raw.paymentChart.filter(p => p && p.value > 0) 
            : [];

        return {
            economic: {
                sales: VENTA_TOTAL,
                cogs: COSTO_MERCADERIA_VENDIDA,
                expenses: GASTOS_OPERATIVOS,
                netProfit: utilidadNetaOperativa,
                netMargin: margenNeto,
                avgTicket: Number(global.avgTicket || 0)
            },
            financial: {
                inflow: VENTA_TOTAL, 
                outflowStock: PAGOS_PROVEEDORES,
                outflowOpEx: GASTOS_OPERATIVOS,
                netCashFlow: flujoNetoCaja
            },
            charts: {
                main: historyData,
                pie: pieData,
                suppliers: Array.isArray(raw.topSuppliers) ? raw.topSuppliers : [],
                products: Array.isArray(raw.topProfit) ? raw.topProfit : []
            }
        };

    }, [metrics, viewMode]);

    // RENDERIZADO DE CARGA
    if (loading) return <LoadingScreen />;

    // EXTRACCIÓN PARA RENDER
    const { economic, financial, charts } = intelligence;

    return (
        <div className="h-screen flex flex-col bg-sys-50 font-sans text-sys-900 overflow-hidden">
            
            {/* === HEADER DE COMANDO === */}
            <header className="bg-white border-b border-sys-200 px-4 md:px-8 py-5 shrink-0 shadow-sm z-20 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-black tracking-tight flex items-center gap-3 text-sys-900">
                        <Activity className="text-brand" size={28} />
                        NEXUS INTELLIGENCE
                    </h1>
                    <div className="flex items-center gap-2 mt-1">
                        <span className={`w-2 h-2 rounded-full animate-pulse ${activeBranchId === 'ALL' ? 'bg-indigo-500' : 'bg-emerald-500'}`}></span>
                        <p className="text-xs font-bold text-sys-500 uppercase tracking-wide">
                            {activeBranchId === 'ALL' ? 'CONSOLIDADO GLOBAL (Todas las Sucursales)' : activeBranchName || 'Sucursal Desconocida'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3 bg-sys-100 p-1.5 rounded-xl border border-sys-200 w-full md:w-auto">
                    <div className="relative group flex-1 md:flex-none">
                        <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-500 pointer-events-none"/>
                        <select 
                            value={period} 
                            onChange={(e) => setPeriod(e.target.value)}
                            className="w-full md:w-auto pl-9 pr-8 py-2 bg-white rounded-lg text-xs font-bold shadow-sm border border-sys-200 outline-none focus:border-brand cursor-pointer hover:bg-sys-50 transition-all appearance-none"
                        >
                            <option value="today">Hoy</option>
                            <option value="week">Esta Semana</option>
                            <option value="month">Este Mes</option>
                            <option value="last_6_months">Últimos 6 Meses</option>
                            <option value="year">Este Año</option>
                        </select>
                    </div>
                    
                    {activeBranchId !== 'ALL' && (
                        <div className="px-3 py-2 bg-white rounded-lg border border-sys-200 shadow-sm flex items-center gap-2 shrink-0">
                             <Building2 size={14} className="text-sys-400"/>
                             <span className="text-xs font-bold text-sys-700 hidden sm:inline-block">{activeBranchName}</span>
                        </div>
                    )}
                </div>
            </header>

            {/* === BODY SCROLLEABLE === */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
                
                {/* SWITCHER DE MODO (ECONÓMICO vs FINANCIERO) */}
                <div className="flex justify-center mb-8">
                    <div className="bg-white p-1.5 rounded-2xl border border-sys-200 shadow-sm flex flex-col sm:flex-row gap-1 w-full sm:w-auto overflow-hidden">
                        <ModeButton 
                            active={viewMode === 'ECONOMIC'} 
                            onClick={() => setViewMode('ECONOMIC')} 
                            icon={TrendingUp} 
                            title="Rentabilidad Económica"
                            desc="P&L: Ventas vs Costos (Devengado)"
                        />
                        <ModeButton 
                            active={viewMode === 'FINANCIAL'} 
                            onClick={() => setViewMode('FINANCIAL')} 
                            icon={Wallet} 
                            title="Flujo de Caja Real"
                            desc="Cash Flow: Entradas vs Salidas (Percibido)"
                        />
                    </div>
                </div>

                {/* === SECCIÓN DE TARJETAS KPIs === */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6 mb-8">
                    {viewMode === 'ECONOMIC' ? (
                        <>
                            <KpiCard 
                                title="Ventas Netas" value={economic.sales} 
                                icon={DollarSign} color="blue" 
                                sub={`Ticket Promedio: ${money(economic.avgTicket)}`} 
                            />
                            <KpiCard 
                                title="Costo Mercadería (COGS)" value={economic.cogs} 
                                icon={ShoppingBag} color="amber" 
                                sub="Consumo de Inventario" 
                            />
                            <KpiCard 
                                title="Gastos Operativos" value={economic.expenses} 
                                icon={Layers} color="red" 
                                sub="Servicios y Estructura" 
                            />
                            <ProfitCard 
                                title="Ganancia Neta Real" 
                                value={economic.netProfit} 
                                margin={economic.netMargin}
                                sub="Utilidad Operativa Final"
                            />
                        </>
                    ) : (
                        <>
                            <KpiCard 
                                title="Ingresos a Caja" value={financial.inflow} 
                                icon={ArrowUpRight} color="green" 
                                sub="Dinero Recaudado" 
                            />
                            <KpiCard 
                                title="Pagos a Proveedores" value={financial.outflowStock} 
                                icon={Truck} color="violet" 
                                sub="Salida de Efectivo por Compras" 
                            />
                            <KpiCard 
                                title="Pagos Operativos" value={financial.outflowOpEx} 
                                icon={Wallet} color="red" 
                                sub="Pago de Gastos Fijos" 
                            />
                            <CashFlowCard 
                                title="Flujo de Caja Neto" 
                                value={financial.netCashFlow} 
                                sub="Dinero libre generado en el periodo"
                            />
                        </>
                    )}
                </div>

                {/* === GRÁFICO PRINCIPAL === */}
                <div className="bg-white rounded-3xl p-4 md:p-6 border border-sys-200 shadow-sm mb-8">
                    <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4">
                        <div>
                            <h3 className="text-lg font-black text-sys-900">
                                {viewMode === 'ECONOMIC' ? 'Evolución de Rentabilidad' : 'Movimientos de Tesorería'}
                            </h3>
                            <p className="text-xs text-sys-400 font-medium mt-1">
                                {viewMode === 'ECONOMIC' 
                                    ? 'Comparativa Temporal: Ventas vs Costo de Venta (¿Cuánto gané?)' 
                                    : 'Comparativa Temporal: Entradas vs Salidas de dinero (¿Cuánto me queda?)'}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            {viewMode === 'ECONOMIC' ? (
                                <>
                                    <LegendItem color={COLORS.sales} label="Ventas" />
                                    <LegendItem color={COLORS.cogs} label="Costo Venta" />
                                    <LegendItem color={COLORS.profit} label="Ganancia Neta" />
                                </>
                            ) : (
                                <>
                                    <LegendItem color={COLORS.sales} label="Ingresos" />
                                    <LegendItem color={COLORS.supplier} label="Pago Prov." />
                                    <LegendItem color={COLORS.expense} label="Gastos" />
                                </>
                            )}
                        </div>
                    </div>

                    <div className="w-full h-[300px] md:h-[350px]" key={`chart-${activeBranchId}-${viewMode}`}>
                        {charts.main.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={charts.main} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barGap={2} barCategoryGap="20%">
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 10, fontWeight: 700}} dy={10} />
                                    <YAxis axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 10}} tickFormatter={(val) => `$${val/1000}k`} />
                                    <RechartsTooltip 
                                        cursor={{fill: '#f9fafb'}}
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', fontSize: '12px', fontWeight: 'bold' }}
                                        formatter={(val) => money(val)}
                                    />
                                    {viewMode === 'ECONOMIC' ? (
                                        <>
                                            <Bar dataKey="Ingresos" name="Ventas" fill={COLORS.sales} radius={[4,4,0,0]} maxBarSize={40} />
                                            <Bar dataKey="CostoVenta" name="Costo Venta" fill={COLORS.cogs} radius={[4,4,0,0]} maxBarSize={40} />
                                            <Bar dataKey="Resultado" name="Ganancia" fill={COLORS.profit} radius={[4,4,0,0]} maxBarSize={40} />
                                        </>
                                    ) : (
                                        <>
                                            <Bar dataKey="Ingresos" name="Entradas" fill={COLORS.sales} radius={[4,4,0,0]} maxBarSize={40} />
                                            <Bar dataKey="SalidasStock" name="Pago Proveedor" fill={COLORS.supplier} radius={[4,4,0,0]} maxBarSize={40} />
                                            <Bar dataKey="SalidasFijas" name="Gastos" fill={COLORS.expense} radius={[4,4,0,0]} maxBarSize={40} />
                                        </>
                                    )}
                                </BarChart>
                            </ResponsiveContainer>
                        ) : <EmptyState text="No hay datos suficientes para graficar en este periodo" />}
                    </div>
                </div>

                {/* === RANKINGS Y PIE CHART === */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pb-10">
                    
                    {/* MIX DE COBROS */}
                    <div className="bg-white rounded-3xl p-6 shadow-sm border border-sys-200 flex flex-col h-[400px]">
                        <h3 className="font-black text-sys-900 text-sm uppercase mb-4 flex items-center gap-2">
                            <CreditCard size={18} className="text-sys-400"/> Medios de Cobro
                        </h3>
                        <div className="flex-1 w-full h-full min-h-0 relative" key={`pie-${activeBranchId}`}>
                            {charts.pie.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie 
                                            data={charts.pie} dataKey="value" nameKey="name" cx="50%" cy="50%" 
                                            innerRadius="60%" outerRadius="80%" paddingAngle={5}
                                        >
                                            {charts.pie.map((e, i) => <Cell key={`cell-${i}`} fill={COLORS.pie[i % COLORS.pie.length]} />)}
                                        </Pie>
                                        <RechartsTooltip 
                                            formatter={(val) => money(val)} 
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '12px', fontWeight: 'bold' }}
                                        />
                                        <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }}/>
                                    </PieChart>
                                </ResponsiveContainer>
                            ) : <EmptyState text="Sin datos de cobros" />}
                        </div>
                    </div>

                    {/* TOP PROVEEDORES */}
                    <div className="bg-white rounded-3xl p-6 shadow-sm border border-sys-200 flex flex-col h-[400px]">
                        <h3 className="font-black text-sys-900 text-sm uppercase mb-4 flex items-center gap-2">
                            <Truck size={18} className="text-sys-400"/> Top Proveedores
                        </h3>
                        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                            {charts.suppliers.length > 0 ? (
                                <div className="space-y-3">
                                    {charts.suppliers.map((sup, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-sys-50/50 hover:bg-sys-50 transition-colors">
                                            <div className="flex items-center gap-3 overflow-hidden">
                                                <div className="w-6 h-6 rounded bg-violet-100 text-violet-600 flex items-center justify-center text-[10px] font-black shrink-0">#{idx+1}</div>
                                                <span className="text-xs font-bold text-sys-700 truncate uppercase" title={sup.name}>{sup.name}</span>
                                            </div>
                                            <span className="text-xs font-mono font-bold text-sys-900 shrink-0 ml-2">{money(sup.value)}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : <EmptyState text="Sin pagos a proveedores registrados" />}
                        </div>
                    </div>

                    {/* PRODUCTOS RENTABLES */}
                    <div className="bg-white rounded-3xl p-6 shadow-sm border border-sys-200 flex flex-col h-[400px]">
                        <h3 className="font-black text-sys-900 text-sm uppercase mb-4 flex items-center gap-2">
                            <TrendingUp size={18} className="text-emerald-500"/> Rentabilidad x Producto
                        </h3>
                        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                            {charts.products.length > 0 ? (
                                <div className="space-y-3">
                                    {charts.products.map((prod, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-3 rounded-xl hover:bg-emerald-50/30 transition-colors border-b border-dashed border-sys-100 last:border-0">
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></div>
                                                <span className="text-[10px] sm:text-xs font-bold text-sys-700 truncate uppercase" title={prod.name}>{prod.name}</span>
                                            </div>
                                            <span className="text-xs font-black text-emerald-600 shrink-0 ml-2">+{money(prod.profit)}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : <EmptyState text="Sin datos de ganancia por producto" />}
                        </div>
                    </div>

                </div>

            </div>
        </div>
    );
};

// =================================================================
// 🧩 UI COMPONENTS
// =================================================================

const LoadingScreen = () => (
    <div className="h-screen flex flex-col items-center justify-center bg-sys-50 gap-4">
        <div className="relative">
            <div className="w-16 h-16 border-4 border-sys-200 border-t-brand rounded-full animate-spin"></div>
            <Activity className="absolute inset-0 m-auto text-brand animate-pulse" size={24}/>
        </div>
        <p className="text-xs font-black tracking-[0.2em] text-sys-400 uppercase">Procesando Big Data...</p>
    </div>
);

const EmptyState = ({ text = "Sin información" }) => (
    <div className="h-full flex flex-col items-center justify-center text-sys-300 opacity-60">
        <AlertCircle size={32} strokeWidth={1} className="mb-2"/>
        <p className="text-xs font-medium text-center px-4">{text}</p>
    </div>
);

const LegendItem = ({ color, label }) => (
    <div className="flex items-center gap-1.5">
        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }}></div>
        <span className="text-[10px] font-bold text-sys-600 uppercase">{label}</span>
    </div>
);

const ModeButton = ({ active, onClick, icon: Icon, title, desc }) => (
    <button 
        onClick={onClick}
        className={`
            px-4 sm:px-6 py-3 rounded-xl flex items-center justify-center sm:justify-start gap-3 transition-all duration-300 border w-full sm:w-auto
            ${active 
                ? 'bg-sys-900 text-white border-sys-900 shadow-lg transform sm:scale-[1.02]' 
                : 'bg-white text-sys-500 border-transparent hover:bg-sys-50'
            }
        `}
    >
        <div className={`p-2 rounded-lg shrink-0 ${active ? 'bg-white/10 text-white' : 'bg-sys-100 text-sys-500'}`}>
            <Icon size={18} />
        </div>
        <div className="text-left hidden sm:block">
            <p className="text-xs font-black uppercase tracking-wide">{title}</p>
            <p className={`text-[10px] ${active ? 'text-white/60' : 'text-sys-400'}`}>{desc}</p>
        </div>
    </button>
);

const KpiCard = ({ title, value, icon: Icon, color, sub }) => {
    const styles = {
        blue: 'bg-blue-50 text-blue-600',
        amber: 'bg-amber-50 text-amber-600',
        red: 'bg-red-50 text-red-600',
        green: 'bg-emerald-50 text-emerald-600',
        violet: 'bg-violet-50 text-violet-600'
    }[color] || 'bg-sys-100 text-sys-600';

    return (
        <div className="bg-white p-5 md:p-6 rounded-3xl shadow-sm border border-sys-200 hover:shadow-md transition-all">
            <div className="flex justify-between items-start mb-4">
                <div className={`p-3 rounded-2xl ${styles}`}><Icon size={20} className="md:w-6 md:h-6"/></div>
            </div>
            <p className="text-[9px] md:text-[10px] font-bold text-sys-400 uppercase tracking-wider mb-1">{title}</p>
            <h3 className="text-xl md:text-2xl font-black text-sys-900 truncate">{money(value)}</h3>
            <p className="text-[9px] md:text-[10px] text-sys-400 mt-2 font-medium truncate">{sub}</p>
        </div>
    );
};

const ProfitCard = ({ title, value, margin, sub }) => (
    <div className="bg-gradient-to-br from-sys-900 to-sys-800 rounded-3xl p-5 md:p-6 text-white shadow-xl flex flex-col justify-between relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10"><TrendingUp size={80} /></div>
        <div className="relative z-10">
            <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-white/10 rounded-2xl text-emerald-400"><HandCoins size={20} className="md:w-6 md:h-6"/></div>
                <div className="text-right">
                    <p className="text-[9px] md:text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Margen Neto</p>
                    <p className="text-lg md:text-xl font-black">{percent(margin)}</p>
                </div>
            </div>
            <p className="text-[9px] md:text-[10px] font-bold text-sys-400 uppercase tracking-wider mb-1">{title}</p>
            <h3 className="text-2xl md:text-3xl font-black truncate">{money(value)}</h3>
            <p className="text-[9px] md:text-[10px] text-white/50 mt-2 font-medium truncate">{sub}</p>
        </div>
    </div>
);

const CashFlowCard = ({ title, value, sub }) => {
    const numericValue = parseFloat(value || 0);
    const isPositive = numericValue >= 0;
    
    return (
        <div className={`rounded-3xl p-5 md:p-6 shadow-xl flex flex-col justify-between relative overflow-hidden ${isPositive ? 'bg-emerald-600' : 'bg-red-600'} text-white`}>
            <div className="absolute -right-4 -bottom-4 opacity-20"><Wallet size={100} /></div>
            <div className="relative z-10">
                <div className="flex justify-between items-start mb-4">
                    <div className="p-3 bg-white/20 rounded-2xl text-white"><Wallet size={20} className="md:w-6 md:h-6"/></div>
                    <span className="bg-black/20 px-2 py-1 rounded text-[9px] md:text-[10px] font-bold uppercase">{isPositive ? 'Superávit' : 'Déficit'}</span>
                </div>
                <p className="text-[9px] md:text-[10px] font-bold text-white/70 uppercase tracking-wider mb-1">{title}</p>
                <h3 className="text-2xl md:text-3xl font-black truncate">{money(value)}</h3>
                <p className="text-[9px] md:text-[10px] text-white/70 mt-2 font-medium truncate">{sub}</p>
            </div>
        </div>
    );
};