import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    Wallet, TrendingUp, TrendingDown, Clock, Lock, Unlock, 
    FileText, AlertTriangle, CheckCircle, Search, Eye, 
    ArrowRight, ShieldCheck, User, Calendar, MinusCircle, PlusCircle,
    DollarSign, RefreshCw, ChevronLeft, ChevronRight 
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

    // Helper para no ignorar el 0 como falso
    const isValid = (val) => val !== undefined && val !== null;

    // 1. Buscamos el "Teórico/Esperado" (System Amount)
    let expected = 0;
    
    // Prioridad 1: Cálculo al vuelo (si el modal lo pasó)
    if (calculatedDetails && isValid(calculatedDetails.totalCash)) {
        expected = Number(calculatedDetails.totalCash);
    } 
    // Prioridad 2: Datos guardados en Firebase (Nuevos)
    else if (isValid(shift.systemAmount)) {
        expected = Number(shift.systemAmount);
    }
    // Prioridad 3: Datos dentro de stats
    else if (isValid(shift.stats?.expectedTotal)) {
        expected = Number(shift.stats.expectedTotal);
    }
    else if (isValid(shift.stats?.expectedCash)) {
        expected = Number(shift.stats.expectedCash);
    }
    // Prioridad 4: Datos antiguos (Legacy) - Solo si no hay nada mejor
    else if (isValid(shift.expectedCash)) {
        expected = Number(shift.expectedCash);
    }

    // 2. Buscamos el "Real/Declarado" (Final Amount)
    let declared = 0;
    
    // Prioridad 1: Campo nuevo (finalAmount)
    if (isValid(shift.finalAmount)) {
        declared = Number(shift.finalAmount);
    }
    // Prioridad 2: Dentro de stats
    else if (isValid(shift.stats?.declaredCash)) {
        declared = Number(shift.stats.declaredCash);
    }
    // Prioridad 3: Campo antiguo (finalCash) - CUIDADO: Este suele venir en 0 incorrectamente
    // Solo lo usamos si finalAmount NO existe (es undefined)
    else if (isValid(shift.finalCash)) {
        declared = Number(shift.finalCash);
    }

    // 3. Inicial
    const initial = Number(shift.initialAmount) || 0;

    // 4. Diferencia
    const diff = declared - expected;

    return { expected, declared, diff, initial };
};

// Función de ayuda para la visualización de movimientos
const getMovementProps = (mov) => {
    if (!mov) return { sign: '', color: '', typeLabel: '', methodTag: '' };

    const isIncome = mov.type === 'SALE' || mov.type === 'DEPOSIT';
    const isCash = mov.method === 'cash' || mov.type === 'WITHDRAWAL'; 

    let sign = isIncome ? '+' : '-';
    let color = isIncome ? 'text-green-600' : 'text-red-600';
    let typeLabel = mov.type === 'SALE' ? 'VENTA' : mov.type === 'DEPOSIT' ? 'FONDO IN' : 'RETIRO/GTO';
    
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
                 <Card className="p-8 text-center"><RefreshCw size={24} className="animate-spin text-brand" /></Card>
            </div>
        );
    }
    
    const safeDetails = details || { totalCash: 0, movements: [], totalDigital: 0 };
    const allMovements = Array.isArray(safeDetails.movements) ? safeDetails.movements : [];

    // 🔥 USAMOS EL HELPER UNIFICADO PARA VALORES
    // Pasamos 'safeDetails' para que, si el turno está abierto o no tiene stats guardados, 
    // use el cálculo en tiempo real como 'expected'.
    const { expected, declared, diff, initial } = getShiftValues(shift, safeDetails);
    
    // Lógica de "Perfecto" con tolerancia de $50
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
                    <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-500"><div className="text-xl">×</div></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="grid grid-cols-4 gap-4">
                        <div className="p-4 bg-sys-50 rounded-xl border border-sys-200 text-center">
                            <p className="text-xs uppercase font-bold text-sys-500 mb-1">Sistema (Esperado)</p>
                            <p className="text-xl font-bold text-sys-800">{formatCurrency(expected)}</p>
                            <p className="text-xs text-sys-400 mt-1">Fondo: {formatCurrency(initial)}</p>
                        </div>
                        <div className="p-4 bg-sys-50 rounded-xl border border-sys-200 text-center">
                            <p className="text-xs uppercase font-bold text-sys-500 mb-1">Cajero (Declarado)</p>
                            <p className="text-xl font-bold text-sys-900">{formatCurrency(declared)}</p>
                            <p className="text-xs text-sys-400 mt-1">Digital: {formatCurrency(safeDetails.totalDigital)}</p>
                        </div>
                        <div className={cn("p-4 rounded-xl border text-center flex flex-col justify-center", 
                            isPerfect ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
                        )}>
                            <p className={cn("text-xs uppercase font-bold mb-1", isPerfect ? "text-green-600" : "text-red-600")}>
                                {isPerfect ? 'Perfecto' : diff >= 0 ? 'Sobrante' : 'Faltante'}
                            </p>
                            <p className={cn("text-xl font-black", isPerfect ? "text-green-700" : "text-red-700")}>
                                {diff > 0 ? '+' : ''} {formatCurrency(diff)}
                            </p>
                        </div>
                        <div className={cn("p-4 rounded-xl border text-center flex flex-col justify-center", 
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
                            {totalPages > 1 && <span className="text-xs text-sys-500">Pág {currentPage} de {totalPages}</span>}
                        </div>
                        <div className="border border-sys-200 rounded-xl overflow-hidden min-h-[300px] flex flex-col">
                            <table className="w-full text-sm text-left flex-1">
                                <thead className="bg-sys-50 text-xs uppercase font-semibold text-sys-500">
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
                                            <tr key={m.id || Math.random()} className="hover:bg-sys-50">
                                                <td className="p-3 text-center"><span className={cn("text-[10px] font-bold uppercase", color)}>{typeLabel}</span></td>
                                                <td className="p-3 font-mono text-sys-500">{m.date ? new Date(m.date).toLocaleTimeString() : '-'}</td>
                                                <td className="p-3">{m.description || 'Sin descripción'}</td>
                                                <td className="p-3 text-sys-500">{methodTag}</td>
                                                <td className={cn("p-3 text-right font-black", color)}>{sign} {formatCurrency(m.amount)}</td>
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

    // 1. CARGAR LISTA DE USUARIOS
    useEffect(() => {
        if (user?.companyId) {
            const fetchCashiers = async () => {
                try {
                    const q = query(
                        collection(firestoreDB, 'users'), 
                        where('companyId', '==', user.companyId)
                    );
                    const snapshot = await getDocs(q);
                    const users = snapshot.docs.map(doc => ({
                        uid: doc.id, 
                        ...doc.data()
                    }));
                    setCashiersList(users);
                } catch (error) { console.error("Error cargando usuarios:", error); }
            };
            fetchCashiers();
        }
    }, [user?.companyId]);

    // 🔥 HELPER: Resolver Nombre
    const resolveCashierName = (shiftUserId, shiftUserName) => {
        const matchedUser = cashiersList.find(u => u.uid === shiftUserId || u.email === shiftUserId);
        if (matchedUser) return matchedUser.name || matchedUser.email.split('@')[0];
        if (shiftUserName && shiftUserName !== 'Cajero') return shiftUserName;
        if (typeof shiftUserId === 'string' && shiftUserId.includes('@')) return shiftUserId.split('@')[0];
        return "Cajero";
    };

    // 2. CARGAR TURNOS
    const loadData = async () => {
        setLoading(true);
        try {
            const shifts = await shiftRepository.getAllShifts(); 
            // Ordenar B - A (Más reciente primero)
            setAllShifts(shifts.sort((a, b) => {
                const dateA = a.closedAt ? new Date(a.closedAt) : (a.openedAt ? new Date(a.openedAt) : new Date(0));
                const dateB = b.closedAt ? new Date(b.closedAt) : (b.openedAt ? new Date(b.openedAt) : new Date(0));
                return dateB - dateA;
            }));
        } catch (error) {
            console.error("Error cargando historial:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadData(); }, []);

    // 3. CERRAR CAJA
    const handleCloseShift = async (closingData) => {
        if (!shiftToClose) return;
        try {
            const balance = await cashRepository.getShiftBalance(shiftToClose.id);
            const declaredAmount = parseFloat(closingData.declaredCash || 0);
            
            const stats = {
                ...closingData,
                declaredCash: declaredAmount, 
                expectedTotal: balance.totalCash, 
                expectedCash: balance.totalCash
            };
            
            await shiftRepository.closeShift(shiftToClose.id, declaredAmount, stats);
            alert("✅ Turno cerrado correctamente.");
            setShiftToClose(null);
            loadData(); 
        } catch (error) {
            alert("Error: " + error.message);
        }
    };

    if (loading) return <div className="p-10 text-center text-sys-500 animate-pulse">Cargando tesorería...</div>;

    const activeShifts = allShifts.filter(s => s.status === 'OPEN');
    const closedShifts = allShifts.filter(s => s.status === 'CLOSED');

    // Paginación Historial
    const totalHistoryPages = Math.ceil(closedShifts.length / HISTORY_PAGE_SIZE);
    const paginatedHistory = closedShifts.slice(
        (historyPage - 1) * HISTORY_PAGE_SIZE,
        historyPage * HISTORY_PAGE_SIZE
    );

    return (
        <div className="space-y-6 pb-20 animate-in fade-in">
            
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-sys-900 flex items-center gap-2">
                        <Wallet className="text-brand" /> Tesorería & Control
                    </h2>
                    <p className="text-sys-500 text-sm">Supervisión de cajas activas y auditoría de cierres.</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b border-sys-200">
                <button 
                    onClick={() => setActiveTab('active')}
                    className={cn("px-4 py-2 text-sm font-medium border-b-2 transition-colors", 
                        activeTab === 'active' ? "border-brand text-brand" : "border-transparent text-sys-500 hover:text-sys-800"
                    )}
                >
                    Cajas Activas ({activeShifts.length})
                </button>
                <button 
                    onClick={() => setActiveTab('history')}
                    className={cn("px-4 py-2 text-sm font-medium border-b-2 transition-colors", 
                        activeTab === 'history' ? "border-brand text-brand" : "border-transparent text-sys-500 hover:text-sys-800"
                    )}
                >
                    Historial de Cierres
                </button>
            </div>

            {/* VISTA 1: CAJAS ACTIVAS */}
            {activeTab === 'active' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in slide-in-from-left-4 duration-300">
                    {activeShifts.length === 0 ? (
                        <div className="col-span-full py-12 text-center text-sys-400 bg-sys-50 rounded-2xl border border-dashed border-sys-200">
                            <Lock size={48} className="mx-auto mb-3 opacity-20" />
                            <p>No hay cajas abiertas en este momento.</p>
                        </div>
                    ) : (
                        activeShifts.map(shift => (
                            <Card key={shift.id} className="relative overflow-hidden group border-l-4 border-l-green-500">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">Abierta</span>
                                            <span className="text-xs text-sys-400 font-mono">#{shift.id.slice(-4)}</span>
                                        </div>
                                        <h3 className="font-bold text-sys-900 text-lg flex items-center gap-2">
                                            <User size={18} className="text-sys-400" /> 
                                            {resolveCashierName(shift.userId, shift.userName)}
                                        </h3>
                                    </div>
                                    <div className="p-2 bg-green-50 text-green-600 rounded-lg"><Unlock size={24} /></div>
                                </div>
                                <div className="space-y-2 mb-6">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-sys-500">Apertura</span>
                                        <span className="font-mono text-sys-700">{new Date(shift.openedAt).toLocaleTimeString()}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-sys-500">Fondo Inicial</span>
                                        <span className="font-mono font-bold text-sys-900">{formatCurrency(shift.initialAmount)}</span>
                                    </div>
                                </div>
                                <Button onClick={() => setShiftToClose(shift)} variant="secondary" className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300">
                                    Forzar Cierre Z
                                </Button>
                            </Card>
                        ))
                    )}
                </div>
            )}

            {/* VISTA 2: HISTORIAL Y AUDITORÍA */}
            {activeTab === 'history' && (
                <Card className="p-0 overflow-hidden animate-in slide-in-from-right-4 duration-300 flex flex-col min-h-[400px]">
                    <div className="overflow-x-auto flex-1">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-sys-50 text-sys-500 text-xs uppercase font-semibold border-b border-sys-100">
                                <tr>
                                    <th className="p-4">Fecha/Hora</th>
                                    <th className="p-4">Cajero</th>
                                    <th className="p-4 text-right">Teórico</th>
                                    <th className="p-4 text-right">Real</th>
                                    <th className="p-4 text-center">Desvío</th>
                                    <th className="p-4 text-center">Estado</th>
                                    <th className="p-4 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-sys-100">
                                {paginatedHistory.length === 0 ? (
                                    <tr><td colSpan="7" className="p-8 text-center text-sys-400">No hay historial de cierres disponible.</td></tr>
                                ) : (
                                    paginatedHistory.map(shift => {
                                        // 🔥 USAMOS EL HELPER UNIFICADO TAMBIÉN AQUÍ PARA LA TABLA
                                        const { expected, declared, diff } = getShiftValues(shift);
                                        const isPerfect = Math.abs(diff) < 50; 

                                        return (
                                            <tr key={shift.id} className="hover:bg-sys-50 transition-colors group">
                                                <td className="p-4">
                                                    <div className="font-bold text-sys-800">{new Date(shift.closedAt).toLocaleDateString()}</div>
                                                    <div className="text-xs text-sys-400 font-mono">{new Date(shift.closedAt).toLocaleTimeString()}</div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-6 h-6 rounded-full bg-brand/10 text-brand flex items-center justify-center text-xs font-bold">
                                                            {(resolveCashierName(shift.userId, shift.userName) || 'U').charAt(0).toUpperCase()}
                                                        </div>
                                                        <span className="text-sys-700 font-medium">{resolveCashierName(shift.userId, shift.userName)}</span>
                                                    </div>
                                                </td>
                                                <td className="p-4 text-right font-mono text-sys-600">{formatCurrency(expected)}</td>
                                                <td className="p-4 text-right font-mono font-bold text-sys-900">{formatCurrency(declared)}</td>
                                                <td className="p-4 text-center">
                                                    <span className={cn("px-2 py-1 rounded text-xs font-bold border", isPerfect ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200")}>
                                                        {isPerfect ? 'OK' : `${diff > 0 ? '+' : ''}${formatCurrency(diff)}`}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-center">
                                                    <span className={cn("px-2 py-1 rounded text-xs font-bold border", shift.audited ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-orange-50 text-orange-700 border-orange-200")}>
                                                        {shift.audited ? 'FINAL' : 'PENDIENTE'}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-right">
                                                    <button onClick={() => setSelectedShiftForAudit(shift)} className="p-2 hover:bg-sys-200 rounded-lg text-sys-400 hover:text-brand transition-colors" title="Ver Detalle">
                                                        <Eye size={18} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                    
                    {/* PAGINADOR HISTORIAL */}
                    {totalHistoryPages > 1 && (
                        <div className="p-3 border-t border-sys-100 bg-sys-50/50 flex justify-between items-center px-6">
                            <span className="text-xs text-sys-500">
                                Mostrando página <b>{historyPage}</b> de <b>{totalHistoryPages}</b>
                            </span>
                            <div className="flex gap-2">
                                <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    disabled={historyPage === 1} 
                                    onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                                >
                                    <ChevronLeft size={16}/> Anterior
                                </Button>
                                <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    disabled={historyPage === totalHistoryPages} 
                                    onClick={() => setHistoryPage(p => Math.min(totalHistoryPages, p + 1))}
                                >
                                    Siguiente <ChevronRight size={16}/>
                                </Button>
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
        cashRepository.getShiftBalance(shift.id).then(bal => {
            setTotals({ totalCash: bal.totalCash, totalDigital: bal.totalDigital });
        });
    }, [shift]);
    if (!totals) return null;
    return <CashClosingModal isOpen={isOpen} onClose={onClose} systemTotals={totals} onConfirm={onConfirm} />;
};