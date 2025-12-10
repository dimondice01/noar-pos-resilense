import { getDB } from '../../../database/db';

export const salesRepository = {
  /**
   * Crea una venta y descuenta stock atómicamente.
   * Maneja la transacción ACID: Venta + Stock (Lotes FIFO Estricto) + Kardex.
   */
  async createSale(saleData) {
    const db = await getDB();
    
    // 🔥 INICIO DE TRANSACCIÓN MULTI-STORE
    const tx = db.transaction(['sales', 'products', 'movements'], 'readwrite');
    
    const salesStore = tx.objectStore('sales');
    const productsStore = tx.objectStore('products');
    const movementsStore = tx.objectStore('movements');

    // 1. Preparar datos de la venta
    const saleId = `sale_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString(); 

    const sale = {
      ...saleData,
      localId: saleId,
      date: saleData.date ? new Date(saleData.date).toISOString() : timestamp, 
      createdAt: timestamp,
      status: 'COMPLETED', 
      syncStatus: 'pending',
    };

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

        // B) LÓGICA DE LOTES (FIFO STRICTO - Por fecha de ingreso)
        let batches = product.batches || [];
        
        if (batches.length > 0) {
            // 1. Ordenar por fecha de creación (dateAdded). El más viejo primero.
            // Esto asegura FIFO estricto: Primero entra, primero sale.
            batches.sort((a, b) => {
                 const dateA = a.dateAdded ? new Date(a.dateAdded) : new Date(0);
                 const dateB = b.dateAdded ? new Date(b.dateAdded) : new Date(0);
                 return dateA - dateB;
            });

            let remaining = quantityToDeduct;
            
            // 2. Recorremos los lotes descontando
            batches = batches.map(batch => {
                if (remaining <= 0) return batch; // Ya descontamos todo

                const currentQty = parseFloat(batch.quantity);
                
                if (currentQty >= remaining) {
                    // Este lote cubre lo que falta
                    batch.quantity = currentQty - remaining;
                    remaining = 0;
                    return batch;
                } else {
                    // Consumimos todo este lote y pasamos al siguiente
                    remaining -= currentQty;
                    batch.quantity = 0;
                    return batch;
                }
            });
            
            // Nota: Mantenemos los lotes en 0 por trazabilidad, el filtro de visualización los ocultará.
        }

        // C) Recalcular Próximo Vencimiento VISIBLE para el futuro
        // Ahora que descontamos, buscamos cuál es el nuevo lote más antiguo con stock > 0
        let nextExpiry = product.expiryDate; // Fallback
        
        if (batches.length > 0) {
             // Filtramos solo los lotes que quedaron "vivos"
             const activeBatches = batches.filter(b => parseFloat(b.quantity) > 0);
             
             // Re-ordenamos por fecha de ingreso para ser consistentes con FIFO
             activeBatches.sort((a, b) => {
                 const dateA = a.dateAdded ? new Date(a.dateAdded) : new Date(0);
                 const dateB = b.dateAdded ? new Date(b.dateAdded) : new Date(0);
                 return dateA - dateB;
            });
            
            if (activeBatches.length > 0) {
                // El vencimiento visible será el del lote más viejo activo
                nextExpiry = activeBatches[0].expiryDate;
            }
        }

        // D) Actualizar Producto y MARCAR PARA SYNC
        await productsStore.put({
            ...product,
            stock: newStock,
            batches: batches, // Guardamos los lotes con las cantidades restadas
            expiryDate: nextExpiry, // Actualizamos la alerta de vencimiento
            updatedAt: timestamp,
            syncStatus: 'pending'
        });

        // E) Registrar en KARDEX (Auditoría)
        await movementsStore.put({
            productId: product.id,
            type: 'STOCK_OUT', 
            description: `Venta POS #${saleId.slice(-4)}`,
            amount: -quantityToDeduct, 
            date: timestamp,
            // Guardamos quién hizo la venta (Cajero)
            user: saleData.sellerName || 'Cajero', 
            refId: saleId 
        });
    }

    // 3. Guardar la Venta
    await salesStore.put(sale);

    // 4. Confirmar Transacción
    await tx.done;
    
    return sale;
  },

  /**
   * Obtiene Ventas del día + Cobros de Deuda del día.
   */
  async getTodayOperations() {
    const db = await getDB();
    const today = new Date();
    today.setHours(0,0,0,0);

    // 1. Obtener Ventas
    const allSales = await db.getAll('sales');
    const todaySales = allSales.filter(s => new Date(s.date) >= today);

    // 2. Obtener Cobros de Deuda
    const allMovements = await db.getAll('cash_movements');
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
  }
};