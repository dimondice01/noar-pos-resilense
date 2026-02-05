import React, { useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar'; 

// ✅ Stores
import { useAuthStore } from '../modules/auth/store/useAuthStore';
import { useShiftStore } from '../modules/cash/store/useShiftStore';

// 🔥 SERVICIOS (Motor de Sincronización)
import { syncService } from '../modules/sync/services/syncService';

// 🔥 Firebase (Para rehidratación de turno)
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../database/firebase';

export const MainLayout = () => {
  const { user, loading, activeBranchId } = useAuthStore();
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
    };
  }, [user, loading, activeBranchId]); // Se reinicia si cambia el usuario o la sucursal


  // =================================================================
  // 🔄 2. EFECTO DE REHIDRATACIÓN (Recuperar Turno al Recargar F5)
  // =================================================================
  useEffect(() => {
    const restoreShiftSession = async () => {
      // Validaciones iniciales
      if (!user || !user.companyId) return;

      // Si ya tenemos el turno en memoria RAM, no molestamos a la base de datos.
      if (activeShift) return;

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

  return (
    <div className="min-h-screen bg-sys-50 flex">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 transition-all duration-300">
        <div className="max-w-7xl mx-auto">
            <Outlet />
        </div>
      </main>
    </div>
  );
};