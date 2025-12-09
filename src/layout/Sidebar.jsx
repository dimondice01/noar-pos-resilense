import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, ShoppingCart, Package, Settings, 
  FileText, Cloud, RefreshCw, LogOut, User, ShieldCheck, Wallet,
  Users 
} from 'lucide-react';

import { cn } from '../core/utils/cn';
import { useAutoSync } from '../core/hooks/useAutoSync';
import { useAuthStore } from '../modules/auth/store/useAuthStore';

// Imports del Módulo de Caja
import { CashClosingModal } from '../modules/cash/components/CashClosingModal'; 
import { cashRepository } from '../modules/cash/repositories/cashRepository';

// Importamos el logo
import logoEmpresa from '../assets/logo.png'; 

// ============================================================================
// COMPONENTE HELPER: ENLACE DE MENÚ
// ============================================================================
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

// ============================================================================
// COMPONENTE WRAPPER: LÓGICA DE CIERRE DE CAJA
// ============================================================================
const CloseShiftModalWrapper = ({ isOpen, onClose }) => {
    const [balance, setBalance] = useState(null);
    const [shift, setShift] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            const fetchShiftData = async () => {
                setLoading(true);
                try {
                    if (!cashRepository) {
                        console.warn("Módulo de Caja no implementado aún.");
                        onClose();
                        return;
                    }

                    const currentShift = await cashRepository.getCurrentShift();
                    if (currentShift) {
                        setShift(currentShift);
                        const currentBalance = await cashRepository.getShiftBalance(currentShift.id);
                        setBalance(currentBalance);
                    } else {
                        alert("No hay un turno abierto para cerrar.");
                        onClose();
                    }
                } catch (error) {
                    console.error("Error fetching shift data:", error);
                    alert("Error al cargar datos del turno.");
                    onClose();
                } finally {
                    setLoading(false);
                }
            };
            fetchShiftData();
        }
    }, [isOpen]);

    const handleConfirm = async (data) => {
        if (!shift || !balance) return;
        
        try {
            await cashRepository.closeShift(shift.id, {
                ...data,
                expectedCash: balance.totalCash,
                expectedDigital: balance.totalDigital 
            });
            
            alert("✅ Turno Cerrado Correctamente.");
            onClose();
            window.location.reload(); 
        } catch (e) {
            console.error(e);
            alert(`Error al cerrar turno: ${e.message}`);
        }
    };

    if (!isOpen) return null;
    if (loading || !balance) return null;

    return (
        <CashClosingModal 
            isOpen={isOpen} 
            onClose={onClose} 
            systemTotals={{ 
                totalCash: balance.totalCash, 
                totalDigital: balance.totalDigital 
            }}
            onConfirm={handleConfirm}
        />
    );
};

// ============================================================================
// COMPONENTE PRINCIPAL: SIDEBAR
// ============================================================================
export const Sidebar = () => {
  const { isSyncing } = useAutoSync(15000);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  
  const { user, logout } = useAuthStore();
  
  const isAdmin = user?.role?.toUpperCase() === 'ADMIN';

  useEffect(() => {
    const handleStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', handleStatus);
    window.addEventListener('offline', handleStatus);
    return () => {
      window.removeEventListener('online', handleStatus);
      window.removeEventListener('offline', handleStatus);
    };
  }, []);

  return (
    <>
      <aside className="w-64 h-screen bg-white border-r border-sys-200 flex flex-col fixed left-0 top-0 z-20 hidden md:flex shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
        
        {/* Header con Branding */}
        <div className="p-6 border-b border-sys-100 flex flex-col items-center text-center">
          
          {/* Logo del Cliente */}
          <div className="w-20 h-20 mb-3 bg-white rounded-full flex items-center justify-center overflow-hidden border border-sys-100 shadow-sm p-2">
              <img 
                 src={logoEmpresa} 
                 alt="Logo" 
                 className="w-full h-full object-contain"
                 onError={(e) => {
                     e.target.style.display = 'none'; // Si falla, ocultamos imagen
                 }}
              />
              {/* Fallback si no carga imagen */}
              <span className="text-xs font-bold text-sys-300 absolute -z-10">Logo</span>
          </div>

          <div className="flex flex-col gap-0.5">
            <h1 className="text-lg font-black text-sys-900 tracking-tight leading-none">
              MAXI KIOSCO
            </h1>
            <p className="text-sm font-bold text-blue-600 font-serif italic tracking-wide">
              La Esquina
            </p>
          </div>

          {/* Tarjeta Usuario (Compacta) */}
          <div className="w-full text-left flex items-center gap-2.5 bg-sys-50 p-2 rounded-xl border border-sys-200 mt-5">
              <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-white shadow-sm shrink-0", isAdmin ? "bg-sys-900" : "bg-brand")}>
                 {isAdmin ? <ShieldCheck size={14} /> : <User size={14} />}
              </div>
              <div className="flex-1 min-w-0">
                 <p className="text-[11px] font-bold text-sys-800 truncate leading-tight">{user?.name || user?.email}</p>
                 <p className="text-[9px] text-sys-500 truncate font-mono uppercase leading-tight">{user?.role || 'Cajero'}</p>
              </div>
              <button 
                onClick={logout} 
                className="text-sys-400 hover:text-red-500 transition-colors p-1 rounded-lg hover:bg-sys-200" 
                title="Cerrar Sesión"
              >
                  <LogOut size={14} />
              </button>
          </div>
        </div>

        {/* Navegación */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
          
          <div className="px-4 py-2 text-xs font-semibold text-sys-400 uppercase tracking-wider mb-1">Operación</div>
          
          <MenuLink to="/" icon={LayoutDashboard} label="Dashboard" />
          <MenuLink to="/pos" icon={ShoppingCart} label="Punto de Venta" />
          <MenuLink to="/sales" icon={FileText} label="Ventas" />
          <MenuLink to="/clients" icon={Users} label="Clientes" />

          {isAdmin && (
            <div className="animate-in slide-in-from-left-4 fade-in duration-300">
                <div className="px-4 py-2 text-xs font-semibold text-sys-400 uppercase tracking-wider mt-6 mb-1">Gestión & Control</div>
                <MenuLink to="/cash" icon={Wallet} label="Control de Caja" />
                <MenuLink to="/inventory" icon={Package} label="Inventario" />
                <MenuLink to="/settings" icon={Settings} label="Configuración" />
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-sys-100 bg-sys-50/50 space-y-3">
          
          <button 
            onClick={() => setIsCloseModalOpen(true)}
            className="w-full flex items-center justify-center gap-2 bg-white border border-red-200 text-red-600 hover:bg-red-50 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm active:scale-95 group"
          >
             <LogOut size={16} className="group-hover:text-red-700" /> Cerrar Turno
          </button>

          <div className={cn("px-3 py-2 rounded-lg border flex items-center gap-2 text-xs transition-colors duration-300", !isOnline ? "bg-red-50 border-red-100 text-red-600" : "bg-white border-sys-200 text-sys-600")}>
             <div className={cn("w-2 h-2 rounded-full", !isOnline ? "bg-red-500" : isSyncing ? "bg-blue-500 animate-pulse" : "bg-green-500")} />
             <span className="font-medium truncate flex-1">
                {!isOnline ? 'Offline' : isSyncing ? 'Sincronizando...' : 'Sistema Online'}
             </span>
             {isSyncing ? <RefreshCw size={12} className="animate-spin text-brand"/> : <Cloud size={12}/>}
          </div>
        </div>
      </aside>

      <CloseShiftModalWrapper 
        isOpen={isCloseModalOpen} 
        onClose={() => setIsCloseModalOpen(false)} 
      />
    </>
  );
};