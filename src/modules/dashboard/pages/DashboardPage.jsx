import React, { useEffect, useState } from 'react';
import { 
  TrendingUp, Users, Package, AlertTriangle, 
  Wallet, ArrowRight, RefreshCw, DollarSign,
  CreditCard, Smartphone, ShoppingBag
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Repositorios
import { salesRepository } from '../../sales/repositories/salesRepository';
import { clientRepository } from '../../clients/repositories/clientRepository';
import { productRepository } from '../../inventory/repositories/productRepository';
import { cashRepository } from '../../cash/repositories/cashRepository';

// UI
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

export const DashboardPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  
  // Estado de Métricas
  const [metrics, setMetrics] = useState({
    todaySales: 0,
    todayCount: 0,
    cashInHand: 0,
    digitalSales: 0,
    totalDebt: 0,
    lowStockCount: 0,
    activeShift: null,
    syncPending: 0
  });

  useEffect(() => {
    loadIntelligence();
  }, []);

  const loadIntelligence = async () => {
    try {
      const today = new Date();
      today.setHours(0,0,0,0);

      // 1. Obtener Datos en Paralelo (High Performance)
      const [ops, clients, products, shift] = await Promise.all([
        salesRepository.getTodayOperations(),
        clientRepository.getAll(),
        productRepository.getAll(),
        cashRepository.getCurrentShift()
      ]);

      // 2. Procesar Ventas del Día
      let totalVendido = 0;
      let ventaEfectivo = 0;
      let ventaDigital = 0;
      let count = 0;

      ops.forEach(op => {
        // Solo contamos Ventas y Cobros reales, ignoramos anulados si los hubiera
        totalVendido += op.total;
        count++;
        
        // Analizar método de pago (soportando estructura segura)
        const method = op.payment?.method || op.paymentMethod || 'cash';
        if (method === 'cash') {
            // Nota: Aquí sumamos el total de la operación al flujo teórico
            // Para flujo real de caja se usa el cash_movements, aquí es KPI de Venta
            ventaEfectivo += op.amountPaid || op.total; 
        } else {
            ventaDigital += op.amountPaid || op.total;
        }
      });

      // 3. Procesar Deuda Global (Cartera de Clientes)
      // Esto vale oro: Saber cuánto capital hay en la calle
      const deudaTotal = clients.reduce((acc, c) => acc + (c.balance || 0), 0);

      // 4. Procesar Stock Crítico
      const stockBajo = products.filter(p => p.stock <= (p.minStock || 5)).length;

      // 5. Setear Métricas
      setMetrics({
        todaySales: totalVendido,
        todayCount: count,
        cashInHand: ventaEfectivo,
        digitalSales: ventaDigital,
        totalDebt: deudaTotal,
        lowStockCount: stockBajo,
        activeShift: shift,
        syncPending: 0 // Aquí conectarías con useAutoSync si quisieras mostrar pendientes
      });

    } catch (error) {
      console.error("Error calculando inteligencia:", error);
    } finally {
      setLoading(false);
    }
  };

  // Helper de Moneda
  const money = (val) => val.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2});

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-sys-400 animate-pulse">
        <div className="w-12 h-12 rounded-full border-4 border-sys-200 border-t-brand animate-spin mb-4"></div>
        <p>Procesando Inteligencia de Negocio...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-500">
      
      {/* 1. HERO SECTION: VENTAS DEL DÍA */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* KPI Principal: Ventas Totales */}
        <Card className="lg:col-span-2 bg-gradient-to-br from-sys-900 to-sys-800 text-white border-none shadow-xl overflow-hidden relative group">
          <div className="absolute right-0 top-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-white/10 transition-colors"></div>
          
          <div className="relative z-10 flex flex-col justify-between h-full p-2">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sys-300 font-medium uppercase tracking-wider text-xs mb-1">Facturación Hoy</p>
                <h1 className="text-5xl font-black tracking-tight flex items-baseline gap-2">
                  <span className="text-2xl text-sys-400 font-normal">$</span> 
                  {money(metrics.todaySales)}
                </h1>
              </div>
              <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-md">
                <TrendingUp className="text-green-400" size={32} />
              </div>
            </div>

            <div className="mt-8 flex gap-8">
              <div className="flex flex-col">
                <span className="text-xs text-sys-400 uppercase font-bold">Efectivo (Est.)</span>
                <span className="text-xl font-bold flex items-center gap-2">
                   <Wallet size={16} className="text-green-400"/> $ {money(metrics.cashInHand)}
                </span>
              </div>
              <div className="flex flex-col border-l border-white/10 pl-8">
                <span className="text-xs text-sys-400 uppercase font-bold">Digital / Bancos</span>
                <span className="text-xl font-bold flex items-center gap-2">
                   <CreditCard size={16} className="text-blue-400"/> $ {money(metrics.digitalSales)}
                </span>
              </div>
            </div>
          </div>
        </Card>

        {/* Estado de Caja y Accesos */}
        <div className="space-y-4">
            
            {/* Alerta de Caja */}
            <Card className={cn(
                "border-l-4 p-5 flex flex-col justify-center h-[140px] relative overflow-hidden transition-all",
                metrics.activeShift ? "border-l-green-500 bg-green-50/50" : "border-l-red-500 bg-red-50/50"
            )}>
                <div>
                    <div className="flex justify-between items-start mb-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-sys-500">Estado de Caja</p>
                        {metrics.activeShift 
                            ? <RefreshCw size={16} className="text-green-600 animate-pulse"/> 
                            : <AlertTriangle size={16} className="text-red-500 animate-bounce"/>
                        }
                    </div>
                    <h3 className={cn("text-2xl font-black", metrics.activeShift ? "text-green-700" : "text-red-700")}>
                        {metrics.activeShift ? "TURNO ABIERTO" : "CAJA CERRADA"}
                    </h3>
                    <p className="text-xs text-sys-600 mt-1">
                        {metrics.activeShift 
                            ? `Iniciado: ${new Date(metrics.activeShift.openedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}` 
                            : "Debe abrir caja para cobrar."}
                    </p>
                </div>
                {!metrics.activeShift && (
                    <Button size="sm" className="mt-3 w-full bg-red-600 hover:bg-red-700 text-white" onClick={() => navigate('/cash')}>
                        Abrir Caja Ahora
                    </Button>
                )}
            </Card>

            {/* Accesos Rápidos */}
            <div className="grid grid-cols-2 gap-4 h-[100px]">
                <button onClick={() => navigate('/pos')} className="flex flex-col items-center justify-center bg-brand text-white rounded-xl shadow-lg shadow-brand/20 hover:bg-brand-hover transition-all active:scale-95">
                    <ShoppingBag size={24} className="mb-1" />
                    <span className="font-bold text-sm">Nueva Venta</span>
                </button>
                <button onClick={() => navigate('/clients')} className="flex flex-col items-center justify-center bg-white border border-sys-200 text-sys-600 rounded-xl hover:bg-sys-50 transition-all active:scale-95">
                    <Users size={24} className="mb-1 text-sys-400" />
                    <span className="font-bold text-sm">Clientes</span>
                </button>
            </div>
        </div>
      </div>

      {/* 2. SECCIÓN FINANCIERA Y RIESGO */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Cuentas por Cobrar (Deuda) */}
          <Card className="p-6 border-l-4 border-l-orange-500 relative overflow-hidden group hover:shadow-lg transition-all">
              <div className="absolute right-0 bottom-0 opacity-10 group-hover:opacity-20 transition-opacity transform translate-x-4 translate-y-4">
                  <DollarSign size={120} className="text-orange-500"/>
              </div>
              
              <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-orange-100 rounded-lg text-orange-600">
                          <Users size={20} />
                      </div>
                      <h3 className="font-bold text-sys-900 text-lg">Capital por Cobrar</h3>
                  </div>
                  
                  <div className="space-y-1">
                      <p className="text-4xl font-black text-sys-900 tracking-tight">$ {money(metrics.totalDebt)}</p>
                      <p className="text-sm text-sys-500">Saldo global en Cuentas Corrientes</p>
                  </div>

                  <div className="mt-6">
                      <Button variant="ghost" onClick={() => navigate('/clients')} className="text-orange-600 hover:bg-orange-50 p-0 h-auto font-bold text-sm flex items-center gap-1">
                          Gestionar Deudores <ArrowRight size={16} />
                      </Button>
                  </div>
              </div>
          </Card>

          {/* Salud de Inventario */}
          <Card className="p-6 border-l-4 border-l-purple-500 relative overflow-hidden group hover:shadow-lg transition-all">
              <div className="absolute right-0 bottom-0 opacity-10 group-hover:opacity-20 transition-opacity transform translate-x-4 translate-y-4">
                  <Package size={120} className="text-purple-500"/>
              </div>
              
              <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-purple-100 rounded-lg text-purple-600">
                          <Package size={20} />
                      </div>
                      <h3 className="font-bold text-sys-900 text-lg">Salud de Inventario</h3>
                  </div>
                  
                  <div className="flex gap-8 items-end">
                      <div>
                          <p className="text-4xl font-black text-sys-900">{metrics.lowStockCount}</p>
                          <p className="text-sm text-sys-500">Productos con Stock Crítico</p>
                      </div>
                      
                      {/* Aquí podríamos agregar valor total de inventario en el futuro */}
                  </div>

                  <div className="mt-6">
                      <Button variant="ghost" onClick={() => navigate('/inventory')} className="text-purple-600 hover:bg-purple-50 p-0 h-auto font-bold text-sm flex items-center gap-1">
                          Ver Reposición <ArrowRight size={16} />
                      </Button>
                  </div>
              </div>
          </Card>

      </div>

      {/* 3. RESUMEN OPERATIVO */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-2xl border border-sys-200 flex items-center gap-3 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-sys-50 flex items-center justify-center text-sys-500">
                  <RefreshCw size={20} />
              </div>
              <div>
                  <p className="text-[10px] font-bold uppercase text-sys-400">Transacciones</p>
                  <p className="text-xl font-bold text-sys-900">{metrics.todayCount}</p>
              </div>
          </div>
          
          <div className="bg-white p-4 rounded-2xl border border-sys-200 flex items-center gap-3 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-500">
                  <Smartphone size={20} />
              </div>
              <div>
                  <p className="text-[10px] font-bold uppercase text-sys-400">Ticket Promedio</p>
                  <p className="text-xl font-bold text-sys-900">
                      $ {metrics.todayCount > 0 ? money(metrics.todaySales / metrics.todayCount) : '0'}
                  </p>
              </div>
          </div>

          {/* Espacios para futuras métricas (ej: Margen de Ganancia) */}
      </div>

    </div>
  );
};