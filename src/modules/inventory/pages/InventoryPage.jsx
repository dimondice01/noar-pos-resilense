import React, { useEffect, useState, useRef, useMemo } from 'react';
// 🔥 Importamos useParams para capturar el slug de la empresa
import { useNavigate, useParams } from 'react-router-dom'; 
import { 
    Plus, Search, Edit2, Trash2, Package, AlertTriangle, 
    ArrowUpRight, Filter, CheckSquare, Square, X, History,
    Printer, ArrowRightLeft, Calendar, ChevronLeft, ChevronRight,
    Upload, RefreshCw, MoreVertical, Cloud, MapPin, 
    Tag, Percent, Megaphone, MoreHorizontal, LayoutGrid, DollarSign
} from 'lucide-react';

import { productRepository } from '../repositories/productRepository';
import { masterRepository } from '../repositories/masterRepository';
import { useAuthStore } from '../../auth/store/useAuthStore'; 

import { ProductModal } from '../components/ProductModal'; 
import { MastersModal } from '../components/MastersModal';
import { ImportMapperModal } from '../components/ImportMapperModal'; 
import { cn } from '../../../core/utils/cn';
import { Button } from '../../../core/ui/Button'; 

import { collection, getDocs, query, where, documentId } from 'firebase/firestore';
import { db as firestoreDB } from '../../../database/firebase';

// =================================================================
// 🧠 HELPER FUNCTIONS (NEXUS UTILS)
// =================================================================

const formatMoney = (amount) => {
    return amount ? amount.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '0';
};

const formatStock = (stock) => {
    if (stock === undefined || stock === null) return '0';
    return Number(stock) % 1 === 0 ? Number(stock).toFixed(0) : Number(stock).toFixed(3);
};

const getActivePromo = (product) => {
    if (!product.promo) return null;
    const now = new Date();
    const start = product.promo.startDate ? new Date(product.promo.startDate + 'T00:00:00') : null;
    const end = product.promo.endDate ? new Date(product.promo.endDate + 'T23:59:59') : null;
    
    if (start && end && now >= start && now <= end) {
        return product.promo;
    }
    return null;
};

// =================================================================
// 1. STOCK ENTRY MODAL (Ingreso Rápido)
// =================================================================
const StockEntryModal = ({ isOpen, onClose, product, onConfirm }) => {
    if (!isOpen || !product) return null;
    const [qty, setQty] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
    }, [isOpen]);

    const handleConfirm = () => {
        const val = parseFloat(qty);
        if (!val || val === 0) return alert("Ingrese una cantidad válida");
        onConfirm(product.id, val, "Ingreso Rápido Manual");
        setQty('');
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="p-4 bg-brand text-white flex justify-between items-center">
                    <h3 className="font-bold flex items-center gap-2"><Package size={18}/> Ajuste de Stock</h3>
                    <button onClick={onClose} className="hover:bg-white/20 p-1 rounded"><X size={18}/></button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <p className="text-xs text-sys-500 uppercase font-bold mb-1">Producto</p>
                        <p className="text-lg font-bold text-sys-900 leading-tight">{product.name}</p>
                    </div>
                    <div>
                        <label className="text-xs text-sys-500 uppercase font-bold mb-1 block">Cantidad (+/-)</label>
                        <input 
                            ref={inputRef}
                            type="number" 
                            className="w-full text-2xl font-black p-3 bg-sys-50 border-2 border-brand/20 rounded-xl focus:border-brand outline-none text-center"
                            placeholder="0"
                            value={qty}
                            onChange={e => setQty(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleConfirm()}
                        />
                        <p className="text-[10px] text-sys-400 mt-2 text-center">Use números negativos para restar stock</p>
                    </div>
                    <Button onClick={handleConfirm} className="w-full py-3 shadow-lg shadow-brand/20">Confirmar Ajuste</Button>
                </div>
             </div>
        </div>
    );
};

// =================================================================
// 2. BULK UPDATE MODAL
// =================================================================
const BulkUpdateModal = ({ isOpen, onClose, onConfirm, allProducts, masters, manualSelectionIds }) => {
    if (!isOpen) return null;
    const [activeTab, setActiveTab] = useState('manual');
    const [targetId, setTargetId] = useState('');
    const [costPct, setCostPct] = useState(0);
    const [pricePct, setPricePct] = useState(0);
    const [targetList, setTargetList] = useState([]);

    useEffect(() => {
        let list = [];
        if (activeTab === 'manual') list = allProducts.filter(p => manualSelectionIds.has(p.id));
        else if (activeTab === 'brand' && targetId) list = allProducts.filter(p => p.brand === targetId);
        else if (activeTab === 'category' && targetId) list = allProducts.filter(p => p.category === targetId);
        setTargetList(list);
    }, [activeTab, targetId, manualSelectionIds, allProducts]);

    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
          <div className="p-5 border-b border-sys-100 bg-sys-50 flex justify-between items-center shrink-0">
             <h3 className="font-bold text-lg text-sys-900 flex items-center gap-2"><ArrowUpRight className="text-brand" /> Actualización Masiva</h3>
             <button onClick={onClose}><X size={20} className="text-sys-400" /></button>
          </div>
          <div className="flex-1 overflow-hidden flex flex-col p-6">
             <div className="flex bg-sys-100 p-1 rounded-xl mb-4 shrink-0">
                {['manual', 'brand', 'category'].map(t => (
                    <button key={t} onClick={() => { setActiveTab(t); setTargetId(''); }} className={cn("flex-1 py-2 text-xs font-bold rounded-lg capitalize transition-all", activeTab === t ? "bg-white shadow text-sys-900" : "text-sys-500")}>
                        {t === 'manual' ? 'Selección' : t === 'brand' ? 'Marca' : 'Categoría'}
                    </button>
                ))}
             </div>
             <div className="shrink-0 mb-4">
                {activeTab === 'brand' && (
                    <select className="w-full p-3 border border-sys-200 rounded-xl text-sm bg-white outline-none focus:border-brand" onChange={(e) => setTargetId(e.target.value)}>
                        <option value="">Selecciona Marca...</option>
                        {masters.brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                    </select>
                )}
                {activeTab === 'category' && (
                    <select className="w-full p-3 border border-sys-200 rounded-xl text-sm bg-white outline-none focus:border-brand" onChange={(e) => setTargetId(e.target.value)}>
                        <option value="">Selecciona Categoría...</option>
                        {masters.categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                )}
             </div>
             <div className="flex-1 overflow-y-auto custom-scrollbar border border-sys-200 rounded-xl bg-sys-50 mb-4 relative">
                {targetList.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-sys-400 p-4 text-center"><Package size={32} className="mb-2 opacity-50"/><p className="text-xs">Sin productos afectados.</p></div>
                ) : (
                    <div className="divide-y divide-sys-200">
                        <div className="sticky top-0 bg-sys-100 p-2 text-xs font-bold text-sys-500 uppercase border-b border-sys-200 flex justify-between z-10">
                            <span>Producto ({targetList.length})</span><span>Precio Hoy</span>
                        </div>
                        {targetList.map(p => (
                            <div key={p.id} className="p-3 flex justify-between items-center bg-sys-50/50">
                                <div className="truncate flex-1 pr-2">
                                    <p className="text-sm font-medium text-sys-800 truncate">{p.name}</p>
                                    <p className="text-[10px] text-sys-400">{p.code}</p>
                                </div>
                                <span className="text-sm font-mono font-bold text-sys-600">$ {p.price}</span>
                            </div>
                        ))}
                    </div>
                )}
             </div>
             <div className="grid grid-cols-2 gap-4 pt-4 border-t border-sys-100 shrink-0">
                <div><label className="text-[10px] font-bold text-sys-500 uppercase block mb-1">Subir Costo</label><div className="relative"><input type="number" className="w-full p-2 pl-8 border border-sys-200 rounded-lg font-bold outline-none focus:border-brand" value={costPct} onChange={e => setCostPct(parseFloat(e.target.value) || 0)} /><span className="absolute left-3 top-2 text-sys-400">%</span></div></div>
                <div><label className="text-[10px] font-bold text-brand uppercase block mb-1">Subir Precio</label><div className="relative"><input type="number" className="w-full p-2 pl-8 border border-sys-200 rounded-lg font-bold text-brand bg-brand/5 outline-none focus:border-brand" value={pricePct} onChange={e => setPricePct(parseFloat(e.target.value) || 0)} /><span className="absolute left-3 top-2 text-brand">%</span></div></div>
             </div>
          </div>
          <div className="p-5 bg-sys-50 border-t border-sys-100 flex gap-3 shrink-0">
            <Button variant="ghost" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button onClick={() => onConfirm(targetList, costPct, pricePct)} className="flex-1 shadow-lg shadow-brand/20" disabled={targetList.length === 0 || (costPct === 0 && pricePct === 0)}>Aplicar Aumento</Button>
          </div>
        </div>
      </div>
    );
};

// =================================================================
// 🏭 MAIN PAGE: INVENTORY DASHBOARD
// =================================================================
export const InventoryPage = () => {
    const navigate = useNavigate();
    
    // 🔥 CAPTURA DE SLUG Y AUTH (SEGURIDAD)
    const { companySlug } = useParams();
    const { user, activeBranchId, activeBranchName } = useAuthStore(); 
    
    const isAdmin = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

    // Data States
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [masters, setMasters] = useState({ categories: [], brands: [], suppliers: [] });
    
    // Matrix Global State (Multi-Branch)
    const [branches, setBranches] = useState([]); 
    const [globalStock, setGlobalStock] = useState({}); 
    const [loadingStock, setLoadingStock] = useState(false);
    const lastFetchedIds = useRef(""); 

    // Search & Filter
    const [inputValue, setInputValue] = useState(''); 
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ category: '', brand: '' });
    const searchInputRef = useRef(null);

    // Selection & View State
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 25;

    // Modals
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [isMastersModalOpen, setIsMastersModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false); 
    const [isBulkUpdateOpen, setIsBulkUpdateOpen] = useState(false);
    
    const [editingProduct, setEditingProduct] = useState(null);
    const [stockEntryProduct, setStockEntryProduct] = useState(null);

    // =================================================================
    // 🔄 DATA LOADING & REFRESH
    // =================================================================

    const loadData = async () => {
        setLoading(true);
        try {
            const [allProducts, cats, brands, supps] = await Promise.all([
                productRepository.getAll(),
                masterRepository.getAll('categories'),
                masterRepository.getAll('brands'),
                masterRepository.getAll('suppliers')
            ]);
            
            lastFetchedIds.current = ""; 

            setProducts([...allProducts].sort((a,b) => a.name.localeCompare(b.name)));
            setMasters({ 
                categories: cats || [], 
                brands: brands || [], 
                suppliers: supps || [] 
            });

            if (isAdmin && user?.companyId) {
                 try {
                    const q = collection(firestoreDB, 'companies', user.companyId, 'branches');
                    const snap = await getDocs(q);
                    const branchesData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    setBranches(branchesData.sort((a,b) => (a.id === activeBranchId ? -1 : 1)));
                 } catch (e) { console.error("Error loading branches:", e); }
            } else {
                setBranches([{ id: activeBranchId, name: activeBranchName }]);
            }
        } catch (error) { 
            console.error("Error loading data", error); 
        } finally { 
            setLoading(false); 
        }
    };

    useEffect(() => { loadData(); }, [user, isAdmin, activeBranchId]);

    useEffect(() => {
        const timer = setTimeout(() => setSearchTerm(inputValue), 300);
        return () => clearTimeout(timer);
    }, [inputValue]);

    // =================================================================
    // 🔍 FILTERING & PAGINATION ENGINE
    // =================================================================

    const filteredProducts = useMemo(() => {
        const term = searchTerm.toLowerCase();
        return products.filter(p => {
            const name = (p.name || '').toLowerCase();
            const code = (p.code || '').toString().toLowerCase();
            const barcodeStr = Array.isArray(p.barcode) ? p.barcode.join(' ') : (p.barcode || '');
            
            const matchesSearch = name.includes(term) || code.includes(term) || barcodeStr.toLowerCase().includes(term);
            const matchesCat = filters.category ? p.category === filters.category : true;
            const matchesBrand = filters.brand ? p.brand === filters.brand : true;
            
            return matchesSearch && matchesCat && matchesBrand;
        });
    }, [products, searchTerm, filters]);

    const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
    const currentProducts = useMemo(() => {
        return filteredProducts.slice(
            (currentPage - 1) * ITEMS_PER_PAGE, 
            currentPage * ITEMS_PER_PAGE
        );
    }, [filteredProducts, currentPage]);

    // =================================================================
    // 🌐 GLOBAL MATRIX FETCHING
    // =================================================================
    
    useEffect(() => {
        if (!isAdmin || branches.length <= 1 || currentProducts.length === 0) return;

        const currentIdsString = currentProducts.map(p => p.id).sort().join(',');
        if (lastFetchedIds.current === currentIdsString) return;
        lastFetchedIds.current = currentIdsString;

        const fetchMatrix = async () => {
            setLoadingStock(true);
            const visibleIds = currentProducts.map(p => p.id);
            const newStockMap = { ...globalStock };

            const chunks = [];
            for (let i = 0; i < visibleIds.length; i += 10) {
                chunks.push(visibleIds.slice(i, i + 10));
            }

            try {
                const otherBranches = branches.filter(b => b.id !== activeBranchId);
                for (const branch of otherBranches) {
                    for (const chunk of chunks) {
                        const q = query(
                            collection(firestoreDB, 'companies', user.companyId, 'branches', branch.id, 'inventory'),
                            where(documentId(), 'in', chunk)
                        );
                        const snap = await getDocs(q);
                        
                        snap.docs.forEach(doc => {
                            const prodId = doc.id;
                            const data = doc.data();
                            if (!newStockMap[prodId]) newStockMap[prodId] = {};
                            newStockMap[prodId][branch.id] = data.stock;
                        });
                        
                        chunk.forEach(prodId => {
                             if (!newStockMap[prodId]) newStockMap[prodId] = {};
                             if (newStockMap[prodId][branch.id] === undefined) {
                                 newStockMap[prodId][branch.id] = 0;
                             }
                        });
                    }
                }
                setGlobalStock(newStockMap);
            } catch (e) { console.error("Matrix error:", e); } 
            finally { setLoadingStock(false); }
        };

        fetchMatrix();
    }, [currentProducts, branches, isAdmin]);

    // =================================================================
    // 🎮 HANDLERS
    // =================================================================

    const handleSaveProduct = async (productData) => {
        await productRepository.save(productData); 
        await loadData();
        setIsProductModalOpen(false);
    };

    const handleDelete = async (id) => {
        if (window.confirm("¿Confirma eliminación del Catálogo Global?")) {
            await productRepository.delete(id);
            loadData();
        }
    };

    const handleQuickStockEntry = async (productId, qty, reason) => {
        try {
            const userName = user?.name || user?.email || 'Sistema';
            await productRepository.addStock(productId, qty, reason, userName, activeBranchId);
            loadData();
        } catch (e) { console.error(e); }
    };

    const executeBulkUpdate = async (targetProducts, costPct, pricePct) => {
        if (targetProducts.length === 0) return alert("No hay productos seleccionados.");
        if (!window.confirm(`⚠️ CONFIRMACIÓN:\nSe actualizarán ${targetProducts.length} productos.\nCost: +${costPct}% | Precio: +${pricePct}%`)) return;
        setLoading(true);
        try {
            const updates = targetProducts.map(p => {
                const newCost = p.cost * (1 + costPct / 100);
                let calculatedPrice = p.price * (1 + pricePct / 100);
                const newPrice = Math.ceil(calculatedPrice / 50) * 50; 
                return { ...p, cost: newCost, price: newPrice }; 
            });
            for (const p of updates) { await productRepository.save(p); }
            alert(`✅ Éxito: ${updates.length} productos actualizados.`);
            setSelectedIds(new Set());
            setIsBulkUpdateOpen(false);
            loadData();
        } catch (error) { alert("Error al actualizar."); } 
        finally { setLoading(false); }
    };

    const toggleSelection = (id) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
        setSelectedIds(newSet);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === currentProducts.length && currentProducts.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(currentProducts.map(p => p.id)));
        }
    };

    // 🔥 FIX: Navegación Segura a Etiquetas
    // Usamos el slug capturado para no perder el contexto de la empresa
    const goToLabels = () => {
        const targetSlug = companySlug || activeBranchId || 'main';
        navigate(`/${targetSlug}/inventory/print-labels`);
    };

    const goToMovements = () => {
        const targetSlug = companySlug || activeBranchId || 'main';
        navigate(`/${targetSlug}/inventory/movements`);
    };

    return (
        <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-sys-50 relative">
            
            {/* MAIN CONTENT AREA */}
            <div className="flex-1 flex flex-col w-full">
                
                {/* HEADER (ACTIONS) */}
                <div className="px-6 py-5 bg-white border-b border-sys-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0 shadow-sm z-20">
                    <div>
                        <h1 className="text-2xl font-black text-sys-900 tracking-tight flex items-center gap-2">
                            <LayoutGrid className="text-brand" size={28} /> 
                            {isAdmin ? 'Inventario Global' : 'Mi Inventario'}
                        </h1>
                        <div className="flex items-center gap-3 text-[10px] font-bold text-sys-500 uppercase mt-1">
                            <span className="flex items-center gap-1 bg-sys-100 px-2 py-0.5 rounded text-sys-600 border border-sys-200">
                                <MapPin size={10}/> {activeBranchName}
                            </span>
                            <span className="text-sys-300">|</span>
                            <span>{filteredProducts.length} Items Visibles</span>
                        </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-2">
                        {/* 🔥 FIX: Botones con navegación segura */}
                        <Button variant="secondary" className="border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100" onClick={goToLabels}>
                            <Printer size={18} className="mr-2" /> Etiquetas
                        </Button>
                        <Button variant="secondary" className="border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100" onClick={goToMovements}>
                            <ArrowRightLeft size={18} className="mr-2" /> Movimientos
                        </Button>
                        
                        <div className="w-px h-8 bg-sys-200 mx-2 hidden md:block"></div>

                        <Button variant="secondary" onClick={() => setIsImportModalOpen(true)}>
                            <Upload size={18} className="mr-2"/> Importar
                        </Button>
                        {selectedIds.size > 0 && (
                            <Button variant="secondary" className="border-brand/30 text-brand bg-brand/5 hover:bg-brand/10" onClick={() => setIsBulkUpdateOpen(true)}>
                                <ArrowUpRight size={18} className="mr-2"/> Aumento Masivo ({selectedIds.size})
                            </Button>
                        )}
                        <Button variant="secondary" onClick={() => setIsMastersModalOpen(true)}>
                            <Filter size={18} className="mr-2"/> Maestros
                        </Button>
                        <Button onClick={() => { setEditingProduct(null); setIsProductModalOpen(true); }} className="shadow-lg shadow-brand/20 ml-2">
                            <Plus size={20} className="mr-2"/> Nuevo
                        </Button>
                    </div>
                </div>

                {/* FILTERS TOOLBAR */}
                <div className="px-6 py-3 bg-sys-50 border-b border-sys-200 flex gap-3 overflow-x-auto no-scrollbar items-center shrink-0">
                    <div className="relative w-72 group shrink-0">
                        <Search className="absolute left-3 top-2.5 text-sys-400 group-focus-within:text-brand transition-colors" size={16} />
                        <input 
                            ref={searchInputRef}
                            type="text" 
                            placeholder="Buscar código, nombre, barras..." 
                            className="w-full pl-9 pr-3 py-2 bg-white border border-sys-200 rounded-xl text-sm font-bold outline-none focus:border-brand shadow-sm transition-all focus:ring-4 focus:ring-brand/10"
                            value={inputValue} 
                            onChange={e => setInputValue(e.target.value)} 
                        />
                    </div>
                    
                    <select className="filter-select" value={filters.category} onChange={e => setFilters({...filters, category: e.target.value})}>
                        <option value="">Todas las Categorías</option>
                        {masters.categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                    
                    <select className="filter-select" value={filters.brand} onChange={e => setFilters({...filters, brand: e.target.value})}>
                        <option value="">Todas las Marcas</option>
                        {masters.brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                    </select>

                    {(filters.category || filters.brand) && (
                        <button onClick={() => setFilters({category:'', brand:''})} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100" title="Limpiar Filtros">
                            <X size={18} />
                        </button>
                    )}
                </div>

                {/* DATA TABLE */}
                <div className="flex-1 overflow-auto bg-white relative">
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-sys-50 z-10 shadow-sm">
                            <tr className="text-[10px] uppercase font-black text-sys-400 tracking-wider border-b border-sys-200">
                                <th className="p-3 w-10 text-center">
                                    <button onClick={toggleSelectAll} className="hover:text-brand transition-colors">
                                        {selectedIds.size === currentProducts.length && currentProducts.length > 0 ? <CheckSquare size={16} /> : <Square size={16} />}
                                    </button>
                                </th>
                                <th className="p-3 font-bold">Producto / SKU</th>
                                
                                {/* 🏢 COLUMNAS DINÁMICAS DE SUCURSALES */}
                                {branches.map(b => (
                                    <th key={b.id} className={cn("p-3 text-center border-l border-sys-100 min-w-[100px]", b.id === activeBranchId ? "bg-brand/5 text-brand" : "")}>
                                        {b.name}
                                    </th>
                                ))}

                                <th className="p-3 text-right border-l border-sys-100">Costo Neto</th>
                                <th className="p-3 text-right">Precio Final</th>
                                <th className="p-3 text-center w-20">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-sys-100">
                            {currentProducts.map(p => {
                                const promo = getActivePromo(p);
                                const isSelected = selectedIds.has(p.id);
                                
                                const isNegativeStock = p.stock < 0;
                                const isLowStock = p.stock <= (p.minStock || 5);
                                const hasMarginError = parseFloat(p.cost) > parseFloat(p.price);

                                return (
                                    <tr 
                                        key={p.id} 
                                        onClick={() => { setEditingProduct(p); setIsProductModalOpen(true); }}
                                        className={cn(
                                            "cursor-pointer transition-colors group h-[60px]",
                                            hasMarginError ? "bg-red-50 hover:bg-red-100" : "hover:bg-sys-50",
                                            isSelected ? "bg-brand/5" : ""
                                        )}
                                    >
                                        <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                                            <button onClick={() => toggleSelection(p.id)} className={cn("transition-colors", isSelected ? "text-brand" : "text-sys-300 hover:text-sys-500")}>
                                                {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                            </button>
                                        </td>

                                        {/* Info Producto */}
                                        <td className="p-3 max-w-[300px]">
                                            <div className="flex flex-col justify-center h-full relative">
                                                <span className="text-sm font-bold text-sys-900 truncate flex items-center gap-2" title={p.name}>
                                                    {p.name}
                                                    {hasMarginError && <AlertTriangle size={14} className="text-red-600 animate-pulse" title="Costo mayor a precio"/>}
                                                </span>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-[9px] font-mono text-sys-500 bg-sys-100 px-1.5 rounded border border-sys-200">{p.code || 'S/C'}</span>
                                                    {p.category && <span className="text-[9px] font-bold text-sys-500 bg-sys-50 px-1.5 rounded uppercase border border-sys-100">{p.category}</span>}
                                                </div>
                                            </div>
                                        </td>

                                        {/* 🏢 STOCK POR SUCURSAL */}
                                        {branches.map(b => {
                                            const isCurrent = b.id === activeBranchId;
                                            const stockVal = isCurrent ? p.stock : (globalStock[p.id]?.[b.id] || 0);
                                            const cellNegative = stockVal < 0;
                                            const cellLow = stockVal <= (p.minStock || 5);

                                            return (
                                                <td key={b.id} className={cn("p-3 text-center border-l border-sys-100", isCurrent ? "bg-brand/5" : "")}>
                                                    {(!isCurrent && loadingStock) ? (
                                                        <div className="w-4 h-1 bg-sys-200 rounded animate-pulse mx-auto"></div>
                                                    ) : (
                                                        <div className={cn(
                                                            "inline-flex items-center justify-center px-2 py-1 rounded-lg min-w-[3rem]", 
                                                            cellNegative ? "bg-red-600 text-white font-black" : 
                                                            cellLow ? "text-orange-600 bg-orange-50 font-bold" : 
                                                            "text-sys-700 font-medium"
                                                        )}>
                                                            {formatStock(stockVal)}
                                                        </div>
                                                    )}
                                                </td>
                                            );
                                        })}

                                        {/* Costo */}
                                        <td className="p-3 text-right border-l border-sys-100">
                                            <span className="text-xs font-medium text-sys-500">$ {formatMoney(p.cost)}</span>
                                        </td>

                                        {/* Precio (Con lógica Promo) */}
                                        <td className="p-3 text-right">
                                            {promo ? (
                                                <div className="flex flex-col items-end justify-center">
                                                    <span className="text-[10px] text-sys-400 line-through decoration-red-400 decoration-1">$ {formatMoney(p.price)}</span>
                                                    <span className="text-sm font-black text-purple-600 bg-purple-50 px-1.5 rounded border border-purple-100 shadow-sm flex items-center gap-1">
                                                        <Megaphone size={10}/> 
                                                        {promo.name || 'Promo'}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className={cn("text-sm font-bold", hasMarginError ? "text-red-600" : "text-sys-900")}>
                                                    $ {formatMoney(p.price)}
                                                </span>
                                            )}
                                        </td>

                                        {/* Actions */}
                                        <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex justify-center gap-2">
                                                <button onClick={() => setStockEntryProduct(p)} className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 hover:scale-110 transition-all border border-transparent hover:border-green-200" title="Ajuste Rápido">
                                                    <Package size={16}/>
                                                </button>
                                                <button onClick={() => { setEditingProduct(p); setIsProductModalOpen(true); }} className="p-1.5 rounded-lg text-brand hover:bg-brand/10 transition-all" title="Editar">
                                                    <Edit2 size={16}/>
                                                </button>
                                                {/* 🔥 Botón de eliminar solo para Admin */}
                                                {isAdmin && (
                                                    <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-all" title="Eliminar">
                                                        <Trash2 size={16}/>
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    
                    {currentProducts.length === 0 && !loading && (
                        <div className="flex flex-col items-center justify-center h-64 text-sys-400 opacity-50">
                            <Package size={48} strokeWidth={1}/>
                            <p className="mt-2 font-medium">No se encontraron productos</p>
                        </div>
                    )}
                </div>

                {/* PAGINATION */}
                {totalPages > 1 && (
                    <div className="p-3 bg-white border-t border-sys-200 flex justify-between items-center shrink-0 z-20">
                        <span className="text-xs text-sys-500 font-medium">
                            Página <b>{currentPage}</b> de <b>{totalPages}</b>
                        </span>
                        <div className="flex gap-1">
                            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-1.5 rounded hover:bg-sys-100 disabled:opacity-30 border border-sys-200"><ChevronLeft size={16}/></button>
                            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-1.5 rounded hover:bg-sys-100 disabled:opacity-30 border border-sys-200"><ChevronRight size={16}/></button>
                        </div>
                    </div>
                )}
            </div>

            {/* MODALES */}
            <ProductModal 
                isOpen={isProductModalOpen} 
                onClose={() => setIsProductModalOpen(false)} 
                productToEdit={editingProduct} 
                onSave={handleSaveProduct} 
            />
            <StockEntryModal 
                isOpen={!!stockEntryProduct}
                onClose={() => setStockEntryProduct(null)}
                product={stockEntryProduct}
                onConfirm={handleQuickStockEntry}
            />
            <BulkUpdateModal 
                isOpen={isBulkUpdateOpen}
                onClose={() => setIsBulkUpdateOpen(false)}
                onConfirm={executeBulkUpdate}
                allProducts={products}
                masters={masters}
                manualSelectionIds={selectedIds}
            />
            <MastersModal 
                isOpen={isMastersModalOpen} 
                onClose={() => setIsMastersModalOpen(false)} 
            />
            <ImportMapperModal 
                isOpen={isImportModalOpen} 
                onClose={() => setIsImportModalOpen(false)} 
                branchId={activeBranchId} 
                onSuccess={loadData}    
            />

            <style>{`
                .filter-select { 
                    @apply h-9 px-3 border border-sys-200 rounded-xl text-xs font-bold bg-white min-w-[140px] outline-none focus:border-brand cursor-pointer text-sys-700 shadow-sm hover:border-brand/30 transition-colors appearance-none; 
                }
                .no-scrollbar::-webkit-scrollbar { display: none; }
                .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            `}</style>
        </div>
    );
};