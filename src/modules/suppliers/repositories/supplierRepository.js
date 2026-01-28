import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
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
    // Calcula el costo neto real y el IVA basándose en la factura
    _calculateLineItem(inputCost, inputPrice, taxRate, isTaxIncluded) {
        let netCost = 0;
        let finalCostWithTax = 0;
        let taxAmount = 0;
        const rate = parseFloat(taxRate) || 0;
        const cost = parseFloat(inputCost) || 0;

        if (isTaxIncluded) {
            // Ejemplo: Costo $121, IVA 21% -> Neto $100
            finalCostWithTax = cost;
            netCost = cost / (1 + (rate / 100));
            taxAmount = finalCostWithTax - netCost;
        } else {
            // Ejemplo: Costo $100, IVA 21% -> Final $121
            netCost = cost;
            taxAmount = cost * (rate / 100);
            finalCostWithTax = cost + taxAmount;
        }

        // Margen de ganancia (Markup)
        // Precio Venta = CostoFinal * (1 + Margen)
        let markup = 0;
        const price = parseFloat(inputPrice) || 0;
        if (price > 0 && finalCostWithTax > 0) {
            markup = ((price - finalCostWithTax) / finalCostWithTax) * 100;
        }

        return {
            netCost,      // Costo sin IVA (Base imponible)
            taxAmount,    // Monto IVA
            finalCost: finalCostWithTax, // Costo real puesto en góndola
            price: price, // Precio venta público
            markup: markup // Porcentaje de ganancia
        };
    },

    // ==========================================
    // 🚚 REGISTRO DE COMPRA (INGRESO MERCADERÍA)
    // ==========================================
    // Esta es la función "Walmart". Maneja Stock, Costos, Deuda y Caja.
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
            // Totales calculados
            totalNet: 0,
            totalTax: 0,
            totalFinal: 0,
            syncStatus: 'pending'
        };

        const productsToUpdate = [];
        const inventoryToUpdate = [];
        const movementsToCreate = [];
        const newProductsToCreate = [];

        // 2. Procesar Ítems (El corazón de la lógica)
        for (const item of items) {
            // item: { id (opcional si es nuevo), code, name, cost, price, qty, tax, isTaxIncluded }
            
            // A. Cálculo Fiscal
            const financials = this._calculateLineItem(item.cost, item.price, item.tax, item.isTaxIncluded);
            
            purchase.totalNet += (financials.netCost * item.qty);
            purchase.totalTax += (financials.taxAmount * item.qty);
            purchase.totalFinal += (financials.finalCost * item.qty);

            // B. Obtener o Crear Producto
            let productId = item.id;
            let product = null;

            if (productId) {
                product = await dbLocal.products.get(productId);
            } else {
                // ALTA RÁPIDA: Si no tiene ID, lo buscamos por código o creamos
                product = await dbLocal.products.where('code').equals(item.code).first();
            }

            if (!product) {
                // ✨ CREACIÓN AL VUELO
                productId = crypto.randomUUID();
                product = {
                    id: productId,
                    code: item.code,
                    name: item.name.toUpperCase(),
                    barcode: item.code,
                    categoryId: 'general', // Default, luego se edita
                    active: true,
                    isWeighable: false,
                    createdAt: timestamp
                };
                // Lo marcamos para crear
                newProductsToCreate.push({ ...product, syncStatus: 'pending' });
            }

            // C. Lógica de Costo Promedio (PPP) Enterprise
            // Si ya tenía stock, promediamos el costo. Si no, es el nuevo.
            const currentStock = parseFloat(product.stock || 0);
            const currentCost = parseFloat(product.cost || 0);
            const newQty = parseFloat(item.qty);
            
            let newWeightedCost = financials.finalCost; // Por defecto el nuevo

            if (currentStock > 0) {
                // Fórmula PPP: ((CostoActual * StockActual) + (CostoNuevo * CantidadNueva)) / (StockActual + CantidadNueva)
                const totalValueOld = currentCost * currentStock;
                const totalValueNew = financials.finalCost * newQty;
                newWeightedCost = (totalValueOld + totalValueNew) / (currentStock + newQty);
            }

            // D. Actualizar Producto (Maestro)
            // Actualizamos costo, y si el usuario puso precio de venta nuevo, también.
            const productUpdate = {
                ...product,
                cost: newWeightedCost, // Guardamos el promedio ponderado
                price: financials.price > 0 ? financials.price : product.price, // Actualizar precio venta si vino
                lastPurchaseDate: timestamp,
                supplierId: purchaseHeader.supplierId,
                updatedAt: timestamp,
                syncStatus: 'pending'
            };
            
            // Agregamos el Lote (Batch) al producto local para FIFO
            const newBatch = {
                id: `batch_${Date.now()}_${Math.random().toString(36).substr(2,3)}`,
                purchaseId: purchaseId,
                dateAdded: timestamp,
                quantity: newQty,
                originalCost: financials.finalCost, // Costo real de este lote (no el promedio)
                expiryDate: item.expiryDate || null
            };
            
            const currentBatches = product.batches || [];
            productUpdate.batches = [...currentBatches, newBatch];
            productUpdate.stock = currentStock + newQty; // Cache visual

            productsToUpdate.push(productUpdate);

            // E. Actualizar Inventario (Tabla Inventory)
            inventoryToUpdate.push({
                productId: productId,
                branchId: branchId,
                stock: currentStock + newQty,
                updatedAt: timestamp,
                syncStatus: 'pending_stock' // Flag especial para sync service
            });

            // F. Movimiento de Stock (Kardex)
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

        // 3. Transacción ACID Gigante
        // Se guarda todo o no se guarda nada.
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
            if (purchaseHeader.paymentMethod === 'checking_account') {
                // 1. Aumentar deuda con proveedor
                const supplier = await dbLocal.suppliers.get(purchaseHeader.supplierId);
                if (supplier) {
                    const newBalance = (parseFloat(supplier.balance) || 0) - purchase.totalFinal; // Deuda es negativa o positiva según criterio
                    // Usualmente Proveedores: Saldo Positivo = A Favor nuestro, Negativo = Deuda.
                    // O al revés. Definamos: Deuda es Positiva en Ledger de Proveedores.
                    
                    const currentDebt = parseFloat(supplier.balance || 0);
                    const newDebt = currentDebt + purchase.totalFinal;

                    await dbLocal.suppliers.update(supplier.id, { 
                        balance: newDebt, 
                        syncStatus: 'pending' 
                    });

                    // 2. Registro en Ledger Proveedor
                    await dbLocal.supplier_ledger.put({
                        id: `sledger_${crypto.randomUUID()}`,
                        supplierId: supplier.id,
                        date: timestamp,
                        type: 'PURCHASE',
                        amount: purchase.totalFinal,
                        description: `Compra Fac ${purchaseHeader.invoiceNumber}`,
                        balance: newDebt,
                        refId: purchaseId,
                        syncStatus: 'pending'
                    });
                }
            } else if (purchaseHeader.paymentMethod === 'cash') {
                // 1. Salida de Caja (Egreso)
                // Necesitamos el turno abierto
                const activeShift = await dbLocal.shifts
                    .where('status').equals('OPEN')
                    .filter(s => s.userId === user.uid && s.branchId === branchId)
                    .first();
                
                if (activeShift) {
                    await dbLocal.cash_movements.put({
                        id: `cm_${crypto.randomUUID()}`,
                        shiftId: activeShift.id,
                        type: 'EXPENSE', // Gasto/Egreso
                        method: 'cash',
                        amount: purchase.totalFinal,
                        description: `Pago a Prov. ${purchaseHeader.supplierName}`,
                        date: timestamp,
                        userId: user.uid,
                        companyId: user.companyId,
                        syncStatus: 'pending'
                    });
                }
            }
        });

        // 4. Sync Background
        triggerOptimisticSync('purchases', purchase);
        productsToUpdate.forEach(p => triggerOptimisticSync('products', p));
        // Nota: Los movimientos y ledger también deberían subirse aquí idealmente

        return purchase;
    },

    // ==========================================
    // 📖 LECTURA BÁSICA
    // ==========================================
    async getAll() {
        const dbLocal = await getDB();
        return await dbLocal.suppliers.toArray();
    },

    async getLedger(supplierId) {
        const dbLocal = await getDB();
        return await dbLocal.supplier_ledger
            .where('supplierId').equals(supplierId)
            .reverse()
            .sortBy('date');
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