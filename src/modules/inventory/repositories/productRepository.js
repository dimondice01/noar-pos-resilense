import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; // 🔑 NUEVO: Importamos el Store

// ==========================================
// ☁️ HELPER: SYNC AISLADO (SaaS)
// ==========================================
const syncToCloud = async (collectionName, data) => {
  if (!navigator.onLine) return;

  // 1. OBTENER ID EMPRESA
  const { user } = useAuthStore.getState();
  
  // 🛡️ SEGURIDAD: Si no hay empresa, no guardamos nada en la nube
  // para evitar ensuciar la raíz de la base de datos.
  if (!user || !user.companyId) {
      console.warn(`⛔ Sync: Intento de escritura sin empresa asignada en ${collectionName}`);
      return;
  }

  try {
    const { syncStatus, ...cloudData } = data;
    
    // 2. CONSTRUIR RUTA PRIVADA
    // Antes: db.collection(collectionName)
    // Ahora: db.collection('companies', companyId, collectionName)
    const path = `companies/${user.companyId}/${collectionName}`;

    await setDoc(doc(db, path, data.id), {
      ...cloudData,
      firestoreId: data.id,
      syncedAt: new Date().toISOString()
    }, { merge: true });
    
    // 3. ACTUALIZAR ESTADO LOCAL
    const dbLocal = await getDB();
    // Mapeo simple: si entra 'movements' va a store 'movements', si no 'products'
    const storeName = collectionName === 'movements' ? 'movements' : 'products'; 
    await dbLocal.put(storeName, { ...data, syncStatus: 'SYNCED' });

  } catch (e) {
    console.warn(`⚠️ Error sync ${collectionName} (Nube):`, e);
  }
};

export const productRepository = {
  // ==========================================
  // 📖 MÉTODOS DE LECTURA (Local First)
  // ==========================================
  // Estos no cambian porque leen de IndexedDB, 
  // y IndexedDB ya está filtrada por el SyncService.

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
             product.syncStatus = 'synced'; 
             await store.put(product);
        }
      }
    }
    await tx.done;
  },

  // ==========================================
  // 👑 MÉTODO SUPER ADMIN: CATALOGO MAESTRO
  // ==========================================
  
  // ⚠️ ESTE SE QUEDA GLOBAL.
  // Es la única función que escribe en la raíz 'master_products'.
  async saveToMasterCatalog(products) {
    const BATCH_SIZE = 500; 
    const chunks = [];

    for (let i = 0; i < products.length; i += BATCH_SIZE) {
        chunks.push(products.slice(i, i + BATCH_SIZE));
    }

    let batchCount = 0;
    for (const chunk of chunks) {
        const batch = writeBatch(db);
        
        chunk.forEach(product => {
            const docRef = doc(db, "master_products", product.id);
            const { syncStatus, ...cleanProduct } = product;
            
            batch.set(docRef, {
                ...cleanProduct,
                isMaster: true,
                updatedAt: new Date().toISOString()
            });
        });

        await batch.commit();
        batchCount++;
        console.log(`☁️ [SaaS] Lote Maestro ${batchCount}/${chunks.length} subido.`);
    }
    return true;
  },

  // ==========================================
  // ✍️ MÉTODOS DE ESCRITURA (Local - Tienda Cliente)
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

  // 🔥 EL MÉTODO "ESPÍA" (Local + Nube Aislada)
  async save(product) {
    const dbLocal = await getDB();
    
    // 1. Preparar ID
    const productId = product.id || crypto.randomUUID();
    
    // 2. Obtener estado previo
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

    // 4. Objeto Final
    const productToSave = {
      ...product,
      id: productId,
      batches: batches,
      updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING',
      deleted: false
    };

    // 5. Detectar Cambios (Movimientos)
    const movementsToSave = [];
    const timestamp = new Date().toISOString();
    
    // (Lógica de movimientos igual a la original...)
    if (!oldProduct) {
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

    // 7. Sincronizar Nube (Usando el helper actualizado SaaS)
    syncToCloud('products', productToSave);
    movementsToSave.forEach(mov => syncToCloud('movements', mov)); 

    return productToSave;
  },

  // 🔥 INGRESO RÁPIDO (Cloud Enabled)
  async addStock(productId, quantity, expiryDate) {
    const dbLocal = await getDB();
    const product = await dbLocal.get('products', productId);
    if (!product) throw new Error("Producto no encontrado");

    const qty = parseFloat(quantity);
    const newStock = (parseFloat(product.stock) || 0) + qty;

    let batches = product.batches || [];
    if (qty > 0) {
        batches.push({
            id: crypto.randomUUID(),
            quantity: qty,
            expiryDate: expiryDate || null, 
            dateAdded: new Date().toISOString()
        });
    }

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

  // 🗑️ SOFT DELETE
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

        await dbLocal.put('products', deletedProduct);

        syncToCloud('products', deletedProduct);
    }
  }
};