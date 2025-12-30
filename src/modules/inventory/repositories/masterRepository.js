import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore'; // 🔑 Clave para el aislamiento

export const masterRepository = {

  // ==========================================
  // 🛠️ HELPER PRIVADO
  // ==========================================
  _getCollectionPath(storeName) {
    const { user } = useAuthStore.getState();
    
    // Si no hay usuario o empresa, no podemos escribir en la nube
    if (!user || !user.companyId) {
        throw new Error(`⛔ Error de seguridad: Intento de acceso a ${storeName} sin empresa asignada.`);
    }

    // Retorna: companies/empresa_123/categories
    return `companies/${user.companyId}/${storeName}`;
  },

  // ==========================================
  // 📖 LECTURA (Local First)
  // ==========================================
  async getAll(storeName) {
    const dbLocal = await getDB();
    // storeName puede ser: 'categories', 'brands', 'suppliers'
    // IndexedDB ya está aislada porque SyncService solo baja lo correcto.
    return dbLocal.getAll(storeName);
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
        // Obtenemos la ruta privada de la empresa
        const path = this._getCollectionPath(storeName);
        
        const { syncStatus, ...cloudData } = newItem;
        
        // Guardamos en la sub-colección de la empresa
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
        // Obtenemos la ruta privada
        const path = this._getCollectionPath(storeName);
        
        // Borramos de la sub-colección
        await deleteDoc(doc(db, path, id));
      } catch (e) {
        console.error(`Error eliminando de ${storeName} en nube:`, e);
      }
    }
  }
};