import React, { useEffect, useState, useMemo } from 'react';
import { 
    FileText, CheckCircle, AlertCircle, Printer, RefreshCw, Search, 
    ArrowDownLeft, ShoppingBag, XCircle, RotateCcw, Calendar, User
} from 'lucide-react';
import { billingService } from '../../billing/services/billingService';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import { getDB } from '../../../database/db';
import { TicketModal } from '../components/TicketModal';
import { useAuthStore } from '../../auth/store/useAuthStore'; 

// 🔥 NUEVOS IMPORTS PARA TRAER CAJEROS
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db as firestoreDB } from '../../../database/firebase';

// Helper de fechas
const toInputDate = (date) => date.toISOString().split('T')[0];

export const SalesPage = () => {
  const { user } = useAuthStore(); 
  const isAdmin = user?.role === 'ADMIN'; 

  // Estado de Datos
  const [operations, setOperations] = useState([]); 
  const [cashiersList, setCashiersList] = useState([]); // Lista de usuarios de la empresa
  const [loading, setLoading] = useState(true);
  
  // Estado de Filtros
  const [filterPeriod, setFilterPeriod] = useState('today'); 
  const [customStart, setCustomStart] = useState(toInputDate(new Date()));
  const [customEnd, setCustomEnd] = useState(toInputDate(new Date()));
  const [filterType, setFilterType] = useState('ALL'); 
  const [filterCashier, setFilterCashier] = useState('ALL'); 
  const [searchTerm, setSearchTerm] = useState('');

  // Estados UI
  const [loadingMap, setLoadingMap] = useState({}); 
  const [selectedOpForTicket, setSelectedOpForTicket] = useState(null); 

  // 1. CARGAR LISTA DE CAJEROS (Usuarios de la empresa)
  useEffect(() => {
      if (user?.companyId) {
          const fetchCashiers = async () => {
              try {
                  const q = query(
                      collection(firestoreDB, 'users'), 
                      where('companyId', '==', user.companyId)
                  );
                  const snapshot = await getDocs(q);
                  const users = snapshot.docs.map(doc => doc.data());
                  setCashiersList(users);
              } catch (error) {
                  console.error("Error cargando cajeros:", error);
                  // Si falla (ej: offline), no rompemos nada, cashiersList queda vacío
              }
          };
          fetchCashiers();
      }
  }, [user?.companyId]);

  // 2. CARGAR OPERACIONES (Ventas)
  useEffect(() => {
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
            } else if (filterPeriod === 'week') {
                const day = start.getDay() || 7; 
                if (day !== 1) start.setHours(-24 * (day - 1)); 
                start.setHours(0, 0, 0, 0);
            } else if (filterPeriod === 'month') {
                start.setDate(1);
                start.setHours(0, 0, 0, 0);
            } else if (filterPeriod === 'custom') {
                start = new Date(customStart);
                start.setHours(0,0,0,0);
                start = new Date(start.getTime() + start.getTimezoneOffset() * 60000);
                end = new Date(customEnd);
                end = new Date(end.getTime() + end.getTimezoneOffset() * 60000);
                end.setHours(23, 59, 59, 999);
            }

            const db = await getDB();
            const allSales = await db.getAll('sales');
            
            const filtered = allSales.filter(op => {
                const opDate = new Date(op.date);
                return opDate >= start && opDate <= end;
            });

            filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
            setOperations(filtered);
        } catch (error) {
            console.error("Error cargando historial:", error);
        } finally {
            setLoading(false);
        }
    };
    fetchOperations();
  }, [filterPeriod, customStart, customEnd]);

  // 3. FILTRADO EN MEMORIA
  const visibleOperations = useMemo(() => {
      return operations.filter(op => {
          // Filtro por Tipo
          if (filterType === 'SALE' && op.type === 'RECEIPT') return false;
          if (filterType === 'RECEIPT' && op.type !== 'RECEIPT') return false;

          // Filtro por Cajero (Compara email del creador)
          if (filterCashier !== 'ALL') {
             // Normalizamos: la venta puede tener createdBy o userId
             const opUser = op.createdBy || op.userId;
             if (opUser !== filterCashier) return false;
          }

          // Búsqueda Texto
          if (searchTerm) {
              const search = searchTerm.toLowerCase();
              const clientName = op.client?.name?.toLowerCase() || '';
              const totalStr = op.total.toString();
              return clientName.includes(search) || totalStr.includes(search);
          }
          return true;
      });
  }, [operations, filterType, filterCashier, searchTerm]);

  // Lógica Fiscal
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
    if (!window.confirm("⚠️ ¿Generar NOTA DE CRÉDITO para anular esta venta?")) return;
    setLoadingMap(prev => ({ ...prev, [op.localId]: true }));
    try {
      const notaCredito = await billingService.emitirNotaCredito(op);
      await updateOperationStatus(op, notaCredito, 'VOIDED'); 
      alert("✅ Operación Anulada con Éxito");
    } catch (error) {
      console.error(error);
      alert(`❌ Error al Anular: ${error.message}`);
    } finally {
      setLoadingMap(prev => ({ ...prev, [op.localId]: false }));
    }
  };

  const updateOperationStatus = async (op, afipData, status) => {
    const db = await getDB();
    const tx = db.transaction('sales', 'readwrite');
    const store = tx.objectStore('sales');
    const ventaActualizada = {
      ...op,
      afip: {
        status: status || 'PENDING',
        cae: afipData?.cae || null,
        cbteNumero: afipData?.numero || null,
        cbteLetra: afipData?.tipo || null, 
        qr: afipData?.qr_data || null,
        vtoCAE: afipData?.vto || null
      }
    };
    await store.put(ventaActualizada);
    await tx.done;
    setOperations(prev => prev.map(o => o.localId === op.localId ? ventaActualizada : o));
  };

  return (
    <div className="space-y-6 pb-20 p-4 md:p-6 max-w-[1600px] mx-auto">
      
      {/* HEADER */}
      <div className="flex flex-col gap-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
                <h2 className="text-2xl font-bold text-sys-900 flex items-center gap-2">
                    <FileText className="text-brand"/> Historial de Operaciones
                </h2>
                <p className="text-sys-500 text-sm">Gestiona ventas, cobros y facturación electrónica.</p>
            </div>
            
            {/* KPI Dinámico */}
            <Card className="px-6 py-2 bg-white border border-sys-200 shadow-sm flex items-center gap-4">
                <div>
                    <p className="text-[10px] text-sys-400 uppercase font-bold">Total Selección</p>
                    <p className="text-xl font-black text-sys-900">
                        $ {visibleOperations
                            .filter(op => op.afip?.status !== 'VOIDED')
                            .reduce((acc, op) => acc + (op.total || 0), 0)
                            .toLocaleString('es-AR', {minimumFractionDigits: 2})}
                    </p>
                </div>
            </Card>
          </div>

          {/* BARRA DE HERRAMIENTAS */}
          <Card className="p-2 flex flex-col xl:flex-row gap-3 items-center bg-sys-50 border-sys-200">
              
              {/* Período */}
              <div className="flex bg-white rounded-lg border border-sys-200 p-1 shadow-sm w-full xl:w-auto overflow-x-auto">
                  {[{ id: 'today', label: 'Hoy' }, { id: 'yesterday', label: 'Ayer' }, { id: 'week', label: 'Semana' }, { id: 'month', label: 'Mes' }, { id: 'custom', label: 'Custom', icon: Calendar }].map(p => (
                      <button key={p.id} onClick={() => setFilterPeriod(p.id)} className={cn("px-3 py-1.5 rounded-md text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1", filterPeriod === p.id ? "bg-sys-900 text-white shadow-md" : "text-sys-500 hover:bg-sys-50 hover:text-sys-900")}>
                          {p.icon && <p.icon size={12}/>} {p.label}
                      </button>
                  ))}
              </div>

              {/* Fechas Custom */}
              {filterPeriod === 'custom' && (
                  <div className="flex items-center gap-2 bg-white px-2 py-1 rounded-lg border border-sys-200">
                      <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="text-xs border-none outline-none font-medium text-sys-700"/>
                      <span className="text-sys-300">-</span>
                      <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="text-xs border-none outline-none font-medium text-sys-700"/>
                  </div>
              )}

              <div className="flex-1"></div>

              {/* FILTROS LATERALES */}
              <div className="flex flex-col sm:flex-row gap-2 w-full xl:w-auto">
                  
                  {/* SELECTOR DE CAJERO */}
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

                  <div className="relative flex-1 xl:w-64">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400"/>
                      <input type="text" placeholder="Buscar..." className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-sys-200 rounded-lg outline-none focus:border-brand transition-all" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
                  </div>
              </div>
          </Card>
      </div>

      {/* TABLA CORREGIDA */}
      <Card className="p-0 overflow-hidden shadow-soft border-0 min-h-[400px]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-sys-50/80 text-sys-500 text-xs uppercase tracking-wider border-b border-sys-100 backdrop-blur-sm sticky top-0 z-10">
                <th className="p-4 font-semibold whitespace-nowrap">Fecha / Cajero</th>
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
              ) : visibleOperations.length === 0 ? (
                <tr>
                  <td colSpan="7" className="p-12 text-center">
                    <div className="flex flex-col items-center justify-center text-sys-300">
                        <Search size={48} className="mb-4 opacity-50" />
                        <p className="font-medium text-sys-500">No se encontraron movimientos.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                visibleOperations.map((op) => {
                    const isReceipt = op.type === 'RECEIPT';
                    const isFacturado = op.afip?.status === 'APPROVED';
                    const isAnulado = op.afip?.status === 'VOIDED'; 
                    const isLoading = loadingMap[op.localId];
                    const paymentMethod = op.payment?.method || op.paymentMethod || 'cash';
                    
                    // Buscamos el nombre del cajero en la lista descargada
                    const cajeroEmail = op.createdBy || op.userId;
                    const cajeroObj = cashiersList.find(c => c.email === cajeroEmail);
                    const cajeroName = cajeroObj?.name || cajeroEmail?.split('@')[0] || 'Desconocido';

                    return (
                      <tr key={op.localId} className={cn("transition-colors group", isAnulado ? "bg-red-50/30 opacity-60" : "hover:bg-sys-50/40")}>
                        <td className="p-4 text-sys-600 font-mono text-xs whitespace-nowrap">
                          <div className="font-bold text-sys-800">{new Date(op.date).toLocaleDateString()} {new Date(op.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
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
                            <span className="text-[10px] text-sys-400 font-normal truncate max-w-[250px]">
                               {isReceipt ? "Pago a Cuenta" : `${op.itemCount} items: ${op.items?.map(i => i.name).join(', ')}`}
                            </span>
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          <span className={cn("font-bold whitespace-nowrap text-sm", isAnulado ? "text-red-400 line-through decoration-red-400" : "text-sys-900")}>
                            $ {op.total.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase border inline-block min-w-[60px]", 
                            paymentMethod === 'cash' ? "bg-green-50 text-green-700 border-green-100" :
                            paymentMethod === 'mercadopago' ? "bg-blue-50 text-blue-700 border-blue-100" :
                            paymentMethod === 'clover' ? "bg-emerald-50 text-emerald-700 border-emerald-100" :
                            "bg-purple-50 text-purple-700 border-purple-100")}>
                            {paymentMethod === 'mercadopago' ? 'MP QR' : paymentMethod.toUpperCase()}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          {isReceipt ? (<span className="text-[10px] text-sys-300">-</span>) 
                          : isAnulado ? (<span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded border border-red-100">ANULADO</span>) 
                          : isFacturado ? (
                            <div className="inline-flex items-center gap-1 text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-100 cursor-help" title={`CAE: ${op.afip.cae}`}>
                              <CheckCircle size={10} />
                              <span className="text-[10px] font-bold">FC "{op.afip.cbteLetra}"</span>
                            </div>
                          ) : (<span className="text-[10px] text-sys-400 italic">Pendiente</span>)}
                        </td>
                        <td className="p-4 text-right whitespace-nowrap">
                          <div className="flex justify-end gap-1">
                            {!isFacturado && !isAnulado && !isReceipt && (
                              <Button variant="secondary" onClick={() => handleFacturar(op)} disabled={isLoading} className="h-7 text-[10px] px-2 bg-brand/10 text-brand hover:bg-brand hover:text-white border-none shadow-none">
                                {isLoading ? <RefreshCw size={10} className="animate-spin" /> : "Facturar"}
                              </Button>
                            )}
                            {isFacturado && !isAnulado && isAdmin && (
                              <Button variant="ghost" onClick={() => handleAnular(op)} disabled={isLoading} className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50">
                                {isLoading ? <RefreshCw size={10} className="animate-spin" /> : <RotateCcw size={12} />}
                              </Button>
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
      </Card>

      <TicketModal 
         isOpen={!!selectedOpForTicket}
         sale={selectedOpForTicket?.type !== 'RECEIPT' ? selectedOpForTicket : null}
         receipt={selectedOpForTicket?.type === 'RECEIPT' ? selectedOpForTicket : null}
         onClose={() => setSelectedOpForTicket(null)}
      />
    </div>
  );
};