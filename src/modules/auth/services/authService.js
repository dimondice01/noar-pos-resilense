import { 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../../database/firebase';
import { getDB } from '../../../database/db'; // Importamos la nueva DB Dexie

// 🌍 URL de Producción (Asegúrate que esta sea la correcta de tu deploy actual)
const API_URL = import.meta.env.VITE_API_URL || "https://api-ps25yq7qaq-uc.a.run.app";

export const authService = {

    // ==========================================
    // 🔐 LOGIN (Híbrido: Cloud + Local Backup)
    // ==========================================
    async login(email, password) {
        // Fallback rápido si estamos offline
        if (!navigator.onLine) {
            return await this._tryLocalLogin(email, password);
        }

        try {
            // 1. Intentar Login en Firebase
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const firebaseUser = userCredential.user;

            // 2. Obtener datos extra (Rol, Empresa) de Firestore
            let userData = await this._getFirestoreProfile(firebaseUser.uid);

            // 3. Si no hay datos en Firestore (caso raro), usar básicos
            if (!userData) {
                // Caso especial Admin Master (Hardcoded)
                if (email.toLowerCase().includes('admin')) {
                    userData = {
                        uid: firebaseUser.uid,
                        email: firebaseUser.email,
                        name: 'Super Admin',
                        role: 'ADMIN',
                        companyId: 'master_admin',
                        mode: 'ONLINE'
                    };
                } else {
                    userData = {
                        uid: firebaseUser.uid,
                        email: firebaseUser.email,
                        name: firebaseUser.displayName || 'Usuario',
                        role: 'CASHIER', // Default seguro
                        companyId: null,
                        mode: 'ONLINE'
                    };
                }
            }

            // 4. Guardar sesión en DB Local (Dexie) para offline y persistencia
            // Incluimos la contraseña (hasheada simple base64) para login offline de emergencia
            await this._saveLocalUser({ ...userData, password });

            return userData;

        } catch (error) {
            console.warn("⚠️ Error Login Online:", error.code);
            
            // 5. Fallback Offline: Intentar loguear con datos locales si falla la red
            if (error.code === 'auth/network-request-failed') {
                return await this._tryLocalLogin(email, password);
            }
            throw error;
        }
    },

    // ==========================================
    // 🚪 LOGOUT
    // ==========================================
    async logout() {
        try {
            await signOut(auth);
            // Opcional: ¿Borrar usuario local al salir? 
            // await this._clearLocalUser(); 
        } catch (error) {
            console.error("Error Logout:", error);
        }
    },

    // ==========================================
    // 🎧 LISTENER DE ESTADO (Recarga de pág)
    // ==========================================
    onAuthStateChanged(callback) {
        return onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                // Si hay usuario de firebase, intentamos obtener perfil completo
                try {
                    // Primero intentamos Firestore (Verdad Absoluta)
                    let userProfile = await this._getFirestoreProfile(firebaseUser.uid);
                    
                    if (!userProfile) {
                         // Fallback a Local Dexie si Firestore falla
                        const localUser = await this._getLocalUser(firebaseUser.email);
                        if (localUser) {
                             userProfile = { ...localUser, uid: firebaseUser.uid, mode: 'OFFLINE_SYNC' };
                        } else {
                             // Perfil básico
                             userProfile = {
                                 uid: firebaseUser.uid,
                                 email: firebaseUser.email,
                                 name: firebaseUser.displayName || 'Usuario',
                                 role: 'CASHIER',
                                 companyId: null,
                                 mode: 'ONLINE'
                             };
                        }
                    } else {
                        userProfile.mode = 'ONLINE';
                    }

                    // Guardamos sesión actualizada
                    await this._saveLocalUser({ ...userProfile, password: '***' }); // No guardamos pass real aquí
                    
                    callback(userProfile);

                } catch (e) {
                    // Error crítico (ej: red muerta), usamos local puro
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
    // 🔥 CREACIÓN DE USUARIO (ADMIN SDK)
    // ==========================================
    async createUser(newUser) {
        // 1. Guardar preventivamente en local (Optimistic UI) - Dexie
        await this._saveLocalUser({
            ...newUser,
            password: btoa(newUser.password) 
        });
        
        // 2. Si hay internet, llamamos a la Cloud Function
        if (navigator.onLine) {
            try {
                const token = await auth.currentUser?.getIdToken();
                if (!token) throw new Error("No hay sesión admin activa");

                console.log("📡 Conectando a:", `${API_URL}/create-user`);

                const response = await fetch(`${API_URL}/create-user`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}` 
                    },
                    body: JSON.stringify(newUser) 
                });

                if (!response.ok) {
                    let errorMessage = `Error ${response.status}: ${response.statusText}`;
                    try {
                        const errData = await response.json();
                        if (errData.error) errorMessage = errData.error;
                    } catch (e) {
                        if(response.status === 403) errorMessage = "Permiso denegado (Cloud Run IAM).";
                    }
                    throw new Error(errorMessage);
                }
                
                const data = await response.json();
                return { success: true, uid: data.uid };

            } catch (error) {
                console.error("API Error:", error);
                throw error; 
            }
        } else {
            return { success: true, localOnly: true };
        }
    },

    // ==========================================
    // 🛠️ HELPERS PRIVADOS (Adaptados a Dexie)
    // ==========================================

    async _getFirestoreProfile(uid) {
        try {
            const docRef = doc(db, 'users', uid);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                const data = docSnap.data();
                return { 
                    uid, 
                    email: data.email,
                    name: data.name,
                    role: data.role,
                    companyId: data.companyId 
                };
            }
            return null;
        } catch (e) {
            console.warn("Error leyendo Firestore Profile:", e);
            return null;
        }
    },

    // 🔥 FIX: Adaptado para Dexie
    async _saveLocalUser(user) {
        try {
            const dbLocal = await getDB();
            
            // Lógica de contraseña segura
            let passwordToSave = user.password;
            if (passwordToSave === '***' || !passwordToSave) {
                 const existing = await dbLocal.users.get(user.email);
                 if (existing?.password) passwordToSave = existing.password;
            } else {
                 passwordToSave = btoa(passwordToSave); 
            }

            // Dexie usa db.tabla.put
            await dbLocal.users.put({
                email: user.email,
                password: passwordToSave,
                uid: user.uid,
                role: user.role || 'CASHIER',
                companyId: user.companyId,
                name: user.name || 'Usuario',
                updatedAt: new Date()
            });
        } catch (e) {
            console.error("Error guardando usuario local:", e);
        }
    },

    // 🔥 FIX: Adaptado para Dexie
    async _getLocalUser(email) {
        if (!email) return null;
        try {
            const dbLocal = await getDB();
            // Dexie usa db.tabla.get
            return await dbLocal.users.get(email);
        } catch (e) {
            console.error("Error leyendo usuario local:", e);
            return null;
        }
    },

    async _tryLocalLogin(email, password) {
        const localUser = await this._getLocalUser(email);
        if (!localUser) throw new Error("Usuario no encontrado localmente. Conéctese para el primer inicio.");
        
        let storedPassword = localUser.password;
        try {
            if (!storedPassword.includes(' ')) storedPassword = atob(storedPassword);
        } catch(e) {}

        if (storedPassword === password) {
           console.log("🟢 Login Offline Exitoso");
           return {
             uid: localUser.uid || 'local_' + Date.now(),
             email: localUser.email,
             name: localUser.name,
             role: localUser.role,
             companyId: localUser.companyId,
             mode: 'OFFLINE'
           };
        }
        throw new Error("Contraseña incorrecta (Offline).");
    }
};