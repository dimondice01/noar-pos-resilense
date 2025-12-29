import { 
  collection, 
  writeBatch, 
  doc, 
  getDocs, 
  onSnapshot, 
  setDoc,
  query
} from 'firebase/firestore'; 
import { db } from '../../../database/firebase'; 
import { salesRepository } from '../../sales/repositories/salesRepository';
import { productRepository } from '../../inventory/repositories/productRepository';
import { getDB } from '../../../database/db'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; // 🔑 IMPORTANTE: Para saber quién está logueado

export const syncService = {
  
  // Array para guardar las suscripciones y poder cancelarlas al salir
  _unsubscribes: [],

  // =================================================================
  // 🛠️ HELPER: SANITIZACIÓN PROFUNDA
  // =================================================================
  _deepSanitize(obj) {
    if (obj === undefined) return null;
    if (obj === null) return null;
    
    if (typeof obj === 'object') {
      if (obj instanceof Date) return obj.toISOString();
      if (Array.isArray(obj)) {
        return obj.map(v => this._deepSanitize(v));
      }
      const res = {};
      for (const key in obj) {
        res[key] = this._deepSanitize(obj[key]);
      }
      return res;
    }
    return obj;
  },

  // =================================================================
  // 🛠️ HELPER: OBTENER ID EMPRESA
  // =================================================================
  _getCompanyId() {
    const { user } = useAuthStore.getState();
    if (!user || !user.companyId) {
        console.warn("⛔ SyncService: No hay empresa asignada. Abortando operación en nube.");
        return null;
    }
    return user.companyId;
  },

  // =================================================================
  // 📡 1. ESCUCHA ACTIVA (NUBE -> LOCAL)
  // =================================================================
  
  startRealTimeListeners() {
    // 1. Limpiar listeners anteriores para evitar duplicados
    this.stopListeners();

    const companyId = this._getCompanyId();
    if (!companyId) return;

    console.log(`📡 Conectando antena de sincronización para: ${companyId}`);

    // A. LISTENER DE CONFIGURACIÓN (Aislado por empresa)
    // Ruta: companies/{id}/config
    const configQuery = query(collection(db, 'companies', companyId, 'config'));
    
    const unsubConfig = onSnapshot(configQuery, async (snapshot) => {
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
    }, (error) => console.error("Error listener config:", error));

    this._unsubscribes.push(unsubConfig);

    // B. LISTENER DE PRODUCTOS (Aislado por empresa)
    // Ruta: companies/{id}/products
    const productsQuery = query(collection(db, 'companies', companyId, 'products'));

    const unsubProducts = onSnapshot(productsQuery, async (snapshot) => {
      const localDb = await getDB();
      const tx = localDb.transaction('products', 'readwrite');
      
      let pChanges = 0;
      snapshot.docChanges().forEach((change) => {
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
    }, (error) => console.error("Error listener productos:", error));

    this._unsubscribes.push(unsubProducts);
  },

  stopListeners() {
      if (this._unsubscribes.length > 0) {
          this._unsubscribes.forEach(unsub => unsub());
          this._unsubscribes = [];
          console.log("🔌 Listeners desconectados.");
      }
  },

  // =================================================================
  // 🚀 2. ESCRITURA GLOBAL (LOCAL -> NUBE DIRECTO)
  // =================================================================

  async pushGlobalConfig(key, value) {
    const companyId = this._getCompanyId();
    if (!companyId) return false;

    try {
      // Ruta: companies/{id}/config/{key}
      await setDoc(doc(db, 'companies', companyId, 'config', key), { 
        value, 
        updatedAt: new Date().toISOString() 
      });
      
      const localDb = await getDB();
      await localDb.put('config', { key, value });
      
      return true;
    } catch (error) {
      console.error("Error subiendo configuración:", error);
      // Fallback local
      const localDb = await getDB();
      await localDb.put('config', { key, value });
      return false;
    }
  },

  // =================================================================
  // 🔄 3. CICLO DE SINCRONIZACIÓN (SUBIDA POR LOTES)
  // =================================================================

  async syncUp() { 
    return this.syncAll();
  },

  async syncAll() { 
    if (!navigator.onLine) return { sales: 0, products: 0 };

    // Verificamos empresa antes de intentar subir nada
    const companyId = this._getCompanyId();
    if (!companyId) return { sales: 0, products: 0 };

    console.log("🔄 SYNC: Ejecutando ciclo de subida...");
    
    try {
        const salesResult = await this.syncPendingSales(companyId);
        const productsResult = await this.syncPendingProducts(companyId);

        if (salesResult.synced > 0 || productsResult.synced > 0) {
            console.log(`✅ SYNC EXITOSO: 📤 ${salesResult.synced} Ventas | 📤 ${productsResult.synced} Productos`);
        }
        
        return { 
          sales: salesResult.synced, 
          products: productsResult.synced
        };
    } catch (error) {
        console.error("❌ SYNC ERROR CRÍTICO:", error);
        return { sales: 0, products: 0 };
    }
  },

  /**
   * 📤 SYNC VENTAS
   */
  async syncPendingSales(companyId) {
    const localDb = await getDB();
    const allSales = await salesRepository.getTodaySales(); 
    
    const pendingSales = allSales.filter(s => 
        s.syncStatus === 'pending' || s.syncStatus === 'PENDING'
    );

    if (pendingSales.length === 0) return { synced: 0 };

    console.log(`📤 Subiendo ${pendingSales.length} ventas a ${companyId}...`);
    
    const chunks = this.chunkArray(pendingSales, 450);
    let totalSynced = 0;

    for (const batchSales of chunks) {
        const batch = writeBatch(db);
        // Ruta: companies/{id}/sales
        const salesCollection = collection(db, 'companies', companyId, 'sales');
        const syncedIds = [];

        for (const sale of batchSales) {
            const docRef = doc(salesCollection); 
            const { localId, syncStatus, ...cleanSale } = sale;
            const finalSale = this._deepSanitize(cleanSale);
            
            batch.set(docRef, {
                ...finalSale,
                date: new Date(cleanSale.date).toISOString(), 
                firestoreId: docRef.id,
                syncedAt: new Date().toISOString(),
                origin: 'POS_WEB' 
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
   * 📦 SYNC PRODUCTOS
   */
  async syncPendingProducts(companyId) {
    const pendingProducts = await productRepository.getPendingSync();

    if (pendingProducts.length === 0) return { synced: 0 };

    console.log(`📦 Subiendo ${pendingProducts.length} cambios de inventario a ${companyId}...`);
    
    const chunks = this.chunkArray(pendingProducts, 450);
    let totalSynced = 0;

    for (const chunk of chunks) {
        const batch = writeBatch(db);
        // Ruta: companies/{id}/products
        const productsCollection = collection(db, 'companies', companyId, 'products');
        const syncedIds = [];

        for (const product of chunk) {
            // Usamos el mismo ID local para el documento en Firestore
            const docRef = doc(productsCollection, product.id);
            const { syncStatus, ...dataToUpload } = product;
            const cleanData = this._deepSanitize(dataToUpload);

            const payload = product.deleted 
                ? { ...cleanData, active: false, deleted: true, lastUpdated: new Date().toISOString() }
                : { ...cleanData, lastUpdated: new Date().toISOString() };

            batch.set(docRef, payload, { merge: true });
            syncedIds.push(product.id);
        }

        await batch.commit();
        await productRepository.markAsSynced(syncedIds);
        totalSynced += chunk.length;
    }
    
    return { synced: totalSynced };
  },

  // 🛠️ HELPER ARRAY
  chunkArray(myArray, chunk_size){
      var results = [];
      const arrayCopy = [...myArray];
      while (arrayCopy.length) {
          results.push(arrayCopy.splice(0, chunk_size));
      }
      return results;
  }
};