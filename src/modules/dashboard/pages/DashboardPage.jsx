import React, { useEffect, useState } from 'react';
import { 
    TrendingUp, Users, Package, AlertTriangle, 
    Wallet, ArrowRight, RefreshCw, DollarSign,
    Lock, Unlock, Monitor, FileText, CheckCircle2, History, X, 
    ShoppingBag, Banknote, Shield, Key, BarChart3, TrendingDown,
    Activity, Signal, Settings // 👈 Agregamos Settings para el botón de config
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Stores & Repositorios
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import { productRepository } from '../../inventory/repositories/productRepository';
import { cashRepository } from '../../cash/repositories/cashRepository';
import { salesRepository } from '../../sales/repositories/salesRepository';

// Servicios
import { securityService } from '../../security/services/securityService';
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
    <div className={cn("p-5 rounded-2xl border flex flex-col justify-between shadow-sm transition-all hover:shadow-md", borderClass, bgClass)}>
        <div className="flex justify-between items-start mb-2">
            <p className={cn("text-xs font-bold uppercase tracking-wider", colorClass)}>{title}</p>
            <div className={cn("p-2 rounded-lg bg-white/80 backdrop-blur-sm", colorClass)}><Icon size={20} /></div>
        </div>
        <div>
            <h3 className={cn("text-2xl font-black tracking-tight", colorClass)}>{value}</h3>
            {subtext && <p className="text-xs text-sys-600/80 mt-1 font-medium">{subtext}</p>}
        </div>
    </div>
);

// =================================================================
// COMPONENTE: TARJETA DE CAJA PROPIA
// =================================================================
const MyShiftCard = ({ metrics, money, handleOpenShift }) => {
    const isCajeroActive = !!metrics.activeShift;
    return (
        <Card className={cn(
            "p-4 border-l-4 transition-all shadow-sm hover:shadow-md relative overflow-hidden group", 
            isCajeroActive ? "border-l-green-500 bg-white" : "border-l-red-500 bg-white"
        )}>
            <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                    <div className={cn("p-1.5 rounded-lg", isCajeroActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                        {isCajeroActive ? <Unlock size={18}/> : <Lock size={18}/>}
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-sys-500">Estado de Caja</p>
                        <h4 className={cn("text-sm font-black leading-none", isCajeroActive ? "text-green-700" : "text-red-700")}>
                            {isCajeroActive ? "TURNO ABIERTO" : "TURNO CERRADO"}
                        </h4>
                    </div>
                </div>
                {isCajeroActive && (
                    <span className="flex h-2.5 w-2.5 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                    </span>
                )}
            </div>

            {!isCajeroActive ? (
                <div className="mt-2">
                    <p className="text-xs text-sys-400 mb-3">La caja está cerrada. No se pueden procesar ventas.</p>
                    <Button size="sm" className="w-full bg-sys-900 hover:bg-black text-white h-9 text-xs font-bold shadow-md" onClick={handleOpenShift}>
                        <Lock size={12} className="mr-2"/> ABRIR CAJA
                    </Button>
                </div>
            ) : (
                 <div className="bg-sys-50 rounded-lg p-3 border border-sys-100 mt-1 flex justify-between items-center">
                    <div>
                        <p className="text-[10px] text-sys-500 uppercase font-bold">Fondo Inicial</p>
                        <p className="text-sm font-bold text-sys-900">$ {money(metrics.activeShift.initialAmount)}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] text-sys-500 uppercase font-bold">Hora Inicio</p>
                        <p className="text-xs font-mono text-sys-700">
                            {new Date(metrics.activeShift.openedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </p>
                    </div>
                 </div>
            )}
        </Card>
    );
};

// =================================================================
// 🔥 COMPONENTE: MONITOR FISCAL ARCA (Con botón de Gestión)
// =================================================================
const ArcaMonitorCard = ({ stats, onManageClick }) => {
    const DAILY_TARGET = 50; 
    
    return (
        <Card className="p-0 overflow-hidden border border-blue-200 shadow-md">
            {/* Cabecera Interactiva */}
            <div className="bg-blue-600 p-3 flex justify-between items-center text-white">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-white/20 rounded-lg backdrop-blur-sm">
                        <Shield size={16} /> 
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase opacity-80 tracking-wider">Monitor Fiscal</p>
                        <h3 className="font-bold text-sm leading-none">Control ARCA</h3>
                    </div>
                </div>
                
                {/* 🔥 BOTÓN DE GESTIÓN FISCAL */}
                <button 
                    onClick={onManageClick}
                    className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-2 py-1 rounded text-[10px] font-bold uppercase transition-colors"
                >
                    <Settings size={12} /> Gestión
                </button>
            </div>

            {/* Cuerpo */}
            <div className="p-4 grid grid-cols-3 gap-4 text-center divide-x divide-sys-100">
                <div>
                    <p className="text-[10px] uppercase font-bold text-sys-500 mb-1">Hoy</p>
                    <p className="text-2xl font-black text-blue-600">{stats.daily}</p>
                </div>
                <div>
                    <p className="text-[10px] uppercase font-bold text-sys-500 mb-1">Semana</p>
                    <p className="text-xl font-bold text-sys-700">{stats.weekly}</p>
                </div>
                <div>
                    <p className="text-[10px] uppercase font-bold text-sys-500 mb-1">Mes</p>
                    <p className="text-xl font-bold text-sys-700">{stats.monthly}</p>
                </div>
            </div>

            {/* Pie de alerta */}
            <div className="bg-sys-50 p-2 flex justify-between items-center px-4 border-t border-sys-100">
                <div className="flex-1 text-center">
                    {stats.daily === 0 ? (
                        <p className="text-[10px] font-bold text-red-500 flex items-center justify-center gap-1">
                            <AlertTriangle size={10}/> Sin fiscalizar hoy
                        </p>
                    ) : (
                        <p className="text-[10px] font-medium text-sys-500">
                            Última: <span className="font-mono font-bold text-sys-700">{stats.lastTime ? new Date(stats.lastTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-'}</span>
                        </p>
                    )}
                </div>
            </div>
        </Card>
    );
};

// =================================================================
// 1. PANEL DE AUDITORÍA (SOLO ADMIN)
// =================================================================
const AdminCashAuditPanel = ({ allShifts, loadIntelligence, navigate }) => {
    const [isReportModalOpen, setIsReportModalOpen] = useState(false);
    const [reportData, setReportData] = useState(null);
    const [loadingAudit, setLoadingAudit] = useState(false);
    const [auditTarget, setAuditTarget] = useState(null);

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

    const handleConfirmAuditAction = async () => {
        if (!auditTarget) return;
        const confirm = window.confirm(`¿Aprobar y cerrar auditoría para la caja de ${auditTarget.userId}?`);
        if (!confirm) return;

        try {
            await cashRepository.updateShift({ ...auditTarget, audited: true });
            await loadIntelligence();
            setIsReportModalOpen(false);
            setAuditTarget(null);
        } catch (error) { alert("Error: " + error.message); }
    };

    const handleModalClose = () => {
        setIsReportModalOpen(false);
        setAuditTarget(null);
    };
    
    return (
        <Card className="lg:col-span-3">
             <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg text-sys-900 flex items-center gap-2">
                    <FileText size={20} className="text-brand"/> Auditoría de Cajas
                </h3>
                {/* 🔥 RUTA RELATIVA: 'cash' en vez de '/cash' */}
                <Button variant="ghost" size="sm" onClick={() => navigate('cash')} className="text-brand hover:bg-brand-light font-medium text-xs">
                    Ver Historial Completo
                </Button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 text-sm font-medium gap-6">
                
                {/* COLUMNA 1: PENDIENTES */}
                <div className="md:col-span-2 space-y-3">
                    <p className="text-[10px] font-bold uppercase text-sys-500 tracking-wider mb-2">Pendientes de Revisión ({shiftsToAudit.length})</p>
                    
                    {shiftsToAudit.length === 0 ? (
                        <div className="bg-green-50 text-green-700 p-4 rounded-xl border border-green-200 flex items-center gap-3 text-xs">
                            <CheckCircle2 size={16}/> <p>Todo al día. No hay cierres pendientes.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {shiftsToAudit.map(s => (
                                <div key={s.id} className="p-3 bg-red-50 rounded-xl border border-red-200 flex justify-between items-center animate-in slide-in-from-left-2">
                                    <div>
                                        <p className="font-bold text-red-700 text-xs">Cierre de: {s.userId}</p>
                                        <div className="flex gap-3 text-[10px] text-sys-600 mt-0.5">
                                            <span>{new Date(s.closedAt).toLocaleTimeString()}</span>
                                            <span className={cn("font-bold", s.difference !== 0 ? "text-red-600" : "text-green-600")}>
                                                Desvío: $ {money(s.difference)}
                                            </span>
                                        </div>
                                    </div>
                                    <Button size="sm" onClick={() => handleStartAudit(s)} disabled={loadingAudit} className="bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-500/20 text-xs h-8">
                                        {loadingAudit ? <RefreshCw className="animate-spin" size={12}/> : "Auditar"}
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* COLUMNA 2: RESUMEN */}
                <div className="space-y-4">
                    <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                        <p className="text-[10px] font-bold uppercase text-blue-600 mb-2 flex items-center gap-2">
                            <Monitor size={12}/> Activos ({openShifts.length})
                        </p>
                        {openShifts.length === 0 && <p className="text-xs text-sys-400 italic">Sin actividad.</p>}
                        {openShifts.map(s => (
                            <div key={s.id} className="text-xs p-2 bg-white rounded-lg border border-blue-100 mb-1 flex justify-between">
                                <span className="font-bold text-sys-700">{s.userId}</span>
                                <span className="text-sys-400">{new Date(s.openedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                            </div>
                        ))}
                    </div>

                    <div className="bg-sys-50 p-4 rounded-xl border border-sys-200">
                        <p className="text-[10px] font-bold uppercase text-sys-500 mb-2 flex items-center gap-2">
                            <History size={12}/> Historial
                        </p>
                        <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                            {auditedShifts.length === 0 && <p className="text-xs text-sys-400 italic">Vacío.</p>}
                            {auditedShifts.slice(0, 5).map(shift => (
                                <div key={shift.id} className="flex justify-between items-center text-xs p-2 hover:bg-white rounded-lg transition-colors group border border-transparent hover:border-sys-200 cursor-pointer" onClick={() => handleViewClosedShift(shift)}>
                                    <div>
                                        <span className="font-bold text-sys-700 block">{shift.userId}</span>
                                        <span className="text-[10px] text-sys-400">{new Date(shift.closedAt).toLocaleDateString()}</span>
                                    </div>
                                    <div className="text-sys-300 group-hover:text-brand"><ArrowRight size={14}/></div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            
            <TicketZModal 
                isOpen={isReportModalOpen} 
                onClose={handleModalClose} 
                reportData={reportData}
                onConfirmAudit={auditTarget ? handleConfirmAuditAction : undefined}
            />
        </Card>
    );
};

// =================================================================
// 2. PANEL DE SEGURIDAD (SOLO ADMIN)
// =================================================================
const AdminSecurityPanel = ({ onUpdatePin }) => {
    const [newPin, setNewPin] = useState('');
    return (
        <Card className="p-4 border-l-4 border-l-slate-800 bg-slate-50">
            <div className="flex items-center gap-2 mb-2">
                <Shield size={16} className="text-slate-600" />
                <h3 className="font-bold text-sys-900 text-sm">PIN Maestro (Global)</h3>
            </div>
            <p className="text-[10px] text-slate-500 mb-3">Este PIN permite autorizar retiros y acceso al inventario para cajeros.</p>
            <div className="flex gap-2 items-center">
                <div className="relative flex-1">
                    <input 
                        type="password" placeholder="Nuevo PIN (4-6 dígitos)" 
                        className="w-full px-3 py-1.5 rounded-lg border border-sys-300 focus:border-slate-800 outline-none text-xs font-mono tracking-widest"
                        maxLength={6} value={newPin} onChange={(e) => setNewPin(e.target.value)}
                    />
                </div>
                <Button size="sm" className="bg-slate-800 hover:bg-slate-900 text-white h-8 text-xs" onClick={() => { onUpdatePin(newPin); setNewPin(''); }} disabled={newPin.length < 4}>
                    Actualizar
                </Button>
            </div>
        </Card>
    );
};

// =================================================================
// 3. TARJETA KPI COMPARTIDA
// =================================================================
const SharedKPICard = ({ metrics, isAdmin, money, navigate, handleCloseShift, isCajeroActive }) => (
    <Card className={cn("lg:col-span-2 text-white border-none shadow-xl relative overflow-hidden", isAdmin ? "bg-sys-900" : "bg-brand")}>
        <div className="relative z-10 p-2 h-full flex flex-col justify-between">
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-white/70 font-medium uppercase tracking-wider text-[10px] mb-1">
                        {isAdmin ? "Ventas Globales (Hoy)" : (isCajeroActive ? "Mi Turno Actual" : "Caja Cerrada")}
                    </p>
                    <h1 className="text-4xl md:text-5xl font-black tracking-tight">
                        {isAdmin ? `$ ${money(metrics.todaySales)}` : (isCajeroActive ? 'OPERATIVO' : '---')}
                    </h1>
                </div>
                <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
                    {isAdmin ? <Monitor size={24} /> : <Wallet size={24} />}
                </div>
            </div>
            
            <div className="mt-6 flex gap-6 border-t border-white/10 pt-4">
                <div>
                    <p className="text-[10px] uppercase font-bold text-white/60">Efectivo</p>
                    <p className="text-lg font-bold font-mono tracking-widest">
                        {isAdmin ? `$ ${money(metrics.cashInHand)}` : '• • •'}
                    </p>
                </div>
                <div>
                    <p className="text-[10px] uppercase font-bold text-white/60">Digital</p>
                    <p className="text-lg font-bold font-mono tracking-widest">
                        {isAdmin ? `$ ${money(metrics.digitalSales)}` : '• • •'}
                    </p>
                </div>
                
                <div className="ml-auto flex gap-2">
                    {isAdmin && (
                        /* 🔥 RUTA RELATIVA: 'sales' en vez de '/sales' */
                        <Button onClick={() => navigate('sales')} variant="secondary" size="sm" className="bg-white text-brand hover:bg-sys-100 shadow-sm border-none h-8 text-xs">
                            <FileText size={14} className="mr-2" /> Historial
                        </Button>
                    )}
                    
                    {!isAdmin && isCajeroActive && (
                        <Button size="sm" variant="secondary" className="bg-white text-brand hover:bg-sys-100 shadow-sm border-none h-8 text-xs" onClick={handleCloseShift}>
                            <Lock size={14} className="mr-2"/> Cerrar Ciego
                        </Button>
                    )}
                    
                    {isAdmin && isCajeroActive && (
                        <Button size="sm" variant="secondary" className="bg-white text-red-600 hover:bg-red-50 shadow-sm border-none h-8 text-xs font-bold" onClick={handleCloseShift}>
                            <Lock size={14} className="mr-2"/> Cerrar Mí Caja
                        </Button>
                    )}
                </div>
            </div>
        </div>
    </Card>
);

// =================================================================
// 4. PANEL DE ACCIONES RÁPIDAS
// =================================================================
const QuickActionsPanel = ({ navigate, onExpenseClick, onWithdrawalClick, isAdmin }) => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* 🔥 RUTA RELATIVA: 'pos' */}
        <button onClick={() => navigate('pos')} className="p-4 bg-white border border-sys-200 rounded-xl shadow-sm hover:shadow-md hover:border-brand/30 transition-all flex flex-col items-center gap-2 group">
            <ShoppingBag className="text-brand group-hover:scale-110 transition-transform" size={24} />
            <span className="font-bold text-sys-700 text-xs">Ir a Vender</span>
        </button>
        
        <button onClick={onExpenseClick} className="p-4 bg-white border border-sys-200 rounded-xl shadow-sm hover:shadow-md hover:border-red-200 transition-all flex flex-col items-center gap-2 group">
            <div className="p-1.5 bg-red-50 rounded-full group-hover:bg-red-100 transition-colors">
                <DollarSign className="text-red-600 group-hover:scale-110 transition-transform" size={18} />
            </div>
            <span className="font-bold text-sys-700 text-xs">Registrar Gasto</span>
        </button>

        <button onClick={onWithdrawalClick} className="p-4 bg-white border border-sys-200 rounded-xl shadow-sm hover:shadow-md hover:border-orange-200 transition-all flex flex-col items-center gap-2 group">
            <div className="p-1.5 bg-orange-50 rounded-full group-hover:bg-orange-100 transition-colors">
                <Banknote className="text-orange-600 group-hover:scale-110 transition-transform" size={18} />
            </div>
            <span className="font-bold text-sys-700 text-xs">Retiro Efectivo</span>
        </button>

        {/* 🔥 RUTA RELATIVA: 'sales' */}
        <button onClick={() => navigate('sales')} className="p-4 bg-white border border-sys-200 rounded-xl shadow-sm hover:shadow-md hover:hover:border-brand/30 transition-all flex flex-col items-center gap-2 group">
            <FileText className="text-sys-500 group-hover:text-brand group-hover:scale-110 transition-transform" size={24} />
            <span className="font-bold text-sys-700 text-xs">Ver Ventas</span>
        </button>
    </div>
);

// =================================================================
// 5. VISTAS DE ROL
// =================================================================
const CajeroDashboardView = ({ metrics, money, handleOpenShift, handleCloseShift, navigate, onExpenseClick, onWithdrawalClick }) => {
    return (
        <div className="space-y-6 pb-20 animate-in fade-in">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <SharedKPICard 
                    metrics={metrics} isAdmin={false} money={money} navigate={navigate} 
                    handleCloseShift={handleCloseShift} isCajeroActive={!!metrics.activeShift}
                />
                <div className="space-y-4">
                    <MyShiftCard metrics={metrics} money={money} handleOpenShift={handleOpenShift} />
                </div>
            </div>
            <QuickActionsPanel navigate={navigate} onExpenseClick={onExpenseClick} onWithdrawalClick={onWithdrawalClick} isAdmin={false} />
        </div>
    );
};

const AdminDashboardView = ({ 
    metrics, money, navigate, loadIntelligence, handleUpdatePin, allShifts, cloudLoading,
    handleOpenShift, handleCloseShift, onExpenseClick, onWithdrawalClick 
}) => (
    <div className="space-y-6 pb-20 animate-in fade-in">
        
        {/* KPI HERO REAL-TIME */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="col-span-1 md:col-span-2 bg-brand text-white border-none p-5 relative overflow-hidden shadow-lg shadow-brand/20">
                <div className="relative z-10">
                    <div className="flex justify-between items-start mb-3">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <p className="text-blue-100 font-medium uppercase tracking-wider text-[10px]">Ventas Globales (Hoy)</p>
                                <span className="bg-red-500/20 border border-red-500/50 text-red-200 text-[9px] px-1.5 rounded animate-pulse font-bold flex items-center gap-1">
                                    <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div> LIVE
                                </span>
                            </div>
                            <h1 className="text-4xl font-black tracking-tight mt-1">
                                {cloudLoading ? '...' : `$ ${money(metrics.todaySales)}`}
                            </h1>
                        </div>
                        <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md"><Signal size={24}/></div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 border-t border-white/10 pt-3">
                        <div><p className="text-[9px] uppercase opacity-70">Efectivo</p><p className="font-bold text-sm">$ {money(metrics.salesByMethod.cash)}</p></div>
                        <div><p className="text-[9px] uppercase opacity-70">Digital</p><p className="font-bold text-sm">$ {money(metrics.salesByMethod.digital)}</p></div>
                        <div><p className="text-[9px] uppercase opacity-70">Fiscalizado</p><p className="font-bold text-sm">{metrics.fiscalCount} tkt</p></div>
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

        {/* BI: Ticket Promedio + Top Productos */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4 flex items-center justify-between border-l-4 border-l-indigo-500 shadow-sm">
                <div>
                    <p className="text-[10px] font-bold uppercase text-sys-500 mb-1">Ticket Promedio</p>
                    <h3 className="text-xl font-black text-sys-900">$ {money(metrics.averageTicket)}</h3>
                    <p className="text-[9px] text-sys-400">Gasto medio</p>
                </div>
                <div className="p-2 bg-indigo-50 rounded-full text-indigo-600"><TrendingUp size={20} /></div>
            </Card>

            <Card className="col-span-1 md:col-span-2 p-0 overflow-hidden border border-sys-200 shadow-sm">
                <div className="p-3 bg-sys-50 border-b border-sys-100 flex justify-between items-center">
                    <h4 className="font-bold text-xs text-sys-800 flex items-center gap-2">
                        <Package size={14} className="text-brand"/> Top 5 Más Vendidos (Hoy)
                    </h4>
                </div>
                <div className="p-2">
                    {metrics.topProducts && metrics.topProducts.length > 0 ? (
                        <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                            {metrics.topProducts.map((p, idx) => (
                                <div key={idx} className="flex-none w-28 bg-white border border-sys-100 p-2 rounded-lg text-center shadow-sm">
                                    <div className="w-5 h-5 bg-brand/10 text-brand rounded-full flex items-center justify-center mx-auto mb-1 text-[10px] font-bold">#{idx + 1}</div>
                                    <p className="text-[10px] font-bold text-sys-700 truncate" title={p.name}>{p.name}</p>
                                    <p className="text-[9px] text-sys-500">{p.quantity} un.</p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-[10px] text-sys-400 text-center py-2">Sin datos.</p>
                    )}
                </div>
            </Card>
        </div>
        
        {/* PANEL AUDITORÍA + MI CAJA */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
                 
                 {/* 🔥 INTEGRACIÓN DEL MONITOR ARCA CON BOTÓN GESTIÓN */}
                 <ArcaMonitorCard 
                    stats={metrics.fiscalStats || { daily:0, weekly:0, monthly:0, lastTime: null }} 
                    onManageClick={() => navigate('fiscal')} 
                 />
                 
                 <AdminCashAuditPanel allShifts={allShifts} loadIntelligence={loadIntelligence} navigate={navigate} />
                 
                 {/* FEED DE VENTAS */}
                 <Card className="p-0 overflow-hidden">
                    <div className="p-3 border-b border-sys-100 bg-sys-50 flex justify-between items-center">
                         <h3 className="font-bold text-xs text-sys-800 flex items-center gap-2"><Activity size={14}/> Actividad Reciente</h3>
                    </div>
                    <div className="divide-y divide-sys-100 max-h-[250px] overflow-y-auto">
                        {metrics.recentSales && metrics.recentSales.length > 0 ? (
                            metrics.recentSales.map((sale) => (
                                <div key={sale.id} className="p-2.5 hover:bg-sys-50 transition-colors flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-3">
                                        <div className="w-7 h-7 rounded-full bg-sys-100 flex items-center justify-center text-sys-500"><ShoppingBag size={12} /></div>
                                        <div>
                                            <p className="font-bold text-sys-800">#{sale.id.slice(-4)}</p>
                                            <p className="text-[9px] text-sys-500">{sale.time} hs • {sale.items} un.</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-bold text-sys-900">$ {money(sale.total)}</p>
                                        <span className="text-[9px] uppercase text-sys-400">{(sale.method || '').toUpperCase() === 'CASH' ? 'EFVO' : 'DIGITAL'}</span>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="p-4 text-center text-sys-400 text-[10px] italic">Sin ventas recientes hoy</div>
                        )}
                    </div>
                 </Card>
            </div>

            <div className="space-y-4">
                <MyShiftCard metrics={metrics} money={money} handleOpenShift={handleOpenShift} />

                {/* Accesos Rápidos Verticales (Compactos) */}
                <div className="grid grid-cols-2 gap-3">
                    {/* 🔥 RUTA RELATIVA: 'clients' */}
                    <Card className="p-3 border-l-4 border-l-orange-500 cursor-pointer hover:shadow-md transition-all flex flex-col justify-between" onClick={() => navigate('clients')}>
                        <p className="text-[10px] text-sys-500 uppercase font-bold mb-1">Créditos</p>
                        <div className="flex justify-between items-end">
                             <p className="text-sm font-black text-sys-900">$ {money(metrics.totalDebt)}</p>
                             <Users className="text-orange-500 opacity-20" size={20}/>
                        </div>
                    </Card>

                    {/* 🔥 RUTA RELATIVA: 'inventory' */}
                    <Card className="p-3 border-l-4 border-l-purple-500 cursor-pointer hover:shadow-md transition-all flex flex-col justify-between" onClick={() => navigate('inventory')}>
                         <p className="text-[10px] text-sys-500 uppercase font-bold mb-1">Stock Bajo</p>
                         <div className="flex justify-between items-end">
                             <p className="text-sm font-black text-sys-900">{metrics.lowStockCount}</p>
                             <Package className="text-purple-500 opacity-20" size={20}/>
                        </div>
                    </Card>
                </div>
                
                <AdminSecurityPanel onUpdatePin={handleUpdatePin} />
            </div>
        </div>
        
        <QuickActionsPanel navigate={navigate} isAdmin={true} onExpenseClick={onExpenseClick} onWithdrawalClick={onWithdrawalClick} />
    </div>
);

// =================================================================
// 6. CONTROLADOR PRINCIPAL
// =================================================================
export const DashboardPage = () => {
    const navigate = useNavigate();
    const { user } = useAuthStore(); 
    
    const [loading, setLoading] = useState(true);
    const [metrics, setMetrics] = useState({ 
        todaySales: 0, cashInHand: 0, digitalSales: 0, totalExpenses: 0, 
        fiscalCount: 0, salesByMethod: { cash: 0, digital: 0 },
        activeShiftsCount: 0, activeShift: null, allShifts: [], totalDebt: 0, lowStockCount: 0,
        recentSales: [], averageTicket: 0, topProducts: [],
        fiscalStats: { daily: 0, weekly: 0, monthly: 0, lastTime: null } 
    });

    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [isWithdrawalModalOpen, setIsWithdrawalModalOpen] = useState(false); 
    
    const isAdmin = user?.role?.toUpperCase() === 'ADMIN';
    const cloudStats = useCloudDashboard();

    if (!user) return <div className="p-10 text-center text-red-500">Error: Usuario no autenticado.</div>;
    const money = (val) => val ? val.toLocaleString('es-AR', {minimumFractionDigits: 2}) : '0.00';

    useEffect(() => { if (user) loadIntelligence(); }, [user.name, user.role]);

    const loadIntelligence = async () => {
        setLoading(true);
        let products = [], allShifts = [], allSales = [];

        try { products = await productRepository.getAll(); } catch(e) {}
        try { allShifts = await cashRepository.getAllShifts(); } catch(e) {}
        
        if (!isAdmin) {
            try { 
                allSales = await salesRepository.getTodaySales();
            } catch(e) {}
        }

        let todaySales = 0, salesCash = 0, salesDigital = 0, fiscalCount = 0;
        let totalExpensesToday = 0, totalCashInHand = 0;
        let myActiveShift = null, globalActiveShifts = [];
        let fiscalStats = { daily: 0, weekly: 0, monthly: 0, lastTime: null };

        try {
            myActiveShift = allShifts.find(s => s.status === 'OPEN' && s.userId === user.name);
            globalActiveShifts = allShifts.filter(s => s.status === 'OPEN');

            if (!isAdmin) {
                const mSales = allSales.reduce((acc, s) => {
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
            } else {
                try {
                    fiscalStats = await salesRepository.getFiscalStats();
                } catch (e) { console.error("Error fiscal stats", e); }
            }

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
                todaySales,
                salesByMethod: { cash: salesCash, digital: salesDigital },
                fiscalCount,
                totalExpenses: totalExpensesToday,
                cashInHand: totalCashInHand,
                activeShift: myActiveShift,
                activeShiftsCount: globalActiveShifts.length,
                allShifts: allShifts, 
                lowStockCount,
                totalDebt: 0,
                fiscalStats 
            }));

        } catch (error) { console.error("Error Dashboard:", error); }
        setLoading(false);
    };

    const finalMetrics = isAdmin ? {
        ...metrics,
        todaySales: cloudStats.totalSales, 
        salesByMethod: { 
            cash: cloudStats.cashTotal, 
            digital: cloudStats.digitalTotal 
        },
        fiscalCount: cloudStats.fiscalCount || 0,
        recentSales: cloudStats.recentSales,
        averageTicket: cloudStats.averageTicket || 0,
        topProducts: cloudStats.topProducts || [],
        fiscalStats: metrics.fiscalStats 
    } : metrics;

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
            const isValid = await securityService.verifyMasterPin(adminPin);
            if (!isValid) return alert("⛔ PIN INCORRECTO.");
            await cashRepository.registerWithdrawal(amount, description, 'Autorizado por PIN', user?.name);
            await loadIntelligence();
            alert(`✅ Retiro autorizado.`);
        } catch (e) { alert(e.message); }
    };

    const handleUpdatePin = async (newPin) => {
        if (!newPin || newPin.length < 4) return alert("Mínimo 4 dígitos.");
        await securityService.setMasterPin(newPin); 
        alert("✅ PIN Maestro actualizado correctamente.");
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
                    handleOpenShift={handleOpenShift}
                    handleCloseShift={handleCloseShift}
                    onExpenseClick={() => setIsExpenseModalOpen(true)}
                    onWithdrawalClick={() => setIsWithdrawalModalOpen(true)}
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