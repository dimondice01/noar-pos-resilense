import { create } from 'zustand';

export const useUiStore = create((set) => ({
  sidebarCollapsed: false,
  setSidebarCollapsed: (val) => set({ sidebarCollapsed: val }),
}));
