import React, { useEffect, useState, useMemo } from 'react';
import { 
    Search, Filter, ArrowDownLeft, ArrowUpRight, 
    History, DollarSign, Tag, AlertCircle, CheckCircle2, Package,
    BarChart3, List, Users, Calendar, Layers, X, MapPin
} from 'lucide-react';

// Repositorios y Stores
import { productRepository } from '../repositories/productRepository';
import { masterRepository } from '../../inventory/repositories/masterRepository'; 
import { useAuthStore } from '../../auth/store/useAuthStore';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

// ====================================================================
// 🎨 CONFIGURACIÓN VISUAL
// ====================================================================
const TYPE_CONFIG = {
  'PRICE_CHANGE': { label: 'Cambio Precio', icon: DollarSign, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
  'COST_CHANGE': { label: 'Cambio Costo', icon: Tag, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
  'STOCK_IN': { label: 'Ingreso Stock', icon: ArrowDownLeft, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
  'IN': { label: 'Ingreso Manual', icon: ArrowDownLeft, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
  'STOCK_ADJUST_IN': { label: 'Ajuste (+)', icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
  'STOCK_ADJUST_OUT': { label: 'Ajuste (-)', icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
  'OUT': { label: 'Salida Manual', icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
  'CREATION': { label: 'Alta Producto', icon: Package, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
  'STOCK_OUT': { label: 'Venta', icon: ArrowUpRight, color: 'text-sys-600', bg: 'bg-sys-100', border: 'border-sys-200' },
};

// ====================================================================
// SUB-COMPONENTE: MODAL HISTORIAL DE PRODUCTO
// ====================================================================
const ProductHistoryModal = ({ productData, movements, onClose }) => {
    if (!productData) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
                <div className="p-5 border-b border-sys-100 flex justify-between items-center bg-sys-50">
                    <div>
                        <h3 className="font-bold text-lg text-sys-900 leading-tight">{productData.name}</h3>
                        <p className="text-xs text-sys-500 font-mono mt-1">{productData.code}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-500"><X size={20}/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {movements.length === 0 ? (
                        <p className="text-center text-sys-400 py-10">Sin movimientos registrados.</p>
                    ) : (
                        movements.map(mov => {
                            const style = TYPE_CONFIG[mov.type] || { label: mov.type, icon: AlertCircle, color: 'text-gray-500', bg: 'bg-gray-100', border: 'border-gray-200' };
                            const Icon = style.icon;
                            return (
                                <div key={mov.id} className="flex items-center gap-3 p-3 bg-white border border-sys-100 rounded-xl">
                                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center border shrink-0", style.bg, style.color, style.border)}>
                                        <Icon size={16} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded border", style.bg, style.color, style.border)}>
                                                {style.label}
                                            </span>
                                            <span className="text-[10px] text-sys-400 font-mono">
                                                {mov.dateObj.toLocaleString()}
                                            </span>
                                        </div>
                                        <p className="text-xs text-sys-600 truncate">{mov.description || 'Sin descripción'}</p>
                                        <div className="flex items-center gap-2 mt-1 text-[10px] text-sys-400">
                                            <span className="flex items-center gap-1"><Users size={10} /> {mov.user || 'Sistema'}</span>
                                            {mov.branchId && <span className="flex items-center gap-1"><MapPin size={10} /> {mov.branchId}</span>}
                                        </div>
                                    </div>
                                    {mov.amount && (
                                        <div className="text-right pl-2 border-l border-sys-100 min-w-[60px]">
                                            <p className={cn("text-lg font-black", (mov.type.includes('OUT') || mov.amount < 0) ? 'text-red-600' : 'text-green-600')}>
                                                {(mov.type.includes('OUT') || mov.amount < 0) ? '-' : '+'}{Math.abs(Number(mov.amount))}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
                
                <div className="p-4 border-t border-sys-100 bg-sys-50 flex justify-end">
                    <Button onClick={onClose} variant="secondary">Cerrar</Button>
                </div>
            </div>
        </div>
    );
};

export const MovementsPage = () => {
    // ===================== ESTADOS =====================
    const { user, activeBranchId } = useAuthStore();
    const [data, setData] = useState([]);
    const [categories, setCategories] = useState([]);
    const [userList, setUserList] = useState([]); 
    const [loading, setLoading] = useState(true);
    
    // MODAL
    const [selectedProduct, setSelectedProduct] = useState(null); 

    // VISTA
    const [viewMode, setViewMode] = useState('aggregated'); 
    
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
                
                // 1. Cargar Datos Maestros
                const [allProducts, allCats] = await Promise.all([
                    productRepository.getAll(),
                    masterRepository.getAll('categories')
                ]);
                
                setCategories(allCats);

                // 2. Cargar Movimientos Masivos desde Dexie
                const { getDB } = await import('../../../database/db');
                const db = await getDB();
                
                let allMovements = [];

                // 🔥 LÓGICA MULTI-SUCURSAL
                if (user?.role === 'OWNER') {
                    // Owner ve TODO (o podría filtrar si activeBranchId !== 'ALL')
                    if (activeBranchId && activeBranchId !== 'ALL') {
                        allMovements = await db.movements.where('branchId').equals(activeBranchId).toArray();
                    } else {
                        allMovements = await db.movements.toArray();
                    }
                } else {
                    // Cajero/Admin solo ve su sucursal
                    if (activeBranchId) {
                        allMovements = await db.movements.where('branchId').equals(activeBranchId).toArray();
                    } else {
                        allMovements = []; // Sin sucursal asignada no ve nada
                    }
                }

                // 3. Enriquecer Movimientos
                const productMap = new Map(allProducts.map(p => [String(p.id), p])); 
                const uniqueUsers = new Set();

                const enrichedData = allMovements.map(mov => {
                    const product = productMap.get(String(mov.productId));
                    
                    let cleanUser = mov.user || 'Sistema';
                    if (cleanUser.toLowerCase() === 'admin') cleanUser = 'Sistema'; 
                    uniqueUsers.add(cleanUser);

                    // 🔥 FIX: Leemos el NOMBRE de la categoría directo del producto
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
    }, [user, activeBranchId]); // Recarga si cambia la sucursal o el usuario

    // ===================== LÓGICA DE FILTRADO =====================
    const filteredData = useMemo(() => {
        return data.filter(item => {
            // 1. Fecha
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

            // 2. Usuario
            if (filterUser !== 'ALL' && item.user !== filterUser) return false;

            // 3. Categoría
            if (filterCategory !== 'ALL' && item.categoryName !== filterCategory) return false;

            // 4. Búsqueda
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
            // Consideramos ventas o salidas para estadística de movimiento
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
            
            // Lógica de dirección basada en el tipo de movimiento
            const isOut = mov.type.includes('OUT') || qty < 0;

            if (isOut) {
                entry.soldQty += Math.abs(qty);
                // Solo sumamos revenue si es venta real, no ajuste
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

    // HANDLER PARA ABRIR MODAL
    const handleOpenProductHistory = (aggItem) => {
        setSelectedProduct({
            productData: { name: aggItem.name, code: aggItem.code },
            movements: aggItem.movementsList
        });
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
                        <p className="text-sys-500 text-sm mt-1">
                           {dateRange === 'TODAY' ? 'Mostrando actividad de HOY' : 'Historial de movimientos'}
                           {activeBranchId && activeBranchId !== 'ALL' && <span className="ml-2 font-bold text-brand">• Sucursal: {activeBranchId}</span>}
                        </p>
                    </div>
                    <div className="bg-white px-5 py-2 rounded-xl border border-sys-200 shadow-sm flex items-center gap-4">
                        <div className="text-right">
                            <p className="text-[10px] text-sys-400 font-bold uppercase">Movimientos Totales</p>
                            <p className="text-2xl font-black text-sys-900 leading-none">
                                {filteredData.length.toLocaleString('es-AR')}
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
                            placeholder="Buscar producto..." 
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
                            <button onClick={() => setViewMode('aggregated')} className={cn("px-2 py-1.5 rounded-md transition-all flex items-center gap-2 text-xs font-bold", viewMode === 'aggregated' ? "bg-brand text-white shadow-md" : "text-sys-500 hover:bg-sys-50")} title="Ver Totales"><BarChart3 size={16} /></button>
                            <button onClick={() => setViewMode('list')} className={cn("px-2 py-1.5 rounded-md transition-all flex items-center gap-2 text-xs font-bold", viewMode === 'list' ? "bg-brand text-white shadow-md" : "text-sys-500 hover:bg-sys-50")} title="Ver Detalle"><List size={16} /></button>
                        </div>
                    </div>
                </Card>
            </div>

            <div className="min-h-[300px]">
                {loading ? (
                    <div className="text-center py-20 text-sys-400">
                        <div className="animate-spin rounded-full h-8 w-8 border-4 border-sys-200 border-t-brand mx-auto mb-3"></div>
                        <p className="text-xs">Analizando movimientos...</p>
                    </div>
                ) : filteredData.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-sys-200">
                        <div className="w-16 h-16 bg-sys-50 rounded-full flex items-center justify-center mx-auto mb-3 text-sys-300"><Filter size={32} /></div>
                        <p className="text-sys-500 font-medium">Sin movimientos encontrados</p>
                    </div>
                ) : viewMode === 'aggregated' ? (
                    
                    /* VISTA AGREGADA */
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
                    
                    /* VISTA LISTA DETALLADA */
                    <div className="space-y-2 animate-in slide-in-from-bottom-2 duration-300">
                        {filteredData.map((mov) => {
                           const style = TYPE_CONFIG[mov.type] || { label: mov.type, icon: AlertCircle, color: 'text-gray-500', bg: 'bg-gray-100', border: 'border-gray-200' };
                           const Icon = style.icon;
                           return (
                             <div key={mov.id} className="group bg-white rounded-lg p-2.5 border border-sys-100 hover:border-brand/20 hover:shadow-sm transition-all flex items-center gap-3">
                               <div className={cn("w-8 h-8 rounded-full flex items-center justify-center border shrink-0", style.bg, style.color, style.border)}>
                                  <Icon size={14} />
                               </div>
                               <div className="w-20 shrink-0 hidden sm:block">
                                  <p className="text-[10px] font-bold text-sys-900">{mov.dateObj.toLocaleDateString()}</p>
                                  <p className="text-[9px] text-sys-400 font-mono">{mov.dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                               </div>
                               <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-0.5">
                                     <span className={cn("text-[8px] font-bold uppercase px-1 py-0.5 rounded border leading-none", style.bg, style.color, style.border)}>
                                       {style.label}
                                     </span>
                                     <span className="text-[9px] text-sys-400 flex items-center gap-1">
                                       <Users size={8}/> {mov.user}
                                     </span>
                                     {mov.branchId && <span className="text-[9px] font-bold text-brand bg-brand/5 px-1 rounded flex items-center gap-0.5"><MapPin size={8}/> {mov.branchId}</span>}
                                  </div>
                                  <h4 className="text-xs font-bold text-sys-800 truncate" title={mov.productName}>{mov.productName}</h4>
                               </div>
                               {mov.amount && (
                                 <div className="text-right pl-3 border-l border-sys-100 min-w-[70px]">
                                    <span className={cn("text-sm font-black tracking-tight", (mov.type.includes('OUT') || mov.amount < 0) ? "text-red-600" : "text-green-600")}>
                                      {(mov.type.includes('OUT') || mov.amount < 0) ? '-' : '+'}{Math.abs(Number(mov.amount))}
                                    </span>
                                 </div>
                               )}
                             </div>
                           );
                        })}
                    </div>
                )}
            </div>

            <ProductHistoryModal 
                productData={selectedProduct?.productData}
                movements={selectedProduct?.movements}
                onClose={() => setSelectedProduct(null)}
            />
        </div>
    );
};