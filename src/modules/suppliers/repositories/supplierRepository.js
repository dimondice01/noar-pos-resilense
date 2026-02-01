import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore'; 

// ==========================================
// ☁️ HELPER: SYNC
// ==========================================
const triggerOptimisticSync = async (collectionName, data) => {
    if (!navigator.onLine) return; 
    const { user } = useAuthStore.getState();
    if (!user?.companyId) return;

    try {
        const { syncStatus, ...cloudData } = data;
        const path = `companies/${user.companyId}/${collectionName}`;
        
        // Si es update solo mandamos lo que cambió
        setDoc(doc(db, path, data.id), {
            ...cloudData,
            firestoreId: data.id,
            syncedAt: new Date().toISOString(),
            syncStatus: 'synced'
        }, { merge: true }).then(async () => {
            try {
                const dbLocal = await getDB();
                const table = dbLocal.table(collectionName);
                if (table) await table.update(data.id, { syncStatus: 'synced' });
            } catch (e) { }
        });
    } catch (e) { console.warn(`Sync error ${collectionName}`, e); }
};

export const supplierRepository = {

    // ==========================================
    // 🧠 LÓGICA DE COSTOS (La "Magia" Fiscal)
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
    // 🚚 REGISTRO DE COMPRA (INGRESO MERCADERÍA)
    // ==========================================
    async registerPurchase(purchaseHeader, items) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();
        
        if (!user) throw new Error("Sin sesión.");
        const branchId = activeBranchId || 'main';

        const purchaseId = `pur_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
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
            syncStatus: 'pending',
            
            // 🔥 CAMPOS FINANCIEROS CLAVE
            amountPaid: 0,
            remainingBalance: 0,
            paymentStatus: 'UNPAID' // UNPAID, PARTIAL, PAID
        };

        const productsToUpdate = [];
        const inventoryToUpdate = [];
        const movementsToCreate = [];
        const newProductsToCreate = [];

        // 2. Procesar Ítems
        for (const item of items) {
            const financials = this._calculateLineItem(item.cost, item.price, item.tax, item.isTaxIncluded);
            
            purchase.totalNet += (financials.netCost * item.qty);
            purchase.totalTax += (financials.taxAmount * item.qty);
            purchase.totalFinal += (financials.finalCost * item.qty);

            let productId = item.id;
            let product = null;

            if (productId) {
                product = await dbLocal.products.get(productId);
            } else {
                product = await dbLocal.products.where('code').equals(item.code).first();
            }

            if (!product) {
                productId = crypto.randomUUID();
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
                price: financials.price > 0 ? financials.price : product.price,
                lastPurchaseDate: timestamp,
                supplierId: purchaseHeader.supplierId,
                updatedAt: timestamp,
                syncStatus: 'pending'
            };
            
            const newBatch = {
                id: `batch_${Date.now()}_${Math.random().toString(36).substr(2,3)}`,
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
                id: `mov_${crypto.randomUUID()}`,
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

        // 🔥 AJUSTE DE SALDOS INICIALES
        const initialPay = parseFloat(purchaseHeader.initialPayment || 0);
        purchase.amountPaid = initialPay;
        purchase.remainingBalance = Math.max(0, purchase.totalFinal - initialPay);
        
        if (purchase.remainingBalance <= 0.01) purchase.paymentStatus = 'PAID';
        else if (initialPay > 0) purchase.paymentStatus = 'PARTIAL';
        else purchase.paymentStatus = 'UNPAID';


        // 3. Transacción ACID Gigante
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
            
            // A. Guardar Compra
            await dbLocal.purchases.put(purchase);

            // B. Actualizar Productos e Inventario
            if (newProductsToCreate.length) await dbLocal.products.bulkPut(newProductsToCreate);
            await dbLocal.products.bulkPut(productsToUpdate);
            await dbLocal.inventory.bulkPut(inventoryToUpdate);
            await dbLocal.movements.bulkPut(movementsToCreate);

            // C. Manejo Financiero (Caja vs Cta Cte)
            // Si hay deuda remanente, actualizamos saldo del proveedor
            if (purchase.remainingBalance > 0) {
                const supplier = await dbLocal.suppliers.get(purchaseHeader.supplierId);
                if (supplier) {
                    const currentBalance = parseFloat(supplier.balance || 0);
                    const newBalance = currentBalance + purchase.remainingBalance; // Deuda aumenta

                    await dbLocal.suppliers.update(supplier.id, { 
                        balance: newBalance, 
                        syncStatus: 'pending' 
                    });

                    // Ledger: Registro de la deuda total generada
                    await dbLocal.supplier_ledger.put({
                        id: `sledger_${crypto.randomUUID()}`,
                        supplierId: supplier.id,
                        date: timestamp,
                        type: 'PURCHASE', // Generación de deuda
                        amount: purchase.remainingBalance,
                        description: `Fac ${purchaseHeader.invoiceNumber} (Saldo)`,
                        balance: newBalance,
                        refId: purchaseId,
                        syncStatus: 'pending'
                    });
                }
            }

            // D. 🔥 Si hubo pago inicial, registrar SALIDA DE CAJA COMO 'PURCHASE'
            // Esto es vital para que useCloudDashboard lo sume a "Compras Proveedores"
            if (initialPay > 0 && purchaseHeader.paymentMethod !== 'debt') {
                const activeShift = await dbLocal.shifts
                    .where('status').equals('OPEN')
                    .filter(s => s.userId === user.uid && s.branchId === branchId)
                    .first();
                
                if (activeShift) {
                    const movementData = {
                        id: `cm_${crypto.randomUUID()}`,
                        shiftId: activeShift.id,
                        type: 'PURCHASE', // 🔥 FIX CRÍTICO: Antes era 'EXPENSE'
                        method: purchaseHeader.paymentMethod || 'cash',
                        amount: initialPay,
                        description: `Pago Prov. ${purchaseHeader.supplierName} (Fac ${purchaseHeader.invoiceNumber})`,
                        date: timestamp,
                        branchId: branchId,
                        userId: user.uid,
                        companyId: user.companyId,
                        supplierName: purchaseHeader.supplierName, // Extra para ranking
                        referenceId: purchaseId,
                        syncStatus: 'pending'
                    };
                    
                    await dbLocal.cash_movements.put(movementData);
                    triggerOptimisticSync('cash_movements', movementData);
                }
            }
        });

        // 4. Sync Background
        triggerOptimisticSync('purchases', purchase);
        productsToUpdate.forEach(p => triggerOptimisticSync('products', p));

        return purchase;
    },

    // ==========================================
    // 💰 REGISTRO DE PAGOS POSTERIORES
    // ==========================================
    async registerPayment(paymentData) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();
        const timestamp = new Date().toISOString();
        const branchId = activeBranchId || 'main';

        const { supplierId, amount, method, description, refId } = paymentData;

        await dbLocal.transaction('rw', [
            dbLocal.purchases, 
            dbLocal.suppliers, 
            dbLocal.supplier_ledger, 
            dbLocal.cash_movements,
            dbLocal.shifts
        ], async () => {

            // 1. Si es pago de una factura específica, actualizarla
            if (refId) {
                const purchase = await dbLocal.purchases.get(refId);
                if (purchase) {
                    const newPaid = (purchase.amountPaid || 0) + amount;
                    const newRemaining = Math.max(0, (purchase.remainingBalance || 0) - amount);
                    const newStatus = newRemaining <= 0.01 ? 'PAID' : 'PARTIAL';

                    await dbLocal.purchases.update(refId, {
                        amountPaid: newPaid,
                        remainingBalance: newRemaining,
                        paymentStatus: newStatus,
                        syncStatus: 'pending'
                    });
                    
                    // Trigger sync manual para la compra actualizada
                    triggerOptimisticSync('purchases', { ...purchase, amountPaid: newPaid, remainingBalance: newRemaining, paymentStatus: newStatus });
                }
            }

            // 2. Actualizar Saldo Global del Proveedor (Baja la deuda)
            const supplier = await dbLocal.suppliers.get(supplierId);
            let supplierName = '';
            
            if (supplier) {
                supplierName = supplier.name;
                const currentBalance = parseFloat(supplier.balance || 0);
                const newBalance = Math.max(0, currentBalance - amount);

                await dbLocal.suppliers.update(supplierId, {
                    balance: newBalance,
                    syncStatus: 'pending'
                });

                // 3. Registro en Ledger (Haber)
                await dbLocal.supplier_ledger.put({
                    id: `sledger_${crypto.randomUUID()}`,
                    supplierId: supplierId,
                    date: timestamp,
                    type: 'PAYMENT', // Pago de deuda
                    amount: amount,
                    description: description || 'Pago a cuenta',
                    balance: newBalance,
                    refId: refId || null,
                    syncStatus: 'pending'
                });
            }

            // 4. Salida de Caja (Egreso Real)
            if (method !== 'debt') {
                const activeShift = await dbLocal.shifts
                    .where('status').equals('OPEN')
                    .filter(s => s.userId === user.uid && s.branchId === branchId)
                    .first();

                if (activeShift) {
                    const movementData = {
                        id: `cm_${crypto.randomUUID()}`,
                        shiftId: activeShift.id,
                        type: 'PURCHASE', // 🔥 FIX CRÍTICO: Tipo correcto para BI
                        method: method,
                        amount: amount,
                        description: `Pago Prov. ${supplierName} - ${description}`,
                        date: timestamp,
                        branchId: branchId,
                        userId: user.uid,
                        companyId: user.companyId,
                        supplierName: supplierName, // Para ranking
                        referenceId: refId || null,
                        syncStatus: 'pending'
                    };

                    await dbLocal.cash_movements.put(movementData);
                    triggerOptimisticSync('cash_movements', movementData);
                }
            }
        });
    },

    // ==========================================
    // 📖 LECTURA BÁSICA
    // ==========================================
    async getAll() {
        const dbLocal = await getDB();
        return await dbLocal.suppliers.toArray();
    },

    async save(supplier) {
        const dbLocal = await getDB();
        const data = {
            ...supplier,
            id: supplier.id || crypto.randomUUID(),
            syncStatus: 'pending'
        };
        await dbLocal.suppliers.put(data);
        triggerOptimisticSync('suppliers', data);
        return data;
    }
};