import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    Wallet, Lock, Unlock, FileText, AlertTriangle, Search, Eye, 
    ArrowRight, ShieldCheck, User, RefreshCw, ChevronLeft, ChevronRight,
    Printer, CheckCircle, Filter, Hash, TrendingUp,
    History as HistoryIcon, Banknote, CreditCard, Building2, PieChart, CloudDownload
} from 'lucide-react';

// 🔥 REPOSITORIO ÚNICO DE VERDAD (Ahora hace toda la matemática)
import { cashRepository } from '../../cash/repositories/cashRepository'; 
import { getDB } from '../../../database/db';

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
import toast from 'react-hot-toast';

const formatCurrency = (amount) => `$ ${Number(amount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ============================================================================
// 🧠 HELPERS DE VISUALIZACIÓN
// ============================================================================

const getShiftValues = (shift, calculatedDetails = null) => {
    if (!shift) return { expected: 0, declared: 0, diff: 0, initial: 0, left: 0, out: 0 };
    
    const snap = shift.auditSnapshot || {};
    const isValid = (val) => val !== undefined && val !== null && !isNaN(val);
    
    let expected = 0;
    let out = 0; 
    let left = 0;

    // 🔥 SI ESTÁ CERRADO: La verdad absoluta es el snapshot inmutable del cierre.
    // Solo recalculamos "en vivo" si el turno está abierto o no tiene snapshot.
    if (shift.status === 'CLOSED' && isValid(snap.expectedCash)) {
        expected = Number(snap.expectedCash);
        out = Number(snap.manualOut || snap.cashOut || 0);
    } else if (calculatedDetails && isValid(calculatedDetails.totalCash)) {
        // Recálculo en vivo para turnos abiertos
        expected = Number(calculatedDetails.totalCash);
        out = Number(calculatedDetails.manualOutCash || 0);
    } else {
        expected = Number(shift.expectedCash || 0);
    }
    
    const declared = Number(shift.finalCash ?? snap.declaredCash ?? 0);
    const initial = Number(snap.initialAmount ?? shift.initialAmount ?? 0);
    left = Number(shift.leftInCash ?? snap.leftInCash ?? 0); 
    const diff = declared - expected;
    
    return { expected, declared, diff, initial, left, out };
};

const getMovementProps = (mov) => {
    if (!mov) return { sign: '', color: '', typeLabel: '', methodTag: '' };
    
    if (mov.isVirtual) {
        return {
            sign: '+',
            color: mov.method === 'cash' ? 'text-green-600' : 'text-blue-600',
            typeLabel: 'RESUMEN',
            methodTag: mov.method === 'cash' ? 'EFECTIVO' : 'DIGITAL'
        };
    }

    const isIncome = mov.type === 'SALE' || mov.type === 'DEPOSIT' || mov.type === 'IN' || mov.type === 'RECEIPT';
    const isCash = mov.method === 'cash' || mov.type === 'WITHDRAWAL'; 
    let sign = isIncome ? '+' : '-';
    let color = isIncome ? 'text-green-600' : 'text-red-600';
    // 🔥 Etiquetas claras por tipo de movimiento
    let typeLabel = 
        mov.type === 'SALE' ? 'VENTA' : 
        mov.type === 'DEPOSIT' || mov.type === 'IN' ? 'INGRESO' : 
        mov.type === 'RECEIPT' ? 'COBRO' : 
        mov.type === 'EXPENSE' ? 'GASTO' :       // ← antes decía RETIRO
        mov.type === 'PURCHASE' ? 'COMPRA' :     // ← pago a proveedor
        mov.type === 'REFUND' ? 'DEVOLUC.' :
        mov.type === 'TREASURY' ? 'CIERRE' :     // ← rendición de cierre
        'RETIRO';  // WITHDRAWAL
    let methodTag = (mov.method || 'desconocido').toLowerCase(); 
    
    if (['cash', 'efectivo'].includes(methodTag)) methodTag = 'Efectivo';
    else if (['transfer', 'transferencia'].includes(methodTag)) methodTag = 'Transferencia';
    else if (['mercadopago', 'mp', 'qr'].includes(methodTag)) methodTag = 'MercadoPago QR';
    else if (['point'].includes(methodTag)) methodTag = 'Terminal Point';
    else if (['card', 'tarjeta', 'debit', 'credit', 'manual_card'].includes(methodTag)) methodTag = 'Tarjeta';
    else if (['account', 'current_account'].includes(methodTag)) methodTag = 'Cta. Corriente';
    else if (['employee_account'].includes(methodTag)) methodTag = 'Cta. Empleado';
    else if (['budget'].includes(methodTag)) methodTag = 'Presupuesto';
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
    return { sign, color, typeLabel, methodTag };
};

// ============================================================================
// MODAL: AUDITORÍA DETALLADA (BLINDADO)
// ============================================================================
const AuditDetailModal = ({ shift, onClose, resolveName, resolveBranchName }) => {
    const { user } = useAuthStore();
    const isAdminAudit = user?.role === 'ADMIN' || user?.role === 'OWNER';
    const [details, setDetails] = useState(null);
    const [loadingDetails, setLoadingDetails] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 20;

    useEffect(() => {
        if (shift) {
            setLoadingDetails(true);
            setCurrentPage(1); 
            // 🔥 LEEMOS DIRECTAMENTE DEL REPOSITORIO
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

    const processedMovements = useMemo(() => {
        if (!shift || !details) return [];
        let list = [...(details.movements || [])];
        
        if (shift.auditSnapshot) {
            const snap = shift.auditSnapshot;
            const hasDetails = list.some(m => ['SALE', 'RECEIPT'].includes(m.type) || ['SALE'].includes(m.subtype));

            if (!hasDetails) {
                const methods = snap.salesByMethod || {};
                if (methods.cash > 0) {
                    list.push({ id: 'v-cash', isVirtual: true, type: 'SALE', method: 'cash', amount: methods.cash, description: 'Ventas Resumidas en Efectivo', date: shift.closedAt || shift.openedAt });
                }
                const digitalTotal = (methods.mercadopago || 0) + (methods.clover || 0) + (methods.point || 0) + (methods.manual_card || 0) + (methods.card || 0) + (methods.transfer || 0) + (methods.digitalOther || 0);
                if (digitalTotal > 0) {
                    list.push({ id: 'v-digital', isVirtual: true, type: 'SALE', method: 'digital', amount: digitalTotal, description: 'Ventas Digitales Resumidas', date: shift.closedAt || shift.openedAt });
                }
            }
        }
        return list.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
    }, [details, shift]);

    if (!shift) return null;

    if (loadingDetails) {
        return (
             <div className="fixed inset-0 z-[80] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in">
                 <Card className="p-8 text-center flex flex-col items-center gap-2">
                     <RefreshCw size={32} className="animate-spin text-brand" />
                     <p className="text-sm font-black text-sys-600 uppercase tracking-widest">Sincronizando auditoría remota...</p>
                 </Card>
            </div>
        );
    }
    
    const safeDetails = details || { totalCash: 0, movements: [], totalDigital: 0 };
    const { expected, declared, diff, initial, left, out } = getShiftValues(shift, safeDetails);
    const isPerfect = Math.abs(diff) < 50; 
    
    // 🔥 SI NO TENEMOS VENTAS EN MEMORIA (salesCount === 0), fallamos al Snapshot del cierre
    const paymentMethods = (safeDetails.salesCount > 0)
        ? safeDetails.salesByMethod 
        : (shift.auditSnapshot?.salesByMethod || {});

    const totalTarjetas = (paymentMethods.clover || 0) + (paymentMethods.point || 0) + (paymentMethods.manual_card || 0) + (paymentMethods.card || 0);

    const totalPages = Math.ceil(processedMovements.length / itemsPerPage);
    const paginatedMovements = processedMovements.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-5 border-b border-sys-100 bg-sys-50 flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-xl text-sys-900 flex items-center gap-2">
                            <ShieldCheck size={24} className="text-brand" /> Auditoría Detallada
                        </h3>
                        <p className="text-xs text-sys-500 font-mono uppercase tracking-tighter">
                            Sucursal: {resolveBranchName(shift.branchId)} | ID: {shift.id.slice(-6)}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-500 font-bold text-xl leading-none">&times;</button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-sys-50/30 custom-scrollbar">
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-4 bg-white rounded-xl border border-sys-200 text-center shadow-sm relative">
                            <p className="text-[10px] uppercase font-bold text-sys-400 mb-1">Sistema (Esperado)</p>
                            <p className="text-xl font-black text-sys-800">{formatCurrency(expected)}</p>
                            <p className="text-[10px] text-sys-400 mt-1">Fondo: {formatCurrency(initial)}</p>
                            {/* 🔥 MOSTRAR GASTOS PARA QUE LA MATEMÁTICA SEA TRANSPARENTE EN LA UI */}
                            {out > 0 && (
                                <div className="absolute top-2 right-2 flex items-center justify-center w-5 h-5 bg-red-100 rounded-full" title={`Se descontaron ${formatCurrency(out)} en Gastos/Retiros`}>
                                    <AlertTriangle size={10} className="text-red-600" />
                                </div>
                            )}
                            {/* 🔥 AVISO DE DRIFT — solo ADMIN/OWNER, solo si el contador remoto y la
                                suma local del turno no coinciden (posible sync sin terminar). El
                                cajero nunca ve esto — el número de "Esperado" ya es siempre el local. */}
                            {isAdminAudit && shift.auditSnapshot?.hasDriftWarning && (
                                <div
                                    className="absolute top-2 left-2 flex items-center justify-center w-5 h-5 bg-amber-100 rounded-full"
                                    title={`Contador remoto y local no coinciden por ${formatCurrency(shift.auditSnapshot.totalCashDrift)} — puede haber datos de este turno sin sincronizar todavía.`}
                                >
                                    <AlertTriangle size={10} className="text-amber-600" />
                                </div>
                            )}
                        </div>
                        <div className="p-4 bg-white rounded-xl border border-sys-200 text-center shadow-sm">
                            <p className="text-[10px] uppercase font-bold text-sys-400 mb-1">Cajero (Declarado)</p>
                            <p className="text-xl font-black text-sys-900">{formatCurrency(declared)}</p>
                            <p className="text-[10px] text-sys-400 mt-1">Digital: {formatCurrency(shift.auditSnapshot?.totalDigital || safeDetails.totalDigital)}</p>
                        </div>
                        <div className={cn("p-4 rounded-xl border text-center flex flex-col justify-center shadow-sm", isPerfect ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200")}>
                            <p className={cn("text-[10px] uppercase font-bold mb-1", isPerfect ? "text-green-600" : "text-red-600")}>
                                {isPerfect ? 'Perfecto' : diff >= 0 ? 'Sobrante' : 'Faltante'}
                            </p>
                            <p className={cn("text-xl font-black", isPerfect ? "text-emerald-700" : "text-rose-700")}>
                                {diff > 0 ? '+' : ''} {formatCurrency(diff)}
                            </p>
                        </div>
                        <div className="p-4 bg-brand/5 rounded-xl border border-brand/20 text-center shadow-sm flex flex-col justify-center">
                            <p className="text-[10px] uppercase font-bold text-brand mb-1">Dejado en Caja</p>
                            <p className="text-xl font-black text-sys-900">{formatCurrency(left)}</p>
                        </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-sys-200 shadow-sm">
                        <h4 className="text-[10px] font-black text-sys-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                            <PieChart size={14} /> Desglose de Operaciones (Según Sistema)
                        </h4>
                        <div className="flex flex-wrap gap-3">
                            <div className="bg-green-50 border border-green-200 px-4 py-2 rounded-lg flex-1 min-w-[120px]">
                                <p className="text-[9px] text-green-600 font-bold uppercase">Ventas Efectivo</p>
                                <p className="text-sm font-black text-green-700">{formatCurrency(paymentMethods.cash || 0)}</p>
                            </div>
                            
                            {(paymentMethods.cash_from_account > 0) && (
                                <div className="bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-lg flex-1 min-w-[120px]">
                                    <p className="text-[9px] text-emerald-600 font-bold uppercase" title="Efectivo que entró por pagos de cuentas corrientes">Cobro Deudas (CASH)</p>
                                    <p className="text-sm font-black text-emerald-700">{formatCurrency(paymentMethods.cash_from_account)}</p>
                                </div>
                            )}

                            {/* 🔥 LEEMOS EL GASTO REAL DEL SNAPSHOT O DEL DETALLE EN VIVO */}
                            {(out > 0) && (
                                <div className="bg-red-50 border border-red-200 px-4 py-2 rounded-lg flex-1 min-w-[120px] opacity-90">
                                    <p className="text-[9px] text-red-600 font-bold uppercase">Pagos Prov. / Retiros (CASH)</p>
                                    <p className="text-sm font-black text-red-700">- {formatCurrency(out)}</p>
                                </div>
                            )}

                            {(paymentMethods.transfer > 0) && (
                                <div className="bg-blue-50 border border-blue-200 px-4 py-2 rounded-lg flex-1 min-w-[120px]">
                                    <p className="text-[9px] text-blue-600 font-bold uppercase">Transferencia</p>
                                    <p className="text-sm font-black text-blue-700">{formatCurrency(paymentMethods.transfer)}</p>
                                </div>
                            )}

                            {(paymentMethods.transfer_from_account > 0) && (
                                <div className="bg-cyan-50 border border-cyan-200 px-4 py-2 rounded-lg flex-1 min-w-[120px]">
                                    <p className="text-[9px] text-cyan-600 font-bold uppercase">Cobro Deudas (TRANSF)</p>
                                    <p className="text-sm font-black text-cyan-700">{formatCurrency(paymentMethods.transfer_from_account)}</p>
                                </div>
                            )}
                            
                            {(paymentMethods.mercadopago > 0) && (
                                <div className="bg-blue-50 border border-blue-200 px-4 py-2 rounded-lg flex-1 min-w-[120px]">
                                    <p className="text-[9px] text-blue-600 font-bold uppercase">MercadoPago QR</p>
                                    <p className="text-sm font-black text-blue-700">{formatCurrency(paymentMethods.mercadopago)}</p>
                                </div>
                            )}

                            {totalTarjetas > 0 && (
                                <div className="bg-purple-50 border border-purple-200 px-4 py-2 rounded-lg flex-1 min-w-[120px]">
                                    <p className="text-[9px] text-purple-600 font-bold uppercase">Tarjetas</p>
                                    <p className="text-sm font-black text-purple-700">{formatCurrency(totalTarjetas)}</p>
                                </div>
                            )}

                            {(paymentMethods.account > 0) && (
                                <div className="bg-red-50 border border-red-200 px-4 py-2 rounded-lg flex-1 min-w-[120px] opacity-80">
                                    <p className="text-[9px] text-red-600 font-bold uppercase">Fiado (Cta. Cte.)</p>
                                    <p className="text-sm font-black text-red-700">{formatCurrency(paymentMethods.account)}</p>
                                </div>
                            )}
                            
                            {(paymentMethods.employee_account > 0) && (
                                <div className="bg-orange-50 border border-orange-200 px-4 py-2 rounded-lg flex-1 min-w-[120px] opacity-80">
                                    <p className="text-[9px] text-orange-600 font-bold uppercase">Fiado (Empleado)</p>
                                    <p className="text-sm font-black text-orange-700">{formatCurrency(paymentMethods.employee_account)}</p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between items-center mb-3">
                            <h4 className="font-bold text-sys-800 flex items-center gap-2"><FileText size={16} /> Detalle de Movimientos ({processedMovements.length})</h4>
                            {(shift.auditSnapshot && details?.movements?.length === 0) && (
                                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-100 flex items-center gap-1.5">
                                    <ShieldCheck size={12}/> Auditoría Resumida (Snapshot Remoto)
                                </span>
                            )}
                        </div>
                        <div className="border border-sys-200 rounded-xl overflow-hidden bg-white shadow-sm flex flex-col min-h-[250px]">
                            <table className="w-full text-sm text-left flex-1">
                                <thead className="bg-sys-50 text-[10px] uppercase font-black text-sys-400 border-b border-sys-100">
                                    <tr>
                                        <th className="p-3 w-1/12 text-center">Tipo</th>
                                        <th className="p-3 w-2/12">Hora</th>
                                        <th className="p-3 w-4/12">Concepto</th>
                                        <th className="p-3 w-2/12 text-center">Método</th>
                                        <th className="p-3 w-3/12 text-right">Monto</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-sys-100">
                                    {paginatedMovements.length === 0 ? (
                                        <tr>
                                            <td colSpan="5" className="p-10 text-center text-sys-400 uppercase font-bold text-xs italic">
                                                Sin movimientos registrados
                                            </td>
                                        </tr>
                                    ) : (
                                        paginatedMovements.map(m => {
                                            const { sign, color, typeLabel, methodTag } = getMovementProps(m);
                                            return (
                                                <tr key={m.id} className={cn("hover:bg-sys-50 transition-colors", m.isVirtual && "bg-blue-50/20")}>
                                                    <td className="p-3 text-center">
                                                        <span className={cn("text-[9px] font-black uppercase px-2 py-0.5 rounded", m.isVirtual ? "bg-blue-100 text-blue-700" : "bg-sys-100", color)}>
                                                            {typeLabel}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 font-mono text-sys-400 text-[10px]">{m.date || m.createdAt ? new Date(m.date || m.createdAt).toLocaleTimeString() : '-'}</td>
                                                    <td className="p-3">
                                                        <p className="text-sys-800 font-bold text-xs uppercase">{m.description}</p>
                                                        {m.isVirtual && <p className="text-[9px] text-blue-500 font-medium italic leading-none mt-0.5">Información recuperada del cierre</p>}
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <span className="text-sys-500 text-[9px] uppercase font-black bg-sys-100 px-2 py-1 rounded border border-sys-200">{methodTag}</span>
                                                    </td>
                                                    <td className={cn("p-3 text-right font-black font-mono", color)}>{sign} {formatCurrency(m.amount)}</td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                            {totalPages > 1 && (
                                <div className="p-3 border-t border-sys-100 bg-sys-50/50 flex justify-center gap-2">
                                    <Button variant="ghost" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}><ChevronLeft size={16}/></Button>
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
// PÁGINA PRINCIPAL
// ============================================================================
export const CashPage = () => {
    const navigate = useNavigate();
    const { user, activeBranchId } = useAuthStore(); 
    
    const [activeTab, setActiveTab] = useState('active'); 
    const [allShifts, setAllShifts] = useState([]);
    const [cashiersList, setCashiersList] = useState([]); 
    const [branchesList, setBranchesList] = useState([]); 
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [historyPage, setHistoryPage] = useState(1);
    const [shiftBalances, setShiftBalances] = useState({}); 
    const HISTORY_PAGE_SIZE = 10;
    
    const [selectedShiftForAudit, setSelectedShiftForAudit] = useState(null);
    const [shiftToClose, setShiftToClose] = useState(null);
    const [isZReportOpen, setIsZReportOpen] = useState(false);
    const [zReportData, setZReportData] = useState(null);

    // 🔥 DESCARGA FORZADA
    const handleForceCloudSync = async () => {
        setSyncing(true);
        const toastId = toast.loading("Buscando en la nube...");
        try {
            const dbLocal = await getDB();
            // Llama a la función oculta en el repo que sincroniza en base al usuario actual
            await cashRepository._fetchHistoryFromCloud(dbLocal, user);
            await loadInitialData();
            toast.success("Turnos y Caja Sincronizados", { id: toastId });
        } catch (error) {
            console.error(error);
            toast.error("Error de sincronización", { id: toastId });
        } finally {
            setSyncing(false);
        }
    };

    const loadInitialData = async () => {
        setLoading(true);
        try {
            const companyPath = `companies/${user.companyId}`;
            
            const usersPromise = getDocs(query(collection(firestoreDB, 'users'), where('companyId', '==', user.companyId)));
            const branchesPromise = getDocs(collection(firestoreDB, companyPath, 'branches'));
            const shiftsPromise = cashRepository.getAllShifts(); 

            const [usersSnap, branchesSnap, shifts] = await Promise.all([usersPromise, branchesPromise, shiftsPromise]);

            setCashiersList(usersSnap.docs.map(d => ({ uid: d.id, ...d.data() })));
            setBranchesList(branchesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            setAllShifts(shifts);
        } catch (error) {
            console.error("Error Tesorería:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (user?.companyId) loadInitialData(); }, [user?.companyId, activeBranchId]);

    useEffect(() => {
        const refresh = () => loadInitialData();
        const onCloseConflict = (e) => {
            toast.error(`⚠️ Cierre en carrera detectado en turno ${e.detail?.shiftId} — se conservó el cierre de otro dispositivo.`);
            loadInitialData();
        };
        window.addEventListener('noar:shifts-synced', refresh);
        window.addEventListener('noar:cash-movements-synced', refresh);
        window.addEventListener('noar:shift-close-conflict', onCloseConflict);
        return () => {
            window.removeEventListener('noar:shifts-synced', refresh);
            window.removeEventListener('noar:cash-movements-synced', refresh);
            window.removeEventListener('noar:shift-close-conflict', onCloseConflict);
        };
    }, [user?.companyId]);

    const resolveBranchName = (id) => {
        const branch = branchesList.find(b => b.id === id);
        return branch ? branch.name : 'Sucursal Desconocida';
    };

    const resolveCashierName = (shiftUserId, shiftUserName) => {
        const matchedUser = cashiersList.find(u => u.uid === shiftUserId || u.email === shiftUserId);
        if (matchedUser) return matchedUser.name || matchedUser.email.split('@')[0];
        return shiftUserName || "Cajero";
    };

    const filteredShifts = useMemo(() => {
        const search = (searchTerm || '').toLowerCase();
        return allShifts.filter(s => {
            const cashier = resolveCashierName(s.userId, s.userName).toLowerCase();
            const branch = resolveBranchName(s.branchId).toLowerCase();
            return cashier.includes(search) || branch.includes(search) || (s.id || '').toLowerCase().includes(search);
        });
    }, [allShifts, searchTerm, cashiersList, branchesList]);

    const activeShifts = filteredShifts.filter(s => s.status === 'OPEN');
    const closedShifts = filteredShifts.filter(s => s.status === 'CLOSED');
    const totalHistoryPages = Math.ceil(closedShifts.length / HISTORY_PAGE_SIZE);
    const paginatedHistory = closedShifts.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE);

    useEffect(() => {
        const loadBalances = async () => {
            const newBalances = { ...shiftBalances };
            let hasChanges = false;
            for (const shift of paginatedHistory) {
                if (!newBalances[shift.id]) {
                    // 🔥 EL REPOSITORIO HACE LA MATEMÁTICA AHORA
                    newBalances[shift.id] = await cashRepository.getShiftBalance(shift.id);
                    hasChanges = true;
                }
            }
            if (hasChanges) setShiftBalances(newBalances);
        };
        if (paginatedHistory.length > 0) loadBalances();
    }, [paginatedHistory]);

    const handleOpenZReport = async (shift) => {
        try {
            let reportPayload = shift;
            
            if (shift.status === 'CLOSED') {
                // 🔥 Para turnos cerrados: usamos el auditSnapshot congelado como fuente de verdad
                // pero enriquecemos con el balance fresco para tener los gastos actualizados
                const freshBal = shiftBalances[shift.id] || await cashRepository.getShiftBalance(shift.id);
                reportPayload = {
                    ...shift,
                    // Datos frescos del balance (para consistencia)
                    expectedCash: freshBal.totalCash,
                    // 🔥 CLAVE: campo correcto para gastos/retiros
                    manualOut: freshBal.manualOut ?? shift.auditSnapshot?.manualOut ?? 0,
                    manualIn: freshBal.manualIn ?? shift.auditSnapshot?.manualIn ?? 0,
                    digitalIn: freshBal.digitalIn ?? shift.auditSnapshot?.digitalIn ?? 0,
                    digitalInByMethod: freshBal.digitalInByMethod ?? shift.auditSnapshot?.digitalInByMethod ?? {},
                    salesByMethod: freshBal.salesByMethod ?? shift.auditSnapshot?.salesByMethod ?? {},
                    salesCount: freshBal.salesCount ?? shift.auditSnapshot?.salesCount ?? 0,
                    totalSales: freshBal.totalSales ?? shift.auditSnapshot?.totalSales ?? 0,
                };
            } else {
                const auditData = await cashRepository.getShiftAuditData(shift.id);
                reportPayload = auditData;
            }
            
            setZReportData(reportPayload);
            setIsZReportOpen(true);
        } catch (e) { alert("Error: " + e.message); }
    };

    const handleConfirmAudit = async () => {
        if (!zReportData?.id && !zReportData?.shiftId) return;
        const id = zReportData.id || zReportData.shiftId;
        if (!window.confirm("¿Confirmar auditoría y archivar este turno?")) return;
        try {
            await cashRepository.confirmShiftAudit(id);
            setIsZReportOpen(false);
            loadInitialData();
            toast.success("✅ Turno auditado con éxito.");
        } catch (e) { alert(e.message); }
    };

    const handleCloseShift = async (closingData) => {
        try {
            await cashRepository.closeShift(shiftToClose.id, closingData);
            setShiftToClose(null);
            loadInitialData();
            toast.success("✅ Caja cerrada con éxito.");
        } catch (e) { alert(e.message); }
    };

    if (loading) return (
        <div className="h-[60vh] flex flex-col items-center justify-center gap-4 animate-pulse">
            <RefreshCw className="animate-spin text-brand" size={48} />
            <p className="text-sys-400 font-black uppercase tracking-widest text-xs">Sincronizando Tesorería...</p>
        </div>
    );

    return (
        <div className="space-y-6 pb-20 animate-in fade-in p-4 md:p-6 max-w-[1600px] mx-auto">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                    <h2 className="text-2xl font-black text-sys-900 flex items-center gap-2">
                        <Wallet className="text-brand" size={32} /> Tesorería & Auditoría
                    </h2>
                    <p className="text-sys-500 text-sm font-medium mt-1">Control multi-sucursal e integridad de flujos remotos.</p>
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <Button 
                        variant="outline" 
                        onClick={handleForceCloudSync} 
                        className="shadow-sm border-brand/30 text-brand bg-brand/5 hover:bg-brand hover:text-white transition-all h-11 px-4"
                        title="Forzar descarga de turnos y movimientos"
                    >
                        <CloudDownload size={18} className={syncing ? "animate-bounce mr-2" : "mr-2"}/>
                        <span className="font-bold">Bajar Nube</span>
                    </Button>
                    <div className="relative flex-1 md:w-80">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400" size={18} />
                        <input type="text" placeholder="Buscar cajero, sucursal o ID..." className="w-full pl-10 pr-4 py-2.5 bg-white border border-sys-200 rounded-xl outline-none focus:border-brand shadow-sm transition-all text-sm font-medium" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                    </div>
                </div>
            </div>

            <div className="flex bg-white p-1.5 rounded-2xl shadow-sm border border-sys-100 w-fit">
                <button onClick={() => setActiveTab('active')} className={cn("px-6 py-2 text-xs font-black rounded-xl transition-all flex items-center gap-2 uppercase tracking-wider", activeTab === 'active' ? "bg-sys-900 text-white shadow-lg" : "text-sys-400 hover:bg-sys-50")}>
                    <Unlock size={14}/> Activas ({activeShifts.length})
                </button>
                <button onClick={() => setActiveTab('history')} className={cn("px-6 py-2 text-xs font-black rounded-xl transition-all flex items-center gap-2 uppercase tracking-wider", activeTab === 'history' ? "bg-sys-900 text-white shadow-lg" : "text-sys-400 hover:bg-sys-50")}>
                    <HistoryIcon size={14}/> Historial ({closedShifts.length})
                </button>
            </div>

            {activeTab === 'active' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {activeShifts.length === 0 ? (
                        <Card className="col-span-full py-20 text-center border-dashed border-2 flex flex-col items-center gap-4 opacity-50 bg-transparent shadow-none border-sys-200">
                            <Lock size={48} className="text-sys-200" />
                            <p className="font-bold text-sys-400 uppercase text-xs tracking-widest">No hay cajas activas</p>
                        </Card>
                    ) : (
                        activeShifts.map(shift => (
                            <Card key={shift.id} className="relative overflow-hidden border-0 shadow-xl bg-white hover:scale-[1.01] transition-all border-l-4 border-emerald-500">
                                <div className="p-6">
                                    <div className="flex justify-between items-start mb-6">
                                        <div>
                                            <span className="text-[10px] font-black uppercase text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg flex items-center gap-1 w-fit mb-2"><Building2 size={10}/> {resolveBranchName(shift.branchId)}</span>
                                            <h3 className="text-xl font-black text-sys-900 uppercase leading-none">{resolveCashierName(shift.userId, shift.userName)}</h3>
                                            <p className="text-xs text-sys-400 font-mono mt-1 uppercase tracking-tighter opacity-70">ID: {shift.id.slice(-6)}</p>
                                        </div>
                                        <div className="p-3 bg-emerald-50 rounded-2xl text-emerald-500"><Unlock size={24} /></div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 mb-6">
                                        <div className="bg-sys-50 p-3 rounded-xl"><p className="text-[9px] font-black text-sys-400 uppercase">Inicio</p><p className="font-black text-sys-800 text-sm">{new Date(shift.openedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p></div>
                                        <div className="bg-sys-50 p-3 rounded-xl"><p className="text-[9px] font-black text-sys-400 uppercase">Fondo</p><p className="font-black text-sys-800 text-sm">{formatCurrency(shift.initialAmount)}</p></div>
                                    </div>
                                    <Button onClick={() => setShiftToClose(shift)} className="w-full bg-sys-900 hover:bg-black text-white py-3 font-black rounded-xl uppercase text-xs tracking-widest shadow-lg shadow-sys-900/10">Efectuar Cierre Z</Button>
                                </div>
                            </Card>
                        ))
                    )}
                </div>
            ) : (
                <Card className="p-0 overflow-hidden border-0 shadow-2xl rounded-3xl bg-white flex flex-col min-h-[500px]">
                    <div className="overflow-x-auto flex-1">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-sys-900 text-white text-[10px] font-black uppercase tracking-widest sticky top-0 z-10">
                                <tr>
                                    <th className="p-5">Cierre</th>
                                    <th className="p-5">Sucursal</th>
                                    <th className="p-5">Cajero</th>
                                    <th className="p-5 text-right">Teórico</th>
                                    <th className="p-5 text-right">Real</th>
                                    <th className="p-5 text-center">Desvío</th>
                                    <th className="p-5 text-center">Estado</th>
                                    <th className="p-5 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-sys-50">
                                {paginatedHistory.map(shift => {
                                    const { expected, declared, diff } = getShiftValues(shift, shiftBalances[shift.id]);
                                    const isPerfect = Math.abs(diff) < 50;
                                    return (
                                        <tr key={shift.id} className="hover:bg-sys-50 transition-colors group">
                                            <td className="p-5">
                                                <div className="font-black text-sys-800 text-xs uppercase">{new Date(shift.closedAt).toLocaleDateString()}</div>
                                                <div className="text-[10px] text-sys-400 font-mono">Inicio: {new Date(shift.openedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                                                <div className="text-[10px] text-sys-400 font-mono">Cierre: {new Date(shift.closedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                                            </td>
                                            <td className="p-5">
                                                <span className="text-[10px] font-black uppercase px-2 py-1 bg-sys-50 rounded-lg text-sys-600 border border-sys-100 flex items-center gap-1 w-fit">
                                                    <Building2 size={10}/> {resolveBranchName(shift.branchId)}
                                                </span>
                                            </td>
                                            <td className="p-5 font-black text-sys-700 text-xs uppercase">{resolveCashierName(shift.userId, shift.userName)}</td>
                                            <td className="p-5 text-right font-mono text-sys-400 text-xs">{formatCurrency(expected)}</td>
                                            <td className="p-5 text-right font-mono font-black text-sys-900 text-xs bg-sys-50/30">{formatCurrency(declared)}</td>
                                            <td className="p-5 text-center">
                                                <span className={cn("px-2.5 py-1 rounded-lg text-[10px] font-black border uppercase", isPerfect ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-rose-50 text-rose-700 border-rose-100")}>
                                                    {isPerfect ? 'OK' : formatCurrency(diff)}
                                                </span>
                                            </td>
                                            <td className="p-5 text-center">
                                                {shift.audited ? <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-full border border-blue-100 uppercase tracking-tighter">Auditado</span> : <span className="text-[9px] font-black text-orange-600 bg-orange-50 px-2 py-1 rounded-full border border-orange-100 uppercase tracking-tighter">Pendiente</span>}
                                            </td>
                                            <td className="p-5 text-right">
                                                <div className="flex justify-end gap-2">
                                                    <button onClick={() => setSelectedShiftForAudit(shift)} className="p-2.5 bg-white border border-sys-200 text-sys-600 rounded-xl hover:bg-sys-100 transition-all shadow-sm" title="Detalle Técnico"><Eye size={16} /></button>
                                                    <button onClick={() => handleOpenZReport(shift)} className="p-2.5 bg-brand text-white rounded-xl hover:bg-brand-hover transition-all shadow-md shadow-brand/20" title="Imprimir Ticket Z"><Printer size={16} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {closedShifts.length === 0 && <tr><td colSpan="8" className="p-20 text-center text-sys-400 italic uppercase font-black text-xs tracking-widest">No hay cierres registrados</td></tr>}
                            </tbody>
                        </table>
                    </div>
                    {totalHistoryPages > 1 && (
                        <div className="p-4 border-t border-sys-100 bg-sys-50 flex justify-between items-center px-6">
                            <span className="text-[10px] text-sys-400 font-black uppercase tracking-widest">Página {historyPage} de {totalHistoryPages}</span>
                            <div className="flex gap-2">
                                <Button variant="ghost" size="sm" disabled={historyPage === 1} onClick={() => setHistoryPage(p => Math.max(1, p - 1))}><ChevronLeft size={16}/></Button>
                                <Button variant="ghost" size="sm" disabled={historyPage === totalHistoryPages} onClick={() => setHistoryPage(p => Math.min(totalHistoryPages, p + 1))}><ChevronRight size={16}/></Button>
                            </div>
                        </div>
                    )}
                </Card>
            )}

            {/* Modales */}
            <AuditDetailModal key={selectedShiftForAudit?.id || 'none'} shift={selectedShiftForAudit} onClose={() => setSelectedShiftForAudit(null)} resolveName={resolveCashierName} resolveBranchName={resolveBranchName} />
            {isZReportOpen && <TicketZModal isOpen={isZReportOpen} onClose={() => setIsZReportOpen(false)} reportData={zReportData} onConfirmAudit={!zReportData?.audited ? handleConfirmAudit : null} />}
            {shiftToClose && <CashClosingModalWrapper shift={shiftToClose} onClose={() => setShiftToClose(null)} onConfirm={handleCloseShift} />}
        </div>
    );
};

// 🔥 WRAPPER INTELIGENTE: Ejecuta el interceptor antes del Cierre Z
const CashClosingModalWrapper = ({ shift, onClose, onConfirm }) => {
    const [totals, setTotals] = useState(null);
    useEffect(() => {
        let mounted = true;
        // 🔥 LEEMOS DIRECTAMENTE DEL REPOSITORIO
        cashRepository.getShiftBalance(shift.id).then(bal => {
            if (mounted) {
                setTotals(bal);
            }
        });
        return () => { mounted = false; };
    }, [shift]);

    if (!totals) return null;
    return <CashClosingModal isOpen={true} onClose={onClose} systemTotals={totals} onConfirm={onConfirm} shiftId={shift.id} userName={shift.userName || 'Cajero'} branchName={shift.branchId} />;
};