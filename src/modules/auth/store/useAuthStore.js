import { create } from 'zustand';
import { doc, getDoc } from 'firebase/firestore';
import { authService } from '../services/authService';
import { auth, db } from '../../../database/firebase'; 
import { getDB } from '../../../database/db'; 

// Necesitamos 'get' además de 'set' para leer el estado dentro del timeout
export const useAuthStore = create((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false, 

  login: async (email, password) => {
    try {
      const user = await authService.login(email, password);
      if (!user.companyId && user.role !== 'ADMIN') {
          console.warn("⚠️ Usuario sin empresa asignada");
      }
      set({ user, isAuthenticated: true });
      return true;
    } catch (error) {
      throw error;
    }
  },

  logout: async () => {
    await authService.logout();
    set({ user: null, isAuthenticated: false });
  },

  initAuthListener: () => {
    console.log("🔌 Inicializando Auth Listener...");

    // ⏱️ 1. TIMEOUT DE SEGURIDAD (El Parche Anti-Bloqueo)
    // Si Firebase no responde en 3 segundos, forzamos el desbloqueo.
    const safetyTimeout = setTimeout(() => {
        if (get().isLoading) {
            console.warn("⚠️ Firebase tardó demasiado. Forzando desbloqueo de UI.");
            set({ isLoading: false });
        }
    }, 3000);

    auth.onAuthStateChanged(async (firebaseUser) => {
      // 🛑 Cancelamos el timeout porque Firebase ya respondió
      clearTimeout(safetyTimeout);
      
      try {
        if (firebaseUser) {
          try {
            // INTENTO ONLINE
            const userDocRef = doc(db, 'users', firebaseUser.uid);
            const userDoc = await getDoc(userDocRef);

            let userData = {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              name: firebaseUser.displayName || 'Usuario',
              role: 'CAJERO',
              companyId: null, 
              mode: 'ONLINE'
            };

            if (userDoc.exists()) {
              const data = userDoc.data();
              userData.role = data.role || 'CAJERO';
              userData.name = data.name || userData.name;
              userData.companyId = data.companyId || null; 
            } else {
              if (firebaseUser.email?.toLowerCase().includes('admin')) {
                  userData.role = 'ADMIN'; 
              }
            }

            // Guardar local
            const dbLocal = await getDB();
            await dbLocal.put('users', { 
                email: userData.email, 
                name: userData.name, 
                role: userData.role, 
                companyId: userData.companyId,
                updatedAt: new Date() 
            });

            set({ user: userData, isAuthenticated: true });

          } catch (error) {
            console.warn("⚠️ Error Firestore (Offline). Intentando rescate...", error);
            
            // INTENTO OFFLINE
            let restored = false;
            try {
                const dbLocal = await getDB();
                const localUser = await dbLocal.get('users', firebaseUser.email);

                if (localUser && localUser.companyId) {
                    console.log("✅ Sesión restaurada Offline");
                    set({ 
                      user: {
                          uid: firebaseUser.uid,
                          email: firebaseUser.email,
                          name: localUser.name,
                          role: localUser.role,
                          companyId: localUser.companyId,
                          mode: 'OFFLINE'
                      }, 
                      isAuthenticated: true
                    });
                    restored = true;
                }
            } catch (localError) { console.error(localError); }

            if (!restored) set({ user: null, isAuthenticated: false });
          }
        } else {
          set({ user: null, isAuthenticated: false });
        }
      } catch (globalError) {
        console.error("❌ Error Auth:", globalError);
        set({ user: null, isAuthenticated: false });
      } finally {
        // ✅ 2. Desbloqueo normal
        console.log("🏁 Auth finalizado. isLoading -> false");
        set({ isLoading: false });
      }
    });
  }
}));