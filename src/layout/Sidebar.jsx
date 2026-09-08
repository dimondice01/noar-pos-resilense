import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation, useParams } from 'react-router-dom'; 
import {
    LayoutDashboard, ShoppingCart, Package, Settings,
    FileText, Cloud, RefreshCw, LogOut, User, ShieldCheck, Wallet,
    Users, Lock, KeyRound, Loader2, Plug,
    Building, Truck, Unlock, ChevronLeft, ChevronRight
} from 'lucide-react';

import { cn } from '../core/utils/cn';
import { useUiStore } from '../core/store/useUiStore';
import { useAutoSync } from '../core/hooks/useAutoSync';
import { useAuthStore } from '../modules/auth/store/useAuthStore';
import { PinAuthModal } from '../modules/security/components/PinAuthModal';
import { ChangePasswordModal } from '../modules/auth/components/ChangePasswordModal';
import { hasPermission } from '../modules/settings/config/permissions';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../database/firebase';

// 🔥 REPOSITORIOS LOCALES
import { getDB } from '../database/db'; 
import { CashClosingModal } from '../modules/cash/components/CashClosingModal';
import { cashRepository } from '../modules/cash/repositories/cashRepository';
import { syncService } from '../modules/sync/services/syncService';
import { useShiftStore } from '../modules/cash/store/useShiftStore';

import defaultLogo from '../assets/logo.png'; 

// ============================================================================
// 1. COMPONENTE HELPER: ENLACE DE MENÚ
// ============================================================================
const MenuLink = ({ to, icon: Icon, label, onClick, isRestricted }) => {
    const location = useLocation();
    const { sidebarCollapsed } = useUiStore();
    const isActiveRoute = location.pathname === to;

    const baseClasses = cn(
        "w-full flex items-center gap-3 rounded-xl transition-all duration-base group relative text-left outline-none focus:ring-2 focus:ring-brand/30",
        sidebarCollapsed ? "justify-center px-2 py-3" : "px-4 py-3",
        isActiveRoute
            ? "bg-sys-800/60 text-white font-semibold border-l-2 border-brand"
            : "text-sys-400 hover:bg-sys-800/40 hover:text-white"
    );

    const content = (
        <>
            <Icon className="w-5 h-5 shrink-0" />
            {!sidebarCollapsed && <span className="flex-1 text-sm">{label}</span>}
            {!sidebarCollapsed && isActiveRoute && (
                <div className="w-1.5 h-1.5 rounded-full bg-brand" />
            )}
            {!sidebarCollapsed && isRestricted && !isActiveRoute && (
                <Lock size={14} className="text-sys-600 group-hover:text-sys-400 transition-colors" />
            )}
        </>
    );

    if (onClick) {
        return (
            <button onClick={onClick} className={baseClasses}>
                {content}
            </button>
        );
    }

    return (
        <NavLink to={to} className={({ isActive }) => cn(baseClasses, isActive ? "" : "")}>
            {content}
        </NavLink>
    );
};

// ============================================================================
// 2. WRAPPER CIERRE CAJA
// ============================================================================
const CloseShiftModalWrapper = ({ isOpen, onClose, onShiftClosed }) => {
    const { user, activeBranchId } = useAuthStore();
    const [balance, setBalance] = useState(null);
    const [shift, setShift] = useState(null);
    const [loading, setLoading] = useState(false);
    const [processing, setProcessing] = useState(false);

    useEffect(() => {
        if (isOpen) {
            const fetchShiftData = async () => {
                setLoading(true);
                try {
                    // 🔥 Refrescar shift + cash_movements desde la nube ANTES de calcular el balance.
                    // Evita que el cierre se calcule con datos locales desactualizados (ej: initialAmount
                    // corregido por un admin, o movimientos manuales cargados desde otro dispositivo).
                    if (navigator.onLine && user?.companyId) {
                        try {
                            const dbLocal = await getDB();
                            // Timeout corto: en redes lentas/inestables no debe bloquear el cierre.
                            // Si no llega a tiempo, seguimos con lo que ya haya en Dexie (igual que offline).
                            await Promise.race([
                                Promise.all([
                                    cashRepository._fetchHistoryFromCloud(dbLocal, user),
                                    syncService.syncInitialCashMovements(user.companyId, activeBranchId)
                                ]),
                                new Promise((resolve) => setTimeout(resolve, 6000))
                            ]);
                        } catch (syncErr) {
                            console.warn("No se pudo refrescar caja desde la nube antes de cerrar:", syncErr);
                        }
                    }

                    const currentShift = await cashRepository.getCurrentShift();
                    if (currentShift) {
                        setShift(currentShift);
                        const currentBalance = await cashRepository.getShiftBalance(currentShift.id);
                        setBalance(currentBalance);
                    } else {
                        alert("⚠️ No hay un turno abierto para cerrar.");
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

    // 🔥 Si otro dispositivo cerró este mismo turno primero (carrera de cierre),
    // avisar y salir en vez de dejar que el usuario siga operando sobre un cierre fantasma.
    useEffect(() => {
        const onCloseConflict = (e) => {
            if (!isOpen || !shift || e.detail?.shiftId !== shift.id) return;
            alert("⚠️ Este turno ya fue cerrado desde otro dispositivo. Se sincronizó el cierre real.");
            useShiftStore.getState().clearShift();
            onClose();
        };
        window.addEventListener('noar:shift-close-conflict', onCloseConflict);
        return () => window.removeEventListener('noar:shift-close-conflict', onCloseConflict);
    }, [isOpen, shift, onClose]);

    const handleConfirm = async (data) => {
        if (!shift || processing) return;
        setProcessing(true); 
        try {
            await cashRepository.closeShift(shift.id, data);
            alert("✅ Turno Cerrado Correctamente.");
            onClose();
            if (onShiftClosed) onShiftClosed();
        } catch (e) {
            console.error("Error closing shift:", e);
            alert(`Error al cerrar turno: ${e.message}`);
        } finally {
            setProcessing(false);
        }
    };

    if (!isOpen) return null;
    if (loading || processing) return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm">
            <div className="bg-white p-8 rounded-2xl shadow-2xl flex flex-col items-center gap-4 animate-in zoom-in-95">
                <Loader2 size={40} className="animate-spin text-brand"/>
                <div className="text-center">
                    <p className="text-lg font-bold text-sys-900">{processing ? "Cerrando Turno..." : "Calculando Balance..."}</p>
                    <p className="text-xs text-sys-500 mt-1">Sincronizando operaciones...</p>
                </div>
            </div>
        </div>
    );
    if (!balance) return null;

    return (
        <CashClosingModal 
            isOpen={isOpen} 
            onClose={onClose} 
            systemTotals={{ totalCash: balance.totalCash, totalDigital: balance.totalDigital }}
            onConfirm={handleConfirm}
        />
    );
};

// ============================================================================
// 4. COMPONENTE PRINCIPAL: SIDEBAR
// ============================================================================
export const Sidebar = () => {
    const { sidebarCollapsed, setSidebarCollapsed } = useUiStore();
    const { isSyncing } = useAutoSync(15000);
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    
    const [hasActiveShift, setHasActiveShift] = useState(false);
    const [checkingShift, setCheckingShift] = useState(true);

    const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
    const [isPinModalOpen, setIsPinModalOpen] = useState(false);
    const [pendingRoute, setPendingRoute] = useState(null);
    const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

    const { user, logout, activeBranchId, switchBranch } = useAuthStore();
    const navigate = useNavigate();
    const { companySlug } = useParams(); 
    
    // ROLES DEFINIDOS
    const isOwner = user?.role === 'OWNER';
    const isAdmin = user?.role === 'ADMIN';
    const canManage = isOwner || isAdmin;
    // Cajero con cualquiera de los permisos de inventario puede entrar sin PIN
    const canAccessInventory = canManage
        || hasPermission(user, 'canAddStock')
        || hasPermission(user, 'canRemoveStock')
        || hasPermission(user, 'canChangePrices');

    const [companyInfo, setCompanyInfo] = useState({ 
        name: 'MI NEGOCIO', 
        logo: defaultLogo,
        subscriptionStatus: 'ACTIVE' 
    });

    const getLink = (path) => {
        const root = companySlug || user?.companyId; 
        if (!path) return `/${root}`; 
        return `/${root}/${path}`;
    };

    const handleLogout = async () => {
        const redirectSlug = companySlug || user?.companyId;
        await logout();
        navigate(`/login/${redirectSlug}`);
    };

    // --- MONITOREO DE CAJA ---
    const checkShiftStatus = async () => {
        if (!user) return;
        
        try {
            setCheckingShift(true); 
            
            // 🔥 AUTO-CONEXIÓN DE SUCURSAL PARA CAJEROS
            if (!activeBranchId && !isOwner && user.branchId) {
                console.log("🏪 [Sidebar] Auto-conectando sucursal del usuario...");
                switchBranch(user.branchId, "Mi Sucursal");
                // No retornamos aquí, dejamos que intente verificar el turno con el ID que ya tiene el user
            }
            
            const current = await cashRepository.getCurrentShift();
            setHasActiveShift(!!current);
        } catch (e) { 
            console.error("Error checkShiftStatus:", e); 
            setHasActiveShift(false);
        } finally {
            setCheckingShift(false);
        }
    };

    useEffect(() => {
        checkShiftStatus();
        const interval = setInterval(checkShiftStatus, 10000);
        return () => clearInterval(interval);
    }, [user, activeBranchId]); 

    // 🔥 ABRIR CAJA 
    const handleOpenShiftDirectly = async () => {
        const realBranchId = activeBranchId;
        
        if (!realBranchId || realBranchId === 'ALL') {
            alert("⚠️ Seleccione una sucursal específica para abrir caja.");
            navigate(getLink(''));
            return;
        }

        const input = prompt("Monto inicial en caja:", "1000");
        if (input === null) return;
        
        const amount = parseFloat(input);
        if (isNaN(amount) || amount < 0) return alert("Monto inválido");
        
        try {
            await cashRepository.openShift(amount, user?.name); 
            alert("✅ Caja abierta correctamente.");
            await checkShiftStatus();
        } catch (e) { 
            console.error("Error abriendo caja:", e);
            alert(`Error al abrir caja: ${e.message}`); 
        }
    };

    // 🔥 LECTURA DE LOGO Y NOMBRE LOCAL-FIRST (DEXIE)
    const loadLocalCompanyInfo = async () => {
        try {
            const dbLocal = await getDB();
            let configData = await dbLocal.config.get('company_info');
            
            // 📡 FALLBACK A NUBE: Si no hay info local, intentamos leer de Firestore (Doble Blindaje)
            if (!configData && user?.companyId && navigator.onLine) {
                const docRef = doc(db, 'companies', user.companyId);
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    const data = snap.data();
                    configData = { 
                        value: { 
                            name: data.name || 'MI NEGOCIO', 
                            logoUrl: data.logoUrl || null,
                            subscriptionStatus: data.subscriptionStatus || 'ACTIVE'
                        } 
                    };
                    // Guardamos localmente para la próxima
                    await dbLocal.config.put({ key: 'company_info', value: configData.value });
                }
            }

            if (configData && configData.value) {
                setCompanyInfo({
                    name: configData.value.name || 'MI NEGOCIO',
                    logo: configData.value.logoUrl || defaultLogo,
                    subscriptionStatus: configData.value.subscriptionStatus || 'ACTIVE'
                });
            }
        } catch (error) {
            console.warn("No se pudo cargar la configuración de la empresa:", error);
        }
    };

    useEffect(() => {
        // Carga inicial (Intentamos local y luego nube si falla)
        loadLocalCompanyInfo();
        
        // Polling silencioso
        const interval = setInterval(loadLocalCompanyInfo, 10000);
        return () => clearInterval(interval);
    }, [user?.companyId]); 

    useEffect(() => {
        const handleStatus = () => setIsOnline(navigator.onLine);
        window.addEventListener('online', handleStatus);
        window.addEventListener('offline', handleStatus);
        return () => {
            window.removeEventListener('online', handleStatus);
            window.removeEventListener('offline', handleStatus);
        };
    }, []);

    // Navegación Protegida (Inventario para cajeros)
    const handleRestrictedNavigation = (route) => {
        if (canAccessInventory) {
            navigate(route);
        } else {
            setPendingRoute(route);
            setIsPinModalOpen(true);
        }
    };

    const handlePinSuccess = () => {
        setIsPinModalOpen(false);
        if (pendingRoute) {
            navigate(pendingRoute);
            setPendingRoute(null);
        }
    };

    return (
        <>
            <aside className={cn("h-screen bg-sys-900 border-r border-sys-800/50 flex-col fixed left-0 top-0 z-20 shadow-[4px_0_24px_rgba(0,0,0,0.15)] transition-all duration-300 hidden md:flex", sidebarCollapsed ? "w-16" : "w-64")}>
                
                {/* Header */}
                <div className={cn("border-b border-sys-800/60 flex flex-col items-center text-center relative", sidebarCollapsed ? "p-3" : "p-6")}>
                    {/* Toggle button */}
                    <button
                        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                        className="absolute -right-3 top-6 w-6 h-6 bg-sys-800 border border-sys-700 rounded-full flex items-center justify-center text-sys-400 hover:text-white hover:bg-sys-700 transition-all z-30 shadow-md"
                        title={sidebarCollapsed ? "Expandir sidebar" : "Colapsar sidebar"}
                    >
                        {sidebarCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
                    </button>

                    <div className={cn("bg-white rounded-full flex items-center justify-center overflow-hidden border border-sys-100 shadow-sm p-2 relative", sidebarCollapsed ? "w-9 h-9" : "w-20 h-20 mb-3")}>
                        <img
                            src={companyInfo.logo}
                            alt="Logo"
                            className="w-full h-full object-contain"
                            onError={(e) => { e.target.src = defaultLogo; }}
                        />
                    </div>

                    {!sidebarCollapsed && (
                        <>
                            <div className="flex flex-col gap-0.5 w-full">
                                <h1 className="text-lg font-black text-white tracking-tight leading-none uppercase truncate px-2" title={companyInfo.name}>
                                    {companyInfo.name}
                                </h1>
                                <p className="text-xs font-bold text-brand-muted font-serif italic tracking-wide">
                                    Sistema POS
                                </p>
                            </div>

                            {/* User Card */}
                            <div className="w-full text-left flex items-center gap-2.5 bg-sys-800/60 p-2 rounded-xl border border-sys-700/50 mt-5">
                                <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-white shadow-sm shrink-0", isOwner ? "bg-purple-600" : isAdmin ? "bg-sys-900" : "bg-brand")}>
                                    {isOwner ? <ShieldCheck size={14} /> : <User size={14} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-bold text-white truncate leading-tight">{user?.name || user?.email}</p>
                                    <p className="text-[9px] text-sys-400 truncate font-mono uppercase leading-tight">{user?.role || 'Cajero'}</p>
                                </div>
                                <button onClick={() => setIsChangePasswordOpen(true)} className="text-sys-500 hover:text-brand transition-colors p-1 rounded-lg hover:bg-sys-700" title="Cambiar Contraseña">
                                    <KeyRound size={14} />
                                </button>
                                <button onClick={handleLogout} className="text-sys-500 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-sys-700" title="Cerrar Sesión">
                                    <LogOut size={14} />
                                </button>
                            </div>
                        </>
                    )}

                    {sidebarCollapsed && (
                        <button onClick={handleLogout} className="mt-2 text-sys-500 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-sys-700" title="Cerrar Sesión">
                            <LogOut size={13} />
                        </button>
                    )}
                </div>

                {/* Navigation */}
                <nav className="flex-1 p-4 space-y-1 overflow-y-auto sidebar-scroll">
                    
                    {/* 🔥 AVISO DE MORA / SUSPENSIÓN INMINENTE */}
                    {companyInfo.subscriptionStatus === 'PAST_DUE' && (
                        <div className="mb-6 p-4 bg-red-50 border-2 border-red-200 rounded-2xl animate-pulse shadow-lg shadow-red-100">
                             <div className="flex items-center gap-2 text-red-600 mb-1">
                                 <AlertTriangle size={20} className="shrink-0" />
                                 <span className="text-[10px] font-black uppercase tracking-widest">Aviso Importante</span>
                             </div>
                             <p className="text-xs font-black text-red-700 leading-tight">
                                 El servicio será suspendido a las 19hs por falta de pago.
                             </p>
                        </div>
                    )}

                    {!sidebarCollapsed && <div className="px-4 py-2 text-xs font-semibold text-sys-600 uppercase tracking-wider mb-1">Operación</div>}
                    
                    <MenuLink to={getLink('')} icon={LayoutDashboard} label="Principal" />
                    <MenuLink to={getLink('pos')} icon={ShoppingCart} label="Punto de Venta" />
                    <MenuLink to={getLink('sales')} icon={FileText} label="Ventas" />
                    <MenuLink to={getLink('clients')} icon={Users} label="Clientes" />
                    <MenuLink to={getLink('suppliers')} icon={Truck} label="Proveedores" />

                    {/* Gestión */}
                    <div className="mt-6 mb-1">
                        {!sidebarCollapsed && <div className="px-4 py-2 text-xs font-semibold text-sys-600 uppercase tracking-wider">Gestión</div>}
                        
                        <MenuLink 
                            to={getLink('inventory')}
                            label="Inventario" 
                            icon={Package} 
                            onClick={() => handleRestrictedNavigation(getLink('inventory'))}
                            isRestricted={!canAccessInventory}
                        />

                        {/* 🔥 MENÚS SOLO PARA ADMINS Y OWNERS */}
                        {canManage && (
                            <div className="animate-in slide-in-from-left-4 fade-in duration-300 space-y-1 mt-1">
                                <MenuLink to={getLink('cash')} icon={Wallet} label="Control de Caja" />
                                <MenuLink to={getLink('settings/integrations')} icon={Plug} label="Integraciones" />
                                <MenuLink to={getLink('settings/company')} icon={Building} label="Mi Empresa" />
                                <MenuLink to={getLink('settings')} icon={Settings} label="Configuración" />
                            </div>
                        )}
                    </div>
                </nav>

                {/* Footer: Smart Button */}
                <div className="p-4 border-t border-sys-800/60 bg-sys-800/30 space-y-3">
                    
                    {checkingShift ? (
                        <div className="w-full h-10 bg-sys-800/50 animate-pulse rounded-xl flex items-center justify-center">
                            {!sidebarCollapsed && <span className="text-xs text-sys-500">Verificando...</span>}
                        </div>
                    ) : hasActiveShift ? (
                        // 🔥 Cerrar caja ya no requiere estar online (rediseño 2026-09-08):
                        // el cálculo del cierre es 100% local, igual que cargar una venta.
                        // Offline, queda `syncStatus: 'pending'` y sincroniza sola después.
                        <button
                            onClick={() => setIsCloseModalOpen(true)}
                            title="Cerrar Turno"
                            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm group bg-sys-800 border border-red-900/40 text-red-400 hover:bg-red-900/20 active:scale-95 cursor-pointer"
                        >
                            {sidebarCollapsed ? <LogOut size={16} /> : <><LogOut size={16} className="group-hover:text-red-700" /> Cerrar Turno</>}
                        </button>
                    ) : (
                        <button
                            onClick={handleOpenShiftDirectly}
                            title="Abrir Turno"
                            className="w-full flex items-center justify-center gap-2 bg-green-600 border border-green-700 text-white hover:bg-green-700 py-2.5 rounded-xl text-sm font-bold transition-all shadow-md active:scale-95 group"
                        >
                            <Unlock size={16} />{!sidebarCollapsed && ' Abrir Turno'}
                        </button>
                    )}

                    {sidebarCollapsed ? (
                        <div className={cn("p-2 rounded-lg border flex items-center justify-center transition-colors duration-300", !isOnline ? "bg-red-900/20 border-red-900/40" : "bg-sys-800/40 border-sys-700/50")} title={!isOnline ? 'Offline' : isSyncing ? 'Sincronizando...' : 'Sistema Online'}>
                            <div className={cn("w-2 h-2 rounded-full", !isOnline ? "bg-red-500" : isSyncing ? "bg-blue-500 animate-pulse" : "bg-green-500")} />
                        </div>
                    ) : (
                        <div className={cn("px-3 py-2 rounded-lg border flex items-center gap-2 text-xs transition-colors duration-300", !isOnline ? "bg-red-900/20 border-red-900/40 text-red-400" : "bg-sys-800/40 border-sys-700/50 text-sys-400")}>
                            <div className={cn("w-2 h-2 rounded-full", !isOnline ? "bg-red-500" : isSyncing ? "bg-blue-500 animate-pulse" : "bg-green-500")} />
                            <span className="font-medium truncate flex-1">
                                {!isOnline ? 'Offline' : isSyncing ? 'Sincronizando...' : 'Sistema Online'}
                            </span>
                            {isSyncing ? <RefreshCw size={12} className="animate-spin text-brand"/> : <Cloud size={12}/>}
                        </div>
                    )}
                </div>
            </aside>

            {/* MODALES */}
            <PinAuthModal
                isOpen={isPinModalOpen}
                onClose={() => { setIsPinModalOpen(false); setPendingRoute(null); }}
                onSuccess={handlePinSuccess}
            />

            <ChangePasswordModal
                isOpen={isChangePasswordOpen}
                onClose={() => setIsChangePasswordOpen(false)}
            />

            <CloseShiftModalWrapper 
                isOpen={isCloseModalOpen} 
                onClose={() => setIsCloseModalOpen(false)} 
                onShiftClosed={() => {
                    setTimeout(() => checkShiftStatus(), 500); 
                }}
            />
        </>
    );
};