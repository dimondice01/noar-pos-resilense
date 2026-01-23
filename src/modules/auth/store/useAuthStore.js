import { create } from 'zustand';
import { authService } from '../services/authService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../database/firebase'; 

export const useAuthStore = create((set, get) => ({
  user: null,
  isAuthenticated: false,
  
  // 🔥 Este estado es SOLO para la carga inicial de la App (F5)
  isLoading: true, 
  
  error: null,

  login: async (email, password) => {
    // 🛑 CORRECCIÓN: NO activamos isLoading aquí. 
    // Dejamos que el componente LoginPage maneje su propio spinner (isSubmitting).
    // Si ponemos isLoading: true aquí, App.jsx desmonta el Login antes de terminar.
    set({ error: null }); 

    try {
      await authService.login(email, password);
      return true;
    } catch (error) {
      set({ error: error.message }); // Solo seteamos error, no tocamos isLoading
      throw error;
    }
  },

  logout: async () => {
    // 🛑 CORRECCIÓN: Tampoco activamos isLoading aquí para que la transición sea suave.
    try {
      await authService.logout();
      // El listener se encargará de poner user: null
      set({ user: null, isAuthenticated: false }); 
    } catch (error) {
      console.error(error);
    }
  },

  initAuthListener: () => {
    console.log("🔌 Inicializando Auth Listener...");
    
    // Safety Timeout
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
            // Buscamos datos completos en Firestore
            const userDocRef = doc(db, 'users', firebaseUser.uid);
            const userSnap = await getDoc(userDocRef);

            if (userSnap.exists()) {
                const firestoreData = userSnap.data();
                
                const fullUserData = {
                    uid: firebaseUser.uid,
                    email: firebaseUser.email,
                    ...firestoreData 
                };

                console.log("✅ Sesión restaurada y completa:", fullUserData.companyId);

                set({ 
                    user: fullUserData, 
                    isAuthenticated: true, 
                    isLoading: false // ✅ Aquí SI apagamos la carga global
                });
            } else {
                console.warn("⚠️ Usuario autenticado sin perfil.");
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