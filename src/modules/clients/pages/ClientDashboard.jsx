import React, { useEffect, useState, useMemo } from 'react';
import { 
    ArrowLeft, User, CreditCard, Calendar,
    TrendingDown, DollarSign, FileText, Printer, Eye, Search, MapPin, Building2, CheckCircle2, Mail, Loader2, Phone, Filter, X
} from 'lucide-react';
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import { clientRepository } from '../repositories/clientRepository';
import { cashRepository } from '../../cash/repositories/cashRepository'; 
import { salesRepository } from '../../sales/repositories/salesRepository'; 
import { Card } from '../../../core/ui/Card';
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
  const [viewSale, setViewSale] = useState(null);

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

        // Merge ventas pagadas al contado (no están en el ledger)
        const ledgerRefIds = new Set(movements.map(m => m.referenceId).filter(Boolean));
        const clientSales = await salesRepository.getSalesByClientId(clientId);
        const paidEntries = clientSales
            .filter(s => !ledgerRefIds.has(s.id))
            .map(s => ({
                id: `sale-${s.id}`,
                clientId,
                referenceId: s.id,
                type: 'SALE_PAID',
                amount: s.total,
                description: `Venta contado (Ticket: ${s.number || s.ticketNumber || s.id})`,
                date: s.date,
                branchId: s.branchId,
                newBalance: null,
            }));

        const sortedLedger = [...movements, ...paidEntries]
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        setLedger(sortedLedger);

        // Deuda real: solo SALE_DEBT, ignora SALE_PAID
        setCalculatedDebt(calculateTotalDebt(movements));

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
          if ((mov.type === 'SALE_DEBT' || mov.type === 'SALE_PAID') && mov.referenceId) {
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

  const handleViewSale = async (mov) => {
      if (!mov.referenceId) return;
      const sale = await salesRepository.getSaleById(mov.referenceId);
      if (sale) setViewSale(sale);
      else toast.error("Venta no encontrada en este dispositivo.");
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
                      <p className={cn("text-xs font-bold uppercase tracking-widest", calculatedDebt > 0.01 ? "text-red-400" : "text-emerald-500")}>
                          {calculatedDebt > 0.01 ? "Saldo pendiente de cobro" : "Al día — sin deuda"}
                      </p>
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
                              <th className="px-4 py-3 whitespace-nowrap">Fecha</th>
                              <th className="px-4 py-3 whitespace-nowrap">Tipo</th>
                              <th className="px-4 py-3 w-full">Descripción</th>
                              <th className="px-4 py-3 text-right whitespace-nowrap">Importe</th>
                              <th className="px-4 py-3 text-right whitespace-nowrap">Saldo Deuda</th>
                              <th className="px-4 py-3 text-center whitespace-nowrap">Acciones</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-sys-100 bg-white">
                          {filteredLedger.length === 0 ? (
                              <tr>
                                  <td colSpan="6" className="p-12 text-center text-sys-400">
                                      <div className="flex flex-col items-center justify-center bg-sys-50/50 rounded-2xl border-2 border-dashed border-sys-200 py-10 w-3/4 mx-auto">
                                          <FileText size={32} className="mb-2 opacity-30 text-sys-500"/>
                                          <p className="font-bold uppercase tracking-widest text-xs">{ledger.length === 0 ? "Sin movimientos en la cuenta" : "No hay movimientos en este periodo"}</p>
                                          <p className="text-[10px] text-sys-400 mt-1">{ledger.length === 0 ? "El cliente no tiene ventas ni pagos registrados." : "Intente cambiar los filtros arriba."}</p>
                                      </div>
                                  </td>
                              </tr>
                          ) : (
                              filteredLedger.map((mov, idx) => (
                                  <tr key={idx} className={cn("border-b border-sys-100 last:border-0 transition-colors", mov.type === 'SALE_DEBT' ? "hover:bg-red-50/30" : mov.type === 'SALE_PAID' ? "hover:bg-blue-50/20" : "hover:bg-emerald-50/20")}>
                                      <td className="px-4 py-3 whitespace-nowrap">
                                          <div className="font-bold text-sys-900 text-xs">{new Date(mov.date).toLocaleDateString('es-AR', {day:'2-digit', month:'2-digit', year:'2-digit'})}</div>
                                          <div className="text-[10px] text-sys-400 mt-0.5 font-mono">{new Date(mov.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                                      </td>

                                      <td className="px-4 py-3">
                                          <span className={cn(
                                              "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wide border",
                                              mov.type === 'SALE_DEBT' ? "bg-red-50 text-red-600 border-red-200" :
                                              mov.type === 'SALE_PAID' ? "bg-blue-50 text-blue-600 border-blue-200" :
                                              "bg-emerald-50 text-emerald-600 border-emerald-200"
                                          )}>
                                              {mov.type === 'SALE_DEBT' ? 'Deuda' : mov.type === 'SALE_PAID' ? 'Contado' : mov.type === 'PAYMENT' ? 'Pago' : mov.type === 'REFUND' ? 'Devolución' : 'Liquidación'}
                                          </span>
                                      </td>

                                      <td className="px-4 py-3 max-w-[200px]">
                                          <span className="font-semibold text-sys-800 text-xs truncate block">{mov.description}</span>
                                          {mov.referenceId && <span className="text-[9px] text-sys-400 font-mono">#{mov.referenceId.slice(-8)}</span>}
                                      </td>

                                      <td className={cn("px-4 py-3 text-right font-black font-mono text-sm whitespace-nowrap", mov.type === 'SALE_DEBT' ? "text-red-600" : mov.type === 'SALE_PAID' ? "text-blue-600" : "text-emerald-600")}>
                                          {mov.type === 'SALE_DEBT' ? '+' : mov.type === 'SALE_PAID' ? '' : '-'} {formatCurrency(mov.amount)}
                                      </td>

                                      <td className="px-4 py-3 text-right font-mono text-sys-700 text-sm font-bold bg-sys-50/40 border-l border-sys-100">
                                          {mov.type === 'SALE_PAID' ? <span className="text-sys-300">—</span> : formatCurrency(mov.newBalance)}
                                      </td>

                                      <td className="px-4 py-3 text-center">
                                          <div className="flex items-center justify-center gap-1">
                                              {(mov.type === 'SALE_DEBT' || mov.type === 'SALE_PAID') && (
                                                  <button
                                                      onClick={() => handleViewSale(mov)}
                                                      className="p-1.5 rounded-lg bg-blue-50 text-blue-500 hover:bg-blue-100 border border-blue-200 transition-all"
                                                      title="Ver detalle"
                                                  >
                                                      <Eye size={14} />
                                                  </button>
                                              )}
                                              <button
                                                  onClick={() => handleReprint(mov)}
                                                  className="p-1.5 rounded-lg bg-sys-100 text-sys-500 hover:bg-sys-200 border border-sys-200 transition-all"
                                                  title="Imprimir"
                                              >
                                                  <Printer size={14} />
                                              </button>
                                          </div>
                                      </td>
                                  </tr>
                              ))
                          )}
                      </tbody>
                  </table>
              </div>
          </Card>
      </div>

      {/* BARRA DE ACCIONES FIJA */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-white border border-sys-200 shadow-2xl rounded-2xl px-3 py-2.5">
          <button
              onClick={onBack}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sys-500 hover:text-sys-900 hover:bg-sys-100 border border-transparent hover:border-sys-200 text-sm font-bold transition-all"
          >
              <ArrowLeft size={16}/> Volver
          </button>
          <div className="w-px h-6 bg-sys-200" />
          <button
              onClick={() => setIsPaymentOpen(true)}
              disabled={calculatedDebt <= 0.01}
              className={cn(
                  "flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-black border transition-all",
                  calculatedDebt > 0.01
                      ? "bg-red-500 text-white border-red-600 hover:bg-red-600 shadow-sm"
                      : "bg-sys-100 text-sys-400 border-sys-200 cursor-not-allowed opacity-60"
              )}
          >
              <DollarSign size={16}/>
              Registrar Pago
              {calculatedDebt > 0.01 && <span className="ml-1 bg-white/20 px-1.5 py-0.5 rounded-lg text-xs font-black">{formatCurrency(calculatedDebt)}</span>}
          </button>
      </div>

      {/* SALE VIEW MODAL */}
      {viewSale && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setViewSale(null)}>
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                  {/* Header */}
                  <div className="flex items-center justify-between p-5 border-b border-sys-100">
                      <div>
                          <p className="text-xs font-black uppercase tracking-widest text-sys-400">Detalle de Venta</p>
                          <p className="text-lg font-black text-sys-900">Ticket #{viewSale.number || viewSale.ticketNumber || viewSale.localId?.slice(-6)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                          <button
                              onClick={() => { handleReprint({ type: 'SALE_DEBT', referenceId: viewSale.id }); setViewSale(null); }}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold border border-sys-200 hover:border-brand hover:text-brand transition-all"
                          >
                              <Printer size={14}/> Imprimir
                          </button>
                          <button onClick={() => setViewSale(null)} className="p-2 rounded-xl hover:bg-sys-100 text-sys-400 hover:text-sys-700 transition-all">
                              <X size={20}/>
                          </button>
                      </div>
                  </div>
                  {/* Meta */}
                  <div className="px-5 py-3 bg-sys-50 border-b border-sys-100 flex items-center justify-between text-xs text-sys-500 font-bold">
                      <span><Calendar size={12} className="inline mr-1"/>{new Date(viewSale.date || viewSale.createdAt).toLocaleDateString('es-AR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
                      <span className="uppercase">{viewSale.client?.name || 'Consumidor Final'}</span>
                  </div>
                  {/* Items */}
                  <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                      {(viewSale.items || []).map((item, i) => (
                          <div key={i} className="flex items-center justify-between gap-3 py-2 border-b border-sys-50 last:border-0">
                              <div className="flex items-center gap-2 min-w-0">
                                  <span className="shrink-0 w-7 h-7 rounded-lg bg-sys-100 flex items-center justify-center text-xs font-black text-sys-600">{item.quantity}</span>
                                  <span className="text-sm font-bold text-sys-800 truncate uppercase">{item.name}</span>
                              </div>
                              <span className="shrink-0 font-black font-mono text-sm text-sys-900">{formatCurrency(item.subtotal ?? item.price * item.quantity)}</span>
                          </div>
                      ))}
                      {(!viewSale.items || viewSale.items.length === 0) && (
                          <p className="text-center text-sys-400 text-sm py-6">Sin detalle de items disponible</p>
                      )}
                  </div>
                  {/* Totales */}
                  <div className="px-5 py-4 border-t border-sys-100 bg-sys-50/50 space-y-1.5">
                      {viewSale.discount > 0 && (
                          <div className="flex justify-between text-xs text-emerald-600 font-bold">
                              <span>Descuento</span><span>- {formatCurrency(viewSale.discount)}</span>
                          </div>
                      )}
                      {viewSale.surcharge > 0 && (
                          <div className="flex justify-between text-xs text-orange-500 font-bold">
                              <span>Recargo</span><span>+ {formatCurrency(viewSale.surcharge)}</span>
                          </div>
                      )}
                      <div className="flex justify-between font-black text-base text-sys-900 pt-1 border-t border-sys-200">
                          <span>TOTAL</span><span>{formatCurrency(viewSale.total || viewSale.amount)}</span>
                      </div>
                      {viewSale.method && (
                          <p className="text-xs text-sys-400 font-bold uppercase text-right">
                              Pagado con: {viewSale.method}
                          </p>
                      )}
                  </div>
              </div>
          </div>
      )}

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