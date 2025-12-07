import { create } from 'zustand';
import { doc, getDoc } from 'firebase/firestore';
import { authService } from '../services/authService';
import { auth, db } from '../../../database/firebase'; // Importamos db para leer el perfil

export const useAuthStore = create((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true, // Estado inicial de carga para evitar "parpadeos" en rutas protegidas

  // Acción de Login (Usa el servicio que ya lee el rol)
  login: async (email, password) => {
    try {
      const user = await authService.login(email, password);
      set({ user, isAuthenticated: true });
      return true;
    } catch (error) {
      throw error;
    }
  },

  // Acción de Logout
  logout: async () => {
    await authService.logout();
    set({ user: null, isAuthenticated: false });
  },

  // Inicializador (Observer de Firebase)
  // Recupera la sesión Y el perfil completo de Firestore al recargar la página
  initAuthListener: () => {
    auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // 1. La sesión de Auth existe, ahora buscamos el ROL en Firestore
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          const userDoc = await getDoc(userDocRef);

          let userData = {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            name: firebaseUser.displayName || 'Usuario',
            role: 'CAJERO' // Rol por defecto (Principio de menor privilegio)
          };

          if (userDoc.exists()) {
            const data = userDoc.data();
            userData.role = data.role;
            userData.name = data.name;
          } else {
            // ⚠️ Fallback de Emergencia: Si es el primer admin y no está en DB
            if (firebaseUser.email?.toLowerCase().includes('admin')) {
                userData.role = 'ADMIN'; 
            }
          }

          // 2. Establecemos el usuario completo en el Store
          set({ 
            user: userData, 
            isAuthenticated: true, 
            isLoading: false 
          });

        } catch (error) {
          console.error("Error recuperando perfil:", error);
          // Si falla la lectura del perfil, cerramos sesión por seguridad
          set({ user: null, isAuthenticated: false, isLoading: false });
        }
      } else {
        // No hay usuario logueado
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    });
  }
}));