import React, { useEffect, useState, useMemo } from 'react';
import { 
    FileText, CheckCircle, AlertCircle, Printer, RefreshCw, Search, 
    ArrowDownLeft, ShoppingBag, XCircle, RotateCcw, Calendar, User,
    ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, 
    TrendingUp, Tag, Percent, DollarSign, Store, CreditCard, Banknote,
    PackageMinus, Save, X, Loader2
} from 'lucide-react';
import { billingService } from '../../billing/services/billingService';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import { salesRepository } from '../repositories/salesRepository'; 
import { productRepository } from '../../inventory/repositories/productRepository'; 
import { TicketModal } from '../components/TicketModal';
import { useAuthStore } from '../../auth/store/useAuthStore'; 
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
// 🛍️ MODAL DE DEVOLUCIÓN PARCIAL (CON FEEDBACK DE CARGA)
// =================================================================
const RefundModal = ({ isOpen, onClose, sale, onConfirm, isProcessing }) => {
    const [returnMap, setReturnMap] = useState({}); // { itemId: qtyToReturn }
    const [refundTotal, setRefundTotal] = useState(0);

    useEffect(() => {
        if (isOpen) {
            setReturnMap({});
            setRefundTotal(0);
        }
    }, [isOpen, sale]);

    const handleQtyChange = (item, change) => {
        if (isProcessing) return; // Bloquear cambios durante proceso
        const currentReturn = returnMap[item.id] || 0;
        const newReturn = Math.max(0, Math.min(item.quantity, currentReturn + change));
        
        const newMap = { ...returnMap, [item.id]: newReturn };
        setReturnMap(newMap);

        // Recalcular total a devolver
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
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[80vh]">
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

                <div className="p-5 border-t border-sys-100 bg-sys-50">
                    <div className="flex justify-between items-center mb-4">
                        <span className="text-sm font-bold text-sys-600 uppercase">Monto a Reintegrar:</span>
                        <span className="text-2xl font-black text-orange-600">
                            $ {refundTotal.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                        </span>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="ghost" onClick={onClose} disabled={isProcessing} className="flex-1">Cancelar</Button>
                        <Button 
                            onClick={() => onConfirm(sale, returnMap, refundTotal)} 
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
// 🏭 SALES PAGE (MAIN)
// =================================================================
export const SalesPage = () => {
  const { user, activeBranchId, activeBranchName } = useAuthStore(); 
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'OWNER'; 

  // Estado de Datos
  const [operations, setOperations] = useState([]); 
  const [cashiersList, setCashiersList] = useState([]); 
  const [loading, setLoading] = useState(true);
  
  // Estado de Filtros
  const [filterPeriod, setFilterPeriod] = useState('today'); 
  const [customStart, setCustomStart] = useState(toInputDate(new Date()));
  const [customEnd, setCustomEnd] = useState(toInputDate(new Date()));
  const [filterType, setFilterType] = useState('ALL'); 
  const [filterCashier, setFilterCashier] = useState('ALL'); 
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('ALL'); 
  const [searchTerm, setSearchTerm] = useState('');

  // Estado de Paginación
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20; 

  // Estados UI
  const [loadingMap, setLoadingMap] = useState({}); 
  const [selectedOpForTicket, setSelectedOpForTicket] = useState(null); 
  const [refundData, setRefundData] = useState(null); 
  const [isProcessingRefund, setIsProcessingRefund] = useState(false); // 🔥 ESTADO DE CARGA DEVOLUCIÓN

  // 1. CARGAR LISTA DE CAJEROS
  useEffect(() => {
      if (user?.companyId && activeBranchId) {
          const fetchCashiers = async () => {
              try {
                  let q = query(
                      collection(firestoreDB, 'users'), 
                      where('companyId', '==', user.companyId)
                  );
                  const snapshot = await getDocs(q);
                  const users = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
                  const branchUsers = users.filter(u => {
                      if (u.role === 'OWNER' || u.role === 'ADMIN') return true;
                      return String(u.branchId) === String(activeBranchId);
                  });
                  setCashiersList(branchUsers);
              } catch (error) { console.error("Error cargando cajeros:", error); }
          };
          fetchCashiers();
      }
  }, [user?.companyId, activeBranchId]); 

  // 2. CARGAR OPERACIONES
  const fetchOperations = async () => {
      setLoading(true);
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
              if (day !== 1) start.setHours(-24 * (day - 1)); 
              start.setHours(0, 0, 0, 0);
          } else if (filterPeriod === 'month') {
              start.setDate(1);
              start.setHours(0, 0, 0, 0);
          } else if (filterPeriod === 'custom') {
              start = new Date(customStart + 'T00:00:00');
              end = new Date(customEnd + 'T23:59:59');
          }

          let rawData = [];
          if (salesRepository.getOperationsByDateRange) {
               rawData = await salesRepository.getOperationsByDateRange(start, end);
          } else {
               rawData = await salesRepository.getTodaySales();
          }
          setOperations(rawData || []);
          setCurrentPage(1); 
      } catch (error) {
          console.error("Error cargando historial:", error);
      } finally {
          setLoading(false);
      }
  };

  useEffect(() => { fetchOperations(); }, [filterPeriod, customStart, customEnd]);

  // 🔥 HELPER: RESOLUCIÓN INTELIGENTE DE NOMBRE CAJERO
  const resolveCashierName = (op) => {
      const idToCheck = op.userId || op.createdBy;
      const matchedUser = cashiersList.find(u => u.uid === idToCheck || u.email === idToCheck);
      if (matchedUser) return matchedUser.name || matchedUser.email.split('@')[0];
      if (op.sellerName && op.sellerName !== 'Cajero') return op.sellerName;
      if (op.operatorName) return op.operatorName;
      if (op.userName && op.userName !== 'Vendedor') return op.userName;
      if (typeof idToCheck === 'string' && idToCheck.includes('@')) {
          return idToCheck.split('@')[0];
      }
      return "Desconocido";
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

  // 3. FILTRADO
  const visibleOperations = useMemo(() => {
      return operations.filter(op => {
          if (activeBranchId && op.branchId !== activeBranchId) return false;
          if (filterType === 'SALE' && op.type === 'RECEIPT') return false;
          if (filterType === 'RECEIPT' && op.type !== 'RECEIPT') return false;

          if (filterCashier !== 'ALL') {
              const selectedUser = cashiersList.find(u => u.email === filterCashier);
              if (!selectedUser) return false;
              if (op.userId === selectedUser.uid) return true;
              if (op.createdBy === selectedUser.email) return true;
              const opName = (op.sellerName || op.userName || '').toLowerCase();
              const selName = (selectedUser.name || '').toLowerCase();
              if (opName && selName && opName === selName) return true;
              return false;
          }

          if (filterPaymentMethod !== 'ALL') {
              const methodRaw = op.payment?.method || op.paymentMethod || 'cash';
              const method = String(methodRaw).toLowerCase().trim();
              if (filterPaymentMethod === 'CASH' && method !== 'cash') return false;
              if (filterPaymentMethod === 'CARD' && !['card', 'credit', 'debit'].includes(method)) return false;
              if (filterPaymentMethod === 'TRANSFER' && method !== 'transfer') return false;
              if (filterPaymentMethod === 'MP' && !['mercadopago', 'mp', 'qr'].includes(method)) return false;
              if (filterPaymentMethod === 'CURRENT_ACCOUNT' && method !== 'current_account') return false;
          }

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
  }, [operations, filterType, filterCashier, filterPaymentMethod, searchTerm, cashiersList, activeBranchId]);

  // 4. LÓGICA DE PAGINACIÓN
  const totalPages = Math.ceil(visibleOperations.length / itemsPerPage);
  const paginatedOperations = useMemo(() => {
      const startIndex = (currentPage - 1) * itemsPerPage;
      return visibleOperations.slice(startIndex, startIndex + itemsPerPage);
  }, [visibleOperations, currentPage]);

  // =================================================================
  // 🚀 ACCIONES (FACTURAR, ANULAR, DEVOLVER)
  // =================================================================

  const handleFacturar = async (op) => {
    if (op.type === 'RECEIPT') return;
    setLoadingMap(prev => ({ ...prev, [op.localId]: true }));
    try {
      const factura = await billingService.emitirFactura(op);
      await updateOperationStatus(op, factura, 'APPROVED');
    } catch (error) {
      console.error(error);
      alert(`❌ Error AFIP: ${error.message}`);
    } finally {
      setLoadingMap(prev => ({ ...prev, [op.localId]: false }));
    }
  };

  const handleAnular = async (op) => {
    if (!isAdmin) return;
    if (!window.confirm("⚠️ ¿Estás seguro de ANULAR esta venta?\nSe repondrá el stock automáticamente.")) return;
    
    setLoadingMap(prev => ({ ...prev, [op.localId]: true }));
    try {
      let notaCreditoData = null;
      if (op.afip?.status === 'APPROVED') {
          notaCreditoData = await billingService.emitirNotaCredito(op);
          toast.success("Nota de Crédito generada en AFIP");
      }
      
      // Devolver stock total
      if (op.items && Array.isArray(op.items)) {
          for (const item of op.items) {
              await productRepository.addStock(item.id, item.quantity, `Anulación Venta #${getDisplayNumber(op)}`, user?.name, op.branchId);
          }
      }

      await updateOperationStatus(op, notaCreditoData, 'VOIDED'); 
      alert("✅ Operación Anulada con Éxito");
    } catch (error) {
      console.error(error);
      alert(`❌ Error al Anular: ${error.message}`);
    } finally {
      setLoadingMap(prev => ({ ...prev, [op.localId]: false }));
    }
  };

  // 🔥 PROCESAR DEVOLUCIÓN PARCIAL (CON FEEDBACK VISUAL)
  const handleProcessRefund = async (originalSale, returnMap, refundAmount) => {
      setIsProcessingRefund(true);
      const toastId = toast.loading("Procesando devolución...");
      try {
          const { getDB } = await import('../../../database/db'); 
          const db = await getDB();

          // 1. Devolver Stock
          const itemsToReturn = originalSale.items.filter(i => returnMap[i.id] > 0);
          for (const item of itemsToReturn) {
              const qtyToReturn = returnMap[item.id];
              await productRepository.addStock(item.id, qtyToReturn, `Devolución Parc. Venta #${getDisplayNumber(originalSale)}`, user?.name, originalSale.branchId);
          }

          // 2. Calcular nuevos totales
          const newTotal = originalSale.total - refundAmount;
          const newSubtotal = originalSale.subtotal - refundAmount; 
          
          // 3. Actualizar items en la venta
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

          // 4. Actualizar registro en DB
          const updatedSale = {
              ...originalSale,
              items: updatedItems,
              total: newTotal,
              subtotal: newSubtotal,
              refundedAmount: (originalSale.refundedAmount || 0) + refundAmount,
              notes: `${originalSale.notes || ''} | Devolución: -$${refundAmount} (${new Date().toLocaleTimeString()})`.trim()
          };

          if (newTotal <= 0) {
              updatedSale.status = 'REFUNDED';
              updatedSale.afip = { ...updatedSale.afip, status: 'VOIDED' }; 
          }

          await db.sales.put(updatedSale);
          
          // Actualizar estado local
          setOperations(prev => prev.map(o => o.localId === originalSale.localId ? updatedSale : o));
          toast.success(`Devolución de $${refundAmount} procesada`, { id: toastId });
          setRefundData(null); // Cerrar solo si éxito

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
        status: status || 'PENDING',
        cae: afipData?.cae || null,
        cbteNumero: afipData?.numero || null,
        cbteLetra: afipData?.tipo || null, 
        qr: afipData?.qr_data || null,
        vtoCAE: afipData?.vto || null
      },
      syncStatus: 'pending' 
    };
    
    await db.sales.put(ventaActualizada);
    setOperations(prev => prev.map(o => o.localId === op.localId ? ventaActualizada : o));
  };

  const totals = useMemo(() => {
      const filtered = visibleOperations.filter(op => op.afip?.status !== 'VOIDED' && op.status !== 'REFUNDED');
      return {
          gross: filtered.reduce((acc, op) => acc + (parseFloat(op.total) || 0), 0),
          netProfit: filtered.reduce((acc, op) => acc + (parseFloat(op.netProfit) || 0), 0)
      };
  }, [visibleOperations]);

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
                <Button variant="outline" onClick={fetchOperations} className="h-10 w-10 p-0 rounded-xl border-sys-200 text-sys-500 hover:text-brand hover:bg-sys-50" title="Recargar listado">
                    <RefreshCw size={18} className={loading ? "animate-spin" : ""}/>
                </Button>
                
                {/* 💳 TARJETA DE TOTALES (SOLO ADMIN/OWNER) */}
                {isAdmin && (
                    <Card className="px-5 py-2 bg-white border border-sys-200 shadow-sm flex items-center gap-6 animate-in slide-in-from-right-2">
                        <div>
                            <p className="text-[10px] text-sys-400 uppercase font-bold tracking-wider">Ventas Brutas</p>
                            <p className="text-xl font-black text-sys-900">
                                $ {totals.gross.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                            </p>
                        </div>
                        <div className="border-l border-sys-100 pl-6">
                            <p className="text-[10px] text-emerald-600 uppercase font-bold tracking-wider flex items-center gap-1">
                                <TrendingUp size={10}/> Utilidad Neta
                            </p>
                            <p className="text-xl font-black text-emerald-600">
                                $ {totals.netProfit.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                            </p>
                        </div>
                    </Card>
                )}
            </div>
          </div>

          {/* BARRA DE HERRAMIENTAS */}
          <Card className="p-2 flex flex-col xl:flex-row gap-3 items-center bg-sys-50 border-sys-200">
              
              <div className="flex bg-white rounded-lg border border-sys-200 p-1 shadow-sm w-full xl:w-auto overflow-x-auto no-scrollbar">
                  {[{ id: 'today', label: 'Hoy' }, { id: 'yesterday', label: 'Ayer' }, { id: 'week', label: 'Semana' }, { id: 'month', label: 'Mes' }, { id: 'custom', label: 'Custom', icon: Calendar }].map(p => (
                      <button key={p.id} onClick={() => setFilterPeriod(p.id)} className={cn("px-3 py-1.5 rounded-md text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1", filterPeriod === p.id ? "bg-sys-900 text-white shadow-md" : "text-sys-500 hover:bg-sys-50 hover:text-sys-900")}>
                          {p.icon && <p.icon size={12}/>} {p.label}
                      </button>
                  ))}
              </div>

              {filterPeriod === 'custom' && (
                  <div className="flex items-center gap-2 bg-white px-2 py-1 rounded-lg border border-sys-200">
                      <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="text-xs border-none outline-none font-medium text-sys-700"/>
                      <span className="text-sys-300">-</span>
                      <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="text-xs border-none outline-none font-medium text-sys-700"/>
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
                          <option value="CURRENT_ACCOUNT">Cta. Corriente</option>
                      </select>
                  </div>

                  <div className="relative flex-1 xl:w-64">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400"/>
                      <input type="text" placeholder="Buscar ticket, cliente..." className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-sys-200 rounded-lg outline-none focus:border-brand transition-all" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
                  </div>
              </div>
          </Card>
      </div>

      {/* TABLA DE RESULTADOS PAGINADA */}
      <Card className="p-0 overflow-hidden shadow-soft border-0 min-h-[400px] flex flex-col">
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
              {loading ? (
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
                    const isFacturado = op.afip?.status === 'APPROVED';
                    const isAnulado = op.afip?.status === 'VOIDED'; 
                    const isRefunded = op.status === 'REFUNDED';
                    const isLoading = loadingMap[op.localId];
                    const paymentMethod = op.payment?.method || op.paymentMethod || 'cash';
                    
                    const cajeroName = resolveCashierName(op);
                    const hasPromo = !isReceipt && op.items?.some(i => i.appliedPromo || i.promoLabel);
                    const profit = parseFloat(op.netProfit || 0);
                    const isProfitable = profit > 0;
                    const displayTicketNumber = getDisplayNumber(op);

                    return (
                      <tr key={op.localId} className={cn("transition-colors group", (isAnulado || isRefunded) ? "bg-red-50/30 opacity-60" : "hover:bg-sys-50/40")}>
                        <td className="p-4 text-sys-600 font-mono text-xs whitespace-nowrap">
                          <div className="font-bold text-sys-800">{new Date(op.date).toLocaleDateString()} {new Date(op.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                          <div className="text-[11px] font-bold text-brand mt-0.5">{displayTicketNumber}</div>
                          <div className="flex items-center gap-1 text-[10px] text-sys-400 mt-0.5">
                              <User size={10}/> {cajeroName}
                          </div>
                        </td>
                        <td className="p-4">
                            {isReceipt ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-50 text-blue-700 text-[10px] font-bold uppercase border border-blue-100"><ArrowDownLeft size={12}/> Cobro</span>
                            ) : (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-sys-100 text-sys-600 text-[10px] font-bold uppercase border border-sys-200"><ShoppingBag size={12}/> Venta</span>
                            )}
                        </td>
                        <td className="p-4 text-sys-800 font-medium">
                          <div className="flex flex-col">
                            <span className="font-bold truncate max-w-[200px]">{op.client?.name || 'Consumidor Final'}</span>
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
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex flex-col items-end">
                              <span className={cn("font-bold whitespace-nowrap text-sm", (isAnulado || isRefunded) ? "text-red-400 line-through decoration-red-400" : "text-sys-900")}>
                                $ {(parseFloat(op.total) || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                              </span>
                              {isAdmin && !isReceipt && !isAnulado && !isRefunded && (
                                  <span className={cn("text-[9px] font-bold flex items-center gap-1", isProfitable ? "text-emerald-600" : "text-red-500")}>
                                      <TrendingUp size={8}/> 
                                      ${profit.toLocaleString('es-AR', {minimumFractionDigits: 0, maximumFractionDigits: 0})}
                                  </span>
                              )}
                          </div>
                        </td>
                        <td className="p-4 text-center">
                          <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase border inline-block min-w-[60px]", 
                            paymentMethod === 'cash' ? "bg-green-50 text-green-700 border-green-100" :
                            (paymentMethod === 'mercadopago' || paymentMethod === 'mp' || paymentMethod === 'qr') ? "bg-blue-50 text-blue-700 border-blue-100" :
                            (paymentMethod === 'clover' || paymentMethod === 'card' || paymentMethod === 'debit' || paymentMethod === 'credit') ? "bg-emerald-50 text-emerald-700 border-emerald-100" :
                            "bg-purple-50 text-purple-700 border-purple-100")}>
                            {(paymentMethod === 'mercadopago' || paymentMethod === 'mp') ? 'MP QR' : paymentMethod.toUpperCase()}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          {isReceipt ? (<span className="text-[10px] text-sys-300">-</span>) 
                          : (isAnulado || isRefunded) ? (<span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded border border-red-100">ANULADO</span>) 
                          : isFacturado ? (
                            <div className="inline-flex items-center gap-1 text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-100 cursor-help" title={`CAE: ${op.afip.cae}`}>
                              <CheckCircle size={10} />
                              <span className="text-[10px] font-bold">FC "{op.afip.cbteLetra}"</span>
                            </div>
                          ) : (<span className="text-[10px] text-sys-400 italic">Pendiente</span>)}
                        </td>
                        <td className="p-4 text-right whitespace-nowrap">
                          <div className="flex justify-end gap-1">
                            {!isFacturado && !isAnulado && !isReceipt && !isRefunded && (
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
                                    <Button variant="ghost" onClick={() => setRefundData({ isOpen: true, sale: op })} disabled={isLoading} className="h-7 w-7 p-0 text-orange-400 hover:text-orange-600 hover:bg-orange-50" title="Gestionar Devolución (Editar)">
                                        <PackageMinus size={14} />
                                    </Button>
                                </>
                            )}

                            <Button variant="ghost" onClick={() => setSelectedOpForTicket(op)} className="h-7 w-7 p-0 text-sys-400 hover:text-sys-900 hover:bg-sys-100">
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

        {visibleOperations.length > itemsPerPage && (
            <div className="p-4 border-t border-sys-100 bg-sys-50/50 flex items-center justify-between">
                <span className="text-xs text-sys-500 font-medium">
                    Mostrando {((currentPage - 1) * itemsPerPage) + 1} - {Math.min(currentPage * itemsPerPage, visibleOperations.length)} de {visibleOperations.length}
                </span>
                <div className="flex items-center gap-1">
                    <Button 
                        variant="ghost" 
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage(1)}
                        className="h-8 w-8 p-0"
                    >
                        <ChevronsLeft size={16}/>
                    </Button>
                    <Button 
                        variant="ghost" 
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage(prev => prev - 1)}
                        className="h-8 w-8 p-0"
                    >
                        <ChevronLeft size={16}/>
                    </Button>
                    <span className="text-xs font-bold text-sys-700 px-3">
                        Página {currentPage} de {totalPages}
                    </span>
                    <Button 
                        variant="ghost" 
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage(prev => prev + 1)}
                        className="h-8 w-8 p-0"
                    >
                        <ChevronRight size={16}/>
                    </Button>
                    <Button 
                        variant="ghost" 
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage(totalPages)}
                        className="h-8 w-8 p-0"
                    >
                        <ChevronsRight size={16}/>
                    </Button>
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
    </div>
  );
};