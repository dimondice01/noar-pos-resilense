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
   * Llama a esto al iniciar la App (ej: en App.jsx o MainLayout).
   */
  startRealTimeListeners() {
    console.log("📡 Conectando antena de sincronización en tiempo real...");

    // A. LISTENER DE CONFIGURACIÓN (PIN Maestro, Datos Empresa)
    // Si el Admin cambia el PIN en su casa, la tablet se entera al instante.
    onSnapshot(collection(db, 'config'), async (snapshot) => {
      const localDb = await getDB();
      const tx = localDb.transaction('config', 'readwrite');
      
      let changes = 0;
      snapshot.docChanges().forEach((change) => {
        const data = change.doc.data();
        if (change.type === 'added' || change.type === 'modified') {
           // Guardamos en local: { key: 'MASTER_PIN', value: '...' }
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

    // B. LISTENER DE PRODUCTOS (Stock y Precios)
    // Mantiene el inventario actualizado si hay movimientos en la web u otras cajas.
    onSnapshot(collection(db, 'products'), async (snapshot) => {
      const localDb = await getDB();
      
      // Procesamos cambios uno a uno para usar el repositorio (que maneja índices y lógica extra si la hubiera)
      // O vamos directo a IDB para velocidad. Aquí iremos directo a IDB pero respetando la estructura.
      const tx = localDb.transaction('products', 'readwrite');
      
      let pChanges = 0;
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
           const data = change.doc.data();
           // Importante: Marcar como 'synced' para evitar rebote (que el POS intente subirlo de nuevo)
           const productData = { 
             id: change.doc.id, 
             ...data, 
             syncStatus: 'synced' // lowerCase para consistencia con tu código
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

  /**
   * Guarda configuraciones críticas directamente en la nube.
   * Usado por securityService para cambiar el PIN.
   */
  async pushGlobalConfig(key, value) {
    try {
      // 1. Escribir en Firestore (La Verdad Absoluta)
      await setDoc(doc(db, 'config', key), { 
        value, 
        updatedAt: new Date().toISOString() 
      });
      
      // 2. Reflejo Local Inmediato (Optimistic UI)
      // Aunque el listener lo traería después, lo guardamos ya para que la UI no espere.
      const localDb = await getDB();
      await localDb.put('config', { key, value });
      
      return true;
    } catch (error) {
      console.error("Error subiendo configuración:", error);
      // Fallback: Si no hay internet, guardamos local para no bloquear al usuario,
      // pero sabiendo que no se propagó al admin remoto.
      const localDb = await getDB();
      await localDb.put('config', { key, value });
      return false;
    }
  },

  // =================================================================
  // 🔄 3. CICLO DE SINCRONIZACIÓN (SUBIDA + RESTAURACIÓN)
  // =================================================================

  /**
   * ORQUESTADOR PRINCIPAL
   * Sube Ventas y Novedades Locales.
   * (La bajada ahora es manejada principalmente por los listeners, 
   * pero mantenemos downloadProductsFromCloud como respaldo inicial).
   */
  async syncUp() { 
    if (!navigator.onLine) return { sales: 0, products: 0, downloaded: 0 };

    console.log("🔄 SYNC: Ejecutando ciclo de subida...");
    
    try {
        // 1. Subir Ventas Pendientes
        const salesResult = await this.syncPendingSales();
        
        // 2. Subir Cambios de Productos (Precios, Stock, Bajas)
        const productsResult = await this.syncPendingProducts();

        // 3. Bajada Pasiva (Opcional si tenemos listeners, pero útil para forzar refresh)
        // Lo dejamos para garantizar integridad al abrir la app o volver de offline.
        let downloadResult = 0;
        try {
            downloadResult = await this.downloadProductsFromCloud();
        } catch (downloadError) {
            console.warn("⚠️ Bajada manual omitida (Listeners activos o error red).");
        }

        if (salesResult.synced > 0 || productsResult.synced > 0) {
            console.log(`✅ SYNC: Subida completada. 📤 Ventas: ${salesResult.synced}, 📤 Prod: ${productsResult.synced}`);
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
   * 📤 SYNC VENTAS
   */
  async syncPendingSales() {
    const localDb = await getDB();
    const allSales = await salesRepository.getTodaySales(); 
    
    const pendingSales = allSales.filter(s => 
        s.syncStatus === 'pending' || s.syncStatus === 'PENDING'
    );

    if (pendingSales.length === 0) return { synced: 0 };

    console.log(`📤 Subiendo ${pendingSales.length} ventas...`);
    
    const batch = writeBatch(db);
    const salesCollection = collection(db, 'sales');
    const syncedIds = [];

    for (const sale of pendingSales) {
      const docRef = doc(salesCollection); 
      
      const { localId, syncStatus, ...cleanSale } = sale;
      
      batch.set(docRef, {
          ...cleanSale,
          date: new Date(cleanSale.date).toISOString(), 
          firestoreId: docRef.id,
          syncedAt: new Date().toISOString(),
          origin: 'POS_LOCAL_01' 
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
   * 📦 SYNC PRODUCTOS (Subida)
   */
  async syncPendingProducts() {
    const pendingProducts = await productRepository.getPendingSync();

    if (pendingProducts.length === 0) return { synced: 0 };

    console.log(`📦 Subiendo ${pendingProducts.length} cambios de producto...`);
    
    const batch = writeBatch(db);
    const productsCollection = collection(db, 'products');
    const syncedIds = [];

    for (const product of pendingProducts) {
      // Usamos el ID del producto como ID del documento para consistencia total
      const docRef = doc(productsCollection, product.id);
      
      const { syncStatus, ...dataToUpload } = product;

      if (product.deleted) {
          batch.set(docRef, {
              ...dataToUpload,
              active: false,
              deleted: true,
              lastUpdated: new Date().toISOString()
          }, { merge: true });
      } else {
          batch.set(docRef, {
              ...dataToUpload,
              lastUpdated: new Date().toISOString()
          }, { merge: true });
      }

      syncedIds.push(product.id);
    }

    await batch.commit();

    await productRepository.markAsSynced(syncedIds);

    return { synced: pendingProducts.length };
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
  }
};