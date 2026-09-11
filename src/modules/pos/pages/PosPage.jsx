import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    Search, Trash2, ShoppingCart, PackageOpen,
    Keyboard, User, DollarSign, ChevronRight, Plus,
    Lock, Wallet, ArrowRight, Loader2, X, Store,
    Tag, Percent
} from 'lucide-react';

// Controlador Maestro (Cerebro)
import { usePosController } from '../hooks/usePosController';

// Repositorios
import { cashRepository } from '../../cash/repositories/cashRepository';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { productRepository } from '../../inventory/repositories/productRepository';
import { parseTotalScaleBarcode } from '../utils/scaleTotalBarcode';

// Componentes UI
import { QuantityModal } from '../components/QuantityModal';
import { PaymentModal } from '../components/PaymentModal';
import { ClientSelectionModal } from '../components/ClientSelectionModal'; 
import { TicketModal } from '../../sales/components/TicketModal';
import { CashOperationsModal } from '../components/CashOperationsModal';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import { useUiStore } from '../../../core/store/useUiStore';
import toast from 'react-hot-toast';

// =================================================================
// ⚙️ CONFIGURACIÓN GLOBAL DEL POS
// =================================================================
const POS_CONFIG = {
    ALLOW_OUT_OF_STOCK_SALES: true, 
};

// =================================================================
// 🧩 MODAL: ARTÍCULO MANUAL (VARIOS)
// =================================================================
const MiscItemModal = ({ isOpen, onClose, onConfirm }) => {
    const [name, setName] = useState('');
    const [price, setPrice] = useState('');
    const nameInputRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            setName('');
            setPrice('');
            setTimeout(() => nameInputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    const handleSubmit = (e) => {
        e.preventDefault();
        const finalPrice = parseFloat(price);
        if (!name.trim() || isNaN(finalPrice) || finalPrice <= 0) {
            toast.error("Ingrese un nombre y un precio válido.");
            return;
        }
        
        const manualProduct = {
            id: `manual_${Date.now()}`,
            code: 'MANUAL',
            name: name.trim().toUpperCase(),
            price: finalPrice,
            cost: 0,
            isWeighable: false,
            stock: 999, 
            taxRate: 21
        };

        onConfirm(manualProduct, 1);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="p-4 bg-brand text-white flex justify-between items-center">
                    <h3 className="font-bold flex items-center gap-2"><Plus size={18}/> Artículo Manual</h3>
                    <button onClick={onClose} className="hover:bg-white/20 p-1 rounded"><X size={18}/></button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="text-xs text-sys-500 uppercase font-bold mb-1 block">Descripción del Artículo</label>
                        <input 
                            ref={nameInputRef}
                            type="text" 
                            className="w-full text-base font-bold p-3 bg-sys-50 border-2 border-sys-200 rounded-xl focus:border-brand outline-none uppercase"
                            placeholder="Ej: HUEVOS COLORADOS"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            onKeyDown={e => e.stopPropagation()} 
                        />
                    </div>
                    <div>
                        <label className="text-xs text-sys-500 uppercase font-bold mb-1 block">Precio de Venta ($)</label>
                        <input 
                            type="number" 
                            className="w-full text-2xl font-black p-3 bg-sys-50 border-2 border-brand/20 rounded-xl focus:border-brand outline-none text-right text-brand"
                            placeholder="0.00"
                            step="0.01"
                            value={price}
                            onChange={e => setPrice(e.target.value)}
                            onKeyDown={e => e.stopPropagation()} 
                        />
                    </div>
                    <Button type="submit" className="w-full py-3 shadow-lg shadow-brand/20 text-base">Agregar a la cuenta</Button>
                </form>
            </div>
        </div>
    );
};

// =================================================================
// 🧩 SUB-COMPONENTE: EDITOR DE CANTIDAD INLINE (NUEVO)
// =================================================================
const InlineQuantityEditor = ({ currentQty, isWeighable, onUpdate, onCancel }) => {
    const [val, setVal] = useState(currentQty.toString());
    const inputRef = useRef(null);

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select(); // Selecciona todo para borrar fácil
        }
    }, []);

    const handleSave = () => {
        const num = parseFloat(val);
        if (!isNaN(num) && num > 0) {
            onUpdate(num);
        } else {
            onCancel(); // Si pone 0 o basura, cancela el cambio
        }
    };

    const handleKeyDown = (e) => {
        e.stopPropagation(); // Evita que se disparen las teclas globales de la caja
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSave();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        }
    };

    return (
        <input 
            ref={inputRef}
            type="number"
            step={isWeighable ? "0.001" : "1"}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="w-full text-center text-lg font-black text-brand bg-brand/10 border-2 border-brand/40 rounded-lg outline-none focus:border-brand py-0.5"
        />
    );
};

// =================================================================
// 🏭 MAIN: POS PAGE
// =================================================================
export const PosPage = () => {
  const { setSidebarCollapsed } = useUiStore();
  useEffect(() => {
    setSidebarCollapsed(true);
    return () => setSidebarCollapsed(false);
  }, [setSidebarCollapsed]);

  const { user, activeBranchId } = useAuthStore();
  
  const {
      tabs,
      activeTab,
      activeTabId,
      totals,
      searchResults,
      isProcessing,
      posConfig, 
      addTab,
      removeTab,
      switchTab,
      addToCart,
      removeFromCart,
      updateCartItemQuantity, // 🔥 IMPORTANTE: Necesitás tener esta función en usePosController
      setClient,
      clearCart,
      searchProduct,
      setSearchResults, 
      processSale,
      applyWholesaleToLastItem,
      processBudget,
      setTabPaymentMethod 
  } = usePosController();

  // Estados Locales
  const [isShiftChecking, setIsShiftChecking] = useState(true);
  const [hasOpenShift, setHasOpenShift] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('');
  const [isOpening, setIsOpening] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [defaultProducts, setDefaultProducts] = useState([]); 
  
  // Estado para Edición Inline
  const [editingItemId, setEditingItemId] = useState(null);

  // Modales
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isClientSelectorOpen, setIsClientSelectorOpen] = useState(false);
  const [isMiscItemOpen, setIsMiscItemOpen] = useState(false); 
  const [isCashOpsOpen, setIsCashOpsOpen] = useState(false); 
  const [lastSaleTicket, setLastSaleTicket] = useState(null);

  // Refs
  const searchInputRef = useRef(null);
  const openingInputRef = useRef(null);
  const productsListRef = useRef(null);
  const lastScanTime = useRef(0);
  const isAddingRef = useRef(false);   // 🛡️ Mutex scan UI
  const saleCompletedRef = useRef(false); // 🛡️ Anti-doble-cobro

  // =================================================================
  // 🛡️ FOCO PERSISTENTE (Solución de Navegación sin bloqueos)
  // =================================================================
  const refocusInput = useCallback(() => {
      const anyModalOpen = isPaymentOpen || isClientSelectorOpen || isMiscItemOpen || isCashOpsOpen || !!selectedProduct || !!lastSaleTicket || !!editingItemId;
      if (!anyModalOpen && hasOpenShift && searchInputRef.current) {
          searchInputRef.current.focus();
      }
  }, [isPaymentOpen, isClientSelectorOpen, isMiscItemOpen, isCashOpsOpen, selectedProduct, lastSaleTicket, hasOpenShift, editingItemId]);

  const handlePosClick = (e) => {
      const isInteractive = e.target.tagName === 'INPUT' || 
                            e.target.tagName === 'BUTTON' || 
                            e.target.closest('button') ||
                            e.target.tagName === 'A' ||
                            e.target.closest('a');
                            
      if (!isInteractive) {
          refocusInput();
      }
  };

  useEffect(() => {
      refocusInput();
  }, [refocusInput, activeTabId]);

  // =================================================================
  // ⚖️ LÓGICA DE BALANZAS
  // =================================================================
  // 🔥 Formato de balanza resuelto para la sucursal activa (default = comportamiento legado KRETZ/SYSTEL)
  const activeScaleFormat = posConfig.scaleBarcodeFormats?.[activeBranchId] === 'EAN13_GRAMS'
      ? 'EAN13_GRAMS'
      : 'LEGACY';

  // 🔥 Balanzas "soporte total" (Kretz) configuradas para la sucursal activa
  const activeTotalScaleProfiles = posConfig.scaleTotalProfiles?.[activeBranchId] || [];

  // 🔥 HELPER: VALIDADOR DE DÍGITO VERIFICADOR EAN-13 ESTÁNDAR
  const isValidEAN13 = (code) => {
      let sum = 0;
      for (let i = 0; i < 12; i++) {
          const digit = code.charCodeAt(i) - 48;
          sum += (i % 2 === 0) ? digit : digit * 3;
      }
      const check = (10 - (sum % 10)) % 10;
      return check === (code.charCodeAt(12) - 48);
  };

  const parseScaleBarcode = async (code) => {
      if (code.length !== 13) return false;

      // 🆕 BALANZA "SOPORTE TOTAL" (Kretz, opt-in por sucursal desde Configuración > POS > Balanza)
      const totalInfo = parseTotalScaleBarcode(code, activeTotalScaleProfiles);
      if (totalInfo) {
          addToCart({
              id: `scale_total_${Date.now()}`,
              code: 'MANUAL',
              name: totalInfo.categoryName.toUpperCase(),
              price: totalInfo.total,
              cost: 0,
              isWeighable: false,
              stock: 999,
              taxRate: 21,
              scaleSource: 'TOTAL_PROFILE'
          }, 1);
          toast.success(`⚖️ Balanza total: ${totalInfo.categoryName} ($${totalInfo.total})`);
          setSearchTerm('');
          return true;
      }

      // 🆕 FORMATO EAN13 GRAMOS (opt-in por sucursal desde Configuración > POS > Balanza)
      // Prefijo 1 dígito '2' + PLU 5 dígitos + peso 6 dígitos (gramos) + dígito verificador EAN-13 real.
      if (activeScaleFormat === 'EAN13_GRAMS' && code[0] === '2' && isValidEAN13(code)) {
          const pluCode = parseInt(code.substring(1, 6), 10).toString();
          const weightGrams = parseInt(code.substring(6, 12), 10);
          if (weightGrams > 0) {
              const product = await productRepository.findByCode(pluCode);
              if (product) {
                  const detectedQty = weightGrams / 1000;
                  addToCart(product, detectedQty);
                  toast.success(`⚖️ Balanza: ${product.name} - ${detectedQty}kg`);
                  setSearchTerm('');
                  return true;
              }
          }
      }

      const prefix = code.substring(0, 2);

      if (['20', '27', '28', '02'].includes(prefix)) {
          try {
              const rawPlu5 = code.substring(2, 7);
              const rawValue5 = code.substring(7, 12);
              
              const plu5 = parseInt(rawPlu5, 10).toString(); 
              const value5 = parseFloat(rawValue5);

              if (value5 > 0 && value5 < 50000) {
                  const product = await productRepository.findByCode(plu5);
                  if (product) {
                      const detectedQty = value5 / 1000; 
                      addToCart(product, detectedQty);
                      toast.success(`⚖️ Balanza: ${product.name} - ${detectedQty}kg`);
                      setSearchTerm('');
                      return true;
                  }
              }

              if (prefix === '20') {
                  const rawPlu4 = code.substring(2, 6);
                  const rawPrice6 = code.substring(6, 12);
                  
                  const plu4 = parseInt(rawPlu4, 10).toString();
                  const embeddedPrice = parseFloat(rawPrice6) / 100;

                  const product = await productRepository.findByCode(plu4);
                  if (product) {
                      const unitPrice = parseFloat(product.price);
                      if (unitPrice > 0) {
                          const detectedQty = Math.round((embeddedPrice / unitPrice) * 1000) / 1000;
                          addToCart(product, detectedQty);
                          toast.success(`⚖️ Balanza: ${product.name} - ${detectedQty}kg`);
                          setSearchTerm('');
                          return true;
                      }
                  }
              }
          } catch (e) { console.error("Error procesando balanza:", e); }
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

  // 🔄 REACTIVO: Recargar grilla cuando syncService actualiza productos desde cloud
  useEffect(() => {
      const reloadProducts = async () => {
          if (!hasOpenShift) return;
          const all = await productRepository.getAll();
          setDefaultProducts(all.slice(0, 15));
      };
      window.addEventListener('onProductsSynced', reloadProducts);
      return () => window.removeEventListener('onProductsSynced', reloadProducts);
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

  // 🔄 REACTIVO: Re-verificar turno cuando syncService detecta cambio en shifts
  useEffect(() => {
      const reVerifyShift = async () => {
          try {
              const shift = await cashRepository.getCurrentShift();
              setHasOpenShift(!!shift);
          } catch (e) { console.error(e); }
      };
      window.addEventListener('noar:shifts-synced', reVerifyShift);
      return () => window.removeEventListener('noar:shifts-synced', reVerifyShift);
  }, []);

  const handleOpenShift = async (e) => {
      e.preventDefault();
      if (!openingAmount) return;
      // 🔥 Mismo chequeo que Sidebar.jsx — mejor avisar antes de pedir el monto
      // que dejar que el repositorio tire el error genérico después. Un cajero
      // (sucursal fija) nunca debería llegar acá en uso normal; si pasa, es una
      // carrera de timing (recién logueado), no algo que resuelva "eligiendo"
      // sucursal — no tiene selector, lo tiene bloqueado.
      if (!activeBranchId || activeBranchId === 'ALL') {
          const isLockedUser = !!user?.branchId && user?.role !== 'OWNER';
          alert(isLockedUser
              ? "⏳ Tu sucursal todavía se está cargando. Esperá un segundo y volvé a intentar."
              : "⚠️ Seleccioná una sucursal específica para abrir caja.");
          return;
      }
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
      let isSubscribed = true;

      if (searchTerm.length === 0) {
          setSearchResults([]);
          setFocusedIndex(-1);
          return;
      }

      const timer = setTimeout(async () => {
          if (!isSubscribed) return;

          try {
              await searchProduct(searchTerm);
              
              if (isSubscribed) {
                  setFocusedIndex(-1);
              }
          } catch (error) {
              console.error("Error en búsqueda:", error);
          }
      }, 250);

      return () => {
          isSubscribed = false;
          clearTimeout(timer);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]); 

  const handleSelectProduct = (product) => {
      if (!product || !product.id) return;

      const currentStock = parseFloat(product.stock || 0);

      if (!POS_CONFIG.ALLOW_OUT_OF_STOCK_SALES && currentStock <= 0) {
          setSearchTerm(''); 
          refocusInput();
          return; 
      }
      
      if (product.isWeighable) {
          setSearchTerm('');
          setSearchResults([]);
          setSelectedProduct(product);
      } else {
          addToCart(product, 1);
          setSearchTerm('');
          setSearchResults([]);
          refocusInput();
      }
  };

  const handleKeyDownInput = async (e) => {
      const list = searchTerm.length > 0 ? searchResults : defaultProducts;

      if (e.key === 'ArrowDown') {
          e.preventDefault();
          setFocusedIndex(prev => (prev < list.length - 1 ? prev + 1 : prev));
      } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusedIndex(prev => (prev > 0 ? prev - 1 : prev));
      } else if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();

          const now = Date.now();
          if (now - lastScanTime.current < 1000) return; // 🛡️ 1000ms para PCs lentos
          if (isAddingRef.current) return; // 🛡️ Mutex: esperar que termine el add anterior

          const queryValue = searchTerm.trim();
          if (!queryValue) return;

          lastScanTime.current = now;
          isAddingRef.current = true;

          try {
              const wasScale = await parseScaleBarcode(queryValue);
              if (wasScale) return;

              if (focusedIndex >= 0 && list[focusedIndex]) {
                  handleSelectProduct(list[focusedIndex]);
                  return;
              }

              const queryUpper = queryValue.toUpperCase();

              let exactMatch = list.find(p =>
                  String(p.barcode || '').toUpperCase() === queryUpper ||
                  String(p.code || '').toUpperCase() === queryUpper
              );

              if (!exactMatch) {
                  const directResults = await productRepository.search(queryValue);
                  exactMatch = directResults.find(p =>
                      String(p.barcode || '').toUpperCase() === queryUpper ||
                      String(p.code || '').toUpperCase() === queryUpper
                  );
              }

              if (exactMatch) {
                  handleSelectProduct(exactMatch);
                  return;
              }

              if (list.length === 1) {
                  handleSelectProduct(list[0]);
                  return;
              }

          } catch (err) {
              console.error("Error en escaneo:", err);
          } finally {
              setTimeout(() => { isAddingRef.current = false; }, 800);
          }
      }
  };

  // =================================================================
  // ⚡ TECLAS GLOBALES (Liberado para Navegación)
  // =================================================================
  useEffect(() => {
      const handleGlobalKeys = (e) => {
          if (document.activeElement.tagName === 'INPUT' && document.activeElement !== searchInputRef.current) return;
          
          if (!hasOpenShift) return;

          switch(e.key) {
              case 'F1': e.preventDefault(); addTab(); break;
              case 'F2': e.preventDefault(); refocusInput(); break;
              case 'F3': e.preventDefault(); setIsClientSelectorOpen(true); break;
              case 'F4': e.preventDefault(); if(confirm('¿Anular ticket actual?')) clearCart(); break;
              case 'F6': e.preventDefault(); applyWholesaleToLastItem(); break;
              case 'F7': {
                  e.preventDefault();
                  const lastItem = activeTab.items[activeTab.items.length - 1];
                  if (lastItem) {
                      const lastKey = lastItem.tierPlu ? `${lastItem.id}_${lastItem.tierPlu}` : lastItem.id;
                      setEditingItemId(lastKey);
                  }
                  break;
              }
              case 'F8': e.preventDefault(); setIsCashOpsOpen(true); break;
              case 'F9': e.preventDefault(); setIsMiscItemOpen(true); break; 
              case 'F12': e.preventDefault(); if (activeTab.items.length > 0) setIsPaymentOpen(true); break;
              case 'Escape': 
                  e.preventDefault();
                  setSearchTerm(''); 
                  setSearchResults([]); 
                  refocusInput();
                  break;
              default: break;
          }
      };
      
      window.addEventListener('keydown', handleGlobalKeys);
      return () => window.removeEventListener('keydown', handleGlobalKeys);
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasOpenShift, activeTab.items.length]); 

  const handleProcessSale = async (paymentData) => {
    if (saleCompletedRef.current) return; // 🛡️ Anti-doble-cobro por lag de React
    const result = await processSale(paymentData);
    if (result) {
        saleCompletedRef.current = true;
        const enrichedTicket = {
            ...result,
            companySnapshot: { nombre: user?.activeBranchName || 'MI NEGOCIO' }
        };
        setLastSaleTicket(enrichedTicket);
        setIsPaymentOpen(false);
        setSearchTerm('');
        const activeIndex = tabs.findIndex(t => t.id === activeTabId);
        if (tabs.length > 1 && activeIndex !== 0) removeTab(activeTabId, true);
        setTimeout(() => { saleCompletedRef.current = false; refocusInput(); }, 300);
    }
  };

  const handleProcessBudget = async () => {
    const result = await processBudget();
    if (result) {
        const enrichedTicket = {
            ...result,
            companySnapshot: { nombre: user?.activeBranchName || 'MI NEGOCIO' }
        };
        setLastSaleTicket(enrichedTicket);
        setIsPaymentOpen(false);
        setSearchTerm('');
        const activeIndex = tabs.findIndex(t => t.id === activeTabId);
        if (tabs.length > 1 && activeIndex !== 0) removeTab(activeTabId, true);
        setTimeout(refocusInput, 100);
        return true;
    }
    return false;
  };

  const formatQuantity = (qty, isWeighable) => {
      const num = parseFloat(qty);
      if (isNaN(num)) return '0';
      const cleanNum = Math.round(num * 1000) / 1000;
      if (cleanNum % 1 === 0) {
          return cleanNum.toString();
      }
      return cleanNum.toString();
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
    <div onClick={handlePosClick} className="h-[calc(100vh-4rem)] flex flex-col bg-sys-50 relative overflow-hidden">
      
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
                  {tab.items.length > 0 && (
                      <span className="absolute -top-1.5 -right-1 min-w-[18px] h-[18px] bg-emerald-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1 shadow-sm leading-none">
                          {tab.items.length}
                      </span>
                  )}
              </div>
          ))}
          <button onClick={addTab} className="ml-2 mb-1.5 p-1.5 bg-sys-50 text-sys-400 hover:text-brand hover:bg-brand/10 border border-sys-200 rounded-lg transition-all" title="Nueva Venta (F1)">
            <Plus size={18} />
          </button>
      </div>

      <div className="flex-1 flex overflow-hidden mb-8">
          
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
                          {activeTab.items.map((item) => {
                          // 🔥 Variantes "anexadas" comparten product.id con el padre — la key/edición
                          // tiene que distinguirlas por tierPlu o se pisan entre sí en la lista.
                          const lineKey = item.tierPlu ? `${item.id}_${item.tierPlu}` : item.id;
                          return (
                              <div key={lineKey} className={cn("group flex items-center gap-3 px-3 py-2.5 bg-white border rounded-xl shadow-sm hover:shadow-md transition-all animate-in fade-in slide-in-from-left-2", item.appliedWholesale ? "border-brand border-2 bg-brand/5" : "border-sys-100")}>

                                  {/* Cantidad editable */}
                                  <div
                                      className="w-14 shrink-0 text-center cursor-pointer rounded-lg hover:bg-sys-100 py-1 transition-colors"
                                      onClick={(e) => { e.stopPropagation(); setEditingItemId(lineKey); }}
                                      title="Click para editar cantidad"
                                  >
                                      {editingItemId === lineKey ? (
                                          <InlineQuantityEditor
                                              currentQty={item.quantity}
                                              isWeighable={item.isWeighable}
                                              onUpdate={(newQty) => {
                                                  if (typeof updateCartItemQuantity === 'function') {
                                                      updateCartItemQuantity(item.id, newQty, item.tierPlu);
                                                  } else {
                                                      removeFromCart(item.id, item.tierPlu);
                                                      setTimeout(() => addToCart(item, newQty), 50);
                                                  }
                                                  setEditingItemId(null);
                                                  refocusInput();
                                              }}
                                              onCancel={() => { setEditingItemId(null); refocusInput(); }}
                                          />
                                      ) : (
                                          <>
                                              <div className="text-xl font-black text-sys-900 leading-none">{formatQuantity(item.quantity, item.isWeighable)}</div>
                                              <div className="text-[9px] uppercase text-sys-400 font-black mt-0.5">{item.isWeighable ? 'KG' : 'UN'}</div>
                                          </>
                                      )}
                                  </div>

                                  {/* Info producto */}
                                  <div className="flex-1 min-w-0">
                                      <div className="text-sm font-black text-sys-900 truncate uppercase leading-tight">{item.name}</div>
                                      <div className="flex items-center gap-2 mt-0.5">
                                          {(item.appliedPromo || item.appliedWholesale) && (
                                              <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase", item.appliedWholesale ? "bg-orange-100 text-orange-700" : "bg-purple-100 text-purple-700")}>
                                                  {item.appliedWholesale ? <Percent size={9}/> : <Tag size={9}/>}
                                                  {item.promoLabel || "OFERTA"}
                                              </span>
                                          )}
                                          <span className="text-[10px] text-sys-400 font-mono">
                                              {item.originalPrice && item.originalPrice > item.price ? (
                                                  <><s className="opacity-40">${Number(item.originalPrice).toLocaleString('es-AR')}</s> ${(Number(item.price)||0).toLocaleString('es-AR')}</>
                                              ) : (
                                                  `$${(Number(item.price)||0).toLocaleString('es-AR')} × ${item.isWeighable ? 'kg' : 'u'}.`
                                              )}
                                          </span>
                                      </div>
                                  </div>

                                  {/* Subtotal + eliminar */}
                                  <div className="flex flex-col items-end gap-1 shrink-0">
                                      <div className="text-lg font-black text-sys-900 tabular-nums">
                                          ${(Number(item.subtotal) || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                      </div>
                                      <button
                                          onClick={(e) => { e.stopPropagation(); removeFromCart(item.id, item.tierPlu); }}
                                          className="text-red-300 hover:text-red-600 hover:bg-red-50 p-1 rounded-lg transition-all"
                                          title="Eliminar"
                                      >
                                          <Trash2 size={14}/>
                                      </button>
                                  </div>
                              </div>
                          );})}
                      </div>
                  )}
              </div>

              <div className="bg-white border-t border-sys-200 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] z-20 shrink-0">
                  <div className="px-5 pt-4 pb-3 flex items-center justify-between">
                      <div>
                          <p className="text-[10px] font-black text-sys-400 uppercase tracking-widest mb-0.5">Total a Cobrar</p>
                          <p className="text-5xl font-black text-sys-900 tracking-tighter tabular-nums leading-none">
                              ${(Number(totals?.total) || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                          </p>
                          {(Number(totals?.discountAmount) || 0) > 0 && (
                              <p className="text-xs font-bold text-green-600 mt-1">
                                  Ahorro: -${(Number(totals.discountAmount) || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                              </p>
                          )}
                      </div>
                      <Button
                          variant="ghost"
                          className="h-10 w-10 rounded-xl border border-red-100 text-red-400 hover:bg-red-50 hover:text-red-600 p-0 transition-all"
                          onClick={() => { if(confirm('¿Vacíar venta?')) clearCart(); }}
                          title="Vaciar carrito"
                      >
                          <Trash2 size={18}/>
                      </Button>
                  </div>
                  <div className="px-4 pb-4">
                      <Button
                          className="w-full h-14 text-xl rounded-2xl shadow-xl shadow-brand/20 active:scale-[0.98] transition-all flex items-center justify-center gap-3 font-black uppercase tracking-tighter disabled:opacity-40 disabled:shadow-none"
                          disabled={activeTab.items.length === 0}
                          onClick={() => setIsPaymentOpen(true)}
                      >
                          <DollarSign size={22} strokeWidth={3}/> COBRAR
                          <span className="opacity-40 text-[11px] font-mono ml-1">F12</span>
                      </Button>
                  </div>
              </div>
          </div>

          <div className="w-[440px] border-l border-sys-200 bg-white hidden md:flex flex-col z-0">
              <div className="p-4 border-b border-sys-100 bg-white flex gap-2">
                  <div className="relative group flex-1">
                      <Search className="absolute left-3 top-3.5 text-sys-400 group-focus-within:text-brand transition-colors" size={22} />
                      <input 
                          ref={searchInputRef} 
                          type="text" 
                          className="w-full pl-11 pr-4 py-3.5 bg-sys-50 border-2 border-transparent rounded-2xl outline-none focus:bg-white focus:border-brand transition-all font-black text-sys-900 uppercase text-lg placeholder:text-sys-300" 
                          placeholder="ESCANEÉ O BUSQUE..." 
                          value={searchTerm} 
                          onChange={(e) => setSearchTerm(e.target.value)} 
                          onKeyDown={handleKeyDownInput} 
                          autoFocus 
                          autoComplete="off" 
                      />
                  </div>
                  <Button variant="outline" onClick={() => setIsMiscItemOpen(true)} className="h-full aspect-square p-0 rounded-2xl border-2 border-sys-200 text-brand hover:border-brand hover:bg-brand/5 shadow-sm" title="Artículo Libre (F9)">
                      <Plus size={24} />
                  </Button>
              </div>

              <div ref={productsListRef} className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-sys-50/10">
                  {(searchTerm.length > 0 ? searchResults : defaultProducts).map((product, idx) => (
                      <div 
                          key={product.id}
                          onClick={() => handleSelectProduct(product)}
                          className={cn(
                              "group flex items-center justify-between p-5 rounded-2xl border-2 transition-all cursor-pointer shadow-sm",
                              idx === focusedIndex 
                                ? "bg-brand text-white border-brand shadow-xl scale-[1.02] translate-x-1" 
                                : "bg-white border-transparent hover:border-brand/30",
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
                  {searchTerm.length > 0 && searchResults.length === 0 && (
                      <div className="text-center py-20 text-sys-400 uppercase font-black text-xs opacity-30">
                          <PackageOpen size={60} className="mx-auto mb-4" strokeWidth={1} />
                          <p>Sin resultados</p>
                      </div>
                  )}
              </div>
          </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 h-9 bg-sys-950 border-t border-sys-800 text-sys-500 flex items-center px-5 z-50 text-[10px] font-mono justify-between select-none overflow-x-auto">
          <div className="flex gap-5 shrink-0">
              <span className="hover:text-white transition-colors cursor-default"><strong className="text-brand">F1</strong> NVA. CUENTA</span>
              <span className="hover:text-white transition-colors cursor-default"><strong className="text-brand">F2</strong> FOCO</span>
              <span className="hover:text-white transition-colors cursor-default"><strong className="text-brand">F3</strong> CLIENTE</span>
              <span className="hover:text-white transition-colors cursor-default"><strong className="text-brand">F4</strong> ANULAR</span>
              <span className="hover:text-emerald-300 transition-colors cursor-default"><strong className="text-emerald-500">F9</strong> ART. LIBRE</span>
              <span className="hover:text-blue-300 transition-colors cursor-default hidden sm:inline"><strong className="text-blue-400">F8</strong> CAJA</span>
              <span className="hover:text-orange-300 transition-colors cursor-default hidden md:inline"><strong className="text-orange-400">F6</strong> MAYORISTA</span>
              <span className="hover:text-white transition-colors cursor-default hidden md:inline"><strong className="text-brand">F7</strong> CANTIDAD</span>
          </div>
          <div className="flex items-center gap-5 shrink-0">
              <span className="hover:text-white transition-colors cursor-default"><strong className="text-sys-400">ESC</strong> LIMPIAR</span>
              <span className="bg-brand/20 text-brand border border-brand/30 px-3 py-0.5 rounded font-black tracking-widest"><strong>F12</strong> COBRAR</span>
          </div>
      </div>

      <MiscItemModal 
          isOpen={isMiscItemOpen} 
          onClose={() => { setIsMiscItemOpen(false); refocusInput(); }} 
          onConfirm={(product, qty) => { addToCart(product, qty); setIsMiscItemOpen(false); refocusInput(); }} 
      />
      
      <QuantityModal isOpen={!!selectedProduct} product={selectedProduct} onClose={() => { setSelectedProduct(null); refocusInput(); }} onConfirm={(product, qty) => { addToCart(product, qty); setSelectedProduct(null); refocusInput(); }} />
      
      <PaymentModal 
          isOpen={isPaymentOpen} 
          total={Number(totals?.total) || 0} 
          subtotal={Number(totals?.subtotal) || 0} 
          discount={Number(totals?.discountAmount) || 0} 
          client={activeTab.client} 
          posConfig={posConfig} 
          onClose={() => { setIsPaymentOpen(false); refocusInput(); }} 
          onConfirm={handleProcessSale} 
          isProcessing={isProcessing} 
          processBudget={handleProcessBudget} 
          setTabPaymentMethod={setTabPaymentMethod} 
      />
      
      <CashOperationsModal 
          isOpen={isCashOpsOpen} 
          onClose={() => { setIsCashOpsOpen(false); refocusInput(); }} 
      />

      <ClientSelectionModal isOpen={isClientSelectorOpen} onClose={() => { setIsClientSelectorOpen(false); refocusInput(); }} onSelect={(c) => { setClient(c); setIsClientSelectorOpen(false); refocusInput(); }} />
      <TicketModal isOpen={!!lastSaleTicket} sale={lastSaleTicket} onClose={() => { setLastSaleTicket(null); refocusInput(); }} companyConfig={{ nombre: user?.activeBranchName }} />
    </div>
  );
};