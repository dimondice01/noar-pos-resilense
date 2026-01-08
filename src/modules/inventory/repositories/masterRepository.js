import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, deleteDoc, collection, getDocs, query } from 'firebase/firestore'; // 🔥 Agregamos imports de lectura
import { useAuthStore } from '../../auth/store/useAuthStore'; 

export const masterRepository = {

  // ==========================================
  // 🛠️ HELPER PRIVADO
  // ==========================================
  _getCollectionPath(storeName) {
    const { user } = useAuthStore.getState();
    
    // Si no hay usuario o empresa, no podemos acceder a la ruta privada
    if (!user || !user.companyId) {
        throw new Error(`⛔ Error de seguridad: Intento de acceso a ${storeName} sin empresa asignada.`);
    }

    // Retorna: companies/empresa_123/categories
    return `companies/${user.companyId}/${storeName}`;
  },

  // ==========================================
  // 📖 LECTURA (Local First + Sync Cloud)
  // ==========================================
  async getAll(storeName) {
    const dbLocal = await getDB();
    
    // 1. Cargar Local (Respuesta Instantánea)
    let items = await dbLocal.getAll(storeName); 

    // 2. Sync desde Nube (Si hay internet)
    // Esto es vital para que las categorías creadas en la PC 1 aparezcan en la PC 2
    if (navigator.onLine) {
      try {
        const path = this._getCollectionPath(storeName);
        const q = query(collection(db, path));
        const snapshot = await getDocs(q);
        
        const cloudItems = snapshot.docs.map(doc => doc.data());
        
        if (cloudItems.length > 0) {
            // Actualizar Local con lo nuevo de la Nube
            const tx = dbLocal.transaction(storeName, 'readwrite');
            
            // Borramos todo lo local viejo o hacemos merge? 
            // Merge es más seguro para no perder datos pendientes de subir
            for (const item of cloudItems) {
                await tx.store.put({ ...item, syncStatus: 'SYNCED' });
            }
            await tx.done;
            
            // Volver a leer la lista actualizada
            items = await dbLocal.getAll(storeName);
        }
      } catch (error) {
        // Si falla por permisos o red, solo mostramos warning y devolvemos lo local
        console.warn(`⚠️ Sync ${storeName} falló (usando local):`, error);
      }
    }
    
    // Ordenar alfabéticamente
    return items.sort((a, b) => a.name.localeCompare(b.name));
  },

  // ==========================================
  // 💾 GUARDADO (Sync Local + Nube Aislada)
  // ==========================================
  async save(storeName, item) {
    const dbLocal = await getDB();
    
    // Generamos ID consistente si es nuevo
    const newItem = {
      ...item,
      id: item.id || `${storeName}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      syncStatus: 'PENDING'
    };

    // 1. Guardar Localmente
    await dbLocal.put(storeName, newItem);

    // 2. Intentar subir a Nube (Si hay red)
    if (navigator.onLine) {
      try {
        const path = this._getCollectionPath(storeName);
        const { syncStatus, ...cloudData } = newItem;
        
        await setDoc(doc(db, path, newItem.id), cloudData, { merge: true });
        
        // Si subió bien, marcamos como SYNCED en local
        await dbLocal.put(storeName, { ...newItem, syncStatus: 'SYNCED' });
      } catch (e) {
        console.warn(`⚠️ Error sincronizando ${storeName} (quedará pendiente):`, e);
      }
    }

    return newItem;
  },

  // ==========================================
  // 🗑️ BORRADO (Sync Local + Nube Aislada)
  // ==========================================
  async delete(storeName, id) {
    const dbLocal = await getDB();
    
    // 1. Borrar Local
    await dbLocal.delete(storeName, id);

    // 2. Borrar de Nube (Si hay red)
    if (navigator.onLine) {
      try {
        const path = this._getCollectionPath(storeName);
        await deleteDoc(doc(db, path, id));
      } catch (e) {
        console.error(`Error eliminando de ${storeName} en nube:`, e);
      }
    }
  }
};