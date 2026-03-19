import React, { useEffect, useState } from 'react';
import { 
    ArrowLeft, User, CreditCard, Calendar, 
    TrendingDown, DollarSign, FileText, Printer, Search, MapPin, Building2
} from 'lucide-react';
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import { clientRepository } from '../repositories/clientRepository';
import { cashRepository } from '../../cash/repositories/cashRepository'; 
import { salesRepository } from '../../sales/repositories/salesRepository'; 
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

// Imports Modales
import { PaymentModal } from '../../pos/components/PaymentModal';
import { TicketModal } from '../../sales/components/TicketModal';
import { toast } from 'react-hot-toast';

const formatCurrency = (amount) => `$ ${Number(amount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
        toast.error("Error cargando el estado de cuenta");
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    if (clientId) loadData();
  }, [clientId]);

  // =================================================================
  // 💰 PROCESAMIENTO DEL COBRO DE DEUDA (SOPORTA MULTI-PAGO)
  // =================================================================
  const handlePaymentConfirm = async (paymentData) => {
      try {
          const shift = await cashRepository.getCurrentShift();
          if (!shift) {
              toast.error("⛔ Debe abrir la caja antes de recibir un pago.");
              return;
          }

          // Compatibilidad con Multi-Pago (Si PaymentModal devuelve array o un solo objeto)
          const paymentsToProcess = Array.isArray(paymentData.payments) 
                ? paymentData.payments 
                : [{
                    method: paymentData.method,
                    amountPaid: parseFloat(paymentData.amountPaid || 0),
                    surcharge: parseFloat(paymentData.surcharge || 0),
                    totalSale: parseFloat(paymentData.totalSale || paymentData.amountPaid || 0),
                    baseAmount: parseFloat(paymentData.baseAmount || paymentData.amountPaid || 0)
                }];

          let totalCapitalPaid = 0;
          let totalMoneyInBox = 0;
          let methodsUsed = [];

          // 1. Registrar Ingresos en Caja por cada método utilizado
          for (const p of paymentsToProcess) {
              const realPaymentAmount = p.baseAmount || p.amountPaid; // Lo que baja la deuda
              const moneyInBox = p.totalSale || p.amountPaid; // Lo que entra a la caja (con recargo)
              
              if (realPaymentAmount <= 0) continue;

              await cashRepository.registerIncome(
                  moneyInBox,
                  p.method, 
                  `Cobro Cta Cte: ${client.name} ${p.surcharge > 0 ? '(c/Interés)' : ''}` 
              );

              totalCapitalPaid += realPaymentAmount;
              totalMoneyInBox += moneyInBox;
              methodsUsed.push(p.method);
          }

          if (totalCapitalPaid <= 0) return;

          // 2. Registrar Baja Única en Ledger (Solo baja el Capital total)
          const referenceId = `rec_${Date.now()}`;
          const newBalance = await clientRepository.registerMovement(
              client.id,
              'PAYMENT',
              totalCapitalPaid, 
              `Pago a cuenta (${methodsUsed.join(', ')})`,
              referenceId 
          );

          // 3. Generar Objeto Recibo para imprimir
          const receiptObj = {
              localId: referenceId,
              date: new Date().toISOString(),
              client: client,
              amount: totalMoneyInBox, // En el recibo mostramos lo que pagó realmente
              newBalance: newBalance,
              method: methodsUsed.length > 1 ? 'MIXTO' : methodsUsed[0],
              type: 'RECEIPT',
              // Guardamos detalle financiero para el ticket
              surcharge: paymentData.surcharge || 0,
              baseAmount: totalCapitalPaid,
              totalSale: totalMoneyInBox,
              // Snapshot de la sucursal actual para el encabezado del ticket
              companySnapshot: {
                  nombre: activeBranchName || 'Sucursal Central', 
              }
          };

          // 4. Finalizar
          toast.success("Pago registrado correctamente");
          setTicketData({ receipt: receiptObj }); 
          setIsPaymentOpen(false);
          loadData(); 
          
      } catch (error) {
          console.error(error);
          toast.error("Error al procesar el pago: " + error.message);
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
                  toast.error("⚠️ No se encontró el detalle de la venta original.");
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
                  companySnapshot: { nombre: activeBranchName }
              };
              setTicketData({ receipt: receipt });
          }
      } catch (error) {
          console.error("Error al reimprimir:", error);
          toast.error("Error cargando el comprobante.");
      }
  };

  if (loading) return <div className="p-10 text-center text-sys-500 font-bold uppercase tracking-widest animate-pulse">Cargando perfil...</div>;
  if (!client) return <div className="p-10 text-center text-red-500 font-bold">Cliente no encontrado</div>;

  const debt = parseFloat(client.balance || 0);

  return (
    <div className="space-y-6 pb-20 animate-in slide-in-from-right duration-300">
      
      {/* Header Navegación */}
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 hover:bg-sys-100 rounded-full transition-colors text-sys-500">
            <ArrowLeft size={24} />
        </button>
        <div>
            <h2 className="text-2xl font-bold text-sys-900">{client.name}</h2>
            <div className="flex items-center gap-2 text-xs text-sys-500 mt-1">
                <span className="font-mono bg-sys-100 px-2 py-0.5 rounded text-sys-600 font-bold border border-sys-200">
                    {client.docType === '80' ? 'CUIT' : 'DNI'} {client.docNumber}
                </span>
                <span>•</span>
                <span className="uppercase font-bold text-sys-400">{client.fiscalCondition?.replace(/_/g, ' ')}</span>
            </div>
        </div>
      </div>

      {/* Tarjetas de Estado */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* TARJETA DE SALDO */}
          <Card className={cn("border-l-4 flex flex-col justify-between relative overflow-hidden", debt > 0 ? "border-l-red-500" : "border-l-green-500")}>
              <div className="z-10">
                  <p className="text-sm font-bold text-sys-500 uppercase tracking-wider mb-1">Saldo Actual (Deuda)</p>
                  <p className={cn("text-4xl font-black tracking-tighter", debt > 0 ? "text-red-600" : "text-green-600")}>
                      {formatCurrency(debt)}
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
          <Card className="flex flex-col justify-center space-y-4 md:col-span-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex items-center gap-3 text-sys-700">
                      <div className="w-10 h-10 rounded-full bg-sys-50 border border-sys-100 flex items-center justify-center shrink-0"><User size={18} className="text-sys-400"/></div>
                      <div className="text-sm">
                          <p className="font-bold text-[10px] text-sys-400 uppercase">Contacto / Email</p>
                          <p className="font-medium truncate max-w-[200px]">{client.email || 'Sin registrar'}</p>
                      </div>
                  </div>
                  <div className="flex items-center gap-3 text-sys-700">
                      <div className="w-10 h-10 rounded-full bg-sys-50 border border-sys-100 flex items-center justify-center shrink-0"><MapPin size={18} className="text-sys-400"/></div>
                      <div className="text-sm">
                          <p className="font-bold text-[10px] text-sys-400 uppercase">Dirección Física</p>
                          <p className="font-medium truncate max-w-[200px]">{client.address || '-'}</p>
                      </div>
                  </div>
              </div>
          </Card>
      </div>

      {/* Historial de Cuenta Corriente (Ledger) */}
      <div>
          <h3 className="text-lg font-bold text-sys-900 mb-4 flex items-center gap-2">
              <FileText size={20} className="text-brand"/> Movimientos de Cuenta
          </h3>
          
          <Card className="p-0 overflow-hidden border border-sys-200">
              <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                      <thead className="bg-sys-50 text-sys-500 text-[10px] uppercase font-black tracking-widest border-b border-sys-100">
                          <tr>
                              <th className="p-4 w-1/6">Fecha</th>
                              <th className="p-4 w-1/6 text-center">Sucursal</th>
                              <th className="p-4 w-2/6">Descripción</th>
                              <th className="p-4 w-1/6 text-right">Monto</th>
                              <th className="p-4 w-1/6 text-right">Saldo</th>
                              <th className="p-4 w-1/12 text-center">Ticket</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-sys-100">
                          {ledger.length === 0 ? (
                              <tr>
                                  <td colSpan="6" className="p-12 text-center text-sys-400 italic">
                                      <FileText size={32} className="mx-auto mb-2 opacity-50"/>
                                      Sin movimientos registrados en el libro mayor.
                                  </td>
                              </tr>
                          ) : (
                              ledger.map((mov, idx) => (
                                  <tr key={idx} className="hover:bg-sys-50/50 transition-colors group">
                                      <td className="p-4 font-mono text-sys-600 whitespace-nowrap text-[10px]">
                                          <div className="font-bold text-sys-800">{new Date(mov.date).toLocaleDateString()}</div>
                                          <div className="opacity-60">{new Date(mov.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                                      </td>
                                      
                                      <td className="p-4 text-center">
                                          {mov.branchId === activeBranchId ? (
                                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-brand/10 text-brand text-[9px] font-black uppercase tracking-wide border border-brand/20">
                                                  <Building2 size={10} /> Actual
                                              </span>
                                          ) : (
                                              <span className="text-[9px] font-black text-sys-400 uppercase bg-sys-100 px-2 py-0.5 rounded border border-sys-200">
                                                  {mov.branchId || 'Global'}
                                              </span>
                                          )}
                                      </td>
                                      
                                      <td className="p-4">
                                          <div className="flex items-center gap-2">
                                              <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", mov.type === 'SALE_DEBT' ? "bg-red-500" : "bg-emerald-500")}></div>
                                              <span className="font-bold text-sys-800 text-xs uppercase">{mov.description}</span>
                                          </div>
                                          {mov.referenceId && <p className="text-[9px] text-sys-400 ml-3.5 font-mono uppercase mt-0.5">Ref: {mov.referenceId.slice(-8)}</p>}
                                      </td>
                                      
                                      <td className={cn("p-4 text-right font-black font-mono text-xs", mov.type === 'SALE_DEBT' ? "text-red-600" : "text-emerald-600")}>
                                          {mov.type === 'SALE_DEBT' ? '+' : '-'} {formatCurrency(mov.amount)}
                                      </td>
                                      
                                      <td className="p-4 text-right font-mono text-sys-900 text-xs font-black bg-sys-50/30">
                                          {formatCurrency(mov.newBalance)}
                                      </td>
                                      
                                      <td className="p-4 text-center">
                                          <button 
                                            onClick={() => handleReprint(mov)}
                                            className="p-2 rounded-lg text-sys-400 hover:text-brand hover:bg-brand/10 hover:border-brand/20 border border-transparent transition-all opacity-0 group-hover:opacity-100 mx-auto block"
                                            title="Imprimir Comprobante"
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
        disableAfip={true} 
      />

      <TicketModal 
        isOpen={!!ticketData}
        sale={ticketData?.sale}
        receipt={ticketData?.receipt}
        onClose={() => setTicketData(null)}
      />

    </div>
  );
};