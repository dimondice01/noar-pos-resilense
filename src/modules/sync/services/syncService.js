import { collection, writeBatch, doc, getDocs, query, where, orderBy, limit } from 'firebase/firestore'; 
import { db } from '../../../database/firebase'; 
import { getDB } from '../../../database/db'; 
import { productRepository } from '../../inventory/repositories/productRepository';

// 🔥 CONFIGURACIÓN
const COLLECTION_NAME = 'sales'; 

export const syncService = {
  /**
   * 🔄 ORQUESTADOR PRINCIPAL
   * Ejecuta la sincronización completa de Ventas, Inventario, Maestros y Movimientos.
   */
  async syncUp() { 
    if (!navigator.onLine) return { sales: 0, products: 0, downloaded: 0 };

    try {
        // ====================================================================
        // 1. SUBIDA (UPLOAD) - PRIORIDAD: RESCATAR DATOS VIEJOS
        // ====================================================================
        
        // A. Ventas y Productos (Lógica específica)
        const salesUp   = await this.syncPendingSales();
        const prodsUp   = await this.syncPendingProducts();
        
        // B. Maestros y Movimientos (Lógica Genérica "Agresiva")
        const catsUp    = await this.uploadCollection('categories', 50);
        const brandsUp  = await this.uploadCollection('brands', 50);     
        const suppsUp   = await this.uploadCollection('suppliers', 50);  
        
        const movesUp   = await this.uploadCollection('movements', 200);

        // ====================================================================
        // 2. BAJADA (DOWNLOAD) - PRIORIDAD: MANTENER AL DÍA OTRAS PCs
        // ====================================================================
        
        // A. Maestros (Con Fusión Inteligente para evitar duplicados)
        await this.downloadGeneric('categories');
        await this.downloadGeneric('brands');    
        await this.downloadGeneric('suppliers'); 

        // B. Inventario y Precios
        await this.downloadProductsFromCloud();

        // C. Sándwich (Historial + Reciente)
        await this.downloadSmart('sales', 'date');
        
        // 
        
        await this.downloadSmart('movements', 'date');

        // Log resumen
        const totalUp = salesUp + prodsUp + catsUp + brandsUp + suppsUp + movesUp;
        if (totalUp > 0) {
             console.log(`✅ SYNC UP: Ventas:${salesUp} | Maestros:${catsUp+brandsUp+suppsUp} | Movs:${movesUp}`);
        }
        
        return { sales: salesUp, products: prodsUp };

    } catch (error) {
        console.error("❌ SYNC ERROR CRÍTICO:", error);
        return { sales: 0, products: 0 };
    }
  },

  // ===========================================================================
  // 📤 SECCIÓN DE SUBIDA GENÉRICA (LA SOLUCIÓN PARA DATOS VIEJOS)
  // ===========================================================================

  async uploadCollection(collectionName, batchSize) {
    const localDb = await getDB();
    
    // Protección: Si la tabla no existe en la PC del cliente, no hacemos nada
    if (!localDb.objectStoreNames.contains(collectionName)) return 0;

    const allItems = await localDb.getAll(collectionName); 
    
    // 🔥 EL FILTRO DE RESCATE: Agarra 'pending' y también datos viejos (undefined)
    const pending = allItems.filter(i => i.syncStatus !== 'synced');

    if (pending.length === 0) return 0;

    const batch = writeBatch(db);
    const cloudRef = collection(db, collectionName); 
    const syncedIds = [];
    
    const batchItems = pending.slice(0, batchSize);

    for (const item of batchItems) {
      let docId = item.id || item.localId; 
      if (!docId) continue; 

      const docRef = doc(cloudRef, docId.toString());
      const { syncStatus, localId, ...dataToUpload } = item;
      
      const cleanData = { ...dataToUpload };
      if (cleanData.date instanceof Date) cleanData.date = cleanData.date.toISOString();
      if (cleanData.createdAt instanceof Date) cleanData.createdAt = cleanData.createdAt.toISOString();
      if (cleanData.updatedAt instanceof Date) cleanData.updatedAt = cleanData.updatedAt.toISOString();

      batch.set(docRef, {
          ...cleanData,
          firestoreId: docRef.id,
          syncedAt: new Date().toISOString(),
          origin: 'PC_LOCAL' 
      });
      syncedIds.push(docId); 
    }

    if (syncedIds.length === 0) return 0;

    await batch.commit();

    const tx = localDb.transaction(collectionName, 'readwrite');
    for (const id of syncedIds) {
      let s = await tx.store.get(id); 
      if (s) { 
          s.syncStatus = 'synced'; 
          tx.store.put(s); 
      }
    }
    await tx.done;

    return syncedIds.length;
  },

  // ===========================================================================
  // 📤 SUBIDA ESPECÍFICA (VENTAS Y PRODUCTOS)
  // ===========================================================================

  async syncPendingSales() {
    const localDb = await getDB();
    const allSales = await localDb.getAll('sales'); 
    const pendingSales = allSales.filter(s => s.syncStatus !== 'synced');

    if (pendingSales.length === 0) return 0;
    
    const batch = writeBatch(db);
    const salesCollection = collection(db, COLLECTION_NAME);
    const syncedIds = [];
    const MAX_UPLOAD_BATCH = 450; 

    const batchSales = pendingSales.slice(0, MAX_UPLOAD_BATCH);

    for (const sale of batchSales) {
      const docRef = doc(salesCollection, sale.localId); 
      const { localId, syncStatus, ...cleanSale } = sale;
      
      batch.set(docRef, {
          ...cleanSale,
          date: typeof cleanSale.date === 'string' ? cleanSale.date : new Date(cleanSale.date).toISOString(), 
          firestoreId: docRef.id,
          syncedAt: new Date().toISOString(),
          origin: 'PC_LOCAL' 
      });
      syncedIds.push(sale.localId);
    }

    await batch.commit();

    const tx = localDb.transaction('sales', 'readwrite');
    for (const id of syncedIds) {
      const s = await tx.store.get(id);
      if (s) { 
          s.syncStatus = 'synced'; 
          s.firestoreId = id; 
          tx.store.put(s); 
      }
    }
    await tx.done;

    return syncedIds.length;
  },

  async syncPendingProducts() {
    const pendingProducts = await productRepository.getPendingSync();
    if (pendingProducts.length === 0) return 0;

    const batch = writeBatch(db);
    const productsCollection = collection(db, 'products');
    const syncedIds = [];

    for (const product of pendingProducts) {
      const docRef = doc(productsCollection, product.id);
      const { syncStatus, ...dataToUpload } = product;

      if (product.deleted) {
          batch.set(docRef, { ...dataToUpload, active: false, deleted: true, lastUpdated: new Date().toISOString() }, { merge: true });
      } else {
          batch.set(docRef, { ...dataToUpload, lastUpdated: new Date().toISOString() }, { merge: true });
      }
      syncedIds.push(product.id);
    }

    await batch.commit();
    await productRepository.markAsSynced(syncedIds);
    return pendingProducts.length;
  },

  // ===========================================================================
  // 📥 SECCIÓN DE BAJADA INTELIGENTE (ANTI-DUPLICADOS)
  // ===========================================================================

  /**
   * 📥 BAJADA GENÉRICA CON FUSIÓN (Categories, Brands, Suppliers)
   * Si encuentra un elemento con el mismo nombre pero distinto ID,
   * borra el local y guarda el de la nube para unificar.
   */
  async downloadGeneric(collectionName) {
    const localDb = await getDB();
    if (!localDb.objectStoreNames.contains(collectionName)) return;

    const snap = await getDocs(collection(db, collectionName));
    if (snap.empty) return;

    // Traemos todo lo local para comparar nombres
    const allLocalItems = await localDb.getAll(collectionName);
    
    const tx = localDb.transaction(collectionName, 'readwrite');
    
    for (const d of snap.docs) {
        const cloudItem = d.data();
        const cloudId = d.id;
        
        // 1. Buscamos coincidencia exacta de ID
        const existsById = allLocalItems.find(i => String(i.id) === String(cloudId));
        
        if (existsById) {
            // Actualizamos normal
            await tx.store.put({ ...existsById, ...cloudItem, id: cloudId, syncStatus: 'synced' });
        } else {
            // 2. Buscamos coincidencia por NOMBRE (Fusión)
            // Ej: Local="Bebidas"(ID:1) vs Nube="Bebidas"(ID:abc) -> Gana Nube
            const duplicateByName = allLocalItems.find(i => 
                i.name && cloudItem.name && 
                i.name.trim().toLowerCase() === cloudItem.name.trim().toLowerCase()
            );

            if (duplicateByName) {
                // Borramos el duplicado local viejo
                await tx.store.delete(duplicateByName.id);
                // Guardamos el nuevo con ID de nube, preservando datos
                await tx.store.put({ 
                    ...duplicateByName, 
                    ...cloudItem, 
                    id: cloudId, 
                    syncStatus: 'synced' 
                });
                console.log(`♻️ Fusión Anti-Duplicado: ${cloudItem.name}`);
            } else {
                // Es nuevo de verdad
                await tx.store.put({ ...cloudItem, id: cloudId, syncStatus: 'synced' });
            }
        }
    }
    await tx.done;
  },

  async downloadAllCategories() {
      await this.downloadGeneric('categories');
  },

  async downloadProductsFromCloud() {
    const productsCollection = collection(db, 'products');
    const snapshot = await getDocs(productsCollection);
    if (snapshot.empty) return 0;
    const cloudProducts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), syncStatus: 'synced' }));
    await productRepository.saveAll(cloudProducts);
    return cloudProducts.length;
  },

  async downloadSmart(collectionName, fieldDate = 'date') {
    const localDb = await getDB();
    const cloudRef = collection(db, collectionName);
    let newestDate = null;
    let oldestDate = null;
    
    const tx = localDb.transaction(collectionName, 'readonly');
    try {
        const index = tx.store.index(fieldDate);
        const cursorNew = await index.openCursor(null, 'prev');
        if (cursorNew) newestDate = cursorNew.value[fieldDate];
        const cursorOld = await index.openCursor(null, 'next');
        if (cursorOld) oldestDate = cursorOld.value[fieldDate];
    } catch(e) { return; }
    await tx.done;

    let forwardQuery;
    if (!newestDate) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        forwardQuery = query(cloudRef, where(fieldDate, '>=', startDate.toISOString()), orderBy(fieldDate, 'desc'), limit(100));
    } else {
        forwardQuery = query(cloudRef, where(fieldDate, '>', newestDate), orderBy(fieldDate, 'asc'), limit(50));
    }

    const snapForward = await getDocs(forwardQuery);
    if (!snapForward.empty) await this._saveBatch(collectionName, snapForward.docs);

    if (oldestDate) {
        const backwardQuery = query(cloudRef, where(fieldDate, '<', oldestDate), orderBy(fieldDate, 'desc'), limit(100));
        const snapBack = await getDocs(backwardQuery);
        if (!snapBack.empty) await this._saveBatch(collectionName, snapBack.docs);
    }
  },

  async _saveBatch(storeName, docs) {
      const localDb = await getDB();
      const tx = localDb.transaction(storeName, 'readwrite');
      for (const d of docs) {
          const exists = await tx.store.get(d.id);
          if (!exists) {
              const data = d.data();
              const key = data.localId || data.id || d.id;
              await tx.store.put({
                  ...data,
                  [storeName === 'sales' ? 'localId' : 'id']: key, 
                  syncStatus: 'synced',
                  downloadedAt: new Date().toISOString()
              });
          }
      }
      await tx.done;
  }
};