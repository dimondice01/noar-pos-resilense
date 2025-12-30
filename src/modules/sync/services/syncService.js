import { 
  collection, 
  writeBatch, 
  doc, 
  onSnapshot, 
  setDoc,
  query
} from 'firebase/firestore'; 
import { db } from '../../../database/firebase'; 
import { salesRepository } from '../../sales/repositories/salesRepository';
import { productRepository } from '../../inventory/repositories/productRepository';
import { getDB } from '../../../database/db'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 

export const syncService = {
  
  _unsubscribes: [],

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

  _getCompanyId() {
    const { user } = useAuthStore.getState();
    if (!user || !user.companyId || user.companyId === 'undefined') {
        return null;
    }
    return user.companyId;
  },

  // =================================================================
  // 📡 ESCUCHA ACTIVA (NUBE -> LOCAL) - CON FILTRO ANTI-DUPLICADOS
  // =================================================================
  
  startRealTimeListeners() {
    this.stopListeners();

    const companyId = this._getCompanyId();
    if (!companyId) return;

    console.log(`📡 Sincronizando datos de: ${companyId}`);

    // A. CONFIGURACIÓN
    const configQuery = query(collection(db, 'companies', companyId, 'config'));
    const unsubConfig = onSnapshot(configQuery, async (snapshot) => {
      try {
          const localDb = await getDB();
          const tx = localDb.transaction('config', 'readwrite');
          snapshot.docChanges().forEach((change) => {
            const data = change.doc.data();
            if (change.type === 'added' || change.type === 'modified') tx.store.put({ key: change.doc.id, value: data.value });
            if (change.type === 'removed') tx.store.delete(change.doc.id);
          });
          await tx.done;
      } catch (e) { console.error("Error sync config:", e); }
    });
    this._unsubscribes.push(unsubConfig);

    // B. PRODUCTOS (BATCH + FILTRO DE MEMORIA)
    const productsQuery = query(collection(db, 'companies', companyId, 'products'));

    const unsubProducts = onSnapshot(productsQuery, async (snapshot) => {
      if (snapshot.empty) return;

      const rawToPut = []; // Guardamos todo en bruto primero
      const toDelete = [];

      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
           const data = change.doc.data();
           rawToPut.push({ id: change.doc.id, ...data, syncStatus: 'synced' });
        }
        if (change.type === 'removed') toDelete.push(change.doc.id);
      });

      // 🛑 PASO CRÍTICO: DEDUPLICACIÓN EN MEMORIA
      // Si la nube manda 2 productos con el mismo 'code', nos quedamos con el último.
      // Esto evita el ConstraintError antes de tocar la base de datos.
      const uniqueMap = new Map();
      
      rawToPut.forEach(item => {
          // Si tiene código, usamos el código como llave única para filtrar
          if (item.code) {
             uniqueMap.set(item.code, item); // Sobrescribe si ya existía uno con ese código
          } else {
             uniqueMap.set(item.id, item); // Fallback al ID
          }
      });

      // Convertimos el mapa limpio de vuelta a array
      const toPut = Array.from(uniqueMap.values());

      if (toPut.length === 0 && toDelete.length === 0) return;

      const localDb = await getDB();

      // 🛡️ INTENTO 1: BATCH RÁPIDO (Ahora es seguro porque filtramos antes)
      try {
          const tx = localDb.transaction('products', 'readwrite');
          await Promise.all([
              ...toPut.map(item => tx.store.put(item)),
              ...toDelete.map(id => tx.store.delete(id))
          ]);
          await tx.done;
          console.log(`📦 Inventario: ${toPut.length} items sincronizados.`);
      
      } catch (err) {
          // Si AÚN ASÍ falla (por conflicto con datos viejos en DB), activamos reparación
          if (err.name === 'ConstraintError' || err.message?.includes('Constraint')) {
              console.warn("⚠️ Conflicto persistente. Activando modo Auto-Reparación...");
              await this._fallbackSafeSync(toPut, localDb);
          } else if (err.name !== 'AbortError') {
              console.error("❌ Error sync productos:", err);
          }
      }
    }, (error) => {
        if (error.code !== 'permission-denied') console.error("Error listener:", error);
    });

    this._unsubscribes.push(unsubProducts);
  },

  // 🛠️ HELPER: MODO AUTO-REPARACIÓN
  async _fallbackSafeSync(items, db) {
      let fixedCount = 0;
      for (const item of items) {
          try {
              const tx = db.transaction('products', 'readwrite');
              await tx.store.put(item);
              await tx.done;
          } catch (e) {
              if (e.name === 'ConstraintError') {
                  const txFix = db.transaction('products', 'readwrite');
                  const index = txFix.store.index('code'); 
                  const conflictingItem = await index.get(item.code);
                  
                  if (conflictingItem) {
                      await txFix.store.delete(conflictingItem.id); // Borra el viejo
                      await txFix.store.put(item); // Pone el nuevo
                      fixedCount++;
                  }
                  await txFix.done;
              }
          }
      }
      if (fixedCount > 0) console.log(`✅ Auto-Reparación completada: ${fixedCount} conflictos resueltos.`);
  },

  stopListeners() {
      if (this._unsubscribes.length > 0) {
          this._unsubscribes.forEach(unsub => unsub());
          this._unsubscribes = [];
      }
  },

  // =================================================================
  // 🚀 ESCRITURA GLOBAL
  // =================================================================

  async pushGlobalConfig(key, value) {
    const companyId = this._getCompanyId();
    if (!companyId) return false;

    try {
      await setDoc(doc(db, 'companies', companyId, 'config', key), { 
        value, 
        updatedAt: new Date().toISOString() 
      });
      const localDb = await getDB();
      await localDb.put('config', { key, value });
      return true;
    } catch (error) {
      console.error("Error config:", error);
      return false;
    }
  },

  async syncUp() { return this.syncAll(); },

  async syncAll() { 
    if (!navigator.onLine) return { sales: 0, products: 0 };
    const companyId = this._getCompanyId();
    if (!companyId) return { sales: 0, products: 0 };

    try {
        const salesResult = await this.syncPendingSales(companyId);
        const productsResult = await this.syncPendingProducts(companyId);

        if (salesResult.synced > 0 || productsResult.synced > 0) {
            console.log(`✅ SUBIDA: ${salesResult.synced} Ventas, ${productsResult.synced} Productos.`);
        }
        return { sales: salesResult.synced, products: productsResult.synced };
    } catch (error) {
        console.error("❌ Sync Error:", error);
        return { sales: 0, products: 0 };
    }
  },

  async syncPendingSales(companyId) {
    const localDb = await getDB();
    const allSales = await salesRepository.getTodaySales(); 
    const pendingSales = allSales.filter(s => s.syncStatus === 'pending' || s.syncStatus === 'PENDING');

    if (pendingSales.length === 0) return { synced: 0 };

    const chunks = this.chunkArray(pendingSales, 450);
    let totalSynced = 0;

    for (const batchSales of chunks) {
        const batch = writeBatch(db);
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
            if (s) { s.syncStatus = 'synced'; s.firestoreId = s.firestoreId || 'uploaded'; tx.store.put(s); }
        }
        await tx.done;
        totalSynced += batchSales.length;
    }
    return { synced: totalSynced };
  },

  async syncPendingProducts(companyId) {
    const pendingProducts = await productRepository.getPendingSync();
    if (pendingProducts.length === 0) return { synced: 0 };

    const chunks = this.chunkArray(pendingProducts, 450);
    let totalSynced = 0;

    for (const chunk of chunks) {
        const batch = writeBatch(db);
        const productsCollection = collection(db, 'companies', companyId, 'products');
        const syncedIds = [];

        for (const product of chunk) {
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

  chunkArray(myArray, chunk_size){
      var results = [];
      const arrayCopy = [...myArray];
      while (arrayCopy.length) {
          results.push(arrayCopy.splice(0, chunk_size));
      }
      return results;
  }
};