import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../../database/firebase';
import { getDB } from '../../../database/db'; // Conexión a IndexedDB

// 🌍 URL de Producción (Cloud Functions)
// TODO: Cambiar esto por tu URL real de Firebase Functions cuando despliegues
const API_URL = 'https://us-central1-salvadorpos1.cloudfunctions.net/api';

export const authService = {
  
  /**
   * 🔐 LOGIN BLINDADO (NUBE -> LOCAL)
   */
  async login(email, password) {
    
    // 1. ATAJO OFFLINE: Si el navegador ya sabe que no hay red, no perdemos tiempo.
    if (!navigator.onLine) {
        console.log("🌐 Navegador Offline. Iniciando modo local directo...");
        return await this._tryLocalLogin(email, password);
    }

    try {
      // 2. INTENTO ONLINE (Firebase Auth)
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      // Recuperar Rol de Firestore
      const userDocRef = doc(db, 'users', uid);
      let userData = {
        uid,
        email: userCredential.user.email,
        name: userCredential.user.displayName || 'Usuario',
        role: 'CAJERO', // Rol por defecto
        mode: 'ONLINE'
      };

      try {
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          const data = userDoc.data();
          userData.role = data.role;
          userData.name = data.name;
        } else if (email.toLowerCase().includes('admin')) {
          // ⚠️ Backdoor temporal para primer deploy (Quitar en versión final)
          userData.role = 'ADMIN';
        }
      } catch (firestoreError) {
        console.warn("⚠️ Firestore no respondió (Offline parcial), usando datos básicos.");
        // Intentamos enriquecer con datos locales si existen
        const localData = await this._getLocalUser(email);
        if (localData) {
            userData.role = localData.role;
            userData.name = localData.name;
        }
      }

      // 🔥 AUTO-BACKUP: Cada login exitoso actualiza la credencial local
      // Guardamos la contraseña para poder entrar offline mañana
      await this._saveUserLocally({ ...userData, password }); 

      return userData;

    } catch (error) {
      console.error("❌ Error Auth Nube:", error.code || error);

      // 3. FALLBACK INTELIGENTE
      // Si el error es de credenciales, avisamos al usuario.
      // Para CUALQUIER OTRO ERROR (Red, Error 8, Timeout, etc), intentamos local.
      const invalidCredsErrors = [
        'auth/wrong-password', 
        'auth/user-not-found', 
        'auth/invalid-email',
        'auth/invalid-credential',
        'auth/too-many-requests'
      ];
      
      // Si es error técnico (no de contraseña incorrecta), probamos local
      if (!invalidCredsErrors.includes(error.code)) {
        console.warn("⚠️ Falla técnica en Nube. Activando Protocolo de Rescate Local...");
        return await this._tryLocalLogin(email, password);
      }

      throw new Error("Usuario o contraseña incorrectos.");
    }
  },

  async logout() {
    await signOut(auth);
    // Opcional: Limpiar credenciales locales al salir para mayor seguridad en computadoras públicas
    // await this._clearLocalUser(); 
  },

  async createUser(newUser) {
    // 1. Guardar SIEMPRE en Local primero (Backup inmediato)
    await this._saveUserLocally(newUser);
    
    if (navigator.onLine) {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error("No hay sesión admin activa");

        const response = await fetch(`${API_URL}/create-user`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}` 
          },
          body: JSON.stringify(newUser)
        });

        if (!response.ok) {
            return { success: true, localOnly: true, warning: "Guardado solo local (Error API)" };
        }
        return await response.json();
      } catch (error) {
        console.error("API Error:", error);
        // Retornamos éxito local aunque falle la nube
        return { success: true, localOnly: true };
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
    // Simple ofuscación para que no se lea a simple vista en DevTools
    // (No es encriptación real, pero evita curiosos)
    const safePassword = btoa(userData.password); 

    await db.put('users', {
      email: userData.email,
      password: safePassword, 
      name: userData.name,
      role: userData.role,
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
        throw new Error("Usuario no encontrado en caché local. Se requiere conexión para el primer acceso.");
    }

    // Decodificar y comparar
    const storedPassword = atob(localUser.password);

    if (storedPassword === password) {
       console.log("✅ Acceso Local Concedido:", localUser.name);
       return {
          uid: 'local_' + Date.now(),
          email: localUser.email,
          name: localUser.name,
          role: localUser.role,
          mode: 'OFFLINE'
       };
    }
    throw new Error("Contraseña incorrecta (Verificación Local).");
  }
};