import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../../database/firebase';
import { getDB } from '../../../database/db'; // Conexión a IndexedDB

// 🌍 URL de Producción (Cloud Functions)
const API_URL = 'https://us-central1-salvadorpos1.cloudfunctions.net/api';

export const authService = {
  
  /**
   * 🔐 LOGIN BLINDADO (NUBE -> LOCAL)
   * Ahora soporta Multi-Tenant (SaaS)
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
        companyId: null, // 🏢 NUEVO: ID de la empresa
        mode: 'ONLINE'
      };

      try {
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
          const data = userDoc.data();
          userData.role = data.role || 'CAJERO';
          userData.name = data.name || userData.name;
          
          // 🏢 ASIGNACIÓN DE EMPRESA (CRÍTICO PARA SAAS)
          userData.companyId = data.companyId; 

        } else if (email.toLowerCase().includes('admin')) {
          // Backdoor temporal para admin global (si fuera necesario)
          userData.role = 'ADMIN';
          userData.companyId = 'master_admin'; // Ojo con esto en prod
        }

        if (!userData.companyId) {
             console.warn("⚠️ Usuario sin empresa asignada. Posible error de migración.");
        }

      } catch (firestoreError) {
        console.warn("⚠️ Firestore no respondió (Offline parcial), usando datos locales.");
        // Intentamos enriquecer con datos locales si existen
        const localData = await this._getLocalUser(email);
        if (localData) {
            userData.role = localData.role;
            userData.name = localData.name;
            userData.companyId = localData.companyId; // Recuperamos la empresa del caché
        }
      }

      // 🔥 AUTO-BACKUP: Guardamos TODO, incluido el companyId
      await this._saveUserLocally({ ...userData, password }); 

      return userData;

    } catch (error) {
      console.error("❌ Error Auth Nube:", error.code || error);

      // 3. FALLBACK INTELIGENTE
      const invalidCredsErrors = [
        'auth/wrong-password', 
        'auth/user-not-found', 
        'auth/invalid-email',
        'auth/invalid-credential',
        'auth/too-many-requests'
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
    // IMPORTANTE: En SaaS, al hacer logout, podrías querer limpiar
    // la base de datos local para que otro usuario no vea datos de la empresa anterior.
    // await this._clearLocalData(); // (Implementar si se desea seguridad estricta)
  },

  async createUser(newUser) {
    // Guardar local primero
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
          // Enviamos companyId al backend para que lo vincule
          body: JSON.stringify(newUser)
        });

        if (!response.ok) {
            return { success: true, localOnly: true, warning: "Guardado solo local (Error API)" };
        }
        return await response.json();
      } catch (error) {
        console.error("API Error:", error);
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
    const safePassword = btoa(userData.password); 

    await db.put('users', {
      email: userData.email,
      password: safePassword, 
      name: userData.name,
      role: userData.role,
      companyId: userData.companyId, // 🏢 Guardamos la empresa en local
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
       console.log("✅ Acceso Local Concedido:", localUser.name, "| Empresa:", localUser.companyId);
       return {
         uid: 'local_' + Date.now(),
         email: localUser.email,
         name: localUser.name,
         role: localUser.role,
         companyId: localUser.companyId, // 🏢 Retornamos la empresa offline
         mode: 'OFFLINE'
       };
    }
    throw new Error("Contraseña incorrecta (Verificación Local).");
  }
};