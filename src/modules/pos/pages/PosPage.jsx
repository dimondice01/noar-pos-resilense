import React, { useEffect, useState } from 'react';
import { Search, Trash2, ShoppingCart, PackageOpen } from 'lucide-react';

// Repositorios y Servicios
import { productRepository } from '../../inventory/repositories/productRepository';
import { salesRepository } from '../../sales/repositories/salesRepository';
import { billingService } from '../../billing/services/billingService';

// Componentes del POS
import { ProductCard } from '../components/ProductCard';
import { QuantityModal } from '../components/QuantityModal';
import { PaymentModal } from '../components/PaymentModal';

// Componente del Ticket (desde módulo Sales)
import { TicketModal } from '../../sales/components/TicketModal';

// Store Global
import { useCartStore } from '../store/useCartStore';

// UI Core
import { Button } from '../../../core/ui/Button';

export const PosPage = () => {
  // ==========================================
  // ESTADOS
  // ==========================================
  const [products, setProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Control de Modales
  const [selectedProduct, setSelectedProduct] = useState(null); // Para cantidad/peso
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);    // Para cobrar
  
  // Control de Flujo de Venta
  const [isProcessingSale, setIsProcessingSale] = useState(false); // Bloqueo de pantalla
  const [lastSaleTicket, setLastSaleTicket] = useState(null);      // Ticket automático
  
  // Estado Global (Carrito)
  const { cart, addItem, removeItem, getTotal, clearCart } = useCartStore();

  // ==========================================
  // EFECTOS
  // ==========================================
  useEffect(() => {
    // Carga inicial de productos desde IndexedDB
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

  // ==========================================
  // LÓGICA DE NEGOCIO
  // ==========================================
  
  // Filtrado de productos en memoria
  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.code.includes(searchTerm)
  );

  // 1. Selección de Producto -> Abre Modal Cantidad
  const handleProductClick = (product) => {
    setSelectedProduct(product);
  };

  // 2. Confirmación de Cantidad -> Agrega al Carrito
  const handleQuantityConfirm = (product, quantity, price) => {
    addItem(product, quantity, price);
    setSelectedProduct(null);
  };

  // 3. Confirmación de Pago -> ORQUESTADOR FINAL
  const handlePaymentConfirm = async (paymentData) => {
    // paymentData trae: { method, amount, received, change, withAfip }
    
    // Bloqueamos la pantalla para evitar doble click
    setIsProcessingSale(true);

    try {
      const totalVenta = getTotal();
      let afipData = null;

      // A) SI EL USUARIO ACTIVÓ "FACTURAR AFIP"
      if (paymentData.withAfip) {
        try {
          // Intentamos facturar en la nube
          // Nota: Por ahora usamos cliente genérico (Consumidor Final)
          const tempSaleForAfip = {
            total: totalVenta,
            client: { docNumber: "0" } 
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
          // Si falla AFIP, no detenemos la venta, pero avisamos.
          // Guardamos como PENDIENTE para reintentar luego desde historial.
          alert("⚠️ Alerta: AFIP no respondió o rechazó.\nLa venta se guardará pero quedará Pendiente de Facturación.");
          afipData = { status: 'PENDING', error: afipError.message };
        }
      }

      // B) CONSTRUCCIÓN DEL OBJETO VENTA FINAL
      const saleData = {
        items: cart,
        total: totalVenta,
        payment: paymentData,
        itemCount: cart.length,
        date: new Date(),
        // Si no se pidió AFIP, el estado es null o 'SKIPPED'
        afip: afipData || { status: 'SKIPPED' } 
      };

      // C) GUARDAR EN BASE DE DATOS LOCAL (IndexedDB)
      const savedSale = await salesRepository.createSale(saleData);

      console.log("✅ Venta Finalizada:", savedSale);

      // D) LIMPIEZA Y APERTURA DE TICKET
      clearCart();
      setIsPaymentOpen(false);
      
      // Abrimos el ticket automáticamente con los datos frescos
      setLastSaleTicket(savedSale);

    } catch (error) {
      console.error("❌ Error Crítico al procesar venta:", error);
      alert("Error crítico: No se pudo guardar la venta en el disco local.");
    } finally {
      // Liberamos la pantalla
      setIsProcessingSale(false);
    }
  };

  // ==========================================
  // RENDERIZADO
  // ==========================================
  return (
    <div className="h-[calc(100vh-6rem)] flex gap-6 relative">
      
      {/* OVERLAY DE PROCESAMIENTO (Bloqueo Visual) */}
      {isProcessingSale && (
        <div className="absolute inset-0 z-[80] bg-white/60 backdrop-blur-sm flex items-center justify-center rounded-2xl animate-in fade-in">
           <div className="flex flex-col items-center bg-white p-8 rounded-2xl shadow-2xl border border-sys-100">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-sys-100 border-t-brand mb-4"></div>
              <p className="font-bold text-lg text-sys-900">Procesando Venta...</p>
              <p className="text-sm text-sys-500 mt-1">Comunicando con AFIP y Guardando</p>
           </div>
        </div>
      )}

      {/* -------------------------------------------
          SECCIÓN IZQUIERDA: Catálogo y Búsqueda
         ------------------------------------------- */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Input de Búsqueda */}
        <div className="mb-6 relative group">
          <div className="absolute left-4 top-3.5 text-sys-400 group-focus-within:text-brand transition-colors">
            <Search className="w-5 h-5" />
          </div>
          <input 
            type="text" 
            placeholder="Buscar por nombre o escanear código..." 
            className="w-full pl-12 pr-4 py-3 rounded-xl border border-sys-200 bg-white focus:border-brand focus:ring-4 focus:ring-brand/10 outline-none shadow-sm transition-all text-sys-800 placeholder:text-sys-300"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
          />
        </div>

        {/* Grilla de Productos */}
        <div className="flex-1 overflow-y-auto pr-2 no-scrollbar pb-20">
          {filteredProducts.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredProducts.map(product => (
                <ProductCard 
                  key={product.id} 
                  product={product} 
                  onClick={handleProductClick} 
                />
              ))}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-sys-400">
              <PackageOpen size={48} strokeWidth={1.5} className="mb-4 opacity-50" />
              <p>No se encontraron productos</p>
            </div>
          )}
        </div>
      </div>

      {/* -------------------------------------------
          SECCIÓN DERECHA: Ticket / Carrito
         ------------------------------------------- */}
      <div className="w-96 bg-white rounded-2xl shadow-soft border border-sys-200 flex flex-col overflow-hidden shrink-0">
        
        {/* Header Ticket */}
        <div className="p-4 bg-sys-50 border-b border-sys-100 flex justify-between items-center">
          <h2 className="font-bold text-sys-800 flex items-center gap-2">
            <ShoppingCart size={20} className="text-brand" /> 
            Ticket Actual
          </h2>
          {cart.length > 0 && (
            <button 
              onClick={clearCart} 
              className="text-xs font-medium text-pos-error hover:bg-red-50 px-2 py-1 rounded transition-colors"
            >
              Vaciar
            </button>
          )}
        </div>

        {/* Lista de Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-sys-300">
               <div className="w-16 h-16 bg-sys-50 rounded-full flex items-center justify-center mb-3">
                 <ShoppingCart size={24} />
               </div>
               <p className="font-medium text-sm">El carrito está vacío</p>
               <p className="text-xs mt-1">Selecciona productos para comenzar</p>
            </div>
          ) : (
            cart.map((item) => (
              <div 
                key={item.cartId} 
                className="group flex justify-between items-start p-3 hover:bg-sys-50 rounded-xl transition-colors border border-transparent hover:border-sys-200"
              >
                <div className="flex-1 min-w-0 pr-3">
                  <p className="text-sm font-semibold text-sys-800 truncate">{item.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs font-mono bg-sys-100 px-1.5 py-0.5 rounded text-sys-600">
                      {item.isWeighable 
                        ? `${item.quantity.toFixed(3)} kg`
                        : `${item.quantity} un`
                      }
                    </span>
                    <span className="text-xs text-sys-400">x ${item.price}</span>
                  </div>
                </div>
                
                <div className="flex flex-col items-end gap-1">
                  <span className="font-bold text-sys-900 text-sm">
                    $ {item.subtotal.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                  </span>
                  <button 
                    onClick={() => removeItem(item.cartId)}
                    className="text-sys-300 hover:text-pos-error opacity-0 group-hover:opacity-100 transition-all p-1"
                    title="Eliminar línea"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Totales */}
        <div className="p-6 bg-sys-50 border-t border-sys-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10">
          <div className="space-y-3 mb-6">
            <div className="flex justify-between items-center text-sys-500 text-sm">
              <span>Artículos</span>
              <span>{cart.length}</span>
            </div>
            <div className="flex justify-between items-end">
              <span className="text-sys-800 font-medium">Total a Pagar</span>
              <span className="text-3xl font-bold text-sys-900 tracking-tight leading-none">
                $ {getTotal().toLocaleString('es-AR', {minimumFractionDigits: 2})}
              </span>
            </div>
          </div>
          
          <Button 
            className="w-full py-4 text-lg shadow-xl shadow-brand/20 active:shadow-sm"
            disabled={cart.length === 0}
            onClick={() => setIsPaymentOpen(true)}
          >
            Cobrar (F12)
          </Button>
        </div>
      </div>

      {/* -------------------------------------------
          MODALES (Layers)
         ------------------------------------------- */}
      
      {/* 1. Modal Cantidad / Peso */}
      <QuantityModal 
        isOpen={!!selectedProduct}
        product={selectedProduct}
        onClose={() => setSelectedProduct(null)}
        onConfirm={handleQuantityConfirm}
      />

      {/* 2. Modal de Pago y Cierre */}
      <PaymentModal 
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        total={getTotal()}
        onConfirm={handlePaymentConfirm}
      />

      {/* 3. Ticket Automático (Se abre al finalizar venta) */}
      <TicketModal 
        isOpen={!!lastSaleTicket}
        sale={lastSaleTicket}
        onClose={() => setLastSaleTicket(null)}
      />

    </div>
  );
};