import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, ShoppingCart, Package, Settings, 
  FileText, Cloud, RefreshCw, LogOut, User, ShieldCheck, Wallet 
} from 'lucide-react';

import { cn } from '../core/utils/cn';
import { useAutoSync } from '../core/hooks/useAutoSync';
import { useAuthStore } from '../modules/auth/store/useAuthStore';

// Imports del Módulo de Caja
import { CashClosingModal } from '../modules/cash/components/CashClosingModal'; 
import { cashRepository } from '../modules/cash/repositories/cashRepository';

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

    // Cargar datos al abrir el modal
    useEffect(() => {
        if (isOpen) {
            const fetchShiftData = async () => {
                setLoading(true);
                try {
                    // Verificamos si existe el repositorio antes de llamar
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
  
  // ✅ Auth & Roles
  const { user, logout } = useAuthStore();
  
  // Determinamos si es Admin (Case Insensitive por seguridad)
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
        
        {/* Header */}
        <div className="p-6 border-b border-sys-100">
          <div className="flex flex-col gap-1 mb-4">
            <h1 className="text-xl font-bold text-sys-900 tracking-tight flex items-center gap-1">
              Noar<span className="text-brand">POS</span>
            </h1>
            <p className="text-[10px] uppercase tracking-wider text-sys-400 font-semibold">
              Resilense Enterprise
            </p>
          </div>

          {/* Tarjeta Usuario */}
          <div className="w-full text-left flex items-center gap-3 bg-sys-50 p-2.5 rounded-xl border border-sys-200">
              <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-white shadow-sm", isAdmin ? "bg-sys-900" : "bg-brand")}>
                 {isAdmin ? <ShieldCheck size={16} /> : <User size={16} />}
              </div>
              <div className="flex-1 min-w-0">
                 <p className="text-xs font-bold text-sys-800 truncate">{user?.name || user?.email}</p>
                 <p className="text-[10px] text-sys-500 truncate font-mono uppercase">{user?.role || 'Cajero'}</p>
              </div>
              <button 
                onClick={logout} 
                className="text-sys-400 hover:text-red-500 transition-colors p-1 rounded-lg hover:bg-sys-200" 
                title="Cerrar Sesión"
              >
                  <LogOut size={16} />
              </button>
          </div>
        </div>

        {/* Navegación */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
          
          <div className="px-4 py-2 text-xs font-semibold text-sys-400 uppercase tracking-wider mb-1">Operación</div>
          
          {/* Accesible para TODOS (Cajeros y Admins) */}
          <MenuLink to="/" icon={LayoutDashboard} label="Dashboard" />
          <MenuLink to="/pos" icon={ShoppingCart} label="Punto de Venta" />
          <MenuLink to="/sales" icon={FileText} label="Ventas" />

          {/* Accesible SOLO ADMIN */}
          {isAdmin && (
            <div className="animate-in slide-in-from-left-4 fade-in duration-300">
                <div className="px-4 py-2 text-xs font-semibold text-sys-400 uppercase tracking-wider mt-6 mb-1">Gestión & Control</div>
                {/* 🔥 LINK AGREGADO: Control de Caja */}
                <MenuLink to="/cash" icon={Wallet} label="Control de Caja" />
                <MenuLink to="/inventory" icon={Package} label="Inventario" />
                <MenuLink to="/settings" icon={Settings} label="Configuración" />
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-sys-100 bg-sys-50/50 space-y-3">
          
          {/* Botón Acción Crítica: Cerrar Turno */}
          <button 
            onClick={() => setIsCloseModalOpen(true)}
            className="w-full flex items-center justify-center gap-2 bg-white border border-red-200 text-red-600 hover:bg-red-50 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm active:scale-95 group"
          >
             <LogOut size={16} className="group-hover:text-red-700" /> Cerrar Turno
          </button>

          {/* Estado Conexión */}
          <div className={cn("px-3 py-2 rounded-lg border flex items-center gap-2 text-xs transition-colors duration-300", !isOnline ? "bg-red-50 border-red-100 text-red-600" : "bg-white border-sys-200 text-sys-600")}>
             <div className={cn("w-2 h-2 rounded-full", !isOnline ? "bg-red-500" : isSyncing ? "bg-blue-500 animate-pulse" : "bg-green-500")} />
             <span className="font-medium truncate flex-1">
                {!isOnline ? 'Offline' : isSyncing ? 'Sincronizando...' : 'Sistema Online'}
             </span>
             {isSyncing ? <RefreshCw size={12} className="animate-spin text-brand"/> : <Cloud size={12}/>}
          </div>
        </div>
      </aside>

      {/* Modal de Cierre Conectado */}
      <CloseShiftModalWrapper 
        isOpen={isCloseModalOpen} 
        onClose={() => setIsCloseModalOpen(false)} 
      />
    </>
  );
};