import React, { useEffect, useState } from 'react';
import { FileText, CheckCircle, AlertCircle, Printer, RefreshCw, Search, ArrowDownLeft, ShoppingBag } from 'lucide-react';
import { salesRepository } from '../repositories/salesRepository';
import { billingService } from '../../billing/services/billingService';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import { getDB } from '../../../database/db';
import { TicketModal } from '../components/TicketModal';

export const SalesPage = () => {
  // ==========================================
  // ESTADOS
  // ==========================================
  const [operations, setOperations] = useState([]); // Antes 'sales', ahora 'operations' para incluir recibos
  const [loadingMap, setLoadingMap] = useState({}); 
  const [selectedOpForTicket, setSelectedOpForTicket] = useState(null); 

  // ==========================================
  // EFECTOS
  // ==========================================
  useEffect(() => {
    loadOperations();
  }, []);

  const loadOperations = async () => {
    try {
      // 🔥 Usamos el nuevo método unificado del repositorio
      const all = await salesRepository.getTodayOperations();
      setOperations(all);
    } catch (error) {
      console.error("Error cargando operaciones:", error);
    }
  };

  // ==========================================
  // LÓGICA DE NEGOCIO
  // ==========================================

  const handleFacturar = async (op) => {
    // Seguridad: Los recibos de cobranza NO se facturan
    if (op.type === 'RECEIPT') return;

    setLoadingMap(prev => ({ ...prev, [op.localId]: true }));

    try {
      const factura = await billingService.emitirFactura(op);

      const db = await getDB();
      const tx = db.transaction('sales', 'readwrite');
      const store = tx.objectStore('sales');
      
      const ventaActualizada = {
        ...op,
        afip: {
          status: 'APPROVED',
          cae: factura.cae,
          cbteNumero: factura.numero,
          cbteLetra: factura.tipo,
          qr: factura.qr_data,
          vtoCAE: factura.vto
        }
      };
      
      await store.put(ventaActualizada);
      await tx.done;

      await loadOperations();

    } catch (error) {
      console.error(error);
      alert(`❌ Error AFIP: ${error.message}`);
    } finally {
      setLoadingMap(prev => ({ ...prev, [op.localId]: false }));
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
          <h2 className="text-2xl font-bold text-sys-900">Movimientos del Día</h2>
          <p className="text-sys-500">Control de ventas y cobranzas</p>
        </div>
        
        <Card className="px-6 py-3 bg-sys-900 text-white border-none shadow-lg">
          <p className="text-xs text-sys-300 uppercase tracking-wider font-semibold">Total Ingresos</p>
          <p className="text-3xl font-bold tracking-tight">
            $ {operations.reduce((acc, op) => acc + (op.total || 0), 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}
          </p>
        </Card>
      </header>

      {/* TABLA UNIFICADA */}
      <Card className="p-0 overflow-hidden shadow-soft border-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-sys-50/80 text-sys-500 text-xs uppercase tracking-wider border-b border-sys-100 backdrop-blur-sm">
                <th className="p-4 font-semibold whitespace-nowrap">Hora</th>
                <th className="p-4 font-semibold whitespace-nowrap">Tipo</th>
                <th className="p-4 font-semibold whitespace-nowrap">Cliente / Detalle</th>
                <th className="p-4 font-semibold whitespace-nowrap">Monto</th>
                <th className="p-4 font-semibold whitespace-nowrap">Pago</th>
                <th className="p-4 font-semibold whitespace-nowrap">Estado Fiscal</th>
                <th className="p-4 font-semibold text-right whitespace-nowrap">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sys-100">
              {operations.map((op) => {
                const isReceipt = op.type === 'RECEIPT';
                const isFacturado = op.afip?.status === 'APPROVED';
                const isLoading = loadingMap[op.localId];
                
                // 🔥 LECTURA SEGURA DEL MÉTODO DE PAGO (Evita el crash)
                const paymentMethod = op.payment?.method || op.paymentMethod || 'cash';

                return (
                  <tr key={op.localId} className="hover:bg-sys-50/40 transition-colors group">
                    
                    {/* Hora */}
                    <td className="p-4 text-sys-600 font-mono text-sm whitespace-nowrap">
                      {new Date(op.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </td>

                    {/* Tipo */}
                    <td className="p-4">
                        {isReceipt ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-50 text-blue-700 text-[10px] font-bold uppercase border border-blue-100">
                                <ArrowDownLeft size={12}/> Cobro Deuda
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-sys-100 text-sys-600 text-[10px] font-bold uppercase border border-sys-200">
                                <ShoppingBag size={12}/> Venta
                            </span>
                        )}
                    </td>
                    
                    {/* Detalle */}
                    <td className="p-4 text-sys-800 font-medium">
                      <div className="flex flex-col">
                        <span className="font-bold truncate max-w-[180px]">{op.client?.name || 'Consumidor Final'}</span>
                        <span className="text-[10px] text-sys-400 font-normal truncate max-w-[200px]">
                           {isReceipt 
                                ? "Pago a Cuenta Cta. Cte." 
                                : `${op.itemCount} items: ${op.items?.map(i => i.name).join(', ')}`
                           }
                        </span>
                      </div>
                    </td>
                    
                    {/* Monto */}
                    <td className="p-4 text-sys-900 font-bold whitespace-nowrap">
                      $ {op.total.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                    </td>
                    
                    {/* Método de Pago */}
                    <td className="p-4">
                      <span className={cn(
                        "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border",
                        paymentMethod === 'cash' ? "bg-green-50 text-green-700 border-green-100" :
                        paymentMethod === 'mercadopago' ? "bg-blue-50 text-blue-700 border-blue-100" :
                        "bg-purple-50 text-purple-700 border-purple-100"
                      )}>
                        {paymentMethod === 'mercadopago' ? 'MP QR' : 
                         paymentMethod === 'clover' ? 'CLOVER' : 
                         paymentMethod.toUpperCase()}
                      </span>
                    </td>
                    
                    {/* Estado Fiscal */}
                    <td className="p-4">
                      {isReceipt ? (
                          <span className="text-[10px] text-sys-400 italic">No Aplica (Recibo X)</span>
                      ) : isFacturado ? (
                        <div className="flex items-center gap-2 text-green-600 bg-green-50/50 px-2 py-1 rounded-lg w-fit border border-green-100">
                          <CheckCircle size={14} />
                          <span className="text-xs font-bold font-mono">
                            FC "{op.afip.cbteLetra}"
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-sys-400 bg-sys-50 px-2 py-1 rounded-lg w-fit">
                          <AlertCircle size={14} /> 
                          <span className="text-xs italic">Pendiente</span>
                        </div>
                      )}
                    </td>
                    
                    {/* Acciones */}
                    <td className="p-4 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-2">
                        {/* Botón Facturar (Solo Ventas No Facturadas) */}
                        {!isFacturado && !isReceipt ? (
                          <Button 
                            variant="secondary" 
                            className="h-8 text-xs px-3 border-brand/20 text-brand hover:bg-brand hover:text-white transition-all shadow-sm"
                            onClick={() => handleFacturar(op)}
                            disabled={isLoading}
                          >
                            {isLoading ? <RefreshCw size={12} className="animate-spin mr-1" /> : <FileText size={12} className="mr-1.5" />}
                            {isLoading ? "..." : "Facturar"}
                          </Button>
                        ) : (
                          // Botón Re-Imprimir (Para todo lo demás)
                          <Button 
                            variant="ghost" 
                            className="h-8 text-xs px-3 text-sys-600 hover:text-sys-900 hover:bg-sys-100 border border-sys-200"
                            onClick={() => setSelectedOpForTicket(op)}
                          >
                            <Printer size={12} className="mr-1.5" /> Re-Imprimir
                          </Button>
                        )}
                        
                        {/* Botón Extra Imprimir Ticket X para ventas pendientes */}
                        {!isFacturado && !isReceipt && (
                           <Button 
                             variant="ghost"
                             className="h-8 w-8 p-0 text-sys-400 hover:text-sys-600"
                             title="Imprimir Comprobante Interno"
                             onClick={() => setSelectedOpForTicket(op)}
                           >
                             <Printer size={14} />
                           </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              
              {operations.length === 0 && (
                <tr>
                  <td colSpan="7" className="p-12 text-center">
                    <div className="flex flex-col items-center justify-center text-sys-300">
                        <Search size={48} className="mb-4 opacity-50" />
                        <p className="font-medium text-sys-500">Sin movimientos hoy.</p>
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
         isOpen={!!selectedOpForTicket}
         // 🔥 Pasamos la prop correcta según el tipo
         sale={selectedOpForTicket?.type !== 'RECEIPT' ? selectedOpForTicket : null}
         receipt={selectedOpForTicket?.type === 'RECEIPT' ? selectedOpForTicket : null}
         onClose={() => setSelectedOpForTicket(null)}
      />

    </div>
  );
};