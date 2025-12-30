import { create } from 'zustand';
import { authService } from '../services/authService';

export const useAuthStore = create((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true, // Arrancamos cargando
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const user = await authService.login(email, password);
      set({ user, isAuthenticated: true, isLoading: false });
      return true;
    } catch (error) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await authService.logout();
      set({ user: null, isAuthenticated: false, isLoading: false });
    } catch (error) {
      console.error(error);
      set({ isLoading: false });
    }
  },

  initAuthListener: () => {
    console.log("🔌 Inicializando Auth Listener...");
    
    // Safety Timeout: Si Firebase se cuelga, liberamos la UI en 4s
    const safetyTimeout = setTimeout(() => {
        if (get().isLoading) {
            console.warn("⚠️ Firebase lento. Liberando carga por seguridad.");
            set({ isLoading: false });
        }
    }, 4000);

    // Delegamos la escucha al servicio
    const unsubscribe = authService.onAuthStateChanged((user) => {
      clearTimeout(safetyTimeout); // Cancelamos timeout si responde rápido
      
      if (user) {
        console.log("✅ Sesión activa:", user.email, "| Empresa:", user.companyId);
        set({ 
            user, 
            isAuthenticated: true, 
            isLoading: false 
        });
      } else {
        console.log("🔒 Sin sesión.");
        set({ 
            user: null, 
            isAuthenticated: false, 
            isLoading: false 
        });
      }
    });

    return unsubscribe;
  },
  
  updateUser: (data) => {
      const currentUser = get().user;
      if (currentUser) {
          set({ user: { ...currentUser, ...data } });
      }
  }
}));