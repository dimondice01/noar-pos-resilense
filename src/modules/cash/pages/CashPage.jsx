import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    Wallet, Lock, Unlock, FileText, AlertTriangle, Search, Eye, 
    ArrowRight, ShieldCheck, User, RefreshCw, ChevronLeft, ChevronRight 
} from 'lucide-react';

// Repositorios
import { cashRepository } from '../repositories/cashRepository'; 
import { shiftRepository } from '../repositories/shiftRepository'; 

// Stores & UI
import { useAuthStore } from '../../auth/store/useAuthStore';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import { CashClosingModal } from '../components/CashClosingModal'; 

// Firebase Imports
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db as firestoreDB } from '../../../database/firebase';

const formatCurrency = (amount) => `$ ${Number(amount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

// ============================================================================
// 🧠 HELPER MAESTRO: LECTURA INTELIGENTE DE VALORES
// ============================================================================
const getShiftValues = (shift, calculatedDetails = null) => {
    if (!shift) return { expected: 0, declared: 0, diff: 0, initial: 0 };

    const isValid = (val) => val !== undefined && val !== null;

    // 1. Teórico/Esperado
    let expected = 0;
    if (calculatedDetails && isValid(calculatedDetails.totalCash)) {
        expected = Number(calculatedDetails.totalCash);
    } else if (isValid(shift.systemAmount)) {
        expected = Number(shift.systemAmount);
    } else if (isValid(shift.stats?.expectedTotal)) {
        expected = Number(shift.stats.expectedTotal);
    } else if (isValid(shift.expectedCash)) {
        expected = Number(shift.expectedCash);
    }

    // 2. Real/Declarado
    let declared = 0;
    if (isValid(shift.finalAmount)) {
        declared = Number(shift.finalAmount);
    } else if (isValid(shift.stats?.declaredCash)) {
        declared = Number(shift.stats.declaredCash);
    } else if (isValid(shift.finalCash)) {
        declared = Number(shift.finalCash);
    }

    const initial = Number(shift.initialAmount) || 0;
    const diff = declared - expected;

    return { expected, declared, diff, initial };
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

// ============================================================================
// SUB-COMPONENTE: DETALLE DE AUDITORÍA (MODAL)
// ============================================================================
const AuditDetailModal = ({ shift, onClose }) => {
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
    const { expected, declared, diff, initial } = getShiftValues(shift, safeDetails);
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
                        <div className={cn("p-4 rounded-xl border text-center flex flex-col justify-center shadow-sm", 
                            shift.audited ? "bg-blue-50 border-blue-200" : "bg-orange-50 border-orange-200"
                        )}>
                            <p className="text-xs uppercase font-bold text-sys-500 mb-1">Estado</p>
                            <p className={cn("text-lg font-black", shift.audited ? "text-blue-700" : "text-orange-700")}>
                                {shift.audited ? 'AUDITADO' : 'PENDIENTE'}
                            </p>
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
// PÁGINA PRINCIPAL: TESORERÍA
// ============================================================================
export const CashPage = () => {
    const navigate = useNavigate();
    const { user } = useAuthStore();
    
    const [activeTab, setActiveTab] = useState('active'); 
    const [allShifts, setAllShifts] = useState([]);
    const [cashiersList, setCashiersList] = useState([]); 
    const [loading, setLoading] = useState(true);
    
    // Estado de Paginación Principal (Historial)
    const [historyPage, setHistoryPage] = useState(1);
    const HISTORY_PAGE_SIZE = 10;
    
    const [selectedShiftForAudit, setSelectedShiftForAudit] = useState(null);
    const [shiftToClose, setShiftToClose] = useState(null);

    // 1. CARGA INICIAL ROBUSTA (PARALELA)
    const loadInitialData = async () => {
        setLoading(true);
        try {
            // Cargar usuarios y turnos en paralelo para velocidad
            const usersPromise = user?.companyId ? (async () => {
                const q = query(collection(firestoreDB, 'users'), where('companyId', '==', user.companyId));
                const snap = await getDocs(q);
                return snap.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
            })() : Promise.resolve([]);

            const shiftsPromise = shiftRepository.getAllShifts();

            const [users, shifts] = await Promise.all([usersPromise, shiftsPromise]);

            setCashiersList(users);
            
            // Ordenar por fecha (más reciente primero)
            setAllShifts(shifts.sort((a, b) => {
                const dateA = new Date(a.closedAt || a.openedAt || 0);
                const dateB = new Date(b.closedAt || b.openedAt || 0);
                return dateB - dateA;
            }));

        } catch (error) {
            console.error("Error cargando tesorería:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadInitialData(); }, [user?.companyId]);

    // Helper Nombre
    const resolveCashierName = (shiftUserId, shiftUserName) => {
        const matchedUser = cashiersList.find(u => u.uid === shiftUserId || u.email === shiftUserId);
        if (matchedUser) return matchedUser.name || matchedUser.email.split('@')[0];
        if (shiftUserName && shiftUserName !== 'Cajero') return shiftUserName;
        return "Cajero";
    };

    // 3. CERRAR CAJA (OPTIMISTIC UPDATE)
    const handleCloseShift = async (closingData) => {
        if (!shiftToClose) return;
        
        // Optimistic UI: Marcar como cerrada visualmente antes de recargar
        const closedShiftId = shiftToClose.id;
        
        try {
            const balance = await cashRepository.getShiftBalance(closedShiftId);
            const declaredAmount = parseFloat(closingData.declaredCash || 0);
            
            const stats = {
                ...closingData,
                declaredCash: declaredAmount, 
                expectedTotal: balance.totalCash, 
                expectedCash: balance.totalCash
            };
            
            await shiftRepository.closeShift(closedShiftId, declaredAmount, stats);
            
            // Éxito visual inmediato
            alert("✅ Turno cerrado correctamente.");
            setShiftToClose(null);
            
            // Recarga real
            loadInitialData(); 
        } catch (error) {
            alert("Error: " + error.message);
        }
    };

    if (loading) return (
        <div className="h-full flex items-center justify-center flex-col gap-4 text-sys-400">
            <RefreshCw className="animate-spin text-brand" size={48} />
            <p className="animate-pulse font-medium">Sincronizando Tesorería...</p>
        </div>
    );

    const activeShifts = allShifts.filter(s => s.status === 'OPEN');
    const closedShifts = allShifts.filter(s => s.status === 'CLOSED');

    const totalHistoryPages = Math.ceil(closedShifts.length / HISTORY_PAGE_SIZE);
    const paginatedHistory = closedShifts.slice(
        (historyPage - 1) * HISTORY_PAGE_SIZE,
        historyPage * HISTORY_PAGE_SIZE
    );

    return (
        <div className="space-y-6 pb-20 animate-in fade-in duration-500">
            
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                <div>
                    <h2 className="text-2xl font-black text-sys-900 flex items-center gap-2">
                        <Wallet className="text-brand" size={28} /> Tesorería & Control
                    </h2>
                    <p className="text-sys-500 text-sm mt-1">Supervisión en tiempo real de cajas y auditoría de cierres.</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-sys-200 bg-white p-1 rounded-t-xl w-fit shadow-sm">
                <button 
                    onClick={() => setActiveTab('active')}
                    className={cn("px-6 py-2 text-sm font-bold rounded-lg transition-all", 
                        activeTab === 'active' ? "bg-brand text-white shadow-md" : "text-sys-500 hover:bg-sys-50"
                    )}
                >
                    Cajas Activas ({activeShifts.length})
                </button>
                <button 
                    onClick={() => setActiveTab('history')}
                    className={cn("px-6 py-2 text-sm font-bold rounded-lg transition-all", 
                        activeTab === 'history' ? "bg-brand text-white shadow-md" : "text-sys-500 hover:bg-sys-50"
                    )}
                >
                    Historial de Cierres
                </button>
            </div>

            {/* VISTA 1: CAJAS ACTIVAS */}
            {activeTab === 'active' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in slide-in-from-bottom-4 duration-300">
                    {activeShifts.length === 0 ? (
                        <div className="col-span-full py-16 text-center text-sys-400 bg-white rounded-3xl border-2 border-dashed border-sys-200 flex flex-col items-center">
                            <div className="w-20 h-20 bg-sys-50 rounded-full flex items-center justify-center mb-4">
                                <Lock size={40} className="text-sys-300" />
                            </div>
                            <p className="font-bold text-lg text-sys-600">Todo cerrado por aquí</p>
                            <p className="text-sm">No hay cajas operando en este momento.</p>
                        </div>
                    ) : (
                        activeShifts.map(shift => (
                            <Card key={shift.id} className="relative overflow-hidden group border-0 shadow-lg hover:shadow-xl transition-all duration-300 bg-white">
                                <div className="absolute top-0 left-0 w-1.5 h-full bg-green-500"></div>
                                <div className="p-6">
                                    <div className="flex justify-between items-start mb-6">
                                        <div>
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span> Abierta
                                                </span>
                                                <span className="text-xs text-sys-400 font-mono">#{shift.id.slice(-4)}</span>
                                            </div>
                                            <h3 className="font-bold text-sys-900 text-xl flex items-center gap-2">
                                                <User size={20} className="text-sys-400" /> 
                                                {resolveCashierName(shift.userId, shift.userName)}
                                            </h3>
                                        </div>
                                        <div className="p-3 bg-green-50 text-green-600 rounded-2xl shadow-sm">
                                            <Unlock size={24} strokeWidth={2.5} />
                                        </div>
                                    </div>
                                    
                                    <div className="space-y-3 mb-8 bg-sys-50 p-4 rounded-xl border border-sys-100">
                                        <div className="flex justify-between text-sm items-center">
                                            <span className="text-sys-500 font-medium">Inicio de Turno</span>
                                            <span className="font-mono font-bold text-sys-700 bg-white px-2 py-0.5 rounded border border-sys-100">
                                                {new Date(shift.openedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-sm items-center">
                                            <span className="text-sys-500 font-medium">Fondo Inicial</span>
                                            <span className="font-mono font-bold text-sys-900">{formatCurrency(shift.initialAmount)}</span>
                                        </div>
                                    </div>

                                    <Button onClick={() => setShiftToClose(shift)} className="w-full bg-red-50 text-red-600 border border-red-100 hover:bg-red-600 hover:text-white hover:border-red-600 shadow-none font-bold py-3 rounded-xl transition-all">
                                        Forzar Cierre Z
                                    </Button>
                                </div>
                            </Card>
                        ))
                    )}
                </div>
            )}

            {/* VISTA 2: HISTORIAL */}
            {activeTab === 'history' && (
                <Card className="p-0 overflow-hidden animate-in slide-in-from-right-4 duration-300 flex flex-col min-h-[400px] shadow-lg border-0">
                    <div className="overflow-x-auto flex-1">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-sys-50 text-sys-500 text-xs uppercase font-bold tracking-wider border-b border-sys-200">
                                <tr>
                                    <th className="p-5 w-2/12">Fecha</th>
                                    <th className="p-5 w-2/12">Cajero</th>
                                    <th className="p-5 w-2/12 text-right">Sistema</th>
                                    <th className="p-5 w-2/12 text-right">Real</th>
                                    <th className="p-5 w-1/12 text-center">Desvío</th>
                                    <th className="p-5 w-1/12 text-center">Estado</th>
                                    <th className="p-5 w-1/12 text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-sys-100">
                                {paginatedHistory.length === 0 ? (
                                    <tr><td colSpan="7" className="p-16 text-center text-sys-400 font-medium bg-white">No hay historial disponible.</td></tr>
                                ) : (
                                    paginatedHistory.map(shift => {
                                        const { expected, declared, diff } = getShiftValues(shift);
                                        const isPerfect = Math.abs(diff) < 50; 

                                        return (
                                            <tr key={shift.id} className="hover:bg-sys-50 transition-colors group bg-white">
                                                <td className="p-5">
                                                    <div className="font-bold text-sys-800">{new Date(shift.closedAt).toLocaleDateString()}</div>
                                                    <div className="text-[10px] text-sys-400 font-mono font-medium">{new Date(shift.closedAt).toLocaleTimeString()}</div>
                                                </td>
                                                <td className="p-5">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-brand/5 text-brand flex items-center justify-center text-xs font-black border border-brand/10">
                                                            {(resolveCashierName(shift.userId, shift.userName) || 'U').charAt(0).toUpperCase()}
                                                        </div>
                                                        <span className="text-sys-700 font-bold text-sm">{resolveCashierName(shift.userId, shift.userName)}</span>
                                                    </div>
                                                </td>
                                                <td className="p-5 text-right font-mono font-medium text-sys-500">{formatCurrency(expected)}</td>
                                                <td className="p-5 text-right font-mono font-bold text-sys-900 bg-sys-50/30">{formatCurrency(declared)}</td>
                                                <td className="p-5 text-center">
                                                    <span className={cn("px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide border", 
                                                        isPerfect ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"
                                                    )}>
                                                        {isPerfect ? 'OK' : `${diff > 0 ? '+' : ''}${formatCurrency(diff)}`}
                                                    </span>
                                                </td>
                                                <td className="p-5 text-center">
                                                    <span className={cn("px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide border", 
                                                        shift.audited ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-orange-50 text-orange-700 border-orange-200"
                                                    )}>
                                                        {shift.audited ? 'FINAL' : 'PENDIENTE'}
                                                    </span>
                                                </td>
                                                <td className="p-5 text-right">
                                                    <button onClick={() => setSelectedShiftForAudit(shift)} className="p-2.5 hover:bg-white hover:shadow-md rounded-xl text-sys-400 hover:text-brand transition-all border border-transparent hover:border-sys-200" title="Ver Detalle">
                                                        <Eye size={20} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                    
                    {totalHistoryPages > 1 && (
                        <div className="p-4 border-t border-sys-100 bg-sys-50/50 flex justify-between items-center px-6">
                            <span className="text-xs text-sys-500 font-medium">
                                Mostrando página <b>{historyPage}</b> de <b>{totalHistoryPages}</b>
                            </span>
                            <div className="flex gap-2">
                                <Button variant="ghost" size="sm" disabled={historyPage === 1} onClick={() => setHistoryPage(p => Math.max(1, p - 1))} className="text-sys-500 hover:text-sys-900"><ChevronLeft size={16}/> Anterior</Button>
                                <Button variant="ghost" size="sm" disabled={historyPage === totalHistoryPages} onClick={() => setHistoryPage(p => Math.min(totalHistoryPages, p + 1))} className="text-sys-500 hover:text-sys-900">Siguiente <ChevronRight size={16}/></Button>
                            </div>
                        </div>
                    )}
                </Card>
            )}

            {/* Modales */}
            <AuditDetailModal shift={selectedShiftForAudit} onClose={() => setSelectedShiftForAudit(null)} />
            
            {shiftToClose && (
                <CashClosingModalWrapper 
                    isOpen={true}
                    shift={shiftToClose}
                    onClose={() => setShiftToClose(null)}
                    onConfirm={handleCloseShift}
                />
            )}
        </div>
    );
};

// Wrapper auxiliar
const CashClosingModalWrapper = ({ isOpen, shift, onClose, onConfirm }) => {
    const [totals, setTotals] = useState(null);
    
    useEffect(() => {
        let mounted = true;
        cashRepository.getShiftBalance(shift.id).then(bal => {
            if(mounted) setTotals({ totalCash: bal.totalCash, totalDigital: bal.totalDigital });
        });
        return () => { mounted = false; };
    }, [shift]);

    if (!totals) return null;
    return <CashClosingModal isOpen={isOpen} onClose={onClose} systemTotals={totals} onConfirm={onConfirm} />;
};