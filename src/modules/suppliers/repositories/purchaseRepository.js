import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { 
    doc, updateDoc, getDoc, setDoc, deleteDoc, collection, 
    query, where, getDocs, limit, orderBy, increment, serverTimestamp 
} from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore';

// 🔥 GENERADOR DE ID GLOBAL ÚNICO (Blindaje Multi-Caja)
const generateGlobalId = (prefix) => {
    const { activeBranchId } = useAuthStore.getState();
    const branchClean = String(activeBranchId || 'main').substring(0, 4);
    const ts = Date.now();
    const rand = Math.random().toString(36).substr(2, 4);
    return `${prefix}_${branchClean}_${ts}_${rand}`;
};

// ==========================================
// ☁️ HELPER: SYNC OPTIMISTA BLINDADO
// ==========================================
const triggerOptimisticSync = async (collectionName, data, isDelete = false) => {
    if (!navigator.onLine) return; 
    const { user } = useAuthStore.getState();
    if (!user?.companyId) return;

    try {
        const path = `companies/${user.companyId}/${collectionName}`;
        
        // 🔥 FIX CRÍTICO: Forzamos el ID a String para evitar que Firebase crashee en silencio
        const cloudId = String(data.firestoreId || data.id);

        if (isDelete) {
            await deleteDoc(doc(db, path, cloudId));
        } else {
            const { syncStatus, localId, ...cloudData } = data;
            await setDoc(doc(db, path, cloudId), {
                ...cloudData,
                // 🔥 FIX: forzamos Timestamp real (no string) para no romper los queries
                // where('updatedAt', '>'/'>=', ...) que usan otras PCs (listeners y delta-sync)
                ...(cloudData.updatedAt !== undefined ? { updatedAt: serverTimestamp() } : {}),
                firestoreId: cloudId,
                syncedAt: new Date().toISOString(),
                syncStatus: 'synced',
                lastUpdatedBy: user.uid
            }, { merge: true });
        }

        const dbLocal = await getDB();
        const table = dbLocal.table(collectionName);
        if (table && !isDelete) await table.update(data.id, { syncStatus: 'synced', firestoreId: cloudId });
        
    } catch (e) { 
        console.warn(`❌ Sync error en ${collectionName}:`, e); 
    }
};

export const purchaseRepository = {

    // ==========================================
    // 🧠 LÓGICA DE COSTOS 
    // ==========================================
    _calculateLineItem(inputCost, inputPrice, taxRate, isTaxIncluded) {
        let netCost = 0;
        let finalCostWithTax = 0;
        let taxAmount = 0;
        const rate = parseFloat(taxRate) || 0;
        const cost = parseFloat(inputCost) || 0;

        if (isTaxIncluded) {
            finalCostWithTax = cost;
            netCost = cost / (1 + (rate / 100));
            taxAmount = finalCostWithTax - netCost;
        } else {
            netCost = cost;
            taxAmount = cost * (rate / 100);
            finalCostWithTax = cost + taxAmount;
        }

        let markup = 0;
        const price = parseFloat(inputPrice) || 0;
        if (price > 0 && finalCostWithTax > 0) {
            markup = ((price - finalCostWithTax) / finalCostWithTax) * 100;
        }

        return {
            netCost,
            taxAmount,
            finalCost: finalCostWithTax,
            price: price,
            markup: markup
        };
    },

    // ==========================================
    // 📖 HISTORIAL Y LISTADO PAGINADO
    // ==========================================
    async getHistoryPaged(page = 1, pageSize = 20, filters = {}) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();
        
        let shouldHydrate = false;
        if (activeBranchId && activeBranchId !== 'ALL') {
            const count = await dbLocal.purchases.where('branchId').equals(activeBranchId).count();
            if (count === 0) shouldHydrate = true;
        } else {
            const count = await dbLocal.purchases.count();
            if (count === 0) shouldHydrate = true;
        }

        if (shouldHydrate && navigator.onLine && user?.companyId) {
            console.log(`📥 Hidratando compras para: ${activeBranchId}...`);
            try {
                let q = query(
                    collection(db, `companies/${user.companyId}/purchases`),
                    orderBy('date', 'desc'),
                    limit(50)
                );
                
                if (activeBranchId && activeBranchId !== 'ALL') {
                    q = query(q, where('branchId', '==', activeBranchId));
                }

                const snap = await getDocs(q);
                const cloudData = snap.docs.map(d => ({ 
                    ...d.data(), 
                    id: d.id, 
                    syncStatus: 'synced' 
                }));
                
                if (cloudData.length > 0) {
                    await dbLocal.purchases.bulkPut(cloudData);
                }
            } catch (e) { console.error("Cloud Error:", e); }
        }

        let collectionRef = dbLocal.purchases.orderBy('date').reverse();

        collectionRef = collectionRef.filter(p => {
            if (activeBranchId && activeBranchId !== 'ALL' && p.branchId !== activeBranchId) return false;

            let match = true;
            if (filters.supplierId && p.supplierId !== filters.supplierId) match = false;
            
            if (match && filters.status && filters.status !== 'ALL') {
                const status = p.paymentStatus || 'PAID'; 
                if (status !== filters.status) match = false;
            }
            
            if (match && filters.search) {
                const term = filters.search.toLowerCase();
                const invoice = (p.invoiceNumber || '').toLowerCase();
                const supplier = (p.supplierName || '').toLowerCase();
                if (!invoice.includes(term) && !supplier.includes(term)) match = false;
            }
            return match;
        });

        const totalCount = await collectionRef.count();
        const offset = (page - 1) * pageSize;
        const data = await collectionRef.offset(offset).limit(pageSize).toArray();

        return { data, totalCount, totalPages: Math.ceil(totalCount / pageSize) || 1 };
    },

    // ==========================================
    // 📊 ESTADÍSTICAS (ÚLTIMOS 30 DÍAS)
    // ==========================================
    async getStats() { return this.getBranchStats(); },

    async getBranchStats() {
        const dbLocal = await getDB();
        const { activeBranchId } = useAuthStore.getState();
        
        const allPurchases = await dbLocal.purchases
            .filter(p => !activeBranchId || activeBranchId === 'ALL' || p.branchId === activeBranchId)
            .toArray();
        
        const now = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(now.getDate() - 30);

        let monthTotal = 0;
        let totalDebt = 0;

        allPurchases.forEach(p => {
            const pDate = new Date(p.date || p.createdAt);
            const total = parseFloat(p.total) || 0;
            const remaining = parseFloat(p.remainingBalance) || 0;

            if (pDate >= thirtyDaysAgo) {
                monthTotal += total;
            }

            if (remaining > 0.01) { 
                totalDebt += remaining;
            }
        });

        return { 
            count: allPurchases.length, 
            monthTotal, 
            totalDebt 
        };
    },

    // ==========================================
    // 🔍 DETALLES DE COMPRA
    // ==========================================
    async getFullDetail(purchaseId) {
        const dbLocal = await getDB();
        const { user } = useAuthStore.getState();
        
        let header = await dbLocal.purchases.get(purchaseId);

        if (!header && user?.companyId && navigator.onLine) {
            try {
                const docRef = doc(db, `companies/${user.companyId}/purchases`, String(purchaseId));
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    header = { ...docSnap.data(), id: docSnap.id, syncStatus: 'synced' };
                    await dbLocal.purchases.put(header);
                }
            } catch (e) { console.error("Error recuperando detalle de la nube:", e); }
        }
        return header;
    },

    async getPurchaseItems(purchaseId) {
        const dbLocal = await getDB();
        const purchase = await dbLocal.purchases.get(purchaseId);
        if (purchase && purchase.items) return purchase.items;
        return [];
    },

    // ==========================================
    // 🚚 REGISTRO DE COMPRA (INGRESO MERCADERÍA)
    // ==========================================
    async registerPurchase(purchaseHeader, items) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();
        
        if (!user) throw new Error("Sin sesión.");
        const branchId = purchaseHeader.branchId || activeBranchId || 'main';

        const purchaseId = purchaseHeader.id || generateGlobalId('purch');
        const timestamp = new Date().toISOString();

        // 1. Preparar Cabecera de Compra
        const purchase = {
            ...purchaseHeader,
            id: purchaseId,
            branchId,
            date: purchaseHeader.date || timestamp,
            createdAt: timestamp,
            status: 'COMPLETED',
            itemsCount: items.length,
            totalNet: 0,
            totalTax: 0,
            totalFinal: 0,
            total: 0, 
            syncStatus: 'pending',
            amountPaid: 0,
            remainingBalance: 0,
            paymentStatus: 'UNPAID' 
        };

        const productsToUpdate = [];
        const inventoryToUpdate = [];
        const movementsToCreate = [];
        const newProductsToCreate = [];
        let newLedgerEntry = null;
        let paymentLedgerEntry = null;
        let newCashMovement = null;
        let updatedSupplier = null;

        // 2. Procesar Ítems
        for (const item of items) {
            const financials = this._calculateLineItem(item.cost, item.price, item.tax, item.isTaxIncluded);
            
            purchase.totalNet += (financials.netCost * item.qty);
            purchase.totalTax += (financials.taxAmount * item.qty);
            purchase.totalFinal += (financials.finalCost * item.qty);
            purchase.total += (financials.finalCost * item.qty); 

            let productId = item.id;
            let product = null;

            if (productId) {
                product = await dbLocal.products.get(productId);
            } else {
                product = await dbLocal.products.where('code').equals(item.code).first();
            }

            if (!product) {
                productId = generateGlobalId('prod');
                product = {
                    id: productId,
                    code: item.code,
                    name: item.name.toUpperCase(),
                    barcode: item.code,
                    categoryId: 'general',
                    active: true,
                    isWeighable: false,
                    createdAt: timestamp
                };
                newProductsToCreate.push({ ...product, syncStatus: 'pending' });
            }

            // PPP (Precio Promedio Ponderado)
            const currentStock = parseFloat(product.stock || 0);
            const currentCost = parseFloat(product.cost || 0);
            const newQty = parseFloat(item.qty);
            
            let newWeightedCost = financials.finalCost;

            if (currentStock > 0) {
                const totalValueOld = currentCost * currentStock;
                const totalValueNew = financials.finalCost * newQty;
                newWeightedCost = (totalValueOld + totalValueNew) / (currentStock + newQty);
            }

            const productUpdate = {
                ...product,
                cost: newWeightedCost, 
                lastPurchaseDate: timestamp,
                supplierId: purchaseHeader.supplierId,
                updatedAt: timestamp,
                syncStatus: 'pending'
            };

            // Lógica de Programación de Precios
            if (item.activationDate) {
                productUpdate.nextPrice = financials.price;
                productUpdate.priceActivationDate = item.activationDate;
                productUpdate.price = product.price; 
            } else {
                productUpdate.price = financials.price > 0 ? financials.price : product.price;
                productUpdate.nextPrice = null;
                productUpdate.priceActivationDate = null;
            }
            
            const newBatch = {
                id: generateGlobalId('batch'),
                purchaseId: purchaseId,
                dateAdded: timestamp,
                quantity: newQty,
                originalCost: financials.finalCost,
                expiryDate: item.expiryDate || null
            };
            
            const currentBatches = product.batches || [];
            productUpdate.batches = [...currentBatches, newBatch];
            productUpdate.stock = currentStock + newQty;

            productsToUpdate.push(productUpdate);

            inventoryToUpdate.push({
                productId: productId,
                branchId: branchId,
                stock: currentStock + newQty,
                updatedAt: timestamp,
                syncStatus: 'pending_stock'
            });

            movementsToCreate.push({
                id: generateGlobalId('mov'),
                productId: productId,
                type: 'STOCK_IN',
                description: `Compra Fac ${purchaseHeader.invoiceNumber || ''}`,
                amount: newQty,
                date: timestamp,
                branchId: branchId,
                user: user.name,
                refId: purchaseId,
                syncStatus: 'pending'
            });
        }

        // AJUSTE DE SALDOS INICIALES
        const initialPay = parseFloat(purchaseHeader.amountPaid || purchaseHeader.initialPayment || 0);
        purchase.amountPaid = initialPay;
        purchase.remainingBalance = Math.max(0, purchase.totalFinal - initialPay);
        
        if (purchase.remainingBalance <= 0.01) purchase.paymentStatus = 'PAID';
        else if (initialPay > 0) purchase.paymentStatus = 'PARTIAL';
        else purchase.paymentStatus = 'UNPAID';

        purchase.items = items; 

        // 3. Transacción ACID Gigante Local
        await dbLocal.transaction('rw', [
            dbLocal.purchases, 
            dbLocal.products, 
            dbLocal.inventory, 
            dbLocal.movements, 
            dbLocal.suppliers, 
            dbLocal.supplier_ledger,
            dbLocal.cash_movements,
            dbLocal.shifts
        ], async () => {
            
            await dbLocal.purchases.put(purchase);

            if (newProductsToCreate.length) await dbLocal.products.bulkPut(newProductsToCreate);
            if (productsToUpdate.length) await dbLocal.products.bulkPut(productsToUpdate);
            if (inventoryToUpdate.length) await dbLocal.inventory.bulkPut(inventoryToUpdate);
            if (movementsToCreate.length) await dbLocal.movements.bulkPut(movementsToCreate);

            // Manejo Financiero (Cta Cte Proveedor)
            const supplier = await dbLocal.suppliers.get(purchaseHeader.supplierId);
            if (supplier) {
                let runningBalance = parseFloat(supplier.balance || 0);
                
                // Sumar SIEMPRE el total de la compra como deuda
                runningBalance += purchase.totalFinal;
                newLedgerEntry = {
                    id: generateGlobalId('sledg'),
                    supplierId: supplier.id,
                    date: timestamp,
                    type: 'PURCHASE', 
                    amount: purchase.totalFinal, 
                    description: `Fac ${purchaseHeader.invoiceNumber || 'S/N'}`,
                    balance: runningBalance,
                    refId: purchaseId,
                    syncStatus: 'pending'
                };
                await dbLocal.supplier_ledger.put(newLedgerEntry);

                // Si hubo un pago parcial/total, crear renglón de pago que baja la deuda
                if (initialPay > 0 && purchaseHeader.paymentMethod !== 'debt') {
                    runningBalance -= initialPay;
                    paymentLedgerEntry = {
                        id: generateGlobalId('sledg_pay'),
                        supplierId: supplier.id,
                        date: timestamp,
                        type: 'PAYMENT', 
                        amount: initialPay, 
                        description: `Pago inicial Fac ${purchaseHeader.invoiceNumber || 'S/N'}`,
                        balance: runningBalance,
                        refId: purchaseId,
                        syncStatus: 'pending'
                    };
                    await dbLocal.supplier_ledger.put(paymentLedgerEntry);
                }

                // Guardar el saldo final correcto
                updatedSupplier = { ...supplier, balance: runningBalance, syncStatus: 'pending' };
                await dbLocal.suppliers.update(supplier.id, updatedSupplier);
            }

            // Salida de Caja FÍSICA
            if (initialPay > 0 && purchaseHeader.paymentMethod !== 'debt') {
                const activeShift = await dbLocal.shifts
                    .where('status').equals('OPEN')
                    .filter(s => s.userId === user.uid && s.branchId === branchId)
                    .first();
                
                if (activeShift) {
                    newCashMovement = {
                        id: generateGlobalId('cm'),
                        shiftId: activeShift.id,
                        type: 'PURCHASE', 
                        method: purchaseHeader.paymentMethod || 'cash',
                        amount: initialPay,
                        description: `Pago Prov. ${purchaseHeader.supplierName} (Fac ${purchaseHeader.invoiceNumber})`,
                        date: timestamp,
                        branchId: branchId,
                        userId: user.uid,
                        user: user.name,
                        companyId: user.companyId,
                        supplierName: purchaseHeader.supplierName,
                        referenceId: purchaseId,
                        syncStatus: 'pending'
                    };
                    await dbLocal.cash_movements.put(newCashMovement);
                }
            }
        });

        // 4. 🔥 FIREBASE CLOUD: ACTUALIZACIÓN ATÓMICA DE STOCK EN LA NUBE 🔥
        if (navigator.onLine && user?.companyId) {
            items.forEach(item => {
                const stockRef = doc(db, `companies/${user.companyId}/branches/${branchId}/inventory`, String(item.id || item.productId));
                setDoc(stockRef, {
                    stock: increment(parseFloat(item.qty)), 
                    updatedAt: serverTimestamp()
                }, { merge: true }).catch(err => console.error("Error atomic stock increment:", err));
            });
        }

        // 5. 🔥 SYNC OPTIMISTA BACKGROUND (CUBRIMOS TODO)
        triggerOptimisticSync('purchases', purchase);
        productsToUpdate.forEach(p => triggerOptimisticSync('products', p));
        newProductsToCreate.forEach(p => triggerOptimisticSync('products', p));
        movementsToCreate.forEach(m => triggerOptimisticSync('movements', m));
        
        if (updatedSupplier) triggerOptimisticSync('suppliers', updatedSupplier);
        if (newLedgerEntry) triggerOptimisticSync('supplier_ledger', newLedgerEntry);
        if (paymentLedgerEntry) triggerOptimisticSync('supplier_ledger', paymentLedgerEntry);
        if (newCashMovement) triggerOptimisticSync('cash_movements', newCashMovement);

        return purchase;
    },

    // ==========================================
    // 💰 REGISTRO DE PAGOS POSTERIORES DE DEUDA
    // ==========================================
    async registerPayment(paymentData) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();
        const timestamp = new Date().toISOString();
        const branchId = activeBranchId || 'main';

        const { supplierId, amount, method, description, refId } = paymentData;

        let updatedPurchase = null;
        let updatedSupplier = null;
        let newLedgerEntry = null;
        let newCashMovement = null;

        await dbLocal.transaction('rw', [
            dbLocal.purchases, 
            dbLocal.suppliers, 
            dbLocal.supplier_ledger, 
            dbLocal.cash_movements,
            dbLocal.shifts
        ], async () => {

            // 1. Si es pago de una factura específica
            if (refId) {
                const purchase = await dbLocal.purchases.get(refId);
                if (purchase) {
                    const newPaid = (parseFloat(purchase.amountPaid) || 0) + parseFloat(amount);
                    const newRemaining = Math.max(0, (parseFloat(purchase.remainingBalance) || 0) - parseFloat(amount));
                    const newStatus = newRemaining <= 0.01 ? 'PAID' : 'PARTIAL';

                    updatedPurchase = { ...purchase, amountPaid: newPaid, remainingBalance: newRemaining, paymentStatus: newStatus, syncStatus: 'pending' };
                    await dbLocal.purchases.update(refId, updatedPurchase);
                }
            }

            // 2. Actualizar Saldo Global del Proveedor
            const supplier = await dbLocal.suppliers.get(supplierId);
            let supplierName = '';
            
            if (supplier) {
                supplierName = supplier.name;
                const currentBalance = parseFloat(supplier.balance || 0);
                const newBalance = Math.max(0, currentBalance - parseFloat(amount));

                updatedSupplier = { ...supplier, balance: newBalance, syncStatus: 'pending' };
                await dbLocal.suppliers.update(supplierId, updatedSupplier);

                newLedgerEntry = {
                    id: generateGlobalId('sledger'),
                    supplierId: supplierId,
                    date: timestamp,
                    type: 'PAYMENT',
                    amount: parseFloat(amount),
                    description: description || 'Pago a cuenta',
                    balance: newBalance,
                    refId: refId || null,
                    syncStatus: 'pending'
                };
                await dbLocal.supplier_ledger.put(newLedgerEntry);
            }

            // 3. Salida de Caja (Egreso Real)
            if (method !== 'debt') {
                const activeShift = await dbLocal.shifts
                    .where('status').equals('OPEN')
                    .filter(s => s.userId === user.uid && s.branchId === branchId)
                    .first();

                if (activeShift) {
                    newCashMovement = {
                        id: generateGlobalId('cm'),
                        shiftId: activeShift.id,
                        type: 'PURCHASE', 
                        method: method,
                        amount: parseFloat(amount),
                        description: `Pago Prov. ${supplierName} - ${description}`,
                        date: timestamp,
                        branchId: branchId,
                        userId: user.uid,
                        user: user.name,
                        companyId: user.companyId,
                        supplierName: supplierName,
                        referenceId: refId || null,
                        syncStatus: 'pending'
                    };
                    await dbLocal.cash_movements.put(newCashMovement);
                }
            }
        });

        // 🔥 Disparo Seguro de Sincronización
        if (updatedPurchase) triggerOptimisticSync('purchases', updatedPurchase);
        if (updatedSupplier) triggerOptimisticSync('suppliers', updatedSupplier);
        if (newLedgerEntry) triggerOptimisticSync('supplier_ledger', newLedgerEntry);
        if (newCashMovement) triggerOptimisticSync('cash_movements', newCashMovement);

        return true;
    },

    // ==========================================
    // 🗑️ ESCRITURA: ANULAR COMPRA (Reversa Total)
    // ==========================================
    async voidPurchase(purchaseId) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();
        const purchase = await dbLocal.purchases.get(purchaseId);
        if (!purchase) throw new Error("Compra no encontrada");

        let updatedSupplier = null;
        let newLedgerEntry = null;
        let productsToUpdate = [];
        const branchId = purchase.branchId || activeBranchId || 'main';

        await dbLocal.transaction('rw', [
            dbLocal.purchases, dbLocal.products, 
            dbLocal.suppliers, dbLocal.cash_movements, dbLocal.supplier_ledger
        ], async () => {

            // 1. Restaurar Stock Local
            if (purchase.items && Array.isArray(purchase.items)) {
                for (const item of purchase.items) {
                    const product = await dbLocal.products.get(item.id || item.productId);
                    if (product) {
                        const newStock = Math.max(0, (parseFloat(product.stock) || 0) - (parseFloat(item.qty || item.quantity) || 0));
                        const prodUpdate = { ...product, stock: newStock, syncStatus: 'pending' };
                        await dbLocal.products.update(product.id, prodUpdate);
                        productsToUpdate.push(prodUpdate);
                    }
                }
            }

            // 2. Reversar Saldo Proveedor
            if (purchase.remainingBalance > 0) {
                const supplier = await dbLocal.suppliers.get(purchase.supplierId);
                if (supplier) {
                    const newBalance = Math.max(0, (parseFloat(supplier.balance) || 0) - parseFloat(purchase.remainingBalance));
                    updatedSupplier = { ...supplier, balance: newBalance, syncStatus: 'pending' };
                    await dbLocal.suppliers.update(purchase.supplierId, updatedSupplier);

                    newLedgerEntry = {
                        id: generateGlobalId('sledg_void'),
                        supplierId: supplier.id,
                        date: new Date().toISOString(),
                        type: 'VOID', 
                        amount: purchase.remainingBalance,
                        description: `Anulación Fac ${purchase.invoiceNumber}`,
                        balance: newBalance,
                        refId: purchaseId,
                        syncStatus: 'pending'
                    };
                    await dbLocal.supplier_ledger.put(newLedgerEntry);
                }
            }

            // 3. Eliminar movimientos de caja asociados
            const relatedMovements = await dbLocal.cash_movements
                .filter(m => m.referenceId === purchaseId)
                .toArray();
            
            for (const mov of relatedMovements) {
                await dbLocal.cash_movements.delete(mov.id);
                triggerOptimisticSync('cash_movements', mov, true);
            }

            // 4. Marcar compra como ANULADA
            purchase.status = 'VOIDED';
            purchase.paymentStatus = 'VOIDED';
            purchase.syncStatus = 'pending';
            await dbLocal.purchases.update(purchaseId, purchase);
        });

        // 🔥 RESTAURAR STOCK ATÓMICO EN LA NUBE 🔥
        if (navigator.onLine && user?.companyId) {
            if (purchase.items && Array.isArray(purchase.items)) {
                purchase.items.forEach(item => {
                    const stockRef = doc(db, `companies/${user.companyId}/branches/${branchId}/inventory`, String(item.id || item.productId));
                    setDoc(stockRef, {
                        stock: increment(-parseFloat(item.qty || item.quantity || 0)), 
                        updatedAt: serverTimestamp()
                    }, { merge: true }).catch(err => console.error("Error atomic stock decrement:", err));
                });
            }
        }

        // 🔥 SYNC OPTIMISTA
        triggerOptimisticSync('purchases', purchase);
        productsToUpdate.forEach(p => triggerOptimisticSync('products', p));
        if (updatedSupplier) triggerOptimisticSync('suppliers', updatedSupplier);
        if (newLedgerEntry) triggerOptimisticSync('supplier_ledger', newLedgerEntry);

        return true;
    },

    // ==========================================
    // 📦 DEVOLUCIÓN DE MERCADERÍA A PROVEEDOR
    // ==========================================
    async processRefund(purchase, returnMap, refundTotal, reason, refundCash) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();
        const branchId = purchase.branchId || activeBranchId || 'main';
        const timestamp = new Date().toISOString();

        let updatedSupplier = null;
        let newLedgerEntry = null;
        let newCashMovement = null;
        const productsToUpdate = [];
        const inventoryToUpdate = [];
        const movementsToCreate = [];

        // 1. Actualizar Ítems de la Compra (Restar lo devuelto)
        const updatedItems = purchase.items.map(item => {
            const itemId = item.id || item.productId;
            const qtyToReturn = returnMap[itemId] || 0;
            if (qtyToReturn > 0) {
                return {
                    ...item,
                    returnedQty: (item.returnedQty || 0) + qtyToReturn
                };
            }
            return item;
        });

        // 2. Descontar Stock Local
        for (const itemId of Object.keys(returnMap)) {
            const qtyToReturn = returnMap[itemId];
            if (qtyToReturn <= 0) continue;

            const product = await dbLocal.products.get(itemId);
            if (product) {
                const currentStock = parseFloat(product.stock || 0);
                const newStock = Math.max(0, currentStock - qtyToReturn);

                productsToUpdate.push({ ...product, stock: newStock, syncStatus: 'pending' });
                
                inventoryToUpdate.push({
                    productId: String(itemId), branchId, stock: newStock,
                    updatedAt: timestamp, syncStatus: 'pending_stock'
                });

                movementsToCreate.push({
                    id: generateGlobalId('mov'),
                    productId: String(itemId),
                    type: 'STOCK_OUT',
                    subtype: 'SUPPLIER_REFUND',
                    description: `Dev. Prov: ${reason}`,
                    amount: qtyToReturn,
                    date: timestamp,
                    branchId,
                    user: user.name,
                    refId: purchase.id,
                    syncStatus: 'pending'
                });
            }
        }

        // 3. Manejo Financiero (Dinero o Deuda)
        let newRemainingBalance = parseFloat(purchase.remainingBalance || 0);
        let newAmountPaid = parseFloat(purchase.amountPaid || 0);

        if (refundCash) {
            // El proveedor nos dio los billetes de vuelta: Entra a Caja
            const activeShift = await dbLocal.shifts
                .where('status').equals('OPEN')
                .filter(s => s.userId === user.uid && s.branchId === branchId)
                .first();

            if (!activeShift) throw new Error("Debe abrir la caja para ingresar el efectivo devuelto por el proveedor.");

            newCashMovement = {
                id: generateGlobalId('cm'),
                shiftId: activeShift.id,
                type: 'IN', 
                subtype: 'SUPPLIER_REFUND',
                method: 'cash',
                amount: refundTotal,
                description: `Devolución Efectivo de ${purchase.supplierName} (${reason})`,
                date: timestamp,
                branchId, userId: user.uid, companyId: user.companyId, referenceId: purchase.id,
                syncStatus: 'pending'
            };
            
            // Si devolvió efectivo, ajustamos lo que "realmente hemos pagado" de esa factura
            newAmountPaid = Math.max(0, newAmountPaid - refundTotal);
        } else {
            // Nota de Crédito: Baja nuestra deuda con él
            newRemainingBalance = Math.max(0, newRemainingBalance - refundTotal);
            
            const supplier = await dbLocal.suppliers.get(purchase.supplierId);
            if (supplier) {
                const currentBalance = parseFloat(supplier.balance || 0);
                const newSupplierBalance = Math.max(0, currentBalance - refundTotal);
                updatedSupplier = { ...supplier, balance: newSupplierBalance, syncStatus: 'pending' };
                
                newLedgerEntry = {
                    id: generateGlobalId('sledg'),
                    supplierId: supplier.id,
                    date: timestamp,
                    type: 'REFUND',
                    amount: refundTotal,
                    description: `Nota Crédito (Dev. Fac ${purchase.invoiceNumber}) - ${reason}`,
                    balance: newSupplierBalance,
                    refId: purchase.id,
                    syncStatus: 'pending'
                };
            }
        }

        // 4. Actualizar Totales de la Compra
        const oldTotal = parseFloat(purchase.totalFinal || purchase.total || 0);
        const newTotal = Math.max(0, oldTotal - refundTotal);
        const refundedAmountTotal = (parseFloat(purchase.refundedAmount || 0)) + refundTotal;

        const isFullyRefunded = updatedItems.every(i => (i.returnedQty || 0) >= parseFloat(i.qty || i.quantity || 0));
        const newStatus = isFullyRefunded ? 'REFUNDED' : 'PARTIAL_REFUND';

        const updatedPurchase = {
            ...purchase,
            items: updatedItems,
            totalFinal: newTotal,
            total: newTotal,
            remainingBalance: newRemainingBalance,
            amountPaid: newAmountPaid,
            refundedAmount: refundedAmountTotal,
            status: newStatus,
            notes: (purchase.notes ? purchase.notes + '\n' : '') + `[${new Date().toLocaleDateString()}] Devolución: ${reason} ($${refundTotal})`,
            syncStatus: 'pending'
        };

        // 5. Transacción Local ACID
        await dbLocal.transaction('rw', [
            dbLocal.purchases, dbLocal.products, dbLocal.inventory, dbLocal.movements, 
            dbLocal.suppliers, dbLocal.supplier_ledger, dbLocal.cash_movements, dbLocal.shifts
        ], async () => {
            await dbLocal.purchases.update(purchase.id, updatedPurchase);
            
            if (productsToUpdate.length) await dbLocal.products.bulkPut(productsToUpdate);
            if (inventoryToUpdate.length) await dbLocal.inventory.bulkPut(inventoryToUpdate);
            if (movementsToCreate.length) await dbLocal.movements.bulkPut(movementsToCreate);

            if (updatedSupplier) await dbLocal.suppliers.update(updatedSupplier.id, updatedSupplier);
            if (newLedgerEntry) await dbLocal.supplier_ledger.put(newLedgerEntry);
            if (newCashMovement) await dbLocal.cash_movements.put(newCashMovement);
        });

        // 6. 🔥 RESTAR STOCK ATÓMICO EN LA NUBE 🔥
        if (navigator.onLine && user?.companyId) {
            Object.keys(returnMap).forEach(itemId => {
                const qty = returnMap[itemId];
                if (qty > 0) {
                    const stockRef = doc(db, `companies/${user.companyId}/branches/${branchId}/inventory`, String(itemId));
                    setDoc(stockRef, {
                        stock: increment(-parseFloat(qty)), 
                        updatedAt: serverTimestamp()
                    }, { merge: true }).catch(e => console.error("Atomic decrement error", e));
                }
            });
        }

        // 7. SYNC OPTIMISTA
        triggerOptimisticSync('purchases', updatedPurchase);
        productsToUpdate.forEach(p => triggerOptimisticSync('products', p));
        movementsToCreate.forEach(m => triggerOptimisticSync('movements', m));
        if (updatedSupplier) triggerOptimisticSync('suppliers', updatedSupplier);
        if (newLedgerEntry) triggerOptimisticSync('supplier_ledger', newLedgerEntry);
        if (newCashMovement) triggerOptimisticSync('cash_movements', newCashMovement);

        return updatedPurchase;
    }
};