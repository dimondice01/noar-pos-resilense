import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar'; 

// ✅ Stores
import { useAuthStore } from '../modules/auth/store/useAuthStore';
import { useShiftStore } from '../modules/cash/store/useShiftStore'; // 👈 USAMOS EL TUYO

// 🔥 Firebase
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../database/firebase';

export const MainLayout = () => {
  const { user, loading } = useAuthStore();
  
  // 👇 AQUÍ ADAPTAMOS A TU STORE
  // Verifica si en tu store se llama 'activeShift', 'currentShift' o similar.
  // Y si la función es 'setShift', 'setActiveShift', etc.
  const { activeShift, setActiveShift } = useShiftStore(); 

  // =================================================================
  // 🔄 EFECTO DE REHIDRATACIÓN (Recuperar Turno al Recargar F5)
  // =================================================================
  useEffect(() => {
    const restoreShiftSession = async () => {
      // 1. Validaciones iniciales
      if (!user || !user.companyId) return;

      // 2. Si ya tenemos el turno en memoria, no hacemos nada.
      if (activeShift) return;

      try {
        // 3. Consultamos Firebase: "¿Hay turnos ABIERTOS?"
        // Asegúrate que la colección sea 'shifts' o 'cash_registers' según tu base de datos
        const q = query(
          collection(db, 'companies', user.companyId, 'shifts'), // 👈 Revisa si tu colección es 'shifts'
          where('userId', '==', user.uid),
          where('status', '==', 'open'),
          limit(1)
        );

        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const docData = snapshot.docs[0].data();
          const shiftId = snapshot.docs[0].id;

          console.log(`✅ [MainLayout] Turno Recuperado: ${shiftId}`);
          
          // 4. Restauramos el estado global
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
      return <div className="min-h-screen bg-sys-50" />; 
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