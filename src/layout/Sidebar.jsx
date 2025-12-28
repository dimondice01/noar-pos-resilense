import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, ShoppingCart, Package, Settings, 
  FileText, Cloud, RefreshCw, LogOut, User, ShieldCheck, Wallet,
  Users, Lock, ArrowRight, X, Loader2, Plug // 🆕 Importamos Plug
} from 'lucide-react';

import { cn } from '../core/utils/cn';
import { useAutoSync } from '../core/hooks/useAutoSync';
import { useAuthStore } from '../modules/auth/store/useAuthStore';
import { securityService } from '../modules/security/services/securityService';

// Imports del Módulo de Caja
import { CashClosingModal } from '../modules/cash/components/CashClosingModal'; 
import { cashRepository } from '../modules/cash/repositories/cashRepository';

// Importamos el logo
import logoEmpresa from '../assets/logo.png'; 

// ============================================================================
// 1. COMPONENTE HELPER: ENLACE DE MENÚ (Híbrido Link/Botón)
// ============================================================================
const MenuLink = ({ to, icon: Icon, label, onClick, isRestricted }) => {
  const location = useLocation();
  const isActiveRoute = location.pathname === to;

  const baseClasses = cn(
    "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group relative text-left outline-none focus:ring-2 focus:ring-brand/20",
    isActiveRoute 
      ? "bg-brand-light text-brand font-semibold shadow-sm" 
      : "text-sys-500 hover:bg-sys-100 hover:text-sys-900"
  );

  const content = (
    <>
      <Icon className="w-5 h-5" />
      <span className="flex-1">{label}</span>
      {isActiveRoute && (
        <div className="absolute right-2 w-1.5 h-1.5 rounded-full bg-brand" />
      )}
      {isRestricted && !isActiveRoute && (
        <Lock size={14} className="text-sys-300 group-hover:text-sys-400 transition-colors" />
      )}
    </>
  );

  // Si hay onClick, actuamos como botón (interceptor)
  if (onClick) {
    return (
      <button onClick={onClick} className={baseClasses}>
        {content}
      </button>
    );
  }

  // Si no, enlace normal
  return (
    <NavLink to={to} className={({ isActive }) => cn(baseClasses, isActive ? "" : "")}>
      {content}
    </NavLink>
  );
};

// ============================================================================
// 2. COMPONENTE: MODAL PIN ELEGANTE (CORREGIDO)
// ============================================================================
const PinRequestModal = ({ isOpen, onClose, onSuccess }) => {
    const [pin, setPin] = useState('');
    const [error, setError] = useState(false);
    const [verifying, setVerifying] = useState(false); // Estado de carga
    const inputRef = useRef(null);

    // Auto-focus y limpieza al abrir
    useEffect(() => {
        if (isOpen) {
            setPin('');
            setError(false);
            setVerifying(false);
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (verifying) return; // Evitar doble submit

        setVerifying(true);
        setError(false);

        try {
            // 🔥 Verificación robusta (espera a la promesa)
            const isValid = await securityService.verifyMasterPin(pin);
            
            if (isValid === true) {
                // Si es correcto, ejecutamos éxito
                onSuccess();
                // Nota: El cierre lo maneja el padre tras onSuccess
            } else {
                // Si es incorrecto
                setError(true);
                setPin('');
                setTimeout(() => inputRef.current?.focus(), 50);
            }
        } catch (err) {
            console.error("Error validando PIN:", err);
            alert("Error de conexión al validar el PIN.");
        } finally {
            setVerifying(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-sys-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden transform transition-all scale-100">
                <div className="p-5 flex justify-between items-center border-b border-sys-100">
                    <h3 className="font-bold text-sys-800 flex items-center gap-2">
                        <ShieldCheck size={18} className="text-brand"/> Acceso Admin
                    </h3>
                    <button onClick={onClose} className="text-sys-400 hover:text-sys-600"><X size={18}/></button>
                </div>
                
                <form onSubmit={handleSubmit} className="p-6">
                    <p className="text-xs text-sys-500 mb-4">Esta sección requiere autorización. Ingrese el PIN Maestro.</p>
                    
                    <div className="relative mb-4">
                        <input 
                            ref={inputRef}
                            type="password" 
                            autoComplete="off"
                            className={cn(
                                "w-full text-center text-2xl font-black tracking-widest py-3 rounded-xl border-2 outline-none transition-all placeholder:text-2xl placeholder:tracking-normal",
                                error 
                                    ? "border-red-300 bg-red-50 text-red-600 focus:border-red-500 focus:ring-4 focus:ring-red-500/10 animate-shake" 
                                    : "border-sys-200 bg-sys-50 text-sys-900 focus:border-brand focus:bg-white"
                            )}
                            placeholder="••••"
                            maxLength={6}
                            value={pin}
                            onChange={(e) => { setError(false); setPin(e.target.value.replace(/\D/g, '')); }}
                        />
                    </div>

                    <button 
                        type="submit" 
                        disabled={pin.length < 4 || verifying}
                        className={cn(
                            "w-full py-3 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2 shadow-lg",
                            verifying ? "bg-sys-600" : "bg-sys-900 hover:bg-black shadow-sys-900/20"
                        )}
                    >
                        {verifying ? (
                            <>Verificando <Loader2 size={16} className="animate-spin"/></>
                        ) : (
                            <>Autorizar <ArrowRight size={16}/></>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};

// ============================================================================
// 3. COMPONENTE WRAPPER: LÓGICA DE CIERRE DE CAJA
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
// 4. COMPONENTE PRINCIPAL: SIDEBAR
// ============================================================================
export const Sidebar = () => {
  const { isSyncing } = useAutoSync(15000);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  // Modales
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  
  // Ruta pendiente de autorización
  const [pendingRoute, setPendingRoute] = useState(null);

  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  
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

  // 🔥 LÓGICA DE NAVEGACIÓN PROTEGIDA
  const handleRestrictedNavigation = (route) => {
      if (isAdmin) {
          // Si es admin, pase usted
          navigate(route);
      } else {
          // Si es cajero, guardamos la ruta y abrimos modal
          setPendingRoute(route);
          setIsPinModalOpen(true);
      }
  };

  // Callback de éxito
  const handlePinSuccess = () => {
      // 1. Cerramos el modal primero
      setIsPinModalOpen(false);
      
      // 2. Si hay ruta pendiente, navegamos
      if (pendingRoute) {
          navigate(pendingRoute);
          setPendingRoute(null);
      }
  };

  return (
    <>
      <aside className="w-64 h-screen bg-white border-r border-sys-200 flex flex-col fixed left-0 top-0 z-20 hidden md:flex shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
        
        {/* Header */}
        <div className="p-6 border-b border-sys-100 flex flex-col items-center text-center">
          <div className="w-20 h-20 mb-3 bg-white rounded-full flex items-center justify-center overflow-hidden border border-sys-100 shadow-sm p-2">
              <img 
                 src={logoEmpresa} 
                 alt="Logo" 
                 className="w-full h-full object-contain"
                 onError={(e) => { e.target.style.display = 'none'; }}
              />
              <span className="text-xs font-bold text-sys-300 absolute -z-10">Logo</span>
          </div>

          <div className="flex flex-col gap-0.5">
            <h1 className="text-lg font-black text-sys-900 tracking-tight leading-none">MAXI KIOSCO</h1>
            <p className="text-sm font-bold text-blue-600 font-serif italic tracking-wide">La Esquina</p>
          </div>

          {/* Tarjeta Usuario */}
          <div className="w-full text-left flex items-center gap-2.5 bg-sys-50 p-2 rounded-xl border border-sys-200 mt-5">
              <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-white shadow-sm shrink-0", isAdmin ? "bg-sys-900" : "bg-brand")}>
                  {isAdmin ? <ShieldCheck size={14} /> : <User size={14} />}
              </div>
              <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-sys-800 truncate leading-tight">{user?.name || user?.email}</p>
                  <p className="text-[9px] text-sys-500 truncate font-mono uppercase leading-tight">{user?.role || 'Cajero'}</p>
              </div>
              <button onClick={logout} className="text-sys-400 hover:text-red-500 transition-colors p-1 rounded-lg hover:bg-sys-200" title="Cerrar Sesión">
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

          {/* SECCIÓN GESTIÓN */}
          <div className="mt-6 mb-1">
             <div className="px-4 py-2 text-xs font-semibold text-sys-400 uppercase tracking-wider">
                Gestión
             </div>
             
             {/* 1. INVENTARIO (Visible Todos - Protegido PIN) */}
             <MenuLink 
                to="/inventory" // Para que se marque activo si ya estamos ahí
                label="Inventario" 
                icon={Package} 
                onClick={() => handleRestrictedNavigation('/inventory')}
                isRestricted={!isAdmin} 
             />

             {/* 2. CAJA Y CONFIG (Solo Admin - Ocultos para Cajero) */}
             {isAdmin && (
                <div className="animate-in slide-in-from-left-4 fade-in duration-300 space-y-1 mt-1">
                    <MenuLink to="/cash" icon={Wallet} label="Control de Caja" />
                    {/* 🆕 NUEVO ENLACE: INTEGRACIONES (SaaS) */}
                    <MenuLink to="/settings/integrations" icon={Plug} label="Integraciones" />
                    <MenuLink to="/settings" icon={Settings} label="Configuración" />
                </div>
             )}
          </div>
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

      {/* Modal PIN Elegante */}
      <PinRequestModal 
        isOpen={isPinModalOpen} 
        onClose={() => { setIsPinModalOpen(false); setPendingRoute(null); }}
        onSuccess={handlePinSuccess}
      />

      {/* Modal Cierre de Caja */}
      <CloseShiftModalWrapper 
        isOpen={isCloseModalOpen} 
        onClose={() => setIsCloseModalOpen(false)} 
      />
    </>
  );
};