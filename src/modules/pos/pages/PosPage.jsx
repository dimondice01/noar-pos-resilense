import React, { useEffect, useState, useRef } from 'react';
import { 
    Search, Trash2, ShoppingCart, PackageOpen, 
    Keyboard, User, DollarSign, ChevronRight, Plus, 
    Lock, Wallet, ArrowRight, Loader2, X, PlusCircle, CreditCard
} from 'lucide-react';

// Controlador Maestro (Cerebro)
import { usePosController } from '../hooks/usePosController';

// Repositorios
import { cashRepository } from '../../cash/repositories/cashRepository';
import { useAuthStore } from '../../auth/store/useAuthStore';

// Componentes UI
import { QuantityModal } from '../components/QuantityModal';
import { PaymentModal } from '../components/PaymentModal';
import { ClientSelectionModal } from '../components/ClientSelectionModal'; 
import { TicketModal } from '../../sales/components/TicketModal';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

export const PosPage = () => {
  const { user } = useAuthStore();
  
  // 🔥 INYECTAMOS EL CEREBRO DEL POS
  const {
      tabs,
      activeTab,
      activeTabId,
      totals,
      searchResults,
      isProcessing,
      // Acciones
      addTab,
      removeTab,
      switchTab,
      addToCart,
      removeFromCart,
      updateItemQuantity,
      setClient,
      clearCart,
      searchProduct,
      setSearchResults, // Para limpiar búsqueda manualmente
      processSale
  } = usePosController();

  // Estados Locales de UI (No de negocio)
  const [isShiftChecking, setIsShiftChecking] = useState(true);
  const [hasOpenShift, setHasOpenShift] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('');
  const [isOpening, setIsOpening] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [selectedProduct, setSelectedProduct] = useState(null); // Para modal cantidad
  
  // Modales
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isClientSelectorOpen, setIsClientSelectorOpen] = useState(false);
  const [lastSaleTicket, setLastSaleTicket] = useState(null);

  // Refs
  const searchInputRef = useRef(null);
  const openingInputRef = useRef(null);
  const productsListRef = useRef(null);

  // =================================================================
  // 1. VERIFICACIÓN DE CAJA (SEGURIDAD)
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
  
  // Efecto rebote para búsqueda (Debounce)
  useEffect(() => {
      const timer = setTimeout(() => {
          if (searchTerm.length > 1) {
              searchProduct(searchTerm);
          } else {
              setSearchResults([]);
          }
      }, 250);
      return () => clearTimeout(timer);
  }, [searchTerm]);

  const handleSelectProduct = (product) => {
      if (parseFloat(product.stock || 0) <= 0) {
          // Opcional: Permitir venta negativa con advertencia
          if(!confirm(`⚠️ STOCK 0: ${product.name}\n¿Agregar igual?`)) return;
      }

      if (product.isWeighable) {
          setSelectedProduct(product);
      } else {
          addToCart(product, 1);
          setSearchTerm(''); // Limpiar input
          setSearchResults([]); // Limpiar lista
          setTimeout(() => searchInputRef.current?.focus(), 50);
      }
  };

  const handleKeyDownInput = (e) => {
      if (e.key === 'ArrowDown') {
          e.preventDefault();
          setFocusedIndex(prev => (prev < searchResults.length - 1 ? prev + 1 : prev));
      } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusedIndex(prev => (prev > 0 ? prev - 1 : prev));
      } else if (e.key === 'Enter') {
          e.preventDefault();
          if (focusedIndex >= 0 && searchResults[focusedIndex]) {
              handleSelectProduct(searchResults[focusedIndex]);
          } else if (searchResults.length === 1) {
              handleSelectProduct(searchResults[0]);
          }
      }
  };

  // Scroll automático en lista de resultados
  useEffect(() => {
      if (focusedIndex >= 0 && productsListRef.current) {
          const item = productsListRef.current.children[focusedIndex];
          item?.scrollIntoView({ block: 'nearest' });
      }
  }, [focusedIndex]);

  // Teclas Globales (F-Keys)
  useEffect(() => {
      const handleGlobalKeys = (e) => {
          if (!hasOpenShift || isPaymentOpen || isClientSelectorOpen) return;
          
          switch(e.key) {
              case 'F2': e.preventDefault(); searchInputRef.current?.focus(); break;
              case 'F3': e.preventDefault(); setIsClientSelectorOpen(true); break;
              case 'F4': e.preventDefault(); if(confirm('¿Limpiar carrito?')) clearCart(); break;
              case 'F12': 
                  e.preventDefault(); 
                  if (activeTab.items.length > 0) setIsPaymentOpen(true); 
                  break;
              case 'Escape': searchInputRef.current?.blur(); setSearchResults([]); break;
          }
      };
      window.addEventListener('keydown', handleGlobalKeys);
      return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [hasOpenShift, isPaymentOpen, activeTab.items]);


  // =================================================================
  // RENDER: PANTALLA BLOQUEO
  // =================================================================
  if (isShiftChecking) return <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-brand" size={40}/></div>;

  if (!hasOpenShift) {
      return (
          <div className="h-[calc(100vh-4rem)] flex items-center justify-center bg-sys-100 p-4">
              <div className="bg-white max-w-md w-full rounded-3xl shadow-2xl overflow-hidden border border-sys-200">
                  <div className="bg-gradient-to-br from-red-50 to-white p-8 text-center border-b border-red-100">
                      <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center shadow-sm mx-auto mb-4 border border-red-100">
                          <Lock size={40} className="text-red-500" strokeWidth={1.5} />
                      </div>
                      <h2 className="text-2xl font-black text-sys-900 mb-1">Caja Cerrada</h2>
                      <p className="text-sys-500 text-sm">Inicie su turno para comenzar a operar.</p>
                  </div>
                  <form onSubmit={handleOpenShift} className="p-8 space-y-6">
                      <div>
                          <label className="text-xs font-bold text-sys-500 uppercase ml-1">Fondo Inicial</label>
                          <div className="relative mt-1">
                              <Wallet className="absolute left-4 top-3.5 text-sys-400" size={20} />
                              <input 
                                  ref={openingInputRef}
                                  type="number" 
                                  className="w-full pl-12 pr-4 py-3 bg-sys-50 border border-sys-200 rounded-xl text-lg font-bold outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all"
                                  placeholder="0.00"
                                  value={openingAmount}
                                  onChange={(e) => setOpeningAmount(e.target.value)}
                                  autoFocus
                              />
                          </div>
                      </div>
                      <Button type="submit" className="w-full py-4 text-lg rounded-xl shadow-lg shadow-brand/20" disabled={isOpening || !openingAmount}>
                          {isOpening ? <Loader2 className="animate-spin"/> : <ArrowRight/>} Abrir Caja
                      </Button>
                  </form>
              </div>
          </div>
      );
  }

  // =================================================================
  // RENDER: POS INTERFACE
  // =================================================================
  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col bg-sys-50 relative overflow-hidden">
      
      {/* 🟢 BARRA SUPERIOR: PESTAÑAS (MULTI-CART) */}
      <div className="h-12 bg-white border-b border-sys-200 flex items-end px-2 gap-1 overflow-x-auto no-scrollbar shrink-0 z-20 shadow-sm">
          {tabs.map(tab => (
              <div 
                  key={tab.id}
                  onClick={() => switchTab(tab.id)}
                  className={cn(
                      "group relative px-4 py-2.5 min-w-[140px] max-w-[200px] cursor-pointer rounded-t-xl transition-all border-t border-x flex items-center justify-between select-none",
                      activeTabId === tab.id 
                          ? "bg-sys-50 border-sys-200 border-b-transparent text-brand-dark font-bold translate-y-[1px] shadow-[0_-2px_5px_rgba(0,0,0,0.02)]" 
                          : "bg-gray-50/50 border-transparent text-sys-500 hover:bg-gray-100 hover:text-sys-700"
                  )}
              >
                  <span className="truncate text-xs">{tab.client ? tab.client.name.split(' ')[0] : tab.name}</span>
                  {tabs.length > 1 && (
                      <button 
                          onClick={(e) => { e.stopPropagation(); removeTab(tab.id); }}
                          className="opacity-0 group-hover:opacity-100 hover:text-red-500 p-0.5 rounded-full hover:bg-red-50 transition-all"
                      >
                          <X size={12} />
                      </button>
                  )}
                  {/* Indicador de Items */}
                  {tab.items.length > 0 && (
                      <span className="absolute top-1 right-1 w-2 h-2 bg-brand rounded-full"></span>
                  )}
              </div>
          ))}
          <button 
              onClick={addTab}
              className="ml-1 mb-1.5 p-1.5 text-sys-400 hover:text-brand hover:bg-brand/10 rounded-full transition-colors"
              title="Nueva Venta (Pestaña)"
          >
              <PlusCircle size={20} />
          </button>
      </div>

      {/* 🟡 AREA PRINCIPAL: IZQUIERDA (LISTA) | DERECHA (BUSCADOR) */}
      <div className="flex-1 flex overflow-hidden">
          
          {/* 👈 IZQUIERDA: DETALLE DE VENTA */}
          <div className="flex-1 flex flex-col bg-white shadow-xl z-10 relative">
              
              {/* Header Cliente */}
              <div className="p-3 border-b border-sys-100 flex items-center justify-between bg-white shrink-0">
                  <div className="flex items-center gap-3 w-full">
                      <button 
                          onClick={() => setIsClientSelectorOpen(true)}
                          className={cn(
                              "flex-1 flex items-center gap-3 px-3 py-2 rounded-xl border transition-all text-left",
                              activeTab.client 
                                  ? "bg-brand-light/5 border-brand/20 text-brand-dark" 
                                  : "bg-sys-50 border-sys-200 hover:border-sys-300 text-sys-500"
                          )}
                      >
                          <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0", activeTab.client ? "bg-brand text-white" : "bg-white border text-sys-400")}>
                              <User size={16} />
                          </div>
                          <div className="flex flex-col overflow-hidden">
                              <span className="text-[10px] uppercase font-bold opacity-70 tracking-wider">
                                  {activeTab.client?.docType === '80' ? 'Factura A' : 'Consumidor Final'}
                              </span>
                              <span className="text-sm font-bold truncate">
                                  {activeTab.client?.name || "Seleccionar Cliente (F3)"}
                              </span>
                          </div>
                          <ChevronRight size={16} className="ml-auto opacity-50"/>
                      </button>
                  </div>
              </div>

              {/* Lista de Items */}
              <div className="flex-1 overflow-y-auto p-2 bg-sys-50/30">
                  {activeTab.items.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-sys-300 gap-4 select-none">
                          <ShoppingCart size={48} strokeWidth={1} className="opacity-20" />
                          <p className="text-sm font-medium">Escanee un producto o búsquelo</p>
                      </div>
                  ) : (
                      <div className="space-y-2">
                          {activeTab.items.map((item) => (
                              <div key={item.id} className="group flex items-center p-2 bg-white border border-sys-100 rounded-lg shadow-sm hover:shadow-md transition-all">
                                  <div className="w-10 text-center mr-3">
                                      <div className="text-base font-bold text-sys-800">{item.quantity}</div>
                                      <div className="text-[9px] uppercase text-sys-400 font-bold">{item.isWeighable ? 'KG' : 'UN'}</div>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                      <div className="text-sm font-bold text-sys-900 truncate">{item.name}</div>
                                      <div className="text-xs text-sys-500 font-mono mt-0.5">${item.price.toLocaleString()} x un.</div>
                                  </div>
                                  <div className="text-right pl-3">
                                      <div className="text-base font-black text-sys-900 tracking-tight">${item.subtotal.toLocaleString()}</div>
                                      <button 
                                          onClick={() => removeFromCart(item.id)}
                                          className="text-[10px] text-red-500 font-medium hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                                      >
                                          Quitar
                                      </button>
                                  </div>
                              </div>
                          ))}
                      </div>
                  )}
              </div>

              {/* Footer Totales */}
              <div className="p-4 bg-white border-t border-sys-200 shadow-[0_-5px_20px_rgba(0,0,0,0.05)] z-20">
                  <div className="flex justify-between items-end mb-4">
                      <div>
                          <p className="text-xs font-bold text-sys-400 uppercase tracking-widest mb-1">Total a Pagar</p>
                          <p className="text-4xl font-black text-sys-900 tracking-tighter leading-none">${totals.total.toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                      </div>
                      <div className="flex gap-2">
                          <Button 
                              variant="ghost" 
                              className="h-12 w-12 rounded-xl border border-red-100 text-red-500 hover:bg-red-50 hover:text-red-600 p-0"
                              onClick={() => { if(confirm('¿Limpiar venta?')) clearCart(); }}
                          >
                              <Trash2 size={20}/>
                          </Button>
                          <Button 
                              className="h-12 px-8 text-lg rounded-xl shadow-lg shadow-brand/20 active:scale-95 transition-transform flex items-center gap-2"
                              disabled={activeTab.items.length === 0}
                              onClick={() => setIsPaymentOpen(true)}
                          >
                              <DollarSign size={22} strokeWidth={2.5}/> COBRAR <span className="opacity-60 text-xs font-mono ml-1">F12</span>
                          </Button>
                      </div>
                  </div>
              </div>
          </div>

          {/* 👉 DERECHA: BUSCADOR Y RESULTADOS */}
          <div className="w-[400px] border-l border-sys-200 bg-white hidden md:flex flex-col z-0">
              <div className="p-3 border-b border-sys-100 bg-white">
                  <div className="relative">
                      <Search className="absolute left-3 top-3 text-sys-400" size={18} />
                      <input 
                          ref={searchInputRef}
                          type="text" 
                          className="w-full pl-10 pr-4 py-2.5 bg-sys-50 border border-sys-200 rounded-xl outline-none focus:bg-white focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-medium text-sys-800 placeholder:text-sys-400"
                          placeholder="Buscar producto (F2)..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          onKeyDown={handleKeyDownInput}
                          autoFocus
                          autoComplete="off"
                      />
                  </div>
              </div>

              <div ref={productsListRef} className="flex-1 overflow-y-auto p-2 space-y-1">
                  {searchResults.map((product, idx) => (
                      <div 
                          key={product.id}
                          onClick={() => handleSelectProduct(product)}
                          className={cn(
                              "group flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all",
                              idx === focusedIndex 
                                  ? "bg-brand text-white border-brand shadow-md scale-[1.02]" 
                                  : "bg-white border-transparent hover:bg-sys-50 hover:border-sys-200"
                          )}
                      >
                          <div className="flex-1 min-w-0 pr-2">
                              <div className={cn("font-bold text-sm truncate", idx === focusedIndex ? "text-white" : "text-sys-800")}>{product.name}</div>
                              <div className={cn("text-xs mt-0.5", idx === focusedIndex ? "text-white/80" : "text-sys-400 font-mono")}>{product.code}</div>
                          </div>
                          <div className="text-right">
                              <div className={cn("font-bold", idx === focusedIndex ? "text-white" : "text-sys-900")}>${product.price}</div>
                              <div className={cn("text-[10px] font-bold uppercase", idx === focusedIndex ? "text-white/70" : parseFloat(product.stock) > 0 ? "text-green-600" : "text-red-500")}>
                                  {parseFloat(product.stock) > 0 ? `${product.stock} disp.` : 'Sin Stock'}
                              </div>
                          </div>
                      </div>
                  ))}
                  {searchTerm.length > 1 && searchResults.length === 0 && (
                      <div className="text-center py-10 text-sys-400">
                          <PackageOpen size={32} className="mx-auto mb-2 opacity-30"/>
                          <p className="text-sm">No encontrado</p>
                      </div>
                  )}
              </div>
          </div>
      </div>

      {/* 🕹️ FOOTER DE COMANDOS */}
      <div className="h-8 bg-sys-800 border-t border-sys-700 flex items-center px-4 gap-6 text-[10px] font-medium text-sys-300 shrink-0 select-none">
          <div className="flex items-center gap-1"><Keyboard size={12} className="text-brand"/> <span className="font-bold text-white">COMANDOS:</span></div>
          <div className="flex items-center gap-1"><span className="bg-sys-700 px-1 rounded text-white font-mono">F2</span> Buscar</div>
          <div className="flex items-center gap-1"><span className="bg-sys-700 px-1 rounded text-white font-mono">F3</span> Cliente</div>
          <div className="flex items-center gap-1"><span className="bg-sys-700 px-1 rounded text-white font-mono">F12</span> Cobrar</div>
          <div className="ml-auto flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]"></span>
              <span>Caja Abierta: {user?.name}</span>
          </div>
      </div>

      {/* 🚀 MODALES Y OVERLAYS */}
      {isProcessing && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex items-center justify-center flex-col">
              <Loader2 size={48} className="text-brand animate-spin mb-4"/>
              <p className="text-lg font-bold text-sys-800">Procesando Venta...</p>
          </div>
      )}

      {/* Modal Cantidad (Para productos pesables) */}
      <QuantityModal 
          isOpen={!!selectedProduct} 
          product={selectedProduct} 
          onClose={() => { setSelectedProduct(null); setTimeout(() => searchInputRef.current?.focus(), 100); }} 
          onConfirm={(product, qty) => { addToCart(product, qty); setSelectedProduct(null); setTimeout(() => searchInputRef.current?.focus(), 100); }} 
      />

      {/* Modal Pagos */}
      <PaymentModal 
          isOpen={isPaymentOpen} 
          total={totals.total} 
          client={activeTab.client} 
          onClose={() => setIsPaymentOpen(false)}
          onConfirm={async (paymentData) => {
              const result = await processSale(paymentData);
              if (result) setLastSaleTicket(result); // Mostrar ticket si hubo venta
              setIsPaymentOpen(false);
          }} 
      />

      {/* Selector de Clientes */}
      <ClientSelectionModal 
          isOpen={isClientSelectorOpen} 
          onClose={() => { setIsClientSelectorOpen(false); setTimeout(() => searchInputRef.current?.focus(), 100); }} 
          onSelect={(c) => { setClient(c); setIsClientSelectorOpen(false); }} 
      />

      {/* Ticket Post-Venta */}
      <TicketModal 
          isOpen={!!lastSaleTicket} 
          sale={lastSaleTicket} 
          onClose={() => { setLastSaleTicket(null); setTimeout(() => searchInputRef.current?.focus(), 100); }} 
      />

    </div>
  );
};