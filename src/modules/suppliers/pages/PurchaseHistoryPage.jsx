import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom'; 
import { 
    Truck, Plus, FileText, Search, 
    DollarSign, Package, ChevronRight, ChevronLeft,
    Filter, AlertCircle, CheckCircle2, Clock, Wallet, X, MapPin,
    Eye, Trash2, PackageMinus, Printer, Loader2
} from 'lucide-react';

// 🔥 REPOSITORIO
import { purchaseRepository } from '../repositories/purchaseRepository'; 

import { useAuthStore } from '../../auth/store/useAuthStore';
import { Button } from '../../../core/ui/Button';
import { Switch } from '../../../core/ui/Switch';
import { cn } from '../../../core/utils/cn';
import { SupplierPaymentModal } from '../components/SupplierPaymentModal'; 
import toast from 'react-hot-toast';

// =================================================================
// 🖨️ MODAL: TICKET DE COMPRA IMPRIMIBLE (NUEVO)
// =================================================================
const PurchaseTicketModal = ({ isOpen, onClose, purchase }) => {
    if (!isOpen || !purchase) return null;

    const handlePrint = () => {
        window.print();
    };

    const isAnulado = purchase.status === 'VOIDED' || purchase.afip?.status === 'VOIDED';
    const isRefunded = purchase.status === 'REFUNDED' || purchase.status === 'PARTIAL_REFUND';

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in print:bg-white print:z-[9999] print:inset-0">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[90vh] print:shadow-none print:w-full print:max-w-none print:h-auto">
                
                {/* Header solo pantalla */}
                <div className="p-4 border-b flex justify-between items-center bg-sys-50 print:hidden">
                    <h3 className="font-bold text-lg flex items-center gap-2 text-sys-900"><Printer size={18} className="text-brand"/> Comprobante de Compra</h3>
                    <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-500"><X size={20}/></button>
                </div>

                {/* Contenido Imprimible (Formato Ticket Térmico) */}
                <div className="flex-1 overflow-y-auto p-6 print:p-0 custom-scrollbar bg-sys-100 print:bg-white flex justify-center">
                    <div className="bg-white w-full max-w-[80mm] min-h-[100mm] p-4 text-black shadow-sm print:shadow-none font-mono text-[11px] leading-tight mx-auto border print:border-none relative">
                        
                        {(isAnulado || isRefunded) && (
                            <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none z-0 rotate-[-30deg]">
                                <span className="text-6xl font-black text-red-600 border-8 border-red-600 px-4 py-2 rounded-xl">ANULADO</span>
                            </div>
                        )}

                        <div className="text-center mb-4 border-b border-dashed border-black pb-4 relative z-10">
                            <h2 className="text-lg font-black uppercase mb-1">INGRESO MERCADERÍA</h2>
                            <p>Sucursal: {purchase.branchName || 'Principal'}</p>
                            <p>Usuario: {purchase.userName || 'Admin'}</p>
                            <p>Fecha: {new Date(purchase.date || purchase.createdAt).toLocaleString('es-AR')}</p>
                        </div>

                        <div className="mb-4 border-b border-dashed border-black pb-4 relative z-10">
                            <p><span className="font-bold">PROVEEDOR:</span> {purchase.supplierName}</p>
                            <p><span className="font-bold">FACTURA:</span> {purchase.invoiceNumber || 'S/N'}</p>
                            <p><span className="font-bold">ESTADO PAGO:</span> {purchase.paymentStatus === 'PAID' ? 'PAGADO' : purchase.paymentStatus === 'PARTIAL' ? 'PAGO PARCIAL' : 'IMPAGO'}</p>
                            <p><span className="font-bold">ESTADO DOC:</span> {isAnulado ? 'ANULADO' : isRefunded ? 'DEV. PARCIAL' : 'VIGENTE'}</p>
                        </div>

                        <table className="w-full mb-4 relative z-10">
                            <thead>
                                <tr className="border-b border-black">
                                    <th className="text-left pb-1 font-bold">CANT x DESC</th>
                                    <th className="text-right pb-1 font-bold">TOTAL</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dashed divide-gray-300">
                                {(!purchase.items || purchase.items.length === 0) ? (
                                    <tr><td colSpan="2" className="text-center py-4 italic">Cargando detalles...</td></tr>
                                ) : (
                                    purchase.items.map((item, idx) => {
                                        const q = item.qty || item.quantity || 1;
                                        const c = item.cost || item.price || 0;
                                        return (
                                            <tr key={idx}>
                                                <td className="py-1">
                                                    <div className="font-bold truncate max-w-[150px]">{item.name}</div>
                                                    <div>{q} x ${c.toLocaleString('es-AR', {minimumFractionDigits: 2})}</div>
                                                </td>
                                                <td className="text-right py-1 align-bottom font-bold">
                                                    ${(q * c).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                                </td>
                                            </tr>
                                        )
                                    })
                                )}
                            </tbody>
                        </table>

                        <div className="border-t border-black pt-2 space-y-1 relative z-10">
                            <div className="flex justify-between font-bold text-sm">
                                <span>TOTAL:</span>
                                <span>${(parseFloat(purchase.total || purchase.totalFinal || 0)).toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Pagado:</span>
                                <span>${(parseFloat(purchase.amountPaid || 0)).toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                            </div>
                            <div className="flex justify-between text-red-600 font-bold mt-1 pt-1 border-t border-dashed border-gray-300">
                                <span>Saldo Deudor:</span>
                                <span>${(parseFloat(purchase.remainingBalance || 0)).toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                            </div>
                        </div>
                        
                        {purchase.notes && (
                            <div className="mt-4 pt-2 border-t border-dashed border-black relative z-10">
                                <p className="font-bold">NOTAS Y AUDITORÍA:</p>
                                <p className="text-[10px] whitespace-pre-line">{purchase.notes}</p>
                            </div>
                        )}

                        <div className="text-center mt-6 pt-4 border-t border-black text-[9px] relative z-10">
                            <p>*** COMPROBANTE INTERNO ***</p>
                            <p>CONTROL DE INVENTARIO</p>
                        </div>
                    </div>
                </div>

                {/* Footer solo pantalla */}
                <div className="p-4 border-t bg-white flex gap-3 print:hidden">
                    <Button variant="ghost" onClick={onClose} className="flex-1 border border-sys-200">Cerrar</Button>
                    <Button onClick={handlePrint} className="flex-1 bg-sys-900 hover:bg-black text-white shadow-lg">
                        <Printer size={18} className="mr-2"/> Imprimir
                    </Button>
                </div>
            </div>
        </div>
    );
};

// =================================================================
// 🛍️ MODAL DE DEVOLUCIÓN PARCIAL (BLINDADO)
// =================================================================
const RefundModal = ({ isOpen, onClose, sale, onConfirm, isProcessing }) => {
    const [returnMap, setReturnMap] = useState({}); 
    const [refundTotal, setRefundTotal] = useState(0);
    const [reason, setReason] = useState('');
    const [refundCash, setRefundCash] = useState(true);

    useEffect(() => {
        if (isOpen) {
            setReturnMap({});
            setRefundTotal(0);
            setReason('');
            setRefundCash(true);
        }
    }, [isOpen, sale]);

    const handleQtyChange = (item, change) => {
        if (isProcessing) return; 
        
        const itemId = item.id || item.productId;
        const currentReturn = returnMap[itemId] || 0;
        
        // 🔥 CALCULAMOS CUÁNTO QUEDA DISPONIBLE PARA DEVOLVER
        const maxQty = parseFloat(item.qty || item.quantity || 0) - parseFloat(item.returnedQty || 0);
        
        const newReturn = Math.max(0, Math.min(maxQty, currentReturn + change));
        
        const newMap = { ...returnMap, [itemId]: newReturn };
        setReturnMap(newMap);

        let total = 0;
        sale.items.forEach(i => {
            const iId = i.id || i.productId;
            const returnedQty = newMap[iId] || 0;
            const itemCost = parseFloat(i.cost || i.price || 0);
            total += returnedQty * itemCost;
        });
        setRefundTotal(total);
    };

    if (!isOpen || !sale) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-5 border-b border-sys-100 bg-sys-50 flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-lg text-sys-900 flex items-center gap-2">
                            <PackageMinus className="text-orange-500" /> Devolución a Proveedor
                        </h3>
                        <p className="text-xs text-sys-500">Seleccione la mercadería a devolver.</p>
                    </div>
                    <button onClick={onClose} disabled={isProcessing} className="p-2 hover:bg-sys-200 rounded-full disabled:opacity-50"><X size={20}/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {(!sale.items || sale.items.length === 0) ? (
                        <p className="text-center text-sys-400 italic">No hay ítems para devolver.</p>
                    ) : (
                        sale.items.map(item => {
                            const itemId = item.id || item.productId;
                            const returnQty = returnMap[itemId] || 0;
                            // Calculamos lo que realmente queda para devolver
                            const maxQty = parseFloat(item.qty || item.quantity || 0) - parseFloat(item.returnedQty || 0);
                            const itemCost = parseFloat(item.cost || item.price || 0);
                            
                            // Si ya se devolvió todo este ítem, lo ocultamos
                            if (maxQty <= 0) return null;

                            return (
                                <div key={itemId} className={cn("flex items-center justify-between p-3 rounded-xl border transition-all", returnQty > 0 ? "border-orange-200 bg-orange-50" : "border-sys-100 bg-white")}>
                                    <div className="flex-1">
                                        <p className="text-sm font-bold text-sys-800">{item.name}</p>
                                        <p className="text-xs text-sys-500">
                                            Disponibles: <b>{maxQty}</b> x ${itemCost.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center border border-sys-200 rounded-lg bg-white">
                                            <button onClick={() => handleQtyChange(item, -1)} disabled={isProcessing} className="px-2 py-1 hover:bg-sys-100 text-sys-600 disabled:opacity-50">-</button>
                                            <span className="w-8 text-center text-sm font-bold text-orange-600">{returnQty}</span>
                                            <button onClick={() => handleQtyChange(item, 1)} disabled={isProcessing} className="px-2 py-1 hover:bg-sys-100 text-sys-600 disabled:opacity-50">+</button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {refundTotal > 0 && (
                    <div className="p-4 bg-sys-50 border-t border-sys-200 space-y-4 animate-in slide-in-from-bottom-2">
                        <div>
                            <label className="text-[10px] font-bold text-sys-500 uppercase tracking-widest mb-1.5 block">Motivo de Devolución *</label>
                            <input 
                                type="text" 
                                placeholder="Ej: Mercadería en mal estado, error de pedido..." 
                                className="w-full p-2.5 rounded-lg border border-sys-200 text-sm outline-none focus:border-orange-400"
                                value={reason}
                                onChange={e => setReason(e.target.value)}
                            />
                        </div>
                        <div className="flex items-center justify-between bg-white p-3 rounded-lg border border-sys-200">
                            <div>
                                <p className="text-xs font-bold text-sys-700 flex items-center gap-1">Ingresar dinero a caja</p>
                                <p className="text-[10px] text-sys-500">Apágalo si es Nota de Crédito (descuenta deuda)</p>
                            </div>
                            <Switch checked={refundCash} onCheckedChange={setRefundCash} disabled={isProcessing} />
                        </div>
                    </div>
                )}

                <div className="p-5 border-t border-sys-100 bg-white">
                    <div className="flex justify-between items-center mb-4">
                        <span className="text-sm font-bold text-sys-600 uppercase">Monto a Reintegrar:</span>
                        <span className="text-2xl font-black text-orange-600">
                            $ {refundTotal.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                        </span>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="ghost" onClick={onClose} disabled={isProcessing} className="flex-1 border border-sys-200">Cancelar</Button>
                        <Button 
                            onClick={() => {
                                if (!reason.trim()) return toast.error("El motivo es obligatorio");
                                onConfirm(sale, returnMap, refundTotal, reason, refundCash);
                            }} 
                            disabled={refundTotal <= 0 || isProcessing}
                            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-200"
                        >
                            {isProcessing ? (
                                <><Loader2 className="animate-spin mr-2" size={18}/> Procesando...</>
                            ) : (
                                "Confirmar Devolución"
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const PurchaseHistoryPage = () => {
    const navigate = useNavigate();
    const { state: navState } = useLocation(); 
    const { companySlug } = useParams(); 
    const { activeBranchName, activeBranchId, user } = useAuthStore();
    
    // --- CONTROL DE PERMISOS ---
    const canOperate = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

    // Estados
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ monthTotal: 0, count: 0, totalDebt: 0 });
    
    // Paginación
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const PAGE_SIZE = 15;

    // Filtros
    const [filterStatus, setFilterStatus] = useState('ALL'); 
    const [searchTerm, setSearchTerm] = useState('');
    const [activeSupplierFilter, setActiveSupplierFilter] = useState(null);

    // Modales
    const [selectedPurchase, setSelectedPurchase] = useState(null);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [viewDetail, setViewDetail] = useState(null); 
    const [refundData, setRefundData] = useState(null); 
    const [isProcessingRefund, setIsProcessingRefund] = useState(false);

    // Inicialización
    useEffect(() => {
        if (navState?.preFilterSupplierId) {
            setActiveSupplierFilter({
                id: navState.preFilterSupplierId,
                name: navState.preFilterSupplierName || 'Proveedor Seleccionado'
            });
            window.history.replaceState({}, document.title);
        }
    }, [navState]);

    useEffect(() => {
        setCurrentPage(1);
    }, [filterStatus, searchTerm, activeSupplierFilter, activeBranchId]);

    // =================================================================
    // ⚡ DESCARGA FORZADA (CLOUD PULL) - EL BOTÓN DE RESCATE
    // =================================================================
    // CORE: Carga de Datos
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const filters = {
                supplierId: activeSupplierFilter?.id,
                status: filterStatus,
                search: searchTerm,
            };

            const [pagedResult, statistics] = await Promise.all([
                purchaseRepository.getHistoryPaged(currentPage, PAGE_SIZE, filters),
                purchaseRepository.getStats()
            ]);

            setHistory(pagedResult.data);
            setTotalPages(pagedResult.totalPages);
            setTotalItems(pagedResult.totalCount);
            setStats(statistics);

        } catch (error) {
            console.error("Error cargando historial:", error);
            toast.error("Error al cargar datos");
        } finally {
            setLoading(false);
        }
    }, [currentPage, filterStatus, searchTerm, activeSupplierFilter, activeBranchId]);

    useEffect(() => {
        loadData();
    }, [loadData]);


    // ACCIONES
    const handleOpenPayment = (e, purchase) => {
        e.stopPropagation();
        if (!canOperate) return; 
        setSelectedPurchase(purchase);
        setIsPaymentModalOpen(true);
    };

    const handleConfirmPayment = async (paymentData) => {
        try {
            await purchaseRepository.registerPayment({
                ...paymentData,
                supplierId: selectedPurchase.supplierId,
                refId: selectedPurchase.id,
                description: `Pago Fac #${selectedPurchase.invoiceNumber}`
            });
            
            toast.success("Pago registrado correctamente");
            setIsPaymentModalOpen(false);
            loadData(); 
        } catch (e) {
            console.error(e);
            toast.error("Error al registrar el pago: " + e.message);
        }
    };

    const handleVoidPurchase = async (e, purchase) => {
        e.stopPropagation();
        
        if (!canOperate) {
            return toast.error("⛔ Acción no autorizada para tu perfil.");
        }

        if (!window.confirm(`⚠️ ¿ANULAR COMPRA #${purchase.invoiceNumber}?\n\nEsta acción:\n1. Restará el stock ingresado.\n2. Revertirá la deuda.\n3. Eliminará los pagos de la caja.`)) {
            return;
        }
        try {
            await purchaseRepository.voidPurchase(purchase.id);
            toast.success("Compra anulada correctamente");
            loadData();
        } catch (error) {
            toast.error("Error al anular: " + error.message);
        }
    };

    const handleViewDetail = async (e, purchase) => {
        e.stopPropagation();
        
        if (purchase.items && purchase.items.length > 0) {
            setViewDetail(purchase);
        } else {
            const items = await purchaseRepository.getPurchaseItems(purchase.id);
            setViewDetail({ ...purchase, items });
        }
    };

    // 🔥 DEVOLUCIÓN DE MERCADERÍA CONECTADA AL REPOSITORIO 🔥
    const handleProcessRefund = async (originalSale, returnMap, refundAmount, reason, refundCash) => {
        setIsProcessingRefund(true);
        try {
            await purchaseRepository.processRefund(originalSale, returnMap, refundAmount, reason, refundCash);
            toast.success("Devolución procesada correctamente.");
            setRefundData(null); 
            loadData(); 
        } catch (error) {
            console.error(error);
            toast.error("Error: " + error.message);
        } finally {
            setIsProcessingRefund(false);
        }
    };

    const handleOpenRefund = async (e, purchase) => {
        e.stopPropagation();
        if (!canOperate) return;
        
        if (purchase.items && purchase.items.length > 0) {
            setRefundData({ isOpen: true, sale: purchase });
        } else {
            const items = await purchaseRepository.getPurchaseItems(purchase.id);
            setRefundData({ isOpen: true, sale: { ...purchase, items } });
        }
    };

    const clearSupplierFilter = () => {
        setActiveSupplierFilter(null);
        setSearchTerm('');
    };

    const handleNewPurchase = () => {
        if (!canOperate) return;
        
        if (!activeBranchId || activeBranchId === 'ALL') {
            return toast.error("Por favor, seleccione una sucursal específica arriba.");
        }
        const state = activeSupplierFilter 
            ? { selectedSupplier: { id: activeSupplierFilter.id, name: activeSupplierFilter.name } }
            : null;
        
        const targetSlug = companySlug || 'main';
        navigate(`/${targetSlug}/suppliers/purchases/new`, { state });
    };

    return (
        <div className="h-full flex flex-col bg-sys-50 overflow-hidden animate-in fade-in duration-300">
            <header className="bg-white border-b border-sys-200 px-8 py-6 shrink-0">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h1 className="text-3xl font-black text-sys-900 tracking-tight flex items-center gap-3">
                            <Truck className="text-brand" size={32} />
                            {activeSupplierFilter ? `Cuenta: ${activeSupplierFilter.name}` : 'Historial de Compras'}
                        </h1>
                        <div className="flex items-center gap-2 mt-2">
                            <span className={cn(
                                "px-2 py-0.5 rounded-md text-xs font-bold border uppercase tracking-wider flex items-center gap-1",
                                activeBranchId && activeBranchId !== 'ALL' 
                                    ? "bg-sys-100 text-sys-600 border-sys-200" 
                                    : "bg-amber-50 text-amber-600 border-amber-100"
                            )}>
                                <MapPin size={10} />
                                {activeBranchName && activeBranchId !== 'ALL' ? activeBranchName : "Visión Global (Todas)"}
                            </span>
                            {activeSupplierFilter && <span className="text-sys-400 text-xs font-medium">● Historial filtrado</span>}
                        </div>
                    </div>
                    
                    <div className="flex gap-3">
                        {canOperate && (
                            <Button 
                                onClick={handleNewPurchase} 
                                className="h-12 px-8 text-lg shadow-xl shadow-brand/20 bg-brand hover:bg-brand-dark transition-all hover:scale-105"
                            >
                                <Plus className="mr-2" strokeWidth={3} />
                                Nueva Compra
                            </Button>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-4 gap-4">
                    <div className="bg-sys-50 border border-sys-200 p-4 rounded-2xl flex items-center gap-4 group hover:border-brand/30 transition-all">
                        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-emerald-600 shadow-sm group-hover:scale-110 transition-transform">
                            <DollarSign size={20}/>
                        </div>
                        <div>
                            <p className="text-[10px] uppercase font-bold text-sys-400">Total Comprado (30d)</p>
                            <p className="text-xl font-black text-sys-900">
                                ${stats.monthTotal?.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) || '0'}
                            </p>
                        </div>
                    </div>

                    <div className={cn(
                        "border p-4 rounded-2xl flex items-center gap-4 group transition-all", 
                        stats.totalDebt > 0 ? "bg-red-50 border-red-100 hover:border-red-200" : "bg-emerald-50 border-emerald-100"
                    )}>
                        <div className={cn(
                            "w-10 h-10 rounded-xl bg-white border flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform", 
                            stats.totalDebt > 0 ? "text-red-500 border-red-100" : "text-emerald-500 border-emerald-100"
                        )}>
                            {stats.totalDebt > 0 ? <Wallet size={20} /> : <CheckCircle2 size={20}/>}
                        </div>
                        <div>
                            <p className={cn(
                                "text-[10px] uppercase font-bold", 
                                stats.totalDebt > 0 ? "text-red-400" : "text-emerald-600"
                            )}>
                                Deuda Global
                            </p>
                            <p className={cn(
                                "text-xl font-black", 
                                stats.totalDebt > 0 ? "text-red-600" : "text-emerald-700"
                            )}>
                                ${stats.totalDebt?.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) || '0'}
                            </p>
                        </div>
                    </div>

                    <div className="bg-sys-50 border border-sys-200 p-4 rounded-2xl flex items-center gap-4 group hover:border-brand/30 transition-all">
                        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-brand shadow-sm group-hover:scale-110 transition-transform">
                            <FileText size={20}/>
                        </div>
                        <div>
                            <p className="text-[10px] uppercase font-bold text-sys-400">Comprobantes</p>
                            <p className="text-xl font-black text-sys-900">{stats.count || 0}</p>
                        </div>
                    </div>

                    <div className="bg-sys-50 border border-sys-200 p-4 rounded-2xl flex items-center gap-4 opacity-80">
                        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-sys-600 shadow-sm">
                            <Clock size={20}/>
                        </div>
                        <div>
                            <p className="text-[10px] uppercase font-bold text-sys-400">Visualizando</p>
                            <p className="text-sm font-black text-sys-900 truncate">
                                {activeSupplierFilter ? 'UN PROVEEDOR' : 'TODO EL HISTORIAL'}
                            </p>
                        </div>
                    </div>
                </div>
            </header>

            <div className="flex-1 overflow-hidden p-8 pt-4 flex flex-col gap-4">
                
                {/* Filtros */}
                <div className="flex flex-col gap-3">
                    {activeSupplierFilter && (
                        <div className="flex items-center animate-in slide-in-from-top-2 fade-in">
                            <div className="bg-sys-800 text-white pl-3 pr-1 py-1 rounded-full flex items-center gap-2 text-xs font-bold shadow-lg shadow-sys-900/10">
                                <span>Filtrando por: <span className="text-brand-300">{activeSupplierFilter.name}</span></span>
                                <button onClick={clearSupplierFilter} className="p-1 hover:bg-white/20 rounded-full transition-colors">
                                    <X size={14}/>
                                </button>
                            </div>
                            <span className="ml-3 text-xs text-sys-400">Mostrando solo movimientos de este proveedor.</span>
                        </div>
                    )}

                    <div className="flex items-center justify-between bg-white p-3 rounded-2xl border border-sys-200 shadow-sm shrink-0">
                        <div className="flex items-center gap-4">
                            <div className="flex bg-sys-100 p-1 rounded-xl border border-sys-200">
                                {[{ id: 'ALL', label: 'Todas' }, { id: 'UNPAID', label: 'Impagas' }, { id: 'PARTIAL', label: 'Parciales' }, { id: 'PAID', label: 'Pagadas' }].map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setFilterStatus(tab.id)}
                                        className={cn(
                                            "px-4 py-1.5 text-xs font-bold rounded-lg transition-all", 
                                            filterStatus === tab.id ? "bg-white text-sys-900 shadow-sm" : "text-sys-500 hover:text-sys-700 hover:bg-sys-200/50"
                                        )}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                            <div className="h-6 w-px bg-sys-200"></div>
                            <span className="text-xs font-medium text-sys-500">{totalItems} resultados</span>
                        </div>

                        <div className="relative w-64">
                            <Search className="absolute left-3 top-2.5 text-sys-400" size={16} />
                            <input 
                                type="text" 
                                placeholder="Buscar comprobante..." 
                                className="w-full pl-9 pr-4 py-2 bg-sys-50 border border-sys-200 rounded-xl text-sm font-medium outline-none focus:border-brand transition-all"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {/* Tabla */}
                <div className="bg-white border border-sys-200 rounded-3xl shadow-sm flex-1 flex flex-col overflow-hidden">
                    <div className="flex-1 overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-sys-50 sticky top-0 z-10 text-xs font-bold text-sys-500 uppercase tracking-wider shadow-sm">
                                <tr>
                                    <th className="px-6 py-4 border-b border-sys-200">Fecha</th>
                                    <th className="px-6 py-4 border-b border-sys-200">Proveedor</th>
                                    <th className="px-6 py-4 border-b border-sys-200">Comprobante</th>
                                    <th className="px-6 py-4 border-b border-sys-200 text-center">Estado</th>
                                    <th className="px-6 py-4 border-b border-sys-200 text-right">Total</th>
                                    <th className="px-6 py-4 border-b border-sys-200 text-right">Saldo</th>
                                    <th className="px-6 py-4 border-b border-sys-200 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-sys-100">
                                {loading && history.length === 0 ? (
                                    <tr><td colSpan="7" className="p-10 text-center text-sys-400 animate-pulse">Cargando datos financieros...</td></tr>
                                ) : history.length === 0 ? (
                                    <tr><td colSpan="7" className="p-20 text-center text-sys-400">
                                        <AlertCircle className="mx-auto mb-2 opacity-20" size={48} />
                                        <p>No se encontraron registros {activeBranchId !== 'ALL' ? 'en esta sucursal' : ''}.</p>
                                    </td></tr>
                                ) : (
                                    history.map((purchase) => {
                                        const status = purchase.paymentStatus || 'PAID';
                                        const remaining = purchase.remainingBalance !== undefined ? purchase.remainingBalance : 0;
                                        const isDebt = status === 'UNPAID' || status === 'PARTIAL';
                                        const isAnulado = purchase.status === 'VOIDED';
                                        const isRefunded = purchase.status === 'REFUNDED' || purchase.status === 'PARTIAL_REFUND';

                                        return (
                                            <tr key={purchase.id} onClick={(e) => handleViewDetail(e, purchase)} className={cn("hover:bg-sys-50/40 transition-colors group cursor-pointer", isAnulado && "opacity-50 bg-red-50/20")}>
                                                <td className="px-6 py-4 text-sm font-medium text-sys-600">
                                                    {new Date(purchase.date || purchase.createdAt).toLocaleDateString()}
                                                    <span className="block text-[10px] text-sys-400">{new Date(purchase.date || purchase.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="font-bold text-sys-900 text-sm">{purchase.supplierName}</span>
                                                </td>
                                                <td className="px-6 py-4 text-sm font-mono text-sys-500 uppercase">{purchase.invoiceNumber || 'S/N'}</td>
                                                <td className="px-6 py-4 text-center">
                                                    {isAnulado ? (
                                                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide border bg-red-50 text-red-600 border-red-100">ANULADO</span>
                                                    ) : isRefunded ? (
                                                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide border bg-orange-50 text-orange-600 border-orange-100">
                                                            {purchase.status === 'REFUNDED' ? 'DEVUELTO' : 'DEV. PARCIAL'}
                                                        </span>
                                                    ) : (
                                                        <span className={cn(
                                                            "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide border",
                                                            status === 'PAID' ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                                                            status === 'PARTIAL' ? "bg-amber-50 text-amber-600 border-amber-100" :
                                                            "bg-orange-50 text-orange-600 border-orange-100"
                                                        )}>
                                                            {status === 'PAID' ? 'PAGADO' : status === 'PARTIAL' ? 'PARCIAL' : 'IMPAGO'}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-right font-black text-sys-900">${(parseFloat(purchase.total || purchase.totalFinal || 0)).toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                                                <td className="px-6 py-4 text-right">
                                                    {remaining > 0.01 && !isAnulado ? (
                                                        <span className="font-black text-red-600 bg-red-50 px-2 py-1 rounded border border-red-100">${remaining.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                                                    ) : <span className="text-sys-300 font-bold">-</span>}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        {isDebt && canOperate && !isAnulado && (
                                                            <Button 
                                                                size="xs" 
                                                                onClick={(e) => handleOpenPayment(e, purchase)} 
                                                                className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200"
                                                                title="Pagar Deuda"
                                                            >
                                                                <DollarSign size={14}/>
                                                            </Button>
                                                        )}
                                                        
                                                        {canOperate && !isAnulado && (
                                                            <Button size="xs" variant="ghost" onClick={(e) => handleOpenRefund(e, purchase)} className="text-orange-400 hover:text-orange-600 hover:bg-orange-50" title="Devolución">
                                                                <PackageMinus size={14}/>
                                                            </Button>
                                                        )}

                                                        <Button size="xs" variant="secondary" onClick={(e) => handleViewDetail(e, purchase)} className="text-sys-600 hover:bg-sys-100 shadow-none border-sys-200" title="Ver Comprobante">
                                                            <Eye size={14} />
                                                        </Button>
                                                        
                                                        {canOperate && !isAnulado && (
                                                            <Button size="xs" variant="ghost" onClick={(e) => handleVoidPurchase(e, purchase)} className="text-sys-400 hover:text-red-500 hover:bg-red-50" title="Anular Totalmente">
                                                                <Trash2 size={14}/>
                                                            </Button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Barra Paginación */}
                    <div className="p-4 border-t border-sys-200 bg-sys-50 flex justify-between items-center">
                        <span className="text-xs text-sys-500 font-medium">Mostrando {history.length} de {totalItems} registros</span>
                        <div className="flex items-center gap-2">
                            <Button 
                                variant="secondary" size="sm" 
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
                                disabled={currentPage === 1 || loading}
                            >
                                <ChevronLeft size={16}/>
                            </Button>
                            <span className="text-xs font-bold text-sys-700 min-w-[60px] text-center">Pág {currentPage} de {totalPages || 1}</span>
                            <Button 
                                variant="secondary" size="sm" 
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
                                disabled={currentPage === totalPages || loading}
                            >
                                <ChevronRight size={16}/>
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* MODAL PAGO */}
            {selectedPurchase && canOperate && (
                <SupplierPaymentModal 
                    isOpen={isPaymentModalOpen}
                    onClose={() => setIsPaymentModalOpen(false)}
                    total={selectedPurchase.total || selectedPurchase.totalFinal || 0} 
                    supplierName={selectedPurchase.supplierName}
                    invoiceToPay={{ 
                        id: selectedPurchase.id,
                        amount: selectedPurchase.total || selectedPurchase.totalFinal || 0,
                        remainingBalance: selectedPurchase.remainingBalance,
                        invoiceNumber: selectedPurchase.invoiceNumber,
                        description: `Fac #${selectedPurchase.invoiceNumber}`
                    }}
                    onConfirm={handleConfirmPayment}
                />
            )}

            {/* 🔥 MODAL DETALLE E IMPRESIÓN (TICKET) */}
            <PurchaseTicketModal 
                isOpen={!!viewDetail} 
                onClose={() => setViewDetail(null)} 
                purchase={viewDetail} 
            />

            {refundData && (
                <RefundModal 
                    isOpen={refundData.isOpen}
                    sale={refundData.sale}
                    isProcessing={isProcessingRefund} 
                    onClose={() => setRefundData(null)}
                    onConfirm={handleProcessRefund}
                />
            )}
        </div>
    );
};