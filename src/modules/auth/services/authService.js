import { 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../../database/firebase';
import { getDB } from '../../../database/db'; 

// 🌍 URL de Producción (Asegúrate que esta sea la correcta de tu deploy actual)
const API_URL = import.meta.env.VITE_API_URL || "https://api-ps25yq7qaq-uc.a.run.app";

export const authService = {
  
  // ==========================================
  // LOGIN (Unificado)
  // ==========================================
  async login(email, password) {
    if (!navigator.onLine) {
        return await this._tryLocalLogin(email, password);
    }

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;
      const userDocRef = doc(db, 'users', uid);
      
      let userData = {
        uid,
        email: userCredential.user.email,
        name: userCredential.user.displayName || 'Usuario',
        role: 'CAJERO', 
        companyId: null, 
        mode: 'ONLINE'
      };

      try {
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          const data = userDoc.data();
          userData.role = data.role || 'CAJERO';
          userData.name = data.name || userData.name;
          userData.companyId = data.companyId; 
        } else if (email.toLowerCase().includes('admin')) {
             userData.role = 'ADMIN'; 
             userData.companyId = 'master_admin';
        }
      } catch (firestoreError) {
        console.warn("⚠️ Firestore no respondió, usando caché local.");
        const localData = await this._getLocalUser(email);
        if (localData) {
            userData.role = localData.role;
            userData.name = localData.name;
            userData.companyId = localData.companyId; 
        }
      }

      await this._saveUserLocally({ ...userData, password }); 
      return userData;

    } catch (error) {
      console.error("❌ Error Auth:", error.code);
      // Fallback a local si hay error técnico (no de contraseña)
      const isTechnicalError = !['auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(error.code);
      if (isTechnicalError) {
        return await this._tryLocalLogin(email, password);
      }
      throw new Error("Credenciales inválidas");
    }
  },

  async logout() {
    await signOut(auth);
  },

  onAuthStateChanged(callback) {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          let userProfile = {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              name: firebaseUser.displayName || 'Usuario',
              role: 'CAJERO',
              companyId: null,
              mode: 'ONLINE'
          };

          if (userDoc.exists()) {
            const data = userDoc.data();
            userProfile.role = data.role || 'CAJERO';
            userProfile.name = data.name || userProfile.name;
            userProfile.companyId = data.companyId;
          } 

          await this._saveUserLocally({ ...userProfile, password: '***' }); 
          callback(userProfile);

        } catch (e) {
          const localUser = await this._getLocalUser(firebaseUser.email);
          if (localUser) {
              callback({ uid: firebaseUser.uid, email: firebaseUser.email, ...localUser, mode: 'OFFLINE' });
          } else {
              callback(null);
          }
        }
      } else {
        callback(null);
      }
    });
  },

  // ==========================================
  // 🔥 CREACIÓN DE USUARIO (ADMIN SDK) - CORREGIDO
  // ==========================================
  async createUser(newUser) {
    // 1. Guardar preventivamente en local (Optimistic UI)
    await this._saveUserLocally({
        ...newUser,
        password: btoa(newUser.password) 
    });
    
    // 2. Si hay internet, llamamos a la Cloud Function
    if (navigator.onLine) {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error("No hay sesión admin activa");

        // 🔥 LOG PARA DEPURAR URL
        console.log("📡 Conectando a:", `${API_URL}/create-user`);

        const response = await fetch(`${API_URL}/create-user`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}` 
          },
          body: JSON.stringify(newUser) 
        });

        // 🔥 MANEJO DE ERROR DETALLADO
        if (!response.ok) {
            // Intentamos leer el JSON de error, si falla es porque es un error de infraestructura (HTML 403/500)
            let errorMessage = `Error ${response.status}: ${response.statusText}`;
            try {
                const errData = await response.json();
                if (errData.error) errorMessage = errData.error;
            } catch (e) {
                // Si no es JSON, probablemente sea error de Cloud Run IAM (403 Forbidden HTML)
                if(response.status === 403) errorMessage = "Permiso denegado en Servidor (Cloud Run IAM). Revisa configuración pública.";
            }
            throw new Error(errorMessage);
        }
        
        const data = await response.json();
        return { success: true, uid: data.uid };

      } catch (error) {
        console.error("API Error:", error);
        // 🔥 IMPORTANTE: Propagamos el error para que la UI (TeamPage) lo muestre
        throw error; 
      }
    } else {
      return { success: true, localOnly: true };
    }
  },

  // ... (Helpers Privados se mantienen igual) ...
  async _saveUserLocally(userData) {
    const db = await getDB();
    if (userData.password === '***') {
        const existing = await db.get('users', userData.email);
        if (existing?.password) userData.password = existing.password;
    } else {
        userData.password = btoa(userData.password); 
    }

    await db.put('users', {
      email: userData.email,
      password: userData.password, 
      name: userData.name,
      role: userData.role,
      companyId: userData.companyId, 
      updatedAt: new Date()
    });
  },

  async _getLocalUser(email) {
    const db = await getDB();
    return await db.get('users', email);
  },

  async _tryLocalLogin(email, password) {
    const localUser = await this._getLocalUser(email);
    if (!localUser) throw new Error("Usuario no encontrado localmente.");
    
    let storedPassword = localUser.password;
    try {
        if (!storedPassword.includes(' ')) storedPassword = atob(storedPassword);
    } catch(e) {}

    if (storedPassword === password) {
       return {
         uid: 'local_' + Date.now(),
         email: localUser.email,
         name: localUser.name,
         role: localUser.role,
         companyId: localUser.companyId,
         mode: 'OFFLINE'
       };
    }
    throw new Error("Contraseña incorrecta.");
  }
};