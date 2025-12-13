import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

// Helper para subir sin bloquear
const syncToCloud = async (collection, data) => {
  if (!navigator.onLine) return;
  try {
    const { syncStatus, ...cloudData } = data;
    await setDoc(doc(db, collection, data.id), {
      ...cloudData,
      firestoreId: data.id,
      syncedAt: new Date().toISOString()
    }, { merge: true });
    
    // Marcar como synced localmente
    const dbLocal = await getDB();
    const storeName = collection === 'movements' ? 'movements' : 'products'; // Mapeo simple
    await dbLocal.put(storeName, { ...data, syncStatus: 'SYNCED' });
  } catch (e) {
    console.warn(`⚠️ Error sync ${collection}:`, e);
  }
};

export const productRepository = {
  // ==========================================
  // 📖 MÉTODOS DE LECTURA (Local First)
  // ==========================================

  async getAll() {
    const db = await getDB();
    const all = await db.getAll('products');
    return all.filter(p => !p.deleted);
  },

  async findByCode(code) {
    const db = await getDB();
    const product = await db.getFromIndex('products', 'code', code);
    if (product && product.deleted) return null;
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

  async getPendingSync() {
    const db = await getDB();
    const all = await db.getAll('products');
    return all.filter(p => p.syncStatus === 'pending' || p.syncStatus === 'PENDING');
  },

  async markAsSynced(ids) {
    const db = await getDB();
    const tx = db.transaction('products', 'readwrite');
    const store = tx.objectStore('products');

    for (const id of ids) {
      const product = await store.get(id);
      if (product) {
        if (product.deleted) {
             await store.delete(id);
        } else {
             product.syncStatus = 'synced'; // lowercase para estándar
             await store.put(product);
        }
      }
    }
    await tx.done;
  },

  // ==========================================
  // ✍️ MÉTODOS DE ESCRITURA (Cloud Enabled)
  // ==========================================

  async saveAll(products) {
    const db = await getDB();
    const tx = db.transaction('products', 'readwrite');
    const store = tx.objectStore('products');
    for (const product of products) {
      store.put({ 
          ...product, 
          syncStatus: product.syncStatus || 'synced' 
      });
    }
    return tx.done;
  },

  // 🔥 EL MÉTODO "ESPÍA" (Local + Nube)
  async save(product) {
    const dbLocal = await getDB();
    
    // 1. Preparar ID
    const productId = product.id || crypto.randomUUID();
    
    // 2. Obtener estado previo (para movimientos)
    let oldProduct = null;
    try { oldProduct = await dbLocal.get('products', productId); } catch (e) {}

    // 3. Gestión de Lotes
    let batches = product.batches || (oldProduct?.batches || []);
    if (!oldProduct && parseFloat(product.stock) > 0 && product.expiryDate) {
        batches = [{
            id: crypto.randomUUID(),
            quantity: parseFloat(product.stock),
            expiryDate: product.expiryDate,
            dateAdded: new Date().toISOString()
        }];
    }

    // 4. Objeto Producto Final
    const productToSave = {
      ...product,
      id: productId,
      batches: batches,
      updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING',
      deleted: false
    };

    // 5. Detectar Cambios y Generar Movimientos
    const movementsToSave = [];
    const timestamp = new Date().toISOString();
    
    if (!oldProduct) {
        // Creación
        movementsToSave.push({
            id: `mov_${Date.now()}_create`,
            productId,
            type: 'CREATION',
            description: 'Producto dado de alta',
            user: 'Admin', 
            date: timestamp
        });
        if (productToSave.stock > 0) {
            movementsToSave.push({
                id: `mov_${Date.now()}_init`,
                productId,
                type: 'STOCK_IN',
                description: `Stock inicial: ${productToSave.stock}`,
                amount: parseFloat(productToSave.stock),
                user: 'Admin',
                date: timestamp
            });
        }
    } else {
        // Edición
        if (parseFloat(oldProduct.price) !== parseFloat(productToSave.price)) {
            movementsToSave.push({
                id: `mov_${Date.now()}_price`,
                productId,
                type: 'PRICE_CHANGE',
                description: `Precio: $${oldProduct.price} ➝ $${productToSave.price}`,
                user: 'Admin',
                date: timestamp
            });
        }
        if (parseFloat(oldProduct.stock) !== parseFloat(productToSave.stock)) {
            const diff = parseFloat(productToSave.stock) - parseFloat(oldProduct.stock);
            movementsToSave.push({
                id: `mov_${Date.now()}_adj`,
                productId,
                type: 'STOCK_ADJUST_' + (diff > 0 ? 'IN' : 'OUT'),
                description: `Ajuste manual: ${diff > 0 ? '+' : ''}${diff.toFixed(2)}`,
                amount: Math.abs(diff),
                user: 'Admin',
                date: timestamp
            });
        }
    }

    // 6. Transacción Local
    const tx = dbLocal.transaction(['products', 'movements'], 'readwrite');
    await tx.objectStore('products').put(productToSave);
    for (const mov of movementsToSave) {
        await tx.objectStore('movements').put({ ...mov, syncStatus: 'PENDING' });
    }
    await tx.done;

    // 7. Sincronizar Nube (Background)
    syncToCloud('products', productToSave);
    movementsToSave.forEach(mov => syncToCloud('movements', mov)); // Subir historial también (Opcional pero recomendado)

    return productToSave;
  },

  // 🔥 INGRESO RÁPIDO DE STOCK (Cloud Enabled)
  async addStock(productId, quantity, expiryDate) {
    const dbLocal = await getDB();
    
    const product = await dbLocal.get('products', productId);
    if (!product) throw new Error("Producto no encontrado");

    const qty = parseFloat(quantity);
    const newStock = (parseFloat(product.stock) || 0) + qty;

    // Lotes
    let batches = product.batches || [];
    if (qty > 0) {
        batches.push({
            id: crypto.randomUUID(),
            quantity: qty,
            expiryDate: expiryDate || null, 
            dateAdded: new Date().toISOString()
        });
    }

    // Recalcular Vencimiento Visible
    const activeBatchesWithDate = batches
        .filter(b => b.quantity > 0 && b.expiryDate)
        .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
    const nextExpiry = activeBatchesWithDate.length > 0 ? activeBatchesWithDate[0].expiryDate : product.expiryDate;

    const updatedProduct = {
        ...product,
        stock: newStock,
        batches: batches,
        expiryDate: nextExpiry,
        updatedAt: new Date().toISOString(),
        syncStatus: 'PENDING'
    };

    const movement = {
        id: `mov_${Date.now()}_quick`,
        productId,
        type: 'STOCK_IN',
        description: `Ingreso Rápido (+${qty}) ${expiryDate ? 'Vence: ' + expiryDate : ''}`,
        amount: qty,
        user: 'Admin',
        date: new Date().toISOString(),
        syncStatus: 'PENDING'
    };

    // Local
    const tx = dbLocal.transaction(['products', 'movements'], 'readwrite');
    await tx.objectStore('products').put(updatedProduct);
    await tx.objectStore('movements').put(movement);
    await tx.done;

    // Nube
    syncToCloud('products', updatedProduct);
    syncToCloud('movements', movement);
  },

  // 🗑️ SOFT DELETE (Cloud Enabled)
  async delete(id) {
    const dbLocal = await getDB();
    const product = await dbLocal.get('products', id);
    
    if (product) {
        const deletedProduct = {
            ...product,
            deleted: true,
            syncStatus: 'PENDING',
            updatedAt: new Date().toISOString()
        };

        // Local
        await dbLocal.put('products', deletedProduct);

        // Nube (Se actualiza como deleted=true, no se borra físico aún)
        syncToCloud('products', deletedProduct);
    }
  }
};