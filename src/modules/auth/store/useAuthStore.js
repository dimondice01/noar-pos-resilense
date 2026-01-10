import { create } from 'zustand';
import { doc, getDoc } from 'firebase/firestore';
import { authService } from '../services/authService';
import { auth, db } from '../../../database/firebase'; 
import { getDB } from '../../../database/db'; // 🔥 IMPORTANTE: Acceso a DB Local

export const useAuthStore = create((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true, 

  // Acción de Login
  login: async (email, password) => {
    try {
      const user = await authService.login(email, password);
      set({ user, isAuthenticated: true, isLoading: false });
      return true;
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  // Acción de Logout
  logout: async () => {
    await authService.logout();
    set({ user: null, isAuthenticated: false });
  },

  // Inicializador HÍBRIDO (Local + Nube)
  initAuthListener: () => {
    
    // 1. ESTRATEGIA INMEDIATA: Intentar leer del caché local (IndexedDB)
    // Esto hace que la app cargue al instante, incluso sin internet.
    const loadFromLocalCache = async () => {
        try {
            const localDb = await getDB();
            const users = await localDb.getAll('users');
            
            // Si hay usuarios guardados, tomamos el primero (en Single-Tenant suele ser el Admin)
            if (users.length > 0) {
                const cachedUser = users[0];
                // Solo actualizamos si el estado actual está vacío (para no sobrescribir a Firebase si ya cargó)
                set((state) => {
                    if (!state.user) {
                        return { 
                            user: { ...cachedUser, uid: cachedUser.id || 'local_user' }, 
                            isAuthenticated: true, 
                            isLoading: false 
                        };
                    }
                    return {};
                });
            }
        } catch (e) {
            console.warn("No se pudo recuperar sesión local:", e);
        }
    };
    
    // Ejecutamos la carga local inmediatamente
    loadFromLocalCache();

    // 2. ESTRATEGIA REMOTA: Escuchar a Firebase (La autoridad final)
    auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // Buscamos datos frescos en Firestore
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          const userDoc = await getDoc(userDocRef);

          let userData = {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            name: firebaseUser.displayName || 'Usuario',
            role: 'CAJERO' 
          };

          if (userDoc.exists()) {
            const data = userDoc.data();
            userData.role = data.role;
            userData.name = data.name;
          } else {
             if (firebaseUser.email?.toLowerCase().includes('admin')) {
                userData.role = 'ADMIN'; 
             }
          }

          // 🔥 ACTUALIZAMOS EL STORE Y TAMBIÉN LA DB LOCAL (Sincronización silenciosa)
          const localDb = await getDB();
          const tx = localDb.transaction('users', 'readwrite');
          // Guardamos con una contraseña dummy o la existente si pudiéramos, 
          // pero aquí lo importante es actualizar el Rol y Nombre.
          // Nota: authService ya se encarga de guardar la password al hacer login explícito.
          // Aquí solo actualizamos metadatos si ya existe.
          const existingUser = await tx.store.get(userData.email);
          if (existingUser) {
              await tx.store.put({ ...existingUser, ...userData });
          }
          await tx.done;

          set({ 
            user: userData, 
            isAuthenticated: true, 
            isLoading: false 
          });

        } catch (error) {
          console.error("Error recuperando perfil de nube (Usando local):", error);
          // Si falla Firebase (Firestore), NO deslogueamos. 
          // Confiamos en lo que cargó `loadFromLocalCache` arriba.
          set({ isLoading: false });
        }
      } else {
        // Firebase dice que no hay usuario.
        // PERO: Si estamos Offline, Firebase siempre dice null al inicio si no tiene caché.
        // Verificamos si tenemos sesión local antes de echar al usuario.
        if (navigator.onLine) {
            // Solo si hay internet y Firebase dice null, entonces sí es un logout real.
            set({ user: null, isAuthenticated: false, isLoading: false });
        } else {
            // Si estamos offline, mantenemos la sesión local que cargamos en el paso 1.
            set({ isLoading: false });
        }
      }
    });
  }
}));