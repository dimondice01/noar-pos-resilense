import React, { useEffect, useState, useMemo } from 'react';
import { 
    ArrowLeft, User, CreditCard, Calendar, 
    TrendingDown, DollarSign, FileText, Printer, Search, MapPin, Building2, CheckCircle2, Mail, Loader2, Phone, Filter
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

// Firebase Imports
import { collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db as firestoreDB } from '../../../database/firebase';
import { getDB } from '../../../database/db';

const formatCurrency = (amount) => `$ ${Number(amount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const ClientDashboard = ({ clientId, onBack }) => {
  const { user, activeBranchId, activeBranchName } = useAuthStore();
  
  const [client, setClient] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);
  // 🔥 ESTADO DE SALDO CALCULADO EN VIVO
  const [calculatedDebt, setCalculatedDebt] = useState(0);
  
  // Estados UI
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [ticketData, setTicketData] = useState(null); 

  // Estados Filtros
  const [filterType, setFilterType] = useState('THIS_MONTH'); 
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1);
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filteredLedger = useMemo(() => {
    return ledger.filter(mov => {
      if (!mov.date) return true;
      const movDate = new Date(mov.date);
      if (filterType === 'ALL') return true;
      if (filterType === 'THIS_MONTH') {
        const now = new Date();
        return movDate.getMonth() === now.getMonth() && movDate.getFullYear() === now.getFullYear();
      }
      if (filterType === 'MONTH') {
        return movDate.getMonth() + 1 === parseInt(filterMonth) && movDate.getFullYear() === parseInt(filterYear);
      }
      if (filterType === 'MANUAL') {
        if (dateFrom && new Date(mov.date) < new Date(dateFrom + 'T00:00:00')) return false;
        if (dateTo && new Date(mov.date) > new Date(dateTo + 'T23:59:59')) return false;
        return true;
      }
      return true;
    });
  }, [ledger, filterType, filterMonth, filterYear, dateFrom, dateTo]);

  const calculateTotalDebt = (movements) => {
        let totalDebt = 0;
        movements.forEach(mov => {
            const amount = parseFloat(mov.amount) || 0;
            if (mov.type === 'PAYMENT' || mov.type === 'REFUND' || mov.type === 'LIQUIDATION') {
                totalDebt -= amount;
            } else if (mov.type === 'SALE_DEBT') {
                totalDebt += amount;
            }
        });
        return Math.max(0, totalDebt);
  };

  const loadData = async () => {
    setLoading(true);
    
    try {
        const c = await clientRepository.getById(clientId);
        setClient(c);

        let movements = await clientRepository.getLedger(clientId);

        // 🔥 AUTO-HIDRATACIÓN SILENCIOSA O FORZADA DE NUBE
        if (movements.length === 0 && navigator.onLine && user?.companyId) {
            try {
                const dbLocal = await getDB();
                const q = query(
                    collection(firestoreDB, `companies/${user.companyId}/customer_ledger`),
                    where('clientId', '==', clientId),
                    orderBy('date', 'desc'),
                    limit(200)
                );
                
                const snap = await getDocs(q);
                const cloudMovs = [];
                snap.docs.forEach(docSnap => {
                    const data = docSnap.data();
                    cloudMovs.push({ ...data, id: docSnap.id, firestoreId: docSnap.id, syncStatus: 'synced' });
                });

                if (cloudMovs.length > 0) {
                    const pendingSet = new Set(
                        (await dbLocal.customer_ledger.where('syncStatus').equals('pending').toArray())
                            .map(m => String(m.id))
                    );
                    const safeMoves = cloudMovs.filter(m => !pendingSet.has(String(m.id)));
                    if (safeMoves.length > 0) await dbLocal.customer_ledger.bulkPut(safeMoves);
                    movements = await clientRepository.getLedger(clientId);
                }
            } catch (e) {
                console.warn("Fallo hidratación del historial del cliente:", e);
            }
        }

        const sortedLedger = movements.sort((a, b) => new Date(b.date) - new Date(a.date));
        setLedger(sortedLedger);
        
        // Calculamos la deuda real
        setCalculatedDebt(calculateTotalDebt(sortedLedger));

    } catch (error) {
        console.error(error);
        toast.error("Error cargando el estado de cuenta");
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    if (clientId) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

          await clientRepository.registerMovement(
              client.id,
              'PAYMENT',
              totalCapitalPaid, 
              `Pago a cuenta (${uniqueMethods.join(' + ')})`,
              referenceId,
              methodsUsed.length > 1 ? 'split' : methodsUsed[0] 
          );

          // 3. Generar Objeto Recibo para imprimir
          const newBalance = Math.max(0, calculatedDebt - totalCapitalPaid); // Calculado en memoria para el recibo rápido
          
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

  if (loading) return <div className="h-screen flex items-center justify-center text-sys-500 font-bold uppercase tracking-widest animate-pulse"><Loader2 className="animate-spin mb-2 text-brand" size={32}/>Cargando perfil...</div>;
  if (!client) return <div className="p-10 text-center text-red-500 font-bold">Cliente no encontrado</div>;

  return (
    <div className="space-y-6 pb-20 animate-in slide-in-from-right duration-300 max-w-[1600px] mx-auto p-4 md:p-6">
      
      {/* Header Navegación */}
      <div className="flex items-center gap-4 bg-white p-4 rounded-3xl border border-sys-200 shadow-sm">
        <button onClick={onBack} className="p-2 hover:bg-sys-100 rounded-full transition-colors text-sys-500 hover:text-sys-900 border border-transparent hover:border-sys-200">
            <ArrowLeft size={24} />
        </button>
        <div className="flex items-center gap-4 flex-1">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-sm bg-sys-400 shrink-0">
                {client.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-black text-sys-900 leading-none uppercase truncate">{client.name}</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-sys-500 mt-1.5">
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
          
          {/* TARJETA DE SALDO CALCULADO */}
          <Card className={cn("border-l-8 flex flex-col justify-between relative overflow-hidden h-40", calculatedDebt > 0.01 ? "border-l-red-500 bg-red-50/20" : "border-l-emerald-500 bg-emerald-50/20")}>
              <div className="z-10 h-full flex flex-col justify-between">
                  <div>
                      <p className={cn("text-xs font-black uppercase tracking-wider mb-1 flex items-center gap-1.5", calculatedDebt > 0.01 ? "text-red-500" : "text-emerald-600")}>
                          {calculatedDebt > 0.01 ? <TrendingDown size={14}/> : <CheckCircle2 size={14}/>}
                          Saldo Actual (Deuda)
                      </p>
                      <p className={cn("text-4xl font-black tracking-tighter", calculatedDebt > 0.01 ? "text-red-600" : "text-emerald-600")}>
                          {formatCurrency(calculatedDebt)}
                      </p>
                  </div>
                  <div className="mt-4">
                      <Button 
                        variant="secondary" 
                        className={cn(
                            "w-full text-sm h-11 font-black transition-all border shadow-sm",
                            calculatedDebt > 0.01 
                                ? "bg-white border-red-200 hover:bg-red-500 hover:text-white text-red-600 hover:border-red-600" 
                                : "bg-white border-sys-200 text-sys-400 opacity-50 cursor-not-allowed"
                        )}
                        onClick={() => setIsPaymentOpen(true)}
                        disabled={calculatedDebt <= 0.01} 
                      >
                          <DollarSign size={18} className="mr-2"/> Registrar Pago
                      </Button>
                  </div>
              </div>
              <div className={cn("absolute -right-4 -bottom-4 opacity-10 transform rotate-12", calculatedDebt > 0.01 ? "text-red-500" : "text-emerald-500")}>
                  {calculatedDebt > 0.01 ? <TrendingDown size={140} /> : <CheckCircle2 size={140} />}
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
          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-4 gap-4">
              <h3 className="text-xl font-black text-sys-900 flex items-center gap-2">
                  <FileText size={24} className="text-brand"/> Movimientos de Cuenta Corriente
              </h3>
              
              {/* Controles de Filtro */}
              <div className="flex flex-wrap items-center gap-2 bg-white p-2 rounded-xl border border-sys-200 shadow-sm">
                  <div className="flex items-center gap-2 text-sys-500 px-2 font-bold text-xs uppercase tracking-widest border-r border-sys-200 mr-1">
                      <Filter size={14}/> Filtro
                  </div>
                  <select 
                      value={filterType} 
                      onChange={e => setFilterType(e.target.value)} 
                      className="bg-sys-50 border border-sys-200 text-sys-700 text-sm rounded-lg px-3 py-1.5 font-semibold outline-none focus:border-brand"
                  >
                      <option value="THIS_MONTH">Este Mes</option>
                      <option value="MONTH">Por Mes</option>
                      <option value="MANUAL">Periodo Manual</option>
                      <option value="ALL">Todo el Historial</option>
                  </select>

                  {filterType === 'MONTH' && (
                      <>
                          <select 
                              value={filterMonth} 
                              onChange={e => setFilterMonth(e.target.value)}
                              className="bg-sys-50 border border-sys-200 text-sys-700 text-sm rounded-lg px-3 py-1.5 font-semibold outline-none focus:border-brand"
                          >
                              {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m, i) => (
                                  <option key={i} value={i+1}>{m}</option>
                              ))}
                          </select>
                          <select 
                              value={filterYear} 
                              onChange={e => setFilterYear(e.target.value)}
                              className="bg-sys-50 border border-sys-200 text-sys-700 text-sm rounded-lg px-3 py-1.5 font-semibold outline-none focus:border-brand"
                          >
                              {[0,1,2,3,4].map(y => {
                                  const year = new Date().getFullYear() - y;
                                  return <option key={year} value={year}>{year}</option>;
                              })}
                          </select>
                      </>
                  )}

                  {filterType === 'MANUAL' && (
                      <div className="flex flex-wrap items-center gap-2">
                          <input 
                              type="date" 
                              value={dateFrom} 
                              onChange={e => setDateFrom(e.target.value)}
                              className="bg-sys-50 border border-sys-200 text-sys-700 text-sm rounded-lg px-2 py-1.5 outline-none focus:border-brand h-[34px] w-[130px]"
                          />
                          <span className="text-sys-400 text-xs font-bold">a</span>
                          <input 
                              type="date" 
                              value={dateTo} 
                              onChange={e => setDateTo(e.target.value)}
                              className="bg-sys-50 border border-sys-200 text-sys-700 text-sm rounded-lg px-2 py-1.5 outline-none focus:border-brand h-[34px] w-[130px]"
                          />
                      </div>
                  )}
              </div>
          </div>
          
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
                          {filteredLedger.length === 0 ? (
                              <tr>
                                  <td colSpan="6" className="p-12 text-center text-sys-400">
                                      <div className="flex flex-col items-center justify-center bg-sys-50/50 rounded-2xl border-2 border-dashed border-sys-200 py-10 w-3/4 mx-auto">
                                          <FileText size={32} className="mb-2 opacity-30 text-sys-500"/>
                                          <p className="font-bold uppercase tracking-widest text-xs">{ledger.length === 0 ? "Sin movimientos en la cuenta" : "No hay movimientos en este periodo"}</p>
                                          <p className="text-[10px] text-sys-400 mt-1">{ledger.length === 0 ? "El cliente no tiene compras a crédito ni pagos registrados." : "Intente cambiar los filtros arriba."}</p>
                                      </div>
                                  </td>
                              </tr>
                          ) : (
                              filteredLedger.map((mov, idx) => (
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
        total={calculatedDebt} 
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