import React, { useEffect, useState } from 'react';
import { 
    TrendingUp, Users, Package, AlertTriangle, 
    Wallet, ArrowRight, RefreshCw, DollarSign,
    Lock, Unlock, Monitor, FileText, CheckCircle2, History, X, 
    ShoppingBag, Banknote, Shield, Key, BarChart3, TrendingDown,
    Activity, Signal, Settings, LayoutGrid
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Stores & Repositorios
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import { productRepository } from '../../inventory/repositories/productRepository';
import { cashRepository } from '../../cash/repositories/cashRepository';
import { salesRepository } from '../../sales/repositories/salesRepository';
import { shiftRepository } from '../../cash/repositories/shiftRepository'; // Importamos shiftRepository por si acaso

// Servicios
import { securityService } from '../../security/services/securityService';
import { useCloudDashboard } from '../hooks/useCloudDashboard';

// UI
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import { TicketZModal } from '../../reports/components/TicketZModal'; 

// Componentes Nuevos (Multi-Sucursal)
import { BranchSelector } from '../components/BranchSelector';

// Modales Operativos
import { ExpenseModal } from '../../cash/components/ExpenseModal';
import { WithdrawalModal } from '../../cash/components/WithdrawalModal'; 

// Firestore
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db as firestoreDB } from '../../../database/firebase';
import { db as localDb } from '../../../database/db'; // 🔥 Necesario para verificar Legacy

// =================================================================
// 🧠 HELPER: LECTURA INTELIGENTE DE VALORES (IMPORTADO DE CASHPAGE)
// =================================================================
const getShiftValues = (shift, calculatedDetails = null) => {
    if (!shift) return { expected: 0, declared: 0, diff: 0, initial: 0 };

    const isValid = (val) => val !== undefined && val !== null;

    // 1. Buscamos el "Teórico/Esperado" (System Amount)
    let expected = 0;
    
    // Prioridad 1: Cálculo al vuelo (LA SOLUCIÓN PARA OFFLINE/SYNC)
    if (calculatedDetails && isValid(calculatedDetails.totalCash)) {
        expected = Number(calculatedDetails.totalCash);
    } 
    // Prioridad 2: Datos guardados
    else if (isValid(shift.systemAmount)) expected = Number(shift.systemAmount);
    else if (isValid(shift.stats?.expectedTotal)) expected = Number(shift.stats.expectedTotal);
    else if (isValid(shift.expectedCash)) expected = Number(shift.expectedCash);

    // 2. Buscamos el "Real/Declarado" (Final Amount)
    let declared = 0;
    if (isValid(shift.finalAmount)) declared = Number(shift.finalAmount);
    else if (isValid(shift.stats?.declaredCash)) declared = Number(shift.stats.declaredCash);
    else if (isValid(shift.finalCash)) declared = Number(shift.finalCash);

    // 3. Inicial
    const initial = Number(shift.initialAmount) || 0;

    // 4. Diferencia
    const diff = declared - expected;

    return { expected, declared, diff, initial };
};

const money = (val) => val ? val.toLocaleString('es-AR', {minimumFractionDigits: 2}) : '0.00';

const StatCard = ({ title, value, subtext, icon: Icon, colorClass, borderClass, bgClass }) => (
    <div className={cn("p-5 rounded-xl border flex flex-col justify-between shadow-sm transition-all hover:shadow-md bg-white", borderClass)}>
        <div className="flex justify-between items-start mb-2">
            <p className={cn("text-[11px] font-bold uppercase tracking-wider", "text-slate-500")}>{title}</p>
            <div className={cn("p-2 rounded-full bg-slate-50", colorClass)}><Icon size={18} /></div>
        </div>
        <div>
            <h3 className="text-2xl font-bold tracking-tight text-slate-900">{value}</h3>
            {subtext && <p className="text-xs text-slate-400 mt-1 font-medium">{subtext}</p>}
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
            "p-5 border-l-4 transition-all shadow-sm hover:shadow-md relative overflow-hidden group bg-white", 
            isCajeroActive ? "border-l-emerald-500" : "border-l-rose-500"
        )}>
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-3">
                    <div className={cn("p-2 rounded-full", isCajeroActive ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600")}>
                        {isCajeroActive ? <Unlock size={20}/> : <Lock size={20}/>}
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Estado de Caja</p>
                        <h4 className={cn("text-base font-bold leading-none mt-0.5", isCajeroActive ? "text-emerald-700" : "text-rose-700")}>
                            {isCajeroActive ? "TURNO ABIERTO" : "TURNO CERRADO"}
                        </h4>
                    </div>
                </div>
                {isCajeroActive && (
                    <span className="flex h-2.5 w-2.5 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                    </span>
                )}
            </div>

            {!isCajeroActive ? (
                <div className="mt-2">
                    <p className="text-xs text-slate-500 mb-4">La caja está cerrada. Abra un turno para comenzar a operar.</p>
                    <Button size="sm" className="w-full bg-slate-900 hover:bg-black text-white h-10 text-xs font-bold shadow-md rounded-lg" onClick={handleOpenShift}>
                        <Unlock size={14} className="mr-2"/> ABRIR CAJA
                    </Button>
                </div>
            ) : (
                 <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 flex justify-between items-center">
                    <div>
                        <p className="text-[10px] text-slate-400 uppercase font-bold">Fondo Inicial</p>
                        <p className="text-sm font-bold text-slate-800">$ {money(metrics.activeShift.initialAmount)}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] text-slate-400 uppercase font-bold">Hora Inicio</p>
                        <p className="text-xs font-mono text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                            {new Date(metrics.activeShift.openedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </p>
                    </div>
                 </div>
            )}
        </Card>
    );
};

// =================================================================
// COMPONENTE: MONITOR FISCAL ARCA
// =================================================================
const ArcaMonitorCard = ({ stats, onManageClick }) => {
    return (
        <Card className="p-0 overflow-hidden border border-slate-200 shadow-sm bg-white">
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 p-3 flex justify-between items-center text-white">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-white/10 rounded-lg backdrop-blur-sm border border-white/10">
                        <Shield size={16} className="text-emerald-400" /> 
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase opacity-60 tracking-wider">Módulo Fiscal</p>
                        <h3 className="font-bold text-sm leading-none">Control ARCA</h3>
                    </div>
                </div>
                <button 
                    onClick={onManageClick}
                    className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase transition-all"
                >
                    <Settings size={12} /> Gestión
                </button>
            </div>

            <div className="p-5 grid grid-cols-3 gap-4 text-center divide-x divide-slate-100">
                <div>
                    <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Hoy</p>
                    <p className="text-2xl font-bold text-slate-800">{stats.daily}</p>
                </div>
                <div>
                    <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Semana</p>
                    <p className="text-xl font-bold text-slate-600">{stats.weekly}</p>
                </div>
                <div>
                    <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Mes</p>
                    <p className="text-xl font-bold text-slate-600">{stats.monthly}</p>
                </div>
            </div>

            <div className="bg-slate-50 p-2.5 flex justify-between items-center px-4 border-t border-slate-100">
                <div className="flex-1 text-center">
                    {stats.daily === 0 ? (
                        <p className="text-[10px] font-bold text-rose-500 flex items-center justify-center gap-1.5">
                            <AlertTriangle size={12}/> Sin actividad fiscal hoy
                        </p>
                    ) : (
                        <p className="text-[10px] font-medium text-slate-500">
                            Último tkt: <span className="font-mono font-bold text-slate-700">{stats.lastTime ? new Date(stats.lastTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-'}</span>
                        </p>
                    )}
                </div>
            </div>
        </Card>
    );
};

// =================================================================
// 1. PANEL DE AUDITORÍA (SOLO ADMIN) - 🔥 LÓGICA CORREGIDA
// =================================================================
const AdminCashAuditPanel = ({ allShifts, loadIntelligence, navigate, resolveName }) => {
    const [isReportModalOpen, setIsReportModalOpen] = useState(false);
    const [reportData, setReportData] = useState(null);
    const [loadingAudit, setLoadingAudit] = useState(false);
    const [auditTarget, setAuditTarget] = useState(null);

    const shiftsToAudit = allShifts.filter(s => s.status === 'CLOSED' && !s.audited);
    const openShifts = allShifts.filter(s => s.status === 'OPEN');
    // Ordenamos B - A (Más reciente primero)
    const auditedShifts = allShifts
        .filter(s => s.status === 'CLOSED' && s.audited)
        .sort((a, b) => {
            const dateA = a.closedAt ? new Date(a.closedAt) : new Date(0);
            const dateB = b.closedAt ? new Date(b.closedAt) : new Date(0);
            return dateB - dateA;
        });

    // 🔥 FUNCIÓN UNIFICADA PARA PREPARAR DATOS DEL REPORTE
    // Esta función RECALCULA el balance en vivo, ignorando valores basura del cierre offline
    const prepareReportData = async (shift) => {
        // 1. Obtener balance real (Movimiento por movimiento)
        const balance = await cashRepository.getShiftBalance(shift.id);
        
        // 2. Usar el "Detective" para determinar los valores finales (Prioriza el balance calculado)
        const { expected, declared, diff, initial } = getShiftValues(shift, balance);

        return {
            shiftName: resolveName(shift.userId, shift.userName),
            userName: resolveName(shift.userId, shift.userName), // Alias para TicketZModal
            
            // Valores críticos saneados
            expectedCash: expected,    // Para TicketZModal
            expectedTotal: expected,   // Alias
            systemAmount: expected,    // Alias
            
            actualCash: declared,      // Para TicketZModal
            finalAmount: declared,     // Alias
            declaredCash: declared,    // Alias
            
            deviation: diff,
            initialAmount: initial,
            
            // Datos del Balance
            salesCount: balance.movements.filter(m => m.type === 'SALE').length,
            totalSales: balance.salesCash + balance.salesDigital,
            cashIn: balance.deposits,
            cashOut: balance.withdrawals + balance.expenses,
            salesByMethod: { 
                cash: balance.salesCash, 
                digital: balance.salesDigital 
            },
            
            // Metadatos
            closeTime: shift.closedAt || new Date().toISOString(),
            
            // Datos Fiscales (Si existen)
            lastCbte: shift.stats?.lastCbte || 'N/A',
            totalAfip: shift.stats?.totalAfip || 0,
            pendingAfip: shift.stats?.pendingAfip || 0
        };
    };

    const handleStartAudit = async (shift) => {
        setLoadingAudit(true);
        try {
            const data = await prepareReportData(shift);
            setReportData(data);
            setAuditTarget(shift);
            setIsReportModalOpen(true);
        } catch (error) { alert(`❌ Error: ${error.message}`); } finally { setLoadingAudit(false); }
    };
    
    const handleViewClosedShift = async (shift) => {
        setLoadingAudit(true);
        try {
            const data = await prepareReportData(shift);
            setReportData(data);
            setAuditTarget(null); // Solo ver, no auditar
            setIsReportModalOpen(true);
        } catch (err) { alert(err.message); } finally { setLoadingAudit(false); }
    };

    const handleConfirmAuditAction = async () => {
        if (!auditTarget) return;
        const confirm = window.confirm(`¿Aprobar y cerrar auditoría para la caja de ${resolveName(auditTarget.userId, auditTarget.userName)}?`);
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
        <Card className="lg:col-span-3 shadow-sm border border-slate-200 bg-white">
             <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                    <FileText size={20} className="text-slate-400"/> Auditoría de Cajas
                </h3>
                <Button variant="ghost" size="sm" onClick={() => navigate('cash')} className="text-slate-500 hover:bg-slate-50 hover:text-slate-800 font-medium text-xs">
                    Ver Historial Completo
                </Button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 text-sm font-medium gap-8">
                
                {/* COLUMNA 1: PENDIENTES */}
                <div className="md:col-span-2 space-y-4">
                    <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-2">Pendientes de Revisión ({shiftsToAudit.length})</p>
                    
                    {shiftsToAudit.length === 0 ? (
                        <div className="bg-emerald-50/50 text-emerald-700 p-5 rounded-xl border border-emerald-100 flex items-center gap-3 text-xs">
                            <div className="p-2 bg-emerald-100 rounded-full"><CheckCircle2 size={16}/></div>
                            <p>Todo al día. No hay cierres pendientes de auditar.</p>
                        </div>
                    ) : (
                        <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                            {shiftsToAudit.map(s => (
                                <div key={s.id} className="p-4 bg-white rounded-xl border border-rose-100 shadow-sm flex justify-between items-center group hover:border-rose-200 transition-colors">
                                    <div>
                                        <p className="font-bold text-slate-700 text-xs flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                                            Cierre de: {resolveName(s.userId, s.userName)}
                                        </p>
                                        <div className="flex gap-3 text-[10px] text-slate-500 mt-1 pl-4">
                                            <span>{new Date(s.closedAt).toLocaleTimeString()}</span>
                                            {/* Usamos el Helper para mostrar el desvío correcto en la lista también */}
                                            <span className={cn("font-bold px-1.5 py-0.5 rounded text-[9px]", getShiftValues(s).diff !== 0 ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600")}>
                                                Desvío: $ {money(getShiftValues(s).diff)}
                                            </span>
                                        </div>
                                    </div>
                                    <Button size="sm" onClick={() => handleStartAudit(s)} disabled={loadingAudit} className="bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900 text-xs h-8 shadow-sm">
                                        {loadingAudit ? <RefreshCw className="animate-spin" size={12}/> : "Auditar"}
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* COLUMNA 2: RESUMEN */}
                <div className="space-y-5">
                    {/* ACTIVOS */}
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <p className="text-[10px] font-bold uppercase text-slate-400 mb-3 flex items-center gap-2">
                            <Monitor size={12}/> Cajas Activas ({openShifts.length})
                        </p>
                        <div className="max-h-[150px] overflow-y-auto custom-scrollbar pr-1 space-y-2">
                            {openShifts.length === 0 && <p className="text-xs text-slate-400 italic">Sin actividad.</p>}
                            {openShifts.map(s => (
                                <div key={s.id} className="text-xs p-2.5 bg-white rounded-lg border border-slate-200 flex justify-between shadow-sm">
                                    <span className="font-bold text-slate-700 truncate max-w-[100px]" title={resolveName(s.userId, s.userName)}>
                                        {resolveName(s.userId, s.userName)}
                                    </span>
                                    <span className="text-slate-400 font-mono text-[10px]">{new Date(s.openedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* HISTORIAL RECIENTE */}
                    <div className="bg-white p-0">
                        <p className="text-[10px] font-bold uppercase text-slate-400 mb-3 flex items-center gap-2 px-1">
                            <History size={12}/> Últimos Cierres
                        </p>
                        <div className="space-y-1 max-h-[200px] overflow-y-auto custom-scrollbar pr-1">
                            {auditedShifts.length === 0 && <p className="text-xs text-slate-400 italic px-1">Vacío.</p>}
                            {auditedShifts.slice(0, 10).map(shift => ( 
                                <div key={shift.id} className="flex justify-between items-center text-xs p-2 hover:bg-slate-50 rounded-lg transition-colors group cursor-pointer" onClick={() => handleViewClosedShift(shift)}>
                                    <div>
                                        <span className="font-medium text-slate-700 block truncate max-w-[120px]" title={resolveName(shift.userId, shift.userName)}>
                                            {resolveName(shift.userId, shift.userName)}
                                        </span>
                                        <span className="text-[9px] text-slate-400">{new Date(shift.closedAt).toLocaleDateString()}</span>
                                    </div>
                                    <div className="text-slate-300 group-hover:text-slate-600"><ArrowRight size={14}/></div>
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
// 2. PANEL DE SEGURIDAD
// =================================================================
const AdminSecurityPanel = ({ onUpdatePin }) => {
    const [newPin, setNewPin] = useState('');
    return (
        <Card className="p-5 border border-slate-200 bg-slate-50 shadow-none">
            <div className="flex items-center gap-2 mb-2">
                <Shield size={16} className="text-slate-400" />
                <h3 className="font-bold text-slate-700 text-sm">PIN Maestro (Global)</h3>
            </div>
            <p className="text-[10px] text-slate-400 mb-4">Permite autorizar operaciones sensibles (retiros, descuentos).</p>
            <div className="flex gap-2 items-center">
                <div className="relative flex-1">
                    <input 
                        type="password" placeholder="Nuevo PIN (4-6 dígitos)" 
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 outline-none text-xs font-mono tracking-widest bg-white shadow-sm transition-colors"
                        maxLength={6} value={newPin} onChange={(e) => setNewPin(e.target.value)}
                    />
                </div>
                <Button size="sm" className="bg-slate-800 hover:bg-slate-900 text-white h-9 text-xs font-bold shadow-md px-4" onClick={() => { onUpdatePin(newPin); setNewPin(''); }} disabled={newPin.length < 4}>
                    Actualizar
                </Button>
            </div>
        </Card>
    );
};

// =================================================================
// 3. TARJETA KPI COMPARTIDA (Estilo Premium)
// =================================================================
const SharedKPICard = ({ metrics, isAdmin, money, navigate, handleCloseShift, isCajeroActive }) => (
    <Card className={cn(
        "lg:col-span-2 border-none shadow-xl relative overflow-hidden text-white", 
        isAdmin 
            ? "bg-gradient-to-br from-slate-800 to-black" 
            : "bg-gradient-to-br from-brand to-brand-dark"
    )}>
        {/* Efecto de fondo sutil */}
        <div className="absolute top-0 right-0 p-10 opacity-5">
            <Activity size={120} />
        </div>

        <div className="relative z-10 p-4 h-full flex flex-col justify-between">
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-white/60 font-medium uppercase tracking-wider text-[10px] mb-1">
                        {isAdmin ? "Ventas Globales (Hoy)" : (isCajeroActive ? "Mi Turno Actual" : "Caja Cerrada")}
                    </p>
                    <h1 className="text-4xl md:text-5xl font-bold tracking-tighter">
                        {isAdmin ? `$ ${money(metrics.todaySales)}` : (isCajeroActive ? 'OPERATIVO' : '---')}
                    </h1>
                </div>
                <div className="p-2.5 bg-white/10 rounded-xl backdrop-blur-md border border-white/5">
                    {isAdmin ? <Monitor size={24} className="text-white/90" /> : <Wallet size={24} className="text-white/90" />}
                </div>
            </div>
            
            <div className="mt-8 flex gap-8 border-t border-white/10 pt-5">
                <div>
                    <p className="text-[10px] uppercase font-bold text-white/40 mb-0.5">Efectivo</p>
                    <p className="text-lg font-bold font-mono tracking-wider text-white/90">
                        {isAdmin ? `$ ${money(metrics.cashInHand)}` : '• • •'}
                    </p>
                </div>
                <div>
                    <p className="text-[10px] uppercase font-bold text-white/40 mb-0.5">Digital</p>
                    <p className="text-lg font-bold font-mono tracking-wider text-white/90">
                        {isAdmin ? `$ ${money(metrics.digitalSales)}` : '• • •'}
                    </p>
                </div>
                
                <div className="ml-auto flex gap-2 self-end">
                    {isAdmin && (
                        <Button onClick={() => navigate('sales')} variant="secondary" size="sm" className="bg-white/10 hover:bg-white/20 text-white border-none h-8 text-xs backdrop-blur-md">
                            <FileText size={14} className="mr-2" /> Historial
                        </Button>
                    )}
                    
                    {!isAdmin && isCajeroActive && (
                        <Button size="sm" variant="secondary" className="bg-white/10 hover:bg-white/20 text-white border-none h-8 text-xs backdrop-blur-md" onClick={handleCloseShift}>
                            <Lock size={14} className="mr-2"/> Cerrar Ciego
                        </Button>
                    )}
                    
                    {isAdmin && isCajeroActive && (
                        <Button size="sm" variant="secondary" className="bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/20 h-8 text-xs font-bold backdrop-blur-md" onClick={handleCloseShift}>
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
        <button onClick={() => navigate('pos')} className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:border-brand/30 transition-all flex flex-col items-center gap-2 group">
            <div className="p-3 bg-slate-50 rounded-full group-hover:bg-brand/10 transition-colors">
                <ShoppingBag className="text-slate-600 group-hover:text-brand group-hover:scale-110 transition-transform" size={20} />
            </div>
            <span className="font-bold text-slate-700 text-xs">Ir a Vender</span>
        </button>
        
        <button onClick={onExpenseClick} className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:border-rose-200 transition-all flex flex-col items-center gap-2 group">
            <div className="p-3 bg-slate-50 rounded-full group-hover:bg-rose-50 transition-colors">
                <DollarSign className="text-slate-600 group-hover:text-rose-500 group-hover:scale-110 transition-transform" size={20} />
            </div>
            <span className="font-bold text-slate-700 text-xs">Registrar Gasto</span>
        </button>

        <button onClick={onWithdrawalClick} className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:border-amber-200 transition-all flex flex-col items-center gap-2 group">
            <div className="p-3 bg-slate-50 rounded-full group-hover:bg-amber-50 transition-colors">
                <Banknote className="text-slate-600 group-hover:text-amber-500 group-hover:scale-110 transition-transform" size={20} />
            </div>
            <span className="font-bold text-slate-700 text-xs">Retiro Efectivo</span>
        </button>

        <button onClick={() => navigate('sales')} className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:hover:border-brand/30 transition-all flex flex-col items-center gap-2 group">
            <div className="p-3 bg-slate-50 rounded-full group-hover:bg-blue-50 transition-colors">
                <FileText className="text-slate-600 group-hover:text-blue-500 group-hover:scale-110 transition-transform" size={20} />
            </div>
            <span className="font-bold text-slate-700 text-xs">Ver Ventas</span>
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
    handleOpenShift, handleCloseShift, onExpenseClick, onWithdrawalClick, resolveName, activeBranchName 
}) => (
    <div className="space-y-6 pb-20 animate-in fade-in">
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="col-span-1 md:col-span-2 bg-slate-900 text-white border-none p-5 relative overflow-hidden shadow-xl">
                <div className="relative z-10">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <p className="text-slate-400 font-medium uppercase tracking-wider text-[10px]">Ventas Globales (Hoy)</p>
                                <span className="bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 text-[9px] px-1.5 rounded animate-pulse font-bold flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> LIVE
                                </span>
                            </div>
                            <h1 className="text-4xl font-bold tracking-tight mt-1 text-white">
                                {cloudLoading ? '...' : `$ ${money(metrics.todaySales)}`}
                            </h1>
                        </div>
                        <div className="p-2 bg-white/10 rounded-xl backdrop-blur-md border border-white/5"><Signal size={20} className="text-emerald-400"/></div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 border-t border-white/10 pt-4">
                        <div><p className="text-[9px] uppercase opacity-50 mb-0.5">Efectivo</p><p className="font-bold text-sm text-slate-200">$ {money(metrics.salesByMethod.cash)}</p></div>
                        <div><p className="text-[9px] uppercase opacity-50 mb-0.5">Digital</p><p className="font-bold text-sm text-slate-200">$ {money(metrics.salesByMethod.digital)}</p></div>
                        <div><p className="text-[9px] uppercase opacity-50 mb-0.5">Fiscalizado</p><p className="font-bold text-sm text-slate-200">{metrics.fiscalCount} tkt</p></div>
                    </div>
                </div>
            </Card>

            <StatCard 
                title="Gastos Operativos" 
                value={`$ ${money(metrics.totalExpenses)}`} 
                subtext="Salidas por compras/insumos"
                icon={TrendingDown} 
                colorClass="text-rose-500" borderClass="border-slate-200"
            />

            <StatCard 
                title="Cajas Activas" 
                value={metrics.activeShiftsCount} 
                subtext="Operando en tiempo real"
                icon={Monitor} 
                colorClass="text-blue-500" borderClass="border-slate-200"
            />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-5 flex items-center justify-between border-l-4 border-l-indigo-500 shadow-sm bg-white">
                <div><p className="text-[10px] font-bold uppercase text-slate-400 mb-1">Ticket Promedio</p><h3 className="text-xl font-bold text-slate-900">$ {money(metrics.averageTicket)}</h3><p className="text-[9px] text-slate-400">Gasto medio</p></div>
                <div className="p-3 bg-indigo-50 rounded-full text-indigo-600"><TrendingUp size={20} /></div>
            </Card>
            <Card className="col-span-1 md:col-span-2 p-0 overflow-hidden border border-slate-200 shadow-sm bg-white">
                <div className="p-3 bg-white border-b border-slate-100 flex justify-between items-center"><h4 className="font-bold text-xs text-slate-800 flex items-center gap-2"><Package size={14} className="text-brand"/> Top 5 Más Vendidos (Hoy)</h4></div>
                <div className="p-3">
                    {metrics.topProducts?.length > 0 ? (
                        <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
                            {metrics.topProducts.map((p, idx) => (
                                <div key={idx} className="flex-none w-32 bg-slate-50 border border-slate-100 p-2.5 rounded-xl text-center">
                                    <div className="w-5 h-5 bg-white text-slate-900 shadow-sm rounded-full flex items-center justify-center mx-auto mb-1.5 text-[10px] font-bold border border-slate-100">#{idx + 1}</div>
                                    <p className="text-[10px] font-bold text-slate-700 truncate" title={p.name}>{p.name}</p>
                                    <p className="text-[9px] text-slate-400">{p.quantity} un.</p>
                                </div>
                            ))}
                        </div>
                    ) : <p className="text-[10px] text-slate-400 text-center py-2">Sin datos de productos.</p>}
                </div>
            </Card>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
                 
                 <ArcaMonitorCard 
                    stats={metrics.fiscalStats || { daily:0, weekly:0, monthly:0, lastTime: null }} 
                    onManageClick={() => navigate('fiscal')} 
                 />
                 
                 <AdminCashAuditPanel 
                    allShifts={allShifts} 
                    loadIntelligence={loadIntelligence} 
                    navigate={navigate} 
                    resolveName={resolveName} 
                 />
                 
                 <Card className="p-0 overflow-hidden shadow-sm border border-slate-200 bg-white">
                    <div className="p-3 border-b border-slate-100 bg-white flex justify-between items-center"><h3 className="font-bold text-xs text-slate-800 flex items-center gap-2"><Activity size={14}/> Actividad Reciente</h3></div>
                    <div className="divide-y divide-slate-50 max-h-[250px] overflow-y-auto custom-scrollbar">
                        {metrics.recentSales?.length > 0 ? metrics.recentSales.map((sale) => (
                            <div key={sale.id} className="p-3 hover:bg-slate-50 transition-colors flex items-center justify-between text-xs">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 border border-slate-200"><ShoppingBag size={14} /></div>
                                    <div><p className="font-bold text-slate-800">#{sale.id.slice(-4)}</p><p className="text-[9px] text-slate-400">{sale.time} hs • {sale.items} un.</p></div>
                                </div>
                                <div className="text-right"><p className="font-bold text-slate-900">$ {money(sale.total)}</p><span className="text-[9px] uppercase font-bold text-slate-400 tracking-wide">{(sale.method || '').toUpperCase() === 'CASH' ? 'EFVO' : 'DIGITAL'}</span></div>
                            </div>
                        )) : <div className="p-6 text-center text-slate-400 text-[10px] italic">Sin ventas recientes hoy</div>}
                    </div>
                 </Card>
            </div>
            <div className="space-y-6">
                <MyShiftCard metrics={metrics} money={money} handleOpenShift={handleOpenShift} />
                <div className="grid grid-cols-2 gap-4">
                    <Card className="p-4 border-l-4 border-l-amber-500 cursor-pointer hover:shadow-md transition-all flex flex-col justify-between shadow-sm bg-white" onClick={() => navigate('clients')}>
                        <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">Créditos</p>
                        <div className="flex justify-between items-end"><p className="text-sm font-black text-slate-800">$ {money(metrics.totalDebt)}</p><Users className="text-amber-500 opacity-20" size={20}/></div>
                    </Card>
                    <Card className="p-4 border-l-4 border-l-violet-500 cursor-pointer hover:shadow-md transition-all flex flex-col justify-between shadow-sm bg-white" onClick={() => navigate('inventory')}>
                         <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">Stock Bajo</p>
                         <div className="flex justify-between items-end"><p className="text-sm font-black text-slate-800">{metrics.lowStockCount}</p><Package className="text-violet-500 opacity-20" size={20}/></div>
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
    const { user, activeBranchId, activeBranchName } = useAuthStore(); 
    
    const [loading, setLoading] = useState(true);
    const [branchCount, setBranchCount] = useState(0); // 🔥 Estado para detectar Legacy
    
    const [metrics, setMetrics] = useState({ 
        todaySales: 0, cashInHand: 0, digitalSales: 0, totalExpenses: 0, 
        fiscalCount: 0, salesByMethod: { cash: 0, digital: 0 },
        activeShiftsCount: 0, activeShift: null, allShifts: [], totalDebt: 0, lowStockCount: 0,
        recentSales: [], averageTicket: 0, topProducts: [],
        fiscalStats: { daily: 0, weekly: 0, monthly: 0, lastTime: null } 
    });

    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [isWithdrawalModalOpen, setIsWithdrawalModalOpen] = useState(false); 
    const [cashiersList, setCashiersList] = useState([]); 
    
    const isAdmin = user?.role?.toUpperCase() === 'ADMIN' || user?.role === 'OWNER';
    const cloudStats = useCloudDashboard(activeBranchId);

    if (!user) return <div className="p-10 text-center text-slate-500">Error: Usuario no autenticado.</div>;
    const money = (val) => val ? val.toLocaleString('es-AR', {minimumFractionDigits: 2}) : '0.00';

    // 🔥 Detección de Legacy (0 sucursales) o Single-Branch
    useEffect(() => {
        if (isAdmin && user?.companyId) {
            localDb.branches.count().then(count => {
                console.log("🏢 Sucursales detectadas:", count);
                setBranchCount(count);
                // Si es Legacy (0) o Single (1), forzar carga inmediata sin esperar selección
                if (count <= 1) setLoading(false); 
            });
        }
    }, [isAdmin, user?.companyId]);

    useEffect(() => {
        if (user?.companyId && isAdmin) {
            const fetchCashiers = async () => {
                try {
                    const q = query(collection(firestoreDB, 'users'), where('companyId', '==', user.companyId));
                    const snapshot = await getDocs(q);
                    setCashiersList(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() })));
                } catch (error) { console.error("Error cargando usuarios:", error); }
            };
            fetchCashiers();
        }
    }, [user?.companyId, isAdmin]);

    const resolveCashierName = (shiftUserId, shiftUserName) => {
        const matchedUser = cashiersList.find(u => u.uid === shiftUserId || u.email === shiftUserId);
        if (matchedUser) return matchedUser.name || matchedUser.email.split('@')[0];
        return shiftUserName !== 'Cajero' ? shiftUserName : "Cajero";
    };

    useEffect(() => { if (user) loadIntelligence(); }, [user.name, user.role, activeBranchId, branchCount]);

    const loadIntelligence = async () => {
        // 🔥 BLOQUEO DE SEGURIDAD PARA MULTI-SUCURSAL REAL
        // Solo bloqueamos la carga si: Es Admin + Tiene >1 Sucursal + No ha seleccionado ninguna.
        if (isAdmin && branchCount > 1 && !activeBranchId) {
            return; 
        }

        setLoading(true);
        let products = [], allShifts = [], allSales = [];

        try { products = await productRepository.getAll(); } catch(e) {}
        try { allShifts = await cashRepository.getAllShifts(); } catch(e) {}
        
        if (!isAdmin) {
            try { allSales = await salesRepository.getTodaySales(); } catch(e) {}
        }

        let todaySales = 0, salesCash = 0, salesDigital = 0, fiscalCount = 0;
        let totalExpensesToday = 0, totalCashInHand = 0;
        let myActiveShift = null, globalActiveShifts = [];
        let fiscalStats = { daily: 0, weekly: 0, monthly: 0, lastTime: null };

        try {
            myActiveShift = allShifts.find(s => s.status === 'OPEN' && s.userId === user.uid); 
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
                try { fiscalStats = await salesRepository.getFiscalStats(); } catch (e) { }
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
    
    // 🛑 LOADING STATE (Bloqueo SOLO si es multi-sucursal y no ha elegido)
    if (isAdmin && branchCount > 1 && !activeBranchId) {
        return (
            <div className="w-full h-[80vh] flex flex-col items-center justify-center animate-in fade-in duration-500">
                <div className="relative">
                    <div className="w-16 h-16 border-4 border-slate-100 border-t-brand rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center text-brand"><LayoutGrid size={24}/></div>
                </div>
                <h2 className="mt-6 text-xl font-bold text-slate-800">Cargando Entorno...</h2>
                <p className="text-slate-400 text-sm mt-2">Sincronizando sucursales y métricas.</p>
                <div className="mt-8 opacity-0 animate-[fade-in_1s_ease-out_1s_forwards]">
                    {/* Fallback si tarda mucho: mostrar selector */}
                    <BranchSelector /> 
                </div>
            </div>
        );
    }

    if (loading && !finalMetrics.allShifts.length && branchCount > 1) return <div className="p-10 text-center animate-pulse text-slate-400">Cargando sistema...</div>;

    return (
        <div className="w-full space-y-8 pb-20 max-w-7xl mx-auto">
            {/* HEADER */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        Hola, {user?.name?.split(' ')[0] || 'Admin'} <span className="text-2xl">👋</span>
                    </h1>
                    <p className="text-slate-500 font-medium text-sm mt-1">Resumen operativo en tiempo real.</p>
                </div>
                
                {/* 🔥 SELECTOR SIEMPRE VISIBLE PARA ADMINS (Que el selector maneje si está vacío o no) */}
                {isAdmin && <BranchSelector />}
            </div>

            {/* CONTENIDO */}
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
                    resolveName={resolveCashierName} 
                    activeBranchName={activeBranchName}
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