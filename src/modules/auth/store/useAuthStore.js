import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authService } from '../services/authService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../database/firebase'; 

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: true, 
      error: null,
      
      // 🔥 ESTADOS PARA MULTI-SUCURSAL (Faltaban estos)
      activeBranchId: null,
      activeBranchName: null,

      login: async (email, password) => {
        set({ error: null }); 
        try {
          await authService.login(email, password);
          return true;
        } catch (error) {
          set({ error: error.message }); 
          throw error;
        }
      },

      logout: async () => {
        try {
          await authService.logout();
          localStorage.removeItem('NOAR_ACTIVE_BRANCH'); // Limpiar persistencia manual
          set({ 
            user: null, 
            isAuthenticated: false, 
            activeBranchId: null, 
            activeBranchName: null 
          }); 
        } catch (error) {
          console.error(error);
        }
      },

      // 🔥 ESTA ES LA FUNCIÓN QUE FALTABA Y CAUSABA EL ERROR
      switchBranch: (branchId, branchName) => {
        // Guardar en localStorage para recuperar tras F5
        localStorage.setItem('NOAR_ACTIVE_BRANCH', JSON.stringify({ id: branchId, name: branchName }));
        // Actualizar estado global
        set({ activeBranchId: branchId, activeBranchName: branchName });
      },

      initAuthListener: () => {
        console.log("🔌 Inicializando Auth Listener...");
        
        const safetyTimeout = setTimeout(() => {
            if (get().isLoading) {
                console.warn("⚠️ Firebase lento. Liberando carga por seguridad.");
                set({ isLoading: false });
            }
        }, 4000);

        const unsubscribe = authService.onAuthStateChanged(async (firebaseUser) => {
          clearTimeout(safetyTimeout); 
          
          if (firebaseUser) {
            try {
                const userDocRef = doc(db, 'users', firebaseUser.uid);
                const userSnap = await getDoc(userDocRef);

                if (userSnap.exists()) {
                    const firestoreData = userSnap.data();
                    const fullUserData = {
                        uid: firebaseUser.uid,
                        email: firebaseUser.email,
                        ...firestoreData 
                    };

                    // 🧠 RECUPERAR SUCURSAL ACTIVA (Persistencia)
                    let savedBranch = null;
                    try {
                        const stored = localStorage.getItem('NOAR_ACTIVE_BRANCH');
                        if (stored) savedBranch = JSON.parse(stored);
                    } catch (e) {}

                    set({ 
                        user: fullUserData, 
                        isAuthenticated: true, 
                        isLoading: false,
                        // Restaurar la última sucursal visitada o la del usuario si es cajero
                        activeBranchId: firestoreData.branchId || savedBranch?.id || null,
                        activeBranchName: savedBranch?.name || null
                    });
                } else {
                    set({ 
                        user: { uid: firebaseUser.uid, email: firebaseUser.email },
                        isAuthenticated: true,
                        isLoading: false 
                    });
                }
            } catch (error) {
                console.error("❌ Error recuperando perfil:", error);
                set({ isLoading: false }); 
            }
          } else {
            set({ 
                user: null, 
                isAuthenticated: false, 
                isLoading: false,
                activeBranchId: null,
                activeBranchName: null
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
    }),
    {
      name: 'auth-storage', // Nombre para localStorage de Zustand
      partialize: (state) => ({ 
          user: state.user, 
          isAuthenticated: state.isAuthenticated,
          // No persistimos activeBranchId aquí porque usamos lógica manual en initAuthListener
      }),
    }
  )
);