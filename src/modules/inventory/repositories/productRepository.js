import { getDB } from '../../../database/db';

export const productRepository = {
  // ==========================================
  // 📖 MÉTODOS DE LECTURA
  // ==========================================

  async getAll() {
    const db = await getDB();
    return db.getAll('products');
  },

  async findByCode(code) {
    const db = await getDB();
    return db.getFromIndex('products', 'code', code);
  },

  // ✅ NUEVO: Obtener el historial de un producto específico
  async getHistory(productId) {
    const db = await getDB();
    const allMovs = await db.getAllFromIndex('movements', 'productId', productId);
    // Ordenamos: Lo más reciente primero
    return allMovs.sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  // ==========================================
  // ✍️ MÉTODOS DE ESCRITURA (Con Trazabilidad)
  // ==========================================

  async saveAll(products) {
    const db = await getDB();
    const tx = db.transaction('products', 'readwrite');
    const store = tx.objectStore('products');
    for (const product of products) {
      store.put(product);
    }
    return tx.done;
  },

  // 🔥 EL MÉTODO "ESPÍA"
  async save(product) {
    const db = await getDB();
    // Abrimos transacción que toca ambas tablas para seguridad
    const tx = db.transaction(['products', 'movements'], 'readwrite');
    const productStore = tx.objectStore('products');
    const movementStore = tx.objectStore('movements');

    // 1. Preparamos el ID
    const productId = product.id || crypto.randomUUID();
    
    // 2. Buscamos el estado ANTERIOR (si existe)
    let oldProduct = null;
    if (product.id) {
        try {
            oldProduct = await productStore.get(product.id);
        } catch (e) { /* Es nuevo */ }
    }

    // 3. Preparamos el objeto a guardar
    const productToSave = {
      ...product,
      id: productId,
      updatedAt: new Date()
    };

    // 4. DETECTAR CAMBIOS Y GENERAR MOVIMIENTOS (KARDEX)
    const timestamp = new Date();
    
    // Si no existía antes -> Es CREACIÓN
    if (!oldProduct) {
        movementStore.put({
            productId,
            type: 'CREATION',
            description: 'Producto dado de alta',
            user: 'Admin',
            date: timestamp
        });
        // Si nace con stock -> Ingreso Inicial
        if (productToSave.stock > 0) {
            movementStore.put({
                productId,
                type: 'STOCK_IN',
                description: `Stock inicial: ${productToSave.stock}`,
                amount: productToSave.stock,
                user: 'Admin',
                date: timestamp
            });
        }
    } else {
        // Si ya existía -> Es EDICIÓN (Comparamos campos)

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

        // C) Ajuste Manual de STOCK
        // (Nota: Las ventas restan stock por otro lado, esto es para ajustes manuales en el modal)
        if (parseFloat(oldProduct.stock) !== parseFloat(productToSave.stock)) {
            const diff = parseFloat(productToSave.stock) - parseFloat(oldProduct.stock);
            movementStore.put({
                productId,
                type: diff > 0 ? 'STOCK_ADJUST_IN' : 'STOCK_ADJUST_OUT',
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

  async delete(id) {
    const db = await getDB();
    // Podríamos agregar un movimiento 'DELETION' aquí si quisiéramos auditoría forense
    return db.delete('products', id);
  }
};