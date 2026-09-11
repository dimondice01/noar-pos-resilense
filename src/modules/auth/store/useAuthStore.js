import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authService } from '../services/authService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { useShiftStore } from '../../cash/store/useShiftStore';
import { usePosSessionStore } from '../../pos/store/usePosSessionStore';

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
          // El authService ahora devuelve el objeto de usuario (master o firebase)
          const userData = await authService.login(email, password);
          
          // Si es el Super Admin forzado, seteamos el estado manualmente aquí también
          if (userData.uid === "master-admin-nexus") {
            set({ 
              user: userData, 
              isAuthenticated: true, 
              isLoading: false,
              activeBranchId: null,
              activeBranchName: "SaaS Control Center" 
            });
          }
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

          // 🔥 FIX: useShiftStore ('nexus-shift-storage') persiste el turno en
          // localStorage sin distinguir de qué usuario es. Si no se limpia acá, el
          // próximo cajero que loguee en esta misma compu hereda el turno abierto
          // del anterior (y a veces no puede cerrarlo, por el chequeo de permisos
          // en closeShift). Logout es el único lugar que SIEMPRE corre sin importar
          // por dónde se cierre sesión.
          useShiftStore.getState().clearShift();
          // 🔥 Mismo criterio: el carrito/pestañas de POS quedan en RAM (ver
          // usePosSessionStore) para sobrevivir a navegar entre páginas — pero
          // no deben sobrevivir a un cambio de cajero en la misma compu.
          usePosSessionStore.getState().resetSession();

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
        // 🛡️ SEGURIDAD: Si el usuario está confinado, impedir cambio.
        // 🔥 FIX: mismo criterio que BranchSelector.isLocked — un OWNER nunca está
        // confinado, sin importar qué tenga en branchId (cuenta migrada de ADMIN, etc).
        if (currentUser?.branchId && currentUser.branchId !== branchId && currentUser.role !== 'OWNER') {
            console.warn("⛔ Cambio de sucursal bloqueado por perfil de usuario.");
            return;
        }

        localStorage.setItem('NOAR_ACTIVE_BRANCH', JSON.stringify({ id: branchId, name: branchName }));
        set({ activeBranchId: branchId, activeBranchName: branchName });
      },

      initAuthListener: () => {
        console.log("🔌 Inicializando Auth Listener...");
        
        // 🛡️ BYPASS PARA MASTER ADMIN: Si detectamos el UID maestro en el storage, no dejamos que Firebase lo limpie
        const state = get();
        if (state.user?.uid === "master-admin-nexus") {
            console.log("👑 Modo Master Admin detectado, omitiendo listener de Firebase.");
            set({ isLoading: false, isAuthenticated: true });
            return () => {}; // Retornamos un unsubscribe vacío
        }

        // 🔥 RED DE SEGURIDAD INMEDIATA (Auto-Repair en memoria)
        if (state.user?.branchId && !state.activeBranchId) {
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
                // 🛡️ Doble verificación para el Master Admin en el listener
                if (firebaseUser.uid === "master-admin-nexus") {
                    set({ isLoading: false, isAuthenticated: true });
                    return;
                }

                // 1. Obtener datos frescos de Firestore (incluyendo permisos y sucursal)
                const userDocRef = doc(db, 'users', firebaseUser.uid);
                const userSnap = await getDoc(userDocRef);

                if (userSnap.exists()) {
                    const firestoreData = userSnap.data();
                    
                    // 2. 🔥 SPRINT SAAS: Traer datos de Suscripción de la Empresa
                    let saasData = {};
                    if (firestoreData.companyId) {
                        const compRef = doc(db, 'companies', firestoreData.companyId);
                        const compSnap = await getDoc(compRef);
                        if (compSnap.exists()) {
                            const c = compSnap.data();
                            saasData = {
                                subscriptionStatus: c.subscriptionStatus || 'TRIAL',
                                expiryDate: c.expiryDate || null
                            };
                        }
                    }

                    // Fusionamos todos los datos (Auth + Firestore Perfil + Firestore Empresa)
                    const fullUserData = {
                        uid: firebaseUser.uid,
                        email: firebaseUser.email,
                        ...firestoreData,
                        ...saasData
                    };

                    // 🧠 LÓGICA DE ASIGNACIÓN DE SUCURSAL
                    let targetBranchId = get().activeBranchId;
                    let targetBranchName = get().activeBranchName;

                    // 🔒 Mismo criterio que isLocked en BranchSelector/switchBranch: solo
                    // forzamos la sucursal de Firestore si el usuario está REALMENTE
                    // confinado (CAJERO/ADMIN de sucursal fija). Un OWNER nunca se fuerza
                    // acá, aunque tenga branchId seteado (cuenta migrada de ADMIN, o
                    // config inicial de registro) — si no, cada recarga de página le pisa
                    // la sucursal que eligió a mano con el selector y vuelve a su "sucursal
                    // de base", aunque tenga un turno abierto en otra.
                    const isRoleLocked = !!firestoreData.branchId && firestoreData.role !== 'OWNER';

                    if (isRoleLocked) {
                        targetBranchId = firestoreData.branchId;
                        if (!targetBranchName) targetBranchName = "Sucursal Asignada";
                    }
                    else if (!targetBranchId) {
                        // Sin sucursal activa todavía (primer login, o storage limpio):
                        // usamos branchId de Firestore como default si lo tiene, si no el
                        // último que se eligió a mano con el selector.
                        if (firestoreData.branchId) {
                            targetBranchId = firestoreData.branchId;
                            targetBranchName = "Sucursal Asignada";
                        } else {
                            try {
                                const stored = localStorage.getItem('NOAR_ACTIVE_BRANCH');
                                if (stored) {
                                    const parsed = JSON.parse(stored);
                                    targetBranchId = parsed.id;
                                    targetBranchName = parsed.name;
                                }
                            } catch (e) {}
                        }
                    }

                    set({ 
                        user: fullUserData, 
                        isAuthenticated: true, 
                        isLoading: false,
                        activeBranchId: targetBranchId,
                        activeBranchName: targetBranchName
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
      name: 'auth-storage', 
      partialize: (state) => ({ 
          user: state.user, 
          isAuthenticated: state.isAuthenticated,
          activeBranchId: state.activeBranchId, 
          activeBranchName: state.activeBranchName
      }),
    }
  )
);