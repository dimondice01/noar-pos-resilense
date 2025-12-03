import { collection, addDoc, writeBatch, doc } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { salesRepository } from '../../sales/repositories/salesRepository';
import { getDB } from '../../../database/db';

export const syncService = {
  /**
   * Sube las ventas pendientes a la nube
   */
  async syncPendingSales() {
    const localDb = await getDB();
    
    // 1. Obtener ventas pendientes de IndexedDB
    // (Usamos un índice 'syncStatus' que creamos en db.js, o filtramos manualmente)
    const allSales = await salesRepository.getTodaySales(); 
    const pendingSales = allSales.filter(s => s.syncStatus === 'PENDING');

    if (pendingSales.length === 0) {
      return { synced: 0 };
    }

    console.log(`🔄 Sincronizando ${pendingSales.length} ventas...`);

    // 2. Usamos Batch (Lote) para eficiencia y atomicidad en Firestore
    const batch = writeBatch(db);
    const salesCollection = collection(db, 'sales');

    // Mapeo de promesas para actualizar IDB luego
    const syncedIds = [];

    try {
      for (const sale of pendingSales) {
        // Preparamos el documento para Firestore (quitamos datos locales innecesarios)
        const docRef = doc(salesCollection); // Generar ID de nube
        const saleToUpload = {
            ...sale,
            firestoreId: docRef.id,
            syncedAt: new Date(),
            syncStatus: 'SYNCED'
        };

        // Agregar al Batch de Firestore
        batch.set(docRef, saleToUpload);
        syncedIds.push({ localId: sale.localId, firestoreId: docRef.id });
      }

      // 3. Ejecutar subida a la nube (Todo o nada)
      await batch.commit();

      // 4. Si tuvo éxito, marcamos como SYNCED en local (IndexedDB)
      const tx = localDb.transaction('sales', 'readwrite');
      const store = tx.objectStore('sales');

      for (const item of syncedIds) {
        const sale = await store.get(item.localId);
        if (sale) {
          sale.syncStatus = 'SYNCED';
          sale.firestoreId = item.firestoreId;
          store.put(sale);
        }
      }
      await tx.done;

      console.log("✅ Sincronización completada.");
      return { synced: pendingSales.length };

    } catch (error) {
      console.error("❌ Error en sincronización:", error);
      throw error;
    }
  }
};