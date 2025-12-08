// src/modules/dashboard/pages/DashboardPage.jsx

import React, { useEffect, useState } from 'react';
import { 
    TrendingUp, Users, Package, AlertTriangle, 
    Wallet, ArrowRight, RefreshCw, DollarSign,
    Lock, Unlock, Monitor, FileText, CheckCircle2, History, X, 
    ShoppingBag, Banknote, Shield, Key, BarChart3, TrendingDown,
    Activity, Signal
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Stores & Repositorios
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import { productRepository } from '../../inventory/repositories/productRepository';
import { cashRepository } from '../../cash/repositories/cashRepository';
import { salesRepository } from '../../sales/repositories/salesRepository';

// 🔥 HOOK REAL-TIME
import { useCloudDashboard } from '../hooks/useCloudDashboard';

// UI
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import { TicketZModal } from '../../reports/components/TicketZModal'; 

// Modales Operativos
import { ExpenseModal } from '../../cash/components/ExpenseModal';
import { WithdrawalModal } from '../../cash/components/WithdrawalModal'; 

// =================================================================
// HELPERS
// =================================================================
const money = (val) => val ? val.toLocaleString('es-AR', {minimumFractionDigits: 2}) : '0.00';

const StatCard = ({ title, value, subtext, icon: Icon, colorClass, borderClass, bgClass }) => (
    <div className={cn("p-5 rounded-2xl border flex flex-col justify-between shadow-sm", borderClass, bgClass)}>
        <div className="flex justify-between items-start mb-2">
            <p className={cn("text-xs font-bold uppercase tracking-wider", colorClass)}>{title}</p>
            <div className={cn("p-2 rounded-lg bg-white/60", colorClass)}><Icon size={20} /></div>
        </div>
        <div>
            <h3 className={cn("text-2xl font-black tracking-tight", colorClass)}>{value}</h3>
            {subtext && <p className="text-xs text-sys-500 mt-1">{subtext}</p>}
        </div>
    </div>
);

// =================================================================
// 1. PANEL DE AUDITORÍA (SOLO ADMIN)
// =================================================================
const AdminCashAuditPanel = ({ allShifts, loadIntelligence, navigate }) => {
    const [isReportModalOpen, setIsReportModalOpen] = useState(false);
    const [reportData, setReportData] = useState(null);
    const [loadingAudit, setLoadingAudit] = useState(false);
    const [auditTarget, setAuditTarget] = useState(null);

    // Filtros
    const shiftsToAudit = allShifts.filter(s => s.status === 'CLOSED' && !s.audited);
    const openShifts = allShifts.filter(s => s.status === 'OPEN');
    const auditedShifts = allShifts.filter(s => s.status === 'CLOSED' && s.audited).sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));

    const handleStartAudit = async (shift) => {
        setLoadingAudit(true);
        try {
            const auditData = await cashRepository.getShiftAuditData(shift.id);
            setReportData({ 
                ...auditData, 
                actualCash: shift.finalCash, 
                expectedCash: shift.expectedCash, 
                deviation: shift.difference, 
                closeTime: shift.closedAt 
            });
            setAuditTarget(shift);
            setIsReportModalOpen(true);
        } catch (error) { alert(`❌ Error: ${error.message}`); } finally { setLoadingAudit(false); }
    };
    
    const handleViewClosedShift = async (shift) => {
        setLoadingAudit(true);
        try {
            const auditData = await cashRepository.getShiftAuditData(shift.id);
            setReportData({ 
                ...auditData, 
                actualCash: shift.finalCash, 
                expectedCash: shift.expectedCash, 
                deviation: shift.difference, 
                closeTime: shift.closedAt 
            });
            setAuditTarget(null);
            setIsReportModalOpen(true);
        } catch (err) { alert(err.message); } finally { setLoadingAudit(false); }
    };

    const handleModalClose = async () => {
        setIsReportModalOpen(false);
        if (auditTarget) {
            const confirm = window.confirm(`¿Confirmar auditoría de la caja de ${auditTarget.userId}?`);
            if (confirm) {
                try {
                    await cashRepository.updateShift({ ...auditTarget, audited: true });
                    await loadIntelligence();
                } catch (error) { alert("Error: " + error.message); }
            }
            setAuditTarget(null);
        }
    };
    
    return (
        <Card className="lg:col-span-3">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-xl text-sys-900 flex items-center gap-2">
                    <FileText size={24} className="text-brand"/> Auditoría de Cajas
                </h3>
                <Button variant="ghost" size="sm" onClick={() => navigate('/cash')} className="text-brand hover:bg-brand-light font-medium">
                    📜 Ir al Historial Completo
                </Button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 text-sm font-medium gap-6">
                <div className="md:col-span-2 space-y-3">
                    <p className="text-xs font-semibold uppercase text-sys-500 mb-2">Pendientes de Revisión ({shiftsToAudit.length})</p>
                    {shiftsToAudit.length === 0 ? (
                        <div className="bg-green-50 text-green-700 p-4 rounded-xl border border-green-200 flex items-center gap-3">
                            <CheckCircle2/> <p>Todo al día. No hay cierres pendientes.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {shiftsToAudit.map(s => (
                                <div key={s.id} className="p-4 bg-red-50 rounded-xl border border-red-200 flex justify-between items-center animate-in slide-in-from-left-2">
                                    <div>
                                        <p className="font-bold text-red-700">Cierre de: {s.userId}</p>
                                        <div className="flex gap-3 text-xs text-sys-600 mt-1">
                                            <span>Hora: {new Date(s.closedAt).toLocaleTimeString()}</span>
                                            <span className={cn("font-bold", s.difference !== 0 ? "text-red-600" : "text-green-600")}>
                                                Desvío: $ {money(s.difference)}
                                            </span>
                                        </div>
                                    </div>
                                    <Button size="sm" onClick={() => handleStartAudit(s)} disabled={loadingAudit} className="bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-500/20">
                                        {loadingAudit ? <RefreshCw className="animate-spin" size={14}/> : "Auditar Z"}
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="space-y-4">
                    <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                        <p className="text-xs font-bold uppercase text-blue-600 mb-2 flex items-center gap-2">
                            <Monitor size={14}/> En Operación ({openShifts.length})
                        </p>
                        {openShifts.length === 0 && <p className="text-xs text-sys-400 italic">Sin actividad.</p>}
                        {openShifts.map(s => (
                            <div key={s.id} className="text-sm p-2 bg-white rounded-lg border border-blue-100 mb-1 flex justify-between">
                                <span className="font-bold text-sys-700">{s.userId}</span>
                                <span className="text-xs text-sys-400">{new Date(s.openedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                            </div>
                        ))}
                    </div>

                    <div className="bg-sys-50 p-4 rounded-xl border border-sys-200">
                        <p className="text-xs font-semibold uppercase text-sys-500 mb-2 flex items-center gap-2">
                            <History size={14}/> Últimos Auditados
                        </p>
                        <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                            {auditedShifts.length === 0 && <p className="text-xs text-sys-400 italic">No hay historial.</p>}
                            {auditedShifts.slice(0, 5).map(shift => (
                                <div key={shift.id} className="flex justify-between items-center text-xs p-2 hover:bg-white rounded-lg transition-colors group border border-transparent hover:border-sys-200">
                                    <div>
                                        <span className="font-bold text-sys-700 block">{shift.userId}</span>
                                        <span className="text-xs text-sys-400">{new Date(shift.closedAt).toLocaleDateString()}</span>
                                    </div>
                                    <Button onClick={() => handleViewClosedShift(shift)} variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-sys-500 hover:text-brand hover:bg-brand-light">Ver Z</Button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            <TicketZModal isOpen={isReportModalOpen} onClose={handleModalClose} reportData={reportData} />
        </Card>
    );
};

// =================================================================
// 2. PANEL DE SEGURIDAD (SOLO ADMIN)
// =================================================================
const AdminSecurityPanel = ({ onUpdatePin }) => {
    const [newPin, setNewPin] = useState('');
    return (
        <Card className="p-6 border-l-4 border-l-slate-800 bg-slate-50">
            <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-slate-200 rounded-lg text-slate-700"><Shield size={20} /></div>
                <h3 className="font-bold text-sys-900 text-lg">Seguridad de Caja</h3>
            </div>
            <p className="text-xs text-sys-500 mb-4 leading-relaxed">
                Configura el PIN maestro para autorizar <b>Retiros de Efectivo</b>.
            </p>
            <div className="flex gap-2 items-center">
                <div className="relative flex-1">
                    <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400" />
                    <input 
                        type="password" placeholder="Nuevo PIN" 
                        className="w-full pl-9 pr-4 py-2 rounded-lg border border-sys-300 focus:border-slate-800 outline-none text-sm font-mono tracking-widest"
                        maxLength={6} value={newPin} onChange={(e) => setNewPin(e.target.value)}
                    />
                </div>
                <Button size="sm" className="bg-slate-800 hover:bg-slate-900 text-white" onClick={() => { onUpdatePin(newPin); setNewPin(''); }} disabled={newPin.length < 4}>
                    Actualizar
                </Button>
            </div>
        </Card>
    );
};

// =================================================================
// 3. TARJETA KPI COMPARTIDA (CON LÓGICA CIEGA)
// =================================================================
const SharedKPICard = ({ metrics, isAdmin, money, navigate, handleCloseShift, isCajeroActive }) => (
    <Card className={cn("lg:col-span-2 text-white border-none shadow-xl relative overflow-hidden", isAdmin ? "bg-sys-900" : "bg-brand")}>
        <div className="relative z-10 p-2 h-full flex flex-col justify-between">
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-white/70 font-medium uppercase tracking-wider text-xs mb-1">
                        {isAdmin ? "Ventas Globales (Hoy)" : (isCajeroActive ? "Mi Turno Actual" : "Caja Cerrada")}
                    </p>
                    <h1 className="text-5xl font-black tracking-tight">
                        {isAdmin ? `$ ${money(metrics.todaySales)}` : (isCajeroActive ? 'OPERATIVO' : '---')}
                    </h1>
                </div>
                <div className="p-3 bg-white/20 rounded-2xl backdrop-blur-md">
                    {isAdmin ? <Monitor size={32} /> : <Wallet size={32} />}
                </div>
            </div>
            
            <div className="mt-8 flex gap-8 border-t border-white/10 pt-4">
                <div>
                    <p className="text-xs uppercase font-bold text-white/60">Efectivo en Caja</p>
                    <p className="text-xl font-bold font-mono tracking-widest">
                        {isAdmin ? `$ ${money(metrics.cashInHand)}` : '• • • • • •'}
                    </p>
                </div>
                <div>
                    <p className="text-xs uppercase font-bold text-white/60">Digital</p>
                    <p className="text-xl font-bold font-mono tracking-widest">
                        {isAdmin ? `$ ${money(metrics.digitalSales)}` : '• • • • • •'}
                    </p>
                </div>
                
                {isAdmin && (
                    <Button onClick={() => navigate('/sales')} variant="secondary" className="bg-white text-brand hover:bg-sys-100 shadow-lg ml-auto">
                        <FileText size={18} className="mr-2" /> Historial
                    </Button>
                )}
                
                {!isAdmin && isCajeroActive && (
                    <Button size="sm" variant="secondary" className="bg-white text-brand hover:bg-sys-100 shadow-lg ml-auto" onClick={handleCloseShift}>
                        <Lock size={16} className="mr-2"/> Cerrar Caja Ciego
                    </Button>
                )}
            </div>
        </div>
    </Card>
);

// =================================================================
// 4. PANEL DE ACCIONES RÁPIDAS
// =================================================================
const QuickActionsPanel = ({ navigate, onExpenseClick, onWithdrawalClick, isAdmin }) => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <button onClick={() => navigate('/pos')} className="p-4 bg-white border border-sys-200 rounded-xl shadow-sm hover:shadow-md hover:border-brand/30 transition-all flex flex-col items-center gap-2 group">
            <ShoppingBag className="text-brand group-hover:scale-110 transition-transform" />
            <span className="font-bold text-sys-700 text-sm">Punto de Venta</span>
        </button>
        
        {!isAdmin && (
            <>
                <button onClick={onExpenseClick} className="p-4 bg-white border border-sys-200 rounded-xl shadow-sm hover:shadow-md hover:border-red-200 transition-all flex flex-col items-center gap-2 group">
                    <div className="p-2 bg-red-50 rounded-full group-hover:bg-red-100 transition-colors">
                        <DollarSign className="text-red-600 group-hover:scale-110 transition-transform" size={20} />
                    </div>
                    <span className="font-bold text-sys-700 text-sm">Registrar Gasto</span>
                </button>

                <button onClick={onWithdrawalClick} className="p-4 bg-white border border-sys-200 rounded-xl shadow-sm hover:shadow-md hover:border-orange-200 transition-all flex flex-col items-center gap-2 group">
                    <div className="p-2 bg-orange-50 rounded-full group-hover:bg-orange-100 transition-colors">
                        <Banknote className="text-orange-600 group-hover:scale-110 transition-transform" size={20} />
                    </div>
                    <span className="font-bold text-sys-700 text-sm">Retiro Efectivo</span>
                </button>
            </>
        )}

        <button onClick={() => navigate('/sales')} className="p-4 bg-white border border-sys-200 rounded-xl shadow-sm hover:shadow-md hover:hover:border-brand/30 transition-all flex flex-col items-center gap-2 group">
            <FileText className="text-sys-500 group-hover:text-brand group-hover:scale-110 transition-transform" />
            <span className="font-bold text-sys-700 text-sm">Historial</span>
        </button>
    </div>
);

// =================================================================
// 5. VISTAS DE ROL
// =================================================================
const CajeroDashboardView = ({ metrics, money, handleOpenShift, handleCloseShift, navigate, onExpenseClick, onWithdrawalClick }) => {
    const isCajeroActive = !!metrics.activeShift;
    return (
        <div className="space-y-8 pb-20 animate-in fade-in">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <SharedKPICard 
                    metrics={metrics} isAdmin={false} money={money} navigate={navigate} 
                    handleCloseShift={handleCloseShift} isCajeroActive={isCajeroActive}
                />
                <div className="space-y-4">
                    <Card className={cn("border-l-4 p-5 flex flex-col justify-center h-full relative overflow-hidden", isCajeroActive ? "border-l-green-500 bg-green-50/50" : "border-l-red-500 bg-red-50/50")}>
                        <div className="flex justify-between items-start mb-2">
                            <p className="text-xs font-bold uppercase tracking-wider text-sys-500">Mi Caja</p>
                            {isCajeroActive ? <Unlock size={16} className="text-green-600"/> : <Lock size={16} className="text-red-500"/>}
                        </div>
                        <h3 className={cn("text-xl font-black", isCajeroActive ? "text-green-700" : "text-red-700")}>
                            {isCajeroActive ? "TURNO ABIERTO" : "CERRADA"}
                        </h3>
                        {!isCajeroActive ? (
                            <Button size="sm" className="mt-3 w-full bg-red-600 hover:bg-red-700 text-white" onClick={handleOpenShift}>Abrir Caja Ahora</Button>
                        ) : (
                             <p className="text-xs text-sys-600 mt-1">Fondo inicial: ${money(metrics.activeShift.initialAmount)}</p>
                        )}
                    </Card>
                </div>
            </div>
            <QuickActionsPanel navigate={navigate} onExpenseClick={onExpenseClick} onWithdrawalClick={onWithdrawalClick} isAdmin={false} />
        </div>
    );
};

const AdminDashboardView = ({ metrics, money, navigate, loadIntelligence, handleUpdatePin, allShifts, cloudLoading }) => (
    <div className="space-y-8 pb-20 animate-in fade-in">
        
        {/* KPI HERO REAL-TIME */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="col-span-1 md:col-span-2 bg-brand text-white border-none p-6 relative overflow-hidden shadow-lg shadow-brand/20">
                <div className="relative z-10">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <p className="text-blue-100 font-medium uppercase tracking-wider text-xs">Ventas Globales (Hoy)</p>
                                <span className="bg-red-500/20 border border-red-500/50 text-red-200 text-[10px] px-1.5 rounded animate-pulse font-bold flex items-center gap-1">
                                    <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div> LIVE
                                </span>
                            </div>
                            <h1 className="text-5xl font-black tracking-tight mt-1">
                                {cloudLoading ? '...' : `$ ${money(metrics.todaySales)}`}
                            </h1>
                        </div>
                        <div className="p-3 bg-white/20 rounded-2xl backdrop-blur-md"><Signal size={32}/></div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 border-t border-white/10 pt-4">
                        <div><p className="text-[10px] uppercase opacity-70">Efectivo</p><p className="font-bold text-lg">$ {money(metrics.salesByMethod.cash)}</p></div>
                        <div><p className="text-[10px] uppercase opacity-70">Digital</p><p className="font-bold text-lg">$ {money(metrics.salesByMethod.digital)}</p></div>
                        <div><p className="text-[10px] uppercase opacity-70">Tickets</p><p className="font-bold text-lg">{metrics.fiscalCount}</p></div>
                    </div>
                </div>
            </Card>

            <StatCard 
                title="Gastos Operativos" 
                value={`$ ${money(metrics.totalExpenses)}`} 
                subtext="Salidas por compras/insumos"
                icon={TrendingDown} 
                colorClass="text-red-600" borderClass="border-red-100" bgClass="bg-red-50"
            />

            <StatCard 
                title="Cajas Activas" 
                value={metrics.activeShiftsCount} 
                subtext="Operando en tiempo real"
                icon={Monitor} 
                colorClass="text-blue-600" borderClass="border-blue-100" bgClass="bg-blue-50"
            />
        </div>
        
        {/* LIVE ACTIVITY FEED (NUEVO) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
                 <AdminCashAuditPanel allShifts={allShifts} loadIntelligence={loadIntelligence} navigate={navigate} />
            </div>

            <div className="space-y-6">
                 {/* FEED DE VENTAS */}
                 <Card className="p-0 overflow-hidden">
                    <div className="p-4 border-b border-sys-100 bg-sys-50 flex justify-between items-center">
                         <h3 className="font-bold text-sys-800 flex items-center gap-2"><Activity size={18}/> Actividad Reciente</h3>
                    </div>
                    <div className="divide-y divide-sys-100 max-h-[300px] overflow-y-auto">
                        {metrics.recentSales && metrics.recentSales.length > 0 ? (
                            metrics.recentSales.map((sale) => (
                                <div key={sale.id} className="p-3 hover:bg-sys-50 transition-colors flex items-center justify-between text-sm">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-sys-100 flex items-center justify-center text-sys-500">
                                            <ShoppingBag size={14} />
                                        </div>
                                        <div>
                                            <p className="font-bold text-sys-800">#{sale.id.slice(-4)}</p>
                                            <p className="text-[10px] text-sys-500">{sale.time} hs • {sale.items} un.</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-bold text-sys-900">$ {money(sale.total)}</p>
                                        <span className="text-[10px] uppercase text-sys-400">{sale.method === 'CASH' ? 'EFVO' : 'DIGITAL'}</span>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="p-6 text-center text-sys-400 text-xs italic">Sin ventas recientes hoy</div>
                        )}
                    </div>
                 </Card>

                {/* Accesos Rápidos Verticales */}
                <div className="grid grid-cols-1 gap-3">
                    <Card className="p-4 border-l-4 border-l-orange-500 cursor-pointer hover:shadow-md transition-all" onClick={() => navigate('/clients')}>
                        <div className="flex justify-between items-center">
                            <div>
                                <p className="text-xs text-sys-500 uppercase font-bold">Créditos / Deudas</p>
                                <p className="text-2xl font-black text-sys-900">$ {money(metrics.totalDebt)}</p>
                            </div>
                            <Users className="text-orange-500 opacity-20" size={32}/>
                        </div>
                    </Card>

                    <Card className="p-4 border-l-4 border-l-purple-500 cursor-pointer hover:shadow-md transition-all" onClick={() => navigate('/inventory')}>
                        <div className="flex justify-between items-center">
                            <div>
                                <p className="text-xs text-sys-500 uppercase font-bold">Stock Crítico</p>
                                <p className="text-2xl font-black text-sys-900">{metrics.lowStockCount}</p>
                            </div>
                            <Package className="text-purple-500 opacity-20" size={32}/>
                        </div>
                    </Card>

                    <AdminSecurityPanel onUpdatePin={handleUpdatePin} />
                </div>
            </div>
        </div>
        
        <QuickActionsPanel navigate={navigate} isAdmin={true} />
    </div>
);

// =================================================================
// 6. CONTROLADOR PRINCIPAL
// =================================================================
export const DashboardPage = () => {
    const navigate = useNavigate();
    const { user } = useAuthStore(); 
    
    const [loading, setLoading] = useState(true);
    
    // ESTADO LOCAL (Base)
    const [metrics, setMetrics] = useState({ 
        todaySales: 0, cashInHand: 0, digitalSales: 0, totalExpenses: 0, 
        fiscalCount: 0, salesByMethod: { cash: 0, digital: 0 },
        activeShiftsCount: 0, activeShift: null, allShifts: [], totalDebt: 0, lowStockCount: 0,
        recentSales: [] 
    });

    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [isWithdrawalModalOpen, setIsWithdrawalModalOpen] = useState(false); 
    
    const isAdmin = user?.role?.toUpperCase() === 'ADMIN';

    // 🔥 HOOK DE NUBE (Solo activo si es Admin, aunque lo llamamos siempre por reglas de hooks)
    const cloudStats = useCloudDashboard();

    if (!user) return <div className="p-10 text-center text-red-500">Error: Usuario no autenticado.</div>;
    const money = (val) => val ? val.toLocaleString('es-AR', {minimumFractionDigits: 2}) : '0.00';

    useEffect(() => { if (user) loadIntelligence(); }, [user.name, user.role]);

    const loadIntelligence = async () => {
        setLoading(true);
        let products = [], allShifts = [], allSales = [];

        // 1. CARGA LOCAL (Siempre necesaria para Stock, Cajas y Deudas)
        try { products = await productRepository.getAll(); } catch(e) {}
        try { allShifts = await cashRepository.getAllShifts(); } catch(e) {}
        
        // Solo cargamos ventas locales si NO es admin (el admin usa la nube)
        if (!isAdmin) {
            try { 
                allSales = await salesRepository.getTodaySales();
            } catch(e) {}
        }

        // Inicializar métricas locales
        let todaySales = 0, salesCash = 0, salesDigital = 0, fiscalCount = 0;
        let totalExpensesToday = 0, totalCashInHand = 0;
        let myActiveShift = null, globalActiveShifts = [];

        try {
            // Shifts
            myActiveShift = allShifts.find(s => s.status === 'OPEN' && s.userId === user.name);
            globalActiveShifts = allShifts.filter(s => s.status === 'OPEN');

            // --- LÓGICA HÍBRIDA ---
            if (!isAdmin) {
                // CAJERO: Calcula ventas desde IndexedDB
                const mSales = allSales.reduce((acc, s) => {
                    const total = parseFloat(s.total) || 0;
                    acc.total += total;
                    const method = s.payment?.method || 'unknown';
                    if (method === 'CASH') acc.cash += total; else acc.digital += total;
                    if (s.afip?.status === 'APPROVED') acc.fiscalCount++;
                    return acc;
                }, { total: 0, cash: 0, digital: 0, fiscalCount: 0 });

                todaySales = mSales.total;
                salesCash = mSales.cash;
                salesDigital = mSales.digital;
                fiscalCount = mSales.fiscalCount;
            } else {
                // ADMIN: Sobrescribe con datos de la Nube (Firebase Hook)
                // Se actualizará en el render mediante la variable combinada, 
                // pero aquí inicializamos para evitar parpadeos si falla la nube.
            }

            // Gastos y Efectivo en Caja (Local calculation per active shift logic)
            // Esto sigue siendo local porque los gastos no se están subiendo a Firebase en tiempo real aún
            const startOfToday = new Date().setHours(0,0,0,0);
            const shiftsForExpenses = allShifts.filter(s => s.status === 'OPEN' || (s.closedAt && new Date(s.closedAt).getTime() >= startOfToday));

            for (const shift of shiftsForExpenses) {
                try {
                    const balance = await cashRepository.getShiftBalance(shift.id);
                    if (isAdmin || shift.id === myActiveShift?.id) {
                        totalExpensesToday += (balance.expenses || 0);
                        if (shift.status === 'OPEN') totalCashInHand += (balance.totalCash || 0);
                    }
                } catch (e) {}
            }
            
            const lowStockCount = products.filter(p => p.stock <= (p.minStock || 5)).length;

            setMetrics(prev => ({
                ...prev,
                todaySales, // Si es admin, esto se ignora visualmente
                salesByMethod: { cash: salesCash, digital: salesDigital },
                fiscalCount,
                totalExpenses: totalExpensesToday,
                cashInHand: totalCashInHand,
                activeShift: myActiveShift,
                activeShiftsCount: globalActiveShifts.length,
                allShifts: allShifts, 
                lowStockCount,
                totalDebt: 0 // TODO: Implementar repositorio de deuda real
            }));

        } catch (error) { console.error("Error Dashboard:", error); }
        setLoading(false);
    };

    // --- FUSIÓN FINAL DE DATOS (LOCAL + NUBE) ---
    const finalMetrics = isAdmin ? {
        ...metrics,
        todaySales: cloudStats.totalSales, // 🔥 OVERRIDE CON NUBE
        salesByMethod: { 
            cash: cloudStats.cashTotal, 
            digital: cloudStats.digitalTotal 
        },
        fiscalCount: cloudStats.count,
        recentSales: cloudStats.recentSales // 🔥 FEED EN VIVO
    } : metrics;

    // Handlers (Sin cambios)
    const handleOpenShift = async () => {
        const input = prompt("Monto inicial en caja:", "1000");
        if (input === null) return;
        const amount = parseFloat(input);
        if (isNaN(amount) || amount < 0) return alert("Monto inválido");
        try { await cashRepository.openShift(amount, user?.name); await loadIntelligence(); alert("✅ Caja abierta!"); } catch (e) { alert(e.message); }
    };
    
    const handleCloseShift = async () => {
        if (!metrics.activeShift) return alert("No hay turno abierto.");
        const declaredCashStr = prompt("CIERRE CIEGO DE CAJA:\n\nCuente el dinero físico y escriba el total.", "");
        if (!declaredCashStr) return;
        const declaredCash = parseFloat(declaredCashStr);
        if (isNaN(declaredCash)) return alert("Inválido.");

        try {
            setLoading(true);
            const balance = await cashRepository.getShiftBalance(metrics.activeShift.id);
            await cashRepository.closeShift(metrics.activeShift.id, { expectedCash: balance.totalCash, declaredCash });
            alert("✅ Cierre registrado.");
            await loadIntelligence();
        } catch (error) { alert(`❌ Error: ${error.message}`); } finally { setLoading(false); }
    };

    const handleRegisterExpense = async ({ amount, description }) => {
        try { await cashRepository.registerExpense(amount, description, '', user?.name); await loadIntelligence(); alert(`✅ Gasto registrado.`); } catch (e) { alert(e.message); }
    };

    const handleRegisterWithdrawal = async ({ amount, description, adminPin }) => {
        try {
            const storedPin = await cashRepository.getAdminCashPin();
            if (adminPin !== (storedPin || "1234")) return alert("⛔ PIN INCORRECTO.");
            await cashRepository.registerWithdrawal(amount, description, 'Autorizado por PIN', user?.name);
            await loadIntelligence();
            alert(`✅ Retiro autorizado.`);
        } catch (e) { alert(e.message); }
    };

    const handleUpdatePin = async (newPin) => {
        if (!newPin || newPin.length < 4) return alert("Mínimo 4 dígitos.");
        await cashRepository.setAdminCashPin(newPin);
        alert("✅ PIN actualizado.");
    };
    
    if (loading && !finalMetrics.allShifts.length) return <div className="p-10 text-center animate-pulse">Cargando sistema...</div>;

    return (
        <div className="w-full">
            {isAdmin ? (
                <AdminDashboardView 
                    metrics={finalMetrics} 
                    money={money} 
                    navigate={navigate} 
                    loadIntelligence={loadIntelligence} 
                    handleUpdatePin={handleUpdatePin}
                    allShifts={finalMetrics.allShifts}
                    cloudLoading={cloudStats.loading}
                />
            ) : (
                <CajeroDashboardView 
                    metrics={finalMetrics} money={money} navigate={navigate} 
                    handleOpenShift={handleOpenShift} handleCloseShift={handleCloseShift}
                    onExpenseClick={() => setIsExpenseModalOpen(true)}
                    onWithdrawalClick={() => setIsWithdrawalModalOpen(true)}
                />
            )}

            <ExpenseModal isOpen={isExpenseModalOpen} onClose={() => setIsExpenseModalOpen(false)} onConfirm={handleRegisterExpense} />
            <WithdrawalModal isOpen={isWithdrawalModalOpen} onClose={() => setIsWithdrawalModalOpen(false)} onConfirm={handleRegisterWithdrawal} />
        </div>
    );
};