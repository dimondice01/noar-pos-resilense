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
  WifiOff, 
  History, 
  LogOut, 
  User,
  Wallet 
} from 'lucide-react';

import { cn } from '../core/utils/cn';
import { useAutoSync } from '../core/hooks/useAutoSync';
import { useShiftStore } from '../modules/cash/store/useShiftStore';
import { CloseShiftModal } from '../modules/cash/components/CloseShiftModal';

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
  
  // Estado del usuario y modal de cierre
  const { currentUser } = useShiftStore(); 
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);

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
    <>
      <aside className="w-64 h-screen bg-white border-r border-sys-200 flex flex-col fixed left-0 top-0 z-20 hidden md:flex shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
        
        {/* Header con Info de Usuario */}
        <div className="p-6 border-b border-sys-100">
          <div className="flex flex-col gap-1 mb-4">
            <h1 className="text-xl font-bold text-sys-900 tracking-tight flex items-center gap-1">
              Noar<span className="text-brand">POS</span>
            </h1>
            <p className="text-[10px] uppercase tracking-wider text-sys-400 font-semibold">
              Resilense Argentina
            </p>
          </div>

          {/* Tarjeta de Usuario Logueado */}
          <div className="flex items-center gap-3 bg-sys-50 p-2.5 rounded-xl border border-sys-200">
             <div className="w-8 h-8 rounded-full bg-brand/10 text-brand flex items-center justify-center">
                <User size={16} />
             </div>
             <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-sys-800 truncate">{currentUser?.name || 'Operador'}</p>
                <p className="text-[10px] text-sys-500 truncate">{currentUser?.role === 'MANAGER' ? 'Gerente' : 'Cajero'}</p>
             </div>
          </div>
        </div>

        {/* Navegación */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
          <div className="px-4 py-2 text-xs font-semibold text-sys-400 uppercase tracking-wider mb-1">
            Operación
          </div>
          <MenuLink to="/" icon={LayoutDashboard} label="Dashboard" />
          <MenuLink to="/pos" icon={ShoppingCart} label="Punto de Venta" />
          <MenuLink to="/sales" icon={FileText} label="Ventas & Caja" />
          <MenuLink to="/sales" icon={FileText} label="Ventas" />
<MenuLink to="/cash" icon={Wallet} label="Control Caja" />
          
          <div className="px-4 py-2 text-xs font-semibold text-sys-400 uppercase tracking-wider mt-6 mb-1">
            Gestión
          </div>
          <MenuLink to="/inventory" icon={Package} label="Inventario" />
          <MenuLink to="/inventory/movements" icon={History} label="Movimientos" />
          <MenuLink to="/settings" icon={Settings} label="Configuración" />
        </nav>

        {/* Footer: Botón Cerrar Caja + Estado */}
        <div className="p-4 border-t border-sys-100 bg-sys-50/50 space-y-3">
          
          {/* Botón Cerrar Caja */}
          <button 
            onClick={() => setIsCloseModalOpen(true)}
            className="w-full flex items-center justify-center gap-2 bg-white border border-red-200 text-red-600 hover:bg-red-50 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm active:scale-95"
          >
             <LogOut size={16} /> Cerrar Caja
          </button>

          {/* Estado Conexión */}
          <div className={cn("px-3 py-2 rounded-lg border flex items-center gap-2 text-xs", !isOnline ? "bg-red-50 border-red-100 text-red-600" : "bg-white border-sys-200 text-sys-600")}>
             <div className={cn("w-2 h-2 rounded-full", !isOnline ? "bg-red-500" : isSyncing ? "bg-blue-500 animate-pulse" : "bg-green-500")} />
             <span className="font-medium truncate flex-1">
                {!isOnline ? 'Offline' : isSyncing ? 'Sincronizando...' : 'Conectado'}
             </span>
             {isSyncing ? <RefreshCw size={12} className="animate-spin"/> : <Cloud size={12}/>}
          </div>
        </div>
      </aside>

      {/* Modal Cierre */}
      <CloseShiftModal 
        isOpen={isCloseModalOpen} 
        onClose={() => setIsCloseModalOpen(false)} 
      />
    </>
  );
};