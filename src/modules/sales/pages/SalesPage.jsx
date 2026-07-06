import React, { useEffect, useState, useMemo, useRef } from 'react';
import { 
    FileText, CheckCircle, AlertCircle, Printer, RefreshCw, Search, 
    ArrowDownLeft, ShoppingBag, XCircle, RotateCcw, Calendar, User,
    ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, 
    TrendingUp, Tag, Percent, DollarSign, Store, CreditCard, Banknote,
    PackageMinus, Save, X, Loader2, PlusCircle, ArrowUpRight, FileArchive, ArrowDownRight, Users
} from 'lucide-react';
import { billingService } from '../../billing/services/billingService';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { Switch } from '../../../core/ui/Switch';
import { cn } from '../../../core/utils/cn';
import { salesRepository } from '../repositories/salesRepository'; 
import { productRepository } from '../../inventory/repositories/productRepository'; 
import { cashRepository } from '../../cash/repositories/cashRepository'; 
import { TicketModal } from '../components/TicketModal';
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import { useCloudDashboard } from '../../dashboard/hooks/useCloudDashboard'; // 🔥 SINIESTROS MONITOR
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db as firestoreDB } from '../../../database/firebase';
import toast from 'react-hot-toast';

// Helper de fechas seguro
const toInputDate = (date) => {
    try {
        return date.toISOString().split('T')[0];
    } catch (e) { return new Date().toISOString().split('T')[0]; }
};

// =================================================================
// 🛍️ MODAL DE DEVOLUCIÓN PARCIAL (AHORA PIDE MOTIVO E IMPACTA CAJA)
// =================================================================
const RefundModal = ({ isOpen, onClose, sale, onConfirm, isProcessing }) => {
    const [returnMap, setReturnMap] = useState({}); 
    const [refundTotal, setRefundTotal] = useState(0);
    const [reason, setReason] = useState('');
    const [refundCash, setRefundCash] = useState(true); 

    useEffect(() => {
        if (isOpen) {
            setReturnMap({});
            setRefundTotal(0);
            setReason('');
            setRefundCash(true);
        }
    }, [isOpen, sale]);

    const handleQtyChange = (item, change) => {
        if (isProcessing) return; 
        const currentReturn = returnMap[item.id] || 0;
        const newReturn = Math.max(0, Math.min(item.quantity, currentReturn + change));
        
        const newMap = { ...returnMap, [item.id]: newReturn };
        setReturnMap(newMap);

        let total = 0;
        sale.items.forEach(i => {
            const qty = newMap[i.id] || 0;
            total += qty * i.price;
        });
        setRefundTotal(total);
    };

    if (!isOpen || !sale) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-5 border-b border-sys-100 bg-sys-50 flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-lg text-sys-900 flex items-center gap-2">
                            <PackageMinus className="text-orange-500" /> Devolución / Edición
                        </h3>
                        <p className="text-xs text-sys-500">Seleccione los artículos que el cliente devuelve.</p>
                    </div>
                    <button onClick={onClose} disabled={isProcessing} className="p-2 hover:bg-sys-200 rounded-full disabled:opacity-50"><X size={20}/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {sale.items.map(item => {
                        const returnQty = returnMap[item.id] || 0;
                        
                        return (
                            <div key={item.id} className={cn("flex items-center justify-between p-3 rounded-xl border transition-all", returnQty > 0 ? "border-orange-200 bg-orange-50" : "border-sys-100 bg-white")}>
                                <div className="flex-1">
                                    <p className="text-sm font-bold text-sys-800">{item.name}</p>
                                    <p className="text-xs text-sys-500">
                                        Vendidos: <b>{item.quantity}</b> x ${item.price}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center border border-sys-200 rounded-lg bg-white">
                                        <button onClick={() => handleQtyChange(item, -1)} disabled={isProcessing} className="px-2 py-1 hover:bg-sys-100 text-sys-600 disabled:opacity-50">-</button>
                                        <span className="w-8 text-center text-sm font-bold text-orange-600">{returnQty}</span>
                                        <button onClick={() => handleQtyChange(item, 1)} disabled={isProcessing} className="px-2 py-1 hover:bg-sys-100 text-sys-600 disabled:opacity-50">+</button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {refundTotal > 0 && (
                    <div className="p-4 bg-sys-50 border-t border-sys-200 space-y-4 animate-in slide-in-from-bottom-2">
                        <div>
                            <label className="text-[10px] font-bold text-sys-500 uppercase tracking-widest mb-1.5 block">Motivo de Devolución *</label>
                            <input 
                                type="text" 
                                placeholder="Ej: Producto en mal estado, Cambio de talle..." 
                                className="w-full p-2.5 rounded-lg border border-sys-200 text-sm outline-none focus:border-orange-400"
                                value={reason}
                                onChange={e => setReason(e.target.value)}
                            />
                        </div>
                        <div className="flex items-center justify-between bg-white p-3 rounded-lg border border-sys-200">
                            <div>
                                <p className="text-xs font-bold text-sys-700 flex items-center gap-1"><ArrowDownRight size={14} className="text-red-500"/> Retirar dinero de caja</p>
                                <p className="text-[10px] text-sys-500">Registra el egreso en el arqueo actual</p>
                            </div>
                            <Switch checked={refundCash} onCheckedChange={setRefundCash} disabled={isProcessing} />
                        </div>
                    </div>
                )}

                <div className="p-5 border-t border-sys-100 bg-white">
                    <div className="flex justify-between items-center mb-4">
                        <span className="text-sm font-bold text-sys-600 uppercase">Monto a Reintegrar:</span>
                        <span className="text-2xl font-black text-orange-600">
                            $ {refundTotal.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                        </span>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="ghost" onClick={onClose} disabled={isProcessing} className="flex-1 border border-sys-200">Cancelar</Button>
                        <Button 
                            onClick={() => {
                                if (!reason.trim()) return toast.error("El motivo es obligatorio");
                                onConfirm(sale, returnMap, refundTotal, reason, refundCash);
                            }} 
                            disabled={refundTotal === 0 || isProcessing}
                            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-200"
                        >
                            {isProcessing ? (
                                <><Loader2 className="animate-spin mr-2" size={18}/> Procesando...</>
                            ) : (
                                "Confirmar Devolución"
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// =================================================================
// 🚨 MODAL DE SINIESTROS (AUDITORÍA DE ABANDONOS)
// =================================================================
const SiniestrosModal = ({ isOpen, onClose, siniestros }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-sys-900/40 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] border border-sys-100">
                <div className="p-6 border-b border-sys-100 bg-red-50/50 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-red-100 flex items-center justify-center text-red-600 shadow-sm">
                            <AlertCircle size={24} />
                        </div>
                        <div>
                            <h3 className="font-black text-xl text-sys-900 tracking-tight">Auditoría de Siniestros</h3>
                            <p className="text-xs text-sys-500 font-bold uppercase tracking-widest mt-0.5">Carritos vaciados hoy</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2.5 hover:bg-white hover:shadow-md rounded-xl transition-all text-sys-400 hover:text-sys-900"><X size={20}/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                    {siniestros.length === 0 ? (
                        <div className="text-center py-10 opacity-40">
                            <CheckCircle size={48} className="mx-auto text-emerald-500 mb-4 opacity-20" />
                            <p className="text-sys-500 font-bold">No se detectaron siniestros hoy.</p>
                        </div>
                    ) : (
                        siniestros.map(item => (
                            <div key={item.id} className="p-4 rounded-2xl border border-sys-100 bg-sys-50/30 hover:bg-white hover:shadow-xl hover:shadow-sys-200/50 transition-all duration-300">
                                <div className="flex justify-between items-start mb-3">
                                    <div className="flex gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-white border border-sys-100 flex items-center justify-center text-sys-400">
                                            <User size={18} />
                                        </div>
                                        <div>
                                            <p className="font-black text-sys-900 leading-tight">{item.userName}</p>
                                            <p className="text-[10px] text-sys-400 font-bold uppercase tracking-tighter">
                                                {new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} • {item.tabName || 'Caja'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs font-black text-red-600 bg-red-50 px-2.5 py-1 rounded-lg border border-red-100 inline-block shadow-sm">
                                            $ {parseFloat(item.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                        </p>
                                    </div>
                                </div>
                                <div className="space-y-1.5 pl-1.5 border-l-2 border-red-100 ml-4.5">
                                    {item.items.map((prod, idx) => (
                                        <div key={idx} className="flex justify-between text-[11px] font-medium text-sys-500">
                                            <span>{prod.quantity}x {prod.name}</span>
                                            <span className="font-bold text-sys-400">$ {(prod.price * prod.quantity).toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-6 border-t border-sys-100 bg-sys-50/50 text-center">
                    <p className="text-[10px] text-sys-400 font-bold uppercase tracking-[0.2em]">Registro de Blindaje Nexus Core • Auditoría Privada</p>
                </div>
            </div>
        </div>
    );
};

// =================================================================
// 🏭 SALES PAGE (MAIN)
// =================================================================
export const SalesPage = () => {
  const { user, activeBranchId, activeBranchName } = useAuthStore(); 
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'OWNER'; 

  // 🔥 MONITOR DE SINIESTROS NEXUS
  const { abandonedCount, abandonedSales } = useCloudDashboard();
  const [showSiniestros, setShowSiniestros] = useState(false);

  const [operations, setOperations] = useState([]); 
  const [cashiersList, setCashiersList] = useState([]); 
  const [loading, setLoading] = useState(true);
  
  // 🔥 ESTADOS PARA PAGINACIÓN Y TOTALES
  const [displayLimit, setDisplayLimit] = useState(150); 
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [periodTotals, setPeriodTotals] = useState({ gross: 0, netProfit: 0 }); 
  
  const [filterPeriod, setFilterPeriod] = useState('today'); 
  const [customStart, setCustomStart] = useState(toInputDate(new Date()));
  const [customEnd, setCustomEnd] = useState(toInputDate(new Date()));
  const [filterType, setFilterType] = useState('ALL'); 
  const [filterCashier, setFilterCashier] = useState('ALL'); 
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('ALL');
  const [filterAfip, setFilterAfip] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20; 

  const [loadingMap, setLoadingMap] = useState({});
  const [selectedOpForTicket, setSelectedOpForTicket] = useState(null);
  const [refundData, setRefundData] = useState(null);
  const [isProcessingRefund, setIsProcessingRefund] = useState(false);

  // Ref para evitar stale closure en event listeners de sync
  const fetchOperationsRef = useRef(null);

  // 1. CARGAR LISTA DE CAJEROS
  useEffect(() => {
      if (user?.companyId && activeBranchId) {
          const fetchCashiers = async () => {
              try {
                  const q = query(
                      collection(firestoreDB, 'users'), 
                      where('companyId', '==', user.companyId)
                  );
                  const snapshot = await getDocs(q);
                  const users = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
                  
                  const branchUsers = users.filter(u => {
                      if (u.role === 'OWNER') return true; 
                      return String(u.branchId) === String(activeBranchId);
                  });
                  setCashiersList(branchUsers);
              } catch (error) { console.error("Error cargando cajeros:", error); }
          };
          fetchCashiers();
      }
  }, [user?.companyId, activeBranchId]); 

  // 🔥 AUTO-REFRESH: SalesPage escucha ventas locales y ventas bajadas del sync
  useEffect(() => {
      const handler = () => setTimeout(() => fetchOperationsRef.current?.(), 300);
      window.addEventListener('noar:sale-created', handler);
      window.addEventListener('noar:sales-synced', handler);
      return () => {
          window.removeEventListener('noar:sale-created', handler);
          window.removeEventListener('noar:sales-synced', handler);
      };
  }, []);


  // 2. CARGAR OPERACIONES LOCALES (OPTIMIZADO Y A PRUEBA DE FECHAS)
  const fetchOperations = async (append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);

      try {
          let start = new Date();
          let end = new Date();
          end.setHours(23, 59, 59, 999);

          if (filterPeriod === 'today') {
              start.setHours(0, 0, 0, 0);
          } else if (filterPeriod === 'yesterday') {
              start.setDate(start.getDate() - 1);
              start.setHours(0, 0, 0, 0);
              end.setDate(end.getDate() - 1);
              end.setHours(23, 59, 59, 999);
          } else if (filterPeriod === 'week') {
              const day = start.getDay() || 7; 
              if (day !== 1) start.setDate(start.getDate() - (day - 1));
              start.setHours(0, 0, 0, 0);
          } else if (filterPeriod === 'month') {
              start.setDate(1);
              start.setHours(0, 0, 0, 0);
          } else if (filterPeriod === 'custom') {
              start = new Date(customStart + 'T00:00:00');
              end = new Date(customEnd + 'T23:59:59');
          }

          const { getDB } = await import('../../../database/db');
          const dbLocal = await getDB();

          let rawData = [];
          if (activeBranchId && activeBranchId !== 'ALL') {
              rawData = await dbLocal.sales.where('branchId').equals(activeBranchId).reverse().toArray();
          } else {
              rawData = await dbLocal.sales.toArray();
          }

          const startTime = start.getTime();
          const endTime = end.getTime();
          
          let filteredByDate = rawData.filter(op => {
              const opDateRaw = op.date || op.createdAt || op.syncedAt || op.updatedAt;
              if (!opDateRaw) return false;
              const opTime = new Date(opDateRaw).getTime();
              return opTime >= startTime && opTime <= endTime;
          });

          filteredByDate.sort((a, b) => {
              const timeA = new Date(a.date || a.createdAt || 0).getTime();
              const timeB = new Date(b.date || b.createdAt || 0).getTime();
              return timeB - timeA;
          });

          // 🔥 TOTALES REALES: Excluimos anulados, devueltos, presupuestos y SINIESTROS
          const validForTotals = filteredByDate.filter(op =>
              op.afip?.status !== 'VOIDED' &&
              op.status !== 'REFUNDED' &&
              op.status !== 'ABANDONED' &&
              op.type !== 'BUDGET' &&
              (!filterAfip || op.afip?.status === 'APPROVED')
          );
          const gross = validForTotals.reduce((acc, op) => acc + (parseFloat(op.total) || 0), 0);
          const netProfit = validForTotals.reduce((acc, op) => acc + (parseFloat(op.netProfit) || 0), 0);
          setPeriodTotals({ gross, netProfit });

          const finalData = filteredByDate.slice(0, displayLimit);

          setOperations(finalData || []);
          
          if (!append) setCurrentPage(1); 
          setHasMore(filteredByDate.length > displayLimit); 

      } catch (error) {
          console.error("Error cargando historial:", error);
          toast.error("Error al cargar las ventas locales.");
      } finally {
          setLoading(false);
          setLoadingMore(false);
      }
  };

  fetchOperationsRef.current = fetchOperations;

  useEffect(() => {
      fetchOperations(displayLimit > 150);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterPeriod, customStart, customEnd, activeBranchId, displayLimit, filterAfip]);

  const resolveCashierName = (op) => {
      const idToCheck = op.userId || op.createdBy || op.operatorId;
      const matchedUser = cashiersList.find(u => u.uid === idToCheck || u.email === idToCheck || u.uid === op.userId);
      if (matchedUser) return matchedUser.name || matchedUser.email.split('@')[0];
      if (op.operatorName) return op.operatorName;
      if (op.sellerName) return op.sellerName;
      if (op.userName) return op.userName;
      return "Cajero";
  };

  const getDisplayNumber = (op) => {
      const directNumber = op.ticketNumber || op.invoiceNumber || op.number;
      if (directNumber && directNumber !== '---') return directNumber;
      if (op.afip && op.afip.cbteNumero) {
          const letra = op.afip.cbteLetra || 'FC';
          const pto = String(op.afip.ptoVta || '1').padStart(4, '0');
          const num = String(op.afip.cbteNumero).padStart(8, '0');
          return `${letra}-${pto}-${num}`;
      }
      return `ID:${(op.localId || op.id || '????').slice(-6)}`;
  };

  // 3. FILTRADO VISUAL EN MEMORIA
  const visibleOperations = useMemo(() => {
      return operations.filter(op => {
          if (activeBranchId && String(op.branchId) !== String(activeBranchId)) return false;
          if (filterType === 'ALL') {
              // 🔥 MONITOR NEXUS: Por defecto ocultamos los abandonos de la vista general
              if (op.status === 'ABANDONED' || op.type === 'ABANDONED_CART') return false;
          } else {
              // 🔥 FILTRO ESPECÍFICO
              if (filterType === 'ABANDONED') {
                  if (op.status !== 'ABANDONED' && op.type !== 'ABANDONED_CART') return false;
              } else if (op.type !== filterType) {
                  return false;
              }
          }

          if (filterCashier !== 'ALL') {
              const selectedUser = cashiersList.find(u => u.email === filterCashier);
              if (!selectedUser) return false;
              const opUserId = op.userId || op.operatorId || op.createdBy;
              if (opUserId !== selectedUser.uid && op.createdBy !== selectedUser.email) return false;
          }

          if (filterPaymentMethod !== 'ALL') {
              // 🔥 CLAVE: Usamos op.method (el global, guardado por el repo) primero.
              // op.payment?.method solo apunta al PRIMER pago del desglose (puede ser efectivo en un split).
              const methodRaw = op.method || op.payment?.method || op.paymentMethod || 'cash';
              const method = String(methodRaw).toLowerCase().trim();
              
              if (filterPaymentMethod === 'CASH') {
                  if (!['cash', 'efectivo'].includes(method)) return false;
              }
              if (filterPaymentMethod === 'CARD') {
                  if (!['card', 'credit', 'debit', 'tarjeta', 'clover', 'manual_card'].includes(method)) return false;
              }
              if (filterPaymentMethod === 'TRANSFER') {
                  if (!['transfer', 'transferencia', 'deposito'].includes(method)) return false;
              }
              if (filterPaymentMethod === 'MP') {
                  if (!['mercadopago', 'mp', 'qr', 'point'].includes(method)) return false;
              }
              if (filterPaymentMethod === 'CURRENT_ACCOUNT') {
                  if (!['current_account', 'cta_cte', 'cuenta_corriente', 'account'].includes(method)) return false;
              }
              if (filterPaymentMethod === 'EMPLOYEE_ACCOUNT') {
                  if (method !== 'employee_account') return false;
              }
              if (filterPaymentMethod === 'BUDGET') {
                  if (!['budget', 'presupuesto', 'budget'].includes(method)) return false;
              }
              if (filterPaymentMethod === 'SPLIT') {
                  // Acepta tanto 'split' como 'SPLIT' (el repo guarda 'SPLIT' en mayusculas desde usePosController)
                  if (!['split'].includes(method)) return false;
              }
          }

          if (filterAfip && op.afip?.status !== 'APPROVED') return false;

          if (searchTerm) {
              const search = searchTerm.toLowerCase();
              const clientName = (op.client?.name || '').toLowerCase();
              const totalStr = (op.total || '').toString();
              const docNum = (op.afip?.cbteNumero || '').toString();
              const ticketNum = getDisplayNumber(op).toLowerCase();
              const cashierName = resolveCashierName(op).toLowerCase();
              return clientName.includes(search) || totalStr.includes(search) || docNum.includes(search) || ticketNum.includes(search) || cashierName.includes(search);
          }
          return true;
      });
  }, [operations, filterType, filterCashier, filterPaymentMethod, searchTerm, cashiersList, activeBranchId, filterAfip]);

  const totalPages = Math.ceil(visibleOperations.length / itemsPerPage);
  const paginatedOperations = useMemo(() => {
      const startIndex = (currentPage - 1) * itemsPerPage;
      return visibleOperations.slice(startIndex, startIndex + itemsPerPage);
  }, [visibleOperations, currentPage]);

  // =================================================================
  // 🚀 ACCIONES (FACTURAR, ANULAR, DEVOLVER) 
  // =================================================================

  const handleFacturar = async (op) => {
    if (op.type === 'RECEIPT' || op.type === 'BUDGET') return;
    setLoadingMap(prev => ({ ...prev, [op.localId]: true }));
    try {
      const forcedCompanyId = user?.companyId || user?.tenantId;
      const forcedBranchId = op.branchId || activeBranchId;

      if (!forcedCompanyId || !forcedBranchId) {
          throw new Error("No se pudo determinar la empresa o sucursal para facturar.");
      }
      
      const safeClient = (op.client && op.client.fiscalCondition) ? op.client : { 
          name: op.client?.name || 'Consumidor Final', 
          docType: op.client?.docType || '99', 
          docNumber: op.client?.docNumber || '0', 
          fiscalCondition: 'CONSUMIDOR_FINAL' 
      };

      const salePayload = {
          ...op,
          companyId: forcedCompanyId,
          branchId: forcedBranchId, 
          total: op.total,
          client: safeClient
      };

      const factura = await billingService.emitirFactura(salePayload);
      await updateOperationStatus(op, factura, 'APPROVED');
      toast.success("Factura autorizada por AFIP");
      fetchOperations();
    } catch (error) {
      console.error("Error al facturar:", error);
      toast.error(`Error AFIP: ${error.message}`);
    } finally {
      setLoadingMap(prev => ({ ...prev, [op.localId]: false }));
    }
  };

  const handleAnular = async (op) => {
    if (!isAdmin) return;
    
    const reason = window.prompt("⚠️ INGRESE EL MOTIVO DE LA ANULACIÓN:\n(El stock se repondrá automáticamente. Si hubo efectivo, se extraerá de la caja).");
    if (!reason) {
        toast.error("Anulación cancelada: Motivo obligatorio.");
        return;
    }
    
    setLoadingMap(prev => ({ ...prev, [op.localId]: true }));
    try {
      let notaCreditoData = null;
      
      if (op.afip?.status === 'APPROVED') {
          const forcedCompanyId = user?.companyId || user?.tenantId;
          const forcedBranchId = op.branchId || activeBranchId;

          if (!forcedCompanyId || !forcedBranchId) {
              throw new Error("No se pudo determinar la empresa o sucursal para la Nota de Crédito.");
          }

          const safeClient = (op.client && op.client.fiscalCondition) ? op.client : { 
              name: op.client?.name || 'Consumidor Final', 
              docType: op.client?.docType || '99', 
              docNumber: op.client?.docNumber || '0', 
              fiscalCondition: 'CONSUMIDOR_FINAL' 
          };

          const docTipo = op.afip?.cbteTipo || (op.afip?.cbteLetra === 'A' ? 1 : op.afip?.cbteLetra === 'B' ? 6 : 11);

          const ncPayload = {
              ...op,
              companyId: forcedCompanyId,
              branchId: forcedBranchId,
              total: op.total,
              client: safeClient,
              associatedDocument: {
                  tipo: docTipo,
                  ptoVta: op.afip?.ptoVta || 1,
                  nro: op.afip?.cbteNumero
              }
          };
          
          notaCreditoData = await billingService.emitirNotaCredito(ncPayload);
          toast.success("Nota de Crédito generada en AFIP");
      }
      
      if (op.type !== 'BUDGET' && op.items && Array.isArray(op.items)) {
          for (const item of op.items) {
              await productRepository.addStock(item.id, item.quantity, `Anulación #${getDisplayNumber(op)} - ${reason}`, user?.name, op.branchId || activeBranchId);
          }
      }

      let cashPaid = 0;
      if (op.method === 'cash') {
          cashPaid = op.amountPaid || op.total;
      } else if (op.method === 'SPLIT' && Array.isArray(op.payments)) {
          cashPaid = op.payments.filter(p => p.method === 'cash').reduce((acc, p) => acc + p.amount, 0);
      }
      
      if (cashPaid > 0) {
          await cashRepository.registerExpense(cashPaid, `Anulación Ticket #${getDisplayNumber(op)} - Motivo: ${reason}`, op.localId, user?.name);
      }

      op.notes = `${op.notes || ''} | Anulado por: ${reason}`.trim();

      await updateOperationStatus(op, notaCreditoData, 'VOIDED'); 
      toast.success("Operación Anulada con Éxito");
    } catch (error) {
      console.error("Error al anular:", error);
      toast.error(`Error al Anular: ${error.message}`);
    } finally {
      setLoadingMap(prev => ({ ...prev, [op.localId]: false }));
    }
  };

  const handleProcessRefund = async (originalSale, returnMap, refundAmount, reason, refundCash) => {
      setIsProcessingRefund(true);
      const toastId = toast.loading("Procesando devolución...");
      try {
          const { getDB } = await import('../../../database/db'); 
          const db = await getDB();

          const branchToReturn = originalSale.branchId || activeBranchId;
          const itemsToReturn = originalSale.items.filter(i => returnMap[i.id] > 0);
          
          // 1. Reposición de Stock
          if (originalSale.type !== 'BUDGET') {
              for (const item of itemsToReturn) {
                  const qtyToReturn = returnMap[item.id];
                  await productRepository.addStock(item.id, qtyToReturn, `Devolución #${getDisplayNumber(originalSale)} - ${reason}`, user?.name, branchToReturn);
              }
          }

          // 2. Retiro de Efectivo
          if (refundCash) {
              await cashRepository.registerExpense(refundAmount, `Reintegro Venta #${getDisplayNumber(originalSale)} - Motivo: ${reason}`, originalSale.localId, user?.name);
          }

          // 3. Ajuste de Ticket
          const newTotal = originalSale.total - refundAmount;
          const newSubtotal = originalSale.subtotal - refundAmount; 
          
          const updatedItems = originalSale.items.map(item => {
              const returnedQty = returnMap[item.id] || 0;
              if (returnedQty > 0) {
                  return {
                      ...item,
                      quantity: item.quantity - returnedQty,
                      subtotal: (item.quantity - returnedQty) * item.price,
                      returnedQty: (item.returnedQty || 0) + returnedQty 
                  };
              }
              return item;
          }).filter(i => i.quantity > 0); 

          const updatedSale = {
              ...originalSale,
              items: updatedItems,
              total: newTotal,
              subtotal: newSubtotal,
              refundedAmount: (originalSale.refundedAmount || 0) + refundAmount,
              notes: `${originalSale.notes || ''} | Devolución: -$${refundAmount} (${reason})`.trim(),
              // 🔥 FIX: sin esto, el registro queda como 'synced' sin haber subido el cambio real,
              // y el listener en tiempo real lo pisa con la versión vieja (cantidad completa),
              // haciendo que una Anulación posterior reintegre stock ya devuelto.
              syncStatus: 'pending'
          };

          if (newTotal <= 0) {
              updatedSale.status = 'REFUNDED';
              updatedSale.afip = { ...updatedSale.afip, status: 'VOIDED' }; 
          }

          await db.sales.put(updatedSale);
          
          setOperations(prev => prev.map(o => o.localId === originalSale.localId ? updatedSale : o));
          toast.success(`Devolución de $${refundAmount} procesada`, { id: toastId });
          setRefundData(null); 
          fetchOperations(); 

      } catch (error) {
          console.error(error);
          toast.error("Error al procesar devolución", { id: toastId });
      } finally {
          setIsProcessingRefund(false);
      }
  };

  const updateOperationStatus = async (op, afipData, status) => {
    const { getDB } = await import('../../../database/db'); 
    const db = await getDB();
    
    const newNumber = afipData?.numero ? 
        `FC-${afipData.letra}-${String(afipData.ptoVta).padStart(4,'0')}-${String(afipData.numero).padStart(8,'0')}` : 
        op.number;

    const ventaActualizada = {
      ...op,
      number: newNumber,
      ticketNumber: newNumber, 
      invoiceNumber: newNumber,
      afip: {
        ...op.afip, 
        status: status || 'PENDING',
        cae: afipData?.cae || op.afip?.cae || null,
        cbteNumero: afipData?.numero || op.afip?.cbteNumero || null,
        cbteLetra: afipData?.letra || op.afip?.cbteLetra || null, 
        cbteTipo: afipData?.tipo || op.afip?.cbteTipo || null,
        qr: afipData?.qr_data || op.afip?.qr || null,
        vtoCAE: afipData?.vencimiento || afipData?.vto || op.afip?.vtoCAE || null,
        ptoVta: afipData?.ptoVta || op.afip?.ptoVta || null
      },
      syncStatus: 'pending' 
    };
    
    await db.sales.put(ventaActualizada);
    setOperations(prev => prev.map(o => o.localId === op.localId ? ventaActualizada : o));
    fetchOperations();
  };

  return (
    <div className="space-y-6 pb-20 p-4 md:p-6 max-w-[1600px] mx-auto animate-in fade-in duration-500">
      
      {/* HEADER */}
      <div className="flex flex-col gap-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
                <h2 className="text-2xl font-bold text-sys-900 flex items-center gap-2">
                    <FileText className="text-brand"/> Historial de Operaciones
                </h2>
                <div className="flex items-center gap-2 mt-1">
                    <span className="bg-sys-100 text-sys-600 px-2 py-0.5 rounded text-xs font-bold border border-sys-200 flex items-center gap-1">
                        <Store size={12}/> {activeBranchName || 'Sucursal'}
                    </span>
                    <span className="text-sys-400 text-xs">|</span>
                    <p className="text-sys-500 text-xs">Gestión de ventas y facturación</p>
                </div>
            </div>
            
            <div className="flex items-center gap-3">
                {/* 🔥 BOTÓN DE NOTIFICACIÓN DE SINIESTROS */}
                {isAdmin && (
                    <Button 
                        onClick={() => setShowSiniestros(true)}
                        className={cn(
                            "h-10 px-4 rounded-xl flex items-center gap-3 transition-all duration-500 border-none",
                            abandonedCount > 0 
                                ? "bg-red-500 text-white shadow-lg shadow-red-200 hover:bg-red-600 animate-pulse" 
                                : "bg-sys-100 text-sys-400 hover:bg-sys-200"
                        )}
                    >
                        <AlertCircle size={18} className={abandonedCount > 0 ? "animate-bounce" : ""} />
                        <span className="text-xs font-black uppercase tracking-tight">
                            {abandonedCount > 0 ? `Detectados ${abandonedCount} Siniestros` : "Sin Siniestros"}
                        </span>
                    </Button>
                )}

                <Button variant="outline" onClick={() => fetchOperations()} className="h-10 w-10 p-0 rounded-xl border-sys-200 text-sys-500 hover:text-brand hover:bg-sys-50" title="Recargar Local">
                    <RefreshCw size={18} className={loading ? "animate-spin" : ""}/>
                </Button>

                
                {/* 💳 TARJETA DE TOTALES REALES (SOLO ADMIN/OWNER) */}
                {isAdmin && (
                    <Card className="px-5 py-2 bg-white border border-sys-200 shadow-sm flex items-center gap-6 animate-in slide-in-from-right-2">
                        <div>
                            <p className={cn("text-[10px] uppercase font-bold tracking-wider flex items-center gap-1", filterAfip ? "text-emerald-600" : "text-sys-400")}>
                                {filterAfip ? "Total Facturado AFIP" : "Ventas Brutas"}
                            </p>
                            <p className="text-xl font-black text-sys-900">
                                $ {periodTotals.gross.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                            </p>
                        </div>
                        <div className="border-l border-sys-100 pl-6 hidden sm:block">
                            <p className="text-[10px] text-emerald-600 uppercase font-bold tracking-wider flex items-center gap-1">
                                <TrendingUp size={10}/> Utilidad Neta
                            </p>
                            <p className="text-xl font-black text-emerald-600">
                                $ {periodTotals.netProfit.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                            </p>
                        </div>
                    </Card>
                )}
            </div>
          </div>

          {/* BARRA DE HERRAMIENTAS */}
          <Card className="p-2 flex flex-col xl:flex-row gap-3 items-center bg-sys-50 border-sys-200 shadow-inner">
              
              <div className="flex bg-white rounded-lg border border-sys-200 p-1 shadow-sm w-full xl:w-auto overflow-x-auto no-scrollbar">
                  {[{ id: 'today', label: 'Hoy' }, { id: 'yesterday', label: 'Ayer' }, { id: 'week', label: 'Semana' }, { id: 'month', label: 'Mes' }, { id: 'custom', label: 'Custom', icon: Calendar }].map(p => (
                      <button key={p.id} onClick={() => { setDisplayLimit(150); setFilterPeriod(p.id); }} className={cn("px-3 py-1.5 rounded-md text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1", filterPeriod === p.id ? "bg-sys-900 text-white shadow-md" : "text-sys-500 hover:bg-sys-50 hover:text-sys-900")}>
                          {p.icon && <p.icon size={12}/>} {p.label}
                      </button>
                  ))}
              </div>

              {filterPeriod === 'custom' && (
                  <div className="flex items-center gap-2 bg-white px-2 py-1 rounded-lg border border-sys-200">
                      <input type="date" value={customStart} onChange={e => { setDisplayLimit(150); setCustomStart(e.target.value); }} className="text-xs border-none outline-none font-medium text-sys-700"/>
                      <span className="text-sys-300">-</span>
                      <input type="date" value={customEnd} onChange={e => { setDisplayLimit(150); setCustomEnd(e.target.value); }} className="text-xs border-none outline-none font-medium text-sys-700"/>
                  </div>
              )}

              <div className="flex-1"></div>

              <div className="flex flex-col sm:flex-row gap-2 w-full xl:w-auto">
                  <div className="relative min-w-[140px]">
                      <User size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sys-400 pointer-events-none"/>
                      <select 
                        className="w-full bg-white border border-sys-200 text-sys-700 text-xs font-bold rounded-lg pl-8 pr-3 py-2 outline-none focus:border-brand appearance-none"
                        value={filterCashier}
                        onChange={e => setFilterCashier(e.target.value)}
                      >
                          <option value="ALL">Todos los Cajeros</option>
                          {cashiersList.map((cajero, idx) => (
                              <option key={idx} value={cajero.email}>
                                  {cajero.name || cajero.email.split('@')[0]}
                              </option>
                          ))}
                      </select>
                  </div>

                  <select className="bg-white border border-sys-200 text-sys-700 text-xs font-bold rounded-lg px-3 py-2 outline-none focus:border-brand" value={filterType} onChange={e => setFilterType(e.target.value)}>
                      <option value="ALL">Todo Tipo</option>
                      <option value="SALE">Ventas</option>
                      <option value="RECEIPT">Cobros</option>
                      <option value="BUDGET">Presupuestos</option>
                      {isAdmin && <option value="ABANDONED">🛒 Abandonos</option>}
                  </select>

                  <div className="relative min-w-[120px]">
                      <CreditCard size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sys-400 pointer-events-none"/>
                      <select 
                        className="w-full bg-white border border-sys-200 text-sys-700 text-xs font-bold rounded-lg pl-8 pr-3 py-2 outline-none focus:border-brand appearance-none"
                        value={filterPaymentMethod}
                        onChange={e => setFilterPaymentMethod(e.target.value)}
                      >
                          <option value="ALL">Todos los Pagos</option>
                          <option value="CASH">Efectivo</option>
                          <option value="CARD">Tarjetas</option>
                          <option value="TRANSFER">Transferencia</option>
                          <option value="MP">MercadoPago</option>
                          <option value="CURRENT_ACCOUNT">Cta. Corriente (Cliente)</option>
                          <option value="EMPLOYEE_ACCOUNT">Cta. Personal (Staff)</option>
                          <option value="SPLIT">🔄 Pago Combinado</option>
                          <option value="BUDGET">Presupuesto</option>
                      </select>
                  </div>

                  <button
                      onClick={() => setFilterAfip(prev => !prev)}
                      className={cn(
                          "flex items-center gap-1.5 px-3 py-2 text-xs font-black rounded-lg border transition-all whitespace-nowrap shrink-0",
                          filterAfip
                              ? "bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-200"
                              : "bg-white text-sys-500 border-sys-200 hover:border-emerald-300 hover:text-emerald-600"
                      )}
                  >
                      <CheckCircle size={14}/>
                      Facturado AFIP
                      {filterAfip && (
                          <span className="bg-white/25 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">
                              {visibleOperations.length}
                          </span>
                      )}
                  </button>

                  <div className="relative flex-1 xl:w-64">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400"/>
                      <input type="text" placeholder="Buscar ticket, cliente..." className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-sys-200 rounded-lg outline-none focus:border-brand transition-all" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
                  </div>
              </div>
          </Card>
      </div>

      {filterAfip && (
          <div className="px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-emerald-600" />
                  <span className="text-xs font-black text-emerald-800 uppercase tracking-wide">Viendo: Facturado AFIP/ARCA</span>
                  <span className="bg-emerald-100 text-emerald-700 text-[10px] font-black px-2 py-0.5 rounded-full border border-emerald-200">
                      {visibleOperations.length} comprobantes
                  </span>
              </div>
              <button
                  onClick={() => setFilterAfip(false)}
                  className="flex items-center gap-1 text-[10px] font-black text-emerald-600 hover:text-emerald-800 hover:bg-emerald-100 px-2.5 py-1.5 rounded-lg transition-all border border-emerald-200 hover:border-emerald-300"
              >
                  <X size={12}/> Quitar filtro
              </button>
          </div>
      )}

      {/* TABLA DE RESULTADOS PAGINADA */}
      <Card className="p-0 overflow-hidden shadow-soft border-0 flex flex-col min-h-[400px]">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-sys-50/80 text-sys-500 text-xs uppercase tracking-wider border-b border-sys-100 backdrop-blur-sm sticky top-0 z-10">
                <th className="p-4 font-semibold whitespace-nowrap">Fecha / N° Ticket</th>
                <th className="p-4 font-semibold whitespace-nowrap">Tipo</th>
                <th className="p-4 font-semibold whitespace-nowrap">Cliente / Detalle</th>
                <th className="p-4 font-semibold whitespace-nowrap text-right">Monto</th>
                <th className="p-4 font-semibold whitespace-nowrap text-center">Pago</th>
                <th className="p-4 font-semibold whitespace-nowrap text-center">Estado Fiscal</th>
                <th className="p-4 font-semibold text-right whitespace-nowrap">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sys-100 bg-white">
              {loading && operations.length === 0 ? (
                  <tr><td colSpan="7" className="p-10 text-center"><RefreshCw className="animate-spin mx-auto text-sys-300"/></td></tr>
              ) : paginatedOperations.length === 0 ? (
                <tr>
                  <td colSpan="7" className="p-12 text-center">
                    <div className="flex flex-col items-center justify-center text-sys-300">
                        <Search size={48} className="mb-4 opacity-50" />
                        <p className="font-medium text-sys-500">No se encontraron movimientos.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedOperations.map((op) => {
                    const isReceipt = op.type === 'RECEIPT';
                    const isBudget = op.type === 'BUDGET';
                    const isFacturado = op.afip?.status === 'APPROVED';
                    const isAnulado = op.afip?.status === 'VOIDED'; 
                    const isRefunded = op.status === 'REFUNDED' || op.status === 'PARTIAL_REFUND';
                    const isAbandoned = op.status === 'ABANDONED'; // 🔥 NEXUS SINIESTRO
                    
                    const isLoading = loadingMap[op.localId];
                    // 🔥 CLAVE: op.method es el campo global (guardado en repo), no op.payment.method (primer pago)
                    const opMethodGlobal = (op.method || '').toLowerCase();
                    const paymentMethodRaw = opMethodGlobal === 'split' ? 'split' : (opMethodGlobal || op.payment?.method || op.paymentMethod || (isAbandoned ? 'abandoned' : 'cash'));
                    const paymentMethod = String(paymentMethodRaw).toLowerCase();
                    
                    const cajeroName = resolveCashierName(op);
                    const hasPromo = !isReceipt && !isBudget && op.items?.some(i => i.appliedPromo || i.promoLabel);
                    
                    const surchargeAmount = parseFloat(op.surcharge || 0);
                    const hasSurcharge = surchargeAmount > 0;

                    const profit = parseFloat(op.netProfit || 0);
                    const isProfitable = profit > 0;
                    const displayTicketNumber = getDisplayNumber(op);

                    const opDate = new Date(op.date || op.createdAt || op.syncedAt);

                    return (
                      <tr key={op.localId || op.id} className={cn("transition-colors group", 
                        (isAnulado || isRefunded) ? "bg-red-50/30 opacity-60" : 
                        isAbandoned ? "bg-red-50/20 border-l-4 border-red-500 opacity-70" :
                        "hover:bg-sys-50/40")}>
                        <td className="p-4 text-sys-600 font-mono text-xs whitespace-nowrap">
                          <div className="font-bold text-sys-800">{opDate.toLocaleDateString()} {opDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                          <div className="text-[11px] font-bold text-brand mt-0.5">{displayTicketNumber}</div>
                          <div className="flex items-center gap-1 text-[10px] text-sys-400 mt-0.5">
                              <User size={10}/> {cajeroName}
                          </div>
                        </td>
                        <td className="p-4">
                            {isReceipt ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-50 text-blue-700 text-[10px] font-bold uppercase border border-blue-100"><ArrowDownLeft size={12}/> Cobro</span>
                            ) : isBudget ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-sys-100 text-sys-600 text-[10px] font-bold uppercase border border-sys-300"><FileArchive size={12}/> Presupuesto</span>
                            ) : isAbandoned ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-600 text-white text-[10px] font-bold uppercase border border-red-700 shadow-sm"><XCircle size={12}/> Abandono</span>
                            ) : (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase border border-emerald-100"><ShoppingBag size={12}/> Venta</span>
                            )}
                        </td>
                        <td className="p-4 text-sys-800 font-medium">
                          <div className="flex flex-col">
                            <span className="font-bold truncate max-w-[200px]">{op.client?.name || op.userName || 'Consumidor Final'}</span>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-sys-400 font-normal">
                                    {isReceipt ? "Pago a Cuenta" : `${op.itemCount || (op.items?.length) || 0} items`}
                                </span>
                                {hasPromo && (
                                    <span className="text-[9px] font-bold text-purple-600 bg-purple-50 px-1.5 rounded flex items-center gap-1 border border-purple-100">
                                        <Percent size={8}/> PROMO
                                    </span>
                                )}
                            </div>
                            {op.notes && (
                                <span className="text-[9px] text-orange-600 font-medium mt-1 truncate max-w-[200px]" title={op.notes}>
                                    📝 {op.notes}
                                </span>
                            )}
                          </div>
                        </td>
                        
                        <td className="p-4 text-right">
                          <div className="flex flex-col items-end">
                          <span className={cn("font-bold whitespace-nowrap text-sm", 
                            (isAnulado || isRefunded || isAbandoned) ? "text-red-400 line-through decoration-red-400" : 
                            isBudget ? "text-sys-500" : "text-sys-900")}>
                                $ {(parseFloat(op.total) || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                          </span>
                              
                              {hasSurcharge && !isAnulado && !isRefunded && !isBudget && (
                                  <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-1.5 rounded border border-indigo-100 flex items-center gap-0.5 mt-0.5" title={`Incluye $${surchargeAmount} de recargo`}>
                                      <ArrowUpRight size={8}/> Recargo
                                  </span>
                              )}
                              
                              {/* Jamás mostrar utilidades en siniestros */}
                              {isAdmin && !isReceipt && !isAnulado && !isRefunded && !isAbandoned && !hasSurcharge && !isBudget && (
                                  <span className={cn("text-[9px] font-bold flex items-center gap-1 mt-0.5", isProfitable ? "text-emerald-600" : "text-red-500")}>
                                      <TrendingUp size={8}/> 
                                      ${profit.toLocaleString('es-AR', {minimumFractionDigits: 0, maximumFractionDigits: 0})}
                                  </span>
                              )}
                          </div>
                        </td>

                        <td className="p-4 text-center">
                          <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase border inline-block min-w-[60px]", 
                            isAbandoned ? "bg-red-600 text-white border-red-600 shadow-sm" :
                            isBudget ? "bg-sys-100 text-sys-500 border-sys-200" :
                            ['cash', 'efectivo'].includes(paymentMethod) ? "bg-green-50 text-green-700 border-green-100" :
                            ['mercadopago', 'mp', 'qr', 'point'].includes(paymentMethod) ? "bg-blue-50 text-blue-700 border-blue-100" :
                            ['clover', 'card', 'debit', 'credit', 'tarjeta', 'manual_card'].includes(paymentMethod) ? "bg-emerald-50 text-emerald-700 border-emerald-100" :
                            paymentMethod === 'employee_account' ? "bg-pink-50 text-pink-700 border-pink-200" :
                            ['current_account', 'cta_cte', 'account'].includes(paymentMethod) ? "bg-orange-50 text-orange-700 border-orange-200" :
                            paymentMethod === 'split' ? "bg-indigo-50 text-indigo-700 border-indigo-200 shadow-sm" :
                            "bg-purple-50 text-purple-700 border-purple-100")}>
                            
                            {isAbandoned ? 'ABANDONO' :
                             ['mercadopago', 'mp'].includes(paymentMethod) ? 'MP QR' :
                             ['cash'].includes(paymentMethod) ? 'EFECTIVO' : 
                             ['transfer'].includes(paymentMethod) ? 'TRANSFERENCIA' : 
                             ['card', 'credit', 'debit', 'tarjeta', 'manual_card'].includes(paymentMethod) ? 'TARJETA' :
                             paymentMethod === 'employee_account' ? 'CTA. PERSONAL' :
                             ['current_account', 'cta_cte', 'account'].includes(paymentMethod) ? 'CTA. CORRIENTE' :
                             paymentMethod === 'split' ? 'COMBINADO' : 
                             ['budget'].includes(paymentMethod) ? 'PRESUPUESTO' :
                             paymentMethod.toUpperCase()}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          {isReceipt || isBudget ? (<span className="text-[10px] text-sys-300">-</span>) 
                          : isAbandoned ? (<span className="text-[10px] font-black text-red-600 bg-red-100 px-2 py-0.5 rounded border border-red-200">SINIESTRO</span>)
                          : (isAnulado || isRefunded) ? (<span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded border border-red-100">ANULADO</span>) 
                          : isFacturado ? (
                            <div className="inline-flex items-center gap-1 text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-100 cursor-help" title={`CAE: ${op.afip?.cae}`}>
                              <CheckCircle size={10} />
                              <span className="text-[10px] font-bold">FC "{op.afip?.cbteLetra}"</span>
                            </div>
                          ) : (<span className="text-[10px] text-sys-400 italic">Pendiente</span>)}
                        </td>
                        <td className="p-4 text-right whitespace-nowrap">
                          <div className="flex justify-end gap-1">
                            {!isFacturado && !isAnulado && !isReceipt && !isRefunded && !isBudget && (
                              <Button variant="secondary" onClick={() => handleFacturar(op)} disabled={isLoading} className="h-7 text-[10px] px-2 bg-brand/10 text-brand hover:bg-brand hover:text-white border-none shadow-none">
                                {isLoading ? <RefreshCw size={10} className="animate-spin" /> : "Facturar"}
                              </Button>
                            )}
                            
                            {!isAnulado && !isReceipt && !isRefunded && (
                                <>
                                    {isAdmin && (
                                        <Button variant="ghost" onClick={() => handleAnular(op)} disabled={isLoading} className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50" title="Anular Totalmente">
                                            {isLoading ? <RefreshCw size={10} className="animate-spin" /> : <RotateCcw size={12} />}
                                        </Button>
                                    )}
                                    {!isBudget && (
                                        <Button variant="ghost" onClick={() => setRefundData({ isOpen: true, sale: op })} disabled={isLoading} className="h-7 w-7 p-0 text-orange-400 hover:text-orange-600 hover:bg-orange-50" title="Gestionar Devolución (Editar)">
                                            <PackageMinus size={14} />
                                        </Button>
                                    )}
                                </>
                            )}

                            <Button variant="ghost" onClick={() => setSelectedOpForTicket(op)} className="h-7 w-7 p-0 text-sys-400 hover:text-sys-900 hover:bg-sys-100" title="Imprimir Comprobante">
                              <Printer size={14} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* CONTROLES DE PAGINACIÓN Y CARGA MÁS */}
        {visibleOperations.length > 0 && (
            <div className="p-4 border-t border-sys-100 bg-sys-50/50 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <span className="text-[10px] font-black text-sys-500 uppercase tracking-widest">
                        Mostrando {((currentPage - 1) * itemsPerPage) + 1} - {Math.min(currentPage * itemsPerPage, visibleOperations.length)} de {visibleOperations.length} registros cargados
                    </span>
                    {hasMore && (
                        <button 
                            onClick={() => setDisplayLimit(prev => prev + 50)} 
                            disabled={loadingMore}
                            className="flex items-center gap-1.5 text-[10px] font-black text-brand hover:text-brand-dark uppercase transition-colors disabled:opacity-50"
                        >
                            {loadingMore ? <Loader2 size={14} className="animate-spin"/> : <PlusCircle size={14}/>} 
                            Cargar más ventas
                        </button>
                    )}
                </div>
                
                <div className="flex items-center gap-1">
                    <Button variant="ghost" disabled={currentPage === 1} onClick={() => setCurrentPage(1)} className="h-8 w-8 p-0"><ChevronsLeft size={16}/></Button>
                    <Button variant="ghost" disabled={currentPage === 1} onClick={() => setCurrentPage(prev => prev - 1)} className="h-8 w-8 p-0"><ChevronLeft size={16}/></Button>
                    <span className="text-xs font-bold text-sys-700 px-3">Página {currentPage} de {totalPages || 1}</span>
                    <Button variant="ghost" disabled={currentPage === totalPages || totalPages === 0} onClick={() => setCurrentPage(prev => prev + 1)} className="h-8 w-8 p-0"><ChevronRight size={16}/></Button>
                    <Button variant="ghost" disabled={currentPage === totalPages || totalPages === 0} onClick={() => setCurrentPage(totalPages)} className="h-8 w-8 p-0"><ChevronsRight size={16}/></Button>
                </div>
            </div>
        )}
      </Card>

      <TicketModal 
          isOpen={!!selectedOpForTicket}
          sale={selectedOpForTicket?.type !== 'RECEIPT' ? selectedOpForTicket : null}
          receipt={selectedOpForTicket?.type === 'RECEIPT' ? selectedOpForTicket : null}
          onClose={() => setSelectedOpForTicket(null)}
      />

      {refundData && (
          <RefundModal 
              isOpen={refundData.isOpen}
              sale={refundData.sale}
              isProcessing={isProcessingRefund} 
              onClose={() => setRefundData(null)}
              onConfirm={handleProcessRefund}
          />
      )}

      {/* 🔥 VISTA DE SINIESTROS */}
      {isAdmin && (
          <SiniestrosModal 
              isOpen={showSiniestros}
              onClose={() => setShowSiniestros(false)}
              siniestros={abandonedSales}
          />
      )}
    </div>
  );
};