import React, { useEffect, useState, useMemo } from 'react';
import { 
  Search, Filter, History, AlertCircle, CheckCircle2, 
  Package, DollarSign, Tag, ArrowDownLeft, ArrowUpRight, 
  Cloud, Wifi, WifiOff, Calendar 
} from 'lucide-react';
import { Card } from '../../../core/ui/Card';
import { cn } from '../../../core/utils/cn';
import { movementsRepository } from '../repositories/movementsRepository';
import { getDB } from '../../../database/db'; // Para cargar categorías en modo local

// Configuración visual de tipos
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
  const [loading, setLoading] = useState(false);
  
  // Modo
  const [isCloudMode, setIsCloudMode] = useState(false);
  const [isOnline] = useState(navigator.onLine);

  // Filtros
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('ALL');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]); // Fecha YYYY-MM-DD
  
  // Categorías
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // ===================== CARGA DE DATOS =====================
  useEffect(() => {
    loadData();
  }, [isCloudMode, selectedDate]); // Recargar si cambia modo o fecha

  const loadData = async () => {
    setLoading(true);
    setData([]); // Limpiar tabla mientras carga
    try {
        if (isCloudMode && navigator.onLine) {
            // ☁️ MODO ONLINE: Trae movimientos + categorías de la nube
            console.log("☁️ Consultando nube...");
            const result = await movementsRepository.getCloudByDate(selectedDate);
            setData(result.data);
            setCategories(result.categories); // Llenamos el select con lo que vino de nube
        } else {
            // 🏠 MODO LOCAL: Lee de DB local
            console.log("🏠 Consultando local...");
            const result = await movementsRepository.getAllLocal();
            // Filtramos por fecha manualmente en local
            const localFiltered = result.filter(m => 
                m.dateObj.toISOString().split('T')[0] === selectedDate
            );
            setData(localFiltered);
            
            // Cargar categorías locales
            const db = await getDB();
            const cats = await db.getAll('categories');
            setCategories(cats);
        }
    } catch (error) {
        console.error("Error cargando movimientos:", error);
        alert("Error al consultar datos. Revisa tu conexión.");
    } finally {
        setLoading(false);
    }
  };

  // ===================== FILTROS EN MEMORIA =====================
  const filteredData = useMemo(() => {
    return data.filter(item => {
      // 1. Texto (Producto, Usuario, Descripción)
      const matchText = item.productName.toLowerCase().includes(search.toLowerCase()) || 
                        (item.description && item.description.toLowerCase().includes(search.toLowerCase())) ||
                        (item.user && item.user.toLowerCase().includes(search.toLowerCase()));
      if (!matchText) return false;

      // 2. Tipo de Movimiento
      if (filterType !== 'ALL' && item.type !== filterType) return false;

      // 3. Categoría (NUEVO)
      if (selectedCategory !== 'ALL' && item.categoryId !== Number(selectedCategory) && item.categoryId !== selectedCategory) return false;

      return true;
    });
  }, [data, search, filterType, selectedCategory]);

  // Totales dinámicos según filtro
  const totalAmount = useMemo(() => {
      // Si son ventas, sumamos plata (aproximado). Si es stock, sumamos unidades.
      return filteredData.length;
  }, [filteredData]);

  // ===================== RENDER =====================
  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-sys-900 tracking-tight flex items-center gap-2">
            <History className="text-brand" /> Movimientos de Stock
          </h2>
          <div className="flex items-center gap-2 mt-1">
             <span className={`text-xs px-2 py-0.5 rounded border font-bold ${isCloudMode ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-sys-100 text-sys-600 border-sys-200'}`}>
                 {isCloudMode ? 'MODO NUBE (Dueño)' : 'MODO LOCAL (Caja)'}
             </span>
             <span className="text-xs text-sys-500">
                 {isCloudMode ? 'Consultando datos en tiempo real de Firebase' : 'Consultando base de datos de este equipo'}
             </span>
          </div>
        </div>

        {/* Switch Local / Nube */}
        <button 
            onClick={() => setIsCloudMode(!isCloudMode)}
            disabled={!isOnline}
            className={`
                flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-all shadow-sm
                ${isCloudMode 
                    ? 'bg-blue-600 text-white border-blue-700 shadow-blue-200 hover:bg-blue-700' 
                    : 'bg-white text-sys-600 border-sys-200 hover:bg-gray-50'}
                ${!isOnline && 'opacity-50 cursor-not-allowed'}
            `}
        >
            {isCloudMode ? <Cloud size={16} /> : <WifiOff size={16} />}
            {isCloudMode ? 'Cambiar a Local' : 'Consultar Nube'}
        </button>
      </div>

      {/* TOOLBAR DE FILTROS */}
      <Card className="p-3 bg-white border-sys-200 shadow-sm rounded-xl">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            
            {/* 1. Selección de Fecha (CRÍTICO) */}
            <div className="md:col-span-1">
                <label className="text-[10px] font-bold text-sys-500 uppercase tracking-wider mb-1 block">Fecha Consulta</label>
                <div className="relative">
                    <Calendar className="absolute left-3 top-2.5 text-sys-400 w-4 h-4" />
                    <input 
                        type="date" 
                        className="w-full pl-9 pr-3 py-2 bg-sys-50 rounded-lg border border-sys-200 text-sm font-bold text-sys-800 outline-none focus:ring-2 focus:ring-brand"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                    />
                </div>
            </div>

            {/* 2. Filtro de Categoría (NUEVO) */}
            <div className="md:col-span-1">
                <label className="text-[10px] font-bold text-sys-500 uppercase tracking-wider mb-1 block">Filtrar Rubro</label>
                <select 
                    className="w-full px-3 py-2 bg-white rounded-lg border border-sys-200 text-sm outline-none focus:border-brand"
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                >
                    <option value="ALL">📦 Todos los Rubros</option>
                    {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
            </div>

            {/* 3. Filtro de Tipo */}
            <div className="md:col-span-1">
                <label className="text-[10px] font-bold text-sys-500 uppercase tracking-wider mb-1 block">Tipo Movimiento</label>
                <select 
                    className="w-full px-3 py-2 bg-white rounded-lg border border-sys-200 text-sm outline-none focus:border-brand"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                >
                    <option value="ALL">⚡ Todos los Tipos</option>
                    {Object.keys(TYPE_CONFIG).map(key => (
                        <option key={key} value={key}>{TYPE_CONFIG[key].label}</option>
                    ))}
                </select>
            </div>

            {/* 4. Buscador Texto */}
            <div className="md:col-span-1">
                <label className="text-[10px] font-bold text-sys-500 uppercase tracking-wider mb-1 block">Buscador</label>
                <div className="relative">
                    <Search className="absolute left-3 top-2.5 text-sys-400 w-4 h-4" />
                    <input 
                        type="text" 
                        placeholder="Producto / Usuario..." 
                        className="w-full pl-9 pr-4 py-2 bg-white rounded-lg border border-sys-200 text-sm outline-none focus:border-brand"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>
        </div>
      </Card>

      {/* RESULTADOS */}
      <div className="space-y-3">
        {loading ? (
           <div className="text-center py-20 text-sys-400 bg-white rounded-2xl border border-sys-100">
             <div className="animate-spin rounded-full h-8 w-8 border-4 border-sys-200 border-t-brand mx-auto mb-3"></div>
             <p className="text-sm font-medium text-sys-600">
                 {isCloudMode ? 'Descargando datos de la Nube...' : 'Leyendo datos Locales...'}
             </p>
             <p className="text-xs mt-1">Esto puede tardar unos segundos si hay muchos datos.</p>
           </div>
        ) : filteredData.length === 0 ? (
           <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-sys-200">
             <div className="w-16 h-16 bg-sys-50 rounded-full flex items-center justify-center mx-auto mb-3 text-sys-300">
               <History size={32} />
             </div>
             <p className="text-sys-500 font-medium">No hay movimientos en esta fecha</p>
             <p className="text-xs text-sys-400 mt-1">Prueba cambiando la fecha o los filtros.</p>
           </div>
        ) : (
           <>
              <div className="text-xs font-bold text-sys-400 uppercase tracking-widest text-right">
                  Mostrando {filteredData.length} movimientos
              </div>
              
              {filteredData.map((mov) => {
                 const style = TYPE_CONFIG[mov.type] || { label: mov.type, icon: AlertCircle, color: 'text-gray-500', bg: 'bg-gray-100', border: 'border-gray-200' };
                 const Icon = style.icon;

                 return (
                   <div key={mov.id || mov.localId || Math.random()} className="group bg-white rounded-xl p-3 border border-sys-100 hover:border-brand/30 hover:shadow-md transition-all duration-200 flex flex-col md:flex-row gap-3 items-start md:items-center">
                     
                     {/* Hora */}
                     <div className="min-w-[60px] text-center md:text-left">
                        <span className="text-xs font-bold text-sys-800">
                            {mov.dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </span>
                     </div>

                     {/* Icono */}
                     <div className={cn("w-8 h-8 rounded-full flex items-center justify-center border shrink-0", style.bg, style.color, style.border)}>
                        <Icon size={14} />
                     </div>

                     {/* Detalle */}
                     <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                           <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border tracking-wider", style.bg, style.color, style.border)}>
                             {style.label}
                           </span>
                           {/* Nombre Categoría */}
                           {mov.categoryName && (
                               <span className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200 font-medium">
                                   {mov.categoryName}
                               </span>
                           )}
                        </div>
                        <h4 className="text-sm font-bold text-sys-800 truncate">{mov.productName}</h4>
                        <div className="flex gap-2 text-xs text-sys-500">
                            <span>Usuario: <b>{mov.user || 'Sistema'}</b></span>
                        </div>
                     </div>

                     {/* Cantidad */}
                     {mov.amount && (
                       <div className="text-right min-w-[80px]">
                          <span className={cn("text-lg font-black tracking-tight", (mov.type && mov.type.includes('OUT')) ? "text-red-600" : "text-green-600")}>
                            {(mov.type && mov.type.includes('OUT')) ? '-' : '+'}{mov.amount}
                          </span>
                       </div>
                     )}
                   </div>
                 );
               })}
           </>
        )}
      </div>
    </div>
  );
};