import React, { useEffect, useState, useMemo } from 'react';
import { 
  Search, Filter, ArrowDownLeft, ArrowUpRight, 
  History, DollarSign, Tag, AlertCircle, CheckCircle2, Package,
  BarChart3, List, Users, Calendar
} from 'lucide-react';
import { getDB } from '../../../database/db';
import { Card } from '../../../core/ui/Card';
import { cn } from '../../../core/utils/cn';

// ====================================================================
// 🧠 SERVICIO DE MOVIMIENTOS
// ====================================================================
const movementsService = {
  async getAllFullData() {
    const db = await getDB();
    const [movements, products] = await Promise.all([
      db.getAll('movements'),
      db.getAll('products')
    ]);

    const productMap = new Map(products.map(p => [p.id, p]));

    return movements.map(mov => {
      const product = productMap.get(mov.productId);
      return {
        ...mov,
        productName: product ? product.name : 'Producto Eliminado',
        productCode: product ? product.code : '---',
        dateObj: new Date(mov.date)
      };
    }).sort((a, b) => b.dateObj - a.dateObj);
  }
};

// ====================================================================
// 🎨 CONFIGURACIÓN VISUAL
// ====================================================================
const TYPE_CONFIG = {
  'PRICE_CHANGE': { label: 'Cambio Precio', icon: DollarSign, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
  'COST_CHANGE': { label: 'Cambio Costo', icon: Tag, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
  'STOCK_IN': { label: 'Ingreso Stock', icon: ArrowDownLeft, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
  'STOCK_ADJUST_IN': { label: 'Ajuste (+)', icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
  'STOCK_ADJUST_OUT': { label: 'Ajuste (-)', icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
  'CREATION': { label: 'Alta Producto', icon: Package, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
  'STOCK_OUT': { label: 'Venta', icon: ArrowUpRight, color: 'text-sys-600', bg: 'bg-sys-100', border: 'border-sys-200' },
};

export const MovementsPage = () => {
  // ===================== ESTADOS =====================
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // 🔥 CONFIGURACIÓN POR DEFECTO: VISTA AGREGADA (RESUMEN)
  const [viewMode, setViewMode] = useState('aggregated'); 
  
  // Filtros
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState('TODAY'); // 'TODAY' por defecto es vital para control diario
  const [filterUser, setFilterUser] = useState('ALL'); // Nuevo filtro de usuario

  // ===================== CARGA =====================
  useEffect(() => {
    movementsService.getAllFullData()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // ===================== LÓGICA DE FILTRADO =====================
  const filteredData = useMemo(() => {
    return data.filter(item => {
      // 1. Fecha (Critical First)
      const itemDate = item.dateObj;
      const today = new Date();
      today.setHours(0,0,0,0);

      if (dateRange === 'TODAY') {
        if (itemDate < today) return false;
      } else if (dateRange === 'WEEK') {
        const weekAgo = new Date(today);
        weekAgo.setDate(today.getDate() - 7);
        if (itemDate < weekAgo) return false;
      }

      // 2. Usuario (Caja)
      if (filterUser !== 'ALL' && item.user !== filterUser) return false;

      // 3. Texto (Búsqueda)
      if (search) {
          const term = search.toLowerCase();
          const matchText = item.productName.toLowerCase().includes(term) || 
                            item.productCode.toLowerCase().includes(term);
          if (!matchText) return false;
      }

      return true;
    });
  }, [data, search, dateRange, filterUser]);

  // ===================== EXTRACCIÓN DE USUARIOS (DINÁMICO) =====================
  // Detectamos qué usuarios trabajaron en el rango de fecha seleccionado
  const activeUsers = useMemo(() => {
      const users = new Set(data
          .filter(d => { // Filtramos primero por fecha para no mostrar usuarios viejos
              const itemDate = d.dateObj;
              const today = new Date();
              today.setHours(0,0,0,0);
              if (dateRange === 'TODAY') return itemDate >= today;
              if (dateRange === 'WEEK') {
                  const weekAgo = new Date(today);
                  weekAgo.setDate(today.getDate() - 7);
                  return itemDate >= weekAgo;
              }
              return true;
          })
          .map(m => m.user || 'Sistema')
      );
      return Array.from(users).sort();
  }, [data, dateRange]);

  // ===================== AGREGACIÓN (TOTALES POR PRODUCTO) =====================
  const aggregatedData = useMemo(() => {
    const grouping = {};
    
    // Solo nos interesan las SALIDAS para el reporte de "Cuánto se vendió"
    // Pero si quieres ver todo (incluso ingresos), quitamos el filtro.
    // Para control de caja ("Pan"), interesa la VENTA (STOCK_OUT).
    
    filteredData.forEach(mov => {
        // Solo sumamos movimientos que afecten cantidad (Ventas, Ingresos, Ajustes)
        if (!mov.amount) return;

        if (!grouping[mov.productId]) {
            grouping[mov.productId] = {
                id: mov.productId,
                name: mov.productName,
                code: mov.productCode,
                soldQty: 0,     // Total Salidas
                addedQty: 0,    // Total Entradas
                netQty: 0,      // Neto
                movements: 0,
                lastTime: mov.dateObj
            };
        }
        
        const qty = parseFloat(mov.amount);
        
        if (qty < 0) grouping[mov.productId].soldQty += Math.abs(qty); // Es salida
        else grouping[mov.productId].addedQty += qty; // Es entrada

        grouping[mov.productId].netQty += qty;
        grouping[mov.productId].movements += 1;
    });

    // Ordenamos por lo más vendido (Mayor salida primero)
    return Object.values(grouping).sort((a,b) => b.soldQty - a.soldQty);
  }, [filteredData]);

  // ===================== STATS =====================
  const stats = useMemo(() => {
    return {
      totalMovs: filteredData.length,
      totalSoldItems: filteredData
        .filter(m => parseFloat(m.amount) < 0)
        .reduce((acc, m) => acc + Math.abs(parseFloat(m.amount)), 0)
    };
  }, [filteredData]);

  // ===================== RENDER =====================
  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-sys-900 tracking-tight flex items-center gap-2">
            <History className="text-brand" /> Control de Stock
          </h2>
          <p className="text-sys-500 text-sm mt-1">
             {dateRange === 'TODAY' ? 'Mostrando actividad de HOY' : 'Historial de movimientos'}
          </p>
        </div>
        
        {/* KPI SIMPLE */}
        <div className="bg-white px-5 py-2 rounded-xl border border-sys-200 shadow-sm flex items-center gap-4">
            <div className="text-right">
                <p className="text-[10px] text-sys-400 font-bold uppercase">Unidades Vendidas</p>
                <p className="text-2xl font-black text-sys-900 leading-none">
                    {stats.totalSoldItems.toLocaleString('es-AR', {maximumFractionDigits: 2})}
                </p>
            </div>
            <div className="h-8 w-8 rounded-full bg-brand/10 text-brand flex items-center justify-center">
                <Package size={18} />
            </div>
        </div>
      </div>

      {/* BARRA DE HERRAMIENTAS (Filtros + Vistas) */}
      <Card className="p-2 flex flex-col lg:flex-row gap-3 bg-sys-100/50 backdrop-blur-md border-sys-200">
        
        {/* 1. Buscador */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400 w-4 h-4" />
          <input 
            type="text" 
            placeholder="Buscar producto..." 
            className="w-full pl-9 pr-4 py-2 bg-white rounded-lg border border-sys-200 text-sm focus:border-brand focus:ring-2 focus:ring-brand/10 outline-none transition-all"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* 2. Filtro FECHA */}
        <div className="flex bg-white rounded-lg border border-sys-200 p-1 shrink-0">
           {['TODAY', 'WEEK', 'ALL'].map(range => (
               <button 
                 key={range}
                 onClick={() => setDateRange(range)}
                 className={cn("px-3 py-1.5 text-xs font-bold rounded-md transition-all uppercase flex items-center gap-1", 
                    dateRange === range ? "bg-sys-100 text-brand" : "text-sys-400 hover:text-sys-600"
                 )}
               >
                 {range === 'TODAY' && <Calendar size={12}/>}
                 {range === 'TODAY' ? 'Hoy' : range === 'WEEK' ? 'Semana' : 'Histórico'}
               </button>
           ))}
        </div>

        {/* 3. Filtro USUARIO (CAJA) - 🔥 NUEVO */}
        <div className="relative min-w-[160px] shrink-0">
           <Users className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400 w-4 h-4" />
           <select 
             className="w-full pl-9 pr-8 py-2 bg-white rounded-lg border border-sys-200 text-sm outline-none focus:border-brand appearance-none cursor-pointer font-medium text-sys-700"
             value={filterUser}
             onChange={(e) => setFilterUser(e.target.value)}
           >
             <option value="ALL">Todos los Usuarios</option>
             {activeUsers.map(u => (
               <option key={u} value={u}>{u}</option>
             ))}
           </select>
           <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none border-l pl-2 border-sys-200">
               <span className="text-[10px] font-bold text-sys-400">USER</span>
           </div>
        </div>

        {/* 4. Selector de VISTA */}
        <div className="flex bg-white rounded-lg border border-sys-200 p-1 shrink-0">
            <button 
                onClick={() => setViewMode('aggregated')}
                className={cn("px-3 py-1.5 rounded-md transition-all flex items-center gap-2 text-xs font-bold", viewMode === 'aggregated' ? "bg-brand text-white shadow-md" : "text-sys-500 hover:bg-sys-50")}
                title="Ver Totales"
            >
                <BarChart3 size={16} /> Totales
            </button>
            <button 
                onClick={() => setViewMode('list')}
                className={cn("px-3 py-1.5 rounded-md transition-all flex items-center gap-2 text-xs font-bold", viewMode === 'list' ? "bg-brand text-white shadow-md" : "text-sys-500 hover:bg-sys-50")}
                title="Ver Detalle"
            >
                <List size={16} /> Detalle
            </button>
        </div>
      </Card>

      {/* CONTENIDO PRINCIPAL */}
      <div className="min-h-[300px]">
        {loading ? (
           <div className="text-center py-20 text-sys-400">
             <div className="animate-spin rounded-full h-8 w-8 border-4 border-sys-200 border-t-brand mx-auto mb-3"></div>
             <p className="text-xs">Procesando movimientos...</p>
           </div>
        ) : filteredData.length === 0 ? (
           <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-sys-200">
             <div className="w-16 h-16 bg-sys-50 rounded-full flex items-center justify-center mx-auto mb-3 text-sys-300">
               <Filter size={32} />
             </div>
             <p className="text-sys-500 font-medium">Sin movimientos registrados</p>
             <p className="text-xs text-sys-400 mt-1">
                {dateRange === 'TODAY' ? 'Aún no se han realizado operaciones hoy.' : 'Intenta cambiar los filtros.'}
             </p>
           </div>
        ) : viewMode === 'aggregated' ? (
           
           /* ================================================= */
           /* VISTA AGREGADA: TOTALES POR PRODUCTO (EL ERP)    */
           /* ================================================= */
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 animate-in slide-in-from-bottom-2 duration-300">
               {aggregatedData.map(item => (
                   <div key={item.id} className="bg-white p-4 rounded-xl border border-sys-200 shadow-sm flex flex-col justify-between group hover:border-brand/30 transition-all relative overflow-hidden">
                       
                       {/* Fondo decorativo si es top seller */}
                       {item.soldQty > 10 && <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-green-50 to-transparent rounded-bl-3xl -mr-2 -mt-2"></div>}

                       <div className="flex justify-between items-start mb-3 relative z-10">
                           <div>
                               <p className="text-[10px] font-bold text-sys-400 uppercase tracking-wider mb-0.5">{item.code}</p>
                               <h4 className="font-bold text-sys-900 text-base leading-tight line-clamp-2">{item.name}</h4>
                           </div>
                           <span className="bg-sys-100 text-sys-500 text-[10px] font-bold px-2 py-1 rounded-full">
                               {item.movements} movs
                           </span>
                       </div>

                       <div className="flex items-end justify-between border-t border-sys-100 pt-3 relative z-10">
                           <div className="flex flex-col">
                               <span className="text-[10px] text-sys-400 uppercase font-bold">Total Vendido</span>
                               <span className={cn("text-2xl font-black tracking-tighter", item.soldQty > 0 ? "text-sys-900" : "text-sys-300")}>
                                   {item.soldQty > 0 ? item.soldQty.toLocaleString('es-AR', {maximumFractionDigits: 2}) : '-'}
                               </span>
                           </div>
                           
                           {item.addedQty > 0 && (
                               <div className="text-right">
                                   <span className="text-[10px] text-green-600 uppercase font-bold block">Ingresado</span>
                                   <span className="text-sm font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded">
                                       +{item.addedQty.toLocaleString('es-AR', {maximumFractionDigits: 2})}
                                   </span>
                               </div>
                           )}
                       </div>
                   </div>
               ))}
           </div>

        ) : (
           
           /* ================================================= */
           /* VISTA LISTA: BITÁCORA DETALLADA                  */
           /* ================================================= */
           <div className="space-y-3 animate-in slide-in-from-bottom-2 duration-300">
               {filteredData.map((mov) => {
                 const style = TYPE_CONFIG[mov.type] || { label: mov.type, icon: AlertCircle, color: 'text-gray-500', bg: 'bg-gray-100', border: 'border-gray-200' };
                 const Icon = style.icon;

                 return (
                   <div key={mov.id} className="group bg-white rounded-xl p-3 border border-sys-100 hover:border-brand/20 hover:shadow-md transition-all duration-200 flex items-center gap-4">
                     
                     <div className={cn("w-10 h-10 rounded-full flex items-center justify-center border shrink-0", style.bg, style.color, style.border)}>
                        <Icon size={18} />
                     </div>

                     <div className="w-24 shrink-0 hidden sm:block">
                        <p className="text-xs font-bold text-sys-900">{mov.dateObj.toLocaleDateString()}</p>
                        <p className="text-[10px] text-sys-400 font-mono">{mov.dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                     </div>

                     <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                           <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border", style.bg, style.color, style.border)}>
                             {style.label}
                           </span>
                           <span className="text-[10px] text-sys-400 flex items-center gap-1">
                             <Users size={10}/> {mov.user || 'Sistema'}
                           </span>
                        </div>
                        <h4 className="text-sm font-bold text-sys-800 truncate">{mov.productName}</h4>
                        {/* <p className="text-[10px] text-sys-500 truncate">{mov.description}</p> */}
                     </div>

                     {mov.amount && (
                       <div className="text-right pl-3 border-l border-sys-100 min-w-[80px]">
                          <span className={cn("text-lg font-black tracking-tight", mov.type.includes('OUT') ? "text-red-600" : "text-green-600")}>
                            {mov.type.includes('OUT') ? '-' : '+'}{Math.abs(mov.amount).toLocaleString('es-AR')}
                          </span>
                       </div>
                     )}
                   </div>
                 );
               })}
           </div>
        )}
      </div>
    </div>
  );
};