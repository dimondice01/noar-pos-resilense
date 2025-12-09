import { collection, writeBatch, doc, getDocs } from 'firebase/firestore'; // 🔥 Agregamos getDocs
import { db } from '../../../database/firebase'; 
import { salesRepository } from '../../sales/repositories/salesRepository';
import { productRepository } from '../../inventory/repositories/productRepository';
import { getDB } from '../../../database/db'; 

export const syncService = {
  /**
   * ORQUESTADOR PRINCIPAL
   * Sube Ventas, Actualiza Stock y DESCARTA Novedades de la Nube
   */
  async syncUp() { 
    // Verificación rápida de red
    if (!navigator.onLine) return { sales: 0, products: 0, downloaded: 0 };

    console.log("🔄 SYNC: Iniciando ciclo completo (Subida + Bajada)...");
    
    try {
        // 1. Subir Ventas Pendientes
        const salesResult = await this.syncPendingSales();
        
        // 2. Subir Cambios de Productos (Precios, Stock, Bajas)
        const productsResult = await this.syncPendingProducts();

        // 3. 🔥 BAJADA: Traer novedades de la nube (Para ver lo que se cargó en web)
        let downloadResult = 0;
        try {
            downloadResult = await this.downloadProductsFromCloud();
        } catch (downloadError) {
            console.warn("⚠️ Error en bajada de productos:", downloadError);
        }

        if (salesResult.synced > 0 || productsResult.synced > 0 || downloadResult > 0) {
            console.log(`✅ SYNC: Finalizado. 📤 Ventas: ${salesResult.synced}, 📤 Prod: ${productsResult.synced}, 📥 Bajados: ${downloadResult}`);
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
          // 🔥 FIX CRÍTICO: Aseguramos formato ISO String
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
    // 1. Obtener pendientes desde el repositorio
    const pendingProducts = await productRepository.getPendingSync();

    if (pendingProducts.length === 0) return { synced: 0 };

    console.log(`📦 Sincronizando ${pendingProducts.length} productos con la nube...`);
    
    const batch = writeBatch(db);
    const productsCollection = collection(db, 'products');
    const syncedIds = [];

    for (const product of pendingProducts) {
      const docRef = doc(productsCollection, product.id);
      
      const { syncStatus, ...dataToUpload } = product;

      // LÓGICA DE BORRADO (Soft Delete en Nube)
      if (product.deleted) {
          batch.set(docRef, {
              ...dataToUpload,
              active: false,
              deleted: true, // Marcamos como borrado en nube
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

    // 2. Avisar al repositorio (él se encarga de borrar físicamente si deleted=true)
    await productRepository.markAsSynced(syncedIds);

    return { synced: pendingProducts.length };
  },

  /**
   * 📥 BAJADA DE PRODUCTOS (Nuevo)
   * Trae todo lo de Firestore para mantener la PWA actualizada
   */
  async downloadProductsFromCloud() {
    // console.log("⬇️ Verificando actualizaciones en la nube...");
    const productsCollection = collection(db, 'products');
    
    // NOTA: Para producción con miles de productos, aquí deberíamos usar 
    // where('lastUpdated', '>', lastSyncDate). Por ahora traemos todo para garantizar consistencia.
    const snapshot = await getDocs(productsCollection);
    
    if (snapshot.empty) return 0;

    const cloudProducts = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            ...data,
            syncStatus: 'synced', // Vienen de la nube, están al día
            // Si en la nube está soft-deleted, aquí llegará como deleted=true
            // y el productRepository.saveAll lo guardará. 
            // Luego el getAll filtra los deleted, así que desaparecen visualmente. Correcto.
        };
    });

    // Guardamos masivamente en local
    await productRepository.saveAll(cloudProducts);
    
    return cloudProducts.length;
  }
};