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

// ==========================================
// 🕒 HELPER: ACTIVADOR DE PRECIOS (JIT - TIMEZONE SAFE)
// ==========================================
const checkAndActivatePrice = async (product, dbLocal) => {
    if (!product || !product.priceActivationDate || !product.nextPrice) return product;

    const today = new Date().toLocaleDateString('sv-SE'); 
    const activationDate = product.priceActivationDate;

    if (today >= activationDate) {
        const updatedProduct = {
            ...product,
            price: Number(product.nextPrice), 
            cost: product.nextCost ? Number(product.nextCost) : product.cost, 
            nextPrice: null,
            nextCost: null,
            priceActivationDate: null,
            updatedAt: new Date().toISOString(),
            syncStatus: 'pending' 
        };

        try {
            await dbLocal.products.put(updatedProduct);
            triggerCloudUpdate(updatedProduct);
        } catch (e) { console.error("Error activating price:", e); }

        return updatedProduct;
    }

    return product;
};

const triggerCloudUpdate = async (product) => {
    if (!navigator.onLine) return;
    const { user } = useAuthStore.getState();
    if (!user?.companyId) return;

    try {
        const docRef = doc(db, `companies/${user.companyId}/products`, product.id);
        await updateDoc(docRef, {
            price: product.price,
            cost: product.cost,
            nextPrice: null,
            nextCost: null,
            priceActivationDate: null,
            updatedAt: serverTimestamp()
        });
        const dbLocal = await getDB();
        await dbLocal.products.update(product.id, { syncStatus: 'synced' });
    } catch (e) { }
};

// ==========================================
// 🧠 HELPER: INYECTOR DE DATOS DE SUCURSAL (THE JOIN ENGINE)
// ==========================================
const _injectBranchData = async (products, branchId, dbLocal) => {
    if (!products || products.length === 0) return [];
    
    const allInventory = await dbLocal.inventory.toArray();
    
    if (!branchId || branchId === 'ALL') {
        const globalStockMap = {};
        for (const item of allInventory) {
            if (!globalStockMap[item.productId]) globalStockMap[item.productId] = 0;
            globalStockMap[item.productId] += parseFloat(item.stock) || 0;
        }

        return products.map(p => {
            return {
                ...p,
                stock: globalStockMap[p.id] || 0,
                promo: null, 
                isMultiBranch: true
            };
        });
    }

    const invMap = new Map();
    for (const item of allInventory) {
        if (item.branchId === branchId) {
            invMap.set(item.productId, item);
        }
    }

    return products.map(p => {
        const branchData = invMap.get(p.id);
        return {
            ...p,
            stock: branchData ? (parseFloat(branchData.stock) || 0) : 0,
            promo: branchData?.promo || null, 
            _branchId: branchId
        };
    });
};


export const productRepository = {

    // ==========================================
    // 🔍 CONSULTAS (OPTIMIZADAS CON ACTIVADOR JIT)
    // ==========================================
    
    async getAll() {
        const dbLocal = await getDB();
        const { activeBranchId } = useAuthStore.getState();
        const products = await dbLocal.products.filter(p => !p.deleted).toArray();
        return await _injectBranchData(products, activeBranchId, dbLocal);
    },

    async getAllByBranch(branchId) {
        const dbLocal = await getDB();
        let products = await dbLocal.products.filter(p => !p.deleted).toArray();
        
        const today = new Date().toLocaleDateString('sv-SE');
        const productsToUpdate = [];

        products = products.map(p => {
            if (p.priceActivationDate && p.nextPrice && today >= p.priceActivationDate) {
                const updated = {
                    ...p,
                    price: Number(p.nextPrice),
                    cost: p.nextCost ? Number(p.nextCost) : p.cost,
                    nextPrice: null,
                    nextCost: null,
                    priceActivationDate: null,
                    updatedAt: new Date().toISOString(),
                    syncStatus: 'pending'
                };
                productsToUpdate.push(updated);
                return updated;
            }
            return p;
        });

        if (productsToUpdate.length > 0) {
            await dbLocal.products.bulkPut(productsToUpdate);
            productsToUpdate.forEach(p => triggerCloudUpdate(p));
        }
        
        return await _injectBranchData(products, branchId, dbLocal);
    },

    async findByCode(code) {
        const dbLocal = await getDB();
        const { activeBranchId } = useAuthStore.getState();
        const cleanCode = code.trim();

        let product = await dbLocal.products.where('code').equals(cleanCode).first();
        
        if (!product || product.deleted) {
            product = await dbLocal.products.where('barcode').equals(cleanCode).first();
        }

        if (!product || product.deleted) {
            product = await dbLocal.products
                .filter(p => !p.deleted && Array.isArray(p.barcode) && p.barcode.includes(cleanCode))
                .first();
        }

        if (product && !product.deleted) {
            const activeProduct = await checkAndActivatePrice(product, dbLocal);
            const enriched = await _injectBranchData([activeProduct], activeBranchId, dbLocal);
            return enriched[0];
        }

        return null;
    },

    async search(query) {
        const dbLocal = await getDB();
        const { activeBranchId } = useAuthStore.getState();
        const term = query.toLowerCase().trim();
        if (!term) return [];

        let results = await dbLocal.products
            .filter(p => {
                if (p.deleted) return false;
                if (p.name.toLowerCase().includes(term)) return true;
                if (p.code && p.code.toString().toLowerCase().includes(term)) return true;
                if (Array.isArray(p.barcode)) {
                    return p.barcode.some(b => b.includes(term));
                } else if (p.barcode) {
                    return p.barcode.toString().toLowerCase().includes(term);
                }
                if (p.category && typeof p.category === 'string' && p.category.toLowerCase().includes(term)) return true;
                return false;
            })
            .limit(50)
            .toArray();

        const processedResults = await Promise.all(results.map(p => checkAndActivatePrice(p, dbLocal)));
        return await _injectBranchData(processedResults, activeBranchId, dbLocal);
    },

    // ==========================================
    // 💎 GESTIÓN DEL MAESTRO
    // ==========================================
    async save(product) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();
        if (!user?.companyId) throw new Error("Sesión no válida.");

        const isNewProduct = !product.id;
        const productId = product.id || crypto.randomUUID();
        const timestamp = new Date().toISOString();
        
        let existingProduct = {};
        try {
            const current = await dbLocal.products.get(productId);
            if (current) existingProduct = current;
        } catch (e) { console.warn("Nuevo producto"); }

        const masterProduct = {
            ...existingProduct, 
            id: productId,
            name: (product.name || existingProduct.name || '').toUpperCase(),
            code: product.code !== undefined ? product.code : (existingProduct.code || ''),
            barcode: Array.isArray(product.barcode) ? product.barcode : (product.barcode ? [product.barcode] : (existingProduct.barcode || [])),
            category: product.category || existingProduct.category || 'GENERAL',
            categoryId: product.categoryId || existingProduct.categoryId || 'general',
            brand: product.brand || existingProduct.brand || 'GENERICO',
            brandId: product.brandId || existingProduct.brandId || null,
            unit: product.unit || existingProduct.unit || 'UN',
            isWeighable: product.isWeighable !== undefined ? product.isWeighable : !!existingProduct.isWeighable,
            taxRate: parseFloat(product.taxRate) || existingProduct.taxRate || 21,
            
            cost: parseFloat(product.cost) || 0,
            price: parseFloat(product.price) || 0,
            minPrice: parseFloat(product.minPrice) || 0,
            
            nextPrice: product.nextPrice !== undefined ? product.nextPrice : (existingProduct.nextPrice || null),
            nextCost: product.nextCost !== undefined ? product.nextCost : (existingProduct.nextCost || null),
            priceActivationDate: product.priceActivationDate !== undefined ? product.priceActivationDate : (existingProduct.priceActivationDate || null),

            stock: product.stock !== undefined ? Number(product.stock) : (existingProduct.stock || 0),

            updatedAt: timestamp,
            deleted: false,
            syncStatus: 'pending' 
        };

        await dbLocal.products.put(masterProduct);

        if (isNewProduct && masterProduct.stock > 0 && activeBranchId && activeBranchId !== 'ALL') {
            try {
                await this.addStock(
                    productId, 
                    masterProduct.stock, 
                    'Stock Inicial', 
                    user.name, 
                    activeBranchId,
                    'STOCK_IN'
                );
            } catch (err) {
                console.error("Fallo al inyectar stock inicial:", err);
            }
        }

        if (navigator.onLine) {
            try {
                const masterRef = doc(db, `companies/${user.companyId}/products`, productId);
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
    // 📦 GESTIÓN DE STOCK Y KARDEX (NUEVO MOTOR)
    // ==========================================
    
    // 🔥 NUEVO: Obtener el Kardex completo de un producto
    async getProductMovements(productId, branchIdFilter = null) {
        const dbLocal = await getDB();
        const { activeBranchId } = useAuthStore.getState();
        const branch = branchIdFilter || activeBranchId;

        let movements = await dbLocal.movements
            .where('productId').equals(productId)
            .reverse()
            .toArray();

        if (branch && branch !== 'ALL') {
            movements = movements.filter(m => m.branchId === branch);
        }

        return movements;
    },
    
    // 🔥 ACTUALIZADO: Soporte para Mermas, Ajustes y Sync Reparado
    async addStock(productId, quantity, description = 'Ingreso', userName = 'Sistema', forcedBranchId = null, movementType = null) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();
        const branchId = forcedBranchId || activeBranchId;

        if (!user?.companyId || !branchId || branchId === 'ALL') throw new Error("Debe seleccionar una sucursal para mover stock.");

        const qty = parseFloat(quantity);
        if (isNaN(qty) || qty === 0) return;

        const timestamp = new Date().toISOString();
        const movId = `mov_${Date.now()}_${crypto.randomUUID().slice(0,5)}`;
        const type = movementType || (qty > 0 ? 'STOCK_IN' : 'STOCK_OUT');

        // 🔄 TRANSACCIÓN LOCAL ATÓMICA
        await dbLocal.transaction('rw', [dbLocal.inventory, dbLocal.movements], async () => {
            const currentInv = await dbLocal.inventory.where({ branchId, productId }).first();
            const currentStock = currentInv ? (parseFloat(currentInv.stock) || 0) : 0;
            const newStock = currentStock + qty;

            const currentPromo = currentInv?.promo || null;

            await dbLocal.inventory.put({
                branchId,
                productId,
                stock: newStock,
                promo: currentPromo, 
                updatedAt: timestamp,
                syncStatus: 'pending'
            });

            await dbLocal.movements.add({
                id: movId,
                productId,
                branchId,
                type: type, // Ej: 'MERMA', 'STOCK_IN', 'SALE'
                amount: Math.abs(qty),
                description: description || 'Ajuste Manual',
                user: userName,
                date: timestamp,
                refId: null,
                syncStatus: 'pending'
            });
        });

        // ☁️ ACTUALIZACIÓN CLOUD (Alineada con el syncService)
        if (navigator.onLine) {
            try {
                const batch = writeBatch(db);
                
                // 1. Actualizar Inventario Cloud
                const inventoryRef = doc(db, `companies/${user.companyId}/branches/${branchId}/inventory`, productId);
                batch.set(inventoryRef, {
                    stock: increment(qty),
                    updatedAt: serverTimestamp()
                }, { merge: true });

                // 2. Registrar Movimiento (Alineado con "movements")
                const logRef = doc(db, `companies/${user.companyId}/movements`, movId);
                batch.set(logRef, {
                    productId,
                    amount: Math.abs(qty),
                    branchId,
                    type: type,
                    description: description,
                    user: userName,
                    date: serverTimestamp(),
                    refId: null
                });

                await batch.commit();
                
                // Limpiar syncStatus local para no subirlo 2 veces
                await dbLocal.inventory.update([branchId, productId], {syncStatus: 'synced'});
                await dbLocal.movements.update(movId, {syncStatus: 'synced'});
                
            } catch (e) {
                console.error("Error actualizando stock en nube:", e);
            }
        }
    },

    // ==========================================
    // 🏷️ MOTOR DE PROMOCIONES (LOCALIZADO POR BRANCH)
    // ==========================================
    
    async setPromotion(productId, promoRule) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();
        
        if (!activeBranchId || activeBranchId === 'ALL') throw new Error("Debe seleccionar una sucursal para aplicar promos.");

        const timestamp = new Date().toISOString();

        await dbLocal.transaction('rw', [dbLocal.inventory], async () => {
            const currentInv = await dbLocal.inventory.where({ branchId: activeBranchId, productId }).first();
            
            await dbLocal.inventory.put({
                branchId: activeBranchId,
                productId,
                stock: currentInv ? currentInv.stock : 0, 
                promo: promoRule, 
                updatedAt: timestamp,
                syncStatus: 'pending'
            });
        });

        if (navigator.onLine && user?.companyId) {
            try {
                const invRef = doc(db, `companies/${user.companyId}/branches/${activeBranchId}/inventory`, productId);
                await setDoc(invRef, { 
                    promo: promoRule,
                    updatedAt: serverTimestamp()
                }, { merge: true });
            } catch (e) { console.error("Error syncing promo:", e); }
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
            name: p.name.toUpperCase(),
            stock: 0 
        }));
        await dbLocal.products.bulkPut(productsToSave);
    }
};