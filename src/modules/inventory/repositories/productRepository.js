import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { 
    doc, 
    setDoc, 
    updateDoc, 
    increment, 
    serverTimestamp, 
    collection, 
    writeBatch,
    getDoc
} from 'firebase/firestore'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 

export const productRepository = {

    // ==========================================
    // 🔍 CONSULTAS (OPTIMIZADAS MULTI-BARCODE)
    // ==========================================
    
    async getAll() {
        const dbLocal = await getDB();
        return await dbLocal.products.filter(p => !p.deleted).toArray();
    },

    async findByCode(code) {
        const dbLocal = await getDB();
        const cleanCode = code.trim();

        // 1. Intento Directo (Código Interno)
        let product = await dbLocal.products.where('code').equals(cleanCode).first();
        if (product && !product.deleted) return product;

        // 2. Intento por Barcode (Indexado en Dexie)
        product = await dbLocal.products.where('barcode').equals(cleanCode).first();
        if (product && !product.deleted) return product;

        // 3. Fallback: Búsqueda manual profunda
        const manualSearch = await dbLocal.products
            .filter(p => 
                !p.deleted && Array.isArray(p.barcode) && p.barcode.includes(cleanCode)
            )
            .first();

        return manualSearch || null;
    },

    async search(query) {
        const dbLocal = await getDB();
        const term = query.toLowerCase().trim();
        if (!term) return [];

        return await dbLocal.products
            .filter(p => {
                if (p.deleted) return false;
                
                if (p.name.toLowerCase().includes(term)) return true;
                if (p.code && p.code.toString().toLowerCase().includes(term)) return true;

                if (Array.isArray(p.barcode)) {
                    return p.barcode.some(b => b.includes(term));
                } else if (p.barcode) {
                    return p.barcode.toString().toLowerCase().includes(term);
                }
                
                if (p.category && p.category.toLowerCase().includes(term)) return true;

                return false;
            })
            .limit(50)
            .toArray();
    },

    // ==========================================
// 💎 GESTIÓN DEL MAESTRO (BLOQUE CORREGIDO)
// ==========================================
async save(product) {
    const dbLocal = await getDB();
    const { user } = useAuthStore.getState();
    if (!user?.companyId) throw new Error("Sesión no válida.");

    const productId = product.id || crypto.randomUUID();
    const timestamp = new Date().toISOString();
    
    // 🛡️ HIDRATACIÓN DE SEGURIDAD
    let existingProduct = {};
    try {
        const current = await dbLocal.products.get(productId);
        if (current) existingProduct = current;
    } catch (e) { console.warn("Nuevo producto"); }

    // --- CONSTRUCCIÓN OBJETO MAESTRO ---
    const masterProduct = {
        // 1. Mantenemos datos que no se editan en el modal (como suppliers)
        ...existingProduct, 
        
        // 2. Sobrescribimos con los datos nuevos del formulario
        id: productId,
        name: (product.name || existingProduct.name || '').toUpperCase(),
        code: product.code !== undefined ? product.code : (existingProduct.code || ''),
        barcode: Array.isArray(product.barcode) ? product.barcode : (product.barcode ? [product.barcode] : (existingProduct.barcode || [])),
        
        category: product.category || existingProduct.category || 'GENERAL',
        brand: product.brand || existingProduct.brand || 'GENERICO',
        unit: product.unit || existingProduct.unit || 'UN',
        isWeighable: product.isWeighable !== undefined ? product.isWeighable : !!existingProduct.isWeighable,
        taxRate: parseFloat(product.taxRate) || existingProduct.taxRate || 21,
        
        // Precios
        cost: parseFloat(product.cost) || 0,
        price: parseFloat(product.price) || 0,
        minPrice: parseFloat(product.minPrice) || 0,
        
        // 🔥 FIX CRÍTICO: Garantizamos que promo se actualice o se limpie (null)
        // Si product.promo es undefined, mantenemos la anterior. Si es null o tiene objeto, aplicamos el nuevo.
        promo: product.promo !== undefined ? product.promo : (existingProduct.promo || null), 
        
        updatedAt: timestamp,
        deleted: false,
        syncStatus: 'pending' 
    };

    // ⚖️ Manejo de Stock (Aislamiento de Sucursal)
    if (!existingProduct.id) {
        masterProduct.stock = parseFloat(product.stock) || 0;
    } else {
        masterProduct.stock = existingProduct.stock || 0; 
    }

    // 💾 Persistencia Local Inmediata
    await dbLocal.products.put(masterProduct);

    // ☁️ Persistencia Cloud (Maestro Global)
    if (navigator.onLine) {
        try {
            const masterRef = doc(db, `companies/${user.companyId}/products`, productId);
            // Extraemos stock y syncStatus para no enviarlos a la colección de productos global
            const { stock, syncStatus, ...cloudData } = masterProduct;
            
            await setDoc(masterRef, {
                ...cloudData,
                updatedAt: serverTimestamp() 
            }, { merge: true });
            
            await dbLocal.products.update(productId, { syncStatus: 'synced' });
        } catch (e) {
            console.error("Error en sincronización directa:", e);
        }
    }

    return masterProduct;
},
    // ==========================================
    // 📦 GESTIÓN DE STOCK (LOCAL BRANCH)
    // ==========================================
    
    async addStock(productId, quantity, description = 'Ingreso', userName = 'Sistema', forcedBranchId = null) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();
        const branchId = forcedBranchId || activeBranchId;

        if (!user?.companyId || !branchId) throw new Error("Contexto de sucursal inválido.");

        const qty = parseFloat(quantity);
        if (isNaN(qty) || qty === 0) return;

        const timestamp = new Date().toISOString();

        // 🔄 TRANSACCIÓN LOCAL ATÓMICA
        await dbLocal.transaction('rw', [dbLocal.products, dbLocal.movements], async () => {
            const product = await dbLocal.products.get(productId);
            if (product) {
                const currentStock = parseFloat(product.stock) || 0;
                await dbLocal.products.update(productId, { 
                    stock: currentStock + qty,
                    syncStatus: 'pending_update' 
                });
            }

            // Registrar en Kardex
            await dbLocal.movements.add({
                id: `mov_${Date.now()}_${crypto.randomUUID().slice(0,5)}`,
                productId,
                branchId,
                type: qty > 0 ? 'IN' : 'OUT',
                amount: Math.abs(qty),
                description: description || 'Ajuste Manual',
                user: userName,
                date: timestamp,
                syncStatus: 'pending'
            });
        });

        // ☁️ ACTUALIZACIÓN CLOUD (Multi-Sede)
        if (navigator.onLine) {
            try {
                const batch = writeBatch(db);
                
                const inventoryRef = doc(db, `companies/${user.companyId}/branches/${branchId}/inventory`, productId);
                batch.set(inventoryRef, {
                    productId,
                    stock: increment(qty),
                    updatedAt: serverTimestamp()
                }, { merge: true });

                const logRef = doc(collection(db, `companies/${user.companyId}/branches/${branchId}/stockLog`));
                batch.set(logRef, {
                    productId,
                    qty,
                    type: qty > 0 ? 'STOCK_IN' : 'STOCK_OUT',
                    reason: description,
                    user: userName,
                    date: serverTimestamp()
                });

                await batch.commit();
            } catch (e) {
                console.error("Error actualizando stock en nube:", e);
            }
        }
    },

    // ==========================================
    // 🏷️ MOTOR DE PROMOCIONES (HELPER DIRECTO)
    // ==========================================
    
    async setPromotion(productId, promoRule) {
        const dbLocal = await getDB();
        const { user } = useAuthStore.getState();
        const timestamp = new Date().toISOString();

        // Actualizar localmente
        await dbLocal.products.update(productId, { 
            promo: promoRule,
            syncStatus: 'pending',
            updatedAt: timestamp
        });

        // Actualizar en nube
        if (navigator.onLine && user?.companyId) {
            const productRef = doc(db, `companies/${user.companyId}/products`, productId);
            await updateDoc(productRef, { 
                promo: promoRule,
                updatedAt: serverTimestamp()
            });
        }
    },

    // ==========================================
    // 🔄 MANTENIMIENTO
    // ==========================================

    async delete(id) {
        const dbLocal = await getDB();
        const { user } = useAuthStore.getState();

        await dbLocal.products.update(id, { 
            deleted: true,
            syncStatus: 'pending'
        });

        if (navigator.onLine && user?.companyId) {
            const docRef = doc(db, `companies/${user.companyId}/products`, id);
            await updateDoc(docRef, { 
                deleted: true, 
                updatedAt: serverTimestamp() 
            });
        }
    },

    async saveAll(products) {
        const dbLocal = await getDB();
        const productsToSave = products.map(p => ({
            ...p,
            syncStatus: 'pending',
            name: p.name.toUpperCase()
        }));
        await dbLocal.products.bulkPut(productsToSave);
    }
};