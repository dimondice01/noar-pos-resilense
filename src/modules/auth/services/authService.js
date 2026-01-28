import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from 'firebase/auth';
import { 
    doc, 
    getDoc, 
    writeBatch, 
    serverTimestamp 
} from 'firebase/firestore';
import { auth, db } from '../../../database/firebase';
import { db as localDb } from '../../../database/db'; // Importamos la instancia directa de Dexie

// 🌍 URL de Producción
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
                // Caso especial Admin Master (Hardcoded por seguridad)
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
    // 🔥 REGISTRO ATÓMICO CON SUCURSALES DINÁMICAS
    // ==========================================
    async register({ email, password, name, companyName, branchCount }) {
        try {
            // 1. Crear Auth User
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const { uid } = userCredential.user;
            const companyId = crypto.randomUUID(); // Generamos ID manualmente para usarlo en batch

            // 2. Preparar Batch (Escritura Atómica)
            // Esto asegura que se cree TODO (Usuario + Empresa + Sucursales) o NADA.
            const batch = writeBatch(db);

            // Referencias Base
            const userRef = doc(db, 'users', uid);
            const companyRef = doc(db, 'companies', companyId);
            
            // --- A. Crear Usuario Owner ---
            batch.set(userRef, {
                name,
                email,
                role: 'OWNER',
                companyId,
                branchId: null, // Owner ve todo
                active: true,
                createdAt: serverTimestamp()
            });

            // --- B. Crear Empresa ---
            batch.set(companyRef, {
                name: companyName,
                plan: 'trial',
                createdAt: serverTimestamp(),
                ownerUid: uid,
                isActive: true,
                branchCount: parseInt(branchCount) || 1 // Guardamos cuántas contrató
            });

            // --- C. Crear Sucursales Dinámicamente (Loop) ---
            // Si el usuario pidió 3 sucursales, el loop corre 3 veces.
            const totalBranches = parseInt(branchCount) || 1;

            for (let i = 1; i <= totalBranches; i++) {
                // Generamos ID ordenado: suc-01, suc-02...
                const branchId = `suc-${i.toString().padStart(2, '0')}`;
                
                // Nombre amigable: "Sucursal 1", "Sucursal 2"
                // Opcional: Si es la 1, le agregamos "(Principal)"
                const branchName = i === 1 ? `Sucursal ${i} (Principal)` : `Sucursal ${i}`;

                const branchRef = doc(db, 'companies', companyId, 'branches', branchId);

                batch.set(branchRef, {
                    name: branchName,
                    number: i, // Número de sucursal para ordenamiento
                    address: '',
                    type: 'physical',
                    active: true,
                    createdAt: serverTimestamp()
                });
            }

            // 3. Ejecutar Transacción (Commit)
            await batch.commit();

            return userCredential.user;

        } catch (error) {
            console.error("Error crítico en registro:", error);
            // Nota: Firebase Auth crea el usuario igual, pero Firestore falló.
            // En un sistema perfecto, deberíamos borrar el usuario de Auth aquí para limpiar.
            throw error;
        }
    },

    // ==========================================
    // 🚪 LOGOUT
    // ==========================================
    async logout() {
        try {
            await signOut(auth);
            // Opcional: Limpiar datos sensibles locales
            // await localDb.users.clear(); 
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
                         // Fallback a Local Dexie si Firestore falla o está lento
                        const localUser = await this._getLocalUser(firebaseUser.email);
                        if (localUser) {
                             userProfile = { ...localUser, uid: firebaseUser.uid, mode: 'OFFLINE_SYNC' };
                        } else {
                             // Perfil básico de emergencia
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

                    // Guardamos sesión actualizada en local (sin pisar password si no viene)
                    await this._saveLocalUser({ ...userProfile, password: '***' }); 
                    
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
                    companyId: data.companyId,
                    branchId: data.branchId // Importante para redirección
                };
            }
            return null;
        } catch (e) {
            console.warn("Error leyendo Firestore Profile:", e);
            return null;
        }
    },

    // 🔥 FIX: Adaptado para Dexie (db.users.put)
    async _saveLocalUser(user) {
        try {
            // Lógica de contraseña segura para no sobreescribir con '***'
            let passwordToSave = user.password;
            
            // Si la password es dummy ('***') o vacía, intentamos rescatar la vieja
            if (passwordToSave === '***' || !passwordToSave) {
                 const existing = await localDb.users.get(user.email);
                 if (existing?.password) passwordToSave = existing.password;
            } else {
                 // Si es nueva, la encriptamos simple
                 try {
                    // Evitar doble encriptación si ya viene en base64
                    if (!passwordToSave.endsWith('=')) { 
                        passwordToSave = btoa(passwordToSave); 
                    }
                 } catch (e) {}
            }

            // Guardado en Dexie
            await localDb.users.put({
                email: user.email, // Key path
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

    // 🔥 FIX: Adaptado para Dexie (db.users.get)
    async _getLocalUser(email) {
        if (!email) return null;
        try {
            return await localDb.users.get(email);
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
            // Decodificar si parece base64
            if (storedPassword && !storedPassword.includes(' ')) {
                storedPassword = atob(storedPassword);
            }
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