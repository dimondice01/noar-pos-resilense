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
// 🔤 HELPER: BÚSQUEDA POR INICIALES ("JV" → "Jamón Viena")
// ==========================================
const _matchesInitials = (name, term) => {
    if (!name || !term || term.length < 2) return false;
    const initials = name.trim().split(/\s+/).map(w => w[0]).join('').toLowerCase();
    return initials.includes(term);
};

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

    // 🔥 Cargar inventario solo de la sucursal necesaria — evita traer todas las sucursales
    const allInventory = (!branchId || branchId === 'ALL')
        ? await dbLocal.inventory.toArray()
        : await dbLocal.inventory.where('branchId').equals(branchId).toArray();

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

    // 🔥 Lectura directa por id, sin pasar por el array en memoria de la UI (fuente de verdad = Dexie)
    async getById(id) {
        if (!id) return null;
        const dbLocal = await getDB();
        const { activeBranchId } = useAuthStore.getState();
        const product = await dbLocal.products.get(id);
        if (!product || product.deleted) return null;
        const enriched = await _injectBranchData([product], activeBranchId, dbLocal);
        return enriched[0] || null;
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

        let matchedTier = null;
        if (!product || product.deleted) {
            product = await dbLocal.products
                .filter(p => !p.deleted && (
                    (Array.isArray(p.barcode) && p.barcode.includes(cleanCode)) ||
                    (Array.isArray(p.priceTiers) && p.priceTiers.some(t => t.plu === cleanCode))
                ))
                .first();

            if (product && !product.deleted && Array.isArray(product.priceTiers)) {
                matchedTier = product.priceTiers.find(t => t.plu === cleanCode) || null;
            }
        }

        if (product && !product.deleted) {
            // 🔥 IMPORTANTE: checkAndActivatePrice puede persistir el producto (precio programado).
            // Tiene que correr sobre el producto ORIGINAL, nunca sobre la versión "decorada" con el
            // tier — si no, un precio programado que se activa justo al escanear una variante
            // pisaría el nombre/precio real del padre en Dexie/Firestore con los datos del tier.
            const activeProduct = await checkAndActivatePrice(product, dbLocal);
            const enriched = await _injectBranchData([activeProduct], activeBranchId, dbLocal);
            let result = enriched[0];

            // Recién acá, sobre el resultado final (solo para esta lectura, no se persiste),
            // aplicamos el precio/nombre/tierPlu de la variante anexada.
            if (matchedTier) {
                result = {
                    ...result,
                    price: matchedTier.price,
                    name: `${result.name} - ${matchedTier.label}`,
                    tierPlu: matchedTier.plu
                };
            }

            return result;
        }

        return null;
    },

    // 🔥 supplierName: el combo de proveedor en ProductModal guarda el NOMBRE (mismo patrón que category/brand), no el id
    async search(query, supplierName = null, exclusive = false) {
        const dbLocal = await getDB();
        const { activeBranchId } = useAuthStore.getState();
        const term = query.toLowerCase().trim();
        if (!term) return [];

        let results = await dbLocal.products
            .filter(p => {
                if (p.deleted) return false;
                // 🔥 Búsqueda exclusiva: solo productos del proveedor seleccionado
                if (exclusive && supplierName && p.supplier !== supplierName) return false;
                if (p.name.toLowerCase().includes(term)) return true;
                // 🔥 Búsqueda por iniciales: "JV" también matchea "Jamón Viena"
                if (_matchesInitials(p.name, term)) return true;
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
        const enriched = await _injectBranchData(processedResults, activeBranchId, dbLocal);

        // 🔥 Prioriza (sin excluir) los productos del proveedor seleccionado en la compra
        if (supplierName && !exclusive) {
            return [...enriched].sort((a, b) => {
                const aMatch = a.supplier === supplierName ? 0 : 1;
                const bMatch = b.supplier === supplierName ? 0 : 1;
                return aMatch - bMatch;
            });
        }
        return enriched;
    },

    // 🔥 Listado por defecto de productos asignados a un proveedor (para pantalla de Compras)
    async getBySupplier(supplierName) {
        if (!supplierName) return [];
        const dbLocal = await getDB();
        const { activeBranchId } = useAuthStore.getState();

        const results = await dbLocal.products
            .filter(p => !p.deleted && p.supplier === supplierName)
            .limit(50)
            .toArray();

        return await _injectBranchData(results, activeBranchId, dbLocal);
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
            supplier: product.supplier !== undefined ? product.supplier : (existingProduct.supplier || ''),
            unit: product.unit || existingProduct.unit || 'UN',
            isWeighable: product.isWeighable !== undefined ? product.isWeighable : !!existingProduct.isWeighable,
            taxRate: parseFloat(product.taxRate) || existingProduct.taxRate || 21,
            minStock: product.minStock !== undefined ? (parseFloat(product.minStock) || 0) : (existingProduct.minStock || 0),

            cost: parseFloat(product.cost) || 0,
            price: parseFloat(product.price) || 0,
            minPrice: parseFloat(product.minPrice) || 0,
            
            nextPrice: product.nextPrice !== undefined ? product.nextPrice : (existingProduct.nextPrice || null),
            nextCost: product.nextCost !== undefined ? product.nextCost : (existingProduct.nextCost || null),
            priceActivationDate: product.priceActivationDate !== undefined ? product.priceActivationDate : (existingProduct.priceActivationDate || null),

            stock: product.stock !== undefined ? Number(product.stock) : (existingProduct.stock || 0),

            isCase: product.isCase !== undefined ? product.isCase : (existingProduct.isCase || false),
            caseProductId: product.caseProductId !== undefined ? product.caseProductId : (existingProduct.caseProductId || null),
            unitsPerCase: product.unitsPerCase !== undefined ? Number(product.unitsPerCase) : (existingProduct.unitsPerCase || 1),
            priceTiers: Array.isArray(product.priceTiers) ? product.priceTiers : (existingProduct.priceTiers || []),
            wholesalePricing: Array.isArray(product.wholesalePricing) ? product.wholesalePricing : (existingProduct.wholesalePricing || []),
            isCombo: product.isCombo !== undefined ? product.isCombo : (existingProduct.isCombo || false),
            components: Array.isArray(product.components) ? product.components : (existingProduct.components || []),

            updatedAt: timestamp,
            deleted: false,
            syncStatus: 'pending'
        };

        await dbLocal.products.put(masterProduct);

        if (isNewProduct && masterProduct.stock > 0) {
            let targetBranch = activeBranchId;
            
            // 🛡️ SEGURIDAD: Si no hay branch activa o es 'ALL', buscamos la primera sucursal disponible
            if (!targetBranch || targetBranch === 'ALL') {
                try {
                    const branches = await dbLocal.branches.where('companyId').equals(user.companyId).toArray();
                    if (branches.length > 0) {
                        targetBranch = branches[0].id;
                        console.log(`📦 [Auto-Assign] Asignando stock inicial a la sucursal: ${branches[0].name}`);
                    }
                } catch (e) {
                    console.warn("No se pudo encontrar una sucursal para el stock inicial.");
                }
            }

            if (targetBranch && targetBranch !== 'ALL') {
                try {
                    await this.addStock(
                        productId, 
                        masterProduct.stock, 
                        'Stock Inicial', 
                        user.name, 
                        targetBranch,
                        'STOCK_IN'
                    );
                } catch (err) {
                    console.error("Fallo al inyectar stock inicial:", err);
                }
            }
        }

        if (navigator.onLine) {
            const masterRef = doc(db, `companies/${user.companyId}/products`, productId);
            const { stock, syncStatus, ...cloudData } = masterProduct;
            
            // 🔥 FIRE AND FORGET: Resiliencia Local-First. No bloqueamos la UI esperando a Firebase
            setDoc(masterRef, {
                ...cloudData,
                updatedAt: serverTimestamp() 
            }, { merge: true })
            .then(() => dbLocal.products.update(productId, { syncStatus: 'synced' }))
            .catch(e => console.error("Error en sincronización directa:", e));
        }

        return masterProduct;
    },

    // 🔥 NUEVO: Método de actualización rápida (Inline Editing)
    async update(productId, updates) {
        const dbLocal = await getDB();
        const { user } = useAuthStore.getState();
        if (!user?.companyId) throw new Error("Sesión no válida.");

        // Guard: si el producto fue borrado (por listener de otra PC), no editar
        const current = await dbLocal.products.get(productId);
        if (!current || current.deleted) throw new Error("Producto eliminado. Recargá el inventario.");

        const timestamp = new Date().toISOString();

        // 1. GESTIÓN LOCAL INMEDIATA
        const localUpdates = { ...updates, updatedAt: timestamp, syncStatus: 'pending' };
        await dbLocal.products.update(productId, localUpdates);

        // 2. ☁️ FIRE AND FORGET CLOUD SYNC
        if (navigator.onLine) {
            const masterRef = doc(db, `companies/${user.companyId}/products`, productId);

            getDoc(masterRef).then(async (snap) => {
                let cloudData;
                if (snap.exists()) {
                    // Doc existe: solo subimos los campos cambiados
                    cloudData = { ...updates, updatedAt: serverTimestamp() };
                } else {
                    // Doc no existe: subimos el producto completo para no crear doc incompleto
                    const full = await dbLocal.products.get(productId);
                    if (!full) return;
                    const { stock, syncStatus, promo, ...rest } = full;
                    cloudData = { ...rest, ...updates, updatedAt: serverTimestamp() };
                }
                return setDoc(masterRef, cloudData, { merge: true });
            })
            .then(() => dbLocal.products.update(productId, { syncStatus: 'synced' }))
            .catch(e => console.error("Error en update directo:", e));
        }
    },

    // ==========================================
    // 🔗 ANEXAR PRODUCTO COMO VARIANTE (priceTier)
    // ==========================================
    async mergeAsVariant(childId, parentId, label) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();

        const child = await dbLocal.products.get(childId);
        const parent = await dbLocal.products.get(parentId);
        if (!child || !parent) throw new Error('Producto no encontrado');

        const existingTiers = Array.isArray(parent.priceTiers) ? parent.priceTiers : [];
        if (existingTiers.some(t => t.plu === child.code)) throw new Error(`El PLU ${child.code} ya existe en ${parent.name}`);

        const newTier = { plu: child.code, price: child.price, label: label.trim() };
        const timestamp = new Date().toISOString();

        const updatedParent = {
            ...parent,
            priceTiers: [...existingTiers, newTier],
            updatedAt: timestamp,
            syncStatus: 'pending'
        };

        // Transferir stock del hijo al padre (sucursal activa)
        if (activeBranchId && activeBranchId !== 'ALL') {
            const childInv = await dbLocal.inventory.get([activeBranchId, childId]);
            const parentInv = await dbLocal.inventory.get([activeBranchId, parentId]);
            const childStock = childInv ? parseFloat(childInv.stock) : 0;
            const parentStock = parentInv ? parseFloat(parentInv.stock) : 0;
            if (childStock > 0) {
                await dbLocal.inventory.put({
                    branchId: activeBranchId,
                    productId: parentId,
                    stock: parentStock + childStock,
                    updatedAt: timestamp,
                    syncStatus: 'pending'
                });
            }
        }

        await dbLocal.products.put(updatedParent);
        await dbLocal.products.update(childId, { deleted: true, updatedAt: timestamp, syncStatus: 'pending' });

        if (navigator.onLine && user?.companyId) {
            const { stock, syncStatus, ...cloudParent } = updatedParent;
            // 🔒 Batch atómico: el update del padre (nuevo tier) y el delete del hijo deben
            // llegar juntos a los listeners de otras sucursales. Con setDoc separados hay una
            // ventana donde otra sucursal ve al padre con el tier pero al hijo todavía "vivo"
            // (o viceversa), duplicando o faltando filas en la exportación a balanza.
            const batch = writeBatch(db);
            batch.set(doc(db, `companies/${user.companyId}/products`, parentId), { ...cloudParent, updatedAt: serverTimestamp() }, { merge: true });
            batch.set(doc(db, `companies/${user.companyId}/products`, childId), { deleted: true, updatedAt: serverTimestamp() }, { merge: true });
            batch.commit().catch(() => {});
        }

        return updatedParent;
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

        if (!user?.companyId) throw new Error("Sesión no válida.");
        
        const isVirtualLog = !branchId || branchId === 'ALL';

        const qty = parseFloat(quantity);
        if (isNaN(qty) || qty === 0) return;

        const timestamp = new Date().toISOString();
        const movId = `mov_${Date.now()}_${crypto.randomUUID().slice(0,5)}`;
        const type = movementType || (qty > 0 ? 'STOCK_IN' : 'STOCK_OUT');

        // Leer producto ANTES de la transacción para detectar si es caja
        const productData = await dbLocal.products.get(productId);
        const isCaseProduct = !!(productData?.isCase === true && productData?.caseProductId && Number(productData?.unitsPerCase) > 1);
        const unitProductId = isCaseProduct ? productData.caseProductId : null;
        const unitQty = isCaseProduct ? qty * Number(productData.unitsPerCase) : 0;
        const unitMovId = isCaseProduct ? `mov_${Date.now() + 1}_${crypto.randomUUID().slice(0,5)}` : null;

        // Cascade inverso: cajas que referencian este producto como unidad
        const casesForThisUnit = (!isCaseProduct && !isVirtualLog)
            ? await dbLocal.products.where('caseProductId').equals(productId).filter(p => !p.deleted && p.isCase === true && Number(p.unitsPerCase) > 1).toArray()
            : [];

        let newUnitStock = 0; // capturado en la transacción para usar en cloud sync

        // 🔄 TRANSACCIÓN LOCAL ATÓMICA
        await dbLocal.transaction('rw', [dbLocal.inventory, dbLocal.movements], async () => {
            // A. ACTUALIZAR INVENTARIO (Solo si hay sucursal)
            if (!isVirtualLog) {
                const currentInv = await dbLocal.inventory.where({ branchId, productId }).first();
                const currentStock = currentInv ? (parseFloat(currentInv.stock) || 0) : 0;
                newUnitStock = currentStock + qty;
                await dbLocal.inventory.put({
                    branchId,
                    productId,
                    stock: newUnitStock,
                    promo: currentInv?.promo || null,
                    updatedAt: timestamp,
                    syncStatus: 'pending'
                });

                // CASCADE caja→unidad: actualizar inventario del producto unitario
                if (isCaseProduct) {
                    const unitInv = await dbLocal.inventory.where({ branchId, productId: unitProductId }).first();
                    const unitCurrentStock = unitInv ? (parseFloat(unitInv.stock) || 0) : 0;
                    await dbLocal.inventory.put({
                        branchId,
                        productId: unitProductId,
                        stock: unitCurrentStock + unitQty,
                        promo: unitInv?.promo || null,
                        updatedAt: timestamp,
                        syncStatus: 'pending'
                    });
                }

                // CASCADE INVERSO unidad→cajas: recalcular stock de cada caja
                for (const caseProduct of casesForThisUnit) {
                    const newCaseStock = Math.floor(newUnitStock / Number(caseProduct.unitsPerCase));
                    const caseInv = await dbLocal.inventory.where({ branchId, productId: caseProduct.id }).first();
                    await dbLocal.inventory.put({
                        branchId,
                        productId: caseProduct.id,
                        stock: newCaseStock,
                        promo: caseInv?.promo || null,
                        updatedAt: timestamp,
                        syncStatus: 'pending'
                    });
                }
            }

            // B. REGISTRAR MOVIMIENTO (SIEMPRE, incluso si es virtual)
            await dbLocal.movements.add({
                id: movId,
                productId,
                branchId: isVirtualLog ? 'GLOBAL' : branchId,
                type: type,
                amount: Math.abs(qty),
                description: description || 'Ajuste Inicial',
                user: userName,
                date: timestamp,
                refId: null,
                syncStatus: 'pending'
            });

            // CASCADE: movimiento del producto unitario
            if (isCaseProduct) {
                await dbLocal.movements.add({
                    id: unitMovId,
                    productId: unitProductId,
                    branchId: isVirtualLog ? 'GLOBAL' : branchId,
                    type: type,
                    amount: Math.abs(unitQty),
                    description: `Desde caja: ${description || 'Ajuste'}`,
                    user: userName,
                    date: timestamp,
                    refId: productId,
                    syncStatus: 'pending'
                });
            }
        });

        // ☁️ ACTUALIZACIÓN CLOUD
        if (navigator.onLine) {
            const batch = writeBatch(db);
            
            // 1. Inventario (Solo si hay sucursal)
            if (!isVirtualLog) {
                const inventoryRef = doc(db, `companies/${user.companyId}/branches/${branchId}/inventory`, productId);
                batch.set(inventoryRef, { stock: increment(qty), updatedAt: serverTimestamp() }, { merge: true });
            }

            // 2. Movimiento Maestro
            const logRef = doc(db, `companies/${user.companyId}/movements`, movId);
            batch.set(logRef, {
                productId,
                amount: Math.abs(qty),
                branchId: isVirtualLog ? 'GLOBAL' : branchId,
                type: type,
                description: description,
                user: userName,
                date: serverTimestamp(),
                refId: null
            });

            // 3. 🔥 ACTUALIZAR PRODUCTO (Para despertar el Delta Sync)
            const productRef = doc(db, `companies/${user.companyId}/products`, productId);
            batch.set(productRef, { updatedAt: serverTimestamp() }, { merge: true });

            // CASCADE cloud: inventario y movimiento del producto unitario
            if (isCaseProduct) {
                if (!isVirtualLog) {
                    const unitInvRef = doc(db, `companies/${user.companyId}/branches/${branchId}/inventory`, unitProductId);
                    batch.set(unitInvRef, { stock: increment(unitQty), updatedAt: serverTimestamp() }, { merge: true });
                }
                const unitLogRef = doc(db, `companies/${user.companyId}/movements`, unitMovId);
                batch.set(unitLogRef, {
                    productId: unitProductId,
                    amount: Math.abs(unitQty),
                    branchId: isVirtualLog ? 'GLOBAL' : branchId,
                    type: type,
                    description: `Desde caja: ${description || 'Ajuste'}`,
                    user: userName,
                    date: serverTimestamp(),
                    refId: productId
                });
                const unitProductCloudRef = doc(db, `companies/${user.companyId}/products`, unitProductId);
                batch.set(unitProductCloudRef, { updatedAt: serverTimestamp() }, { merge: true });
            }

            // CASCADE INVERSO cloud: set absoluto del stock de cada caja
            for (const caseProduct of casesForThisUnit) {
                const newCaseStock = Math.floor(newUnitStock / Number(caseProduct.unitsPerCase));
                const caseInvRef = doc(db, `companies/${user.companyId}/branches/${branchId}/inventory`, caseProduct.id);
                batch.set(caseInvRef, { stock: newCaseStock, updatedAt: serverTimestamp() }, { merge: true });
                const caseProductRef = doc(db, `companies/${user.companyId}/products`, caseProduct.id);
                batch.set(caseProductRef, { updatedAt: serverTimestamp() }, { merge: true });
            }

            // 🔥 FIRE AND FORGET: No bloqueamos el POS esperando el commit
            batch.commit().then(async () => {
                if (!isVirtualLog) await dbLocal.inventory.update([branchId, productId], {syncStatus: 'synced'});
                await dbLocal.movements.update(movId, {syncStatus: 'synced'});
                if (isCaseProduct && !isVirtualLog) await dbLocal.inventory.update([branchId, unitProductId], {syncStatus: 'synced'});
                if (isCaseProduct && unitMovId) await dbLocal.movements.update(unitMovId, {syncStatus: 'synced'});
                for (const caseProduct of casesForThisUnit) {
                    await dbLocal.inventory.update([branchId, caseProduct.id], {syncStatus: 'synced'});
                }
            }).catch(e => console.error("Error sync cloud stock:", e));
        }

        // RETORNAR EL NUEVO STOCK PARA ACTUALIZACIÓN ATÓMICA DE UI
        const finalInv = await dbLocal.inventory.where({ branchId, productId }).first();
        return finalInv ? parseFloat(finalInv.stock) : 0;
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
            const invRef = doc(db, `companies/${user.companyId}/branches/${activeBranchId}/inventory`, productId);
            
            // 🔥 FIRE AND FORGET
            setDoc(invRef, { 
                promo: promoRule,
                updatedAt: serverTimestamp()
            }, { merge: true })
            .catch(e => console.error("Error syncing promo:", e));
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
            // Fire and forget: consistente con el resto del repositorio
            updateDoc(docRef, { deleted: true, updatedAt: serverTimestamp() }).catch(e =>
                console.error("Error sync delete producto:", e)
            );
        }
    },

    async getCasesByUnit(unitProductId) {
        const dbLocal = await getDB();
        return dbLocal.products
            .where('caseProductId').equals(unitProductId)
            .filter(p => !p.deleted)
            .toArray();
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