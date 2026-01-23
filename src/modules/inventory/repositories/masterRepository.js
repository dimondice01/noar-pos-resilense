import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, deleteDoc, collection, getDocs, query } from 'firebase/firestore'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 

export const masterRepository = {

  // ==========================================
  // 🛠️ HELPER PRIVADO (Seguridad)
  // ==========================================
  _getCollectionPath(storeName) {
    const { user } = useAuthStore.getState();
    
    // Validación estricta de seguridad
    if (!user || !user.companyId) {
        // Retornamos null para manejarlo suavemente en los métodos
        console.warn(`⛔ MasterRepo: Intento de acceso a ${storeName} sin empresa.`);
        return null;
    }

    // Retorna: companies/empresa_123/categories
    return `companies/${user.companyId}/${storeName}`;
  },

  // ==========================================
  // 📖 LECTURA (Local First + Background Sync)
  // ==========================================
  async getAll(storeName) {
    const dbLocal = await getDB();
    
    // 1. CARGA LOCAL (Inmediata - 0ms latencia)
    // Dexie: Usamos .table(nombre) para acceso dinámico
    let items = await dbLocal.table(storeName).toArray();

    // 2. SYNC EN SEGUNDO PLANO (Si hay internet)
    // No usamos 'await' aquí para no bloquear la UI. 
    // Los datos se actualizarán para la PRÓXIMA vez que abras el menú.
    if (navigator.onLine) {
        this._syncBackground(storeName).catch(e => console.warn("Background Sync Error:", e));
    }
    
    // Ordenar alfabéticamente (Protección contra nulls)
    return items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  },

  // Función auxiliar para no bloquear el hilo principal
  async _syncBackground(storeName) {
      try {
        const path = this._getCollectionPath(storeName);
        if (!path) return;

        const q = query(collection(db, path));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            const cloudItems = snapshot.docs.map(doc => ({
                ...doc.data(),
                syncStatus: 'synced' // Vienen de nube, ya están synced
            }));

            const dbLocal = await getDB();
            
            // Dexie BulkPut: Mucho más eficiente que un for-loop
            // Actualiza los existentes y crea los nuevos
            await dbLocal.table(storeName).bulkPut(cloudItems);
            // console.log(`🔄 ${storeName} actualizado en background (${cloudItems.length} items)`);
        }
      } catch (error) {
          // Silencioso para no molestar al usuario
          // console.warn(`Sync background ${storeName} ignorado.`);
      }
  },

  // ==========================================
  // 💾 GUARDADO (Optimistic UI)
  // ==========================================
  async save(storeName, item) {
    const dbLocal = await getDB();
    const path = this._getCollectionPath(storeName);

    // Generamos ID consistente tipo String para evitar colisiones en la nube
    // Si ya tiene ID, lo respetamos (Edición)
    const newItem = {
      ...item,
      id: item.id || `${storeName}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      syncStatus: 'pending'
    };

    // 1. Guardar Localmente (Dexie)
    await dbLocal.table(storeName).put(newItem);

    // 2. Subir a Nube (Fire & Forget)
    if (navigator.onLine && path) {
      // No hacemos await para que la UI se sienta instantánea
      const { syncStatus, ...cloudData } = newItem;
      
      setDoc(doc(db, path, newItem.id), cloudData, { merge: true })
        .then(() => {
            // Si subió bien, actualizamos a SYNCED
            dbLocal.table(storeName).update(newItem.id, { syncStatus: 'synced' });
        })
        .catch(e => console.warn(`⚠️ Error subiendo ${storeName}:`, e));
    }

    return newItem;
  },

  // ==========================================
  // 🗑️ BORRADO (Optimistic UI)
  // ==========================================
  async delete(storeName, id) {
    const dbLocal = await getDB();
    const path = this._getCollectionPath(storeName);
    
    // 1. Borrar Local (Dexie)
    await dbLocal.table(storeName).delete(id);

    // 2. Borrar de Nube (Fire & Forget)
    if (navigator.onLine && path) {
      deleteDoc(doc(db, path, id))
        .catch(e => console.error(`Error eliminando de ${storeName} en nube:`, e));
    }
  }
};