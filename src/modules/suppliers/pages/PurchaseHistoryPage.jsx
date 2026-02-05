import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom'; 
import { 
    Truck, Plus, FileText, Search, 
    DollarSign, Package, ChevronRight, ChevronLeft,
    Filter, AlertCircle, CheckCircle2, Clock, Wallet, X, MapPin,
    Eye, Trash2
} from 'lucide-react';

// 🔥 REPOSITORIO
import { purchaseRepository } from '../repositories/purchaseRepository'; 

import { useAuthStore } from '../../auth/store/useAuthStore';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import { SupplierPaymentModal } from '../components/SupplierPaymentModal'; 
import toast from 'react-hot-toast';

export const PurchaseHistoryPage = () => {
    const navigate = useNavigate();
    const { state: navState } = useLocation(); 
    const { companySlug } = useParams(); 
    const { activeBranchName, activeBranchId, user } = useAuthStore();
    
    // --- CONTROL DE PERMISOS ---
    // Cajero solo ve (READ ONLY). Owner/Admin operan (FULL ACCESS).
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
    const [viewDetail, setViewDetail] = useState(null); // Detalle de compra

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
        if (!canOperate) return; // Doble check
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

        if (!confirm(`⚠️ ¿ANULAR COMPRA #${purchase.invoiceNumber}?\n\nEsta acción:\n1. Restará el stock ingresado.\n2. Revertirá la deuda.\n3. Eliminará los pagos de la caja.`)) {
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
        
        // Si los items ya vienen cargados, usamos esos
        if (purchase.items && purchase.items.length > 0) {
            setViewDetail(purchase);
        } else {
            // Si no, hacemos fetch on-demand
            const items = await purchaseRepository.getPurchaseItems(purchase.id);
            setViewDetail({ ...purchase, items });
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
                            {activeSupplierFilter ? `Cuenta: ${activeSupplierFilter.name}` : 'Gestión de Abastecimiento'}
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
                    
                    {/* 🔥 BOTÓN NUEVA COMPRA (SOLO ADMIN/OWNER) */}
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

                {/* KPI CARDS (Solo visibles si tienes permiso o quizás limitadas para cajero) */}
                {/* Asumimos que el cajero PUEDE ver qué llegó, pero quizás no le importan las deudas globales */}
                <div className="grid grid-cols-4 gap-4">
                    <div className="bg-sys-50 border border-sys-200 p-4 rounded-2xl flex items-center gap-4 group hover:border-brand/30 transition-all">
                        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-emerald-600 shadow-sm group-hover:scale-110 transition-transform">
                            <DollarSign size={20}/>
                        </div>
                        <div>
                            <p className="text-[10px] uppercase font-bold text-sys-400">Total Comprado (Mes)</p>
                            <p className="text-xl font-black text-sys-900">
                                ${stats.monthTotal?.toLocaleString('es-AR', { notation: 'compact' }) || '0'}
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
                                ${stats.totalDebt?.toLocaleString('es-AR') || '0'}
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
                                {loading ? (
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

                                        return (
                                            <tr key={purchase.id} className="hover:bg-sys-50 transition-colors group">
                                                <td className="px-6 py-4 text-sm font-medium text-sys-600">
                                                    {new Date(purchase.date).toLocaleDateString()}
                                                    <span className="block text-[10px] text-sys-400">{new Date(purchase.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="font-bold text-sys-900 text-sm">{purchase.supplierName}</span>
                                                </td>
                                                <td className="px-6 py-4 text-sm font-mono text-sys-500 uppercase">{purchase.invoiceNumber || 'S/N'}</td>
                                                <td className="px-6 py-4 text-center">
                                                    <span className={cn(
                                                        "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide border",
                                                        status === 'PAID' ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                                                        status === 'PARTIAL' ? "bg-amber-50 text-amber-600 border-amber-100" :
                                                        "bg-red-50 text-red-600 border-red-100"
                                                    )}>
                                                        {status === 'PAID' ? 'PAGADO' : status === 'PARTIAL' ? 'PARCIAL' : 'PENDIENTE'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right font-black text-sys-900">${purchase.total.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                                                <td className="px-6 py-4 text-right">
                                                    {remaining > 0.01 ? (
                                                        <span className="font-black text-red-600 bg-red-50 px-2 py-1 rounded border border-red-100">${remaining.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                                                    ) : <span className="text-sys-300 font-bold">-</span>}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        {/* 🔥 BOTÓN PAGAR (SOLO ADMIN) */}
                                                        {isDebt && canOperate && (
                                                            <Button 
                                                                size="xs" 
                                                                onClick={(e) => handleOpenPayment(e, purchase)} 
                                                                className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200"
                                                            >
                                                                <DollarSign size={14}/>
                                                            </Button>
                                                        )}
                                                        
                                                        {/* 👀 BOTÓN VER (TODOS) */}
                                                        <Button size="xs" variant="secondary" onClick={(e) => handleViewDetail(e, purchase)}>
                                                            <Eye size={14} className="text-sys-600"/>
                                                        </Button>
                                                        
                                                        {/* 🔥 BOTÓN BORRAR (SOLO ADMIN) */}
                                                        {canOperate && (
                                                            <Button size="xs" variant="ghost" onClick={(e) => handleVoidPurchase(e, purchase)} className="text-sys-400 hover:text-red-500 hover:bg-red-50">
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
                    total={selectedPurchase.total} 
                    supplierName={selectedPurchase.supplierName}
                    invoiceToPay={{ 
                        id: selectedPurchase.id,
                        amount: selectedPurchase.total,
                        remainingBalance: selectedPurchase.remainingBalance,
                        invoiceNumber: selectedPurchase.invoiceNumber,
                        description: `Fac #${selectedPurchase.invoiceNumber}`
                    }}
                    onConfirm={handleConfirmPayment}
                />
            )}

            {/* MODAL DETALLE (READ ONLY) */}
            {viewDetail && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[80vh]">
                        <div className="p-4 border-b flex justify-between items-center bg-sys-50">
                            <div>
                                <h3 className="font-bold text-lg">Detalle de Compra</h3>
                                <p className="text-xs text-sys-500">Factura: {viewDetail.invoiceNumber}</p>
                            </div>
                            <button onClick={() => setViewDetail(null)} className="p-2 hover:bg-sys-200 rounded-full"><X size={20}/></button>
                        </div>
                        <div className="p-4 overflow-y-auto">
                            {(!viewDetail.items || viewDetail.items.length === 0) ? (
                                <p className="text-center text-sys-400 p-8 italic">No hay detalles disponibles para esta compra.</p>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="bg-sys-50 text-xs font-bold text-sys-500 uppercase">
                                        <tr>
                                            <th className="p-2 text-left">Producto</th>
                                            <th className="p-2 text-center">Cant.</th>
                                            <th className="p-2 text-right">Costo U.</th>
                                            <th className="p-2 text-right">Subtotal</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {viewDetail.items.map((item, idx) => (
                                            <tr key={idx}>
                                                <td className="p-2 font-medium">{item.name}</td>
                                                <td className="p-2 text-center font-mono">{item.qty}</td>
                                                <td className="p-2 text-right">${item.cost?.toLocaleString()}</td>
                                                <td className="p-2 text-right font-bold">${(item.cost * item.qty).toLocaleString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};