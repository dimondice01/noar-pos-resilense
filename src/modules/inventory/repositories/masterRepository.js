import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';

export const masterRepository = {
  // ==========================================
  // 📖 LECTURA (Local First)
  // ==========================================
  async getAll(storeName) {
    const dbLocal = await getDB();
    // storeName puede ser: 'categories', 'brands', 'suppliers'
    return dbLocal.getAll(storeName);
  },

  // ==========================================
  // 💾 GUARDADO (Sync Local + Nube)
  // ==========================================
  async save(storeName, item) {
    const dbLocal = await getDB();
    
    // Generamos ID consistente si es nuevo
    // (Importante para que el ID sea el mismo en Local y Firestore)
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
        const { syncStatus, ...cloudData } = newItem;
        
        // Usamos setDoc con merge para no sobrescribir datos extra si los hubiera
        await setDoc(doc(db, storeName, newItem.id), cloudData, { merge: true });
        
        // Si subió bien, marcamos como SYNCED en local
        await dbLocal.put(storeName, { ...newItem, syncStatus: 'SYNCED' });
      } catch (e) {
        console.warn(`⚠️ Error sincronizando ${storeName} (quedará pendiente):`, e);
      }
    }

    return newItem;
  },

  // ==========================================
  // 🗑️ BORRADO (Sync Local + Nube)
  // ==========================================
  async delete(storeName, id) {
    const dbLocal = await getDB();
    
    // 1. Borrar Local
    await dbLocal.delete(storeName, id);

    // 2. Borrar de Nube (Si hay red)
    if (navigator.onLine) {
      try {
        await deleteDoc(doc(db, storeName, id));
      } catch (e) {
        console.error(`Error eliminando de ${storeName} en nube:`, e);
        // Nota: Si falla aquí, el item ya se borró localmente. 
        // En un sistema perfecto usaríamos "soft delete" (deleted: true) para sincronizar el borrado después.
        // Por ahora asumimos que el borrado local es suficiente para la UX inmediata.
      }
    }
  }
};