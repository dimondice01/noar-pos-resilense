import React, { useEffect, useState } from 'react';
import { FileText, CheckCircle, AlertCircle, Printer, RefreshCw, Search } from 'lucide-react';
import { salesRepository } from '../repositories/salesRepository';
import { billingService } from '../../billing/services/billingService';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import { getDB } from '../../../database/db';
import { TicketModal } from '../components/TicketModal'; // ✅ Importación del Ticket

export const SalesPage = () => {
  // ==========================================
  // ESTADOS
  // ==========================================
  const [sales, setSales] = useState([]);
  const [loadingMap, setLoadingMap] = useState({}); // Controla spinner por fila
  const [selectedSaleForTicket, setSelectedSaleForTicket] = useState(null); // Controla el modal de Ticket

  // ==========================================
  // EFECTOS
  // ==========================================
  useEffect(() => {
    loadSales();
  }, []);

  const loadSales = async () => {
    try {
      const all = await salesRepository.getTodaySales();
      // Ordenamos: las más nuevas arriba
      setSales(all.sort((a, b) => new Date(b.date) - new Date(a.date)));
    } catch (error) {
      console.error("Error cargando ventas:", error);
    }
  };

  // ==========================================
  // LÓGICA DE NEGOCIO
  // ==========================================

  // Manejador del Botón "Facturar AFIP"
  const handleFacturar = async (sale) => {
    // 1. Marcamos esta venta específica como "cargando"
    setLoadingMap(prev => ({ ...prev, [sale.localId]: true }));

    try {
      // 2. Llamada a AFIP (Cloud Function)
      const factura = await billingService.emitirFactura(sale);

      // 3. Si éxito, actualizamos la venta en la Base de Datos Local (IndexedDB)
      const db = await getDB();
      const tx = db.transaction('sales', 'readwrite');
      const store = tx.objectStore('sales');
      
      // Creamos el objeto actualizado con los datos fiscales
      const ventaActualizada = {
        ...sale,
        afip: {
          status: 'APPROVED',
          cae: factura.cae,
          cbteNumero: factura.numero,
          cbteLetra: factura.tipo, // 'A', 'B', 'C'
          qr: factura.qr_data,
          vtoCAE: factura.vto
        }
      };
      
      await store.put(ventaActualizada);
      await tx.done;

      // 4. Refrescamos la lista para ver el cambio
      await loadSales();
      
      // 5. Opcional: Abrir el ticket automáticamente tras facturar
      // setSelectedSaleForTicket(ventaActualizada);

    } catch (error) {
      console.error(error);
      alert(`❌ Error AFIP: ${error.message}`);
    } finally {
      // Quitamos el spinner
      setLoadingMap(prev => ({ ...prev, [sale.localId]: false }));
    }
  };

  // ==========================================
  // RENDERIZADO
  // ==========================================
  return (
    <div className="space-y-6 pb-20">
      
      {/* HEADER */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold text-sys-900">Ventas del Día</h2>
          <p className="text-sys-500">Gestión de caja y facturación fiscal</p>
        </div>
        
        <Card className="px-6 py-3 bg-sys-900 text-white border-none shadow-lg">
          <p className="text-xs text-sys-300 uppercase tracking-wider font-semibold">Total Vendido</p>
          <p className="text-3xl font-bold tracking-tight">
            $ {sales.reduce((acc, s) => acc + s.total, 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}
          </p>
        </Card>
      </header>

      {/* TABLA DE VENTAS */}
      <Card className="p-0 overflow-hidden shadow-soft border-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-sys-50/80 text-sys-500 text-xs uppercase tracking-wider border-b border-sys-100 backdrop-blur-sm">
                <th className="p-4 font-semibold whitespace-nowrap">Hora</th>
                <th className="p-4 font-semibold whitespace-nowrap">Resumen</th>
                <th className="p-4 font-semibold whitespace-nowrap">Total</th>
                <th className="p-4 font-semibold whitespace-nowrap">Pago</th>
                <th className="p-4 font-semibold whitespace-nowrap">Estado Fiscal</th>
                <th className="p-4 font-semibold text-right whitespace-nowrap">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sys-100">
              {sales.map((sale) => {
                const isFacturado = sale.afip?.status === 'APPROVED';
                const isLoading = loadingMap[sale.localId];

                return (
                  <tr key={sale.localId} className="hover:bg-sys-50/40 transition-colors group">
                    
                    {/* Hora */}
                    <td className="p-4 text-sys-600 font-mono text-sm whitespace-nowrap">
                      {new Date(sale.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </td>
                    
                    {/* Resumen Items */}
                    <td className="p-4 text-sys-800 font-medium">
                      <div className="flex flex-col">
                        <span>{sale.itemCount} items</span>
                        <span className="text-[10px] text-sys-400 font-normal truncate max-w-[150px]">
                           {sale.items.map(i => i.name).join(', ')}
                        </span>
                      </div>
                    </td>
                    
                    {/* Total */}
                    <td className="p-4 text-sys-900 font-bold whitespace-nowrap">
                      $ {sale.total.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                    </td>
                    
                    {/* Método de Pago */}
                    <td className="p-4">
                      <span className={cn(
                        "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border",
                        sale.payment.method === 'cash' ? "bg-green-50 text-green-700 border-green-100" :
                        sale.payment.method === 'mercadopago' ? "bg-blue-50 text-blue-700 border-blue-100" :
                        "bg-purple-50 text-purple-700 border-purple-100" // Clover/Card
                      )}>
                        {sale.payment.method === 'mercadopago' ? 'MP QR' : 
                         sale.payment.method === 'clover' ? 'CLOVER' : 
                         sale.payment.method}
                      </span>
                    </td>
                    
                    {/* Estado AFIP */}
                    <td className="p-4">
                      {isFacturado ? (
                        <div className="flex items-center gap-2 text-green-600 bg-green-50/50 px-2 py-1 rounded-lg w-fit border border-green-100">
                          <CheckCircle size={14} />
                          <span className="text-xs font-bold font-mono">
                            FC "{sale.afip.cbteLetra}" {String(sale.afip.cbteNumero).padStart(5, '0')}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-sys-400 bg-sys-50 px-2 py-1 rounded-lg w-fit">
                          <AlertCircle size={14} /> 
                          <span className="text-xs italic">Pendiente</span>
                        </div>
                      )}
                    </td>
                    
                    {/* Botones de Acción */}
                    <td className="p-4 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-2">
                        {!isFacturado ? (
                          <Button 
                            variant="secondary" 
                            className="h-9 text-xs px-3 border-brand/20 text-brand hover:bg-brand hover:text-white transition-all shadow-sm"
                            onClick={() => handleFacturar(sale)}
                            disabled={isLoading}
                          >
                            {isLoading ? (
                              <RefreshCw size={14} className="animate-spin mr-1" />
                            ) : (
                              <FileText size={14} className="mr-1.5" />
                            )}
                            {isLoading ? "Procesando..." : "Facturar"}
                          </Button>
                        ) : (
                          // Botón Imprimir (Visible solo si ya está facturado o si queremos imprimir ticket X)
                          <Button 
                            variant="ghost" 
                            className="h-9 text-xs px-3 text-sys-600 hover:text-sys-900 hover:bg-sys-100 border border-sys-200"
                            onClick={() => setSelectedSaleForTicket(sale)}
                          >
                            <Printer size={14} className="mr-1.5" /> Imprimir
                          </Button>
                        )}

                        {/* Botón Imprimir Ticket X (Siempre disponible, opcional) */}
                        {!isFacturado && (
                           <Button 
                             variant="ghost"
                             className="h-9 w-9 p-0 text-sys-400 hover:text-sys-600"
                             title="Imprimir Comprobante No Fiscal (X)"
                             onClick={() => setSelectedSaleForTicket(sale)}
                           >
                             <Printer size={14} />
                           </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              
              {sales.length === 0 && (
                <tr>
                  <td colSpan="6" className="p-12 text-center">
                    <div className="flex flex-col items-center justify-center text-sys-300">
                        <Search size={48} className="mb-4 opacity-50" />
                        <p className="font-medium text-sys-500">No hay ventas registradas hoy.</p>
                        <p className="text-sm">Las operaciones aparecerán aquí.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ==================================================== 
          MODAL DE TICKET (FLOTANTE)
         ==================================================== */}
      <TicketModal 
         isOpen={!!selectedSaleForTicket}
         sale={selectedSaleForTicket}
         onClose={() => setSelectedSaleForTicket(null)}
      />

    </div>
  );
};