import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// =================================================================
// 🧠 STORE DE TURNOS (RAM + LOCAL STORAGE)
// =================================================================

export const useShiftStore = create(
  persist(
    (set, get) => ({
      // ESTADO INICIAL
      activeShift: null,

      // ✅ ACCIONES (Esto es lo que faltaba)
      
      // 1. Establecer turno activo (Usado por Login, MainLayout y Auto-Repair)
      setActiveShift: (shift) => {
          console.log("💾 [STORE] Turno actualizado en RAM:", shift?.id);
          set({ activeShift: shift });
      },

      // 2. Cerrar sesión de turno (Logout o Cierre Z)
      clearShift: () => {
          console.log("🔒 [STORE] Turno limpiado de RAM");
          set({ activeShift: null });
      },

      // 3. Helper para verificar estado rápido
      isOpen: () => {
          const s = get().activeShift;
          return s && s.status === 'OPEN';
      }
    }),
    {
      name: 'nexus-shift-storage', // Nombre único en localStorage
      // Opcional: Solo persistimos lo necesario
      partialize: (state) => ({ activeShift: state.activeShift }),
    }
  )
);