import React, { useEffect, useState } from 'react';
import { 
    TrendingUp, Users, Package, AlertTriangle, 
    Wallet, RefreshCw, DollarSign,
    Lock, Unlock, Monitor, FileText, CheckCircle2, History,
    ShoppingBag, Banknote, Shield, TrendingDown,
    Activity, Settings, LayoutGrid, Building2, Plus, ArrowRight
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Stores & Repositorios
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import { productRepository } from '../../inventory/repositories/productRepository';
import { cashRepository } from '../../cash/repositories/cashRepository';
import { salesRepository } from '../../sales/repositories/salesRepository';

// Servicios & Hooks
import { securityService } from '../../security/services/securityService';
import { useCloudDashboard } from '../hooks/useCloudDashboard';

// Componentes
import { BranchSelector } from '../components/BranchSelector';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import { TicketZModal } from '../../reports/components/TicketZModal'; 

// Modales Operativos
import { ExpenseModal } from '../../cash/components/ExpenseModal';
import { WithdrawalModal } from '../../cash/components/WithdrawalModal'; 
// 🔥 IMPORTANTE: Importamos el Wizard de Cierre Nuevo
import { CashClosingModal } from '../../cash/components/CashClosingModal';

// Firestore
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db as firestoreDB } from '../../../database/firebase';
import { db as localDb } from '../../../database/db'; 

// =================================================================
// 🧠 HELPER: LECTURA INTELIGENTE DE VALORES
// =================================================================
const money = (val) => val ? val.toLocaleString('es-AR', {minimumFractionDigits: 2}) : '0.00';

const getShiftValues = (shift, calculatedDetails = null) => {
    if (!shift) return { expected: 0, declared: 0, diff: 0, initial: 0 };
    const isValid = (val) => val !== undefined && val !== null;

    let expected = 0;
    // Prioridad 1: Cálculo en vivo (si se pasa)
    if (calculatedDetails && isValid(calculatedDetails.totalCash)) {
        expected = Number(calculatedDetails.totalCash);
    } 
    // Prioridad 2: Guardado en turno
    else if (isValid(shift.systemAmount)) expected = Number(shift.systemAmount);
    else if (isValid(shift.stats?.expectedTotal)) expected = Number(shift.stats.expectedTotal);
    else if (isValid(shift.expectedCash)) expected = Number(shift.expectedCash);

    let declared = 0;
    if (isValid(shift.finalAmount)) declared = Number(shift.finalAmount);
    else if (isValid(shift.stats?.declaredCash)) declared = Number(shift.stats.declaredCash);
    else if (isValid(shift.finalCash)) declared = Number(shift.finalCash);

    const initial = Number(shift.initialAmount) || 0;
    const diff = declared - expected;

    return { expected, declared, diff, initial };
};

// =================================================================
// 🚑 COMPONENTE DE AUTO-CURACIÓN (SETUP WIZARD)
// =================================================================
const NoBranchesSetupView = ({ onFix }) => {
    const [isFixing, setIsFixing] = useState(false);

    const handleFix = async () => {
        setIsFixing(true);
        await onFix();
        setIsFixing(false);
    };

    return (
        <div className="w-full h-[80vh] flex flex-col items-center justify-center p-6 animate-in fade-in slide-in-from-bottom-8">
            <div className="bg-white p-8 rounded-3xl shadow-2xl text-center max-w-md border border-sys-100 relative overflow-hidden">
                {/* Background Decor */}
                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-brand to-purple-500"></div>
                
                <div className="w-20 h-20 bg-brand/10 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Building2 size={40} className="text-brand" />
                </div>
                
                <h2 className="text-2xl font-black text-sys-900 mb-2">Configuración Inicial</h2>
                <p className="text-sys-500 mb-8 text-sm">
                    Detectamos que tu empresa <b>no tiene sucursales configuradas</b>. 
                    Para comenzar a operar, necesitamos crear la estructura base.
                </p>

                <Button 
                    onClick={handleFix} 
                    disabled={isFixing}
                    className="w-full h-12 text-base shadow-xl shadow-brand/20 hover:scale-[1.02] transition-transform"
                >
                    {isFixing ? (
                        <span className="flex items-center gap-2">
                            <RefreshCw className="animate-spin" /> Creando Sucursales...
                        </span>
                    ) : (
                        <span className="flex items-center gap-2">
                            <Plus size={20} /> Generar Sucursales Default
                        </span>
                    )}
                </Button>
                
                <p className="text-xs text-sys-300 mt-4">
                    Esto creará: "Casa Central", "Sucursal Norte" y "Sucursal Sur".
                </p>
            </div>
        </div>
    );
};

// =================================================================
// 💎 COMPONENTES UI MICRO
// =================================================================
const StatCard = ({ title, value, subtext, icon: Icon, colorClass, borderClass }) => (
    <div className={cn("p-5 rounded-xl border flex flex-col justify-between shadow-sm transition-all hover:shadow-md bg-white", borderClass)}>
        <div className="flex justify-between items-start mb-2">
            <p className={cn("text-[11px] font-bold uppercase tracking-wider text-slate-500")}>{title}</p>
            <div className={cn("p-2 rounded-full bg-slate-50", colorClass)}><Icon size={18} /></div>
        </div>
        <div>
            <h3 className="text-2xl font-black tracking-tight text-slate-900">{value}</h3>
            {subtext && <p className="text-xs text-slate-400 mt-1 font-medium">{subtext}</p>}
        </div>
    </div>
);

// 🔥 KPICard Actualizada con disparador de cierre real
const KpiCard = ({ metrics, isAdmin, money, navigate, onTriggerClose, isCajeroActive, activeBranchName }) => (
    <div className={cn(
        "lg:col-span-2 relative overflow-hidden rounded-3xl p-6 text-white shadow-2xl transition-all border border-white/5",
        isAdmin ? "bg-slate-900" : "bg-brand"
    )}>
        <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
            <Activity size={180} />
        </div>
        
        <div className="relative z-10 flex flex-col h-full justify-between gap-8">
            <div className="flex justify-between items-start">
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="flex h-2 w-2 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
                        </span>
                        <p className="text-white/60 font-bold uppercase tracking-wider text-[10px]">
                            {isAdmin ? "Ventas Globales (Hoy)" : (isCajeroActive ? "Turno Activo" : "Caja Cerrada")}
                        </p>
                        {activeBranchName && (
                            <span className="ml-2 bg-white/20 px-2 py-0.5 rounded text-[9px] font-bold text-white border border-white/10 backdrop-blur-sm">
                                {activeBranchName}
                            </span>
                        )}
                    </div>
                    <h1 className="text-5xl font-black tracking-tighter tabular-nums">
                        {isAdmin ? `$ ${money(metrics.todaySales)}` : (isCajeroActive ? 'OPERATIVO' : '---')}
                    </h1>
                </div>
                <div className="p-3 bg-white/10 hover:bg-white/20 rounded-2xl backdrop-blur-md border border-white/10 transition-colors">
                    {isAdmin ? <Monitor size={24} className="text-white" /> : <Wallet size={24} className="text-white" />}
                </div>
            </div>

            <div className="flex items-center gap-4 bg-black/20 p-4 rounded-2xl backdrop-blur-md border border-white/5">
                <div className="flex-1 border-r border-white/10 pr-4">
                    <p className="text-[10px] uppercase font-bold text-white/50 mb-1">Efectivo</p>
                    <p className="text-lg font-bold font-mono tracking-tight text-white/90">
                        {isAdmin ? `$ ${money(metrics.cashInHand)}` : '• • •'}
                    </p>
                </div>
                <div className="flex-1">
                    <p className="text-[10px] uppercase font-bold text-white/50 mb-1">Digital</p>
                    <p className="text-lg font-bold font-mono tracking-tight text-white/90">
                        {isAdmin ? `$ ${money(metrics.digitalSales)}` : '• • •'}
                    </p>
                </div>
                <div className="pl-4">
                    {isAdmin && (
                        <Button onClick={() => navigate('sales')} variant="secondary" size="sm" className="bg-white text-slate-900 hover:bg-slate-200 border-none h-9 text-xs font-bold shadow-lg">
                            <FileText size={14} className="mr-2" /> Historial
                        </Button>
                    )}
                    {/* Botón de Cierre para Cajero */}
                    {!isAdmin && isCajeroActive && (
                        <Button size="sm" className="bg-rose-500 hover:bg-rose-600 text-white border-none h-9 text-xs font-bold shadow-lg" onClick={onTriggerClose}>
                            <Lock size={14} className="mr-2"/> Cerrar Caja
                        </Button>
                    )}
                    {/* Botón de Cierre para Admin operando */}
                    {isAdmin && isCajeroActive && (
                        <Button size="sm" className="bg-rose-500 hover:bg-rose-600 text-white border-none h-9 text-xs font-bold shadow-lg" onClick={onTriggerClose}>
                            <Lock size={14} className="mr-2"/> Cerrar Mí Caja
                        </Button>
                    )}
                </div>
            </div>
        </div>
    </div>
);

const MyShiftCard = ({ metrics, money, handleOpenShift }) => {
    const isCajeroActive = !!metrics.activeShift;
    return (
        <div className={cn(
            "p-5 border-l-4 transition-all shadow-sm hover:shadow-md relative overflow-hidden group bg-white rounded-2xl border border-slate-100", 
            isCajeroActive ? "border-l-emerald-500" : "border-l-rose-500"
        )}>
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-3">
                    <div className={cn("p-2.5 rounded-full shadow-sm", isCajeroActive ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600")}>
                        {isCajeroActive ? <Unlock size={20}/> : <Lock size={20}/>}
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Estado de Caja</p>
                        <h4 className={cn("text-base font-black leading-none mt-0.5", isCajeroActive ? "text-emerald-700" : "text-rose-700")}>
                            {isCajeroActive ? "TURNO ABIERTO" : "TURNO CERRADO"}
                        </h4>
                    </div>
                </div>
            </div>

            {!isCajeroActive ? (
                <div className="mt-2">
                    <p className="text-xs text-slate-500 mb-4 font-medium">La caja está cerrada. Inicie turno para operar.</p>
                    <Button size="sm" className="w-full bg-slate-900 hover:bg-black text-white h-11 text-xs font-bold shadow-lg shadow-slate-200 rounded-xl" onClick={handleOpenShift}>
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
                        <p className="text-[10px] text-slate-400 uppercase font-bold">Apertura</p>
                        <p className="text-xs font-mono font-bold text-slate-600">
                            {new Date(metrics.activeShift.openedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </p>
                    </div>
                 </div>
            )}
        </div>
    );
};

const ArcaMonitorCard = ({ stats, onManageClick }) => (
    <div className="p-0 overflow-hidden border border-slate-200 shadow-sm bg-white group hover:shadow-md transition-all rounded-2xl">
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 p-3 flex justify-between items-center text-white relative overflow-hidden">
            <div className="flex items-center gap-3 relative z-10">
                <div className="p-1.5 bg-white/10 rounded-lg backdrop-blur-sm border border-white/10">
                    <Shield size={16} className="text-emerald-400" /> 
                </div>
                <div>
                    <p className="text-[9px] font-bold uppercase opacity-60 tracking-wider">Cumplimiento</p>
                    <h3 className="font-bold text-sm leading-none">Fiscal ARCA</h3>
                </div>
            </div>
            <button onClick={onManageClick} className="relative z-10 flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/10 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase transition-all backdrop-blur-md">
                <Settings size={12} /> Panel
            </button>
        </div>

        <div className="p-5 grid grid-cols-3 gap-4 text-center divide-x divide-slate-100">
            <div><p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Hoy</p><p className="text-2xl font-black text-slate-800">{stats.daily}</p></div>
            <div><p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Semana</p><p className="text-xl font-bold text-slate-600">{stats.weekly}</p></div>
            <div><p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Mes</p><p className="text-xl font-bold text-slate-600">{stats.monthly}</p></div>
        </div>

        <div className="bg-slate-50 p-2.5 px-4 border-t border-slate-100 flex justify-between items-center">
            <div className="flex-1 text-center">
                {stats.daily === 0 ? (
                    <p className="text-[10px] font-bold text-rose-500 flex items-center justify-center gap-1.5"><AlertTriangle size={12}/> Sin actividad</p>
                ) : (
                    <p className="text-[10px] font-medium text-slate-500">Último tkt: <span className="font-mono font-bold text-slate-700">{stats.lastTime ? new Date(stats.lastTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-'}</span></p>
                )}
            </div>
        </div>
    </div>
);

// =================================================================
// 🔎 PANEL DE AUDITORÍA (Admin)
// =================================================================
const AdminCashAuditPanel = ({ allShifts, loadIntelligence, navigate, resolveName, pendingShifts }) => {
    const [isReportModalOpen, setIsReportModalOpen] = useState(false);
    const [reportData, setReportData] = useState(null);
    const [loadingAudit, setLoadingAudit] = useState(false);
    const [auditTarget, setAuditTarget] = useState(null);

    // Combinación de pendientes (Cloud + Local)
    const shiftsToAudit = pendingShifts && pendingShifts.length > 0 
        ? pendingShifts 
        : allShifts.filter(s => s.status === 'CLOSED' && !s.audited);

    const openShifts = allShifts.filter(s => s.status === 'OPEN');
    const auditedShifts = allShifts.filter(s => s.status === 'CLOSED' && s.audited).sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));

    // 🕵️ Preparar Reporte con TODOS los datos (incluyendo leftInCash)
    const prepareReportData = async (shift) => {
        const balance = await cashRepository.getShiftBalance(shift.id);
        const { expected, declared, diff, initial } = getShiftValues(shift, balance);
        
        // 🔥 DEBUG PARA VERIFICAR QUE EL DATO LLEGA
        // console.log("Datos Turno:", shift); 

        return {
            shiftName: resolveName(shift.userId, shift.userName),
            userName: resolveName(shift.userId, shift.userName),
            shiftId: shift.id,
            
            // Datos Económicos
            expectedCash: expected, 
            declaredCash: declared,
            leftInCash: Number(shift.leftInCash) || 0, // 🔥 SI ESTO FALTA O ESTÁ MAL ESCRITO, SALDRÁ 0
            deviation: diff, 
            initialAmount: initial,
            
            // Datos Operativos
            salesCount: balance.movements.filter(m => m.type === 'SALE').length,
            totalSales: balance.salesCash + balance.salesDigital,
            cashIn: balance.deposits, 
            cashOut: balance.withdrawals + balance.expenses,
            salesByMethod: { cash: balance.salesCash, digital: balance.salesDigital },
            closeTime: shift.closedAt || new Date().toISOString(),
            lastCbte: shift.stats?.lastCbte || 'N/A', 
            totalAfip: shift.stats?.totalAfip || 0,
            audited: shift.audited
        };
    };
    const handleStartAudit = async (shift) => {
        setLoadingAudit(true);
        try {
            const data = await prepareReportData(shift);
            setReportData(data); setAuditTarget(shift); setIsReportModalOpen(true);
        } catch (error) { alert(`❌ Error: ${error.message}`); } finally { setLoadingAudit(false); }
    };
    
    const handleViewClosedShift = async (shift) => {
        setLoadingAudit(true);
        try {
            const data = await prepareReportData(shift);
            setReportData(data); setAuditTarget(null); setIsReportModalOpen(true);
        } catch (err) { alert(err.message); } finally { setLoadingAudit(false); }
    };

    const handleConfirmAuditAction = async () => {
        if (!auditTarget) return;
        if (!window.confirm(`¿Aprobar y cerrar auditoría?`)) return;
        try {
            await cashRepository.updateShift({ ...auditTarget, audited: true });
            await loadIntelligence(); setIsReportModalOpen(false); setAuditTarget(null);
        } catch (error) { alert("Error: " + error.message); }
    };

    return (
        <Card className="lg:col-span-3 shadow-sm border border-slate-200 bg-white">
             <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><FileText size={20} className="text-slate-400"/> Auditoría de Cajas</h3>
                <Button variant="ghost" size="sm" onClick={() => navigate('cash')} className="text-slate-500 hover:text-brand font-medium text-xs">Ver Historial</Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* LISTA PENDIENTES */}
                <div className="md:col-span-2 space-y-4">
                    <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-2">Pendientes ({shiftsToAudit.length})</p>
                    {shiftsToAudit.length === 0 ? (
                        <div className="bg-emerald-50/50 text-emerald-700 p-5 rounded-xl border border-emerald-100 flex items-center gap-3 text-xs font-medium">
                            <CheckCircle2 size={18} className="text-emerald-500"/> Todo al día.
                        </div>
                    ) : (
                        <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                            {shiftsToAudit.map(s => (
                                <div key={s.id} className="p-4 bg-white rounded-xl border border-rose-100 shadow-sm flex justify-between items-center hover:border-rose-300 transition-all animate-in slide-in-from-left-2">
                                    <div>
                                        <p className="font-bold text-slate-800 text-xs flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span> {resolveName(s.userId, s.userName)}
                                        </p>
                                        <div className="flex gap-3 text-[10px] text-slate-500 mt-1 pl-4 font-mono">
                                            <span>{new Date(s.closedAt).toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})}</span>
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
                
                {/* LATERAL: ACTIVAS + HISTORIAL */}
                <div className="space-y-5">
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <p className="text-[10px] font-bold uppercase text-slate-400 mb-3 flex items-center gap-2"><Monitor size={12}/> Activas ({openShifts.length})</p>
                        <div className="max-h-[150px] overflow-y-auto custom-scrollbar space-y-2">
                            {openShifts.length === 0 && <p className="text-xs text-slate-400 italic">Sin actividad.</p>}
                            {openShifts.map(s => (
                                <div key={s.id} className="text-xs p-2 bg-white rounded-lg border border-slate-200 flex justify-between shadow-sm">
                                    <span className="font-bold text-slate-700 truncate max-w-[100px]">{resolveName(s.userId, s.userName)}</span>
                                    <span className="text-slate-400 font-mono text-[10px]">{new Date(s.openedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase text-slate-400 mb-3 flex items-center gap-2 px-1"><History size={12}/> Historial</p>
                        <div className="space-y-1 max-h-[200px] overflow-y-auto custom-scrollbar pr-1">
                            {auditedShifts.length === 0 && <p className="text-xs text-slate-400 italic px-1">Vacío.</p>}
                            {auditedShifts.slice(0, 10).map(shift => ( 
                                <div key={shift.id} className="flex justify-between items-center text-xs p-2 hover:bg-slate-50 rounded-lg transition-colors group cursor-pointer" onClick={() => handleViewClosedShift(shift)}>
                                    <div>
                                        <span className="font-medium text-slate-700 block truncate max-w-[120px]">{resolveName(shift.userId, shift.userName)}</span>
                                        <span className="text-[9px] text-slate-400">{new Date(shift.closedAt).toLocaleDateString()}</span>
                                    </div>
                                    <ArrowRight size={14} className="text-slate-300 group-hover:text-slate-600"/>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            <TicketZModal isOpen={isReportModalOpen} onClose={() => {setIsReportModalOpen(false); setAuditTarget(null);}} reportData={reportData} onConfirmAudit={auditTarget ? handleConfirmAuditAction : undefined} />
        </Card>
    );
};

// ... (AdminSecurityPanel y QuickActionsPanel se mantienen igual)
const AdminSecurityPanel = ({ onUpdatePin }) => {
    const [newPin, setNewPin] = useState('');
    return (
        <Card className="p-5 border border-slate-200 bg-slate-50 shadow-none">
            <div className="flex items-center gap-2 mb-2"><Shield size={16} className="text-slate-400" /><h3 className="font-bold text-slate-700 text-sm">PIN Maestro (Global)</h3></div>
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

const QuickActionsPanel = ({ navigate, onExpenseClick, onWithdrawalClick, isAdmin }) => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
            { label: 'Ir a Vender', icon: ShoppingBag, color: 'text-brand', bg: 'group-hover:bg-brand/10', action: () => navigate('pos') },
            { label: 'Registrar Gasto', icon: DollarSign, color: 'text-rose-500', bg: 'group-hover:bg-rose-50', action: onExpenseClick },
            { label: 'Retiro Efectivo', icon: Banknote, color: 'text-amber-500', bg: 'group-hover:bg-amber-50', action: onWithdrawalClick },
            { label: 'Ver Ventas', icon: FileText, color: 'text-blue-500', bg: 'group-hover:bg-blue-50', action: () => navigate('sales') },
        ].map((btn, i) => (
            <button key={i} onClick={btn.action} className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:border-slate-300 transition-all flex flex-col items-center gap-2 group">
                <div className={cn("p-3 bg-slate-50 rounded-full transition-colors", btn.bg)}>
                    <btn.icon className={cn("text-slate-600 transition-transform group-hover:scale-110", `group-hover:${btn.color}`)} size={20} />
                </div>
                <span className="font-bold text-slate-700 text-xs">{btn.label}</span>
            </button>
        ))}
    </div>
);

// =================================================================
// 5. VISTAS DE ROL
// =================================================================
const CajeroDashboardView = ({ metrics, money, handleOpenShift, onTriggerClose, navigate, onExpenseClick, onWithdrawalClick }) => {
    return (
        <div className="space-y-6 pb-20 animate-in fade-in">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <KpiCard metrics={metrics} isAdmin={false} money={money} navigate={navigate} onTriggerClose={onTriggerClose} isCajeroActive={!!metrics.activeShift} />
                <div className="space-y-4">
                    <MyShiftCard metrics={metrics} money={money} handleOpenShift={handleOpenShift} />
                </div>
            </div>
            <QuickActionsPanel navigate={navigate} onExpenseClick={onExpenseClick} onWithdrawalClick={onWithdrawalClick} isAdmin={false} />
        </div>
    );
};

const AdminDashboardView = ({ metrics, money, navigate, loadIntelligence, handleUpdatePin, allShifts, cloudLoading, handleOpenShift, onTriggerClose, onExpenseClick, onWithdrawalClick, resolveName, activeBranchName, pendingShifts }) => (
    <div className="space-y-6 pb-20 animate-in fade-in">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard metrics={metrics} isAdmin={true} money={money} navigate={navigate} onTriggerClose={onTriggerClose} isCajeroActive={!!metrics.activeShift} activeBranchName={activeBranchName} />
            <StatCard title="Gastos Operativos" value={`$ ${money(metrics.totalExpenses)}`} subtext="Salidas del día" icon={TrendingDown} colorClass="bg-rose-50 text-rose-600" borderClass="border-slate-200" />
            <StatCard title="Cajas Activas" value={metrics.activeShiftsCount} subtext="En tiempo real" icon={Monitor} colorClass="bg-blue-50 text-blue-600" borderClass="border-slate-200" />
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
                 <ArcaMonitorCard stats={metrics.fiscalStats || { daily:0, weekly:0, monthly:0, lastTime: null }} onManageClick={() => navigate('fiscal')} />
                 <AdminCashAuditPanel allShifts={allShifts} pendingShifts={pendingShifts} loadIntelligence={loadIntelligence} navigate={navigate} resolveName={resolveName} />
                 
                 <Card className="p-0 overflow-hidden shadow-sm border border-slate-200 bg-white">
                    <div className="p-3 border-b border-slate-100 bg-white flex justify-between items-center"><h3 className="font-bold text-xs text-slate-800 flex items-center gap-2"><Activity size={14}/> Actividad Reciente</h3></div>
                    <div className="divide-y divide-slate-50 max-h-[250px] overflow-y-auto custom-scrollbar">
                        {metrics.recentSales?.length > 0 ? metrics.recentSales.map((sale) => (
                            <div key={sale.id} className="p-3 hover:bg-slate-50 transition-colors flex items-center justify-between text-xs">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 border border-slate-200"><ShoppingBag size={14} /></div>
                                    <div>
                                        <p className="font-bold text-slate-800">{sale.number}</p> {/* 🔥 MUESTRA EL ID SECUENCIAL REAL */}
                                        <p className="text-[9px] text-slate-400">{sale.time} hs • {sale.items} un.</p>
                                    </div>
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
const DashboardContent = () => {
    const navigate = useNavigate();
    const { user, activeBranchId, activeBranchName } = useAuthStore(); 
    const [loading, setLoading] = useState(true);
    const [metrics, setMetrics] = useState({ 
        todaySales: 0, cashInHand: 0, digitalSales: 0, totalExpenses: 0, 
        activeShiftsCount: 0, activeShift: null, allShifts: [], 
        recentSales: [], averageTicket: 0, topProducts: [],
        fiscalStats: { daily: 0, weekly: 0, monthly: 0, lastTime: null } 
    });

    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [isWithdrawalModalOpen, setIsWithdrawalModalOpen] = useState(false); 
    const [shiftToClose, setShiftToClose] = useState(null); // 🔥 ESTADO PARA EL MODAL DE CIERRE
    const [cashiersList, setCashiersList] = useState([]); 
    const [dbStatus, setDbStatus] = useState({ checked: false, hasBranches: false });

    const isAdmin = user?.role?.toUpperCase() === 'ADMIN' || user?.role === 'OWNER';
    const cloudStats = useCloudDashboard();

    if (!user) return <div className="p-10 text-center text-slate-500">Error: Usuario no autenticado.</div>;
    const money = (val) => val ? val.toLocaleString('es-AR', {minimumFractionDigits: 2}) : '0.00';

    // ... (Hooks de carga inicial, salud DB y usuarios se mantienen igual)
    useEffect(() => {
        const checkHealth = async () => {
            if (!isAdmin || !user?.companyId) { setDbStatus({ checked: true, hasBranches: true }); return; }
            try {
                const count = await localDb.branches.count();
                if (count > 0) { setDbStatus({ checked: true, hasBranches: true }); return; }
                const q = collection(firestoreDB, 'companies', user.companyId, 'branches');
                const snap = await getDocs(q);
                setDbStatus({ checked: true, hasBranches: !snap.empty });
            } catch (e) { setDbStatus({ checked: true, hasBranches: true }); }
        };
        checkHealth();
    }, [user, isAdmin]);

    const handleFixBranches = async () => {
        try {
            const defaults = [{ name: 'Casa Central', address: 'Main', type: 'physical' }];
            const batchPromises = defaults.map(async (b) => {
                const docRef = await addDoc(collection(firestoreDB, 'companies', user.companyId, 'branches'), { ...b, active: true, createdAt: serverTimestamp() });
                return { id: docRef.id, ...b, active: true };
            });
            await Promise.all(batchPromises);
            await localDb.branches.bulkPut(await Promise.all(batchPromises));
            window.location.reload();
        } catch (error) { alert(error.message); }
    };

    useEffect(() => {
        if (user?.companyId && isAdmin) {
            const fetchCashiers = async () => {
                const q = query(collection(firestoreDB, 'users'), where('companyId', '==', user.companyId));
                const snap = await getDocs(q);
                setCashiersList(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() })));
            };
            fetchCashiers();
        }
    }, [user?.companyId, isAdmin]);

    const resolveCashierName = (shiftUserId, shiftUserName) => {
        const matchedUser = cashiersList.find(u => u.uid === shiftUserId || u.email === shiftUserId);
        if (matchedUser) return matchedUser.name || matchedUser.email.split('@')[0];
        return shiftUserName !== 'Cajero' ? shiftUserName : "Cajero";
    };

    useEffect(() => { if (user) loadIntelligence(); }, [user.name, user.role, activeBranchId]);

    const loadIntelligence = async () => {
        if (isAdmin && !dbStatus.hasBranches) return;
        setLoading(true);
        try {
            const allShifts = await cashRepository.getAllShifts();
            const myActiveShift = allShifts.find(s => s.status === 'OPEN' && s.userId === user.uid);
            
            // Cálculos rápidos locales para el cajero
            if (!isAdmin) {
                const sales = await salesRepository.getTodaySales();
                const mSales = sales.reduce((acc, s) => {
                    const total = parseFloat(s.total) || 0;
                    acc.total += total;
                    if (s.payment?.method === 'cash') acc.cash += total; else acc.digital += total;
                    return acc;
                }, { total: 0, cash: 0, digital: 0 });

                setMetrics(prev => ({
                    ...prev,
                    todaySales: mSales.total,
                    cashInHand: mSales.cash,
                    digitalSales: mSales.digital,
                    activeShift: myActiveShift,
                    allShifts: allShifts
                }));
            } else {
                 setMetrics(prev => ({ ...prev, activeShift: myActiveShift, allShifts }));
            }
        } catch (error) { console.error(error); }
        setLoading(false);
    };

    const finalMetrics = isAdmin ? {
        ...metrics,
        todaySales: cloudStats.totalSales, 
        cashInHand: cloudStats.cashTotal,
        digitalSales: cloudStats.digitalTotal,
        fiscalCount: cloudStats.fiscalCount || 0,
        recentSales: cloudStats.recentSales,
        averageTicket: cloudStats.averageTicket || 0,
        topProducts: cloudStats.topProducts || [],
        activeShiftsCount: cloudStats.activeShiftsCount || 0
    } : metrics;

    const handleOpenShift = async () => {
        const input = prompt("Monto inicial:", "1000");
        if (input === null) return;
        const amount = parseFloat(input);
        if (isNaN(amount) || amount < 0) return alert("Inválido");
        try { await cashRepository.openShift(amount, user?.name); await loadIntelligence(); alert("✅ Caja abierta!"); } catch (e) { alert(e.message); }
    };
    
    // 🔥 TRIGGER PARA ABRIR MODAL (Reemplaza al prompt)
    const triggerCloseShift = () => {
        if (!metrics.activeShift) return alert("No hay turno abierto.");
        setShiftToClose(metrics.activeShift);
    };

    // 🔥 MANEJADOR DE CIERRE REAL (Recibe todos los datos del Modal)
    const handleConfirmCloseShift = async (closingData) => {
        try {
            setLoading(true);
            const shiftId = shiftToClose.id;
            
            // ClosingData ya trae: { declaredCash, leftInCash, expectedCash... }
            await cashRepository.closeShift(shiftId, closingData);
            
            alert("✅ Cierre registrado correctamente.");
            setShiftToClose(null);
            await loadIntelligence();
        } catch (error) {
            alert(`❌ Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleRegisterExpense = async ({ amount, description }) => {
        try { await cashRepository.registerExpense(amount, description, '', user?.name); await loadIntelligence(); alert(`✅ Gasto registrado.`); } catch (e) { alert(e.message); }
    };

    const handleRegisterWithdrawal = async ({ amount, description, adminPin }) => {
        try {
            const isValid = await securityService.verifyMasterPin(adminPin);
            if (!isValid) return alert("⛔ PIN INCORRECTO.");
            await cashRepository.registerWithdrawal(amount, description, 'Autorizado por PIN', user?.name);
            await loadIntelligence(); alert(`✅ Retiro autorizado.`);
        } catch (e) { alert(e.message); }
    };

    const handleUpdatePin = async (newPin) => {
        if (!newPin || newPin.length < 4) return alert("Mínimo 4 dígitos.");
        await securityService.setMasterPin(newPin); alert("✅ PIN Maestro actualizado.");
    };

    if (!dbStatus.checked) return <div className="w-full h-[80vh] flex flex-col items-center justify-center animate-pulse"><div className="w-16 h-16 border-4 border-slate-100 border-t-brand rounded-full animate-spin"></div></div>;
    if (!dbStatus.hasBranches && isAdmin) return <NoBranchesSetupView onFix={handleFixBranches} />;

    return (
        <div className="w-full space-y-8 pb-20 max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div><h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">Hola, {user?.name?.split(' ')[0] || 'Admin'} <span className="text-2xl">👋</span></h1><p className="text-slate-500 font-medium text-sm mt-1">Resumen operativo.</p></div>
                {isAdmin && <BranchSelector allowAll={true} />}
            </div>

            {isAdmin ? (
                <AdminDashboardView 
                    metrics={finalMetrics} money={money} navigate={navigate} 
                    loadIntelligence={loadIntelligence} handleUpdatePin={handleUpdatePin}
                    allShifts={finalMetrics.allShifts} cloudLoading={cloudStats.loading}
                    handleOpenShift={handleOpenShift} onTriggerClose={triggerCloseShift}
                    onExpenseClick={() => setIsExpenseModalOpen(true)}
                    onWithdrawalClick={() => setIsWithdrawalModalOpen(true)}
                    resolveName={resolveCashierName} activeBranchName={activeBranchName}
                    pendingShifts={cloudStats.pendingShifts} 
                />
            ) : (
                <CajeroDashboardView 
                    metrics={finalMetrics} money={money} navigate={navigate} 
                    handleOpenShift={handleOpenShift} onTriggerClose={triggerCloseShift}
                    onExpenseClick={() => setIsExpenseModalOpen(true)}
                    onWithdrawalClick={() => setIsWithdrawalModalOpen(true)}
                />
            )}

            <ExpenseModal isOpen={isExpenseModalOpen} onClose={() => setIsExpenseModalOpen(false)} onConfirm={handleRegisterExpense} />
            <WithdrawalModal isOpen={isWithdrawalModalOpen} onClose={() => setIsWithdrawalModalOpen(false)} onConfirm={handleRegisterWithdrawal} />
            
            {/* 🔥 WRAPPER PARA EL MODAL DE CIERRE CON DATOS EN VIVO */}
            {shiftToClose && (
                <CashClosingWrapper 
                    shift={shiftToClose} 
                    onClose={() => setShiftToClose(null)} 
                    onConfirm={handleConfirmCloseShift} 
                />
            )}
        </div>
    );
};

// Componente auxiliar para cargar balances antes de abrir el modal
const CashClosingWrapper = ({ shift, onClose, onConfirm }) => {
    const [totals, setTotals] = useState(null);
    
    // Cargamos el balance en tiempo real al abrir el modal
    useEffect(() => {
        let mounted = true;
        cashRepository.getShiftBalance(shift.id).then(bal => {
            if (mounted) setTotals({ totalCash: bal.totalCash, totalDigital: bal.totalDigital });
        });
        return () => { mounted = false; };
    }, [shift]);

    if (!totals) return null;
    return <CashClosingModal isOpen={true} onClose={onClose} systemTotals={totals} onConfirm={onConfirm} />;
};

export const DashboardPage = DashboardContent;