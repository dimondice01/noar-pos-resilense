import React, { useEffect, useState, useRef, useCallback } from 'react';
import { 
  Search, Trash2, ShoppingCart, PackageOpen, 
  Keyboard, User, 
  DollarSign, ChevronRight, Plus 
} from 'lucide-react';

// Repositorios y Servicios
import { productRepository } from '../../inventory/repositories/productRepository';
import { salesRepository } from '../../sales/repositories/salesRepository';
import { billingService } from '../../billing/services/billingService';
import { cashRepository } from '../../cash/repositories/cashRepository';
import { clientRepository } from '../../clients/repositories/clientRepository';

// Componentes del POS
import { QuantityModal } from '../components/QuantityModal';
import { PaymentModal } from '../components/PaymentModal';
import { ClientSelectionModal } from '../components/ClientSelectionModal'; 

// Componente del Ticket
import { TicketModal } from '../../sales/components/TicketModal';

// Stores
import { useCartStore } from '../store/useCartStore';
import { useAuthStore } from '../../auth/store/useAuthStore';

// UI Core
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

export const PosPage = () => {
  // ==========================================
  // ESTADOS Y REFS
  // ==========================================
  const [products, setProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1); // Para navegación con flechas
  
  const [client, setClient] = useState(null); 
  const [discount, setDiscount] = useState(0); 

  const searchInputRef = useRef(null);
  const productsListRef = useRef(null);
  
  const [selectedProduct, setSelectedProduct] = useState(null); 
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isClientSelectorOpen, setIsClientSelectorOpen] = useState(false);
  
  const [isProcessingSale, setIsProcessingSale] = useState(false);
  const [lastSaleTicket, setLastSaleTicket] = useState(null);      
  
  const { cart, addItem, removeItem, getTotal, clearCart } = useCartStore();
  const { user } = useAuthStore(); 

  // 🔥 CÁLCULOS MATEMÁTICOS SEGUROS
  const subtotal = getTotal();
  // Redondeamos a 2 decimales para evitar 99.99999999
  const totalFinalRaw = subtotal * (1 - discount / 100);
  const totalFinal = Math.round((totalFinalRaw + Number.EPSILON) * 100) / 100;

  // 🔥 HELPER 1: FORMATEO MONEDA (Limpio: sin decimales si es entero)
  const formatMoney = (amount) => {
    return amount.toLocaleString('es-AR', {
        minimumFractionDigits: 0, 
        maximumFractionDigits: 2  
    });
  };

  // 🔥 HELPER 2: FORMATEO STOCK/CANTIDAD (Max 3 decimales, sin ceros extra)
  const formatStock = (value) => {
    if (!value) return '0';
    // parseFloat convierte "0.35000000001" -> 0.35
    return parseFloat(Number(value).toFixed(3));
  };

  // ==========================================
  // CARGA DE DATOS
  // ==========================================
  
  const loadProducts = useCallback(async () => {
    try {
      const all = await productRepository.getAll();
      setProducts(all || []);
    } catch (error) {
      console.error("Error cargando catálogo:", error);
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // Mantener foco en el buscador (UX Clásica de POS)
  const keepFocus = () => {
    if (!isPaymentOpen && !selectedProduct && !lastSaleTicket && !isClientSelectorOpen) {
      setTimeout(() => {
        if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'BUTTON') {
           searchInputRef.current?.focus();
        }
      }, 200);
    }
  };

  // ==========================================
  // LÓGICA DE BÚSQUEDA Y NAVEGACIÓN
  // ==========================================
  
  const filteredProducts = products.filter(p => {
    const term = searchTerm.toLowerCase();
    const name = (p.name || '').toLowerCase();
    const code = (p.code || '').toString().toLowerCase(); 
    return name.includes(term) || code.includes(term);
  });

  // Resetear índice al buscar
  useEffect(() => {
    setFocusedIndex(-1);
  }, [searchTerm]);

  // Scroll automático al ítem seleccionado con flechas
  useEffect(() => {
    if (focusedIndex >= 0 && productsListRef.current) {
        const activeItem = productsListRef.current.children[focusedIndex];
        if (activeItem) {
            activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }
  }, [focusedIndex]);

  // 🔥 CORE: Lógica de Selección Unitario vs Pesable
  const handleSelectProduct = useCallback((product) => {
    if (!product) return;
    
    // Validación de Stock
    if (parseFloat(product.stock || 0) <= 0) {
        alert(`⛔ SIN STOCK: ${product.name}\nNo quedan unidades disponibles.`);
        setSearchTerm('');
        return;
    }

    // Decisión Modal vs Directo
    if (product.isWeighable) {
        // Es pesable: Abrimos modal para poner kg
        setSelectedProduct(product);
    } else {
        // Es unitario: Agregamos 1 directo (Efecto Pistola Código de Barras)
        addItem(product, 1, product.price);
        setSearchTerm(''); 
        setFocusedIndex(-1);
        // Aseguramos foco inmediato para el siguiente producto
        setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [addItem]);

  const handleKeyDownInput = (e) => {
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex(prev => (prev < filteredProducts.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex(prev => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === 'Enter') {
        e.preventDefault();
        
        // 1. Si hay un ítem seleccionado con flechas, úsalo
        if (focusedIndex >= 0 && filteredProducts[focusedIndex]) {
            handleSelectProduct(filteredProducts[focusedIndex]);
            return;
        }

        // 2. Si no, busca coincidencia exacta o único resultado
        const term = searchTerm.trim();
        if (!term) return;

        // Busqueda exacta por código primero (Prioridad Scanner)
        const exactMatch = products.find(p => (p.code || '').toString() === term);
        
        if (exactMatch) {
            handleSelectProduct(exactMatch);
        } else if (filteredProducts.length === 1) {
            handleSelectProduct(filteredProducts[0]);
        }
    }
  };

  const handleQuantityConfirm = (product, quantity, price) => {
    addItem(product, quantity, price);
    setSelectedProduct(null);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  const handleCloseQuantity = () => {
    setSelectedProduct(null);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  const handleOpenClientSelector = () => {
    setIsClientSelectorOpen(true);
  };

  const handleDiscount = () => {
    const disc = prompt("Ingrese porcentaje de descuento (0-100):", discount);
    if (disc !== null && !isNaN(disc)) {
        setDiscount(Math.min(100, Math.max(0, parseFloat(disc))));
    }
  };

  // Teclas Globales
  useEffect(() => {
    const handleGlobalKeys = (e) => {
      if (isProcessingSale || isClientSelectorOpen) return;

      switch(e.key) {
        case 'F2': e.preventDefault(); searchInputRef.current?.focus(); break;
        case 'F3': e.preventDefault(); handleOpenClientSelector(); break;
        case 'F4': 
          e.preventDefault();
          if (cart.length > 0 && confirm('¿Vaciar carrito actual?')) {
            clearCart();
            setDiscount(0);
            setClient(null);
            searchInputRef.current?.focus();
          }
          break;
        case 'F6': e.preventDefault(); handleDiscount(); break;
        case 'F12': 
          e.preventDefault();
          if (cart.length > 0 && !selectedProduct && !isPaymentOpen) {
            setIsPaymentOpen(true);
          }
          break;
        case 'Escape':
          if (document.activeElement === searchInputRef.current) searchInputRef.current?.blur();
          break;
      }
    };

    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [cart, isProcessingSale, selectedProduct, isPaymentOpen, clearCart, client, discount, isClientSelectorOpen]);

  // ==========================================
  // CONFIRMACIÓN DE PAGO
  // ==========================================
  const handlePaymentConfirm = async (paymentData) => {
    setIsProcessingSale(true);
    
    try {
      if (paymentData.amountPaid > 0) {
          const shift = await cashRepository.getCurrentShift();
          if (!shift) {
              alert("⛔ BLOQUEO DE SEGURIDAD:\nNo hay una caja abierta.");
              setIsProcessingSale(false);
              return;
          }
      }
      
      const docNroForAfip = client?.docNumber || "0";
      const saleClient = { 
          id: client?.id || null, 
          name: client?.name || 'CONSUMIDOR FINAL',
          docNumber: docNroForAfip,
          docType: client?.docType || '99'
      };

      let afipData = null;
      if (paymentData.withAfip) {
        try {
          const tempSaleForAfip = {
            total: paymentData.totalSale, 
            client: { docNumber: docNroForAfip } 
          };
          
          const factura = await billingService.emitirFactura(tempSaleForAfip);
          
          afipData = {
            status: 'APPROVED',
            cae: factura.cae,
            cbteNumero: factura.numero,
            cbteLetra: factura.tipo,
            qr: factura.qr_data,
            vtoCAE: factura.vto
          };
          
        } catch (afipError) {
          console.error("Fallo AFIP:", afipError);
          alert(`⚠️ Alerta: AFIP no respondió.\nError: ${afipError.message}`);
          afipData = { status: 'PENDING', error: afipError.message };
        }
      }

      const saleData = {
        items: cart,
        total: paymentData.totalSale,
        subtotal: subtotal,
        discount: discount,
        payment: {
            method: paymentData.method,
            amountPaid: paymentData.amountPaid, 
            amountDebt: paymentData.amountDebt, 
            total: paymentData.totalSale        
        },
        client: saleClient,
        sellerName: user?.name || 'Cajero', 
        itemCount: cart.length,
        date: new Date(),
        afip: afipData || { status: 'SKIPPED' } 
      };

      const savedSale = await salesRepository.createSale(saleData);

      const promises = []; 
      if (paymentData.amountPaid > 0) {
          promises.push(
              cashRepository.registerIncome(
                  paymentData.amountPaid,                                     
                  paymentData.method,                                         
                  `Venta #${savedSale.localId.slice(-6)}`                 
              )
          );
      }

      if (paymentData.amountDebt > 0 && client?.id) {
          promises.push(
              clientRepository.registerMovement(
                  client.id,
                  'SALE_DEBT',
                  paymentData.amountDebt,
                  `Saldo Venta #${savedSale.localId.slice(-6)}`,
                  savedSale.localId
              )
          );
      }

      await Promise.all(promises);
      
      // 🔥 CRITICO: Actualizar stock VISUALMENTE
      await loadProducts();

      clearCart();
      setDiscount(0);
      setClient(null);
      setIsPaymentOpen(false);
      setLastSaleTicket(savedSale);

    } catch (error) {
      console.error("❌ Error Crítico:", error);
      alert(`Error crítico: ${error.message}`);
    } finally {
      setIsProcessingSale(false);
    }
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex gap-6 relative flex-col pb-12 bg-sys-50/50" onClick={keepFocus}>
      
      {/* AREA DE TRABAJO (TICKET + LISTA) */}
      <div className="flex-1 flex flex-col-reverse md:flex-row gap-4 min-h-0 p-4">
        
        {/* ======================================================= */}
        {/* 1. TICKET (AHORA A LA IZQUIERDA / CENTRO - PROTAGONISTA) */}
        {/* ======================================================= */}
        <div className="flex-1 bg-white rounded-2xl shadow-soft border border-sys-200 flex flex-col overflow-hidden relative z-10 w-full">
          
          {/* Header Ticket: Cliente */}
          <div className="bg-white border-b border-sys-100 p-3 shrink-0 flex items-center justify-between">
             <button 
                onClick={handleOpenClientSelector}
                className={cn(
                    "flex items-center gap-3 px-3 py-1.5 rounded-xl transition-all border group min-w-[240px]",
                    client 
                        ? "bg-brand-light/10 border-brand/20 text-brand-hover" 
                        : "bg-sys-50 border-sys-200 text-sys-500 hover:border-sys-300"
                )}
            >
                <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors",
                    client ? "bg-brand text-white" : "bg-white border border-sys-200 text-sys-400"
                )}>
                    <User size={16} />
                </div>
                <div className="flex flex-col items-start min-w-0 text-left">
                    <span className="text-[9px] font-bold uppercase tracking-wider opacity-70">
                        {client ? (client.docType === '80' ? 'Factura A' : 'Consumidor Final') : 'Cliente (F3)'}
                    </span>
                    <span className="text-sm font-bold truncate max-w-[180px]">
                        {client ? client.name : "Seleccionar Cliente..."}
                    </span>
                </div>
                <ChevronRight size={14} className="opacity-50 ml-auto" />
            </button>

            <div className="text-right hidden md:block px-2">
                <p className="text-[10px] text-sys-400 font-bold uppercase">Cajero</p>
                <p className="text-xs font-bold text-sys-700 bg-sys-100 px-2 py-0.5 rounded-full">{user?.name || 'Operador'}</p>
            </div>
          </div>

          {/* Cuerpo Ticket: Lista de Items */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-white/50">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-sys-300 gap-3 opacity-60">
                 <div className="w-20 h-20 bg-sys-100 rounded-full flex items-center justify-center">
                   <ShoppingCart size={32} className="opacity-40" />
                 </div>
                 <p className="font-medium text-base">Su ticket está vacío</p>
                 <p className="text-sm">Escanee un producto o búsquelo en la lista</p>
              </div>
            ) : (
              cart.map((item) => (
                <div key={item.cartId} className="group flex items-center p-2 bg-white hover:bg-sys-50 rounded-lg transition-all border border-sys-100 hover:border-sys-200 shadow-sm animate-in slide-in-from-left-2 duration-200">
                  {/* Cantidad Badge */}
                  <div className="w-10 h-10 bg-sys-100 rounded-md flex flex-col items-center justify-center shrink-0 border border-sys-200 text-sys-700 font-mono">
                      {/* 🔥 APLICACIÓN DE FORMATSTOCK EN CANTIDAD TICKET */}
                      <span className="text-base font-bold leading-none">{formatStock(item.quantity)}</span>
                      <span className="text-[8px] uppercase opacity-70">{item.isWeighable ? 'KG' : 'UN'}</span>
                  </div>
                  
                  <div className="flex-1 min-w-0 px-3">
                    <p className="text-sm font-bold text-sys-900 truncate leading-tight">{item.name}</p>
                    <div className="flex items-center gap-2 text-xs text-sys-500 mt-0.5">
                      <span className="font-mono text-[10px] bg-sys-50 px-1 rounded text-sys-600 border border-sys-100">
                        {item.code}
                      </span>
                      {/* 🔥 TICKET: PRECIO FORMATEADO */}
                      <span>x ${formatMoney(item.price)}</span>
                    </div>
                  </div>

                  <div className="text-right">
                    {/* 🔥 TICKET: SUBTOTAL FORMATEADO */}
                    <p className="font-black text-sys-900 text-base tracking-tight">
                      $ {formatMoney(item.subtotal)}
                    </p>
                    <button onClick={() => removeItem(item.cartId)} className="text-[10px] font-medium text-red-500 hover:text-red-700 hover:underline opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-end gap-1 ml-auto mt-0.5">
                      <Trash2 size={10}/> Quitar
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer Ticket: Optimizado */}
          <div className="bg-white border-t border-sys-200 p-4 z-10 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
            <div className="flex justify-between items-end mb-3">
                <div className="flex flex-col">
                    <span className="text-xs text-sys-500 font-bold uppercase tracking-wider mb-1">Total a Pagar</span>
                    {discount > 0 && <span className="text-[10px] text-green-600 font-bold bg-green-50 px-1.5 py-0.5 rounded self-start mb-1">Desc. {discount}%</span>}
                    {/* 🔥 TICKET: TOTAL FORMATEADO */}
                    <span className="text-4xl font-black text-sys-900 tracking-tighter leading-none">$ {formatMoney(totalFinal)}</span>
                </div>
                
                <div className="flex gap-2 items-end">
                    <button onClick={() => { if(confirm('¿Borrar todo?')) { clearCart(); setDiscount(0); setClient(null); } }} className="w-12 h-12 rounded-xl border border-red-100 text-red-500 hover:bg-red-50 hover:text-red-600 flex items-center justify-center transition-colors" title="Cancelar Venta (F4)">
                        <Trash2 size={20} />
                    </button>
                    <Button 
                        className="h-12 px-6 text-lg shadow-lg shadow-brand/20 active:scale-[0.98] transition-transform flex items-center gap-2 rounded-xl"
                        disabled={cart.length === 0}
                        onClick={() => setIsPaymentOpen(true)}
                    >
                        <DollarSign size={20} strokeWidth={3}/> COBRAR
                        <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] font-mono opacity-90 font-bold border border-white/10 ml-1">F12</span>
                    </Button>
                </div>
            </div>
          </div>
        </div>

        {/* ======================================================= */}
        {/* 2. CATÁLOGO (SIDEBAR DERECHA)                            */}
        {/* ======================================================= */}
        <div className="w-full md:w-[380px] flex flex-col min-w-0 bg-white border-l border-sys-200 shadow-xl fixed right-0 top-16 bottom-12 z-20 md:relative md:top-0 md:bottom-0 md:shadow-none md:border md:rounded-2xl">
          
          {/* Buscador */}
          <div className="p-3 border-b border-sys-100 bg-white z-10">
            <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400 group-focus-within:text-brand transition-colors" size={18} />
                <input 
                  ref={searchInputRef}
                  type="text" 
                  placeholder="Buscar producto (F2)..." 
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-sys-200 bg-sys-50 focus:bg-white focus:border-brand focus:ring-4 focus:ring-brand/10 outline-none transition-all text-sm font-medium shadow-sm"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={handleKeyDownInput}
                  autoFocus
                  autoComplete="off"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-1 pointer-events-none">
                    <span className="text-[10px] text-sys-300 border border-sys-200 rounded px-1">↓</span>
                    <span className="text-[10px] text-sys-300 border border-sys-200 rounded px-1">↑</span>
                </div>
            </div>
          </div>

          {/* Lista de Productos (Estilo Renglón Elegante) */}
          <div ref={productsListRef} className="flex-1 overflow-y-auto px-2 py-2 space-y-1 custom-scrollbar bg-sys-50/30">
            {filteredProducts.length > 0 ? (
              filteredProducts.map((product, index) => {
                const hasStock = parseFloat(product.stock || 0) > 0;
                
                return (
                  <div 
                      key={product.id} 
                      onClick={() => handleSelectProduct(product)}
                      className={cn(
                          "group flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all active:scale-[0.98]",
                          index === focusedIndex 
                              ? "bg-brand text-white border-brand shadow-md transform scale-[1.02]" 
                              : "bg-white hover:bg-brand-light/10 border-transparent hover:border-brand/20",
                          !hasStock && "opacity-60 grayscale"
                      )}
                  >
                      <div className="flex-1 min-w-0 pr-3">
                          <div className="flex justify-between items-start">
                              <h4 className={cn("font-bold text-sm truncate transition-colors", index === focusedIndex ? "text-white" : "text-sys-800 group-hover:text-brand")}>{product.name}</h4>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                              <span className={cn("text-[10px] font-mono px-1 rounded", index === focusedIndex ? "bg-white/20 text-white" : "bg-sys-50 text-sys-400")}>{product.code}</span>
                              <span className={cn("text-[10px] font-bold px-1.5 rounded", 
                                  index === focusedIndex ? "bg-white/20 text-white" : 
                                  product.stock <= (product.minStock || 5) ? "text-red-600 bg-red-50" : "text-green-600 bg-green-50"
                              )}>
                                  {/* 🔥 LISTA: STOCK FORMATEADO */}
                                  {formatStock(product.stock)} {product.isWeighable ? 'kg' : 'un'}
                              </span>
                          </div>
                      </div>
                      <div className="text-right">
                          {/* 🔥 LISTA: PRECIO FORMATEADO */}
                          <span className={cn("block font-bold text-sm", index === focusedIndex ? "text-white" : "text-sys-900")}>$ {formatMoney(product.price)}</span>
                          <div className={cn("mt-1 transition-opacity", index === focusedIndex ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                              <div className={cn("w-5 h-5 rounded-full flex items-center justify-center shadow-sm ml-auto", index === focusedIndex ? "bg-white text-brand" : "bg-brand text-white")}>
                                  <Plus size={12} strokeWidth={3} />
                              </div>
                          </div>
                      </div>
                  </div>
                );
              })
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-sys-400 p-6 text-center">
                <PackageOpen size={48} strokeWidth={1} className="mb-4 opacity-30" />
                <p className="text-sm font-medium">Sin resultados</p>
                <p className="text-xs opacity-70">Prueba con otro código o nombre</p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* 2. BARRA DE COMANDOS */}
      <div className="fixed bottom-0 left-0 right-0 md:left-64 h-10 bg-sys-900 flex items-center px-4 gap-6 text-[11px] font-medium text-sys-300 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-50 overflow-x-auto no-scrollbar border-t border-sys-700">
         <div className="flex items-center gap-1.5 shrink-0"><Keyboard size={14} className="text-brand" /><span className="text-white font-bold tracking-wide">COMANDOS:</span></div>
         <div className="h-4 w-[1px] bg-sys-700 shrink-0"></div>
         <div className="flex items-center gap-1 shrink-0"><span className="bg-sys-800 text-white px-1.5 rounded border border-sys-600 font-mono">F2</span> <span>Buscar</span></div>
         <div className="flex items-center gap-1 shrink-0"><span className="bg-sys-800 text-white px-1.5 rounded border border-sys-600 font-mono">F3</span> <span>Cliente</span></div>
         <div className="flex items-center gap-1 shrink-0"><span className="bg-sys-800 text-white px-1.5 rounded border border-sys-600 font-mono">F4</span> <span>Limpiar</span></div>
         <div className="flex items-center gap-1 shrink-0"><span className="bg-sys-800 text-white px-1.5 rounded border border-sys-600 font-mono">F6</span> <span>Descuento</span></div>
         <div className="flex items-center gap-1 shrink-0"><span className="bg-brand text-white px-1.5 rounded border border-brand-hover font-mono font-bold">F12</span> <span className="text-white font-bold">COBRAR</span></div>
         <div className="flex-1"></div>
         <div className="flex items-center gap-2 text-sys-500 shrink-0">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            <span>Sistema Online</span>
         </div>
      </div>

      {/* MODALES */}
      {isProcessingSale && (
        <div className="absolute inset-0 z-[80] bg-white/80 backdrop-blur-sm flex items-center justify-center rounded-2xl animate-in fade-in">
           <div className="flex flex-col items-center p-8">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-sys-200 border-t-brand mb-4"></div>
              <p className="font-bold text-lg text-sys-900">Procesando Venta...</p>
           </div>
        </div>
      )}

      <QuantityModal 
        isOpen={!!selectedProduct}
        product={selectedProduct}
        onClose={handleCloseQuantity}
        onConfirm={handleQuantityConfirm}
      />

      <PaymentModal 
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        total={totalFinal}
        client={client} 
        onConfirm={handlePaymentConfirm}
      />

      <ClientSelectionModal 
        isOpen={isClientSelectorOpen}
        onClose={() => { setIsClientSelectorOpen(false); setTimeout(() => searchInputRef.current?.focus(), 100); }}
        onSelect={(c) => setClient(c)}
      />

      <TicketModal 
        isOpen={!!lastSaleTicket}
        sale={lastSaleTicket}
        onClose={() => { setLastSaleTicket(null); setTimeout(() => searchInputRef.current?.focus(), 100); }}
      />

    </div>
  );
};