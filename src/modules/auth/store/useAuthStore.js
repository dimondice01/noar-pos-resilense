import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAuthStore = create(
  persist(
    (set) => ({
      // Por defecto entramos como ADMIN para desarrollo. 
      // Cambia a 'CASHIER' para probar la vista restringida.
      user: {
        id: 'u1',
        name: 'Admin User',
        role: 'ADMIN' // Valores: 'ADMIN', 'CASHIER'
      },

      login: (userData) => set({ user: userData }),
      logout: () => set({ user: null }),
      
      // Helper para cambiar rol rápido (solo dev)
      toggleRole: () => set((state) => ({
        user: { 
            ...state.user, 
            role: state.user.role === 'ADMIN' ? 'CASHIER' : 'ADMIN',
            name: state.user.role === 'ADMIN' ? 'Cajero Juan' : 'Gerente Ana'
        }
      }))
    }),
    {
      name: 'auth-storage',
    }
  )
);