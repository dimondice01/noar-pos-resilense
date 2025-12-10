import { getDB } from '../../../database/db';

export const productRepository = {
  // ==========================================
  // 📖 MÉTODOS DE LECTURA
  // ==========================================

  async getAll() {
    const db = await getDB();
    const all = await db.getAll('products');
    // Filtramos los que están marcados como borrados (Soft Delete)
    return all.filter(p => !p.deleted);
  },

  async findByCode(code) {
    const db = await getDB();
    const product = await db.getFromIndex('products', 'code', code);
    if (product && product.deleted) return null; // Si está borrado lógico, no lo devolvemos
    return product;
  },

  async getHistory(productId) {
    const db = await getDB();
    const allMovs = await db.getAllFromIndex('movements', 'productId', productId);
    return allMovs.sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  // ==========================================
  // ☁️ MÉTODOS PARA EL SYNC SERVICE
  // ==========================================

  // Obtiene todo lo que cambió y no ha subido a Firebase
  async getPendingSync() {
    const db = await getDB();
    const all = await db.getAll('products');
    // Esto podría optimizarse con un índice 'syncStatus', pero por ahora filter está bien
    return all.filter(p => p.syncStatus === 'pending');
  },

  // Marca como sincronizados (Status: synced)
  async markAsSynced(ids) {
    const db = await getDB();
    const tx = db.transaction('products', 'readwrite');
    const store = tx.objectStore('products');

    for (const id of ids) {
      const product = await store.get(id);
      if (product) {
        // Si estaba marcado para borrar y ya se subió, ahora sí lo borramos físico para limpiar espacio
        if (product.deleted) {
             await store.delete(id);
        } else {
             // Si es un producto normal, solo actualizamos el estado
             product.syncStatus = 'synced';
             await store.put(product);
        }
      }
    }
    await tx.done;
  },

  // ==========================================
  // ✍️ MÉTODOS DE ESCRITURA (Con Trazabilidad + Sync)
  // ==========================================

  async saveAll(products) {
    const db = await getDB();
    const tx = db.transaction('products', 'readwrite');
    const store = tx.objectStore('products');
    for (const product of products) {
      // Al importar masivamente, asumimos que ya vienen "bien" o definimos status
      store.put({ 
          ...product, 
          syncStatus: product.syncStatus || 'synced' // Asumimos synced si es carga masiva inicial
      });
    }
    return tx.done;
  },

  // 🔥 EL MÉTODO "ESPÍA" (Refactorizado para Sync y Lotes)
  async save(product) {
    const db = await getDB();
    const tx = db.transaction(['products', 'movements'], 'readwrite');
    const productStore = tx.objectStore('products');
    const movementStore = tx.objectStore('movements');

    // 1. Preparamos el ID
    const productId = product.id || crypto.randomUUID();
    
    // 2. Buscamos el estado ANTERIOR
    let oldProduct = null;
    if (product.id) {
        try {
            oldProduct = await productStore.get(product.id);
        } catch (e) { /* Es nuevo */ }
    }

    // 🔥 GESTIÓN DE LOTES INICIAL
    // Si el producto es nuevo, tiene stock inicial y fecha de vencimiento, 
    // creamos el primer lote automáticamente.
    let batches = product.batches || (oldProduct?.batches || []);

    if (!oldProduct && parseFloat(product.stock) > 0 && product.expiryDate) {
        batches = [{
            id: crypto.randomUUID(),
            quantity: parseFloat(product.stock),
            expiryDate: product.expiryDate,
            dateAdded: new Date().toISOString()
        }];
    }

    // 3. Preparamos el objeto a guardar
    const productToSave = {
      ...product,
      id: productId,
      batches: batches, // Guardamos los lotes
      updatedAt: new Date().toISOString(),
      syncStatus: 'pending', 
      deleted: false 
    };

    // 4. DETECTAR CAMBIOS Y GENERAR MOVIMIENTOS (KARDEX)
    const timestamp = new Date().toISOString(); 
    
    // Si no existía antes -> Es CREACIÓN
    if (!oldProduct) {
        movementStore.put({
            productId,
            type: 'CREATION',
            description: 'Producto dado de alta',
            user: 'Admin', 
            date: timestamp
        });
        
        if (productToSave.stock > 0) {
            movementStore.put({
                productId,
                type: 'STOCK_IN',
                description: `Stock inicial: ${productToSave.stock}`,
                amount: parseFloat(productToSave.stock),
                user: 'Admin',
                date: timestamp
            });
        }
    } else {
        // EDICIÓN
        
        // A) Cambio de PRECIO
        if (parseFloat(oldProduct.price) !== parseFloat(productToSave.price)) {
            movementStore.put({
                productId,
                type: 'PRICE_CHANGE',
                description: `Precio: $${oldProduct.price} ➝ $${productToSave.price}`,
                user: 'Admin',
                date: timestamp
            });
        }

        // B) Cambio de COSTO
        if (parseFloat(oldProduct.cost || 0) !== parseFloat(productToSave.cost || 0)) {
            movementStore.put({
                productId,
                type: 'COST_CHANGE',
                description: `Costo: $${oldProduct.cost || 0} ➝ $${productToSave.cost}`,
                user: 'Admin',
                date: timestamp
            });
        }

        // C) Ajuste Manual de STOCK (Edición directa desde el modal)
        if (parseFloat(oldProduct.stock) !== parseFloat(productToSave.stock)) {
            const diff = parseFloat(productToSave.stock) - parseFloat(oldProduct.stock);
            movementStore.put({
                productId,
                type: 'STOCK_ADJUST_' + (diff > 0 ? 'IN' : 'OUT'),
                description: `Ajuste manual: ${diff > 0 ? '+' : ''}${diff.toFixed(2)}`,
                amount: Math.abs(diff),
                user: 'Admin',
                date: timestamp
            });
        }
    }

    // 5. Guardar producto y confirmar transacción
    await productStore.put(productToSave);
    await tx.done;
    
    return productToSave;
  },

  // 🔥 NUEVO MÉTODO: INGRESO RÁPIDO DE STOCK (Botón "+")
  async addStock(productId, quantity, expiryDate) {
    const db = await getDB();
    const tx = db.transaction(['products', 'movements'], 'readwrite');
    const productStore = tx.objectStore('products');
    const movementStore = tx.objectStore('movements');

    const product = await productStore.get(productId);
    if (!product) throw new Error("Producto no encontrado");

    const qty = parseFloat(quantity);
    
    // 1. Actualizar Stock Total
    const newStock = (parseFloat(product.stock) || 0) + qty;

    // 2. Gestión de Lotes (Batches)
    let batches = product.batches || [];
    
    // Si entra stock positivo, creamos un nuevo lote
    if (qty > 0) {
        batches.push({
            id: crypto.randomUUID(),
            quantity: qty,
            expiryDate: expiryDate || null, 
            dateAdded: new Date().toISOString()
        });
    }

    // 3. Recalcular Fecha de Vencimiento Visible (La más próxima)
    // Filtramos lotes que tengan stock y fecha, ordenamos por fecha más cercana
    const activeBatchesWithDate = batches
        .filter(b => b.quantity > 0 && b.expiryDate)
        .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
    
    // La nueva fecha de alerta es la del lote que vence primero
    const nextExpiry = activeBatchesWithDate.length > 0 ? activeBatchesWithDate[0].expiryDate : product.expiryDate;

    const updatedProduct = {
        ...product,
        stock: newStock,
        batches: batches,
        expiryDate: nextExpiry, // Actualizamos la fecha visible para las alertas
        updatedAt: new Date().toISOString(),
        syncStatus: 'pending'
    };

    // 4. Guardar Movimiento en Historial
    await movementStore.put({
        productId,
        type: 'STOCK_IN',
        description: `Ingreso Rápido (+${qty}) ${expiryDate ? 'Vence: ' + expiryDate : ''}`,
        amount: qty,
        user: 'Admin',
        date: new Date().toISOString()
    });

    await productStore.put(updatedProduct);
    await tx.done;
  },

  // 🗑️ SOFT DELETE (Para poder sincronizar el borrado)
  async delete(id) {
    const db = await getDB();
    const tx = db.transaction('products', 'readwrite');
    const store = tx.objectStore('products');
    
    const product = await store.get(id);
    if (product) {
        // No borramos físico, marcamos para sync
        product.deleted = true;
        product.syncStatus = 'pending';
        product.updatedAt = new Date().toISOString();
        await store.put(product);
    }
    
    await tx.done;
  }
};