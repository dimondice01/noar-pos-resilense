import { collection, writeBatch, doc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { salesRepository } from '../../sales/repositories/salesRepository';
import { productRepository } from '../../inventory/repositories/productRepository';
import { getDB } from '../../../database/db';

export const syncService = {
  /**
   * ORQUESTADOR PRINCIPAL
   * Sube Ventas y Actualiza Stock en la Nube
   */
  async syncAll() {
    console.log("🔄 Iniciando Ciclo de Sincronización...");
    
    // 1. Subir Ventas Pendientes
    const salesResult = await this.syncPendingSales();
    
    // 2. Subir Cambios de Stock (Productos 'Sucios')
    const productsResult = await this.syncPendingProducts();

    return { 
      sales: salesResult.synced, 
      products: productsResult.synced 
    };
  },

  /**
   * Subir ventas (Ya lo teníamos)
   */
  async syncPendingSales() {
    const localDb = await getDB();
    const allSales = await salesRepository.getTodaySales(); 
    const pendingSales = allSales.filter(s => s.syncStatus === 'PENDING');

    if (pendingSales.length === 0) return { synced: 0 };

    console.log(`📤 Subiendo ${pendingSales.length} ventas...`);
    const batch = writeBatch(db);
    const salesCollection = collection(db, 'sales');
    const syncedIds = [];

    for (const sale of pendingSales) {
      const docRef = doc(salesCollection);
      // Limpiamos datos locales antes de subir
      const { localId, syncStatus, ...cleanSale } = sale;
      
      batch.set(docRef, {
          ...cleanSale,
          firestoreId: docRef.id,
          syncedAt: new Date().toISOString(),
          origin: 'POS_LOCAL_01' // Ideal para multi-sucursal
      });
      syncedIds.push(sale.localId);
    }

    await batch.commit();

    // Marcar como SYNCED localmente
    const tx = localDb.transaction('sales', 'readwrite');
    for (const id of syncedIds) {
      const s = await tx.store.get(id);
      if (s) { s.syncStatus = 'SYNCED'; tx.store.put(s); }
    }
    await tx.done;

    return { synced: pendingSales.length };
  },

  /**
   * 🔥 NUEVO: Subir productos cuyo stock cambió localmente
   */
  async syncPendingProducts() {
    const localDb = await getDB();
    const allProducts = await productRepository.getAll();
    
    // Filtramos productos que se hayan modificado recientemente
    // (Para hacerlo simple, asumimos que si updatedAt > lastSync, se sube.
    //  Por ahora, subiremos todos los que tengan cambios locales pendientes si implementamos un flag,
    //  o más sencillo: subimos los que tengan stock diferente a la nube.
    //  ESTRATEGIA ENTERPRISE: Agregaremos un flag 'syncStatus' a los productos en productRepository).
    
    const pendingProducts = allProducts.filter(p => p.syncStatus === 'PENDING');

    if (pendingProducts.length === 0) return { synced: 0 };

    console.log(`📦 Actualizando stock nube de ${pendingProducts.length} productos...`);
    
    // Firebase Batch (Límite 500 ops, aquí lo simplificamos)
    const batch = writeBatch(db);
    const productsCollection = collection(db, 'products');

    const syncedIds = [];

    for (const product of pendingProducts) {
      // Usamos el ID del producto como ID del documento en Firestore para consistencia
      const docRef = doc(productsCollection, product.id); 
      
      const { syncStatus, ...cleanProduct } = product;

      batch.set(docRef, {
        ...cleanProduct,
        lastUpdated: new Date().toISOString()
      }, { merge: true }); // Merge para no pisar otros datos si hubiera

      syncedIds.push(product.id);
    }

    await batch.commit();

    // Marcar como SYNCED
    const tx = localDb.transaction('products', 'readwrite');
    for (const id of syncedIds) {
      const p = await tx.store.get(id);
      if (p) { p.syncStatus = 'SYNCED'; tx.store.put(p); }
    }
    await tx.done;

    return { synced: pendingProducts.length };
  }
};