import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
    ArrowLeft, Truck, FileText, 
    TrendingDown, DollarSign, MapPin, Building2, CreditCard, User, AlertCircle, RefreshCw, CloudDownload
} from 'lucide-react';
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import { supplierRepository } from '../repositories/supplierRepository';
import { cashRepository } from '../../cash/repositories/cashRepository'; 
import { purchaseRepository } from '../repositories/purchaseRepository'; 
import { db as localDb } from '../../../database/db'; 
import { collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db as firestoreDB } from '../../../database/firebase';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import toast from 'react-hot-toast';

import { SupplierPaymentModal } from '../components/SupplierPaymentModal';

const formatCurrency = (amount) => `$ ${Number(amount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const SupplierDashboard = () => {
  const { companySlug, supplierId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  
  const [supplier, setSupplier] = useState(null);
  const [history, setHistory] = useState([]);
  const [calculatedDebt, setCalculatedDebt] = useState(0); 
  const [monthTotal, setMonthTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);

  const calculateTotals = (purchases) => {
        let debt = 0;
        let monthSum = 0;
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        purchases.forEach(p => {
            if (p.status === 'VOIDED') return;
            
            const remaining = parseFloat(p.remainingBalance || 0);
            if (remaining > 0.01) debt += remaining; 
            
            if (new Date(p.date) >= thirtyDaysAgo) {
                monthSum += parseFloat(p.total || p.totalFinal || 0);
            }
        });

        setCalculatedDebt(debt);
        setMonthTotal(monthSum);
  };

  const loadData = async (forceCloud = false) => {
    if (!forceCloud) setLoading(true);
    else setSyncing(true);
    
    try {
        const s = await supplierRepository.getById(supplierId);
        setSupplier(s);

        // 🔥 MAGIA: LEEMOS DIRECTO DE LAS COMPRAS
        let purchases = await localDb.purchases
            .where('supplierId').equals(supplierId)
            .reverse() // Más nuevas primero
            .toArray();

        // 🔥 AUTO-HIDRATACIÓN SILENCIOSA O FORZADA DE NUBE
        if ((purchases.length === 0 || forceCloud) && navigator.onLine && user?.companyId) {
            try {
                const q = query(
                    collection(firestoreDB, `companies/${user.companyId}/purchases`),
                    where('supplierId', '==', supplierId),
                    orderBy('date', 'desc'),
                    limit(100)
                );
                
                const snap = await getDocs(q);
                const cloudPurchases = [];
                snap.docs.forEach(docSnap => {
                    const data = docSnap.data();
                    cloudPurchases.push({ ...data, id: docSnap.id, firestoreId: docSnap.id, syncStatus: 'synced' });
                });

                if (cloudPurchases.length > 0) {
                    await localDb.purchases.bulkPut(cloudPurchases);
                    purchases = await localDb.purchases.where('supplierId').equals(supplierId).reverse().toArray();
                    if (forceCloud) toast.success("Historial actualizado desde la nube.");
                } else if (forceCloud) {
                    toast.success("No hay más datos en la nube.");
                }
            } catch (e) {
                console.warn("Fallo hidratación del historial del proveedor:", e);
                if (forceCloud) toast.error("Error al buscar en la nube.");
            }
        }

        calculateTotals(purchases);
        setHistory(purchases);

    } catch (error) {
        console.error(error);
        toast.error("Error cargando el historial del proveedor");
    } finally {
        setLoading(false);
        setSyncing(false);
    }
  };

  useEffect(() => {
    if (supplierId) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  // =================================================================
  // 🧠 DISTRIBUCIÓN INTELIGENTE DE PAGOS
  // =================================================================
  const handlePaymentConfirm = async (paymentData) => {
      try {
          const method = paymentData.method || 'cash';
          
          if (method === 'cash') {
              const shift = await cashRepository.getCurrentShift();
              if (!shift) {
                  toast.error("⛔ Debe abrir la caja antes de registrar un pago en efectivo.");
                  return;
              }
          }

          let remainingToPay = parseFloat(paymentData.amountPaid || 0);
          
          if (remainingToPay <= 0) {
              toast.error("El monto a pagar debe ser mayor a cero.");
              return;
          }

          // 🔥 SÚPER PODER: Filtramos las facturas impagas y las pagamos de la más VIEJA a la más NUEVA
          const unpaidPurchases = history
              .filter(p => p.status !== 'VOIDED' && parseFloat(p.remainingBalance) > 0.01)
              .sort((a, b) => new Date(a.date) - new Date(b.date));

          for (const p of unpaidPurchases) {
              if (remainingToPay <= 0.01) break;

              const debtOfInvoice = parseFloat(p.remainingBalance);
              const paymentForThisInvoice = Math.min(debtOfInvoice, remainingToPay);

              await purchaseRepository.registerPayment({
                  supplierId: supplier.id,
                  amount: paymentForThisInvoice,
                  method: method,
                  description: `Pago Fac #${p.invoiceNumber || 'S/N'}`,
                  refId: p.id 
              });

              remainingToPay -= paymentForThisInvoice;
          }

          if (remainingToPay > 0.01) {
               await purchaseRepository.registerPayment({
                  supplierId: supplier.id,
                  amount: remainingToPay,
                  method: method,
                  description: `Saldo a favor / Pago Extra`,
                  refId: null 
              });
          }

          toast.success("Pago registrado correctamente");
          setIsPaymentOpen(false);
          loadData(); 
          
      } catch (error) {
          console.error(error);
          toast.error("Error al procesar el pago: " + error.message);
      }
  };

  if (loading) return <div className="h-[calc(100vh-4rem)] flex flex-col items-center justify-center text-sys-500 font-bold uppercase tracking-widest"><Loader2 className="animate-spin mb-2 text-brand" size={32}/>Cargando Perfil...</div>;
  if (!supplier) return <div className="h-[calc(100vh-4rem)] flex items-center justify-center text-red-500 font-bold">Proveedor no encontrado</div>;

  return (
    <div className="space-y-6 pb-20 animate-in slide-in-from-right duration-300 max-w-[1600px] mx-auto p-4 md:p-6 h-[calc(100vh-4rem)] flex flex-col">
      
      {/* Header Navegación */}
      <div className="flex flex-col md:flex-row items-start md:items-center gap-4 bg-white p-4 rounded-3xl border border-sys-200 shadow-sm shrink-0">
        <button onClick={() => navigate(`/${companySlug}/suppliers`)} className="p-2 hover:bg-sys-100 rounded-full transition-colors text-sys-500 hover:text-sys-900 border border-transparent hover:border-sys-200 shrink-0">
            <ArrowLeft size={24} />
        </button>
        <div className="flex items-center gap-4 flex-1">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-sm bg-sys-900 shrink-0">
                <Truck size={24} />
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-black text-sys-900 leading-none uppercase truncate">{supplier.name}</h2>
                    <Button variant="ghost" onClick={() => loadData(true)} disabled={syncing} className="h-6 w-6 p-0 text-brand bg-brand/10 hover:bg-brand hover:text-white rounded-full shrink-0" title="Bajar Nube">
                        {syncing ? <Loader2 size={12} className="animate-spin"/> : <CloudDownload size={12}/>}
                    </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-sys-500 mt-1.5">
                    <span className="font-mono bg-sys-100 px-2 py-0.5 rounded text-sys-600 font-bold border border-sys-200 flex items-center gap-1">
                        <CreditCard size={12}/> {supplier.docType === '80' ? 'CUIT' : 'DNI'} {supplier.docNumber || 'S/N'}
                    </span>
                    <span className="font-mono bg-sys-100 px-2 py-0.5 rounded text-sys-600 font-bold border border-sys-200">
                        ID: {supplier.sequentialId || 'S/N'}
                    </span>
                </div>
            </div>
        </div>
      </div>

      {/* Tarjetas de Estado */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 shrink-0">
          <Card className={cn("border-l-8 flex flex-col justify-between relative overflow-hidden h-40", calculatedDebt > 0.01 ? "border-l-rose-500 bg-rose-50/30" : "border-l-emerald-500 bg-emerald-50/30")}>
              <div className="z-10 h-full flex flex-col justify-between">
                  <div>
                      <p className={cn("text-xs font-black uppercase tracking-wider mb-1 flex items-center gap-1.5", calculatedDebt > 0.01 ? "text-rose-500" : "text-emerald-600")}>
                          Deuda a Pagar
                      </p>
                      <p className={cn("text-4xl font-black tracking-tighter", calculatedDebt > 0.01 ? "text-rose-600" : "text-emerald-600")}>
                          {formatCurrency(calculatedDebt)}
                      </p>
                  </div>
                  <div className="mt-4">
                      <Button 
                        variant="secondary" 
                        className={cn(
                            "w-full text-sm h-11 font-black transition-all border shadow-sm",
                            calculatedDebt > 0.01 
                                ? "bg-white border-rose-200 hover:bg-rose-500 hover:text-white text-rose-600 hover:border-rose-600" 
                                : "bg-white border-sys-200 text-sys-400 opacity-50 cursor-not-allowed"
                        )}
                        onClick={() => setIsPaymentOpen(true)}
                        disabled={calculatedDebt <= 0.01} 
                      >
                          <DollarSign size={18} className="mr-2"/> Pagar a Cuenta
                      </Button>
                  </div>
              </div>
              <div className={cn("absolute -right-4 -bottom-4 opacity-5 transform rotate-12", calculatedDebt > 0.01 ? "text-rose-500" : "text-emerald-500")}>
                  <TrendingDown size={140} />
              </div>
          </Card>

          <Card className="flex flex-col justify-center space-y-4 md:col-span-2 h-40 bg-white">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="flex items-center gap-4 text-sys-700 border-sys-100 pr-6">
                      <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                          <FileText size={20} className="text-blue-500"/>
                      </div>
                      <div className="text-sm min-w-0">
                          <p className="font-black text-[10px] text-sys-400 uppercase tracking-widest">Total Comprado (30d)</p>
                          <p className="font-black text-xl text-sys-900 truncate mt-0.5">{formatCurrency(monthTotal)}</p>
                      </div>
                  </div>
                  <div className="flex items-center gap-4 text-sys-700 border-l border-sys-100 pl-6">
                      <div className="w-12 h-12 rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center shrink-0">
                          <User size={20} className="text-orange-500"/>
                      </div>
                      <div className="text-sm min-w-0">
                          <p className="font-black text-[10px] text-sys-400 uppercase tracking-widest">Contacto</p>
                          <p className="font-bold text-sys-900 truncate" title={supplier.contactName}>{supplier.contactName || 'Sin nombre'}</p>
                          {supplier.phone && <p className="font-medium text-sys-500 text-xs mt-0.5">{supplier.phone}</p>}
                      </div>
                  </div>
              </div>
          </Card>
      </div>

      {/* 🔥 HISTORIAL IDÉNTICO AL QUE TE GUSTA 🔥 */}
      <div className="flex-1 flex flex-col overflow-hidden">
          <h3 className="text-xl font-black text-sys-900 mb-4 flex items-center gap-2 shrink-0">
              <FileText size={24} className="text-brand"/> Historial de Compras
          </h3>
          
          <Card className="p-0 overflow-hidden border border-sys-200 shadow-sm flex-1 flex flex-col bg-white">
              <div className="overflow-x-auto flex-1 custom-scrollbar">
                  <table className="w-full text-left text-sm border-collapse">
                      <thead className="bg-sys-50 text-sys-500 text-[10px] uppercase font-black tracking-widest sticky top-0 z-10 border-b border-sys-200">
                          <tr>
                              <th className="px-6 py-4 border-b border-sys-200">Fecha</th>
                              <th className="px-6 py-4 border-b border-sys-200">Comprobante</th>
                              <th className="px-6 py-4 border-b border-sys-200 text-center">Estado</th>
                              <th className="px-6 py-4 border-b border-sys-200 text-right">Total</th>
                              <th className="px-6 py-4 border-b border-sys-200 text-right">Pagado</th>
                              <th className="px-6 py-4 border-b border-sys-200 text-right bg-sys-100/50">Saldo Pendiente</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-sys-100">
                          {history.length === 0 ? (
                              <tr>
                                  <td colSpan="6" className="p-12 text-center text-sys-400">
                                      <div className="flex flex-col items-center justify-center bg-sys-50 rounded-2xl border border-dashed border-sys-200 py-10 w-full max-w-md mx-auto">
                                          <AlertCircle size={32} className="mb-2 opacity-30 text-sys-500"/>
                                          <p className="font-bold uppercase tracking-widest text-xs">Sin comprobantes</p>
                                          <p className="text-[10px] text-sys-400 mt-1">Este proveedor aún no tiene compras registradas.</p>
                                      </div>
                                  </td>
                              </tr>
                          ) : (
                              history.map((p) => {
                                  const isAnulado = p.status === 'VOIDED';
                                  const total = parseFloat(p.total || p.totalFinal || 0);
                                  const paid = parseFloat(p.amountPaid || p.initialPayment || 0);
                                  const remaining = parseFloat(p.remainingBalance || 0);
                                  const status = p.paymentStatus || 'PAID';

                                  return (
                                      <tr key={p.id} className={cn("hover:bg-sys-50/50 transition-colors group cursor-default", isAnulado && "opacity-50 bg-red-50/20")}>
                                          <td className="px-6 py-4 font-mono text-sys-600 whitespace-nowrap align-middle">
                                              <div className="font-bold text-sys-900 text-xs">{new Date(p.date || p.createdAt).toLocaleDateString()}</div>
                                              <div className="text-[10px] mt-0.5">{new Date(p.date || p.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                                          </td>
                                          
                                          <td className="px-6 py-4 align-middle">
                                              <span className="font-bold text-sys-800 text-xs uppercase">{p.invoiceNumber || 'S/N'}</span>
                                          </td>
                                          
                                          <td className="px-6 py-4 text-center align-middle">
                                              {isAnulado ? (
                                                  <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide border bg-red-50 text-red-600 border-red-100">ANULADO</span>
                                              ) : (
                                                  <span className={cn(
                                                      "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide border",
                                                      status === 'PAID' ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                                                      status === 'PARTIAL' ? "bg-amber-50 text-amber-600 border-amber-100" :
                                                      "bg-orange-50 text-orange-600 border-orange-100"
                                                  )}>
                                                      {status === 'PAID' ? 'PAGADO' : status === 'PARTIAL' ? 'PARCIAL' : 'IMPAGO'}
                                                  </span>
                                              )}
                                          </td>

                                          <td className="px-6 py-4 text-right font-black font-mono text-sm whitespace-nowrap align-middle text-sys-900">
                                              {formatCurrency(total)}
                                          </td>

                                          <td className="px-6 py-4 text-right font-bold font-mono text-sm whitespace-nowrap align-middle text-emerald-600">
                                              {formatCurrency(paid)}
                                          </td>
                                          
                                          <td className="px-6 py-4 text-right font-mono text-sm font-black bg-sys-50/30 align-middle border-l border-sys-100">
                                              {remaining > 0.01 && !isAnulado ? (
                                                  <span className="text-red-600">{formatCurrency(remaining)}</span>
                                              ) : (
                                                  <span className="text-sys-300">-</span>
                                              )}
                                          </td>
                                      </tr>
                                  );
                              })
                          )}
                      </tbody>
                  </table>
              </div>
          </Card>
      </div>

      <SupplierPaymentModal 
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        total={calculatedDebt} 
        supplierName={supplier.name} 
        onConfirm={handlePaymentConfirm}
        hasPriceChanges={false} 
      />

    </div>
  );
};