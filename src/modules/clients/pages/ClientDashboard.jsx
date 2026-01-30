import React, { useEffect, useState } from 'react';
import { 
    ArrowLeft, User, CreditCard, Calendar, 
    TrendingDown, DollarSign, FileText, Printer, Search, MapPin, Building2
} from 'lucide-react';
import { useAuthStore } from '../../auth/store/useAuthStore'; // 🔥 Contexto de Sucursal
import { clientRepository } from '../repositories/clientRepository';
import { cashRepository } from '../../cash/repositories/cashRepository'; 
import { salesRepository } from '../../sales/repositories/salesRepository'; 
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

// Imports Modales
import { PaymentModal } from '../../pos/components/PaymentModal';
import { TicketModal } from '../../sales/components/TicketModal';

export const ClientDashboard = ({ clientId, onBack }) => {
  const { user, activeBranchId, activeBranchName } = useAuthStore();
  
  const [client, setClient] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Estados UI
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [ticketData, setTicketData] = useState(null); 

  const loadData = async () => {
    setLoading(true);
    try {
        const [c, l] = await Promise.all([
            clientRepository.getById(clientId),
            clientRepository.getLedger(clientId)
        ]);
        setClient(c);
        // Ordenar ledger: más reciente primero
        setLedger(l.sort((a, b) => new Date(b.date) - new Date(a.date)));
    } catch (error) {
        console.error(error);
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    if (clientId) loadData();
  }, [clientId]);

  // =================================================================
  // 💰 PROCESAMIENTO DEL COBRO DE DEUDA (CON INTERESES)
  // =================================================================
  const handlePaymentConfirm = async (paymentData) => {
      // 🧠 Lógica de Interés en Pagos de Cuenta Corriente:
      // Si el cliente paga con tarjeta, el 'totalSale' incluye el interés.
      // Pero la deuda solo debe bajar por el monto 'baseAmount'.
      
      const realPaymentAmount = paymentData.baseAmount || paymentData.amountPaid; // Lo que baja la deuda
      const moneyInBox = paymentData.totalSale || paymentData.amountPaid; // Lo que entra a la caja (con recargo)
      
      if (realPaymentAmount <= 0) return;

      try {
          const shift = await cashRepository.getCurrentShift();
          if (!shift) {
              alert("⛔ Debe abrir la caja antes de recibir un pago.");
              return;
          }

          // 1. Registrar Ingreso en Caja (Entra el Total con Recargo)
          await cashRepository.registerIncome(
              moneyInBox,
              paymentData.method, 
              `Cobro Cta Cte: ${client.name} ${paymentData.surcharge > 0 ? '(c/Interés)' : ''}` 
          );

          // 2. Registrar Baja en Ledger (Solo baja el Capital)
          const newBalance = await clientRepository.registerMovement(
              client.id,
              'PAYMENT',
              realPaymentAmount, // <-- Aquí solo descontamos la deuda pura
              `Pago a cuenta (${paymentData.method})`,
              `rec_${Date.now()}` // ID de referencia temporal
          );

          // 3. Generar Objeto Recibo para imprimir
          const receiptObj = {
              localId: `rec_${Date.now()}`,
              date: new Date(),
              client: client,
              amount: moneyInBox, // En el recibo mostramos lo que pagó realmente
              newBalance: newBalance,
              method: paymentData.method,
              type: 'RECEIPT',
              // Guardamos detalle financiero para el ticket
              surcharge: paymentData.surcharge || 0,
              baseAmount: realPaymentAmount,
              totalSale: moneyInBox,
              // Snapshot de la sucursal actual para el encabezado del ticket
              companySnapshot: {
                  nombre: activeBranchName, 
                  // Aquí el TicketModal usará los datos de la sucursal activa
              }
          };

          // 4. Finalizar
          setTicketData({ receipt: receiptObj }); 
          setIsPaymentOpen(false);
          loadData(); 
          
      } catch (error) {
          console.error(error);
          alert("Error al procesar el pago: " + error.message);
      }
  };

  // 🖨️ LÓGICA DE REIMPRESIÓN INTELIGENTE
  const handleReprint = async (mov) => {
      try {
          if (mov.type === 'SALE_DEBT' && mov.referenceId) {
              // Si es una venta, buscamos la venta completa
              const sale = await salesRepository.getSaleById(mov.referenceId);
              if (sale) {
                  setTicketData({ sale: sale });
              } else {
                  alert("⚠️ No se encontró el detalle de la venta original.");
              }
          } else {
              // Si es un pago, reconstruimos el recibo
              const receipt = {
                  localId: mov.referenceId || `mov_${mov.id}`,
                  date: mov.date,
                  client: client,
                  amount: mov.amount,
                  newBalance: mov.newBalance,
                  method: 'CTA CTE', 
                  type: 'RECEIPT',
                  // Nota: Al reimprimir un pago histórico simple, no tenemos el surcharge desglosado
                  // a menos que guardemos esa metadata en el ledger. Por ahora mostramos el monto puro.
              };
              setTicketData({ receipt: receipt });
          }
      } catch (error) {
          console.error("Error al reimprimir:", error);
          alert("Error cargando el comprobante.");
      }
  };

  if (loading) return <div className="p-10 text-center text-sys-500">Cargando perfil...</div>;
  if (!client) return <div className="p-10 text-center text-red-500">Cliente no encontrado</div>;

  const debt = client.balance || 0;

  return (
    <div className="space-y-6 pb-20 animate-in slide-in-from-right duration-300">
      
      {/* Header Navegación */}
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 hover:bg-sys-100 rounded-full transition-colors text-sys-500">
            <ArrowLeft size={24} />
        </button>
        <div>
            <h2 className="text-2xl font-bold text-sys-900">{client.name}</h2>
            <div className="flex items-center gap-2 text-xs text-sys-500">
                <span className="font-mono bg-sys-100 px-1.5 rounded">{client.docNumber}</span>
                <span>•</span>
                <span className="uppercase">{client.fiscalCondition?.replace(/_/g, ' ')}</span>
            </div>
        </div>
      </div>

      {/* Tarjetas de Estado */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* TARJETA DE SALDO */}
          <Card className={cn("border-l-4 flex flex-col justify-between relative overflow-hidden", debt > 0 ? "border-l-red-500" : "border-l-green-500")}>
              <div className="z-10">
                  <p className="text-sm font-bold text-sys-500 uppercase tracking-wider mb-1">Saldo Actual (Deuda Global)</p>
                  <p className={cn("text-4xl font-black tracking-tighter", debt > 0 ? "text-red-600" : "text-green-600")}>
                      $ {debt.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                  </p>
              </div>
              <div className="mt-4 z-10">
                  <Button 
                    variant="secondary" 
                    className="w-full border-sys-200 hover:bg-sys-50 text-sm h-10 font-bold"
                    onClick={() => setIsPaymentOpen(true)}
                    disabled={debt <= 0} 
                  >
                      <DollarSign size={16} className="mr-2 text-green-600"/> Registrar Pago
                  </Button>
              </div>
              <div className={cn("absolute -right-4 -bottom-4 opacity-10 transform rotate-12", debt > 0 ? "text-red-500" : "text-green-500")}>
                  <TrendingDown size={120} />
              </div>
          </Card>

          {/* Datos de Contacto */}
          <Card className="flex flex-col justify-center space-y-3">
              <div className="flex items-center gap-3 text-sys-700">
                  <div className="w-8 h-8 rounded-full bg-sys-100 flex items-center justify-center shrink-0"><CreditCard size={16}/></div>
                  <div className="text-sm">
                      <p className="font-bold text-xs text-sys-400 uppercase">Documento</p>
                      <p>{client.docType === '80' ? 'CUIT' : 'DNI'} {client.docNumber}</p>
                  </div>
              </div>
              <div className="flex items-center gap-3 text-sys-700">
                  <div className="w-8 h-8 rounded-full bg-sys-100 flex items-center justify-center shrink-0"><MapPin size={16}/></div>
                  <div className="text-sm">
                      <p className="font-bold text-xs text-sys-400 uppercase">Dirección</p>
                      <p className="truncate max-w-[200px]">{client.address || '-'}</p>
                  </div>
              </div>
          </Card>
      </div>

      {/* Historial de Cuenta Corriente (Ledger) */}
      <div>
          <h3 className="text-lg font-bold text-sys-900 mb-4 flex items-center gap-2">
              <FileText size={20} className="text-brand"/> Movimientos de Cuenta
          </h3>
          
          <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                      <thead className="bg-sys-50 text-sys-500 text-xs uppercase font-semibold border-b border-sys-100">
                          <tr>
                              <th className="p-4">Fecha</th>
                              <th className="p-4">Sucursal</th> {/* 🔥 NUEVA COLUMNA */}
                              <th className="p-4">Descripción</th>
                              <th className="p-4 text-right">Monto</th>
                              <th className="p-4 text-right">Saldo</th>
                              <th className="p-4 text-center">Acción</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-sys-100">
                          {ledger.length === 0 ? (
                              <tr>
                                  <td colSpan="6" className="p-8 text-center text-sys-400 italic">Sin movimientos registrados</td>
                              </tr>
                          ) : (
                              ledger.map((mov, idx) => (
                                  <tr key={idx} className="hover:bg-sys-50/50 transition-colors group">
                                      <td className="p-4 font-mono text-sys-600 whitespace-nowrap text-xs">
                                          {new Date(mov.date).toLocaleDateString()} <span className="opacity-60">{new Date(mov.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                      </td>
                                      {/* 🔥 TRAZABILIDAD DE SUCURSAL */}
                                      <td className="p-4">
                                          {mov.branchId === activeBranchId ? (
                                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-brand/10 text-brand text-[10px] font-bold uppercase tracking-wide">
                                                  <Building2 size={10} /> Actual
                                              </span>
                                          ) : (
                                              <span className="text-[10px] font-bold text-sys-400 uppercase bg-sys-100 px-2 py-0.5 rounded">
                                                  {mov.branchId || 'Global'}
                                              </span>
                                          )}
                                      </td>
                                      <td className="p-4">
                                          <div className="flex items-center gap-2">
                                              <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", mov.type === 'SALE_DEBT' ? "bg-red-500" : "bg-green-500")}></div>
                                              <span className="font-medium text-sys-800 text-xs md:text-sm">{mov.description}</span>
                                          </div>
                                          {mov.referenceId && <p className="text-[9px] text-sys-400 ml-3.5 font-mono">Ref: {mov.referenceId.slice(-8)}</p>}
                                      </td>
                                      <td className={cn("p-4 text-right font-bold text-xs md:text-sm", mov.type === 'SALE_DEBT' ? "text-red-600" : "text-green-600")}>
                                          {mov.type === 'SALE_DEBT' ? '+' : '-'} $ {mov.amount.toLocaleString()}
                                      </td>
                                      <td className="p-4 text-right font-mono text-sys-600 text-xs md:text-sm font-bold">
                                          $ {mov.newBalance.toLocaleString()}
                                      </td>
                                      <td className="p-4 text-center">
                                          <button 
                                            onClick={() => handleReprint(mov)}
                                            className="p-1.5 rounded-lg text-sys-400 hover:text-sys-800 hover:bg-sys-200 transition-all opacity-0 group-hover:opacity-100"
                                            title="Ver Comprobante"
                                          >
                                              <Printer size={16} />
                                          </button>
                                      </td>
                                  </tr>
                              ))
                          )}
                      </tbody>
                  </table>
              </div>
          </Card>
      </div>

      {/* 🟢 MODALES 🟢 */}
      
      <PaymentModal 
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        total={debt} 
        client={client} 
        onConfirm={handlePaymentConfirm}
        // No deshabilitamos AFIP del todo, pero indicamos que es un cobro de deuda
        // Generalmente los cobros de deuda se hacen con Recibo X, 
        // ya que la factura se emitió (o debió emitirse) al momento de la venta original.
        disableAfip={true} 
      />

      {/* Modal de Ticket (Venta o Recibo) */}
      <TicketModal 
        isOpen={!!ticketData}
        sale={ticketData?.sale}
        receipt={ticketData?.receipt}
        onClose={() => setTicketData(null)}
      />

    </div>
  );
};