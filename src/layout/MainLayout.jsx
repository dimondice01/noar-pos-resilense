import React, { useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar'; 
import { ShieldAlert } from 'lucide-react';

// ✅ Stores
import { useAuthStore } from '../modules/auth/store/useAuthStore';
import { useUiStore } from '../core/store/useUiStore';
import { cn } from '../core/utils/cn';
import { useShiftStore } from '../modules/cash/store/useShiftStore';

// 🔥 SERVICIOS (Motor de Sincronización)
import { syncService } from '../modules/sync/services/syncService';

// 🔥 Firebase (Para rehidratación de turno)
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../database/firebase';

export const MainLayout = () => {
  const { user, loading, activeBranchId } = useAuthStore();
  const { sidebarCollapsed } = useUiStore();
  const { activeShift, setActiveShift } = useShiftStore(); 
  
  // Ref para guardar la función de desuscripción de manera persistente y mutable
  const unsubscribeInventoryRef = useRef(null);

  // =================================================================
  // 🚀 1. MOTOR DE SINCRONIZACIÓN (Local-First ASÍNCRONO BLINDADO)
  // =================================================================
  useEffect(() => {
    let isMounted = true; // Flag para evitar race conditions

    const initSystem = async () => {
        // Solo arrancamos si tenemos usuario y empresa
        if (user?.companyId) {
            
            // A. Sincronización "Pesada" (Productos, Maestros)
            // Se ejecuta UNA vez al montar. Descarga solo lo nuevo.
            try {
                await syncService.syncProducts(user.companyId);
            } catch (e) { console.warn("Error sync products:", e); }

            // B2. Listeners de tiempo real (config, productos, ventas)
            // Se llama aquí en lugar de App.jsx para evitar la race condition
            // de StrictMode + SubscriptionGuard que disparaban 4 llamadas simultáneas.
            syncService.startRealTimeListeners(user.companyId);

            // B. Sincronización "Real-Time" (Inventario de Sucursal)
            // Esto mantiene el stock vivo para el cajero.
            if (activeBranchId && activeBranchId !== 'ALL') {
                console.log(`📡 Conectando inventario para branch: ${activeBranchId}`);
                
                // Limpiamos listener previo si existiera (por si acaso)
                if (typeof unsubscribeInventoryRef.current === 'function') {
                    unsubscribeInventoryRef.current();
                    unsubscribeInventoryRef.current = null;
                }

                // Iniciamos nuevo listener (que devuelve una Promesa)
                const unsub = await syncService.startInventoryListener(user.companyId, activeBranchId);
                
                // Solo asignamos si el componente sigue montado
                if (isMounted && typeof unsub === 'function') {
                    unsubscribeInventoryRef.current = unsub;
                } else if (typeof unsub === 'function') {
                    // Si se desmontó mientras esperábamos, limpiamos inmediatamente
                    unsub();
                }
            }
        }
    };

    if (!loading) {
        initSystem();
    }

    // Limpieza al desmontar o cambiar de sucursal
    return () => {
        isMounted = false; // Invalidamos la promesa pendiente
        if (typeof unsubscribeInventoryRef.current === 'function') {
            console.log("🔕 Desconectando inventario...");
            unsubscribeInventoryRef.current();
            unsubscribeInventoryRef.current = null;
        }
        // Limpiamos también los listeners de startRealTimeListeners (config, productos, ventas)
        syncService.stopListeners();
    };
  }, [user, loading, activeBranchId]); // Se reinicia si cambia el usuario o la sucursal


  // =================================================================
  // 🔄 2. EFECTO DE REHIDRATACIÓN (Recuperar Turno al Recargar F5)
  // =================================================================
  useEffect(() => {
    const restoreShiftSession = async () => {
      // Validaciones iniciales
      if (!user || !user.companyId) return;

      // 🔥 FIX: activeShift persiste en localStorage sin importar qué usuario lo
      // abrió. Antes esto solo chequeaba "¿hay algo en RAM?" — si el cajero
      // anterior no cerró sesión limpio (o el logout no alcanzó a limpiar el
      // store), el usuario nuevo heredaba el turno de otro y vendía sobre él sin
      // darse cuenta. Ahora solo confiamos en el turno cacheado si es del usuario
      // que está logueado ahora mismo.
      if (activeShift && activeShift.userId === user.uid) return;
      if (activeShift && activeShift.userId !== user.uid) {
          useShiftStore.getState().clearShift();
      }

      try {
        // Consultamos Firebase: "¿Hay turnos ABIERTOS para este usuario?"
        const q = query(
          collection(db, 'companies', user.companyId, 'shifts'),
          where('userId', '==', user.uid),
          where('status', '==', 'OPEN'), // Asegúrate que en DB guardes 'OPEN' o 'open'
          limit(1)
        );

        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const docData = snapshot.docs[0].data();
          const shiftId = snapshot.docs[0].id;

          console.log(`✅ [MainLayout] Turno Recuperado: ${shiftId}`);
          
          // Restauramos el estado global
          setActiveShift({
            id: shiftId,
            ...docData
          });
        }
      } catch (error) {
        console.error("❌ Error recuperando turno:", error);
      }
    };

    if (!loading) {
        restoreShiftSession();
    }
  }, [user, loading, activeShift, setActiveShift]);


  // =================================================================
  // 🎨 RENDERIZADO
  // =================================================================
  
  if (loading) {
      return <div className="min-h-screen bg-sys-50 flex items-center justify-center text-sys-400">Cargando sistema...</div>; 
  }

  // 🚨 CAPA DE SEGURIDAD 2: BLOQUEO RADICAL DE LAYOUT
  // Si el usuario llega hasta aquí pero su empresa está marcada como EXPIRED en el objeto user, bloqueamos todo.
  if (user?.subscriptionStatus === 'EXPIRED') {
      return (
        <div className="fixed inset-0 z-[9999] bg-white flex items-center justify-center p-8">
            <div className="max-w-md text-center">
                <div className="w-20 h-20 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <ShieldAlert className="text-red-600" size={40} />
                </div>
                <h1 className="text-2xl font-black text-sys-900 mb-2">SISTEMA SUSPENDIDO</h1>
                <p className="text-sys-500 font-bold mb-8">Por favor, contacte a su asesor para regularizar su situación.</p>
                <button 
                    onClick={() => window.location.replace('/plan-expired')}
                    className="w-full py-4 bg-sys-900 text-white rounded-xl font-black uppercase tracking-widest hover:bg-black transition-colors"
                >
                    Ir a Pagos
                </button>
            </div>
        </div>
      );
  }

  return (
    <div className="min-h-screen bg-sys-50 flex">
      <Sidebar />
      <main className={cn("flex-1 p-4 md:p-8 transition-all duration-300", sidebarCollapsed ? "md:ml-16" : "md:ml-64")}>
        <div className="max-w-7xl mx-auto">
            <Outlet />
        </div>
      </main>
    </div>
  );
};