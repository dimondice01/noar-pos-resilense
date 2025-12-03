import { create } from 'zustand';

export const useShiftStore = create((set) => ({
  currentUser: null,
  currentShift: null,

  // Acciones
  setSession: (user, shift) => set({ currentUser: user, currentShift: shift }),
  clearSession: () => set({ currentUser: null, currentShift: null }),
}));