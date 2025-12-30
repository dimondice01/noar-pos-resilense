import { 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged, // Importamos esto de firebase/auth
    createUserWithEmailAndPassword
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../../database/firebase';
import { getDB } from '../../../database/db'; 

// 🌍 URL de Producción (Cloud Functions)
const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_URL;

export const authService = {
  
  /**
   * 🔐 LOGIN BLINDADO (NUBE -> LOCAL)
   */
  async login(email, password) {
    
    // 1. ATAJO OFFLINE
    if (!navigator.onLine) {
        console.log("🌐 Navegador Offline. Iniciando modo local directo...");
        return await this._tryLocalLogin(email, password);
    }

    try {
      // 2. INTENTO ONLINE (Firebase Auth)
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      // Recuperar Rol y EMPRESA de Firestore
      const userDocRef = doc(db, 'users', uid);
      
      // Estructura base
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
          // Backdoor temporal para admin global
          userData.role = 'ADMIN';
          userData.companyId = 'master_admin'; 
        }

        if (!userData.companyId) {
             console.warn("⚠️ Usuario sin empresa asignada. Funcionalidad limitada.");
        }

      } catch (firestoreError) {
        console.warn("⚠️ Firestore no respondió (Offline parcial), usando datos locales.");
        const localData = await this._getLocalUser(email);
        if (localData) {
            userData.role = localData.role;
            userData.name = localData.name;
            userData.companyId = localData.companyId; 
        }
      }

      // 🔥 AUTO-BACKUP
      await this._saveUserLocally({ ...userData, password }); 

      return userData;

    } catch (error) {
      console.error("❌ Error Auth Nube:", error.code || error);

      // 3. FALLBACK INTELIGENTE
      const invalidCredsErrors = [
        'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email',
        'auth/invalid-credential', 'auth/too-many-requests'
      ];
      
      if (!invalidCredsErrors.includes(error.code)) {
        console.warn("⚠️ Falla técnica en Nube. Activando Protocolo de Rescate Local...");
        return await this._tryLocalLogin(email, password);
      }

      throw new Error("Usuario o contraseña incorrectos.");
    }
  },

  async logout() {
    await signOut(auth);
  },

  // 🕵️‍♂️ EL MÉTODO QUE FALTABA: Escucha cambios de sesión (F5)
  onAuthStateChanged(callback) {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // 1. Intentamos leer perfil actualizado de Firestore
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
          } else {
             // Caso especial: Master Admin manual
             if(firebaseUser.email?.includes('admin')) {
                 userProfile.role = 'ADMIN';
                 userProfile.companyId = 'master_admin';
             }
          }

          // Guardamos en local para futuras sesiones offline (Password dummy porque ya está authed)
          await this._saveUserLocally({ ...userProfile, password: '***' }); 

          callback(userProfile);

        } catch (e) {
          console.warn("⚠️ Error Firestore al recargar (Offline mode?). Buscando local...", e);
          
          // 2. Fallback Offline
          const localUser = await this._getLocalUser(firebaseUser.email);
          if (localUser) {
              console.log("✅ Restaurado desde Local DB");
              callback({
                  uid: firebaseUser.uid,
                  email: firebaseUser.email,
                  ...localUser,
                  mode: 'OFFLINE'
              });
          } else {
              // Si no hay nada, no podemos restaurar sesión
              callback(null);
          }
        }
      } else {
        callback(null);
      }
    });
  },

  async createUser(newUser) {
    await this._saveUserLocally(newUser);
    
    if (navigator.onLine) {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error("No hay sesión admin activa");

        if (!newUser.companyId) {
            console.warn("⚠️ Creando usuario sin companyId explícito.");
        }

        const response = await fetch(`${API_URL}/create-user`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}` 
          },
          body: JSON.stringify(newUser) 
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || "Error creando usuario en Nube");
        }
        return await response.json();
      } catch (error) {
        console.error("API Error:", error);
        return { success: true, localOnly: true, error: error.message };
      }
    } else {
      return { success: true, localOnly: true };
    }
  },

  // =================================================================
  // 💾 HELPERS PRIVADOS (IndexedDB)
  // =================================================================

  async _saveUserLocally(userData) {
    const db = await getDB();
    // Si la pass es dummy (***), no sobrescribimos la real si ya existe
    if (userData.password === '***') {
        const existing = await db.get('users', userData.email);
        if (existing && existing.password) {
            userData.password = existing.password;
        }
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
    
    if (!localUser) {
        throw new Error("Usuario no encontrado en caché local.");
    }

    const storedPassword = atob(localUser.password);

    if (storedPassword === password) {
       console.log("✅ Acceso Local Concedido:", localUser.name);
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