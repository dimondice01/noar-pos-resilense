import React, { useEffect, useState, useRef, useCallback } from 'react';
import { 
  Search, Trash2, ShoppingCart, PackageOpen, 
  Keyboard, Barcode, User, Tag, PauseCircle, 
  RotateCcw, DollarSign, ChevronRight 
} from 'lucide-react';

// Repositorios y Servicios
import { productRepository } from '../../inventory/repositories/productRepository';
import { salesRepository } from '../../sales/repositories/salesRepository';
import { billingService } from '../../billing/services/billingService';
import { cashRepository } from '../../cash/repositories/cashRepository';
import { clientRepository } from '../../clients/repositories/clientRepository';

// Componentes del POS
import { ProductCard } from '../components/ProductCard';
import { QuantityModal } from '../components/QuantityModal';
import { PaymentModal } from '../components/PaymentModal';
import { ClientSelectionModal } from '../components/ClientSelectionModal'; 

// Componente del Ticket
import { TicketModal } from '../../sales/components/TicketModal';

// Store Global
import { useCartStore } from '../store/useCartStore';

// UI Core
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

export const PosPage = () => {
  // ==========================================
  // ESTADOS Y REFS
  // ==========================================
  const [products, setProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [client, setClient] = useState(null); 
  const [discount, setDiscount] = useState(0); 

  const searchInputRef = useRef(null);
  
  const [selectedProduct, setSelectedProduct] = useState(null); 
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isClientSelectorOpen, setIsClientSelectorOpen] = useState(false);
  
  const [isProcessingSale, setIsProcessingSale] = useState(false);
  const [lastSaleTicket, setLastSaleTicket] = useState(null);      
  
  const { cart, addItem, removeItem, getTotal, clearCart } = useCartStore();

  const subtotal = getTotal();
  const totalFinal = subtotal * (1 - discount / 100);

  // ==========================================
  // CARGA DE DATOS
  // ==========================================
  useEffect(() => {
    const loadProducts = async () => {
      try {
        const all = await productRepository.getAll();
        setProducts(all);
      } catch (error) {
        console.error("Error cargando catálogo:", error);
      }
    };
    loadProducts();
  }, []);

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
  // LÓGICA DE ESCÁNER Y BÚSQUEDA
  // ==========================================
  
  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.code.includes(searchTerm)
  );

  const handleSelectProduct = useCallback((product) => {
    if (!product) return;
    setSelectedProduct(product);
    setSearchTerm(''); 
  }, []);

  const handleKeyDownInput = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const exactMatch = products.find(p => p.code === searchTerm.trim());
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

  const handleSuspend = () => {
      if (cart.length === 0) return;
      if (confirm("¿Suspender venta actual y limpiar carrito?")) {
          clearCart();
          setClient(null);
          setDiscount(0);
      }
  };

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
        case 'F8': e.preventDefault(); handleSuspend(); break;
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
  // PROCESAMIENTO DE VENTA (CORE FINANCIERO)
  // ==========================================
  const handlePaymentConfirm = async (paymentData) => {
    // paymentData: { method, totalSale, amountPaid, amountDebt, withAfip }
    setIsProcessingSale(true);
    
    try {
      // 1. VALIDACIÓN DE CAJA
      if (paymentData.amountPaid > 0) {
          const shift = await cashRepository.getCurrentShift();
          if (!shift) {
              alert("⛔ BLOQUEO DE SEGURIDAD:\nNo hay una caja abierta. Debe abrir turno para recibir dinero.");
              setIsProcessingSale(false);
              return;
          }
      }

      // 2. PREPARAR DATOS DEL CLIENTE
      const saleClient = client ? {
          id: client.id,
          name: client.name,
          docType: client.docType,
          docNumber: client.docNumber,
          fiscalCondition: client.fiscalCondition,
          address: client.address
      } : {
          name: "CONSUMIDOR FINAL",
          docType: "99",
          docNumber: "0",
          fiscalCondition: "CONSUMIDOR_FINAL"
      };

      // 3. FACTURACIÓN AFIP
      let afipData = null;
      if (paymentData.withAfip) {
        try {
          const factura = await billingService.emitirFactura({
            total: paymentData.totalSale,
            client: saleClient
          });
          
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
          alert("⚠️ Alerta AFIP: No respondió o rechazó.\nSe guardará la venta como PENDIENTE DE FACTURACIÓN.");
          afipData = { status: 'PENDING', error: afipError.message };
        }
      }

      // 4. GUARDAR VENTA LOCALMENTE (🔥 CORREGIDO ESTRUCTURA PAYMENT)
      const saleData = {
        items: cart,
        total: paymentData.totalSale,
        subtotal: subtotal,
        discount: discount,
        
        // ⚠️ CORRECCIÓN: Estructuramos el pago como objeto para que TicketModal lo lea bien
        payment: {
            method: paymentData.method,
            amountPaid: paymentData.amountPaid, // Lo que pagó
            amountDebt: paymentData.amountDebt, // Lo que debe
            total: paymentData.totalSale        // Total operación
        },

        client: saleClient,
        itemCount: cart.length,
        date: new Date(),
        afip: afipData || { status: 'SKIPPED' } 
      };

      const savedSale = await salesRepository.createSale(saleData);

      // 5. MOVIMIENTOS FINANCIEROS
      const promises = [];

      // A) Ingreso de Caja
      if (paymentData.amountPaid > 0) {
          promises.push(
              cashRepository.registerIncome({
                  amount: paymentData.amountPaid,
                  description: `Venta #${savedSale.localId.slice(-6)}`,
                  referenceId: savedSale.localId,
                  method: paymentData.method
              })
          );
      }

      // B) Registro de Deuda
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

      // 6. FINALIZACIÓN
      console.log("✅ Venta y Movimientos registrados con éxito");
      
      clearCart();
      setDiscount(0);
      setClient(null);
      setIsPaymentOpen(false);
      setLastSaleTicket(savedSale);

    } catch (error) {
      console.error("❌ Error Crítico:", error);
      alert(`Error crítico al procesar la venta: ${error.message}`);
    } finally {
      setIsProcessingSale(false);
    }
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex gap-6 relative flex-col pb-12" onClick={keepFocus}>
      
      {/* 1. ÁREA DE TRABAJO (Split View) */}
      <div className="flex-1 flex gap-6 min-h-0">
        
        {/* === IZQUIERDA: CATÁLOGO === */}
        <div className="flex-1 flex flex-col min-w-0">
          
          <div className="mb-4 relative group shrink-0">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-sys-400 group-focus-within:text-brand transition-colors">
              <Barcode className="w-6 h-6" />
            </div>
            <input 
              ref={searchInputRef}
              type="text" 
              placeholder="Escanear producto o buscar (F2)..." 
              className="w-full pl-12 pr-4 py-4 rounded-xl border-2 border-sys-200 bg-white focus:border-brand focus:ring-4 focus:ring-brand/10 outline-none shadow-sm transition-all text-xl font-medium text-sys-900 placeholder:text-sys-300"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleKeyDownInput}
              autoFocus
              autoComplete="off"
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex gap-2">
               <span className="text-[10px] bg-sys-100 text-sys-500 px-2 py-1 rounded border border-sys-200 font-mono hidden md:block">
                 ESCÁNER LISTO
               </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 no-scrollbar pb-4">
            {filteredProducts.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredProducts.map(product => (
                  <ProductCard 
                    key={product.id} 
                    product={product} 
                    onClick={handleSelectProduct} 
                  />
                ))}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-sys-400">
                <PackageOpen size={64} strokeWidth={1} className="mb-4 opacity-30" />
                <p className="text-lg font-medium">Catálogo vacío o sin resultados</p>
                <p className="text-sm opacity-70">Intenta buscar otro término</p>
              </div>
            )}
          </div>
        </div>

        {/* === DERECHA: TICKET === */}
        <div className="w-[420px] bg-white rounded-2xl shadow-soft border border-sys-200 flex flex-col overflow-hidden shrink-0 h-full relative z-10">
          
          <div className="bg-sys-50/50 border-b border-sys-100 p-3 shrink-0">
             <button 
                onClick={handleOpenClientSelector}
                className={cn(
                    "w-full flex items-center justify-between p-3 rounded-xl transition-all border group",
                    client 
                        ? "bg-brand-light/20 border-brand/20 text-brand-hover" 
                        : "bg-white border-sys-200 text-sys-500 hover:border-sys-300"
                )}
            >
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className={cn(
                        "w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors",
                        client ? "bg-brand text-white" : "bg-sys-100 text-sys-400 group-hover:bg-sys-200"
                    )}>
                        <User size={18} />
                    </div>
                    <div className="flex flex-col items-start min-w-0">
                        <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
                            {client ? (client.docType === '80' ? 'Empresa / Resp. Insc.' : 'Cliente Final') : 'Cliente'}
                        </span>
                        <span className="text-sm font-bold truncate w-full text-left">
                            {client ? client.name : "Consumidor Final"}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono bg-white/50 border px-1.5 rounded opacity-60">F3</span>
                    <ChevronRight size={16} className="opacity-50" />
                </div>
            </button>
          </div>

          <div className="px-4 py-2 border-b border-sys-100 flex justify-between items-center bg-white text-xs text-sys-500">
             <span className="font-medium flex gap-1"><ShoppingCart size={14}/> Carrito</span>
             <span className="bg-sys-100 px-2 py-0.5 rounded-full font-mono">{cart.length} items</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-white">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-sys-300 gap-2">
                 <div className="w-20 h-20 bg-sys-50 rounded-full flex items-center justify-center">
                   <ShoppingCart size={32} className="opacity-50" />
                 </div>
                 <p className="font-medium text-sm">Carrito vacío</p>
              </div>
            ) : (
              cart.map((item) => (
                <div key={item.cartId} className="group flex justify-between items-center p-3 hover:bg-sys-50 rounded-xl transition-colors border border-transparent hover:border-sys-200 cursor-default">
                  <div className="flex-1 min-w-0 pr-3">
                    <p className="text-sm font-bold text-sys-800 truncate">{item.name}</p>
                    <div className="flex items-center gap-2 text-xs text-sys-500 mt-0.5">
                      <span className="bg-sys-100 px-1.5 rounded font-mono text-sys-700">
                        {item.isWeighable ? item.quantity.toFixed(3) : item.quantity} {item.isWeighable ? 'kg' : 'un'}
                      </span>
                      <span>x ${item.price}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-sys-900 text-sm">
                      $ {item.subtotal.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                    </p>
                    <button onClick={() => removeItem(item.cartId)} className="text-[10px] text-red-500 hover:underline opacity-0 group-hover:opacity-100 transition-opacity">
                      Eliminar
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="bg-sys-50 border-t border-sys-200 shrink-0 z-10">
            <div className="flex border-b border-sys-200 divide-x divide-sys-200">
                <button onClick={handleDiscount} className="flex-1 py-2 text-[10px] font-bold text-sys-600 hover:bg-sys-100 flex flex-col items-center gap-1 transition-colors">
                    <Tag size={14} className="text-blue-500" /> {discount > 0 ? `${discount}% OFF` : 'Descuento (F6)'}
                </button>
                <button onClick={handleSuspend} className="flex-1 py-2 text-[10px] font-bold text-sys-600 hover:bg-sys-100 flex flex-col items-center gap-1 transition-colors">
                    <PauseCircle size={14} className="text-orange-500" /> Suspender (F8)
                </button>
                <button onClick={() => { if(confirm('¿Borrar todo?')) { clearCart(); setDiscount(0); setClient(null); } }} className="flex-1 py-2 text-[10px] font-bold text-sys-600 hover:bg-red-50 hover:text-red-600 flex flex-col items-center gap-1 transition-colors">
                    <Trash2 size={14} /> Limpiar (F4)
                </button>
            </div>

            <div className="p-5">
                <div className="space-y-1 mb-4">
                    <div className="flex justify-between text-xs text-sys-500">
                        <span>Subtotal</span>
                        <span>$ {subtotal.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                    </div>
                    {discount > 0 && (
                        <div className="flex justify-between text-xs text-green-600 font-bold">
                            <span>Descuento ({discount}%)</span>
                            <span>- $ {(subtotal * discount / 100).toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                        </div>
                    )}
                    <div className="flex justify-between items-end pt-2 border-t border-sys-200">
                        <span className="text-sys-800 font-bold">Total Final</span>
                        <span className="text-4xl font-black text-sys-900 tracking-tighter leading-none">
                            $ {totalFinal.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                        </span>
                    </div>
                </div>
                
                <Button 
                  className="w-full py-4 text-xl shadow-xl shadow-brand/20 active:scale-[0.99] transition-transform h-16 flex items-center justify-center gap-3"
                  disabled={cart.length === 0}
                  onClick={() => setIsPaymentOpen(true)}
                >
                  <span className="flex items-center gap-2"><DollarSign size={24} strokeWidth={2.5}/> COBRAR</span>
                  <span className="bg-white/20 px-2 py-0.5 rounded text-sm font-mono opacity-80 font-bold">F12</span>
                </Button>
            </div>
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
         <div className="flex items-center gap-1 shrink-0"><span className="bg-sys-800 text-white px-1.5 rounded border border-sys-600 font-mono">F8</span> <span>Suspender</span></div>
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