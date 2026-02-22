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
    // 🛡️ Blindaje total: Debe tener fecha y precio futuro
    if (!product || !product.priceActivationDate || !product.nextPrice) return product;

    // 🔥 FIX CRÍTICO: Usar hora local del dispositivo, no UTC
    const today = new Date().toLocaleDateString('sv-SE'); 
    const activationDate = product.priceActivationDate;

    // Si llegó el día (o ya pasó)
    if (today >= activationDate) {
        // 🔥 PROMOCIÓN DE PRECIO
        const updatedProduct = {
            ...product,
            price: Number(product.nextPrice), // El precio futuro ahora es el actual
            cost: product.nextCost ? Number(product.nextCost) : product.cost, // Si había costo programado también
            
            // Limpiamos la programación
            nextPrice: null,
            nextCost: null,
            priceActivationDate: null,
            
            updatedAt: new Date().toISOString(),
            syncStatus: 'pending' // Para que suba a la nube
        };

        // Guardamos en local (Usamos await para asegurar consistencia UI)
        try {
            await dbLocal.products.put(updatedProduct);
            
            // Disparamos sync en background
            triggerCloudUpdate(updatedProduct);
        } catch (e) { console.error("Error activating price:", e); }

        return updatedProduct;
    }

    return product;
};

// Helper para subir cambios silenciosos a la nube
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
    
    const productIds = products.map(p => p.id);
    
    // 1. Caso: Todas las sucursales (Stock Consolidado para Owner)
    if (!branchId || branchId === 'ALL') {
        // Traemos todo el inventario de estos productos (sin filtrar por branch)
        const allInventory = await dbLocal.inventory
            .where('productId')
            .anyOf(productIds)
            .toArray();

        // Mapeamos sumando stocks
        return products.map(p => {
            const itemInv = allInventory.filter(i => i.productId === p.id);
            const totalStock = itemInv.reduce((acc, curr) => acc + (parseFloat(curr.stock) || 0), 0);
            
            return {
                ...p,
                stock: totalStock,
                promo: null, // En vista global no mostramos una promo específica (confuso)
                isMultiBranch: true
            };
        });
    }

    // 2. Caso: Sucursal Específica (Cajero u Owner filtrando)
    const inventory = await dbLocal.inventory
        .where('branchId').equals(branchId)
        .filter(i => productIds.includes(i.productId))
        .toArray();

    // Map para acceso O(1)
    const invMap = new Map(inventory.map(i => [i.productId, i]));

    return products.map(p => {
        const branchData = invMap.get(p.id);
        return {
            ...p,
            stock: branchData ? (parseFloat(branchData.stock) || 0) : 0,
            // 🔥 Si hay promo local, la usamos.
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

        // 1. Obtener maestros (filtro deleted)
        const products = await dbLocal.products.filter(p => !p.deleted).toArray();
        
        // 2. Inyectar Stock/Promo según contexto
        return await _injectBranchData(products, activeBranchId, dbLocal);
    },

    // 🔥 Método blindado con Activación de Precios + PROMOS LOCALES
    async getAllByBranch(branchId) {
        // Redirigimos a getAll pero inyectando el branchId si se provee, o usando el del store
        // Para consistencia, mejor usamos la lógica interna de _injectBranchData
        const dbLocal = await getDB();
        let products = await dbLocal.products.filter(p => !p.deleted).toArray();
        
        // Activación JIT global
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

        // 1. Intento Directo
        let product = await dbLocal.products.where('code').equals(cleanCode).first();
        
        // 2. Intento por Barcode
        if (!product || product.deleted) {
            product = await dbLocal.products.where('barcode').equals(cleanCode).first();
        }

        // 3. Fallback Manual (array scan)
        if (!product || product.deleted) {
            product = await dbLocal.products
                .filter(p => !p.deleted && Array.isArray(p.barcode) && p.barcode.includes(cleanCode))
                .first();
        }

        if (product && !product.deleted) {
            // 🔥 ACTIVACIÓN JIT INDIVIDUAL
            const activeProduct = await checkAndActivatePrice(product, dbLocal);
            
            // 🔥 INYECCIÓN DE PROMO LOCAL (CRÍTICO PARA POS)
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

        // 🔥 ACTIVACIÓN JIT EN RESULTADOS DE BÚSQUEDA
        const processedResults = await Promise.all(results.map(p => checkAndActivatePrice(p, dbLocal)));
        
        // 🔥 INYECCIÓN DE DATOS LOCALES
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
        
        // 🛡️ HIDRATACIÓN DE SEGURIDAD
        let existingProduct = {};
        try {
            const current = await dbLocal.products.get(productId);
            if (current) existingProduct = current;
        } catch (e) { console.warn("Nuevo producto"); }

        // --- CONSTRUCCIÓN OBJETO MAESTRO ---
        const masterProduct = {
            // 1. Mantenemos datos que no se editan en el modal
            ...existingProduct, 
            
            // 2. Sobrescribimos con los datos nuevos
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
            
            // Precios Globales
            cost: parseFloat(product.cost) || 0,
            price: parseFloat(product.price) || 0,
            minPrice: parseFloat(product.minPrice) || 0,
            
            // 🔥 CAMPOS DE PROGRAMACIÓN
            nextPrice: product.nextPrice !== undefined ? product.nextPrice : (existingProduct.nextPrice || null),
            nextCost: product.nextCost !== undefined ? product.nextCost : (existingProduct.nextCost || null),
            priceActivationDate: product.priceActivationDate !== undefined ? product.priceActivationDate : (existingProduct.priceActivationDate || null),

            // 🔥 FIX CRÍTICO: Permitimos que el stock pase si viene explícito
            stock: product.stock !== undefined ? Number(product.stock) : (existingProduct.stock || 0),

            updatedAt: timestamp,
            deleted: false,
            syncStatus: 'pending' 
        };

        // 💾 Persistencia Local Inmediata
        await dbLocal.products.put(masterProduct);

        // 🔥 FIX CRÍTICO 2: Inyectar Stock Inicial en Inventory
        // Si es un producto NUEVO y tiene stock, disparamos el addStock a la sucursal actual
        if (isNewProduct && masterProduct.stock > 0 && activeBranchId && activeBranchId !== 'ALL') {
            try {
                await this.addStock(
                    productId, 
                    masterProduct.stock, 
                    'Stock Inicial', 
                    user.name, 
                    activeBranchId
                );
            } catch (err) {
                console.error("Fallo al inyectar stock inicial:", err);
            }
        }

        // ☁️ Persistencia Cloud (Maestro Global)
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
    // 📦 GESTIÓN DE STOCK (LOCAL BRANCH)
    // ==========================================
    
    async addStock(productId, quantity, description = 'Ingreso', userName = 'Sistema', forcedBranchId = null) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();
        const branchId = forcedBranchId || activeBranchId;

        if (!user?.companyId || !branchId || branchId === 'ALL') throw new Error("Debe seleccionar una sucursal para mover stock.");

        const qty = parseFloat(quantity);
        if (isNaN(qty) || qty === 0) return;

        const timestamp = new Date().toISOString();

        // 🔄 TRANSACCIÓN LOCAL ATÓMICA
        await dbLocal.transaction('rw', [dbLocal.inventory, dbLocal.movements], async () => {
            const currentInv = await dbLocal.inventory.where({ branchId, productId }).first();
            const currentStock = currentInv ? (parseFloat(currentInv.stock) || 0) : 0;
            const newStock = currentStock + qty;

            // Mantenemos la promo si existía
            const currentPromo = currentInv?.promo || null;

            await dbLocal.inventory.put({
                branchId,
                productId,
                stock: newStock,
                promo: currentPromo, // 🔥 Preservamos promo
                updatedAt: timestamp,
                syncStatus: 'pending'
            });

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

        // ☁️ ACTUALIZACIÓN CLOUD
        if (navigator.onLine) {
            try {
                const batch = writeBatch(db);
                const inventoryRef = doc(db, `companies/${user.companyId}/branches/${branchId}/inventory`, productId);
                batch.set(inventoryRef, {
                    stock: increment(qty),
                    updatedAt: serverTimestamp()
                }, { merge: true });

                const logRef = doc(collection(db, `companies/${user.companyId}/stock_movements`));
                batch.set(logRef, {
                    productId,
                    qty,
                    branchId,
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
    // 🏷️ MOTOR DE PROMOCIONES (LOCALIZADO POR BRANCH) 🔥
    // ==========================================
    
    async setPromotion(productId, promoRule) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();
        
        if (!activeBranchId || activeBranchId === 'ALL') throw new Error("Debe seleccionar una sucursal para aplicar promos.");

        const timestamp = new Date().toISOString();

        // 1. Upsert en Inventory Local (Key compuesta [branchId+productId])
        await dbLocal.transaction('rw', [dbLocal.inventory], async () => {
            const currentInv = await dbLocal.inventory.where({ branchId: activeBranchId, productId }).first();
            
            await dbLocal.inventory.put({
                branchId: activeBranchId,
                productId,
                stock: currentInv ? currentInv.stock : 0, // Si no existe, stock 0
                promo: promoRule, // 🔥 Guardamos la promo AQUÍ
                updatedAt: timestamp,
                syncStatus: 'pending'
            });
        });

        // 2. Actualizar en nube (Subcolección de Branch)
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