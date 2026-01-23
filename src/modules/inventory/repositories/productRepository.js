import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, writeBatch, collection } from 'firebase/firestore'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 

// ==========================================
// ☁️ HELPER: SYNC OPTIMISTA (Fire & Forget)
// ==========================================
const triggerOptimisticSync = async (collectionName, data) => {
  if (!navigator.onLine) return;

  const { user } = useAuthStore.getState();
  if (!user || !user.companyId) return;

  try {
    const { syncStatus, ...cloudData } = data;
    const path = `companies/${user.companyId}/${collectionName}`;

    // Si data.id existe lo usamos, si no (raro en este punto), dejamos que Firestore asigne
    const docRef = data.id ? doc(db, path, data.id) : doc(collection(db, path));

    // No usamos await para no bloquear la UI del usuario
    setDoc(docRef, {
      ...cloudData,
      firestoreId: docRef.id,
      syncedAt: new Date().toISOString(),
      syncStatus: 'synced' // En nube ya está synced
    }, { merge: true }).then(async () => {
        // Callback de éxito: Actualizamos localmente
        try {
            const dbLocal = await getDB();
            // Dexie update parcial
            const table = collectionName === 'movements' ? dbLocal.movements : dbLocal.products;
            if (data.id) {
                await table.update(data.id, { syncStatus: 'synced' });
            }
        } catch (e) { /* Silent fail local update */ }
    });

  } catch (e) {
    console.warn(`⚠️ Sync Optimista falló (${collectionName}), se reintentará luego.`);
  }
};

export const productRepository = {

  // ==========================================
  // 📖 LECTURA (Optimizado con Dexie)
  // ==========================================

  async getAll() {
    const db = await getDB();
    return await db.products
        .filter(p => !p.deleted)
        .toArray();
  },

  async findByCode(code) {
    const db = await getDB();
    const product = await db.products.where('code').equals(code).first();
    if (product && product.deleted) return null;
    return product;
  },

  async getHistory(productId) {
    const db = await getDB();
    return await db.movements
        .where('productId')
        .equals(productId)
        .reverse() 
        .sortBy('date');
  },

  // ==========================================
  // 💾 ESCRITURA TRANSACCIONAL (ACID)
  // ==========================================

  // 🔥 FIX: Aceptar parámetro 'currentUser' para firmar movimientos
  async save(product) {
    const dbLocal = await getDB();
    
    // 1. Preparar ID y Datos
    const productId = product.id || crypto.randomUUID();
    
    // Obtenemos estado anterior para comparar (snapshot)
    const oldProduct = await dbLocal.products.get(productId);

    // 2. Gestión Inteligente de Lotes (Batches)
    let batches = product.batches || (oldProduct?.batches || []);
    
    // Auto-generar lote si es producto nuevo con stock inicial
    if (!oldProduct && parseFloat(product.stock) > 0 && product.expiryDate) {
        batches = [{
            id: crypto.randomUUID(),
            quantity: parseFloat(product.stock),
            expiryDate: product.expiryDate,
            dateAdded: new Date().toISOString()
        }];
    }

    // 3. Objeto Final a Guardar
    // Extraemos 'user' del objeto product si viene inyectado, sino usamos default
    const { user: injectedUser, ...cleanProduct } = product; 
    
    const productToSave = {
      ...cleanProduct,
      id: productId,
      batches: batches,
      updatedAt: new Date().toISOString(),
      syncStatus: 'pending',
      deleted: false
    };

    const movementsToSave = [];
    const timestamp = new Date().toISOString();
    
    // 🔥 USAMOS EL USUARIO INYECTADO O 'Sistema' COMO FALLBACK
    const finalUser = injectedUser || 'Sistema';

    // 4. Lógica de Negocio: Generar Movimientos (Kardex)
    if (!oldProduct) {
        // CREACIÓN
        movementsToSave.push({
            id: `mov_${crypto.randomUUID()}`, 
            productId,
            type: 'CREATION',
            description: 'Producto dado de alta',
            user: finalUser, 
            date: timestamp,
            syncStatus: 'pending'
        });
        if (parseFloat(productToSave.stock) > 0) {
            movementsToSave.push({
                id: `mov_${crypto.randomUUID()}`,
                productId,
                type: 'STOCK_IN',
                description: `Stock inicial: ${productToSave.stock}`,
                amount: parseFloat(productToSave.stock),
                user: finalUser,
                date: timestamp,
                syncStatus: 'pending'
            });
        }
    } else {
        // ACTUALIZACIÓN
        if (parseFloat(oldProduct.price) !== parseFloat(productToSave.price)) {
            movementsToSave.push({
                id: `mov_${crypto.randomUUID()}`,
                productId,
                type: 'PRICE_CHANGE',
                description: `Precio: $${oldProduct.price} ➝ $${productToSave.price}`,
                user: finalUser,
                date: timestamp,
                syncStatus: 'pending'
            });
        }
        
        const diff = parseFloat(productToSave.stock) - parseFloat(oldProduct.stock);
        if (Math.abs(diff) > 0.001) { 
            movementsToSave.push({
                id: `mov_${crypto.randomUUID()}`,
                productId,
                type: 'STOCK_ADJUST_' + (diff > 0 ? 'IN' : 'OUT'),
                description: `Ajuste manual: ${diff > 0 ? '+' : ''}${diff.toFixed(2)}`,
                amount: Math.abs(diff),
                user: finalUser,
                date: timestamp,
                syncStatus: 'pending'
            });
        }
    }

    // 🔥 TRANSACCIÓN ACID: Todo o Nada
    await dbLocal.transaction('rw', [dbLocal.products, dbLocal.movements], async () => {
        await dbLocal.products.put(productToSave);
        if (movementsToSave.length > 0) {
            await dbLocal.movements.bulkAdd(movementsToSave);
        }
    });

    // 5. Sync Optimista (Fuera de la transacción para velocidad)
    triggerOptimisticSync('products', productToSave);
    movementsToSave.forEach(mov => triggerOptimisticSync('movements', mov));

    return productToSave;
  },

  // ==========================================
  // ⚡ INGRESO RÁPIDO DE STOCK
  // ==========================================
  // 🔥 FIX: Añadido parámetro 'user'
  async addStock(productId, quantity, expiryDate, user = 'Sistema') {
    const dbLocal = await getDB();
    
    // Transacción Read-Write
    await dbLocal.transaction('rw', [dbLocal.products, dbLocal.movements], async () => {
        const product = await dbLocal.products.get(productId);
        if (!product) throw new Error("Producto no encontrado");

        const qty = parseFloat(quantity);
        const newStock = (parseFloat(product.stock) || 0) + qty;

        // Gestión de lotes
        let batches = product.batches || [];
        if (qty > 0) {
            batches.push({
                id: crypto.randomUUID(),
                quantity: qty,
                expiryDate: expiryDate || null, 
                dateAdded: new Date().toISOString()
            });
        }

        // Ordenar lotes por vencimiento para FIFO futuro
        const activeBatches = batches
            .filter(b => b.quantity > 0 && b.expiryDate)
            .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
            
        const nextExpiry = activeBatches.length > 0 ? activeBatches[0].expiryDate : product.expiryDate;

        const updatedProduct = {
            ...product,
            stock: newStock,
            batches: batches,
            expiryDate: nextExpiry,
            updatedAt: new Date().toISOString(),
            syncStatus: 'pending'
        };

        const movement = {
            id: `mov_${crypto.randomUUID()}`, 
            productId,
            type: 'STOCK_IN',
            description: `Ingreso Rápido (+${qty}) ${expiryDate ? 'Vence: ' + expiryDate : ''}`,
            amount: qty,
            user: user, // 🔥 USAMOS EL USUARIO PASADO
            date: new Date().toISOString(),
            syncStatus: 'pending'
        };

        // Guardado Atómico
        await dbLocal.products.put(updatedProduct);
        await dbLocal.movements.put(movement); 

        // Disparar sync
        (async () => {
             triggerOptimisticSync('products', updatedProduct);
             triggerOptimisticSync('movements', movement); 
        })();
    });
  },

  // ==========================================
  // ☁️ SYNC SERVICE HELPERS
  // ==========================================

  async getPendingSync() {
    const db = await getDB();
    return await db.products.where('syncStatus').equals('pending').toArray();
  },

  async markAsSynced(ids) {
    const db = await getDB();
    await db.products.bulkUpdate(
        ids.map(id => ({ key: id, changes: { syncStatus: 'synced' } }))
    );
  },

  // ==========================================
  // 🗑️ SOFT DELETE
  // ==========================================
  async delete(id) {
    const dbLocal = await getDB();
    
    await dbLocal.transaction('rw', dbLocal.products, async () => {
        const product = await dbLocal.products.get(id);
        if (product) {
            const deletedProduct = {
                ...product,
                deleted: true,
                syncStatus: 'pending',
                updatedAt: new Date().toISOString()
            };
            await dbLocal.products.put(deletedProduct);
            triggerOptimisticSync('products', deletedProduct);
        }
    });
  },

  // ==========================================
  // ✍️ IMPORTACIÓN MASIVA (Excel)
  // ==========================================
  async saveAll(products) {
    const db = await getDB();
    const productsToSave = products.map(p => ({
        ...p,
        syncStatus: 'pending' 
    }));
    await db.products.bulkPut(productsToSave);
  },

  // ==========================================
  // 👑 SUPER ADMIN (Maestro)
  // ==========================================
  async saveToMasterCatalog(products) {
    const BATCH_SIZE = 400; 
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
        console.log(`☁️ Maestro Lote ${batchCount}/${chunks.length} subido.`);
    }
    return true;
  }
};