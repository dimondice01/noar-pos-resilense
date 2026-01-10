import { getDB } from '../../../database/db';
// 🔥 IMPORTS FIREBASE LEGACY
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { db as firestore } from '../../../database/firebase'; 

export const salesRepository = {
  /**
   * Crea una venta localmente y trata de subirla a la nube (Legacy).
   */
  async createSale(saleData) {
    const db = await getDB();
    
    // 🔥 INICIO DE TRANSACCIÓN LOCAL
    const tx = db.transaction(['sales', 'products', 'movements'], 'readwrite');
    const salesStore = tx.objectStore('sales');
    const productsStore = tx.objectStore('products');
    const movementsStore = tx.objectStore('movements');

    // 1. Preparar datos
    const saleId = `sale_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();

    const sale = {
      ...saleData,
      localId: saleId,
      date: saleData.date ? new Date(saleData.date).toISOString() : timestamp, 
      createdAt: timestamp,
      status: 'COMPLETED', 
      syncStatus: 'pending', // Siempre nace pendiente
      terminal: 'PC_LEGACY' 
    };

    // 2. Procesar ítems (Stock y Kardex Local)
    for (const item of saleData.items) {
        const product = await productsStore.get(item.id);
        if (!product) continue;

        const quantityToDeduct = item.isWeighable ? parseFloat(item.quantity) : parseInt(item.quantity);
        const newStock = (parseFloat(product.stock || 0) - quantityToDeduct);

        await productsStore.put({
            ...product,
            stock: newStock,
            updatedAt: timestamp,
            syncStatus: 'pending' 
        });

        await movementsStore.put({
            productId: product.id,
            type: 'STOCK_OUT', 
            description: `Venta POS #${saleId.slice(-4)}`,
            amount: -quantityToDeduct, 
            date: timestamp,
            user: saleData.client?.name || 'Cliente', 
            refId: saleId 
        });
    }

    // 3. Guardar Venta Local
    await salesStore.put(sale);
    await tx.done; 

    // ============================================================
    // ☁️ SYNC INMEDIATO (LEGACY - RAÍZ)
    // ============================================================
    if (navigator.onLine) {
        try {
            // 🔥 Subimos directo a la colección 'sales' (Raíz)
            await setDoc(doc(firestore, 'sales', saleId), {
                ...sale,
                syncStatus: 'synced',
                syncedAt: new Date().toISOString()
            });
            
            // Si subió OK, actualizamos localmente
            const db2 = await getDB();
            const tx2 = db2.transaction('sales', 'readwrite');
            const store2 = tx2.objectStore('sales');
            await store2.put({ ...sale, syncStatus: 'synced' });
            await tx2.done;
            
            console.log("✅ Venta subida a Firebase (Legacy).");
        } catch (error) {
            console.warn("⚠️ Falló subida inmediata (quedó pending).", error);
        }
    }

    return sale;
  },

  /**
   * Obtiene operaciones del día (Ventas + Cobros)
   */
  async getTodayOperations() {
    const db = await getDB();
    const today = new Date();
    today.setHours(0,0,0,0);

    const allSales = await db.getAll('sales');
    const todaySales = allSales.filter(s => new Date(s.date) >= today);

    const allMovements = await db.getAll('cash_movements');
    const todayReceipts = allMovements.filter(m => 
        new Date(m.date) >= today && 
        m.type === 'DEPOSIT' && 
        (m.description || '').includes('Cobro Cta Cte') 
    );

    const normalizedReceipts = todayReceipts.map(r => ({
        localId: r.referenceId || `rec_${r.id}`,
        date: r.date,
        total: r.amount,
        type: 'RECEIPT', 
        client: { name: r.description.split(': ')[1] || 'Cliente' },
        payment: { method: r.method || 'cash' },
        itemCount: 0, 
        items: [],
        afip: { status: 'SKIPPED' }
    }));

    const combined = [...todaySales, ...normalizedReceipts];
    return combined.sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  // Método legacy de compatibilidad
  async getTodaySales() {
      return this.getTodayOperations();
  },

  async forcePendingState() {
    const db = await getDB();
    const tx = db.transaction('sales', 'readwrite');
    const store = tx.store;
    const allSales = await store.getAll();
    for (const sale of allSales) {
        sale.syncStatus = 'pending';
        store.put(sale);
    }
    await tx.done;
    return allSales.length;
  },

  /**
   * 🔥 SYNC MASIVO DE PENDIENTES (LEGACY)
   * Busca todas las ventas 'pending' y las sube a /sales
   */
 async syncPendingSales() {
      if (!navigator.onLine) return 0;
      
      const db = await getDB();
      // 1. Traemos TODAS las ventas históricas
      const allSales = await db.getAll('sales');

      // 🔥 CAMBIO CLAVE: Filtramos todo lo que NO esté marcado como 'synced'.
      // Esto incluye 'pending', 'error', y las ventas viejas que tienen 'undefined'.
      const pendingSales = allSales.filter(s => s.syncStatus !== 'synced');

      if (pendingSales.length === 0) return 0;

      console.log(`🔄 Recuperando y subiendo ${pendingSales.length} ventas históricas...`);

      const batch = writeBatch(firestore);
      let count = 0;
      const MAX_BATCH_SIZE = 450; // Firestore permite max 500 por batch. Usamos margen.

      // Si son demasiadas (ej. 2000 ventas viejas), cortamos el array para no explotar
      const salesBatch = pendingSales.slice(0, MAX_BATCH_SIZE);

      for (const sale of salesBatch) {
          // 🔥 Referencia a la raíz /sales (Legacy)
          // Usamos localId para evitar duplicados. Si ya existe, lo sobrescribe/actualiza.
          const ref = doc(firestore, 'sales', sale.localId);
          
          const saleToUpload = { 
              ...sale, 
              syncStatus: 'synced',
              syncedAt: new Date().toISOString(),
              // Aseguramos que tenga fecha válida
              date: sale.date ? (typeof sale.date === 'string' ? sale.date : new Date(sale.date).toISOString()) : new Date().toISOString()
          }; 
          batch.set(ref, saleToUpload);
          count++;
      }

      try {
          await batch.commit();

          // Actualizar IDB Local para que no las vuelva a subir
          const tx = db.transaction('sales', 'readwrite');
          const store = tx.objectStore('sales');
          for (const sale of salesBatch) {
              await store.put({ ...sale, syncStatus: 'synced' });
          }
          await tx.done;
          
          console.log(`✅ ÉXITO: ${count} ventas antiguas sincronizadas con Firebase.`);
          
          // Si quedaron más ventas por subir (había más de 450), devolvemos count.
          // El hook useAutoSync volverá a ejecutar esto en 30seg y subirá el siguiente lote.
          return count;

      } catch (error) {
          console.error("❌ Error sync masivo:", error);
          return 0;
      }
  }
};