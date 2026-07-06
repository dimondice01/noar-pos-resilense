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
import { db as localDb } from '../../../database/db'; 

// 🌍 URL de Producción
const API_URL = import.meta.env.VITE_API_URL || "https://api-ps25yq7qaq-uc.a.run.app";

export const authService = {

    // ==========================================
    // 🔐 LOGIN (Híbrido: Cloud + Local)
    // ==========================================
    async login(email, password) {
        if (!navigator.onLine) {
            return await this._tryLocalLogin(email, password);
        }

        try {
            // 1. SIEMPRE pasamos por Firebase para obtener el Token de Seguridad
            // Esto evita el error de "Missing permissions" en Firestore
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const firebaseUser = userCredential.user;

            // 🔥 INTERCEPTOR MAESTRO 🔥
            // Si el correo que se acaba de loguear con éxito en Firebase es el tuyo:
            if (email.toLowerCase() === 'admin@noar.com' || email.toLowerCase() === 'admin@admin.com') {
                console.log("👑 Acceso Maestro Concedido (Token validado por Firebase)");
                const masterUser = {
                    uid: firebaseUser.uid, // Usamos el UID real para que Firestore confíe
                    email: firebaseUser.email,
                    name: 'Salvador Master',
                    role: 'ADMIN',
                    superAdmin: true, // 🔓 Abre la ruta /master-admin
                    companyId: 'master_admin',
                    subscriptionStatus: 'ACTIVE',
                    mode: 'ONLINE',
                    branchId: null
                };
                await this._saveLocalUser({ ...masterUser, password: '***' });
                return masterUser;
            }

            // 2. Si es un usuario normal, seguimos el flujo habitual
            let userData = await this._getFirestoreProfile(firebaseUser.uid);

            if (!userData) {
                userData = {
                    uid: firebaseUser.uid,
                    email: firebaseUser.email,
                    name: firebaseUser.displayName || 'Usuario',
                    role: 'CASHIER', 
                    companyId: null,
                    mode: 'ONLINE',
                    branchId: null
                };
            }

            // 🔥 SPRINT SAAS: Cargar datos de suscripción de la empresa
            if (userData.companyId && userData.companyId !== 'master_admin') {
                try {
                    const compRef = doc(db, 'companies', userData.companyId);
                    const compSnap = await getDoc(compRef);
                    if (compSnap.exists()) {
                        const compData = compSnap.data();
                        userData.subscriptionStatus = compData.subscriptionStatus || 'TRIAL';
                        userData.expiryDate = compData.expiryDate || null;
                    }
                } catch (e) {
                    console.error("Error cargando suscripción:", e);
                }
            }

            // Guardar sesión en DB Local
            await this._saveLocalUser({ ...userData, password });

            return userData;

        } catch (error) {
            console.warn("⚠️ Error Login Online:", error.code);
            if (error.code === 'auth/network-request-failed') {
                return await this._tryLocalLogin(email, password);
            }
            throw error;
        }
    },

    // ==========================================
    // 🔥 REGISTRO ATÓMICO (Sprint SaaS Integration)
    // ==========================================
    async register({ email, password, name, companyName, branchCount, branchNames, ...extraData }) {
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const { uid } = userCredential.user;
            const companyId = crypto.randomUUID(); 

            const expiration = new Date();
            expiration.setDate(expiration.getDate() + 30);

            const batch = writeBatch(db);
            const userRef = doc(db, 'users', uid);
            const companyRef = doc(db, 'companies', companyId);
            
            // Fusión de datos del usuario
            batch.set(userRef, {
                uid,
                name,
                email,
                role: extraData.role || 'OWNER',
                companyId,
                branchId: 'suc-01', // 🔥 MODIFICACIÓN: Iniciamos con la primera sucursal asignada
                active: true,
                createdAt: serverTimestamp(),
                ...extraData.userMetadata
            });

            // Fusión de datos de la empresa
            batch.set(companyRef, {
                id: companyId,
                name: companyName,
                createdAt: serverTimestamp(),
                ownerUid: uid,
                isActive: true,
                branchCount: parseInt(branchCount) || 1,
                subscriptionStatus: extraData.subscriptionStatus || 'TRIAL',
                expiryDate: extraData.expiryDate || expiration.toISOString(),
                planId: extraData.planId || 'COMERCIO_50K', 
                lastPaymentDate: null,
                ...extraData.companyMetadata
            });

            const totalBranches = parseInt(branchCount) || 1;

            for (let i = 1; i <= totalBranches; i++) {
                const branchId = `suc-${i.toString().padStart(2, '0')}`;
                const branchName = (branchNames && branchNames[i-1]) 
                    ? branchNames[i-1] 
                    : (i === 1 ? `Sucursal Central` : `Sucursal ${i}`);
                
                const branchRef = doc(db, 'companies', companyId, 'branches', branchId);

                batch.set(branchRef, {
                    id: branchId,
                    name: branchName,
                    number: i, 
                    address: '',
                    type: 'physical',
                    active: true,
                    createdAt: serverTimestamp()
                });
            }

            await batch.commit();
            return userCredential.user;

        } catch (error) {
            console.error("Error crítico en registro:", error);
            throw error;
        }
    },

    async logout() {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Error Logout:", error);
        }
    },

    async getToken() {
        return await auth.currentUser?.getIdToken();
    },

    // ==========================================
    // 🎧 LISTENER DE ESTADO (Recarga de pág)
    // ==========================================
    onAuthStateChanged(callback) {
        return onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                
                // 🔥 INTERCEPTOR MAESTRO AL RECARGAR PÁGINA 🔥
                const emailStr = firebaseUser.email?.toLowerCase();
                if (emailStr === 'admin@noar.com' || emailStr === 'admin@admin.com') {
                    const masterUser = {
                        uid: firebaseUser.uid,
                        email: firebaseUser.email,
                        name: 'Salvador Master',
                        role: 'ADMIN',
                        superAdmin: true,
                        companyId: 'master_admin',
                        subscriptionStatus: 'ACTIVE',
                        mode: 'ONLINE',
                        branchId: null
                    };
                    await this._saveLocalUser({ ...masterUser, password: '***' });
                    return callback(masterUser);
                }

                try {
                    let userProfile = await this._getFirestoreProfile(firebaseUser.uid);
                    
                    if (!userProfile) {
                        const localUser = await this._getLocalUser(firebaseUser.email);
                        if (localUser) {
                             userProfile = { ...localUser, uid: firebaseUser.uid, mode: 'OFFLINE_SYNC' };
                        } else {
                             userProfile = {
                                 uid: firebaseUser.uid,
                                 email: firebaseUser.email,
                                 name: firebaseUser.displayName || 'Usuario',
                                 role: 'CASHIER',
                                 companyId: null,
                                 mode: 'ONLINE',
                                 branchId: null
                             };
                        }
                    } else {
                        userProfile.mode = 'ONLINE';
                        
                        if (userProfile.companyId && userProfile.companyId !== 'master_admin') {
                            const compSnap = await getDoc(doc(db, 'companies', userProfile.companyId));
                            if (compSnap.exists()) {
                                userProfile.subscriptionStatus = compSnap.data().subscriptionStatus;
                                userProfile.expiryDate = compSnap.data().expiryDate;
                            }
                        }
                    }

                    await this._saveLocalUser({ ...userProfile, password: '***' }); 
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

    async createUser(newUser) {
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
                    let errorMessage = `Error ${response.status}: ${response.statusText}`;
                    try {
                        const errData = await response.json();
                        if (errData.error) errorMessage = errData.error;
                    } catch (e) {}
                    throw new Error(errorMessage);
                }

                const data = await response.json();

                // 🔥 FIX: recién acá conocemos el uid real (lo asigna Firebase Auth).
                // Guardarlo antes rompía el .put() en Dexie (uid es la primary key de 'users').
                await this._saveLocalUser({
                    ...newUser,
                    uid: data.uid,
                    password: btoa(newUser.password)
                });

                return { success: true, uid: data.uid };

            } catch (error) {
                console.error("API Error:", error);
                throw error;
            }
        } else {
            // 🔥 OFFLINE: no hay forma de obtener un uid real de Firebase Auth sin conexión.
            // Guardamos con un uid temporal y lo marcamos para reconciliar cuando vuelva la red.
            const tempUid = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            await this._saveLocalUser({
                ...newUser,
                uid: tempUid,
                password: btoa(newUser.password),
                isPendingAuthUser: true
            });
            return { success: true, localOnly: true, uid: tempUid };
        }
    },

    // 🔥 RECONCILIACIÓN: crea en Firebase Auth los cajeros/usuarios dados de alta offline
    async syncPendingOfflineUsers() {
        if (!navigator.onLine) return { synced: 0 };
        try {
            const pending = await localDb.users.filter(u => u.isPendingAuthUser === true).toArray();
            if (pending.length === 0) return { synced: 0 };

            let synced = 0;
            for (const localUser of pending) {
                try {
                    const token = await auth.currentUser?.getIdToken();
                    if (!token) continue;

                    const plainPassword = atob(localUser.password);
                    const response = await fetch(`${API_URL}/create-user`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({ ...localUser, password: plainPassword })
                    });

                    if (!response.ok) continue;
                    const data = await response.json();

                    // Reemplazamos el registro temporal (uid local) por el definitivo (uid real)
                    await localDb.users.delete(localUser.uid);
                    await this._saveLocalUser({
                        ...localUser,
                        uid: data.uid,
                        isPendingAuthUser: false
                    });

                    synced++;
                } catch (err) {
                    console.warn("Error reconciliando usuario offline:", err);
                }
            }
            return { synced };
        } catch (e) {
            console.error("Error en syncPendingOfflineUsers:", e);
            return { synced: 0 };
        }
    },

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
                    branchId: data.branchId || null,
                    permissions: data.permissions || {} 
                };
            }
            return null;
        } catch (e) {
            return null;
        }
    },

    async _saveLocalUser(user) {
        try {
            let passwordToSave = user.password;
            
            if (passwordToSave === '***' || !passwordToSave) {
                 const existing = await localDb.users.get(user.email);
                 if (existing?.password) passwordToSave = existing.password;
            } else {
                 try {
                    if (!passwordToSave.endsWith('=')) { 
                        passwordToSave = btoa(passwordToSave); 
                    }
                 } catch (e) {}
            }

            await localDb.users.put({
                email: user.email, 
                password: passwordToSave,
                uid: user.uid,
                role: user.role || 'CASHIER',
                companyId: user.companyId,
                branchId: user.branchId || null,
                name: user.name || 'Usuario',
                subscriptionStatus: user.subscriptionStatus || 'TRIAL',
                expiryDate: user.expiryDate || null,
                superAdmin: user.superAdmin || false, // Persistimos el flag maestro
                isPendingAuthUser: user.isPendingAuthUser || false, // Cajero creado offline, pendiente de reconciliar uid real
                updatedAt: new Date()
            });
        } catch (e) {
            console.error("Error guardando usuario local:", e);
        }
    },

    async _getLocalUser(email) {
        if (!email) return null;
        try {
            return await localDb.users.get(email);
        } catch (e) {
            return null;
        }
    },

    async _tryLocalLogin(email, password) {
        const localUser = await this._getLocalUser(email);
        if (!localUser) throw new Error("Usuario no encontrado localmente.");
        
        let storedPassword = localUser.password;
        try {
            if (storedPassword && !storedPassword.includes(' ')) {
                storedPassword = atob(storedPassword);
            }
        } catch(e) {}

        if (storedPassword === password) {
           return {
             uid: localUser.uid,
             email: localUser.email,
             name: localUser.name,
             role: localUser.role,
             companyId: localUser.companyId,
             branchId: localUser.branchId || null,
             superAdmin: localUser.superAdmin || false,
             subscriptionStatus: localUser.subscriptionStatus || 'TRIAL',
             expiryDate: localUser.expiryDate || null,
             mode: 'OFFLINE'
           };
        }
        throw new Error("Contraseña incorrecta (Offline).");
    }
};