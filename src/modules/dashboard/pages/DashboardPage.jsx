// src/modules/dashboard/pages/DashboardPage.jsx

import React, { useEffect, useState } from 'react';
import { 
    TrendingUp, Users, Package, AlertTriangle, 
    Wallet, ArrowRight, RefreshCw, DollarSign,
    Lock, Unlock, Monitor, FileText, CheckCircle2, History, X, 
    ShoppingBag, Banknote, Shield, Key, BarChart3, TrendingDown
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Stores & Repositorios
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import { productRepository } from '../../inventory/repositories/productRepository';
import { cashRepository } from '../../cash/repositories/cashRepository';
import { salesRepository } from '../../sales/repositories/salesRepository';

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
    const [auditTarget, setAuditTarget] = useState(null); // Para confirmar auditoría al cerrar

    // Filtros
    const shiftsToAudit = allShifts.filter(s => s.status === 'CLOSED' && !s.audited);
    const openShifts = allShifts.filter(s => s.status === 'OPEN');
    const auditedShifts = allShifts.filter(s => s.status === 'CLOSED' && s.audited).sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));

    // Acción 1: Iniciar Auditoría (Abre el ticket para revisar)
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
            setAuditTarget(shift); // Guardamos el objetivo
            setIsReportModalOpen(true);
        } catch (error) { 
            alert(`❌ Error al cargar datos: ${error.message}`); 
        } finally { 
            setLoadingAudit(false); 
        }
    };
    
    // Acción 2: Ver Histórico (Solo lectura)
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
            setAuditTarget(null); // No auditamos nada, solo vemos
            setIsReportModalOpen(true);
        } catch (err) { 
            alert(err.message); 
        } finally { 
            setLoadingAudit(false); 
        }
    };

    // Acción 3: Confirmar al cerrar modal
    const handleModalClose = async () => {
        setIsReportModalOpen(false);
        
        if (auditTarget) {
            const confirm = window.confirm(`¿Confirmar auditoría de la caja de ${auditTarget.userId}?\n\nSe marcará como revisada y pasará al historial.`);
            if (confirm) {
                try {
                    await cashRepository.updateShift({ ...auditTarget, audited: true });
                    await loadIntelligence(); // Recargar datos
                } catch (error) {
                    alert("Error al guardar: " + error.message);
                }
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
                <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => navigate('/cash')} 
                    className="text-brand hover:bg-brand-light font-medium"
                >
                    📜 Ir al Historial Completo
                </Button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 text-sm font-medium gap-6">
                
                {/* COLUMNA 1: PENDIENTES */}
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
                                    <Button 
                                        size="sm" 
                                        onClick={() => handleStartAudit(s)} 
                                        disabled={loadingAudit} 
                                        className="bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-500/20"
                                    >
                                        {loadingAudit ? <RefreshCw className="animate-spin" size={14}/> : "Auditar Z"}
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* COLUMNA 2: RESUMEN */}
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
                                        <span className="text-[10px] text-sys-400">{new Date(shift.closedAt).toLocaleDateString()}</span>
                                    </div>
                                    <Button 
                                        onClick={() => handleViewClosedShift(shift)} 
                                        variant="ghost" 
                                        size="sm"
                                        className="h-7 px-2 text-[10px] text-sys-500 hover:text-brand hover:bg-brand-light"
                                    >
                                        Ver Z
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            
            {/* Modal de Reporte Z con cierre controlado */}
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
                Configura el PIN maestro para autorizar <b>Retiros de Efectivo</b> y operaciones sensibles en las cajas.
            </p>
            <div className="flex gap-2 items-center">
                <div className="relative flex-1">
                    <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400" />
                    <input 
                        type="password" 
                        placeholder="Nuevo PIN (6 dígitos)" 
                        className="w-full pl-9 pr-4 py-2 rounded-lg border border-sys-300 focus:border-slate-800 outline-none text-sm font-mono tracking-widest"
                        maxLength={6}
                        value={newPin}
                        onChange={(e) => setNewPin(e.target.value)}
                    />
                </div>
                <Button 
                    size="sm" 
                    className="bg-slate-800 hover:bg-slate-900 text-white"
                    onClick={() => { onUpdatePin(newPin); setNewPin(''); }}
                    disabled={newPin.length < 4}
                >
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

const AdminDashboardView = ({ metrics, money, navigate, loadIntelligence, handleUpdatePin, allShifts }) => (
    <div className="space-y-8 pb-20 animate-in fade-in">
        {/* KPIs GLOBALES (HOY REAL) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="col-span-1 md:col-span-2 bg-brand text-white border-none p-6 relative overflow-hidden shadow-lg shadow-brand/20">
                <div className="relative z-10">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <p className="text-blue-100 font-medium uppercase tracking-wider text-xs">Ventas Globales (Hoy)</p>
                            <h1 className="text-5xl font-black tracking-tight mt-1">$ {money(metrics.todaySales)}</h1>
                        </div>
                        <div className="p-3 bg-white/20 rounded-2xl backdrop-blur-md"><BarChart3 size={32}/></div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 border-t border-white/10 pt-4">
                        <div><p className="text-[10px] uppercase opacity-70">Efectivo</p><p className="font-bold text-lg">$ {money(metrics.salesByMethod.cash)}</p></div>
                        <div><p className="text-[10px] uppercase opacity-70">Digital</p><p className="font-bold text-lg">$ {money(metrics.salesByMethod.digital)}</p></div>
                        <div><p className="text-[10px] uppercase opacity-70">Fiscalizado</p><p className="font-bold text-lg">{metrics.fiscalCount} tkt</p></div>
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
        
        <AdminCashAuditPanel allShifts={allShifts} loadIntelligence={loadIntelligence} navigate={navigate} />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in slide-in-from-bottom-4">
            <Card className="p-6 border-l-4 border-l-orange-500 hover:shadow-lg transition-all cursor-pointer" onClick={() => navigate('/clients')}>
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-orange-100 rounded-lg text-orange-600"><Users size={20} /></div>
                    <h3 className="font-bold text-sys-900 text-lg">Créditos</h3>
                </div>
                <p className="text-3xl font-black text-sys-900 tracking-tight">$ {money(metrics.totalDebt)}</p>
                <p className="text-xs text-sys-500 mt-1">Deuda clientes</p>
            </Card>

            <Card className="p-6 border-l-4 border-l-purple-500 hover:shadow-lg transition-all cursor-pointer" onClick={() => navigate('/inventory')}>
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-purple-100 rounded-lg text-purple-600"><Package size={20} /></div>
                    <h3 className="font-bold text-sys-900 text-lg">Stock Bajo</h3>
                </div>
                <p className="text-3xl font-black text-sys-900">{metrics.lowStockCount}</p>
                <p className="text-xs text-sys-500 mt-1">Productos críticos</p>
            </Card>

            <AdminSecurityPanel onUpdatePin={handleUpdatePin} />
        </div>
        
        <QuickActionsPanel navigate={navigate} isAdmin={true} />
    </div>
);

// =================================================================
// 6. CONTROLADOR PRINCIPAL (ROBUSTECIDO)
// =================================================================
export const DashboardPage = () => {
    const navigate = useNavigate();
    const { user } = useAuthStore(); 
    
    const [loading, setLoading] = useState(true);
    const [metrics, setMetrics] = useState({ 
        todaySales: 0, cashInHand: 0, digitalSales: 0, totalExpenses: 0, 
        fiscalCount: 0, salesByMethod: { cash: 0, digital: 0 },
        activeShiftsCount: 0, activeShift: null, allShifts: [], totalDebt: 0, lowStockCount: 0
    });

    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [isWithdrawalModalOpen, setIsWithdrawalModalOpen] = useState(false); 
    
    if (!user) return <div className="p-10 text-center text-red-500">Error: Usuario no autenticado.</div>;

    const isAdmin = user.role?.toUpperCase() === 'ADMIN';
    const money = (val) => val ? val.toLocaleString('es-AR', {minimumFractionDigits: 2}) : '0.00';

    useEffect(() => { if (user) loadIntelligence(); }, [user.name, user.role]);

    // 🔥 LOGICA "A PRUEBA DE BALAS"
    const loadIntelligence = async () => {
        setLoading(true);
        let products = [], allShifts = [], allSales = [];

        // 1. CARGA INDEPENDIENTE (Para que no colapse si falla uno)
        try { products = await productRepository.getAll(); } catch(e) { console.error("Err Prod:", e); }
        try { allShifts = await cashRepository.getAllShifts(); } catch(e) { console.error("Err Shifts:", e); }
        try { allSales = await salesRepository.getAll(); } catch(e) { console.error("Err Sales:", e); }

        // Inicializamos valores en 0
        let todaySales = 0, salesCash = 0, salesDigital = 0, fiscalCount = 0;
        let totalExpensesToday = 0, totalCashInHand = 0;
        let lowStockCount = 0;
        let myActiveShift = null, globalActiveShifts = [];

        try {
            // Configurar Shifts
            myActiveShift = allShifts.find(s => s.status === 'OPEN' && s.userId === user.name);
            globalActiveShifts = allShifts.filter(s => s.status === 'OPEN');

            // --- A) VENTAS DE HOY (Desde las 00:00) ---
            const today = new Date();
            const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
            const salesToday = allSales.filter(s => new Date(s.date).getTime() >= startOfToday);
            
            const mSales = salesToday.reduce((acc, s) => {
                const total = parseFloat(s.total) || 0;
                acc.total += total;
                const method = s.payment?.method || 'unknown';
                if (method === 'cash') acc.cash += total; else acc.digital += total;
                if (s.afip?.status === 'APPROVED') acc.fiscalCount++;
                return acc;
            }, { total: 0, cash: 0, digital: 0, fiscalCount: 0 });

            todaySales = mSales.total;
            salesCash = mSales.cash;
            salesDigital = mSales.digital;
            fiscalCount = mSales.fiscalCount;

            // --- B) CAJA: GASTOS Y EFECTIVO ---
            // Revisamos cajas ABIERTAS o CERRADAS HOY
            const shiftsForExpenses = allShifts.filter(s => 
                s.status === 'OPEN' || 
                (s.closedAt && new Date(s.closedAt).getTime() >= startOfToday)
            );

            // Obtenemos balances uno por uno para seguridad
            for (const shift of shiftsForExpenses) {
                try {
                    const balance = await cashRepository.getShiftBalance(shift.id);
                    
                    // Sumar gastos (global o propios)
                    if (isAdmin || shift.id === myActiveShift?.id) {
                        totalExpensesToday += (balance.expenses || 0);
                    }

                    // Sumar efectivo (Solo de cajas ABIERTAS ahora)
                    if (shift.status === 'OPEN') {
                        if (isAdmin || shift.id === myActiveShift?.id) {
                            totalCashInHand += (balance.totalCash || 0);
                        }
                    }
                } catch (e) { console.error("Err Balance:", e); }
            }
            
            lowStockCount = products.filter(p => p.stock <= (p.minStock || 5)).length;

        } catch (error) {
            console.error("Critical calculation error (ignored):", error);
        }

        // SIEMPRE ACTUALIZAMOS EL ESTADO CON LO QUE HAYA (Para mostrar listas)
        setMetrics({
            todaySales,
            salesByMethod: { cash: salesCash, digital: salesDigital },
            fiscalCount,
            totalExpenses: totalExpensesToday,
            cashInHand: totalCashInHand,
            activeShift: myActiveShift,
            activeShiftsCount: globalActiveShifts.length,
            allShifts: allShifts, // 🔥 Esto asegura que la lista de auditoría aparezca
            lowStockCount,
            totalDebt: 0
        });
        
        setLoading(false);
    };

    // ... (Handlers se mantienen igual)
    const handleOpenShift = async () => {
        const input = prompt("Monto inicial en caja (Fondo de Cambio):", "1000");
        if (input === null) return;
        const amount = parseFloat(input);
        if (isNaN(amount) || amount < 0) return alert("Monto inválido");
        try { await cashRepository.openShift(amount, user?.name); await loadIntelligence(); alert("✅ Caja abierta con éxito!"); } catch (error) { alert(error.message); }
    };
    
    const handleCloseShift = async () => {
        if (!metrics.activeShift) return alert("No hay turno abierto.");
        const declaredCashStr = prompt("CIERRE CIEGO DE CAJA:\n\nPor favor, cuente el dinero físico y escriba el total.\n\nEl sistema no le dirá cuánto debería haber.", "");
        if (declaredCashStr === null || declaredCashStr.trim() === "") return;
        const declaredCash = parseFloat(declaredCashStr);
        if (isNaN(declaredCash) || declaredCash < 0) return alert("Monto inválido.");
        try { setLoading(true); const balance = await cashRepository.getShiftBalance(metrics.activeShift.id); await cashRepository.closeShift(metrics.activeShift.id, { expectedCash: balance.totalCash, declaredCash }); alert("✅ Cierre registrado. Notifique al Administrador."); await loadIntelligence(); } catch (error) { alert(`❌ Error: ${error.message}`); } finally { setLoading(false); }
    };

    const handleRegisterExpense = async ({ amount, description }) => { try { await cashRepository.registerExpense(amount, description, '', user?.name); await loadIntelligence(); alert(`✅ Gasto de $${amount} registrado.`); } catch (error) { alert(error.message); } };
    const handleRegisterWithdrawal = async ({ amount, description, adminPin }) => { try { const storedPin = await cashRepository.getAdminCashPin(); const validPin = storedPin || "1234"; if (adminPin !== validPin) return alert("⛔ PIN DE ADMINISTRADOR INCORRECTO."); await cashRepository.registerWithdrawal(amount, description, 'Autorizado por PIN', user?.name); await loadIntelligence(); alert(`✅ Retiro de $${amount} autorizado.`); } catch (error) { alert(error.message); } };
    const handleUpdatePin = async (newPin) => { if (!newPin || newPin.length < 4) return alert("El PIN debe tener al menos 4 dígitos."); await cashRepository.setAdminCashPin(newPin); alert("✅ PIN maestro actualizado."); };
    
    if (loading) return <div className="p-10 text-center animate-pulse">Cargando sistema...</div>;

    return (
        <div className="w-full">
            {isAdmin ? (
                <AdminDashboardView 
                    metrics={metrics} money={money} navigate={navigate} 
                    loadIntelligence={loadIntelligence} handleUpdatePin={handleUpdatePin}
                    allShifts={metrics.allShifts}
                />
            ) : (
                <CajeroDashboardView 
                    metrics={metrics} money={money} navigate={navigate} 
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