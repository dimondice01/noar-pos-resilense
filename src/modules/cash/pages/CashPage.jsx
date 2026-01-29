import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    Wallet, Lock, Unlock, FileText, AlertTriangle, Search, Eye, 
    ArrowRight, ShieldCheck, User, RefreshCw, ChevronLeft, ChevronRight,
    Printer, CheckCircle, Filter, Hash, TrendingUp,
    History as HistoryIcon
} from 'lucide-react';

// 🔥 REPOSITORIO ÚNICO DE VERDAD
import { cashRepository } from '../../cash/repositories/cashRepository'; 

// Stores & UI
import { useAuthStore } from '../../auth/store/useAuthStore';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import { CashClosingModal } from '../components/CashClosingModal'; 
import { TicketZModal } from '../../reports/components/TicketZModal'; 

// Firebase
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db as firestoreDB } from '../../../database/firebase';

const formatCurrency = (amount) => `$ ${Number(amount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

// ... (El helper getShiftValues y getMovementProps NO cambian, los omito para ahorrar espacio visual, manténlos igual) ...
const getShiftValues = (shift, calculatedDetails = null) => {
    if (!shift) return { expected: 0, declared: 0, diff: 0, initial: 0, left: 0 };
    const isValid = (val) => val !== undefined && val !== null;
    let expected = 0;
    if (calculatedDetails && isValid(calculatedDetails.totalCash)) {
        expected = Number(calculatedDetails.totalCash);
    } else if (isValid(shift.expectedCash)) {
        expected = Number(shift.expectedCash);
    } else if (isValid(shift.systemAmount)) {
        expected = Number(shift.systemAmount);
    }
    let declared = 0;
    if (isValid(shift.finalCash)) {
        declared = Number(shift.finalCash);
    } else if (isValid(shift.finalAmount)) {
        declared = Number(shift.finalAmount);
    }
    const initial = Number(shift.initialAmount) || 0;
    const left = Number(shift.leftInCash) || 0; 
    const diff = declared - expected;
    return { expected, declared, diff, initial, left };
};

const getMovementProps = (mov) => {
    if (!mov) return { sign: '', color: '', typeLabel: '', methodTag: '' };
    const isIncome = mov.type === 'SALE' || mov.type === 'DEPOSIT' || mov.type === 'IN';
    const isCash = mov.method === 'cash' || mov.type === 'WITHDRAWAL'; 
    let sign = isIncome ? '+' : '-';
    let color = isIncome ? 'text-green-600' : 'text-red-600';
    let typeLabel = mov.type === 'SALE' ? 'VENTA' : mov.type === 'DEPOSIT' || mov.type === 'IN' ? 'INGRESO' : 'RETIRO';
    let methodTag = (mov.method || 'desconocido'); 
    if (methodTag === 'cash') methodTag = 'Efectivo';
    else methodTag = methodTag.toUpperCase();
    if (mov.type === 'SALE' && !isCash) {
        color = 'text-blue-600';
        sign = '+';
    }
    if (mov.description === 'Fondo Inicial de Caja') {
        color = 'text-brand';
        sign = '+';
        typeLabel = 'INICIAL';
    }
    if (mov.type === 'WITHDRAWAL') {
        color = 'text-red-600';
        sign = '-';
    }
    return { sign, color, typeLabel, methodTag };
};

// ... (AuditDetailModal TAMPOCO cambia, manténlo igual) ...
const AuditDetailModal = ({ shift, onClose, resolveName }) => {
    const [details, setDetails] = useState(null);
    const [loadingDetails, setLoadingDetails] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 20;

    useEffect(() => {
        if (shift) {
            setLoadingDetails(true);
            setCurrentPage(1); 
            cashRepository.getShiftBalance(shift.id).then(bal => {
                setDetails(bal);
            }).catch(err => {
                console.error("Error balance:", err);
                setDetails({ totalCash: 0, movements: [], totalDigital: 0 }); 
            }).finally(() => {
                setLoadingDetails(false);
            });
        }
    }, [shift]);

    if (!shift) return null;

    if (loadingDetails) {
        return (
             <div className="fixed inset-0 z-[80] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in">
                 <Card className="p-8 text-center flex flex-col items-center gap-2">
                     <RefreshCw size={32} className="animate-spin text-brand" />
                     <p className="text-sm font-medium text-sys-600">Calculando balance...</p>
                 </Card>
            </div>
        );
    }
    
    const safeDetails = details || { totalCash: 0, movements: [], totalDigital: 0 };
    const allMovements = Array.isArray(safeDetails.movements) ? safeDetails.movements : [];
    const { expected, declared, diff, initial, left } = getShiftValues(shift, safeDetails);
    const isPerfect = Math.abs(diff) < 50; 

    // Paginación
    const totalPages = Math.ceil(allMovements.length / itemsPerPage);
    const paginatedMovements = allMovements.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
                
                <div className="p-5 border-b border-sys-100 bg-sys-50 flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-xl text-sys-900 flex items-center gap-2">
                            <ShieldCheck size={24} className="text-brand" /> Auditoría Detallada
                        </h3>
                        <p className="text-xs text-sys-500 font-mono">
                            ID: {shift.id.slice(-6)} | {shift.openedAt ? new Date(shift.openedAt).toLocaleString() : '-'}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-500 font-bold text-xl leading-none">&times;</button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-sys-50/30">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-4 bg-white rounded-xl border border-sys-200 text-center shadow-sm">
                            <p className="text-xs uppercase font-bold text-sys-500 mb-1">Sistema (Esperado)</p>
                            <p className="text-xl font-bold text-sys-800">{formatCurrency(expected)}</p>
                            <p className="text-xs text-sys-400 mt-1">Fondo: {formatCurrency(initial)}</p>
                        </div>
                        <div className="p-4 bg-white rounded-xl border border-sys-200 text-center shadow-sm">
                            <p className="text-xs uppercase font-bold text-sys-500 mb-1">Cajero (Declarado)</p>
                            <p className="text-xl font-bold text-sys-900">{formatCurrency(declared)}</p>
                            <p className="text-xs text-sys-400 mt-1">Digital: {formatCurrency(safeDetails.totalDigital)}</p>
                        </div>
                        <div className={cn("p-4 rounded-xl border text-center flex flex-col justify-center shadow-sm", 
                            isPerfect ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
                        )}>
                            <p className={cn("text-xs uppercase font-bold mb-1", isPerfect ? "text-green-600" : "text-red-600")}>
                                {isPerfect ? 'Perfecto' : diff >= 0 ? 'Sobrante' : 'Faltante'}
                            </p>
                            <p className={cn("text-xl font-black", isPerfect ? "text-green-700" : "text-red-700")}>
                                {diff > 0 ? '+' : ''} {formatCurrency(diff)}
                            </p>
                        </div>
                        <div className="p-4 bg-brand/5 rounded-xl border border-brand/20 text-center shadow-sm flex flex-col justify-center">
                            <p className="text-xs uppercase font-bold text-brand mb-1">Dejado en Caja</p>
                            <p className="text-xl font-black text-sys-900">{formatCurrency(left)}</p>
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between items-center mb-3">
                            <h4 className="font-bold text-sys-800 flex items-center gap-2"><FileText size={16} /> Movimientos ({allMovements.length})</h4>
                            {totalPages > 1 && <span className="text-xs text-sys-500 font-mono bg-white px-2 py-1 rounded border">Pág {currentPage}/{totalPages}</span>}
                        </div>
                        <div className="border border-sys-200 rounded-xl overflow-hidden min-h-[300px] flex flex-col bg-white shadow-sm">
                            <table className="w-full text-sm text-left flex-1">
                                <thead className="bg-sys-50 text-xs uppercase font-semibold text-sys-500 border-b border-sys-100">
                                    <tr>
                                        <th className="p-3 w-1/12 text-center">Tipo</th>
                                        <th className="p-3 w-2/12">Hora</th>
                                        <th className="p-3 w-4/12">Concepto</th>
                                        <th className="p-3 w-2/12">Método</th>
                                        <th className="p-3 w-3/12 text-right">Monto</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-sys-100">
                                    {paginatedMovements.map(m => {
                                        const { sign, color, typeLabel, methodTag } = getMovementProps(m);
                                        return (
                                            <tr key={m.id || Math.random()} className="hover:bg-sys-50 transition-colors">
                                                <td className="p-3 text-center"><span className={cn("text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-sys-100", color)}>{typeLabel}</span></td>
                                                <td className="p-3 font-mono text-sys-500 text-xs">{m.date ? new Date(m.date).toLocaleTimeString() : '-'}</td>
                                                <td className="p-3 text-sys-800 font-medium">{m.description || 'Sin descripción'}</td>
                                                <td className="p-3 text-sys-500 text-xs uppercase font-bold">{methodTag}</td>
                                                <td className={cn("p-3 text-right font-black font-mono", color)}>{sign} {formatCurrency(m.amount)}</td>
                                            </tr>
                                        );
                                    })}
                                    {allMovements.length === 0 && <tr><td colSpan="5" className="p-10 text-center text-sys-400 italic">No hay movimientos registrados.</td></tr>}
                                </tbody>
                            </table>
                            {totalPages > 1 && (
                                <div className="p-3 border-t border-sys-100 bg-sys-50/50 flex justify-center gap-2">
                                    <Button variant="ghost" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}><ChevronLeft size={16}/> Anterior</Button>
                                    <Button variant="ghost" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>Siguiente <ChevronRight size={16}/></Button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="p-5 border-t border-sys-100 bg-sys-50 flex justify-end"><Button onClick={onClose} variant="secondary">Cerrar Detalle</Button></div>
            </div>
        </div>
    );
};

// ============================================================================
// PÁGINA PRINCIPAL: TESORERÍA (CON LOGS)
// ============================================================================
export const CashPage = () => {
    const navigate = useNavigate();
    
    // 🔥 FIX DE REACTIVIDAD: Extraemos activeBranchId para que el componente se suscriba
    const { user, activeBranchId } = useAuthStore(); 
    
    const [activeTab, setActiveTab] = useState('active'); 
    const [allShifts, setAllShifts] = useState([]);
    const [cashiersList, setCashiersList] = useState([]); 
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    
    // Paginación
    const [historyPage, setHistoryPage] = useState(1);
    const HISTORY_PAGE_SIZE = 10;
    
    // Modales
    const [selectedShiftForAudit, setSelectedShiftForAudit] = useState(null);
    const [shiftToClose, setShiftToClose] = useState(null);
    const [isZReportOpen, setIsZReportOpen] = useState(false);
    const [zReportData, setZReportData] = useState(null);

    // 1. CARGA DE DATOS (USANDO SOLO CASHREPOSITORY)
    const loadInitialData = async () => {
        setLoading(true);
        try {
            console.log("⚡ CashPage: Solicitando datos...");
            console.log("⚡ Estado Actual - AuthStore:", { uid: user?.uid, role: user?.role, activeBranchId });

            const usersPromise = user?.companyId ? (async () => {
                const q = query(collection(firestoreDB, 'users'), where('companyId', '==', user.companyId));
                const snap = await getDocs(q);
                return snap.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
            })() : Promise.resolve([]);

            // 🔥 ÚNICA FUENTE DE VERDAD: cashRepository
            // Gracias al fix de reactividad, esto ahora filtrará con el branchId correcto
            const shiftsPromise = cashRepository.getAllShifts(); 
            
            const [users, shifts] = await Promise.all([usersPromise, shiftsPromise]);

            console.log("⚡ CashPage: Datos recibidos del Repo:", shifts.length);

            setCashiersList(users);
            
            // Ordenar por fecha (más reciente primero)
            const sortedShifts = shifts.sort((a, b) => {
                const dateA = new Date(a.closedAt || a.openedAt || 0);
                const dateB = new Date(b.closedAt || b.openedAt || 0);
                return dateB - dateA;
            });
            
            setAllShifts(sortedShifts);
        } catch (error) {
            console.error("Error Tesorería:", error);
        } finally {
            setLoading(false);
        }
    };

    // 🔥🔥 FIX FINAL: Recarga cuando user.companyId O activeBranchId cambian
    useEffect(() => { 
        if (user?.companyId) {
            console.log("🔄 CashPage: Recargando por cambio de contexto...", activeBranchId);
            loadInitialData(); 
        }
    }, [user?.companyId, activeBranchId]); 

    // Helper Nombre
    const resolveCashierName = (shiftUserId, shiftUserName) => {
        const matchedUser = cashiersList.find(u => u.uid === shiftUserId || u.email === shiftUserId);
        if (matchedUser) return matchedUser.name || matchedUser.email.split('@')[0];
        return shiftUserName || "Cajero";
    };

    // 2. BUSCADOR INTELIGENTE
    const filteredShifts = useMemo(() => {
        if (!searchTerm) return allShifts;
        const search = searchTerm.toLowerCase();
        
        return allShifts.filter(s => {
            const name = resolveCashierName(s.userId, s.userName).toLowerCase();
            const shiftId = (s.id || '').toLowerCase();
            const status = (s.status || '').toLowerCase();
            return name.includes(search) || shiftId.includes(search) || status.includes(search);
        });
    }, [allShifts, searchTerm, cashiersList]);

    const activeShifts = filteredShifts.filter(s => s.status === 'OPEN');
    const closedShifts = filteredShifts.filter(s => s.status === 'CLOSED');

    const totalHistoryPages = Math.ceil(closedShifts.length / HISTORY_PAGE_SIZE);
    const paginatedHistory = closedShifts.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE);

    // 3. ACCIONES DE REPORTE Z
    const handleOpenZReport = async (shift) => {
        try {
            const auditData = await cashRepository.getShiftAuditData(shift.id);
            setZReportData(auditData);
            setIsZReportOpen(true);
        } catch (e) {
            alert("No se pudo generar el reporte Z: " + e.message);
        }
    };

    const handleCloseShift = async (closingData) => {
        try {
            await cashRepository.closeShift(shiftToClose.id, closingData);
            alert("✅ Caja cerrada con éxito.");
            setShiftToClose(null);
            loadInitialData();
        } catch (e) { alert(e.message); }
    };

    if (loading) return (
        <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
            <RefreshCw className="animate-spin text-brand" size={48} />
            <p className="text-sys-400 font-bold animate-pulse">Sincronizando Tesorería...</p>
        </div>
    );

    return (
        <div className="space-y-6 pb-20 animate-in fade-in">
            
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                    <h2 className="text-2xl font-black text-sys-900 flex items-center gap-2">
                        <Wallet className="text-brand" size={32} /> Tesorería & Auditoría
                    </h2>
                    <p className="text-sys-500 text-sm">Control centralizado de flujos de efectivo y cierres Z.</p>
                </div>
                
                <div className="relative w-full md:w-80">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400" size={18} />
                    <input 
                        type="text" 
                        placeholder="Buscar cajero, ID turno..." 
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-sys-200 rounded-2xl outline-none focus:border-brand shadow-sm transition-all text-sm font-medium"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            {/* Tabs */}
            <div className="flex bg-white p-1.5 rounded-2xl shadow-sm border border-sys-100 w-fit">
                <button onClick={() => setActiveTab('active')} className={cn("px-6 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2", activeTab === 'active' ? "bg-sys-900 text-white shadow-lg" : "text-sys-500 hover:bg-sys-50")}>
                    <Unlock size={14}/> Activas ({activeShifts.length})
                </button>
                <button onClick={() => setActiveTab('history')} className={cn("px-6 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2", activeTab === 'history' ? "bg-sys-900 text-white shadow-lg" : "text-sys-500 hover:bg-sys-50")}>
                    <HistoryIcon size={14}/> Historial ({closedShifts.length})
                </button>
            </div>

            {/* VISTA 1: CAJAS ACTIVAS */}
            {activeTab === 'active' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {activeShifts.length === 0 ? (
                        <Card className="col-span-full py-20 text-center border-dashed border-2 flex flex-col items-center gap-4 opacity-50 bg-transparent shadow-none">
                            <Lock size={48} className="text-sys-300" />
                            <p className="font-bold text-sys-500">No hay cajas abiertas en este momento</p>
                        </Card>
                    ) : (
                        activeShifts.map(shift => (
                            <Card key={shift.id} className="relative overflow-hidden border-0 shadow-xl bg-white group hover:scale-[1.01] transition-all">
                                <div className="absolute top-0 left-0 w-2 h-full bg-emerald-500"></div>
                                <div className="p-6">
                                    <div className="flex justify-between items-start mb-6">
                                        <div>
                                            <span className="text-[10px] font-black uppercase text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">Operativo</span>
                                            <h3 className="text-xl font-black text-sys-900 mt-2">{resolveCashierName(shift.userId, shift.userName)}</h3>
                                            <p className="text-xs text-sys-400 font-mono mt-1">ID: {shift.id.slice(-6)}</p>
                                        </div>
                                        <div className="p-3 bg-emerald-50 rounded-2xl text-emerald-500"><Unlock size={24} /></div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 mb-6">
                                        <div className="bg-sys-50 p-3 rounded-xl"><p className="text-[9px] font-bold text-sys-400 uppercase">Inicio</p><p className="font-bold text-sys-800 text-sm">{new Date(shift.openedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p></div>
                                        <div className="bg-sys-50 p-3 rounded-xl"><p className="text-[9px] font-bold text-sys-400 uppercase">Fondo</p><p className="font-bold text-sys-800 text-sm">{formatCurrency(shift.initialAmount)}</p></div>
                                    </div>
                                    <Button onClick={() => setShiftToClose(shift)} className="w-full bg-rose-500 hover:bg-rose-600 text-white border-none shadow-lg shadow-rose-200 py-3 font-bold rounded-xl">
                                        Efectuar Cierre Z
                                    </Button>
                                </div>
                            </Card>
                        ))
                    )}
                </div>
            )}

            {/* VISTA 2: HISTORIAL */}
            {activeTab === 'history' && (
                <Card className="p-0 overflow-hidden border-0 shadow-2xl rounded-3xl bg-white flex flex-col min-h-[500px]">
                    <div className="overflow-x-auto flex-1">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-sys-900 text-white text-[10px] font-black uppercase tracking-widest sticky top-0 z-10">
                                <tr>
                                    <th className="p-5">Fecha Cierre</th>
                                    <th className="p-5">Cajero</th>
                                    <th className="p-5 text-right">Teórico</th>
                                    <th className="p-5 text-right">Real</th>
                                    <th className="p-5 text-right">Dejado</th>
                                    <th className="p-5 text-center">Desvío</th>
                                    <th className="p-5 text-center">Estado</th>
                                    <th className="p-5 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-sys-50">
                                {paginatedHistory.length === 0 ? (
                                    <tr><td colSpan="8" className="p-20 text-center text-sys-400 italic">No se encontraron registros.</td></tr>
                                ) : (
                                    paginatedHistory.map(shift => {
                                        const { expected, declared, diff, left } = getShiftValues(shift);
                                        const isPerfect = Math.abs(diff) < 50;
                                        return (
                                            <tr key={shift.id} className="hover:bg-sys-50 transition-colors">
                                                <td className="p-5">
                                                    <div className="font-bold text-sys-800">{new Date(shift.closedAt).toLocaleDateString()}</div>
                                                    <div className="text-[10px] text-sys-400 font-mono">{new Date(shift.closedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                                                </td>
                                                <td className="p-5 font-bold text-sys-700">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-6 h-6 rounded-full bg-brand/10 text-brand flex items-center justify-center text-[10px] font-black">
                                                            {resolveCashierName(shift.userId, shift.userName).charAt(0)}
                                                        </div>
                                                        {resolveCashierName(shift.userId, shift.userName)}
                                                    </div>
                                                </td>
                                                <td className="p-5 text-right font-mono text-sys-500">{formatCurrency(expected)}</td>
                                                <td className="p-5 text-right font-mono font-bold text-sys-900 bg-sys-50/30 rounded-lg">{formatCurrency(declared)}</td>
                                                <td className="p-5 text-right font-mono font-bold text-brand">{formatCurrency(left)}</td>
                                                <td className="p-5 text-center">
                                                    <span className={cn("px-2.5 py-1 rounded-lg text-[10px] font-black border uppercase", isPerfect ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-rose-50 text-rose-700 border-rose-100")}>
                                                        {isPerfect ? 'OK' : diff > 0 ? `+${formatCurrency(diff)}` : formatCurrency(diff)}
                                                    </span>
                                                </td>
                                                <td className="p-5 text-center">
                                                    {shift.audited ? (
                                                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full border border-blue-100">AUDITADO</span>
                                                    ) : (
                                                        <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded-full border border-orange-100">PENDIENTE</span>
                                                    )}
                                                </td>
                                                <td className="p-5 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <button onClick={() => setSelectedShiftForAudit(shift)} className="p-2 bg-white border border-sys-200 text-sys-600 rounded-xl hover:bg-sys-50 transition-all shadow-sm" title="Detalle Técnico">
                                                            <Eye size={16} />
                                                        </button>
                                                        <button onClick={() => handleOpenZReport(shift)} className="p-2 bg-brand text-white rounded-xl hover:bg-brand-hover transition-all shadow-md shadow-brand/20" title="Imprimir Ticket Z">
                                                            <Printer size={16} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                    
                    {totalHistoryPages > 1 && (
                        <div className="p-4 border-t border-sys-100 bg-sys-50 flex justify-between items-center px-6">
                            <span className="text-xs text-sys-500 font-medium">Página <b>{historyPage}</b> de <b>{totalHistoryPages}</b></span>
                            <div className="flex gap-2">
                                <Button variant="ghost" size="sm" disabled={historyPage === 1} onClick={() => setHistoryPage(p => Math.max(1, p - 1))} className="text-sys-500 hover:text-sys-900"><ChevronLeft size={16}/></Button>
                                <Button variant="ghost" size="sm" disabled={historyPage === totalHistoryPages} onClick={() => setHistoryPage(p => Math.min(totalHistoryPages, p + 1))} className="text-sys-500 hover:text-sys-900"><ChevronRight size={16}/></Button>
                            </div>
                        </div>
                    )}
                </Card>
            )}

            {/* MODALES */}
            <AuditDetailModal 
                shift={selectedShiftForAudit} 
                onClose={() => setSelectedShiftForAudit(null)} 
                resolveName={resolveCashierName}
            />

            {isZReportOpen && (
                <TicketZModal 
                    isOpen={isZReportOpen} 
                    onClose={() => setIsZReportOpen(false)} 
                    reportData={zReportData} 
                />
            )}

            {shiftToClose && (
                <CashClosingModalWrapper 
                    shift={shiftToClose}
                    onClose={() => setShiftToClose(null)}
                    onConfirm={handleCloseShift}
                />
            )}
        </div>
    );
};

// Wrapper para inyectar balances al modal de cierre
const CashClosingModalWrapper = ({ shift, onClose, onConfirm }) => {
    const [totals, setTotals] = useState(null);
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