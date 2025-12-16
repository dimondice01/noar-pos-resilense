import { 
  collection, 
  writeBatch, 
  doc, 
  getDocs, 
  onSnapshot, 
  setDoc 
} from 'firebase/firestore'; 
import { db } from '../../../database/firebase'; 
import { salesRepository } from '../../sales/repositories/salesRepository';
import { productRepository } from '../../inventory/repositories/productRepository';
import { getDB } from '../../../database/db'; 

export const syncService = {
  
  // =================================================================
  // 📡 1. ESCUCHA ACTIVA (NUBE -> LOCAL)
  // =================================================================
  
  /**
   * Inicia los listeners de Firestore. 
   * Llama a esto al iniciar la App.
   */
  startRealTimeListeners() {
    console.log("📡 Conectando antena de sincronización en tiempo real...");

    // A. LISTENER DE CONFIGURACIÓN
    onSnapshot(collection(db, 'config'), async (snapshot) => {
      const localDb = await getDB();
      const tx = localDb.transaction('config', 'readwrite');
      
      let changes = 0;
      snapshot.docChanges().forEach((change) => {
        const data = change.doc.data();
        if (change.type === 'added' || change.type === 'modified') {
           tx.store.put({ key: change.doc.id, value: data.value });
           changes++;
        }
        if (change.type === 'removed') {
           tx.store.delete(change.doc.id);
        }
      });
      await tx.done;
      if(changes > 0) console.log(`⚙️ Configuración sincronizada (${changes} cambios).`);
    });

    // B. LISTENER DE PRODUCTOS
    onSnapshot(collection(db, 'products'), async (snapshot) => {
      const localDb = await getDB();
      const tx = localDb.transaction('products', 'readwrite');
      
      let pChanges = 0;
      snapshot.docChanges().forEach((change) => {
        // Evitamos rebote si soy yo el que acaba de subirlo
        if (change.type === 'added' || change.type === 'modified') {
           const data = change.doc.data();
           const productData = { 
             id: change.doc.id, 
             ...data, 
             syncStatus: 'synced' 
           };
           tx.store.put(productData);
           pChanges++;
        }
        if (change.type === 'removed') {
           tx.store.delete(change.doc.id);
        }
      });
      await tx.done;
      if(pChanges > 0) console.log(`📦 Inventario actualizado en vivo (${pChanges} productos).`);
    });
  },

  // =================================================================
  // 🚀 2. ESCRITURA GLOBAL (LOCAL -> NUBE DIRECTO)
  // =================================================================

  async pushGlobalConfig(key, value) {
    try {
      await setDoc(doc(db, 'config', key), { 
        value, 
        updatedAt: new Date().toISOString() 
      });
      
      const localDb = await getDB();
      await localDb.put('config', { key, value });
      
      return true;
    } catch (error) {
      console.error("Error subiendo configuración:", error);
      const localDb = await getDB();
      await localDb.put('config', { key, value });
      return false;
    }
  },

  // =================================================================
  // 🔄 3. CICLO DE SINCRONIZACIÓN (SUBIDA POR LOTES)
  // =================================================================

  /**
   * ORQUESTADOR PRINCIPAL
   */
  async syncUp() { 
    return this.syncAll();
  },

  async syncAll() { 
    if (!navigator.onLine) return { sales: 0, products: 0, downloaded: 0 };

    console.log("🔄 SYNC: Ejecutando ciclo de subida...");
    
    try {
        // 1. Subir Ventas
        const salesResult = await this.syncPendingSales();
        
        // 2. Subir Productos
        const productsResult = await this.syncPendingProducts();

        // 3. Bajada Pasiva (Opcional, los listeners ya hacen esto)
        let downloadResult = 0;
        try {
            // downloadResult = await this.downloadProductsFromCloud();
        } catch (downloadError) {
            console.warn("⚠️ Bajada manual omitida.");
        }

        if (salesResult.synced > 0 || productsResult.synced > 0) {
            console.log(`✅ SYNC EXITOSO: 📤 ${salesResult.synced} Ventas | 📤 ${productsResult.synced} Productos`);
        }
        
        return { 
          sales: salesResult.synced, 
          products: productsResult.synced,
          downloaded: downloadResult
        };
    } catch (error) {
        console.error("❌ SYNC ERROR CRÍTICO:", error);
        return { sales: 0, products: 0, downloaded: 0 };
    }
  },

  /**
   * 📤 SYNC VENTAS (Con Chunking)
   */
  async syncPendingSales() {
    const localDb = await getDB();
    const allSales = await salesRepository.getTodaySales(); 
    
    const pendingSales = allSales.filter(s => 
        s.syncStatus === 'pending' || s.syncStatus === 'PENDING'
    );

    if (pendingSales.length === 0) return { synced: 0 };

    console.log(`📤 Subiendo ${pendingSales.length} ventas...`);
    
    // Dividimos en lotes de 450
    const chunks = this.chunkArray(pendingSales, 450);
    let totalSynced = 0;

    for (const batchSales of chunks) {
        const batch = writeBatch(db);
        const salesCollection = collection(db, 'sales');
        const syncedIds = [];

        for (const sale of batchSales) {
            const docRef = doc(salesCollection); 
            const { localId, syncStatus, ...cleanSale } = sale;
            
            // Sanitización básica
            const finalSale = Object.keys(cleanSale).reduce((acc, key) => {
                acc[key] = cleanSale[key] === undefined ? null : cleanSale[key];
                return acc;
            }, {});
            
            batch.set(docRef, {
                ...finalSale,
                date: new Date(cleanSale.date).toISOString(), 
                firestoreId: docRef.id,
                syncedAt: new Date().toISOString(),
                origin: 'POS_LOCAL_01' 
            });
            syncedIds.push(sale.localId);
        }

        await batch.commit();

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
        totalSynced += batchSales.length;
    }

    return { synced: totalSynced };
  },

  /**
   * 📦 SYNC PRODUCTOS (Con Chunking y Sanitización Anti-Crash)
   */
  async syncPendingProducts() {
    const pendingProducts = await productRepository.getPendingSync();

    if (pendingProducts.length === 0) return { synced: 0 };

    console.log(`📦 Subiendo ${pendingProducts.length} cambios de inventario...`);
    
    // 🔥 CHUNKING: Lotes de 450 para respetar límite de Firebase (500)
    const chunks = this.chunkArray(pendingProducts, 450);
    let totalSynced = 0;
    let chunkIndex = 1;

    for (const chunk of chunks) {
        console.log(`   cloud_upload: Procesando lote ${chunkIndex}/${chunks.length}...`);
        
        const batch = writeBatch(db);
        const productsCollection = collection(db, 'products');
        const syncedIds = [];

        for (const product of chunk) {
            const docRef = doc(productsCollection, product.id);
            const { syncStatus, ...dataToUpload } = product;

            // 🧹 SANITIZACIÓN: Convertir 'undefined' a 'null'
            const cleanData = Object.keys(dataToUpload).reduce((acc, key) => {
                acc[key] = dataToUpload[key] === undefined ? null : dataToUpload[key];
                return acc;
            }, {});

            const payload = product.deleted 
                ? { ...cleanData, active: false, deleted: true, lastUpdated: new Date().toISOString() }
                : { ...cleanData, lastUpdated: new Date().toISOString() };

            batch.set(docRef, payload, { merge: true });
            syncedIds.push(product.id);
        }

        await batch.commit();
        await productRepository.markAsSynced(syncedIds);

        totalSynced += chunk.length;
        chunkIndex++;
    }

    return { synced: totalSynced };
  },

  /**
   * 📥 BAJADA MASIVA (Respaldo)
   */
  async downloadProductsFromCloud() {
    const productsCollection = collection(db, 'products');
    const snapshot = await getDocs(productsCollection);
    
    if (snapshot.empty) return 0;

    const cloudProducts = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            ...data,
            syncStatus: 'synced',
        };
    });

    await productRepository.saveAll(cloudProducts);
    return cloudProducts.length;
  },

  // 🛠️ HELPER PARA DIVIDIR ARRAYS
  chunkArray(myArray, chunk_size){
      var results = [];
      while (myArray.length) {
          results.push(myArray.splice(0, chunk_size));
      }
      return results;
  }
};