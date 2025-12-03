import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  ShoppingCart, 
  Package, 
  Settings, 
  FileText, 
  Cloud, 
  RefreshCw, 
  WifiOff 
} from 'lucide-react';
import { cn } from '../core/utils/cn';
import { useAutoSync } from '../core/hooks/useAutoSync';

// COMPONENTE DE ENLACE CORREGIDO (Soluciona el error de React)
const MenuLink = ({ to, icon: Icon, label }) => (
  <NavLink
    to={to}
    className={({ isActive }) => cn(
      "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group relative",
      isActive 
        ? "bg-brand-light text-brand font-semibold shadow-sm" 
        : "text-sys-500 hover:bg-sys-100 hover:text-sys-900"
    )}
  >
    {/* Usamos render props para acceder a isActive limpiamente */}
    {({ isActive }) => (
      <>
        <Icon className="w-5 h-5" />
        <span>{label}</span>
        {isActive && (
          <div className="absolute right-2 w-1.5 h-1.5 rounded-full bg-brand" />
        )}
      </>
    )}
  </NavLink>
);

export const Sidebar = () => {
  // Hook de Sincronización
  const { isSyncing, lastSync } = useAutoSync(15000);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleStatusChange = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', handleStatusChange);
    window.addEventListener('offline', handleStatusChange);
    return () => {
      window.removeEventListener('online', handleStatusChange);
      window.removeEventListener('offline', handleStatusChange);
    };
  }, []);

  return (
    <aside className="w-64 h-screen bg-white border-r border-sys-200 flex flex-col fixed left-0 top-0 z-20 hidden md:flex shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
      
      {/* Header */}
      <div className="p-6 border-b border-sys-100 flex flex-col gap-1">
        <h1 className="text-xl font-bold text-sys-900 tracking-tight flex items-center gap-1">
          Noar<span className="text-brand">POS</span>
        </h1>
        <p className="text-[10px] uppercase tracking-wider text-sys-400 font-semibold">
          Resilense Argentina
        </p>
      </div>

      {/* Navegación */}
      <nav className="flex-1 p-4 space-y-2 overflow-y-auto no-scrollbar">
        <div className="px-4 py-2 text-xs font-semibold text-sys-400 uppercase tracking-wider mb-1">
          Operación
        </div>
        <MenuLink to="/" icon={LayoutDashboard} label="Dashboard" />
        <MenuLink to="/pos" icon={ShoppingCart} label="Punto de Venta" />
        <MenuLink to="/sales" icon={FileText} label="Ventas & Caja" />
        
        <div className="px-4 py-2 text-xs font-semibold text-sys-400 uppercase tracking-wider mt-6 mb-1">
          Gestión
        </div>
        <MenuLink to="/inventory" icon={Package} label="Inventario" />
        <MenuLink to="/settings" icon={Settings} label="Configuración" />
      </nav>

      {/* Footer Estado */}
      <div className="p-4 border-t border-sys-100 bg-sys-50/50">
        <div className={cn(
          "px-4 py-3 rounded-xl border shadow-sm transition-all duration-300",
          !isOnline 
            ? "bg-red-50 border-red-100" 
            : "bg-white border-sys-200"
        )}>
            <div className="flex items-center gap-3">
               <div className={cn(
                 "w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0",
                 !isOnline ? "bg-red-100 text-red-500" :
                 isSyncing ? "bg-blue-50 text-brand" : "bg-green-50 text-green-600"
               )}>
                  {!isOnline ? <WifiOff size={18} /> : 
                   isSyncing ? <RefreshCw size={18} className="animate-spin" /> : 
                   <Cloud size={18} />}
               </div>
               
               <div className="flex-1 min-w-0">
                 <p className={cn(
                   "text-xs font-bold truncate",
                   !isOnline ? "text-red-600" : "text-sys-800"
                 )}>
                   {!isOnline ? 'Sin Conexión' : (isSyncing ? 'Sincronizando...' : 'Nube Conectada')}
                 </p>
                 <p className="text-[10px] text-sys-500 truncate mt-0.5">
                   {lastSync ? `Sync: ${lastSync.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : 'Sistema al día'}
                 </p>
               </div>
            </div>
        </div>
        <div className="mt-2 text-center">
            <p className="text-[10px] text-sys-300">v1.0.0 Stable</p>
        </div>
      </div>
    </aside>
  );
};