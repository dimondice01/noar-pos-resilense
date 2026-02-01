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
      
      // Estado Global de Sucursal
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
          localStorage.removeItem('NOAR_ACTIVE_BRANCH'); 
          
          // 🔥 LIMPIEZA PROFUNDA DEL ESTADO
          set({ 
            user: null, 
            isAuthenticated: false, 
            activeBranchId: null, 
            activeBranchName: null,
            error: null
          }); 
        } catch (error) {
          console.error(error);
        }
      },

      switchBranch: (branchId, branchName) => {
        const currentUser = get().user;
        // 🛡️ SEGURIDAD: Si el usuario está confinado, impedir cambio
        if (currentUser?.branchId && currentUser.branchId !== branchId) {
            console.warn("⛔ Cambio de sucursal bloqueado por perfil de usuario.");
            return; 
        }

        // Guardar también en localStorage puro como respaldo de emergencia
        localStorage.setItem('NOAR_ACTIVE_BRANCH', JSON.stringify({ id: branchId, name: branchName }));
        set({ activeBranchId: branchId, activeBranchName: branchName });
      },

      initAuthListener: () => {
        console.log("🔌 Inicializando Auth Listener...");
        
        // 🔥 RED DE SEGURIDAD INMEDIATA (Auto-Repair en memoria)
        // Si ya tenemos usuario cargado del disco pero perdió la sucursal, la restauramos YA.
        const state = get();
        if (state.user?.branchId && !state.activeBranchId) {
            console.log("🔧 Auto-corrigiendo sucursal perdida para Cajero...");
            set({ activeBranchId: state.user.branchId });
        }

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
                // 1. Obtener datos frescos de Firestore
                const userDocRef = doc(db, 'users', firebaseUser.uid);
                const userSnap = await getDoc(userDocRef);

                if (userSnap.exists()) {
                    const firestoreData = userSnap.data();
                    
                    // Fusionamos datos
                    const fullUserData = {
                        uid: firebaseUser.uid,
                        email: firebaseUser.email,
                        ...firestoreData 
                    };

                    // 🧠 LÓGICA DE ASIGNACIÓN DE SUCURSAL
                    let targetBranchId = get().activeBranchId; // Intentamos mantener la actual
                    let targetBranchName = get().activeBranchName;

                    // A. Si el usuario es CAJERO (tiene branchId fijo en su perfil)
                    if (firestoreData.branchId) {
                        targetBranchId = firestoreData.branchId;
                        // Si no tenemos nombre, usamos uno genérico hasta que cargue la config
                        if (!targetBranchName) targetBranchName = "Mi Sucursal"; 
                    } 
                    // B. Si es ADMIN y no tiene sucursal seleccionada (o viene null), buscar en localStorage de respaldo
                    else if (!targetBranchId) {
                        try {
                            const stored = localStorage.getItem('NOAR_ACTIVE_BRANCH');
                            if (stored) {
                                const parsed = JSON.parse(stored);
                                targetBranchId = parsed.id;
                                targetBranchName = parsed.name;
                            }
                        } catch (e) {}
                    }

                    set({ 
                        user: fullUserData, 
                        isAuthenticated: true, 
                        isLoading: false,
                        activeBranchId: targetBranchId,
                        activeBranchName: targetBranchName
                    });
                } else {
                    // Fallback si no existe doc en users (raro, pero posible en demos)
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
      name: 'auth-storage', 
      // 🔥 FIX: PERSISTIMOS TODO LO NECESARIO PARA QUE EL REFRESH NO ROMPA NADA
      partialize: (state) => ({ 
          user: state.user, 
          isAuthenticated: state.isAuthenticated,
          activeBranchId: state.activeBranchId, 
          activeBranchName: state.activeBranchName
      }),
    }
  )
);