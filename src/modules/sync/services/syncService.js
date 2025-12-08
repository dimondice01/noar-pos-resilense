import { collection, writeBatch, doc } from 'firebase/firestore';
import { db } from '../../../database/firebase'; // Firestore
import { salesRepository } from '../../sales/repositories/salesRepository';
import { productRepository } from '../../inventory/repositories/productRepository';
import { getDB } from '../../../database/db'; // Solo para Ventas por ahora

export const syncService = {
  /**
   * ORQUESTADOR PRINCIPAL
   * Sube Ventas y Actualiza Stock en la Nube
   */
  async syncUp() { 
    // Verificación rápida de red
    if (!navigator.onLine) return { sales: 0, products: 0 };

    console.log("🔄 SYNC: Iniciando sincronización subida...");
    
    try {
        // 1. Subir Ventas Pendientes
        const salesResult = await this.syncPendingSales();
        
        // 2. Subir Cambios de Productos (Precios, Stock, Bajas)
        const productsResult = await this.syncPendingProducts();

        if (salesResult.synced > 0 || productsResult.synced > 0) {
            console.log(`✅ SYNC: Finalizado. Ventas: ${salesResult.synced}, Productos: ${productsResult.synced}`);
        }
        
        return { 
          sales: salesResult.synced, 
          products: productsResult.synced 
        };
    } catch (error) {
        console.error("❌ SYNC ERROR:", error);
        return { sales: 0, products: 0 };
    }
  },

  /**
   * 📤 SYNC VENTAS
   * (Mantenemos lógica inline por ahora hasta refactorizar salesRepository)
   */
  async syncPendingSales() {
    const localDb = await getDB();
    const allSales = await salesRepository.getTodaySales(); 
    
    // Filtramos usando minúscula 'pending' por consistencia
    const pendingSales = allSales.filter(s => 
        s.syncStatus === 'pending' || s.syncStatus === 'PENDING'
    );

    if (pendingSales.length === 0) return { synced: 0 };

    console.log(`📤 Subiendo ${pendingSales.length} ventas...`);
    
    const batch = writeBatch(db);
    const salesCollection = collection(db, 'sales');
    const syncedIds = [];

    for (const sale of pendingSales) {
      const docRef = doc(salesCollection); // Genera ID nuevo de Firestore
      
      // Limpiamos datos locales que no sirven en la nube
      const { localId, syncStatus, ...cleanSale } = sale;
      
      batch.set(docRef, {
          ...cleanSale,
          // 🔥 FIX CRÍTICO: Aseguramos formato ISO String para que el Dashboard lo encuentre
          date: new Date(cleanSale.date).toISOString(), 
          
          firestoreId: docRef.id,
          syncedAt: new Date().toISOString(),
          origin: 'POS_LOCAL_01' // Ideal parametrizar esto en settings
      });
      syncedIds.push(sale.localId);
    }

    await batch.commit();

    // Actualizar estado local a 'synced'
    const tx = localDb.transaction('sales', 'readwrite');
    for (const id of syncedIds) {
      const s = await tx.store.get(id);
      if (s) { 
          s.syncStatus = 'synced'; 
          s.firestoreId = s.firestoreId || 'uploaded'; 
          tx.store.put(s); 
      }
    }
    await tx.done;

    return { synced: pendingSales.length };
  },

  /**
   * 📦 SYNC PRODUCTOS
   * Usa la nueva lógica robusta del Repository
   */
  async syncPendingProducts() {
    // 1. Obtener pendientes desde el repositorio (abstracción limpia)
    const pendingProducts = await productRepository.getPendingSync();

    if (pendingProducts.length === 0) return { synced: 0 };

    console.log(`📦 Sincronizando ${pendingProducts.length} productos con la nube...`);
    
    const batch = writeBatch(db);
    const productsCollection = collection(db, 'products');
    const syncedIds = [];

    for (const product of pendingProducts) {
      const docRef = doc(productsCollection, product.id);
      
      // Separamos la metadata local del objeto real de negocio
      const { syncStatus, ...dataToUpload } = product;

      // LÓGICA DE BORRADO (Soft Delete)
      if (product.deleted) {
          // Si está borrado localmente, actualizamos flags en nube
          batch.set(docRef, {
              ...dataToUpload,
              active: false,
              deleted: true,
              lastUpdated: new Date().toISOString()
          }, { merge: true });
      } else {
          // Actualización normal (Stock, Precio, Nombre)
          batch.set(docRef, {
              ...dataToUpload,
              lastUpdated: new Date().toISOString()
          }, { merge: true });
      }

      syncedIds.push(product.id);
    }

    // Ejecutar Batch
    await batch.commit();

    // 2. Avisar al repositorio que ya se subieron (él se encarga de limpiar/actualizar IDB)
    await productRepository.markAsSynced(syncedIds);

    return { synced: pendingProducts.length };
  }
};