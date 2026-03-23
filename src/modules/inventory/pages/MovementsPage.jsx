import React, { useEffect, useState, useMemo } from 'react';
import { 
    Search, Filter, ArrowDownLeft, ArrowUpRight, 
    History, DollarSign, Tag, AlertCircle, CheckCircle2, Package,
    BarChart3, List, Users, Calendar, Layers, X, MapPin, Loader2, CloudDownload, FileArchive, Link as LinkIcon, Printer
} from 'lucide-react';

// Repositorios y Stores
import { productRepository } from '../repositories/productRepository';
import { masterRepository } from '../../inventory/repositories/masterRepository'; 
import { useAuthStore } from '../../auth/store/useAuthStore';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import { getDB } from '../../../database/db';

// Componentes de Trazabilidad (Tickets)
import { TicketModal } from '../../sales/components/TicketModal'; 
import toast from 'react-hot-toast';

// ====================================================================
// 🎨 CONFIGURACIÓN VISUAL
// ====================================================================
const TYPE_CONFIG = {
  'PRICE_CHANGE': { label: 'Cambio Precio', icon: DollarSign, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
  'COST_CHANGE': { label: 'Cambio Costo', icon: Tag, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
  'STOCK_IN': { label: 'Ingreso Compra', icon: ArrowDownLeft, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  'IN': { label: 'Ingreso Manual', icon: ArrowDownLeft, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
  'STOCK_ADJUST_IN': { label: 'Ajuste (+)', icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
  'STOCK_ADJUST_OUT': { label: 'Ajuste (-)', icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
  'OUT': { label: 'Salida Manual', icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
  'CREATION': { label: 'Alta Producto', icon: Package, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
  'STOCK_OUT': { label: 'Venta', icon: ArrowUpRight, color: 'text-sys-600', bg: 'bg-sys-100', border: 'border-sys-200' },
  'BUDGET': { label: 'Presupuesto', icon: FileArchive, color: 'text-gray-500', bg: 'bg-gray-100', border: 'border-gray-200' }, 
};

// =================================================================
// 🖨️ MODAL: TICKET DE COMPRA IMPRIMIBLE
// =================================================================
const PurchaseTicketModal = ({ isOpen, onClose, purchase }) => {
    if (!isOpen || !purchase) return null;

    const handlePrint = () => window.print();

    const isAnulado = purchase.status === 'VOIDED' || purchase.afip?.status === 'VOIDED';
    const isRefunded = purchase.status === 'REFUNDED' || purchase.status === 'PARTIAL_REFUND';

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in print:bg-white print:z-[9999] print:inset-0">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[90vh] print:shadow-none print:w-full print:max-w-none print:h-auto">
                <div className="p-4 border-b flex justify-between items-center bg-sys-50 print:hidden">
                    <h3 className="font-bold text-lg flex items-center gap-2 text-sys-900"><Printer size={18} className="text-brand"/> Comprobante de Compra</h3>
                    <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-500"><X size={20}/></button>
                </div>

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
                            <p>Fecha: {new Date(purchase.date).toLocaleString('es-AR')}</p>
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
                                    <tr><td colSpan="2" className="text-center py-4 italic">Sin detalles cargados...</td></tr>
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

                        <div className="text-center mt-6 pt-4 border-t border-black text-[9px] relative z-10">
                            <p>*** COMPROBANTE INTERNO ***</p>
                            <p>CONTROL DE INVENTARIO</p>
                        </div>
                    </div>
                </div>

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

// ====================================================================
// SUB-COMPONENTE: MODAL HISTORIAL DE PRODUCTO
// ====================================================================
const ProductHistoryModal = ({ productData, movements, onClose, onViewDocument }) => {
    if (!productData) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh]">
                <div className="p-5 border-b border-sys-100 flex justify-between items-center bg-sys-50">
                    <div>
                        <h3 className="font-bold text-lg text-sys-900 leading-tight">{productData.name}</h3>
                        <p className="text-xs text-sys-500 font-mono mt-1">{productData.code}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-500"><X size={20}/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-0">
                    {movements.length === 0 ? (
                        <p className="text-center text-sys-400 py-10">Sin movimientos registrados.</p>
                    ) : (
                        <table className="w-full text-left text-sm border-collapse">
                            <thead className="bg-sys-50 text-xs uppercase font-bold text-sys-400 sticky top-0 border-b border-sys-200 shadow-sm">
                                <tr>
                                    <th className="px-4 py-3">Fecha</th>
                                    <th className="px-4 py-3">Tipo</th>
                                    <th className="px-4 py-3">Detalle</th>
                                    <th className="px-4 py-3">Usuario/Sucursal</th>
                                    <th className="px-4 py-3 text-right">Cantidad</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-sys-100">
                                {movements.map(mov => {
                                    const style = TYPE_CONFIG[mov.type] || { label: mov.type, icon: AlertCircle, color: 'text-gray-500', bg: 'bg-gray-100', border: 'border-gray-200' };
                                    const Icon = style.icon;
                                    const isBudget = mov.type === 'BUDGET';

                                    return (
                                        <tr 
                                            key={mov.id} 
                                            className={cn(
                                                "transition-colors", 
                                                isBudget && "opacity-50",
                                                mov.refId ? "hover:bg-brand/5 cursor-pointer group" : "hover:bg-sys-50"
                                            )}
                                            onClick={() => onViewDocument(mov)}
                                            title={mov.refId ? "Haga clic para ver el comprobante" : ""}
                                        >
                                            <td className="px-4 py-3">
                                                <div className="font-bold text-sys-900">{mov.dateObj.toLocaleDateString()}</div>
                                                <div className="text-[10px] text-sys-400">{mov.dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase border", style.bg, style.color, style.border)}>
                                                    <Icon size={12}/> {style.label}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 max-w-[200px]">
                                                <div className="truncate text-sys-600" title={mov.description || 'Sin descripción'}>
                                                    {mov.description || 'Sin descripción'}
                                                </div>
                                                {mov.refId && (
                                                    <div className="text-[9px] text-brand font-mono font-bold flex items-center gap-1 mt-0.5 group-hover:underline">
                                                        <LinkIcon size={10}/> DOC: {mov.refId.split('_').pop().toUpperCase()}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-col gap-0.5 text-[10px] text-sys-500">
                                                    <span className="flex items-center gap-1 font-bold text-sys-700"><Users size={10}/> {mov.user || 'Sistema'}</span>
                                                    {mov.branchId && <span className="flex items-center gap-1"><MapPin size={10}/> {mov.branchId}</span>}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {mov.amount && (
                                                    <span className={cn("text-base font-black tracking-tight", isBudget ? "text-gray-400" : (mov.type.includes('OUT') || mov.amount < 0) ? "text-red-600" : "text-green-600")}>
                                                        {(mov.type.includes('OUT') || mov.amount < 0) ? '-' : '+'}{Math.abs(Number(mov.amount))}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
                
                <div className="p-4 border-t border-sys-100 bg-sys-50 flex justify-end">
                    <Button onClick={onClose} variant="secondary">Cerrar Historial</Button>
                </div>
            </div>
        </div>
    );
};

export const MovementsPage = () => {
    // ===================== ESTADOS =====================
    const { user, activeBranchId, activeBranchName } = useAuthStore();
    const [data, setData] = useState([]);
    const [categories, setCategories] = useState([]);
    const [userList, setUserList] = useState([]); 
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false); 
    
    // MODALES
    const [selectedProduct, setSelectedProduct] = useState(null); 
    const [selectedDocument, setSelectedDocument] = useState(null); // { type: 'sale' | 'purchase', data: {} }

    // VISTA
    const [viewMode, setViewMode] = useState('list'); 
    
    // FILTROS
    const [search, setSearch] = useState('');
    const [dateRange, setDateRange] = useState('TODAY'); 
    const [filterUser, setFilterUser] = useState('ALL'); 
    const [filterCategory, setFilterCategory] = useState('ALL');

    // ===================== CARGA OPTIMIZADA BLINDADA =====================
    useEffect(() => {
        const loadData = async () => {
            try {
                setLoading(true);
                
                const [allProducts, allCats] = await Promise.all([
                    productRepository.getAll(),
                    masterRepository.getAll('categories')
                ]);
                
                setCategories(allCats);

                const { getDB } = await import('../../../database/db');
                const db = await getDB();
                
                let allMovements = [];

                if (user?.role === 'OWNER' || user?.role === 'SUPER_ADMIN') {
                    if (activeBranchId && activeBranchId !== 'ALL') {
                        allMovements = await db.movements.where('branchId').equals(activeBranchId).toArray();
                    } else {
                        allMovements = await db.movements.toArray();
                    }
                } else {
                    if (activeBranchId) {
                        allMovements = await db.movements.where('branchId').equals(activeBranchId).toArray();
                    } else {
                        allMovements = []; 
                    }
                }

                if (allMovements.length === 0 && navigator.onLine) {
                    setSyncing(true);
                    try {
                        const { collection, query, orderBy, limit, getDocs, where } = await import('firebase/firestore');
                        const { db: firestoreDB } = await import('../../../database/firebase');
                        
                        let q;
                        if ((user?.role === 'OWNER' || user?.role === 'SUPER_ADMIN') && (!activeBranchId || activeBranchId === 'ALL')) {
                            q = query(collection(firestoreDB, `companies/${user.companyId}/movements`), orderBy('date', 'desc'), limit(100));
                        } else {
                            q = query(collection(firestoreDB, `companies/${user.companyId}/movements`), where('branchId', '==', activeBranchId), orderBy('date', 'desc'), limit(100));
                        }
                        
                        const snapshot = await getDocs(q);
                        const cloudMovements = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                        
                        if (cloudMovements.length > 0) {
                            await db.movements.bulkPut(cloudMovements);
                            allMovements = cloudMovements;
                        }
                    } catch (e) {
                        console.warn("Fallo hidratación silenciosa de kardex:", e);
                    } finally {
                        setSyncing(false);
                    }
                }

                const productMap = new Map(allProducts.map(p => [String(p.id), p])); 
                const uniqueUsers = new Set();

                const enrichedData = allMovements.map(mov => {
                    const product = productMap.get(String(mov.productId));
                    
                    let cleanUser = mov.user || 'Sistema';
                    if (cleanUser.toLowerCase() === 'admin') cleanUser = 'Sistema'; 
                    uniqueUsers.add(cleanUser);

                    const catName = product ? (product.category || 'Sin Categoría') : 'Eliminado';

                    return {
                        ...mov,
                        user: cleanUser,
                        productName: product ? product.name : 'Producto Eliminado',
                        productCode: product ? product.code : '---',
                        categoryName: catName, 
                        priceAtMoment: product ? product.price : 0, 
                        dateObj: new Date(mov.date)
                    };
                }).sort((a, b) => b.dateObj - a.dateObj);

                setData(enrichedData);
                setUserList(Array.from(uniqueUsers).sort()); 

            } catch (error) {
                console.error("Error cargando movimientos:", error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [user, activeBranchId]); 

    // ===================== LÓGICA DE FILTRADO =====================
    const filteredData = useMemo(() => {
        return data.filter(item => {
            const itemDate = item.dateObj;
            const today = new Date();
            today.setHours(0,0,0,0);

            if (dateRange === 'TODAY') {
                if (itemDate < today) return false;
            } else if (dateRange === 'WEEK') {
                const weekAgo = new Date(today);
                weekAgo.setDate(today.getDate() - 7);
                if (itemDate < weekAgo) return false;
            }

            if (filterUser !== 'ALL' && item.user !== filterUser) return false;
            if (filterCategory !== 'ALL' && item.categoryName !== filterCategory) return false;

            if (search) {
                const term = search.toLowerCase();
                return item.productName.toLowerCase().includes(term) || 
                       item.productCode.toLowerCase().includes(term);
            }

            return true;
        });
    }, [data, search, dateRange, filterUser, filterCategory]);

    // ===================== ESTADÍSTICAS POR CATEGORÍA =====================
    const categoryStats = useMemo(() => {
        const stats = {}; 
        filteredData.forEach(mov => {
            if (mov.type === 'BUDGET') return;
            if (mov.type !== 'STOCK_OUT' && mov.type !== 'OUT') return;
            
            const catName = mov.categoryName;
            if (!stats[catName]) stats[catName] = { name: catName, money: 0, items: 0 };
            
            const qty = Math.abs(parseFloat(mov.amount));
            stats[catName].items += qty;
            stats[catName].money += qty * (mov.priceAtMoment || 0);
        });
        return Object.values(stats).sort((a,b) => b.money - a.money);
    }, [filteredData]);

    // ===================== VISTA AGREGADA =====================
    const aggregatedData = useMemo(() => {
        const grouping = {};
        filteredData.forEach(mov => {
            if (mov.type === 'BUDGET') return;

            if (!grouping[mov.productId]) {
                grouping[mov.productId] = {
                    id: mov.productId,
                    name: mov.productName,
                    code: mov.productCode,
                    soldQty: 0, 
                    addedQty: 0,
                    netQty: 0,
                    movementsList: [],
                    revenue: 0 
                };
            }
            
            const entry = grouping[mov.productId];
            const qty = parseFloat(mov.amount || 0);
            
            const isOut = mov.type.includes('OUT') || qty < 0;

            if (isOut) {
                entry.soldQty += Math.abs(qty);
                if (mov.type === 'STOCK_OUT') {
                    entry.revenue += Math.abs(qty) * (mov.priceAtMoment || 0);
                }
            } else {
                entry.addedQty += qty;
            }

            entry.netQty += qty;
            entry.movementsList.push(mov); 
        });
        return Object.values(grouping).sort((a,b) => b.soldQty - a.soldQty);
    }, [filteredData]);

    // ===================== HANDLERS DE TRAZABILIDAD =====================
    const handleOpenProductHistory = (aggItem) => {
        setSelectedProduct({
            productData: { name: aggItem.name, code: aggItem.code },
            movements: aggItem.movementsList
        });
    };

    const handleViewDocument = async (mov) => {
        if (!mov.refId) {
            toast.info("Movimiento manual. No tiene un comprobante asociado.", { icon: 'ℹ️' });
            return;
        }

        const toastId = toast.loading("Buscando comprobante...");
        try {
            const dbLocal = await getDB();
            
            // 1. Buscar en Ventas
            const sale = await dbLocal.sales.get(mov.refId);
            if (sale) {
                toast.dismiss(toastId);
                setSelectedDocument({ type: 'sale', data: sale });
                return;
            }

            // 2. Buscar en Compras
            const purchase = await dbLocal.purchases.get(mov.refId);
            if (purchase) {
                toast.dismiss(toastId);
                setSelectedDocument({ type: 'purchase', data: purchase });
                return;
            }

            toast.error("El comprobante ya no existe en el dispositivo local.", { id: toastId });
        } catch (error) {
            console.error(error);
            toast.error("Error al buscar el comprobante.", { id: toastId });
        }
    };

    // ===================== RENDER =====================
    return (
        <div className="space-y-6 pb-20 animate-in fade-in duration-500 max-w-[1600px] mx-auto p-4 md:p-6">
            
            <div className="flex flex-col gap-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-sys-900 tracking-tight flex items-center gap-2">
                            <History className="text-brand" /> Control de Movimientos
                        </h2>
                        <p className="text-sys-500 text-sm mt-1 flex items-center gap-2">
                           {dateRange === 'TODAY' ? 'Mostrando actividad de HOY' : 'Historial de movimientos'}
                           {activeBranchId && activeBranchId !== 'ALL' && <span className="font-bold text-brand bg-brand/10 px-2 py-0.5 rounded-lg border border-brand/20 text-xs">Sucursal: {activeBranchId}</span>}
                        </p>
                    </div>
                    <div className="bg-white px-5 py-2 rounded-xl border border-sys-200 shadow-sm flex items-center gap-4">
                        <div className="text-right">
                            <p className="text-[10px] text-sys-400 font-bold uppercase">Movimientos Totales</p>
                            <p className="text-2xl font-black text-sys-900 leading-none flex items-center gap-2">
                                {filteredData.length.toLocaleString('es-AR')}
                                {syncing && <CloudDownload size={14} className="text-sys-300 animate-pulse" title="Sincronizando de la nube..." />}
                            </p>
                        </div>
                        <div className="h-8 w-8 rounded-full bg-brand/10 text-brand flex items-center justify-center">
                            <Package size={18} />
                        </div>
                    </div>
                </div>

                {categoryStats.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                        {categoryStats.map((cat, idx) => (
                            <Card key={idx} className="p-3 border-l-4 border-l-brand flex flex-col justify-between hover:shadow-md transition-shadow">
                                <span className="text-[10px] uppercase font-bold text-sys-400 truncate" title={cat.name}>{cat.name}</span>
                                <div>
                                    <p className="text-lg font-black text-sys-800">$ {cat.money.toLocaleString('es-AR', {maximumFractionDigits: 0})}</p>
                                    <p className="text-[10px] text-sys-500">{cat.items} u. movidas</p>
                                </div>
                            </Card>
                        ))}
                    </div>
                )}

                <Card className="p-2 flex flex-col lg:flex-row gap-3 bg-sys-100/50 backdrop-blur-md border-sys-200 items-center">
                    
                    <div className="relative flex-1 w-full lg:w-auto">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400 w-4 h-4" />
                        <input 
                            type="text" 
                            placeholder="Buscar por nombre o código de producto..." 
                            className="w-full pl-9 pr-4 py-2 bg-white rounded-lg border border-sys-200 text-sm focus:border-brand focus:ring-2 focus:ring-brand/10 outline-none transition-all"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>

                    <div className="flex gap-2 w-full lg:w-auto overflow-x-auto pb-1 lg:pb-0">
                        <div className="flex bg-white rounded-lg border border-sys-200 p-1 shrink-0">
                           {['TODAY', 'WEEK', 'ALL'].map(range => (
                               <button 
                                 key={range}
                                 onClick={() => setDateRange(range)}
                                 className={cn("px-3 py-1.5 text-xs font-bold rounded-md transition-all uppercase flex items-center gap-1", 
                                    dateRange === range ? "bg-sys-100 text-brand" : "text-sys-400 hover:text-sys-600"
                                 )}
                               >
                                 {range === 'TODAY' && <Calendar size={12}/>}
                                 {range === 'TODAY' ? 'Hoy' : range === 'WEEK' ? 'Semana' : 'Histórico'}
                               </button>
                           ))}
                        </div>

                        <div className="relative min-w-[140px] shrink-0">
                            <Layers className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400 w-4 h-4" />
                            <select 
                                className="w-full pl-9 pr-4 py-2 bg-white rounded-lg border border-sys-200 text-sm outline-none focus:border-brand appearance-none cursor-pointer font-medium text-sys-700"
                                value={filterCategory}
                                onChange={(e) => setFilterCategory(e.target.value)}
                            >
                                <option value="ALL">Todas las Categorías</option>
                                {categories.map(c => (
                                    <option key={c.id} value={c.name}>{c.name}</option> 
                                ))}
                            </select>
                        </div>

                        <div className="relative min-w-[140px] shrink-0">
                            <Users className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400 w-4 h-4" />
                            <select 
                                className="w-full pl-9 pr-4 py-2 bg-white rounded-lg border border-sys-200 text-sm outline-none focus:border-brand appearance-none cursor-pointer font-medium text-sys-700"
                                value={filterUser}
                                onChange={(e) => setFilterUser(e.target.value)}
                            >
                                <option value="ALL">Todos los Usuarios</option>
                                {userList.map(u => (
                                    <option key={u} value={u}>{u}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex bg-white rounded-lg border border-sys-200 p-1 shrink-0">
                            <button onClick={() => setViewMode('list')} className={cn("px-2 py-1.5 rounded-md transition-all flex items-center gap-2 text-xs font-bold", viewMode === 'list' ? "bg-brand text-white shadow-md" : "text-sys-500 hover:bg-sys-50")} title="Ver Lista de Movimientos"><List size={16} /></button>
                            <button onClick={() => setViewMode('aggregated')} className={cn("px-2 py-1.5 rounded-md transition-all flex items-center gap-2 text-xs font-bold", viewMode === 'aggregated' ? "bg-brand text-white shadow-md" : "text-sys-500 hover:bg-sys-50")} title="Ver Totales Agrupados"><BarChart3 size={16} /></button>
                        </div>
                    </div>
                </Card>
            </div>

            <div className="min-h-[300px]">
                {loading ? (
                    <div className="text-center py-20 text-sys-400">
                        <Loader2 className="animate-spin h-8 w-8 text-brand mx-auto mb-3" />
                        <p className="text-xs font-bold tracking-widest uppercase">Analizando movimientos...</p>
                    </div>
                ) : filteredData.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-sys-200 shadow-sm">
                        <div className="w-16 h-16 bg-sys-50 rounded-full flex items-center justify-center mx-auto mb-3 text-sys-300"><Filter size={32} /></div>
                        <p className="text-sys-500 font-medium">Sin movimientos encontrados</p>
                    </div>
                ) : viewMode === 'aggregated' ? (
                    
                    /* VISTA AGREGADA (TARJETAS) */
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 animate-in slide-in-from-bottom-2 duration-300">
                        {aggregatedData.map(item => (
                            <div 
                                key={item.id} 
                                onClick={() => handleOpenProductHistory(item)} 
                                className="bg-white p-4 rounded-xl border border-sys-200 shadow-sm flex flex-col justify-between group hover:border-brand/30 hover:shadow-md transition-all relative overflow-hidden cursor-pointer"
                            >
                                {item.soldQty > 5 && <div className="absolute top-0 right-0 w-12 h-12 bg-gradient-to-bl from-green-50 to-transparent rounded-bl-3xl -mr-2 -mt-2"></div>}

                                <div className="flex justify-between items-start mb-3 relative z-10">
                                    <div className="min-w-0 pr-2">
                                        <p className="text-[9px] font-bold text-sys-400 uppercase tracking-wider mb-0.5 truncate">{item.code}</p>
                                        <h4 className="font-bold text-sys-900 text-sm leading-tight line-clamp-2 group-hover:text-brand transition-colors" title={item.name}>{item.name}</h4>
                                    </div>
                                    <span className="bg-sys-50 text-sys-500 text-[9px] font-bold px-1.5 py-0.5 rounded border border-sys-100 whitespace-nowrap">
                                        {item.movementsList.length} movs
                                    </span>
                                </div>

                                <div className="flex items-end justify-between border-t border-sys-100 pt-2 relative z-10">
                                    <div className="flex flex-col">
                                        <span className="text-[9px] text-sys-400 uppercase font-bold">Vendido</span>
                                        <div className="flex items-baseline gap-1">
                                            <span className={cn("text-xl font-black tracking-tighter", item.soldQty > 0 ? "text-sys-900" : "text-sys-300")}>
                                                {item.soldQty > 0 ? item.soldQty : '-'}
                                            </span>
                                            {item.revenue > 0 && <span className="text-[10px] text-sys-500 font-medium">$ {item.revenue.toLocaleString('es-AR', {maximumFractionDigits:0})}</span>}
                                        </div>
                                    </div>
                                    
                                    {item.addedQty > 0 && (
                                        <div className="text-right">
                                            <span className="text-[9px] text-green-600 uppercase font-bold block">Entrada</span>
                                            <span className="text-xs font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded">+{item.addedQty}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                ) : (
                    
                    /* VISTA LISTA DETALLADA (TABLA PROFESIONAL) */
                    <Card className="p-0 overflow-hidden shadow-soft border-0 animate-in slide-in-from-bottom-2 duration-300">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-sm">
                                <thead className="bg-sys-50/80 text-sys-500 text-[10px] uppercase font-black tracking-widest border-b border-sys-200">
                                    <tr>
                                        <th className="px-6 py-4 whitespace-nowrap">Fecha / Hora</th>
                                        <th className="px-6 py-4 whitespace-nowrap">Producto</th>
                                        <th className="px-6 py-4 whitespace-nowrap">Tipo de Movimiento</th>
                                        <th className="px-6 py-4 whitespace-nowrap">Usuario / Doc</th>
                                        <th className="px-6 py-4 whitespace-nowrap text-right">Cantidad</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-sys-100 bg-white">
                                    {filteredData.map((mov) => {
                                        const style = TYPE_CONFIG[mov.type] || { label: mov.type, icon: AlertCircle, color: 'text-gray-500', bg: 'bg-gray-100', border: 'border-gray-200' };
                                        const Icon = style.icon;
                                        const isBudget = mov.type === 'BUDGET';

                                        return (
                                            <tr 
                                                key={mov.id} 
                                                className={cn(
                                                    "transition-colors group", 
                                                    isBudget ? "opacity-50 grayscale" : "",
                                                    mov.refId ? "hover:bg-brand/5 cursor-pointer" : "hover:bg-sys-50/50"
                                                )}
                                                onClick={() => handleViewDocument(mov)}
                                                title={mov.refId ? "Haga clic para ver el comprobante" : ""}
                                            >
                                                <td className="px-6 py-3">
                                                    <div className="font-bold text-sys-900">{mov.dateObj.toLocaleDateString()}</div>
                                                    <div className="text-[10px] text-sys-400 font-mono mt-0.5">{mov.dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                                                </td>
                                                <td className="px-6 py-3 max-w-[250px]">
                                                    <div className="flex flex-col">
                                                        <span className="font-black text-sys-800 text-xs truncate uppercase" title={mov.productName}>{mov.productName}</span>
                                                        <span className="text-[9px] font-mono text-sys-400 mt-0.5">{mov.productCode}</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-3">
                                                    <span className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[9px] font-bold uppercase border", style.bg, style.color, style.border)}>
                                                        <Icon size={12}/> {style.label}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-3 max-w-[200px]">
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="flex items-center gap-1 text-[10px] font-bold text-sys-600"><Users size={10}/> {mov.user}</span>
                                                        {mov.refId ? (
                                                            <span className="flex items-center gap-1 text-[9px] font-mono text-brand bg-brand/5 border border-brand/10 px-1.5 py-0.5 rounded truncate group-hover:underline" title={mov.refId}>
                                                                <LinkIcon size={8} className="shrink-0"/> DOC: {mov.refId.split('_').pop().toUpperCase()}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[9px] text-sys-400 italic truncate" title={mov.description}>{mov.description || 'Sin comprobante'}</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-3 text-right">
                                                    {mov.amount && (
                                                        <span className={cn("text-base font-black tracking-tight", isBudget ? "text-gray-400" : (mov.type.includes('OUT') || mov.amount < 0) ? "text-red-600" : "text-green-600")}>
                                                            {(mov.type.includes('OUT') || mov.amount < 0) ? '-' : '+'}{Math.abs(Number(mov.amount))}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div className="p-3 border-t border-sys-100 bg-sys-50/50 flex justify-between items-center text-[10px] font-bold text-sys-400">
                            <span>Mostrando {filteredData.length} movimientos de stock</span>
                        </div>
                    </Card>
                )}
            </div>

            {/* MODAL HISTORIAL PRODUCTO */}
            <ProductHistoryModal 
                productData={selectedProduct?.productData}
                movements={selectedProduct?.movements}
                onClose={() => setSelectedProduct(null)}
                onViewDocument={handleViewDocument}
            />

            {/* MODALES DE TRAZABILIDAD (TICKETS) */}
            <TicketModal 
                isOpen={selectedDocument?.type === 'sale'}
                sale={selectedDocument?.type === 'sale' ? selectedDocument.data : null}
                onClose={() => setSelectedDocument(null)}
                companyConfig={{ nombre: activeBranchName }}
            />

            <PurchaseTicketModal 
                isOpen={selectedDocument?.type === 'purchase'}
                purchase={selectedDocument?.type === 'purchase' ? selectedDocument.data : null}
                onClose={() => setSelectedDocument(null)}
            />
        </div>
    );
};