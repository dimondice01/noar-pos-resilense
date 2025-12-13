import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc } from 'firebase/firestore';

// Helper para subir a la nube sin bloquear la UI
const syncToCloud = async (collectionName, data) => {
  if (!navigator.onLine) return; 
  try {
    const { syncStatus, ...cloudData } = data;
    await setDoc(doc(db, collectionName, data.id || data.localId), {
      ...cloudData,
      firestoreId: data.id || data.localId,
      syncedAt: new Date().toISOString(),
      origin: 'POS_TABLET'
    }, { merge: true });
    
    // Si es una venta, actualizamos su estado local a SYNCED
    if (collectionName === 'sales') {
        const dbLocal = await getDB();
        await dbLocal.put('sales', { ...data, syncStatus: 'SYNCED' });
    }
  } catch (e) {
    console.warn(`⚠️ Error sincronizando ${collectionName}:`, e);
  }
};

export const salesRepository = {
  /**
   * Crea una venta y descuenta stock atómicamente (Local + Cloud).
   * Maneja la transacción ACID: Venta + Stock (Lotes FIFO) + Kardex.
   */
  async createSale(saleData) {
    const dbLocal = await getDB();
    
    // 🔥 INICIO DE TRANSACCIÓN MULTI-STORE
    const tx = dbLocal.transaction(['sales', 'products', 'movements'], 'readwrite');
    
    const salesStore = tx.objectStore('sales');
    const productsStore = tx.objectStore('products');
    const movementsStore = tx.objectStore('movements');

    // 1. Preparar datos de la venta
    const saleId = `sale_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString(); 

    const sale = {
      ...saleData,
      localId: saleId, // Usamos esto como ID en Firestore
      date: saleData.date ? new Date(saleData.date).toISOString() : timestamp, 
      createdAt: timestamp,
      status: 'COMPLETED', 
      syncStatus: 'pending', // Se marcará SYNCED si sube bien
    };

    // Array para recolectar movimientos y subirlos luego
    const movementsToSync = [];

    // 2. Procesar cada ítem del carrito (Descuento de Stock)
    for (const item of saleData.items) {
        const product = await productsStore.get(item.id);
        
        if (!product) {
            console.warn(`Producto ID ${item.id} no encontrado en DB, saltando stock...`);
            continue;
        }

        const quantityToDeduct = item.isWeighable ? parseFloat(item.quantity) : parseInt(item.quantity);
        
        // A) Descuento del Stock Total
        const newStock = (parseFloat(product.stock || 0) - quantityToDeduct);

        // B) LÓGICA DE LOTES (FIFO STRICTO)
        let batches = product.batches || [];
        
        if (batches.length > 0) {
            batches.sort((a, b) => {
                 const dateA = a.dateAdded ? new Date(a.dateAdded) : new Date(0);
                 const dateB = b.dateAdded ? new Date(b.dateAdded) : new Date(0);
                 return dateA - dateB;
            });

            let remaining = quantityToDeduct;
            
            batches = batches.map(batch => {
                if (remaining <= 0) return batch;

                const currentQty = parseFloat(batch.quantity);
                
                if (currentQty >= remaining) {
                    batch.quantity = currentQty - remaining;
                    remaining = 0;
                    return batch;
                } else {
                    remaining -= currentQty;
                    batch.quantity = 0;
                    return batch;
                }
            });
        }

        // C) Recalcular Próximo Vencimiento
        let nextExpiry = product.expiryDate;
        if (batches.length > 0) {
             const activeBatches = batches.filter(b => parseFloat(b.quantity) > 0);
             activeBatches.sort((a, b) => {
                 const dateA = a.dateAdded ? new Date(a.dateAdded) : new Date(0);
                 const dateB = b.dateAdded ? new Date(b.dateAdded) : new Date(0);
                 return dateA - dateB;
            });
            if (activeBatches.length > 0) {
                nextExpiry = activeBatches[0].expiryDate;
            }
        }

        // D) Actualizar Producto Localmente (Marcado para Sync)
        // Nota: No subimos el producto aquí para no saturar la red con N peticiones.
        // El syncService se encargará de subir los productos 'pending' en lote.
        await productsStore.put({
            ...product,
            stock: newStock,
            batches: batches,
            expiryDate: nextExpiry,
            updatedAt: timestamp,
            syncStatus: 'pending' 
        });

        // E) Registrar en KARDEX (Auditoría)
        // Generamos ID explícito para poder sincronizarlo
        const movementId = `mov_sale_${saleId}_${item.id}`;
        const movement = {
            id: movementId,
            productId: product.id,
            type: 'STOCK_OUT', 
            description: `Venta POS #${saleId.slice(-4)}`,
            amount: -quantityToDeduct, 
            date: timestamp,
            user: saleData.sellerName || 'Cajero', 
            refId: saleId,
            syncStatus: 'pending'
        };

        await movementsStore.put(movement);
        movementsToSync.push(movement);
    }

    // 3. Guardar la Venta
    await salesStore.put(sale);

    // 4. Confirmar Transacción Local
    await tx.done;
    
    // 5. 🚀 SINCRONIZACIÓN CLOUD (Fire & Forget)
    // No esperamos a que termine para devolver la respuesta a la UI
    syncToCloud('sales', sale);
    movementsToSync.forEach(m => syncToCloud('movements', m));

    return sale;
  },

  /**
   * Obtiene Ventas del día + Cobros de Deuda del día.
   */
  async getTodayOperations() {
    const dbLocal = await getDB();
    const today = new Date();
    today.setHours(0,0,0,0);

    // 1. Obtener Ventas
    const allSales = await dbLocal.getAll('sales');
    const todaySales = allSales.filter(s => new Date(s.date) >= today);

    // 2. Obtener Cobros de Deuda
    const allMovements = await dbLocal.getAll('cash_movements');
    const todayReceipts = allMovements.filter(m => 
        new Date(m.date) >= today && 
        m.type === 'DEPOSIT' && 
        (m.description || '').includes('Cobro Cta Cte') 
    );

    // 3. Normalizar
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

    // 4. Unir y Ordenar
    const combined = [...todaySales, ...normalizedReceipts];
    return combined.sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  async getTodaySales() {
    return this.getTodayOperations();
  },

  async forcePendingState() {
    const dbLocal = await getDB();
    const tx = dbLocal.transaction('sales', 'readwrite');
    const store = tx.store;
    
    const allSales = await store.getAll();
    
    for (const sale of allSales) {
        sale.syncStatus = 'pending'; 
        store.put(sale);
    }
    
    await tx.done;
    return allSales.length;
  }
};