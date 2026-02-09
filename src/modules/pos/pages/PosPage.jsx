import React, { useEffect, useState, useRef, useCallback } from 'react';
import { 
    Search, Trash2, ShoppingCart, PackageOpen, 
    Keyboard, User, DollarSign, ChevronRight, Plus, 
    Lock, Wallet, ArrowRight, Loader2, X, Store,
    Tag 
} from 'lucide-react';

// Controlador Maestro (Cerebro)
import { usePosController } from '../hooks/usePosController';

// Repositorios
import { cashRepository } from '../../cash/repositories/cashRepository';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { productRepository } from '../../inventory/repositories/productRepository';

// Componentes UI
import { QuantityModal } from '../components/QuantityModal';
import { PaymentModal } from '../components/PaymentModal';
import { ClientSelectionModal } from '../components/ClientSelectionModal'; 
import { TicketModal } from '../../sales/components/TicketModal';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

// =================================================================
// ⚙️ CONFIGURACIÓN GLOBAL DEL POS (LISTA PARA INYECCIÓN)
// =================================================================
const POS_CONFIG = {
    // true: Permite agregar productos con stock <= 0 sin preguntar.
    // false: Bloquea la venta si el stock es <= 0.
    ALLOW_OUT_OF_STOCK_SALES: true, 
};

export const PosPage = () => {
  const { user } = useAuthStore();
  
  // 🔥 INYECTAMOS EL CEREBRO DEL POS
  const {
      tabs,
      activeTab,
      activeTabId,
      totals,
      searchResults,
      addTab,
      removeTab,
      switchTab,
      addToCart,
      removeFromCart,
      setClient,
      clearCart,
      searchProduct,
      setSearchResults, 
      processSale,
      isProcessing
  } = usePosController();

  // Estados Locales de UI
  const [isShiftChecking, setIsShiftChecking] = useState(true);
  const [hasOpenShift, setHasOpenShift] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('');
  const [isOpening, setIsOpening] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [defaultProducts, setDefaultProducts] = useState([]); 
  
  // Modales
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isClientSelectorOpen, setIsClientSelectorOpen] = useState(false);
  const [lastSaleTicket, setLastSaleTicket] = useState(null);

  // Refs
  const searchInputRef = useRef(null);
  const openingInputRef = useRef(null);
  const productsListRef = useRef(null);
  
  // 🔥 BLINDAJE DE ESCÁNER (TIMESTAMP)
  const lastScanTime = useRef(0);

  // =================================================================
  // 🛡️ REGLA DE ORO: FOCO PERSISTENTE (Scanner & Teclado)
  // =================================================================
  const maintainFocus = useCallback(() => {
      const anyModalOpen = isPaymentOpen || isClientSelectorOpen || !!selectedProduct || !!lastSaleTicket;
      if (!anyModalOpen && hasOpenShift) {
          setTimeout(() => {
              searchInputRef.current?.focus();
          }, 50);
      }
  }, [isPaymentOpen, isClientSelectorOpen, selectedProduct, lastSaleTicket, hasOpenShift]);

  useEffect(() => {
      const handleGlobalClick = (e) => {
          if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
              maintainFocus();
          }
      };
      document.addEventListener('mousedown', handleGlobalClick);
      return () => document.removeEventListener('mousedown', handleGlobalClick);
  }, [maintainFocus]);

  useEffect(() => {
    maintainFocus();
  }, [isPaymentOpen, isClientSelectorOpen, selectedProduct, lastSaleTicket, maintainFocus]);

  // =================================================================
  // ⚖️ LÓGICA DE BALANZAS INTELIGENTES (Prefijo 20)
  // =================================================================
  const parseScaleBarcode = async (code) => {
      if (code.startsWith('20') && code.length === 13) {
          const internalCode = code.substring(2, 7);
          const weightInGrams = parseFloat(code.substring(7, 12));
          const finalWeight = weightInGrams / 1000; 
          
          const product = await productRepository.getProductByInternalCode(internalCode);
          if (product) {
              addToCart(product, finalWeight);
              setSearchTerm('');
              return true;
          }
      }
      return false;
  };

  // =================================================================
  // 📦 PRODUCTOS INICIALES
  // =================================================================
  useEffect(() => {
      const loadInitialProducts = async () => {
          if (hasOpenShift) {
              const all = await productRepository.getAll();
              setDefaultProducts(all.slice(0, 15));
          }
      };
      loadInitialProducts();
  }, [hasOpenShift]);

  // =================================================================
  // 1. VERIFICACIÓN DE CAJA
  // =================================================================
  useEffect(() => {
      const verifyShift = async () => {
          try {
              const shift = await cashRepository.getCurrentShift();
              setHasOpenShift(!!shift);
              if (!shift) setTimeout(() => openingInputRef.current?.focus(), 200);
          } catch (e) { console.error(e); } 
          finally { setIsShiftChecking(false); }
      };
      verifyShift();
  }, []);

  const handleOpenShift = async (e) => {
      e.preventDefault();
      if (!openingAmount) return;
      setIsOpening(true);
      try {
          await cashRepository.openShift(openingAmount, user?.name);
          setHasOpenShift(true);
          setOpeningAmount('');
      } catch (err) { alert(err.message); }
      finally { setIsOpening(false); }
  };

  // =================================================================
  // 2. MANEJO DE INPUT BÚSQUEDA
  // =================================================================
  useEffect(() => {
      const timer = setTimeout(async () => {
          if (searchTerm.length >= 2) {
              const wasScale = await parseScaleBarcode(searchTerm);
              if (!wasScale) searchProduct(searchTerm);
          } else {
              setSearchResults([]);
          }
      }, 150);
      return () => clearTimeout(timer);
  }, [searchTerm]);

  // 🔥 LÓGICA DE SELECCIÓN SIN CONFIRMACIONES MOLESTAS
  const handleSelectProduct = (product) => {
      if (!product || !product.id) return;

      const currentStock = parseFloat(product.stock || 0);

      // Si NO se permite vender sin stock y el stock es 0 o menos
      if (!POS_CONFIG.ALLOW_OUT_OF_STOCK_SALES && currentStock <= 0) {
          // Bloqueo silencioso: limpiamos y devolvemos foco
          setSearchTerm(''); 
          maintainFocus();
          return; 
      }
      
      // Si pasa la validación (o está permitido), agregamos sin preguntar
      if (product.isWeighable) {
          setSelectedProduct(product);
      } else {
          addToCart(product, 1);
          setSearchTerm('');
          setSearchResults([]);
          maintainFocus();
      }
  };

  const handleKeyDownInput = async (e) => {
      if (e.key === 'ArrowDown') {
          e.preventDefault();
          const list = searchTerm.length > 1 ? searchResults : defaultProducts;
          setFocusedIndex(prev => (prev < list.length - 1 ? prev + 1 : prev));
      } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusedIndex(prev => (prev > 0 ? prev - 1 : prev));
      } else if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();

          const now = Date.now();
          if (now - lastScanTime.current < 500) return; 

          if (!searchTerm.trim()) return;
          lastScanTime.current = now;

          try {
              const exactMatchInList = searchResults.find(p => 
                  String(p.barcode) === searchTerm || String(p.code) === searchTerm
              );

              if (exactMatchInList) {
                  handleSelectProduct(exactMatchInList);
                  return;
              }

              if (searchResults.length === 1) {
                  handleSelectProduct(searchResults[0]);
                  return;
              }

              if (focusedIndex >= 0 && searchResults[focusedIndex]) {
                  handleSelectProduct(searchResults[focusedIndex]);
                  return;
              }

              const directResults = await productRepository.search(searchTerm);
              const exactMatchDb = directResults.find(p => 
                  String(p.barcode) === searchTerm || String(p.code) === searchTerm
              );

              if (exactMatchDb) {
                  handleSelectProduct(exactMatchDb);
              } else if (directResults.length === 1) {
                  handleSelectProduct(directResults[0]);
              } else {
                  setSearchTerm('');
              }
          } catch (err) {
              console.error("Error en escaneo:", err);
          }
      }
  };

  // =================================================================
  // ⚡ TECLAS GLOBALES
  // =================================================================
  useEffect(() => {
      const handleGlobalKeys = (e) => {
          if (!hasOpenShift) return;
          switch(e.key) {
              case 'F1': e.preventDefault(); addTab(); break;
              case 'F2': e.preventDefault(); maintainFocus(); break;
              case 'F3': e.preventDefault(); setIsClientSelectorOpen(true); break;
              case 'F4': e.preventDefault(); if(confirm('¿Anular ticket actual?')) clearCart(); break;
              case 'F12': e.preventDefault(); if (activeTab.items.length > 0) setIsPaymentOpen(true); break;
              case 'Escape': 
                  e.preventDefault();
                  setSearchTerm(''); 
                  setSearchResults([]); 
                  maintainFocus();
                  break;
              default: break;
          }
      };
      window.addEventListener('keydown', handleGlobalKeys);
      return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [hasOpenShift, isPaymentOpen, activeTab.items, maintainFocus, addTab, clearCart]);

  const handleProcessSale = async (paymentData) => {
    const result = await processSale(paymentData);
    if (result) {
        const enrichedTicket = {
            ...result,
            companySnapshot: { nombre: user?.activeBranchName || 'MI NEGOCIO' }
        };
        setLastSaleTicket(enrichedTicket);
        setIsPaymentOpen(false);
        setSearchTerm('');
        const activeIndex = tabs.findIndex(t => t.id === activeTabId);
        if (tabs.length > 1 && activeIndex !== 0) removeTab(activeTabId);
        setTimeout(maintainFocus, 100);
    }
  };

  if (isShiftChecking) return <div className="h-full flex items-center justify-center bg-sys-100"><Loader2 className="animate-spin text-brand" size={40}/></div>;

  if (!hasOpenShift) {
      return (
          <div className="h-[calc(100vh-4rem)] flex items-center justify-center bg-sys-100 p-4">
              <div className="bg-white max-w-md w-full rounded-3xl shadow-2xl overflow-hidden border border-sys-200">
                  <div className="bg-gradient-to-br from-red-50 to-white p-8 text-center border-b border-red-100">
                      <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center shadow-sm mx-auto mb-4 border border-red-100">
                          <Lock size={40} className="text-red-500" strokeWidth={1.5} />
                      </div>
                      <h2 className="text-2xl font-black text-sys-900 mb-1 uppercase tracking-tighter">Terminal Bloqueada</h2>
                      <p className="text-sys-500 text-sm">Inicie su turno para comenzar a operar.</p>
                  </div>
                  <form onSubmit={handleOpenShift} className="p-8 space-y-6">
                      <div>
                          <label className="text-xs font-bold text-sys-500 uppercase ml-1">Fondo Inicial ($)</label>
                          <div className="relative mt-1">
                              <Wallet className="absolute left-4 top-3.5 text-sys-400" size={20} />
                              <input ref={openingInputRef} type="number" className="w-full pl-12 pr-4 py-3 bg-sys-50 border border-sys-200 rounded-xl text-lg font-bold outline-none focus:border-brand" placeholder="0.00" value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)} autoFocus />
                          </div>
                      </div>
                      <Button type="submit" className="w-full py-4 text-lg rounded-xl shadow-lg" disabled={isOpening || !openingAmount}>
                          {isOpening ? <Loader2 className="animate-spin"/> : <ArrowRight/>} ABRIR PUNTO DE VENTA
                      </Button>
                  </form>
              </div>
          </div>
      );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col bg-sys-50 relative overflow-hidden">
      
      {/* 🟢 BARRA SUPERIOR: PESTAÑAS */}
      <div className="h-12 bg-white border-b border-sys-200 flex items-end px-2 gap-1 overflow-x-auto no-scrollbar shrink-0 z-20 shadow-sm">
          {tabs.map((tab, index) => (
              <div 
                  key={tab.id}
                  onClick={() => switchTab(tab.id)}
                  className={cn(
                      "group relative px-5 py-2.5 min-w-[150px] max-w-[220px] cursor-pointer rounded-t-xl transition-all border-t border-x flex items-center justify-between select-none",
                      "border-sys-200 shadow-sm", 
                      activeTabId === tab.id 
                          ? "bg-white text-brand font-black translate-y-[1px] border-b-white z-10 border-t-2 border-t-brand" 
                          : "bg-sys-50/50 text-sys-400 hover:bg-sys-100"
                  )}
              >
                  <span className="truncate text-[11px] uppercase font-black tracking-tight">
                    {index === 0 ? "1. " : `${index + 1}. `}{tab.client ? tab.client.name.split(' ')[0] : tab.name}
                  </span>
                  {index !== 0 && (
                      <button onClick={(e) => { e.stopPropagation(); removeTab(tab.id); }} className="opacity-0 group-hover:opacity-100 hover:text-red-500 p-0.5 rounded-full hover:bg-red-50 transition-all ml-2">
                          <X size={12} />
                      </button>
                  )}
                  {tab.items.length > 0 && <span className="absolute top-1 right-2 w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-sm"></span>}
              </div>
          ))}
          <button onClick={addTab} className="ml-2 mb-1.5 p-1.5 bg-sys-50 text-sys-400 hover:text-brand hover:bg-brand/10 border border-sys-200 rounded-lg transition-all" title="Nueva Venta (F1)">
            <Plus size={18} />
          </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
          
          {/* 👈 IZQUIERDA: DETALLE DE VENTA */}
          <div className="flex-1 flex flex-col bg-white shadow-xl z-10 relative">
              <div className="p-3 border-b border-sys-100 flex items-center justify-between bg-white shrink-0">
                  <div className="flex items-center gap-3 w-full">
                      <button onClick={() => setIsClientSelectorOpen(true)} className={cn("flex-1 flex items-center gap-3 px-3 py-2 rounded-xl border transition-all text-left", activeTab.client ? "bg-brand-light/5 border-brand/20 text-brand-dark" : "bg-sys-50 border-sys-200 hover:border-sys-300 text-sys-500")}>
                          <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm", activeTab.client ? "bg-brand text-white" : "bg-white border text-sys-400")}>
                              <User size={16} />
                          </div>
                          <div className="flex flex-col overflow-hidden">
                              <span className="text-[10px] uppercase font-bold opacity-70 tracking-widest">
                                  {activeTab.client?.fiscalCondition === 'RESPONSABLE_INSCRIPTO' ? 'FACTURA A' : 'CONSUMIDOR FINAL'}
                              </span>
                              <span className="text-sm font-black truncate">{activeTab.client?.name || "Cliente (F3)"}</span>
                          </div>
                          <ChevronRight size={16} className="ml-auto opacity-50"/>
                      </button>
                  </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 bg-sys-50/20">
                  {activeTab.items.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-sys-200 gap-4 select-none opacity-40">
                          <ShoppingCart size={60} strokeWidth={1} />
                          <p className="text-xs font-black uppercase tracking-[0.3em]">Terminal Lista</p>
                      </div>
                  ) : (
                      <div className="space-y-2">
                          {activeTab.items.map((item) => (
                              <div key={item.id} className="group flex items-center p-3 bg-white border border-sys-100 rounded-xl shadow-sm hover:shadow-md transition-all animate-in fade-in slide-in-from-left-2">
                                  <div className="w-10 text-center mr-3">
                                      <div className="text-lg font-black text-sys-900">{item.quantity}</div>
                                      <div className="text-[9px] uppercase text-sys-400 font-black">{item.isWeighable ? 'KG' : 'UN'}</div>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                      <div className="text-sm font-black text-sys-800 truncate uppercase tracking-tight">{item.name}</div>
                                      {item.appliedPromo && (
                                          <div className="inline-flex items-center gap-1.5 bg-purple-100 text-purple-700 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wide mt-1 animate-pulse">
                                              <Tag size={10} className="fill-purple-700"/>
                                              {item.promoLabel || "OFERTA"}
                                          </div>
                                      )}
                                      <div className="text-xs text-sys-400 font-mono mt-0.5 flex items-center gap-2">
                                          <span className={cn(item.appliedPromo ? "text-purple-700 font-bold" : "")}>
                                              ${(Number(item.price) || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})} x unid.
                                          </span>
                                      </div>
                                  </div>
                                  <div className="text-right pl-3">
                                      <div className="text-base font-black text-sys-900 tracking-tight">
                                        ${(Number(item.subtotal) || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                      </div>
                                      <button onClick={() => removeFromCart(item.id)} className="text-[10px] text-red-400 font-bold hover:text-red-600 transition-colors">ELIMINAR</button>
                                  </div>
                              </div>
                          ))}
                      </div>
                  )}
              </div>

              <div className="p-5 bg-white border-t border-sys-200 shadow-[0_-5px_20px_rgba(0,0,0,0.05)] z-20">
                  <div className="flex justify-between items-end mb-4">
                      <div>
                          <p className="text-[10px] font-black text-sys-400 uppercase tracking-widest mb-1">Subtotal de Venta</p>
                          <p className="text-5xl font-black text-sys-900 tracking-tighter tabular-nums leading-none">
                            ${(Number(totals?.total) || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                          </p>
                          {(Number(totals?.discountAmount) || 0) > 0 && (
                              <p className="text-xs font-bold text-green-600 mt-1 animate-bounce">
                                  Ahorro aplicado: -${(Number(totals.discountAmount) || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                              </p>
                          )}
                      </div>
                      <div className="flex gap-3">
                          <Button variant="ghost" className="h-14 w-14 rounded-xl border border-red-100 text-red-500 hover:bg-red-50 p-0" onClick={() => { if(confirm('¿Vacíar venta?')) clearCart(); }}><Trash2 size={24}/></Button>
                          <Button className="h-14 px-10 text-xl rounded-xl shadow-xl active:scale-95 transition-all flex items-center gap-3 font-black uppercase tracking-tighter" disabled={activeTab.items.length === 0} onClick={() => setIsPaymentOpen(true)}>
                              <DollarSign size={24} strokeWidth={3}/> COBRAR <span className="opacity-50 text-[10px] font-mono">F12</span>
                          </Button>
                      </div>
                  </div>
              </div>
          </div>

          {/* 👉 DERECHA: BUSCADOR */}
          <div className="w-[440px] border-l border-sys-200 bg-white hidden md:flex flex-col z-0">
              <div className="p-4 border-b border-sys-100 bg-white">
                  <div className="relative group">
                      <Search className="absolute left-3 top-3.5 text-sys-400 group-focus-within:text-brand transition-colors" size={22} />
                      <input ref={searchInputRef} type="text" className="w-full pl-11 pr-4 py-3.5 bg-sys-50 border-2 border-transparent rounded-2xl outline-none focus:bg-white focus:border-brand transition-all font-black text-sys-900 uppercase text-lg placeholder:text-sys-300" placeholder="ESCANEÉ O BUSQUE..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} onKeyDown={handleKeyDownInput} autoFocus autoComplete="off" onBlur={maintainFocus} />
                  </div>
              </div>

              <div ref={productsListRef} className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-sys-50/10">
                  {(searchTerm.length > 1 ? searchResults : defaultProducts).map((product, idx) => (
                      <div 
                          key={product.id}
                          onClick={() => handleSelectProduct(product)}
                          className={cn(
                              "group flex items-center justify-between p-5 rounded-2xl border-2 transition-all cursor-pointer shadow-sm",
                              idx === focusedIndex 
                                ? "bg-brand text-white border-brand shadow-xl scale-[1.02] translate-x-1" 
                                : "bg-white border-transparent hover:border-brand/30",
                              // UI: Si no hay stock y NO está permitido vender sin stock, bajar opacidad y mostrar bloqueado
                              parseFloat(product.stock || 0) <= 0 && !POS_CONFIG.ALLOW_OUT_OF_STOCK_SALES && "opacity-60 grayscale-[0.5]"
                          )}
                      >
                          <div className="flex-1 min-w-0 pr-3">
                              <div className={cn("font-black text-sm truncate uppercase tracking-tight", idx === focusedIndex ? "text-white" : "text-sys-900")}>{product.name}</div>
                              <div className="flex gap-2 items-center mt-1">
                                  <div className={cn("text-[10px] font-mono font-bold uppercase", idx === focusedIndex ? "text-white/80" : "text-sys-400")}>{product.barcode || product.code || 'S/C'}</div>
                                  {product.promo && (
                                      <div className={cn("text-[9px] px-1.5 py-0.5 rounded font-black uppercase flex items-center gap-1", idx === focusedIndex ? "bg-white/20 text-white" : "bg-purple-100 text-purple-700")}>
                                          <Tag size={8} /> {product.promo.type === 'PERCENTAGE' ? 'OFERTA' : 'PROMO'}
                                      </div>
                                  )}
                              </div>
                          </div>
                          <div className="text-right">
                              <div className={cn("font-black text-xl tracking-tighter", idx === focusedIndex ? "text-white" : "text-sys-900")}>
                                ${(Number(product.price) || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                              </div>
                              {/* BADGE DE STOCK CON LOGICA VISUAL */}
                              <div className={cn(
                                  "text-[9px] font-black uppercase px-2 py-0.5 rounded mt-1.5 inline-block",
                                  idx === focusedIndex 
                                    ? "bg-white/20" 
                                    : parseFloat(product.stock || 0) > 0 
                                        ? "bg-emerald-100 text-emerald-700" 
                                        : POS_CONFIG.ALLOW_OUT_OF_STOCK_SALES ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"
                              )}>
                                  {parseFloat(product.stock || 0) > 0 ? `${product.stock} DISP.` : POS_CONFIG.ALLOW_OUT_OF_STOCK_SALES ? 'S/ STOCK (VENDE)' : 'SIN STOCK'}
                              </div>
                          </div>
                      </div>
                  ))}
                  {searchTerm.length > 1 && searchResults.length === 0 && (
                      <div className="text-center py-20 text-sys-400 uppercase font-black text-xs opacity-30">
                          <PackageOpen size={60} className="mx-auto mb-4" strokeWidth={1} />
                          <p>Sin resultados</p>
                      </div>
                  )}
              </div>
          </div>
      </div>

      {/* FOOTER */}
      <div className="h-10 bg-sys-900 border-t border-white/10 flex items-center px-4 gap-8 text-[11px] font-black text-white shrink-0 select-none uppercase tracking-[0.1em]">
          <div className="flex items-center gap-2"><Keyboard size={16} className="text-brand"/> <span>ATAJOS:</span></div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2"><span className="bg-white/10 px-2 py-0.5 rounded text-brand border border-brand/30 font-mono">F1</span> NUEVA</div>
            <div className="flex items-center gap-2"><span className="bg-white/10 px-2 py-0.5 rounded text-white font-mono">F2</span> BUSCAR</div>
            <div className="flex items-center gap-2"><span className="bg-white/10 px-2 py-0.5 rounded text-white font-mono">F3</span> CLIENTE</div>
            <div className="flex items-center gap-2"><span className="bg-white/10 px-2 py-0.5 rounded text-white font-mono">F12</span> COBRAR</div>
          </div>
          <div className="ml-auto flex items-center gap-4">
              <div className="flex items-center gap-2 opacity-60 hover:opacity-100 transition-opacity">
                  <Store size={14} className="text-brand"/>
                  <span className="font-bold">{user?.activeBranchName || "SUCURSAL PRINCIPAL"}</span>
              </div>
              <div className="w-px h-4 bg-white/20"></div>
              <div className="flex items-center gap-2 bg-white/5 px-4 py-1 rounded-full border border-white/10">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.7)]"></div>
                <span className="text-white uppercase tracking-widest">{user?.name}</span>
              </div>
          </div>
      </div>

      {/* MODALES */}
      <QuantityModal isOpen={!!selectedProduct} product={selectedProduct} onClose={() => { setSelectedProduct(null); maintainFocus(); }} onConfirm={(product, qty) => { addToCart(product, qty); setSelectedProduct(null); maintainFocus(); }} />
      <PaymentModal isOpen={isPaymentOpen} total={Number(totals?.total) || 0} subtotal={Number(totals?.subtotal) || 0} discount={Number(totals?.discountAmount) || 0} client={activeTab.client} onClose={() => { setIsPaymentOpen(false); maintainFocus(); }} onConfirm={handleProcessSale} isProcessing={isProcessing} />
      <ClientSelectionModal isOpen={isClientSelectorOpen} onClose={() => { setIsClientSelectorOpen(false); maintainFocus(); }} onSelect={(c) => { setClient(c); setIsClientSelectorOpen(false); maintainFocus(); }} />
      <TicketModal isOpen={!!lastSaleTicket} sale={lastSaleTicket} onClose={() => { setLastSaleTicket(null); maintainFocus(); }} companyConfig={{ nombre: user?.activeBranchName }} />
    </div>
  );
};