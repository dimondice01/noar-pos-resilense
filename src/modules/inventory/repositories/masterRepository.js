import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { 
    doc, 
    setDoc, 
    deleteDoc, 
    collection, 
    getDocs, 
    query, 
    serverTimestamp,
    orderBy 
} from 'firebase/firestore'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 

// =================================================================
// 🧠 MASTER REPOSITORY (ENTERPRISE EDITION v2.0)
// =================================================================
// Gestiona datos globales (Categorías, Marcas, Proveedores) que 
// pertenecen a la EMPRESA y se replican a todas las SUCURSALES.
// =================================================================

export const masterRepository = {

    // ==========================================
    // 🛠️ HELPER PRIVADO (Contexto Seguro)
    // ==========================================
    _getCollectionPath(storeName) {
        const { user } = useAuthStore.getState();
        
        // Si no hay empresa, es un estado inválido para Maestros Globales
        if (!user || !user.companyId) {
            // console.warn(`⛔ MasterRepo: Acceso denegado a ${storeName} (Sin Empresa).`);
            return null;
        }

        // Ruta Global: companies/{empresa_id}/{categories|brands|suppliers}
        return `companies/${user.companyId}/${storeName}`;
    },

    // ==========================================
    // 📖 LECTURA INTELIGENTE (Local First + Mirror Sync)
    // ==========================================
    async getAll(storeName) {
        const dbLocal = await getDB();
        
        // 1. CARGA LOCAL (0ms Latencia)
        // Dexie es la fuente de verdad para la UI inmediata
        let items = await dbLocal.table(storeName).toArray();

        // 2. SYNC SILENCIOSO (Background Mirroring)
        // Solo si hay red, disparamos la actualización para la próxima vez
        if (navigator.onLine) {
            this._syncMirror(storeName).catch(e => {
                if (process.env.NODE_ENV === 'development') console.warn(`Sync ${storeName} pospuesto:`, e.message);
            });
        }
        
        // Ordenamiento local (UX)
        return items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    },

    // 🔥 EL SECRETO DEL ÉXITO: MIRROR SYNC
    // No solo "agrega" lo nuevo, también detecta lo BORRADO en la nube.
    async _syncMirror(storeName) {
        const path = this._getCollectionPath(storeName);
        if (!path) return;

        // Bajamos TODO de la colección (son maestros, suelen ser pocos < 1000)
        // Si crece mucho, se debería paginar o usar 'updatedAt', pero para maestros es seguro bajar todo.
        const q = query(collection(db, path));
        const snapshot = await getDocs(q);
        
        const dbLocal = await getDB();
        
        if (!snapshot.empty) {
            const cloudItems = snapshot.docs.map(doc => ({
                ...doc.data(),
                syncStatus: 'synced' // Vienen de la fuente de verdad
            }));

            // TRANSACCIÓN DE ESPEJO (Mirroring)
            // 1. Traemos IDs locales
            // 2. Traemos IDs nube
            // 3. Borramos locales que no existen en nube (fueron borrados por otro admin)
            // 4. Actualizamos/Creamos los que vienen de nube
            
            await dbLocal.transaction('rw', dbLocal.table(storeName), async () => {
                const cloudIds = new Set(cloudItems.map(i => i.id));
                const localItems = await dbLocal.table(storeName).toArray();
                
                // Detectar eliminados remotamente
                const idsToDelete = localItems
                    .filter(local => local.syncStatus === 'synced' && !cloudIds.has(local.id))
                    .map(local => local.id);

                if (idsToDelete.length > 0) {
                    await dbLocal.table(storeName).bulkDelete(idsToDelete);
                }

                // Upsert masivo (Insert + Update)
                await dbLocal.table(storeName).bulkPut(cloudItems);
            });
        }
    },

    // ==========================================
    // 💾 GUARDADO ATÓMICO (Optimistic UI)
    // ==========================================
    async save(storeName, item) {
        const dbLocal = await getDB();
        const path = this._getCollectionPath(storeName);

        if (!path) throw new Error("No hay contexto de empresa para guardar.");

        // Generación de ID amigable (Slug) si es nuevo
        // Ej: "Coca Cola" -> "cat_coca-cola"
        let finalId = item.id;
        if (!finalId) {
            const cleanName = (item.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const prefix = storeName === 'categories' ? 'cat' : storeName === 'brands' ? 'brand' : 'sup';
            finalId = `${prefix}_${cleanName}_${Date.now().toString(36).slice(-4)}`;
        }

        const newItem = {
            ...item,
            id: finalId,
            syncStatus: 'pending',
            updatedAt: new Date().toISOString()
        };

        // 1. Guardar Localmente (Dexie) - UI Inmediata
        await dbLocal.table(storeName).put(newItem);

        // 2. Subir a Nube (Fire & Forget)
        if (navigator.onLine) {
            // Limpiamos campos locales antes de subir
            const { syncStatus, ...cloudData } = newItem;
            
            // Usamos setDoc con merge para seguridad
            setDoc(doc(db, path, newItem.id), {
                ...cloudData,
                updatedAt: serverTimestamp() // Timestamp real del servidor
            }, { merge: true })
            .then(() => {
                // Confirmación de éxito
                dbLocal.table(storeName).update(newItem.id, { syncStatus: 'synced' });
            })
            .catch(e => {
                console.error(`🔴 Error crítico guardando ${storeName}:`, e);
                // El SyncService lo reintentará luego porque quedó en 'pending'
            });
        }

        return newItem;
    },

    // ==========================================
    // 🗑️ BORRADO (Global Soft Delete o Hard Delete)
    // ==========================================
    async delete(storeName, id) {
        const dbLocal = await getDB();
        const path = this._getCollectionPath(storeName);
        
        // 1. Borrar Local (Dexie)
        await dbLocal.table(storeName).delete(id);

        // 2. Borrar de Nube (Fire & Forget)
        if (navigator.onLine && path) {
            deleteDoc(doc(db, path, id)).catch(e => {
                console.error(`Error eliminando ${storeName}:`, e);
                // Aquí podríamos implementar una cola de "borrados pendientes" si fuera crítico
            });
        }
    }
};