import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom'; 
import { 
    Plus, Search, Edit2, Trash2, Package, AlertTriangle, 
    ArrowUpRight, Filter, CheckSquare, Square, X, History,
    Printer, ArrowRightLeft, Calendar, ChevronLeft, ChevronRight,
    Upload, RefreshCw, MoreVertical, Cloud, MapPin, 
    Tag, Percent, Megaphone, MoreHorizontal, LayoutGrid, DollarSign,
    CalendarClock, Info, Scale, Save, Pencil
} from 'lucide-react';
import toast from 'react-hot-toast'; 

import { productRepository } from '../repositories/productRepository';
import { masterRepository } from '../repositories/masterRepository';
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import { syncService } from '../../sync/services/syncService'; 
import { scaleService } from '../services/scaleService'; 

import { ProductModal } from '../components/ProductModal'; 
import { MastersModal } from '../components/MastersModal';
import { ImportMapperModal } from '../components/ImportMapperModal'; 
import { cn } from '../../../core/utils/cn';
import { Button } from '../../../core/ui/Button'; 

import { collection, getDocs, query, where, documentId } from 'firebase/firestore';
import { db as firestoreDB } from '../../../database/firebase';
import { getDB } from '../../../database/db'; 

// =================================================================
// 🧠 HELPER FUNCTIONS
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

const getLocalDate = () => {
    return new Date().toLocaleDateString('sv-SE'); 
};

// =================================================================
// ⌨️ COMPONENTE CELDA EDITABLE (AUDITORÍA RÁPIDA)
// =================================================================
const EditableCell = ({ 
    value, 
    id, 
    field, 
    productId, 
    onSave, 
    type = "text", 
    prefix = "",
    disabled = false,
    nextRowId = null,
    prevRowId = null,
    className
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [localValue, setLocalValue] = useState(value);
    const inputRef = useRef(null);

    useEffect(() => { setLocalValue(value); }, [value]);

    useEffect(() => {
        if (isEditing && !disabled && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing, disabled]);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            inputRef.current.blur(); // Dispara onBlur -> Save
        }
        // Navegación estilo Excel
        if (e.key === 'ArrowDown' && nextRowId) {
            e.preventDefault();
            const nextEl = document.getElementById(`cell-${nextRowId}-${field}`);
            if (nextEl && !disabled) nextEl.click();
        }
        if (e.key === 'ArrowUp' && prevRowId) {
            e.preventDefault();
            const prevEl = document.getElementById(`cell-${prevRowId}-${field}`);
            if (prevEl && !disabled) prevEl.click();
        }
    };

    const handleBlur = () => {
        setIsEditing(false);
        // Solo guardar si cambió el valor y no está deshabilitado
        if (!disabled && localValue != value) {
            onSave(productId, field, localValue);
        }
    };

    if (disabled || !isEditing) {
        return (
            <div 
                id={`cell-${productId}-${field}`}
                onClick={() => !disabled && setIsEditing(true)}
                className={cn(
                    "p-2 rounded transition-colors text-right border border-transparent",
                    !disabled && "cursor-pointer hover:bg-sys-100 hover:border-sys-200",
                    disabled && "cursor-default text-sys-500",
                    className
                )}
            >
                <span className="font-mono text-xs font-bold">
                    {prefix}{type === 'number' ? (field === 'stock' ? formatStock(localValue) : formatMoney(localValue)) : localValue}
                </span>
            </div>
        );
    }

    return (
        <div className="p-1">
            <input
                ref={inputRef}
                type={type}
                className="w-full h-8 text-xs font-bold border-2 border-brand rounded px-1 outline-none text-right bg-white shadow-lg"
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
            />
        </div>
    );
};

// =================================================================
// 1. STOCK ENTRY MODAL
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
// 2. SCALE EXPORT MODAL (KRETZ / SYSTEL) 🔥
// =================================================================
const ScaleExportModal = ({ isOpen, onClose, onExport }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
                <div className="p-6 border-b border-sys-100 bg-sys-50 flex justify-between items-center">
                    <div>
                        <h3 className="font-black text-xl text-sys-900 flex items-center gap-2">
                            <Scale className="text-brand" /> Exportar a Balanza
                        </h3>
                        <p className="text-xs text-sys-500 mt-1">Seleccione el modelo para generar el archivo</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full"><X size={20} className="text-sys-400"/></button>
                </div>
                <div className="p-6 grid grid-cols-2 gap-4">
                    <button 
                        onClick={() => onExport('KRETZ')}
                        className="flex flex-col items-center justify-center gap-3 p-6 border-2 border-sys-200 rounded-2xl hover:border-brand hover:bg-brand/5 hover:scale-[1.02] transition-all group"
                    >
                        <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center group-hover:bg-brand group-hover:text-white transition-colors">
                            <Scale size={24} />
                        </div>
                        <span className="font-black text-sys-800">KRETZ</span>
                        <span className="text-[10px] text-sys-400 font-mono bg-sys-100 px-2 py-1 rounded">iTegra / Report</span>
                    </button>

                    <button 
                        onClick={() => onExport('SYSTEL')}
                        className="flex flex-col items-center justify-center gap-3 p-6 border-2 border-sys-200 rounded-2xl hover:border-purple-500 hover:bg-purple-50 hover:scale-[1.02] transition-all group"
                    >
                        <div className="w-12 h-12 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center group-hover:bg-purple-600 group-hover:text-white transition-colors">
                            <Scale size={24} />
                        </div>
                        <span className="font-black text-sys-800">SYSTEL</span>
                        <span className="text-[10px] text-sys-400 font-mono bg-sys-100 px-2 py-1 rounded">Qendra / Cuora</span>
                    </button>
                </div>
                <div className="px-6 pb-6 text-center">
                    <p className="text-[10px] text-sys-400 bg-yellow-50 text-yellow-700 p-2 rounded-lg border border-yellow-100">
                        ⚠️ Al descargar, guarde el archivo en la carpeta monitoreada por el software de la balanza.
                    </p>
                </div>
            </div>
        </div>
    );
};

// =================================================================
// 3. BULK UPDATE MODAL
// =================================================================
const BulkUpdateModal = ({ isOpen, onClose, onConfirm, allProducts, masters, manualSelectionIds }) => {
    if (!isOpen) return null;
    const [activeTab, setActiveTab] = useState('manual');
    const [targetId, setTargetId] = useState('');
    const [costPct, setCostPct] = useState(0);
    const [pricePct, setPricePct] = useState(0);
    const [targetList, setTargetList] = useState([]);
    
    // Estado para programación
    const [activationDate, setActivationDate] = useState('');
    const [isScheduled, setIsScheduled] = useState(false);

    useEffect(() => {
        let list = [];
        if (activeTab === 'manual') list = allProducts.filter(p => manualSelectionIds.has(p.id));
        else if (activeTab === 'brand' && targetId) list = allProducts.filter(p => p.brand === targetId);
        else if (activeTab === 'category' && targetId) list = allProducts.filter(p => p.category === targetId);
        setTargetList(list);
    }, [activeTab, targetId, manualSelectionIds, allProducts]);

    const todayStr = getLocalDate();

    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
          
          {/* HEADER */}
          <div className="p-5 border-b border-sys-100 bg-sys-50 flex justify-between items-center shrink-0">
             <div>
                <h3 className="font-black text-xl text-sys-900 flex items-center gap-2"><ArrowUpRight className="text-brand" /> Actualización Masiva</h3>
                <p className="text-[10px] text-sys-500 font-bold uppercase tracking-wider">Afectará a {targetList.length} productos</p>
             </div>
             <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full transition-colors"><X size={20} className="text-sys-400" /></button>
          </div>

          {/* BODY */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
             <div className="flex bg-sys-100 p-1.5 rounded-2xl shrink-0">
                {['manual', 'brand', 'category'].map(t => (
                    <button 
                        key={t} 
                        onClick={() => { setActiveTab(t); setTargetId(''); }} 
                        className={cn("flex-1 py-2.5 text-xs font-black rounded-xl capitalize transition-all", 
                        activeTab === t ? "bg-white shadow-lg text-brand scale-[1.02]" : "text-sys-500 hover:text-sys-700")}
                    >
                        {t === 'manual' ? 'Seleccionados' : t === 'brand' ? 'Por Marca' : 'Por Categoría'}
                    </button>
                ))}
             </div>

             <div className="shrink-0">
                {activeTab === 'brand' && (
                    <select className="w-full p-3.5 border-2 border-sys-100 rounded-2xl text-sm font-bold bg-white outline-none focus:border-brand transition-all" onChange={(e) => setTargetId(e.target.value)}>
                        <option value="">Selecciona una Marca...</option>
                        {masters.brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                    </select>
                )}
                {activeTab === 'category' && (
                    <select className="w-full p-3.5 border-2 border-sys-100 rounded-2xl text-sm font-bold bg-white outline-none focus:border-brand transition-all" onChange={(e) => setTargetId(e.target.value)}>
                        <option value="">Selecciona una Categoría...</option>
                        {masters.categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                )}
             </div>

             <div className="grid grid-cols-2 gap-4 shrink-0">
                <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-sys-400 uppercase ml-1">Subir Costo %</label>
                    <div className="relative">
                        <Percent className="absolute left-3 top-3 text-sys-300" size={16}/>
                        <input type="number" className="w-full p-3 pl-9 border-2 border-sys-100 rounded-2xl font-bold outline-none focus:border-sys-400 transition-all" value={costPct} onChange={e => setCostPct(parseFloat(e.target.value) || 0)} />
                    </div>
                </div>
                <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-brand uppercase ml-1">Subir Precio %</label>
                    <div className="relative">
                        <Percent className="absolute left-3 top-3 text-brand/40" size={16}/>
                        <input type="number" className="w-full p-3 pl-9 border-2 border-brand/10 bg-brand/5 rounded-2xl font-black text-brand outline-none focus:border-brand transition-all" value={pricePct} onChange={e => setPricePct(parseFloat(e.target.value) || 0)} />
                    </div>
                </div>
             </div>

             <div className={cn("p-4 rounded-2xl border-2 transition-all cursor-pointer select-none shrink-0", isScheduled ? "bg-orange-50 border-orange-300 ring-2 ring-orange-100" : "bg-white border-sys-200 hover:bg-sys-50")} onClick={() => setIsScheduled(!isScheduled)}>
                <div className="flex items-center gap-3">
                    <div className={cn("w-6 h-6 rounded-md flex items-center justify-center border-2 transition-colors shrink-0", isScheduled ? "bg-orange-500 border-orange-500 text-white" : "bg-white border-sys-300 text-transparent")}>
                        <CheckSquare size={16} fill="currentColor" />
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <CalendarClock size={18} className={cn(isScheduled ? "text-orange-600" : "text-sys-400")} />
                            <span className={cn("text-sm font-bold", isScheduled ? "text-orange-800" : "text-sys-600")}>
                                Programar para fecha futura
                            </span>
                        </div>
                    </div>
                </div>
                
                {isScheduled && (
                    <div className="mt-4 pt-3 border-t border-orange-200" onClick={(e) => e.stopPropagation()}>
                        <label className="text-[10px] font-bold text-orange-700 uppercase mb-1.5 block">Fecha de Aplicación</label>
                        <input 
                            type="date" 
                            className="w-full p-3 border-2 border-orange-300 rounded-xl font-bold text-sm outline-none focus:border-orange-500 bg-white text-orange-900 shadow-sm"
                            min={todayStr}
                            value={activationDate}
                            onChange={e => setActivationDate(e.target.value)}
                        />
                        <div className="flex gap-2 mt-3 p-2 bg-white/60 rounded-lg border border-orange-100">
                            <Info size={14} className="text-orange-500 shrink-0 mt-0.5" /> 
                            <p className="text-[10px] text-orange-800 font-medium leading-tight">
                                {activationDate === todayStr 
                                    ? "⚠️ ATENCIÓN: Si eliges HOY, el precio cambiará AHORA MISMO." 
                                    : "Los precios se actualizarán automáticamente al comenzar ese día."
                                }
                            </p>
                        </div>
                    </div>
                )}
             </div>

             <div className="border border-sys-200 rounded-xl bg-sys-50 overflow-hidden shrink-0">
                <div className="bg-sys-100 p-2 text-xs font-bold text-sys-500 uppercase border-b border-sys-200 flex justify-between">
                    <span>Muestra (Primeros 50)</span><span>Proyección</span>
                </div>
                <div className="max-h-40 overflow-y-auto divide-y divide-sys-200 custom-scrollbar">
                    {targetList.length === 0 ? (
                        <div className="p-6 text-center text-sys-400 text-xs">Sin selección</div>
                    ) : (
                        targetList.slice(0, 50).map(p => {
                             const calculatedPrice = p.price * (1 + pricePct / 100);
                             const newPrice = Math.ceil(calculatedPrice / 10) * 10;
                             return (
                                <div key={p.id} className="p-3 flex justify-between items-center bg-white hover:bg-sys-50">
                                    <div className="truncate flex-1 pr-2">
                                        <p className="text-xs font-bold text-sys-800 truncate">{p.name}</p>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-[10px] line-through text-sys-400 mr-2">${p.price}</span>
                                        <span className="text-xs font-mono font-black text-brand">${newPrice}</span>
                                    </div>
                                </div>
                            )
                        })
                    )}
                </div>
             </div>

          </div>

          {/* FOOTER */}
          <div className="p-6 bg-sys-50 border-t border-sys-100 flex gap-3 shrink-0">
            <Button variant="ghost" onClick={onClose} className="flex-1 rounded-2xl h-12 font-bold">Cancelar</Button>
            <Button 
                onClick={() => onConfirm(targetList, costPct, pricePct, isScheduled ? activationDate : null)} 
                className={cn(
                    "flex-1 shadow-xl rounded-2xl h-12 font-black transition-all",
                    isScheduled ? "bg-orange-600 hover:bg-orange-700 shadow-orange-200 text-white" : "bg-brand hover:bg-brand-dark shadow-brand/20 text-white"
                )} 
                disabled={targetList.length === 0 || (costPct === 0 && pricePct === 0) || (isScheduled && !activationDate)}
            >
                {isScheduled && activationDate > todayStr ? 'CONFIRMAR PROGRAMACIÓN' : 'APLICAR AHORA'}
            </Button>
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
    const { companySlug } = useParams();
    const { user, activeBranchId, activeBranchName } = useAuthStore(); 
    const isAdmin = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
    const isOwner = user?.role === 'OWNER'; 

    // Data States
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [masters, setMasters] = useState({ categories: [], brands: [], suppliers: [] });
    
    // Matrix Global State
    const [branches, setBranches] = useState([]); 
    const [globalStock, setGlobalStock] = useState({}); 
    const [loadingStock, setLoadingStock] = useState(false);
    
    // Search & Filter
    const [inputValue, setInputValue] = useState(''); 
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ category: '', brand: '' });
    const searchInputRef = useRef(null);

    // Selection & View State
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [currentPage, setCurrentPage] = useState(1);
    const [isEditMode, setIsEditMode] = useState(false); // 🔥 PROTECCIÓN DE EDICIÓN
    const ITEMS_PER_PAGE = 25;

    // Modals
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [isMastersModalOpen, setIsMastersModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false); 
    const [isBulkUpdateOpen, setIsBulkUpdateOpen] = useState(false);
    const [isScaleModalOpen, setIsScaleModalOpen] = useState(false);
    
    const [editingProduct, setEditingProduct] = useState(null);
    const [stockEntryProduct, setStockEntryProduct] = useState(null);

    // 🔥 REFERENCE TRICK: Mantiene los productos frescos dentro del EventListener
    const productsRef = useRef([]); 
    useEffect(() => { productsRef.current = products; }, [products]);

    // =================================================================
    // 🔍 GLOBAL SCANNER LISTENER (Scanner Inteligente) 🔥
    // =================================================================
    useEffect(() => {
        let buffer = '';
        let lastKeyTime = Date.now();

        const handleGlobalScan = (e) => {
            // Ignorar si el foco está en un input
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

            const now = Date.now();
            // Aumentamos tolerancia para lectores lentos o bluetooth
            if (now - lastKeyTime > 200) buffer = ''; 
            lastKeyTime = now;

            if (e.key === 'Enter') {
                // Buffer mínimo para evitar falsos positivos
                if (buffer.length > 2) { 
                    handleScannerMatch(buffer);
                    buffer = '';
                }
            } else if (e.key.length === 1) {
                buffer += e.key;
            }
        };

        window.addEventListener('keydown', handleGlobalScan);
        return () => window.removeEventListener('keydown', handleGlobalScan);
    }, []); 

    const handleScannerMatch = (code) => {
        const currentProducts = productsRef.current; 
        const product = currentProducts.find(p => p.code === code || (Array.isArray(p.barcode) && p.barcode.includes(code)) || p.barcode === code);
        
        if (product) {
            // ✅ EXISTE: MODO EDICIÓN
            setEditingProduct(product);
            setIsProductModalOpen(true);
            toast.success("Producto encontrado: " + product.name);
        } else {
            // 🆕 NO EXISTE: MODO CREACIÓN (PRECARGADO)
            // Se envía un objeto limpio con solo los códigos para que el Modal lo tome como nuevo
            setEditingProduct({ code: code, barcode: [code], isNew: true }); 
            setIsProductModalOpen(true);
            toast("Nuevo producto detectado", { icon: '✨' });
        }
    };

    // =================================================================
    // 🔄 DATA LOADING
    // =================================================================

    const loadData = async () => {
        setLoading(true);
        try {
            const [branchProducts, cats, brands, supps] = await Promise.all([
                productRepository.getAllByBranch(activeBranchId), 
                masterRepository.getAll('categories'),
                masterRepository.getAll('brands'),
                masterRepository.getAll('suppliers')
            ]);
            
            setProducts([...branchProducts].sort((a,b) => a.name.localeCompare(b.name)));
            setMasters({ categories: cats || [], brands: brands || [], suppliers: supps || [] });

            if (isAdmin && user?.companyId) {
                 try {
                    const dbLocal = await getDB();
                    let branchesData = await dbLocal.branches.toArray();
                    
                    if (branchesData.length === 0 && navigator.onLine) {
                        const q = collection(firestoreDB, 'companies', user.companyId, 'branches');
                        const snap = await getDocs(q);
                        branchesData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                        await dbLocal.branches.bulkPut(branchesData);
                    }
                    setBranches(branchesData.sort((a,b) => (a.id === activeBranchId ? -1 : 1)));
                    
                    if (isOwner) loadGlobalStock(branchesData, branchProducts);

                 } catch (e) { console.error("Error loading branches:", e); }
            } else {
                setBranches([{ id: activeBranchId, name: activeBranchName }]);
            }
        } catch (error) { console.error(error); } finally { setLoading(false); }
    };

    const loadGlobalStock = async (allBranches, allProducts) => {
        setLoadingStock(true);
        try {
            const dbLocal = await getDB();
            const stockMatrix = {};
            await Promise.all(allBranches.map(async (branch) => {
                const branchInv = await dbLocal.inventory.where('branchId').equals(branch.id).toArray();
                branchInv.forEach(item => {
                    if (!stockMatrix[item.productId]) stockMatrix[item.productId] = {};
                    stockMatrix[item.productId][branch.id] = parseFloat(item.stock) || 0;
                });
            }));
            setGlobalStock(stockMatrix);
        } catch (e) { console.error("Error loading global stock:", e); }
        finally { setLoadingStock(false); }
    };

    const handleForceSync = async () => {
        if (!isOwner) return;
        const toastId = toast.loading("Sincronizando inventario global...");
        try {
            await syncService.syncInitialData(user, 'ALL'); 
            await loadData();
            toast.success("Inventario actualizado de la nube", { id: toastId });
        } catch (e) {
            toast.error("Error al sincronizar", { id: toastId });
        }
    };

    const handleScaleExport = (brand) => {
        try {
            const weighableProducts = products.filter(p => p.isWeighable);
            
            if (weighableProducts.length === 0) {
                toast.error("No hay productos marcados como 'Pesable' en esta sucursal.");
                return;
            }

            const fileContent = scaleService.generateScaleFile(weighableProducts, brand);
            scaleService.downloadFile(fileContent, brand);
            
            toast.success(`Exportado para ${brand}: ${weighableProducts.length} productos.`);
            setIsScaleModalOpen(false);
        } catch (e) {
            console.error(e);
            toast.error("Error exportando balanza: " + e.message);
        }
    };

    // 🔥 HANDLER PARA EDICIÓN INLINE (AUDITORÍA)
    const handleInlineSave = async (productId, field, newValue) => {
        try {
            const product = products.find(p => p.id === productId);
            if (!product) return;

            let updates = {};
            let numValue = parseFloat(newValue);

            if (field === 'stock') {
                await productRepository.addStock(productId, numValue - (product.stock || 0), "Ajuste Auditoría Inline", user?.name || "Auditor", activeBranchId);
            } else {
                if (isNaN(numValue)) return;
                updates[field] = numValue;
                await productRepository.update(productId, updates);
            }
            
            setProducts(prev => prev.map(p => {
                if (p.id === productId) {
                    return { ...p, ...updates, ...(field === 'stock' ? { stock: numValue } : {}) };
                }
                return p;
            }));
            
            toast.success(`${field.toUpperCase()} actualizado`, { position: 'bottom-right', duration: 1000 });
        } catch (e) {
            console.error(e);
            toast.error("Error al guardar cambio");
            loadData(); 
        }
    };

    useEffect(() => { loadData(); }, [user, activeBranchId]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setSearchTerm(inputValue);
            setCurrentPage(1);
        }, 300);
        return () => clearTimeout(timer);
    }, [inputValue]);

    // =================================================================
    // 🔍 FILTERING & PAGINATION
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
        return filteredProducts.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
    }, [filteredProducts, currentPage]);

    const toggleSelection = (id) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
        setSelectedIds(newSet);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size >= filteredProducts.length && filteredProducts.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredProducts.map(p => p.id)));
            toast.success(`Seleccionados ${filteredProducts.length} productos`);
        }
    };

    // =================================================================
    // 🚀 HANDLERS
    // =================================================================

    const handleSaveProduct = async (masterPayload, promoPayload) => {
        const savedProduct = await productRepository.save(masterPayload);
        if (promoPayload) await productRepository.setPromotion(savedProduct.id, promoPayload);
        else if (promoPayload === null && activeBranchId) await productRepository.setPromotion(savedProduct.id, null);
        await loadData();
        setIsProductModalOpen(false);
    };

    const handleQuickStockEntry = async (productId, qty, reason) => {
        try {
            const userName = user?.name || user?.email || 'Sistema';
            await productRepository.addStock(productId, qty, reason, userName, activeBranchId);
            loadData();
        } catch (e) { console.error(e); }
    };

    const executeBulkUpdate = async (targetProducts, costPct, pricePct, activationDate = null) => {
        if (targetProducts.length === 0) return alert("No hay productos seleccionados.");
        const todayStr = getLocalDate(); 
        const isFutureScheduled = activationDate && activationDate > todayStr;
        const confirmMsg = isFutureScheduled
            ? `⚠️ ¿Programar aumento para el ${activationDate}?\nAfectará a ${targetProducts.length} productos.`
            : `⚠️ ¿Aplicar aumento INMEDIATO?\nAfectará a ${targetProducts.length} productos.`;

        if (!window.confirm(confirmMsg)) return;

        setLoading(true);
        try {
            for (const p of targetProducts) {
                const newCost = p.cost * (1 + costPct / 100);
                const calculatedPrice = p.price * (1 + pricePct / 100);
                const roundedPrice = Math.ceil(calculatedPrice / 10) * 10; 
                const productUpdate = { ...p };

                if (isFutureScheduled) {
                    productUpdate.nextPrice = roundedPrice;
                    productUpdate.nextCost = newCost;
                    productUpdate.priceActivationDate = activationDate;
                    productUpdate.syncStatus = 'pending';
                } else {
                    productUpdate.cost = newCost;
                    productUpdate.price = roundedPrice;
                    productUpdate.nextPrice = null;
                    productUpdate.nextCost = null;
                    productUpdate.priceActivationDate = null;
                    productUpdate.syncStatus = 'pending';
                }
                await productRepository.save(productUpdate);
            }
            toast.success(isFutureScheduled ? "Precios programados con éxito" : "Precios actualizados inmediatamente");
            setSelectedIds(new Set());
            setIsBulkUpdateOpen(false);
            loadData();
        } catch (error) { toast.error("Error en proceso masivo"); } finally { setLoading(false); }
    };

    const goToLabels = () => navigate(`/${companySlug}/inventory/print-labels`);
    const goToMovements = () => navigate(`/${companySlug}/inventory/movements`);

    return (
        <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-sys-50 relative">
            <div className="flex-1 flex flex-col w-full">
                
                {/* ACTIONS HEADER */}
                <div className="px-6 py-5 bg-white border-b border-sys-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0 shadow-sm z-20">
                    <div>
                        <h1 className="text-2xl font-black text-sys-900 tracking-tight flex items-center gap-2">
                            <LayoutGrid className="text-brand" size={28} /> Inventario Global
                        </h1>
                        <div className="flex items-center gap-3 text-[10px] font-bold text-sys-500 uppercase mt-1">
                            <span className="flex items-center gap-1 bg-sys-100 px-2 py-0.5 rounded text-sys-600 border border-sys-200">
                                <MapPin size={10}/> {activeBranchName}
                            </span>
                            <span className="text-sys-300">|</span>
                            <span>{filteredProducts.length} filtrados</span>
                            {selectedIds.size > 0 && (
                                <span className="text-brand font-black ml-2 animate-pulse">
                                    • {selectedIds.size} seleccionados
                                </span>
                            )}
                        </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-2">
                        {/* 🔥 BOTÓN PROTEGIDO PARA EL OWNER: ACTIVAR MODO EDICIÓN */}
                        {isOwner && (
                            <Button 
                                variant="secondary" 
                                onClick={() => setIsEditMode(!isEditMode)} 
                                className={cn(
                                    "border transition-all",
                                    isEditMode ? "bg-brand text-white border-brand shadow-lg" : "bg-white text-sys-500 border-sys-200 hover:border-sys-300"
                                )}
                            >
                                <Pencil size={18} className="mr-2"/> {isEditMode ? 'Terminar Edición' : 'Modo Edición'}
                            </Button>
                        )}

                        <div className="w-px h-8 bg-sys-200 mx-2 hidden md:block"></div>

                        {isOwner && (
                            <Button variant="ghost" onClick={handleForceSync} className="text-sys-400 hover:text-brand hover:bg-brand/5 border border-transparent hover:border-brand/20">
                                <RefreshCw size={18} className="mr-2"/> Sync Global
                            </Button>
                        )}

                        {isAdmin && (
                            <Button variant="secondary" className="border-green-200 text-green-700 bg-green-50 hover:bg-green-100" onClick={() => setIsScaleModalOpen(true)}>
                                <Scale size={18} className="mr-2" /> Balanzas
                            </Button>
                        )}

                        <Button variant="secondary" className="border-purple-200 text-purple-700 bg-purple-50" onClick={goToLabels}>
                            <Printer size={18} className="mr-2" /> Etiquetas
                        </Button>
                        <Button variant="secondary" className="border-blue-200 text-blue-700 bg-blue-50" onClick={goToMovements}>
                            <ArrowRightLeft size={18} className="mr-2" /> Kardex
                        </Button>
                        
                        <div className="w-px h-8 bg-sys-200 mx-2 hidden md:block"></div>

                        <Button variant="secondary" onClick={() => setIsImportModalOpen(true)}>
                            <Upload size={18} className="mr-2"/> Importar
                        </Button>
                        
                        {selectedIds.size > 0 && (
                            <Button variant="secondary" className="border-orange-200 text-orange-700 bg-orange-50 hover:bg-orange-100 animate-in zoom-in" onClick={() => setIsBulkUpdateOpen(true)}>
                                <ArrowUpRight size={18} className="mr-2"/> Aumento Masivo
                            </Button>
                        )}
                        
                        <Button onClick={() => { setEditingProduct(null); setIsProductModalOpen(true); }} className="shadow-xl shadow-brand/20 ml-2">
                            <Plus size={20} className="mr-2"/> Nuevo Producto
                        </Button>
                    </div>
                </div>

                {/* FILTERS */}
                <div className="px-6 py-3 bg-sys-50 border-b border-sys-200 flex gap-3 overflow-x-auto no-scrollbar items-center shrink-0">
                    <div className="relative w-72 group shrink-0">
                        <Search className="absolute left-3.5 top-2.5 text-sys-400 group-focus-within:text-brand transition-colors" size={18} />
                        <input 
                            ref={searchInputRef}
                            type="text" 
                            placeholder="Buscar (ESC para limpiar)..." 
                            className="w-full pl-10 pr-3 py-2.5 bg-white border-2 border-sys-100 rounded-2xl text-sm font-bold outline-none focus:border-brand transition-all"
                            value={inputValue} 
                            onChange={e => setInputValue(e.target.value)} 
                            onKeyDown={e => e.key === 'Escape' && setInputValue('')}
                        />
                    </div>
                    
                    <select className="filter-select" value={filters.category} onChange={e => setFilters({...filters, category: e.target.value})}>
                        <option value="">Categorías</option>
                        {masters.categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                    
                    <select className="filter-select" value={filters.brand} onChange={e => setFilters({...filters, brand: e.target.value})}>
                        <option value="">Marcas</option>
                        {masters.brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                    </select>

                    {(filters.category || filters.brand || searchTerm) && (
                        <button onClick={() => { setFilters({category:'', brand:''}); setInputValue(''); }} className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-all border-2 border-transparent hover:border-red-100">
                            <X size={20} />
                        </button>
                    )}
                </div>

                {/* TABLE */}
                <div className="flex-1 overflow-auto bg-white relative">
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-sys-50 z-10 shadow-sm">
                            <tr className="text-[10px] uppercase font-black text-sys-400 tracking-wider border-b border-sys-200">
                                <th className="p-4 w-12 text-center">
                                    <button onClick={toggleSelectAll} className="hover:text-brand transition-colors">
                                        {selectedIds.size >= filteredProducts.length && filteredProducts.length > 0 ? <CheckSquare className="text-brand" size={18} /> : <Square size={18} />}
                                    </button>
                                </th>
                                <th className="p-4 font-bold">Detalle Producto</th>
                                {branches.map(b => (
                                    <th key={b.id} className={cn("p-4 text-center border-l border-sys-100", b.id === activeBranchId ? "bg-brand/5 text-brand" : "")}>
                                        {b.name}
                                    </th>
                                ))}
                                <th className="p-4 text-right border-l border-sys-100">Costo Neto</th>
                                <th className="p-4 text-right">Precio Actual</th>
                                <th className="p-4 text-center w-24">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-sys-100">
                            {currentProducts.map((p, index) => {
                                const promo = getActivePromo(p);
                                const isSelected = selectedIds.has(p.id);
                                const currentStock = p.stock; 
                                const hasPendingPrice = p.priceActivationDate && p.nextPrice !== undefined && p.nextPrice !== null;
                                
                                // IDs para navegación de teclado
                                const prevRowId = index > 0 ? currentProducts[index - 1].id : null;
                                const nextRowId = index < currentProducts.length - 1 ? currentProducts[index + 1].id : null;

                                return (
                                    <tr 
                                        key={p.id} 
                                        onClick={() => { setEditingProduct(p); setIsProductModalOpen(true); }}
                                        className={cn("cursor-pointer transition-all h-[70px]", isSelected ? "bg-brand/5" : "hover:bg-sys-50")}
                                    >
                                        <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                                            <button onClick={() => toggleSelection(p.id)} className={cn("transition-colors", isSelected ? "text-brand" : "text-sys-300")}>
                                                {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                                            </button>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-black text-sys-900 leading-tight uppercase">{p.name}</span>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-[10px] font-mono font-bold text-sys-400 bg-sys-100 px-1.5 py-0.5 rounded border border-sys-200">{p.code || 'S/C'}</span>
                                                    <span className="text-[10px] font-black text-sys-400 uppercase tracking-tighter opacity-60">{p.brand}</span>
                                                </div>
                                            </div>
                                        </td>
                                        
                                        {/* STOCK COLUMNS - EDITABLE ONLY FOR ACTIVE BRANCH AND IF EDIT MODE IS ON */}
                                        {branches.map(b => {
                                            const isCurrentBranch = b.id === activeBranchId && activeBranchId !== 'ALL';
                                            let stockVal = isCurrentBranch ? currentStock : (globalStock[p.id]?.[b.id] || 0);

                                            return (
                                                <td key={b.id} className={cn("p-2 text-center border-l border-sys-100", b.id === activeBranchId ? "bg-brand/5" : "")} onClick={e => e.stopPropagation()}>
                                                    {isCurrentBranch ? (
                                                        <EditableCell 
                                                            value={stockVal} 
                                                            id={p.id} 
                                                            field="stock" 
                                                            productId={p.id}
                                                            onSave={handleInlineSave}
                                                            type="number"
                                                            disabled={!isEditMode}
                                                            nextRowId={nextRowId}
                                                            prevRowId={prevRowId}
                                                            className={cn("mx-auto w-20 text-center font-black rounded-lg", 
                                                                stockVal < 0 ? "text-red-600 bg-red-50" : stockVal <= (p.minStock || 5) ? "text-orange-600 bg-orange-50" : "text-sys-700"
                                                            )}
                                                        />
                                                    ) : (
                                                        <span className="text-xs text-sys-400 font-bold">{formatStock(stockVal)}</span>
                                                    )}
                                                </td>
                                            );
                                        })}

                                        {/* COSTO - EDITABLE */}
                                        <td className="p-2 text-right border-l border-sys-100 font-mono text-xs font-bold text-sys-500" onClick={e => e.stopPropagation()}>
                                            <EditableCell 
                                                value={p.cost} 
                                                id={p.id} 
                                                field="cost" 
                                                productId={p.id}
                                                onSave={handleInlineSave}
                                                type="number"
                                                prefix="$ "
                                                disabled={!isEditMode}
                                                nextRowId={nextRowId}
                                                prevRowId={prevRowId}
                                            />
                                        </td>

                                        {/* PRECIO - EDITABLE */}
                                        <td className="p-2 text-right" onClick={e => e.stopPropagation()}>
                                            <div className="flex flex-col items-end">
                                                <div className="flex items-center justify-end w-full gap-1.5">
                                                    {hasPendingPrice && (
                                                        <div className="text-orange-500 animate-pulse cursor-help" title={`CAMBIO PROGRAMADO:\nNuevo Precio: $${p.nextPrice}\nFecha: ${p.priceActivationDate}`}>
                                                            <CalendarClock size={16} />
                                                        </div>
                                                    )}
                                                    <EditableCell 
                                                        value={p.price} 
                                                        id={p.id} 
                                                        field="price" 
                                                        productId={p.id}
                                                        onSave={handleInlineSave}
                                                        type="number"
                                                        prefix="$ "
                                                        disabled={!isEditMode}
                                                        nextRowId={nextRowId}
                                                        prevRowId={prevRowId}
                                                        className={cn("text-base font-black w-24", promo ? "text-purple-600" : "text-sys-900")}
                                                    />
                                                </div>
                                                {promo && <span className="text-[8px] font-black bg-purple-600 text-white px-1.5 rounded-full mt-1">{promo.name}</span>}
                                            </div>
                                        </td>

                                        <td className="p-4" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex justify-center gap-1">
                                                <button onClick={() => setStockEntryProduct(p)} className="p-2 rounded-xl text-green-600 hover:bg-green-50 transition-all border border-transparent hover:border-green-100"><Package size={18}/></button>
                                                <button onClick={() => { setEditingProduct(p); setIsProductModalOpen(true); }} className="p-2 rounded-xl text-brand hover:bg-brand/5 transition-all"><Edit2 size={18}/></button>
                                                {isAdmin && <button onClick={() => productRepository.delete(p.id).then(() => loadData())} className="p-2 rounded-xl text-red-300 hover:text-red-600 hover:bg-red-50 transition-all"><Trash2 size={18}/></button>}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* PAGINATION */}
                <div className="p-4 bg-white border-t border-sys-200 flex justify-between items-center z-20">
                    <span className="text-xs font-bold text-sys-500 uppercase tracking-widest">
                        Página {currentPage} de {totalPages} <span className="ml-2 opacity-30">|</span> Total {filteredProducts.length} items
                    </span>
                    <div className="flex gap-2">
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-2 rounded-xl border-2 border-sys-100 hover:bg-sys-50 disabled:opacity-30"><ChevronLeft size={20}/></button>
                        <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-2 rounded-xl border-2 border-sys-100 hover:bg-sys-50 disabled:opacity-30"><ChevronRight size={20}/></button>
                    </div>
                </div>
            </div>

            {/* MODALES */}
            <ProductModal 
                isOpen={isProductModalOpen} 
                onClose={() => setIsProductModalOpen(false)} 
                productToEdit={editingProduct} 
                onSave={handleSaveProduct} 
            />
            <StockEntryModal isOpen={!!stockEntryProduct} onClose={() => setStockEntryProduct(null)} product={stockEntryProduct} onConfirm={handleQuickStockEntry} />
            <BulkUpdateModal 
                isOpen={isBulkUpdateOpen} 
                onClose={() => setIsBulkUpdateOpen(false)} 
                onConfirm={executeBulkUpdate} 
                allProducts={products} 
                masters={masters} 
                manualSelectionIds={selectedIds} 
            />
            <ScaleExportModal 
                isOpen={isScaleModalOpen}
                onClose={() => setIsScaleModalOpen(false)}
                onExport={handleScaleExport}
            />
            <MastersModal isOpen={isMastersModalOpen} onClose={() => setIsMastersModalOpen(false)} />
            <ImportMapperModal isOpen={isImportModalOpen} onClose={() => setIsImportModalOpen(false)} branchId={activeBranchId} onSuccess={loadData} />
            
            <style>{`
                .filter-select { @apply h-11 px-4 border-2 border-sys-100 rounded-2xl text-xs font-black bg-white min-w-[160px] outline-none focus:border-brand cursor-pointer text-sys-700 hover:border-brand/20 transition-all appearance-none shadow-sm; }
                .no-scrollbar::-webkit-scrollbar { display: none; }
                .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            `}</style>
        </div>
    );
};