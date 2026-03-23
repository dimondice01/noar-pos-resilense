import React, { useEffect, useState, useRef } from 'react';
import { 
    Search, Save, Truck, ArrowLeft,
    AlertCircle, PackagePlus, 
    RefreshCw, Globe, MapPin, 
    Info, Printer, CheckCircle,
    Trash2, Percent, CalendarClock, CalendarDays
} from 'lucide-react';
import { usePurchaseController } from '../hooks/usePurchaseController';
import { masterRepository } from '../../inventory/repositories/masterRepository';
import { productRepository } from '../../inventory/repositories/productRepository';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import toast from 'react-hot-toast';
import { QuickProductModal } from '../components/QuickProductModal';
import { SupplierPaymentModal } from '../components/SupplierPaymentModal';
import { useLocation, useNavigate, useParams } from 'react-router-dom'; 

export const PurchasePage = () => {
    // 🔥 CONTEXTO MULTI-SUCURSAL BLINDADO
    const { activeBranchName, activeBranchId } = useAuthStore();
    const { state: navState } = useLocation(); 
    const navigate = useNavigate();
    
    // 🔥 Capturamos el slug de la URL
    const { companySlug } = useParams();

    // 🧠 Conexión con el Cerebro de Compras
    const {
        supplier, setSupplier,
        invoiceNumber, setInvoiceNumber,
        items, addItem, updateItem, removeItem,
        totals, submitPurchase, isSaving,
        globalIncludesTax, toggleGlobalVAT
    } = usePurchaseController();

    // Estados Locales
    const [suppliersList, setSuppliersList] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);
    
    // Modales
    const [isNewProductModalOpen, setIsNewProductModalOpen] = useState(false);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false); 
    const [showPrintPrompt, setShowPrintPrompt] = useState(false); 
    
    const [newProductBarcode, setNewProductBarcode] = useState('');
    const [changedProducts, setChangedProducts] = useState([]);
    
    // 🔥 REFS PARA NAVEGACIÓN MATRICIAL
    const searchInputRef = useRef(null);
    const rowRefs = useRef({}); // Mapa de referencias: { "itemId-field": ref }

    // 1. Carga Inicial
    useEffect(() => {
        const loadMasters = async () => {
            const data = await masterRepository.getAll('suppliers');
            setSuppliersList(data);
            if (navState?.selectedSupplier) {
                const preSelected = data.find(s => s.id === navState.selectedSupplier.id);
                if (preSelected) setSupplier(preSelected);
            }
        };
        loadMasters();
        // Foco inicial al buscador
        setTimeout(() => searchInputRef.current?.focus(), 100);
    }, [navState]);

    // 2. Buscador con Debounce
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (searchTerm.length > 2) {
                setSearchLoading(true);
                const results = await productRepository.search(searchTerm);
                setSearchResults(results);
                setSearchLoading(false);
            } else {
                setSearchResults([]);
            }
        }, 200);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    // 🔥 3. AUTO-FOCO AL AGREGAR ITEM (AHORA EN CANTIDAD - A LA IZQUIERDA)
    useEffect(() => {
        if (items.length > 0) {
            const lastItem = items[items.length - 1];
            // Enfocamos "quantity" por defecto para carga rápida
            const targetRef = rowRefs.current[`${lastItem.product.id}-quantity`];
            if (targetRef) {
                setTimeout(() => {
                    targetRef.focus();
                    targetRef.select(); // Selecciona el "1" para sobrescribirlo al tipear
                }, 50);
            }
        }
    }, [items.length]);

    // =================================================================
    // 🚀 LÓGICA DE NAVEGACIÓN POR TECLADO (MATRIX NAV)
    // =================================================================
    
    const handleRowKeyDown = (e, itemId, field, index) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            // Volver al buscador y SELECCIONAR TODO para sobre-escritura inmediata
            if (searchInputRef.current) {
                searchInputRef.current.focus();
                searchInputRef.current.select();
            }
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            
            // 🔥 NUEVO ORDEN LÓGICO VISUAL (De izquierda a derecha)
            const fields = ['quantity', 'costInput', 'markup', 'newPrice', 'expiryDate'];
            const currentFieldIndex = fields.indexOf(field);
            
            let nextField = field;
            let nextIndex = index;

            if (e.key === 'ArrowRight') {
                if (currentFieldIndex < fields.length - 1) {
                    nextField = fields[currentFieldIndex + 1];
                }
            } else if (e.key === 'ArrowLeft') {
                if (currentFieldIndex > 0) {
                    nextField = fields[currentFieldIndex - 1];
                }
            } else if (e.key === 'ArrowDown') {
                if (index < items.length - 1) {
                    nextIndex = index + 1;
                }
            } else if (e.key === 'ArrowUp') {
                if (index > 0) {
                    nextIndex = index - 1;
                }
            }

            // Enfocar el siguiente elemento calculado
            const nextItem = items[nextIndex];
            const targetRef = rowRefs.current[`${nextItem.product.id}-${nextField}`];
            if (targetRef) {
                targetRef.focus();
                if (targetRef.select) targetRef.select();
            }
        }
    };

    // =================================================================
    // 🚀 FLUJO DE GUARDADO, PAGO E IMPRESIÓN
    // =================================================================
    
    const handleInitSave = () => {
        if (!activeBranchId || activeBranchId === 'ALL') {
            return toast.error("⚠️ Seleccione una sucursal específica para ingresar stock.");
        }
        if (!supplier) return toast.error("Seleccione un proveedor");
        if (items.length === 0) return toast.error("La lista está vacía");
        
        setIsPaymentModalOpen(true);
    };

    const handleConfirmPayment = async (paymentData) => {
        const listToPrint = items.filter(item => {
            const oldPrice = parseFloat(item.product.price || 0);
            const newPrice = parseFloat(item.newPrice || 0);
            return Math.abs(oldPrice - newPrice) > 0.01;
        }).map(item => ({
            ...item.product, 
            price: parseFloat(item.newPrice),
            cost: parseFloat(item.costInput)
        }));

        try {
            const finalPayload = {
                ...paymentData,
                branchId: activeBranchId,
                priceEffectiveDate: paymentData.effectiveDate || null 
            };

            const success = await submitPurchase(finalPayload); 
            
            if (success) {
                setIsPaymentModalOpen(false);
                
                if (listToPrint.length > 0) {
                    setChangedProducts(listToPrint);
                    setShowPrintPrompt(true); 
                } else {
                    toast.success("Compra guardada correctamente");
                    navigate(`/${companySlug}/suppliers`); 
                }
            }
        } catch (e) {
            console.error(e);
            toast.error("Error al guardar la compra");
        }
    };

    const handleGoToPrint = () => {
        navigate(`/${companySlug}/inventory/print-labels`, { 
            state: { autoLoadItems: changedProducts } 
        });
    };

    const handleBack = () => {
        const targetPath = `/${companySlug}/suppliers`;
        if (items.length > 0) {
            if (confirm("¿Salir sin guardar la compra? Se perderán los datos ingresados.")) {
                navigate(targetPath);
            }
        } else {
            navigate(targetPath);
        }
    };

    const handleSearchKeyDown = async (e) => {
        if (e.key === 'Enter' && searchTerm) {
            e.preventDefault();
            const exactProduct = await productRepository.findByCode(searchTerm);
            if (exactProduct) {
                addItem(exactProduct);
                setSearchTerm(''); 
                setSearchResults([]);
                toast.success("Producto agregado");
            } else if (searchResults.length === 1) {
                addItem(searchResults[0]);
                setSearchTerm('');
            } else if (searchResults.length === 0) {
                if (confirm(`El producto "${searchTerm}" no existe. ¿Deseas crearlo ahora?`)) {
                    setNewProductBarcode(searchTerm);
                    setIsNewProductModalOpen(true);
                }
            }
        }
    };

    const priceChangesCount = items.filter(item => Math.abs(parseFloat(item.product.price || 0) - parseFloat(item.newPrice || 0)) > 0.01).length;

    return (
        <div className="h-[calc(100vh-4rem)] flex flex-col bg-sys-50 overflow-hidden relative">
            
            {/* ================= HEADER ================= */}
            <header className="bg-white border-b border-sys-200 px-6 py-4 shrink-0 z-20 shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" onClick={handleBack} className="rounded-full hover:bg-sys-100 p-2 text-sys-600">
                        <ArrowLeft size={24} />
                    </Button>
                    
                    <div className="w-12 h-12 bg-brand/10 rounded-2xl flex items-center justify-center text-brand">
                        <Truck size={28} strokeWidth={2.5} />
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-sys-900 tracking-tight">Recepción de Mercadería</h1>
                        <div className="flex items-center gap-2 text-[10px] font-bold text-sys-500 uppercase tracking-wider mt-0.5">
                            <span className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded border", 
                                !activeBranchId || activeBranchId === 'ALL' 
                                    ? "text-red-600 bg-red-50 border-red-100 animate-pulse" 
                                    : "text-emerald-600 bg-emerald-50 border-emerald-100"
                            )}>
                                <MapPin size={10}/> {activeBranchName && activeBranchId !== 'ALL' ? activeBranchName : "⚠️ SELECCIONE SUCURSAL"}
                            </span>
                            <span className="text-sys-300">/</span>
                            <span className="flex items-center gap-1 text-brand bg-brand/5 px-1.5 py-0.5 rounded border border-brand/10">
                                <Globe size={10}/> Nexus Core Active
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    {priceChangesCount > 0 && (
                        <div className="hidden lg:flex flex-col items-end gap-0.5 animate-in fade-in">
                            <div className="flex items-center gap-1.5 text-orange-600 bg-orange-50 px-2 py-1 rounded-lg border border-orange-100">
                                <CalendarClock size={14} />
                                <span className="text-[10px] font-bold">{priceChangesCount} Precios Modificados</span>
                            </div>
                            <span className="text-[9px] text-sys-400 font-medium">Podrás programar la fecha al guardar</span>
                        </div>
                    )}

                    <div className="h-10 w-px bg-sys-200 hidden lg:block"></div>

                    <div className="flex flex-col items-end gap-1">
                        <span className="text-[9px] font-black text-sys-400 uppercase tracking-widest">Condición IVA</span>
                        <div className="flex bg-sys-100 p-1 rounded-xl border border-sys-200">
                            <button onClick={() => toggleGlobalVAT(false)} className={cn("px-3 py-1 text-[10px] font-black rounded-lg transition-all", !globalIncludesTax ? "bg-white text-brand shadow-sm ring-1 ring-sys-200" : "text-sys-400 hover:text-sys-600")}>NETO + IVA</button>
                            <button onClick={() => toggleGlobalVAT(true)} className={cn("px-3 py-1 text-[10px] font-black rounded-lg transition-all", globalIncludesTax ? "bg-white text-brand shadow-sm ring-1 ring-sys-200" : "text-sys-400 hover:text-sys-600")}>IVA INCLUIDO</button>
                        </div>
                    </div>

                    <div className="h-10 w-px bg-sys-200"></div>

                    <div className="text-right">
                        <p className="text-[10px] uppercase font-black text-sys-400">Total a Pagar</p>
                        <p className="text-3xl font-black text-sys-900 tracking-tighter">
                            ${totals.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                        </p>
                    </div>
                    
                    <Button 
                        onClick={handleInitSave} 
                        disabled={isSaving || items.length === 0 || !supplier || !activeBranchId || activeBranchId === 'ALL'}
                        className="h-12 px-8 text-lg shadow-xl shadow-brand/20 active:scale-95 transition-transform"
                    >
                        {isSaving ? <RefreshCw className="animate-spin mr-2"/> : <Save className="mr-2"/>}
                        {isSaving ? "Procesando..." : "Ingresar Compra"}
                    </Button>
                </div>
            </header>

            <div className="flex-1 flex overflow-hidden">
                
                {/* ================= IZQUIERDA: TERMINAL DE CARGA ================= */}
                <div className="flex-1 flex flex-col bg-white overflow-hidden border-r border-sys-200">
                    
                    <div className="p-4 bg-sys-50/50 border-b border-sys-200 grid grid-cols-12 gap-4">
                        <div className="col-span-5">
                            <label className="text-[10px] font-black text-sys-500 uppercase mb-1.5 block">Proveedor</label>
                            <select 
                                className="w-full h-11 px-4 bg-white border border-sys-200 rounded-xl text-sm font-bold outline-none focus:border-brand shadow-sm"
                                value={supplier?.id || ''}
                                onChange={(e) => setSupplier(suppliersList.find(s => s.id === e.target.value))}
                            >
                                <option value="">Seleccione...</option>
                                {suppliersList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>
                        <div className="col-span-4">
                            <label className="text-[10px] font-black text-sys-500 uppercase mb-1.5 block">Nro Factura</label>
                            <input 
                                type="text" 
                                placeholder="0000-00000000"
                                className="w-full h-11 px-4 bg-white border border-sys-200 rounded-xl text-sm font-mono font-bold outline-none focus:border-brand shadow-sm uppercase"
                                value={invoiceNumber}
                                onChange={(e) => setInvoiceNumber(e.target.value)}
                            />
                        </div>
                        <div className="col-span-3 flex items-end">
                            <div className="bg-blue-50 border border-blue-100 p-2.5 rounded-xl flex items-center gap-3 w-full h-11">
                                <Info className="text-blue-500 shrink-0" size={18}/>
                                <p className="text-[9px] font-bold text-blue-700 leading-tight">
                                    Actualiza <span className="font-black">Stock y Precios</span> automáticamente.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-sys-50/20">
                        {items.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center opacity-30">
                                <PackagePlus size={80} strokeWidth={1} className="text-sys-400 mb-4" />
                                <p className="text-xl font-black text-sys-500">Escanea productos para comenzar</p>
                            </div>
                        ) : (
                            items.map((item, index) => {
                                const hasPriceChange = Math.abs(parseFloat(item.product.price) - parseFloat(item.newPrice)) > 0.01;
                                return (
                                    <div key={item.product.id} className="bg-white border border-sys-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all group animate-in slide-in-from-right-4">
                                        <div className="flex items-center gap-4">
                                            
                                            {/* 🔥 NUEVO: CANTIDAD INPUT A LA IZQUIERDA */}
                                            <div className="w-24 shrink-0">
                                                <label className="text-[8px] font-black text-brand uppercase mb-1 block text-center">Cantidad</label>
                                                <input 
                                                    ref={el => rowRefs.current[`${item.product.id}-quantity`] = el}
                                                    type="number" 
                                                    className="w-full h-10 px-2 border-2 border-brand/30 rounded-xl font-black text-center text-brand bg-brand/5 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all" 
                                                    value={item.quantity} 
                                                    onChange={(e) => updateItem(item.product.id, 'quantity', e.target.value)} 
                                                    min="1" 
                                                    onKeyDown={(e) => handleRowKeyDown(e, item.product.id, 'quantity', index)}
                                                />
                                            </div>

                                            {/* INFO PRODUCTO */}
                                            <div className="flex-1 min-w-[200px]">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-[9px] font-black bg-sys-100 text-sys-500 px-1.5 py-0.5 rounded border border-sys-200">{item.product.code || 'S/C'}</span>
                                                    {hasPriceChange && <span className="text-[8px] font-black bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded border border-orange-200 animate-pulse">NUEVO PRECIO</span>}
                                                </div>
                                                <h3 className="font-black text-sys-900 text-sm truncate uppercase">{item.product.name}</h3>
                                                <p className="text-[10px] text-sys-400 font-bold mt-1">Stock Actual: <span className="font-mono text-sys-600">{item.product.stock || 0}</span></p>
                                            </div>

                                            {/* BLOQUE CENTRAL DE PRECIOS */}
                                            <div className="flex-[2] grid grid-cols-4 gap-3 bg-sys-50 p-2.5 rounded-xl border border-sys-100">
                                                {/* COSTO INPUT */}
                                                <div>
                                                    <label className="text-[8px] font-black text-sys-400 uppercase mb-1 block">Costo Unit.</label>
                                                    <div className="relative">
                                                        <span className="absolute left-2 top-1.5 text-sys-400 text-[10px] font-bold">$</span>
                                                        <input 
                                                            ref={el => rowRefs.current[`${item.product.id}-costInput`] = el}
                                                            type="number" 
                                                            className="w-full pl-5 pr-2 py-1 border border-sys-200 rounded-lg font-bold text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all" 
                                                            value={item.costInput} 
                                                            onChange={(e) => updateItem(item.product.id, 'costInput', e.target.value)}
                                                            onKeyDown={(e) => handleRowKeyDown(e, item.product.id, 'costInput', index)}
                                                        />
                                                    </div>
                                                </div>
                                                {/* MARGEN INPUT */}
                                                <div>
                                                    <label className="text-[8px] font-black text-sys-400 uppercase mb-1 block">Margen %</label>
                                                    <div className="relative">
                                                        <Percent className="absolute right-2 top-2 text-sys-300 pointer-events-none" size={10}/>
                                                        <input 
                                                            ref={el => rowRefs.current[`${item.product.id}-markup`] = el}
                                                            type="number" 
                                                            className="w-full pl-2 pr-5 py-1 border border-sys-200 rounded-lg font-black text-brand text-sm outline-none text-center focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all" 
                                                            value={item.markup} 
                                                            onChange={(e) => updateItem(item.product.id, 'markup', e.target.value)}
                                                            onKeyDown={(e) => handleRowKeyDown(e, item.product.id, 'markup', index)}
                                                        />
                                                    </div>
                                                </div>
                                                {/* PRECIO INPUT */}
                                                <div>
                                                    <label className="text-[8px] font-black text-emerald-600 uppercase mb-1 block">P. Venta</label>
                                                    <div className="relative">
                                                        <span className="absolute left-2 top-1.5 text-emerald-400 text-[10px] font-bold">$</span>
                                                        <input 
                                                            ref={el => rowRefs.current[`${item.product.id}-newPrice`] = el}
                                                            type="number" 
                                                            className="w-full pl-5 pr-2 py-1 border-2 border-emerald-100 bg-white rounded-lg font-black text-emerald-700 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 transition-all" 
                                                            value={item.newPrice} 
                                                            onChange={(e) => updateItem(item.product.id, 'newPrice', e.target.value)}
                                                            onKeyDown={(e) => handleRowKeyDown(e, item.product.id, 'newPrice', index)}
                                                        />
                                                    </div>
                                                </div>
                                                {/* SWITCH IVA */}
                                                <div className="flex flex-col justify-end pb-1 border-l border-sys-200 pl-3">
                                                    <button onClick={() => updateItem(item.product.id, 'includesTax', !item.includesTax)} className={cn("text-[8px] font-black px-1.5 py-1 rounded border w-full text-center tracking-wider", item.includesTax ? "bg-brand text-white border-brand" : "bg-white text-sys-400 border-sys-200")}>
                                                        {item.includesTax ? '+ IVA' : 'NETO'}
                                                    </button>
                                                </div>
                                            </div>

                                            {/* 🔥 NUEVO: VENCIMIENTO LOTE (A LA DERECHA) */}
                                            <div className="w-32 shrink-0">
                                                <label className="text-[8px] font-black text-purple-600 uppercase mb-1 block flex items-center gap-1"><CalendarDays size={10}/> Vencimiento Lote</label>
                                                <input 
                                                    ref={el => rowRefs.current[`${item.product.id}-expiryDate`] = el}
                                                    type="date" 
                                                    className="w-full h-10 px-2 border border-purple-100 bg-purple-50 rounded-xl font-bold text-xs text-purple-700 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-200 transition-all" 
                                                    value={item.expiryDate || ''} 
                                                    onChange={(e) => updateItem(item.product.id, 'expiryDate', e.target.value)} 
                                                    onKeyDown={(e) => handleRowKeyDown(e, item.product.id, 'expiryDate', index)}
                                                />
                                            </div>

                                            {/* ELIMINAR */}
                                            <button onClick={() => removeItem(item.product.id)} className="p-2.5 text-sys-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all shrink-0"><Trash2 size={20} /></button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* ================= DERECHA: BUSCADOR INTELIGENTE ================= */}
                <div className="w-[380px] bg-white border-l border-sys-200 flex flex-col z-10 shadow-2xl">
                    <div className="p-5 bg-sys-50 border-b border-sys-200">
                        <div className="relative group">
                            <Search className="absolute left-3.5 top-3.5 text-sys-400 group-focus-within:text-brand transition-colors" size={20} />
                            <input 
                                ref={searchInputRef}
                                type="text" 
                                className="w-full pl-11 pr-4 py-3.5 bg-white border border-sys-200 rounded-2xl outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-bold text-sys-900 shadow-sm placeholder:text-sys-300"
                                placeholder="Escanear o buscar..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onKeyDown={handleSearchKeyDown}
                                autoFocus
                            />
                            {searchLoading && <RefreshCw className="absolute right-3.5 top-3.5 text-brand animate-spin" size={18} />}
                        </div>
                        <Button 
                            variant="secondary" 
                            className="w-full mt-4 bg-white border-sys-200 text-sys-700 font-bold h-11 hover:bg-sys-50 hover:border-brand/30"
                            onClick={() => { setNewProductBarcode(''); setIsNewProductModalOpen(true); }}
                        >
                            <PackagePlus size={18} className="mr-2 text-brand" /> Nuevo Producto
                        </Button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-sys-50/10">
                        {searchTerm.length > 2 && searchResults.length === 0 && !searchLoading && (
                            <div className="text-center py-10 text-sys-400 px-6">
                                <AlertCircle className="mx-auto mb-2 opacity-50" size={32}/>
                                <p className="text-sm font-medium text-sys-600">No encontrado en Maestro</p>
                                <p className="text-xs mt-1">Presiona "Nuevo Producto" para crearlo y agregarlo a la factura.</p>
                            </div>
                        )}

                        {searchResults.map((prod) => {
                            const inCart = items.find(i => i.product.id === prod.id);
                            return (
                                <div 
                                    key={prod.id}
                                    onClick={() => !inCart && addItem(prod)}
                                    className={cn(
                                        "p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group",
                                        inCart 
                                            ? "bg-sys-50 border-sys-200 opacity-60 grayscale cursor-not-allowed" 
                                            : "bg-white border-sys-100 hover:border-brand/50 hover:shadow-lg active:scale-95"
                                    )}
                                >
                                    <div className="flex justify-between items-start">
                                        <div className="flex-1 min-w-0 pr-2">
                                            <p className="text-[10px] font-black text-sys-400 uppercase tracking-tighter truncate">
                                                {prod.category || 'SIN CATEGORÍA'}
                                            </p>
                                            <h4 className="font-black text-sys-900 text-sm truncate uppercase group-hover:text-brand transition-colors">
                                                {prod.name}
                                            </h4>
                                            <p className="text-[10px] font-mono text-sys-500 mt-1 bg-sys-50 inline-block px-1.5 rounded border border-sys-100">
                                                {prod.code || 'S/C'}
                                            </p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className="text-sm font-black text-brand block">${prod.price}</span>
                                            <span className="text-[9px] font-bold text-sys-400">STOCK: {prod.stock || 0}</span>
                                        </div>
                                    </div>
                                    {inCart && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-[1px]">
                                            <span className="text-[10px] font-black text-sys-500 bg-sys-100 px-3 py-1 rounded-full border border-sys-200 shadow-sm">
                                                YA AGREGADO
                                            </span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* MODALES */}
            <QuickProductModal 
                isOpen={isNewProductModalOpen}
                initialBarcode={newProductBarcode}
                onClose={() => { setIsNewProductModalOpen(false); setNewProductBarcode(''); }}
                onProductCreated={(product) => { addItem(product); setSearchTerm(''); setSearchResults([]); }}
            />

            <SupplierPaymentModal 
                isOpen={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                total={totals}
                supplierName={supplier?.name || "Proveedor"}
                hasPriceChanges={priceChangesCount > 0} 
                onConfirm={handleConfirmPayment}
            />

            {showPrintPrompt && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
                        <div className="p-8 text-center">
                            <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-200">
                                <CheckCircle size={48} strokeWidth={2.5}/>
                            </div>
                            <h2 className="text-2xl font-black text-sys-900 leading-tight mb-2">¡Compra Guardada!</h2>
                            <p className="text-sys-500 font-medium mb-6">
                                Se han detectado <span className="font-black text-brand text-lg">{changedProducts.length}</span> productos que cambiaron su precio de venta.
                            </p>
                            <div className="space-y-3">
                                <Button onClick={handleGoToPrint} className="w-full py-4 text-base font-black shadow-lg shadow-brand/20 bg-brand hover:bg-brand-dark">
                                    <Printer size={20} className="mr-2"/> Imprimir Etiquetas Nuevas
                                </Button>
                                <Button variant="ghost" onClick={() => { setShowPrintPrompt(false); navigate(`/${companySlug}/suppliers`); }} className="w-full py-3 text-sys-400 font-bold hover:bg-sys-50 rounded-xl">
                                    Omitir y Volver
                                </Button>
                            </div>
                        </div>
                        <div className="bg-sys-50 p-3 text-center border-t border-sys-100">
                            <p className="text-[10px] text-sys-400">Los precios ya se han actualizado en el sistema.</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};