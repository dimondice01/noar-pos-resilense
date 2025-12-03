import React, { useEffect, useState, useMemo } from 'react';
import { 
  Search, Filter, Calendar, ArrowDownLeft, ArrowUpRight, 
  History, DollarSign, Tag, AlertCircle, CheckCircle2, Package 
} from 'lucide-react';
import { getDB } from '../../../database/db';
import { Card } from '../../../core/ui/Card';
import { cn } from '../../../core/utils/cn';

// ====================================================================
// 🧠 REPOSITORIO LOCAL (Internalizado para este módulo)
// ====================================================================
const movementsService = {
  async getAllFullData() {
    const db = await getDB();
    // 1. Obtenemos Movimientos y Productos en paralelo
    const [movements, products] = await Promise.all([
      db.getAll('movements'),
      db.getAll('products')
    ]);

    // 2. Creamos un mapa de productos para acceso O(1)
    const productMap = new Map(products.map(p => [p.id, p]));

    // 3. Enriquecemos el movimiento con datos del producto
    return movements.map(mov => {
      const product = productMap.get(mov.productId);
      return {
        ...mov,
        productName: product ? product.name : 'Producto Eliminado',
        productCode: product ? product.code : '---',
        // Normalizamos fecha
        dateObj: new Date(mov.date)
      };
    }).sort((a, b) => b.dateObj - a.dateObj); // Orden descendente (más nuevo arriba)
  }
};

// ====================================================================
// 🎨 UI HELPERS & CONFIG
// ====================================================================
const TYPE_CONFIG = {
  'PRICE_CHANGE': { label: 'Cambio Precio', icon: DollarSign, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
  'COST_CHANGE': { label: 'Cambio Costo', icon: Tag, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
  'STOCK_IN': { label: 'Ingreso Stock', icon: ArrowDownLeft, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
  'STOCK_ADJUST_IN': { label: 'Ajuste (+)', icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
  'STOCK_ADJUST_OUT': { label: 'Ajuste (-)', icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
  'CREATION': { label: 'Alta Producto', icon: Package, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
  'SALE': { label: 'Venta', icon: ArrowUpRight, color: 'text-sys-600', bg: 'bg-sys-100', border: 'border-sys-200' },
};

export const MovementsPage = () => {
  // ===================== ESTADOS =====================
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Filtros
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('ALL');
  const [dateRange, setDateRange] = useState('ALL'); // 'ALL' | 'TODAY' | 'WEEK'

  // ===================== CARGA DE DATOS =====================
  useEffect(() => {
    movementsService.getAllFullData()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // ===================== FILTROS =====================
  const filteredData = useMemo(() => {
    return data.filter(item => {
      // 1. Texto
      const matchText = item.productName.toLowerCase().includes(search.toLowerCase()) || 
                        item.description.toLowerCase().includes(search.toLowerCase());
      if (!matchText) return false;

      // 2. Tipo
      if (filterType !== 'ALL' && item.type !== filterType) return false;

      // 3. Fecha
      if (dateRange === 'TODAY') {
        const today = new Date();
        return item.dateObj.toDateString() === today.toDateString();
      }
      // (Aquí se pueden agregar más lógicas de fecha)

      return true;
    });
  }, [data, search, filterType, dateRange]);

  // Stats Rápidos (KPIs)
  const stats = useMemo(() => {
    return {
      total: filteredData.length,
      stockIn: filteredData.filter(i => i.type.includes('_IN')).length,
      stockOut: filteredData.filter(i => i.type.includes('_OUT')).length,
      priceChanges: filteredData.filter(i => i.type === 'PRICE_CHANGE').length
    };
  }, [filteredData]);

  // ===================== RENDER =====================
  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      
      {/* HEADER & STATS */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h2 className="text-2xl font-bold text-sys-900 tracking-tight flex items-center gap-2">
            <History className="text-brand" /> Monitor de Movimientos
          </h2>
          <p className="text-sys-500 text-sm mt-1">Auditoría completa de cambios en inventario y precios.</p>
        </div>
        
        {/* KPI Cards Mini */}
        <div className="flex gap-3 overflow-x-auto pb-1 w-full md:w-auto">
           <div className="bg-white px-4 py-2 rounded-xl border border-sys-200 shadow-sm flex flex-col items-center min-w-[100px]">
              <span className="text-[10px] text-sys-400 font-bold uppercase tracking-wider">Movimientos</span>
              <span className="text-xl font-bold text-sys-900">{stats.total}</span>
           </div>
           <div className="bg-green-50 px-4 py-2 rounded-xl border border-green-100 shadow-sm flex flex-col items-center min-w-[100px]">
              <span className="text-[10px] text-green-600 font-bold uppercase tracking-wider">Entradas</span>
              <span className="text-xl font-bold text-green-700">{stats.stockIn}</span>
           </div>
           <div className="bg-blue-50 px-4 py-2 rounded-xl border border-blue-100 shadow-sm flex flex-col items-center min-w-[100px]">
              <span className="text-[10px] text-blue-600 font-bold uppercase tracking-wider">Precios</span>
              <span className="text-xl font-bold text-blue-700">{stats.priceChanges}</span>
           </div>
        </div>
      </div>

      {/* TOOLBAR FILTROS */}
      <Card className="p-1 flex flex-col md:flex-row gap-2 bg-sys-100/50 backdrop-blur-md border-sys-200">
        
        {/* Buscador */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 text-sys-400 w-4 h-4" />
          <input 
            type="text" 
            placeholder="Buscar por producto, usuario o detalle..." 
            className="w-full pl-9 pr-4 py-2 bg-white rounded-lg border border-sys-200 text-sm focus:border-brand focus:ring-2 focus:ring-brand/10 outline-none transition-all"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Selector Tipo */}
        <div className="relative w-full md:w-48">
           <Filter className="absolute left-3 top-2.5 text-sys-400 w-4 h-4" />
           <select 
             className="w-full pl-9 pr-8 py-2 bg-white rounded-lg border border-sys-200 text-sm outline-none focus:border-brand appearance-none cursor-pointer"
             value={filterType}
             onChange={(e) => setFilterType(e.target.value)}
           >
             <option value="ALL">Todos los Tipos</option>
             {Object.keys(TYPE_CONFIG).map(key => (
               <option key={key} value={key}>{TYPE_CONFIG[key].label}</option>
             ))}
           </select>
        </div>

        {/* Selector Fecha */}
        <div className="flex bg-white rounded-lg border border-sys-200 p-1">
           <button 
             onClick={() => setDateRange('TODAY')}
             className={cn("px-3 py-1 text-xs font-medium rounded-md transition-all", dateRange === 'TODAY' ? "bg-sys-100 text-sys-900 font-bold" : "text-sys-500 hover:text-sys-700")}
           >
             Hoy
           </button>
           <button 
             onClick={() => setDateRange('ALL')}
             className={cn("px-3 py-1 text-xs font-medium rounded-md transition-all", dateRange === 'ALL' ? "bg-sys-100 text-sys-900 font-bold" : "text-sys-500 hover:text-sys-700")}
           >
             Histórico
           </button>
        </div>
      </Card>

      {/* LISTA DE MOVIMIENTOS */}
      <div className="space-y-3">
        {loading ? (
           <div className="text-center py-20 text-sys-400">
             <div className="animate-spin rounded-full h-8 w-8 border-4 border-sys-200 border-t-brand mx-auto mb-3"></div>
             <p className="text-xs">Consultando bitácora segura...</p>
           </div>
        ) : filteredData.length === 0 ? (
           <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-sys-200">
             <div className="w-16 h-16 bg-sys-50 rounded-full flex items-center justify-center mx-auto mb-3 text-sys-300">
               <History size={32} />
             </div>
             <p className="text-sys-500 font-medium">No se encontraron movimientos</p>
             <p className="text-xs text-sys-400 mt-1">Prueba cambiando los filtros de búsqueda.</p>
           </div>
        ) : (
           filteredData.map((mov) => {
             const style = TYPE_CONFIG[mov.type] || { label: mov.type, icon: AlertCircle, color: 'text-gray-500', bg: 'bg-gray-100', border: 'border-gray-200' };
             const Icon = style.icon;

             return (
               <div key={mov.id} className="group bg-white rounded-xl p-4 border border-sys-100 hover:border-brand/20 hover:shadow-md transition-all duration-200 flex flex-col md:flex-row gap-4 items-start md:items-center">
                 
                 {/* Icono + Fecha */}
                 <div className="flex items-center gap-4 min-w-[180px]">
                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center border shrink-0", style.bg, style.color, style.border)}>
                       <Icon size={18} />
                    </div>
                    <div>
                       <p className="text-xs font-bold text-sys-900">
                         {mov.dateObj.toLocaleDateString()}
                       </p>
                       <p className="text-[10px] text-sys-400 font-mono">
                         {mov.dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                       </p>
                    </div>
                 </div>

                 {/* Detalle Producto */}
                 <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                       <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded border tracking-wider", style.bg, style.color, style.border)}>
                         {style.label}
                       </span>
                       <span className="text-xs text-sys-400">
                         por <span className="font-semibold text-sys-600">{mov.user || 'Sistema'}</span>
                       </span>
                    </div>
                    <h4 className="text-sm font-bold text-sys-800 truncate">{mov.productName}</h4>
                    <p className="text-xs text-sys-500 mt-0.5">{mov.description}</p>
                 </div>

                 {/* Valor Numérico (Si aplica) */}
                 {mov.amount && (
                   <div className="text-right pl-4 border-l border-sys-100 min-w-[100px]">
                      <span className="text-[10px] text-sys-400 uppercase font-bold tracking-wider block mb-0.5">Cantidad</span>
                      <span className={cn("text-lg font-black tracking-tight", mov.type.includes('OUT') ? "text-red-600" : "text-green-600")}>
                        {mov.type.includes('OUT') ? '-' : '+'}{mov.amount}
                      </span>
                   </div>
                 )}
               </div>
             );
           })
        )}
      </div>
    </div>
  );
};