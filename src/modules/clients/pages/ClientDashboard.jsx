import React, { useEffect, useState } from 'react';
import { 
    ArrowLeft, User, CreditCard, Calendar, 
    TrendingDown, DollarSign, FileText, Printer, Search, MapPin, Building2, CheckCircle2, Mail
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
  // 💰 PROCESAMIENTO DEL COBRO DE DEUDA (SOPORTA MULTI-PAGO BLINDADO)
  // =================================================================
  const handlePaymentConfirm = async (paymentData) => {
      try {
          const shift = await cashRepository.getCurrentShift();
          if (!shift) {
              toast.error("⛔ Debe abrir la caja antes de recibir un pago.");
              return;
          }

          const paymentsToProcess = (Array.isArray(paymentData.payments) && paymentData.payments.length > 0)
                ? paymentData.payments 
                : [paymentData];

          let totalCapitalPaid = 0;
          let totalMoneyInBox = 0;
          let methodsUsed = [];

          // 1. Registrar Ingresos en Caja por cada método utilizado
          for (const p of paymentsToProcess) {
              // 🔥 FIX CRÍTICO: Primero leemos 'amountPaid' (lo que tipeaste) o 'amount' (si es pago dividido).
              // Si no existen, recién caemos en el 'baseAmount'.
              const realPaymentAmount = parseFloat(p.amountPaid || p.amount || p.baseAmount || 0); 
              
              const surcharge = parseFloat(p.surcharge || 0);
              const moneyInBox = realPaymentAmount + surcharge; // Lo que entra a la caja realmente
              const method = p.method || 'cash';
              
              if (realPaymentAmount <= 0) continue;

              await cashRepository.registerIncome(
                  moneyInBox,
                  method, 
                  `Cobro Cta Cte: ${client.name} ${surcharge > 0 ? '(c/Interés)' : ''}` 
              );

              totalCapitalPaid += realPaymentAmount;
              totalMoneyInBox += moneyInBox;
              methodsUsed.push(method);
          }

          if (totalCapitalPaid <= 0) {
              toast.error("El monto a cobrar es inválido o cero.");
              return;
          }

          // 2. Registrar Baja Única en Ledger (Solo baja el Capital total)
          const referenceId = `rec_${Date.now()}`;
          const uniqueMethods = [...new Set(methodsUsed)].map(m => m.toUpperCase());

          const newBalance = await clientRepository.registerMovement(
              client.id,
              'PAYMENT',
              totalCapitalPaid, 
              `Pago a cuenta (${uniqueMethods.join(' + ')})`,
              referenceId,
              methodsUsed.length > 1 ? 'split' : methodsUsed[0] 
          );

          // 3. Generar Objeto Recibo para imprimir
          const receiptObj = {
              localId: referenceId,
              date: new Date().toISOString(),
              client: client,
              amount: totalMoneyInBox, 
              newBalance: newBalance,
              method: methodsUsed.length > 1 ? 'SPLIT' : methodsUsed[0],
              type: 'RECEIPT',
              surcharge: parseFloat(paymentData.surcharge || 0),
              baseAmount: totalCapitalPaid,
              totalSale: totalMoneyInBox,
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
      const toastId = toast.loading("Buscando comprobante...");
      try {
          if (mov.type === 'SALE_DEBT' && mov.referenceId) {
              // Si es una venta, buscamos la venta completa
              const sale = await salesRepository.getSaleById(mov.referenceId);
              if (sale) {
                  setTicketData({ sale: sale });
                  toast.dismiss(toastId);
              } else {
                  toast.error("El comprobante original de esta venta no está en el dispositivo.", { id: toastId });
              }
          } else {
              // Si es un pago, reconstruimos el recibo a partir del Ledger
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
              toast.dismiss(toastId);
          }
      } catch (error) {
          console.error("Error al reimprimir:", error);
          toast.error("Error cargando el comprobante.", { id: toastId });
      }
  };

  if (loading) return <div className="p-10 text-center text-sys-500 font-bold uppercase tracking-widest animate-pulse">Cargando perfil...</div>;
  if (!client) return <div className="p-10 text-center text-red-500 font-bold">Cliente no encontrado</div>;

  const debt = parseFloat(client.balance || 0);

  return (
    <div className="space-y-6 pb-20 animate-in slide-in-from-right duration-300 max-w-[1600px] mx-auto p-4 md:p-6">
      
      {/* Header Navegación */}
      <div className="flex items-center gap-4 bg-white p-4 rounded-3xl border border-sys-200 shadow-sm">
        <button onClick={onBack} className="p-2 hover:bg-sys-100 rounded-full transition-colors text-sys-500 hover:text-sys-900 border border-transparent hover:border-sys-200">
            <ArrowLeft size={24} />
        </button>
        <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-sm bg-sys-400">
                {client.name.charAt(0).toUpperCase()}
            </div>
            <div>
                <h2 className="text-2xl font-black text-sys-900 leading-none uppercase">{client.name}</h2>
                <div className="flex items-center gap-2 text-xs text-sys-500 mt-1.5">
                    <span className="font-mono bg-sys-100 px-2 py-0.5 rounded text-sys-600 font-bold border border-sys-200 flex items-center gap-1">
                        <CreditCard size={12}/> {client.docType === '80' ? 'CUIT' : 'DNI'} {client.docNumber || 'S/N'}
                    </span>
                    <span className="font-mono bg-sys-100 px-2 py-0.5 rounded text-sys-600 font-bold border border-sys-200">
                        ID: {client.sequentialId || 'S/N'}
                    </span>
                    <span className="uppercase font-bold text-sys-400 bg-sys-50 px-2 py-0.5 rounded border border-sys-100">
                        {client.fiscalCondition?.replace(/_/g, ' ') || 'CONSUMIDOR FINAL'}
                    </span>
                </div>
            </div>
        </div>
      </div>

      {/* Tarjetas de Estado */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* TARJETA DE SALDO */}
          <Card className={cn("border-l-8 flex flex-col justify-between relative overflow-hidden h-40", debt > 0 ? "border-l-red-500 bg-red-50/20" : "border-l-emerald-500 bg-emerald-50/20")}>
              <div className="z-10 h-full flex flex-col justify-between">
                  <div>
                      <p className={cn("text-xs font-black uppercase tracking-wider mb-1 flex items-center gap-1.5", debt > 0 ? "text-red-500" : "text-emerald-600")}>
                          {debt > 0 ? <TrendingDown size={14}/> : <CheckCircle2 size={14}/>}
                          Saldo Actual (Deuda)
                      </p>
                      <p className={cn("text-4xl font-black tracking-tighter", debt > 0 ? "text-red-600" : "text-emerald-600")}>
                          {formatCurrency(debt)}
                      </p>
                  </div>
                  <div className="mt-4">
                      <Button 
                        variant="secondary" 
                        className={cn(
                            "w-full text-sm h-11 font-black transition-all border shadow-sm",
                            debt > 0 
                                ? "bg-white border-red-200 hover:bg-red-500 hover:text-white text-red-600 hover:border-red-600" 
                                : "bg-white border-sys-200 text-sys-400 opacity-50 cursor-not-allowed"
                        )}
                        onClick={() => setIsPaymentOpen(true)}
                        disabled={debt <= 0} 
                      >
                          <DollarSign size={18} className="mr-2"/> Registrar Pago
                      </Button>
                  </div>
              </div>
              <div className={cn("absolute -right-4 -bottom-4 opacity-10 transform rotate-12", debt > 0 ? "text-red-500" : "text-emerald-500")}>
                  {debt > 0 ? <TrendingDown size={140} /> : <CheckCircle2 size={140} />}
              </div>
          </Card>

          {/* Datos de Contacto */}
          <Card className="flex flex-col justify-center space-y-4 md:col-span-2 h-40 bg-white">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="flex items-center gap-4 text-sys-700">
                      <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                          <Mail size={20} className="text-blue-500"/>
                      </div>
                      <div className="text-sm min-w-0">
                          <p className="font-black text-[10px] text-sys-400 uppercase tracking-widest">Contacto / Email</p>
                          <p className="font-bold text-sys-900 truncate" title={client.email}>{client.email || 'Sin registrar'}</p>
                          {client.phone && <p className="font-medium text-sys-500 text-xs mt-0.5"><Phone size={10} className="inline mr-1"/>{client.phone}</p>}
                      </div>
                  </div>
                  <div className="flex items-center gap-4 text-sys-700 border-l border-sys-100 pl-6">
                      <div className="w-12 h-12 rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center shrink-0">
                          <MapPin size={20} className="text-orange-500"/>
                      </div>
                      <div className="text-sm min-w-0">
                          <p className="font-black text-[10px] text-sys-400 uppercase tracking-widest">Dirección Física</p>
                          <p className="font-bold text-sys-900 truncate" title={client.address}>{client.address || '-'}</p>
                      </div>
                  </div>
              </div>
          </Card>
      </div>

      {/* Historial de Cuenta Corriente (Ledger) */}
      <div>
          <h3 className="text-xl font-black text-sys-900 mb-4 flex items-center gap-2">
              <FileText size={24} className="text-brand"/> Movimientos de Cuenta Corriente
          </h3>
          
          <Card className="p-0 overflow-hidden border border-sys-200 shadow-sm">
              <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                      <thead className="bg-sys-50 text-sys-500 text-[10px] uppercase font-black tracking-widest border-b border-sys-200">
                          <tr>
                              <th className="p-4 whitespace-nowrap">Fecha / Hora</th>
                              <th className="p-4 text-center whitespace-nowrap">Sucursal</th>
                              <th className="p-4 w-full">Descripción del Movimiento</th>
                              <th className="p-4 text-right whitespace-nowrap">Importe</th>
                              <th className="p-4 text-right whitespace-nowrap">Saldo (Deuda)</th>
                              <th className="p-4 text-center whitespace-nowrap">Acciones</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-sys-100 bg-white">
                          {ledger.length === 0 ? (
                              <tr>
                                  <td colSpan="6" className="p-12 text-center text-sys-400">
                                      <div className="flex flex-col items-center justify-center bg-sys-50/50 rounded-2xl border-2 border-dashed border-sys-200 py-10 w-3/4 mx-auto">
                                          <FileText size={32} className="mb-2 opacity-30 text-sys-500"/>
                                          <p className="font-bold uppercase tracking-widest text-xs">Sin movimientos en la cuenta</p>
                                          <p className="text-[10px] text-sys-400 mt-1">El cliente no tiene compras a crédito ni pagos registrados.</p>
                                      </div>
                                  </td>
                              </tr>
                          ) : (
                              ledger.map((mov, idx) => (
                                  <tr key={idx} className="hover:bg-sys-50/50 transition-colors group cursor-default">
                                      <td className="p-4 font-mono text-sys-600 whitespace-nowrap">
                                          <div className="font-bold text-sys-900 text-xs">{new Date(mov.date).toLocaleDateString()}</div>
                                          <div className="text-[10px] text-sys-400 mt-0.5">{new Date(mov.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                                      </td>
                                      
                                      <td className="p-4 text-center align-top pt-5">
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
                                          {mov.referenceId && <p className="text-[9px] text-sys-400 ml-3.5 font-mono uppercase mt-1 bg-sys-50 inline-block px-1.5 py-0.5 rounded border border-sys-100">Ref: {mov.referenceId.slice(-8)}</p>}
                                      </td>
                                      
                                      <td className={cn("p-4 text-right font-black font-mono text-sm whitespace-nowrap align-top pt-4", mov.type === 'SALE_DEBT' ? "text-red-600" : "text-emerald-600")}>
                                          {mov.type === 'SALE_DEBT' ? '+' : '-'} {formatCurrency(mov.amount)}
                                      </td>
                                      
                                      <td className="p-4 text-right font-mono text-sys-900 text-sm font-black bg-sys-50/50 align-top pt-4 border-l border-sys-100">
                                          {formatCurrency(mov.newBalance)}
                                      </td>
                                      
                                      <td className="p-4 text-center align-top pt-3">
                                          <button 
                                            onClick={() => handleReprint(mov)}
                                            className="p-2 rounded-xl text-sys-400 hover:text-brand hover:bg-brand/10 hover:border-brand/20 border border-transparent transition-all opacity-0 group-hover:opacity-100 mx-auto block"
                                            title={mov.type === 'SALE_DEBT' ? "Ver Ticket de Venta" : "Ver Recibo de Pago"}
                                          >
                                              <Printer size={18} />
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