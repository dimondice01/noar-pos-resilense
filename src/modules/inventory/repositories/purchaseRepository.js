import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { 
    doc, updateDoc, getDoc, setDoc, deleteDoc, collection, 
    query, where, getDocs, limit, orderBy 
} from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore';

// ==========================================
// ☁️ HELPER: SYNC OPTIMISTA
// ==========================================
const triggerOptimisticSync = async (collectionName, data, isDelete = false) => {
    if (!navigator.onLine) return; 
    const { user } = useAuthStore.getState();
    if (!user?.companyId) return;

    try {
        const path = `companies/${user.companyId}/${collectionName}`;
        
        if (isDelete) {
            await deleteDoc(doc(db, path, data.id));
        } else {
            const { syncStatus, ...cloudData } = data;
            await setDoc(doc(db, path, data.id), {
                ...cloudData,
                firestoreId: data.id,
                syncedAt: new Date().toISOString(),
                syncStatus: 'synced'
            }, { merge: true });
        }

        const dbLocal = await getDB();
        const table = dbLocal.table(collectionName);
        if (table && !isDelete) await table.update(data.id, { syncStatus: 'synced' });
        
    } catch (e) { 
        console.warn(`❌ Sync error en ${collectionName}:`, e); 
    }
};

export const purchaseRepository = {

    // ==========================================
    // 📖 HISTORIAL Y LISTADO
    // ==========================================
    async getHistoryPaged(page = 1, pageSize = 20, filters = {}) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();
        
        // 🚑 CLOUD HYDRATION: Si la sucursal está vacía en local, bajamos de la nube
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

        // QUERY LOCAL
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
    // 📊 ESTADÍSTICAS (MEJORADAS - ÚLTIMOS 30 DÍAS)
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
            const pDate = new Date(p.date);
            const total = parseFloat(p.total) || 0;
            const remaining = parseFloat(p.remainingBalance) || 0;

            // 🔥 MEJORA: Sumamos compras de los últimos 30 días (No solo mes calendario)
            if (pDate >= thirtyDaysAgo) {
                monthTotal += total;
            }

            // Sumar deuda viva (sin importar fecha)
            if (remaining > 0.01) { // Tolerancia a decimales
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
    // 🔍 DETALLES
    // ==========================================
    async getPurchaseItems(purchaseId) {
        const dbLocal = await getDB();
        const purchase = await dbLocal.purchases.get(purchaseId);
        if (purchase && purchase.items) return purchase.items;
        return [];
    },

    // ==========================================
    // 💾 ESCRITURA: REGISTRO Y PAGOS
    // ==========================================
    async registerPurchase(purchaseData) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();
        const pId = purchaseData.id || `PUR-${Date.now()}`;
        
        const finalizedPurchase = {
            ...purchaseData,
            id: pId,
            branchId: purchaseData.branchId || activeBranchId,
            date: purchaseData.date || new Date().toISOString(),
            syncStatus: 'pending'
        };

        await dbLocal.purchases.put(finalizedPurchase);
        triggerOptimisticSync('purchases', finalizedPurchase);

        const amountPaidInitial = parseFloat(finalizedPurchase.amountPaid || 0);
        if (amountPaidInitial > 0) {
            const movementData = {
                id: `MOV-PUR-${pId}`,
                type: 'PURCHASE', // Clave para BI
                category: 'Pago a Proveedor',
                description: `Compra: ${finalizedPurchase.supplierName}`,
                amount: amountPaidInitial,
                date: finalizedPurchase.date,
                branchId: finalizedPurchase.branchId,
                operatorId: user?.uid,
                method: finalizedPurchase.paymentMethod || 'cash',
                referenceId: pId,
                syncStatus: 'pending'
            };
            await dbLocal.cash_movements.put(movementData);
            triggerOptimisticSync('cash_movements', movementData);
        }
        return true;
    },

    async registerPayment(paymentData) {
        const dbLocal = await getDB();
        const { user } = useAuthStore.getState();
        const purchase = await dbLocal.purchases.get(paymentData.refId);
        if (!purchase) throw new Error("Compra no encontrada");

        let amountPaidNow = parseFloat(paymentData.amountPaid || 0);
        let newPaidTotal = (parseFloat(purchase.amountPaid) || 0) + amountPaidNow; 
        let newRemaining = Math.max(0, (parseFloat(purchase.total) || 0) - newPaidTotal);

        const updates = {
            amountPaid: newPaidTotal,
            remainingBalance: newRemaining,
            paymentStatus: newRemaining <= 0.01 ? 'PAID' : 'PARTIAL',
            syncStatus: 'pending',
            lastPaymentDate: new Date().toISOString()
        };

        await dbLocal.purchases.update(purchase.id, updates);

        if (user?.companyId && navigator.onLine) {
            try {
                const purchaseRef = doc(db, `companies/${user.companyId}/purchases`, purchase.id);
                await updateDoc(purchaseRef, updates);
                await dbLocal.purchases.update(purchase.id, { syncStatus: 'synced' });
            } catch (e) {}
        }

        if (amountPaidNow > 0) {
            const movementData = {
                id: `MOV-PAY-${Date.now()}`,
                type: 'PURCHASE',
                category: 'Pago Deuda',
                description: `Abono: ${purchase.supplierName}`,
                amount: amountPaidNow,
                date: new Date().toISOString(),
                branchId: purchase.branchId,
                operatorId: user?.uid,
                method: 'cash',
                referenceId: purchase.id,
                syncStatus: 'pending'
            };
            await dbLocal.cash_movements.put(movementData);
            triggerOptimisticSync('cash_movements', movementData);
        }
        return true;
    },

    // ==========================================
    // 🗑️ ESCRITURA: ANULAR (FIXED SCHEMA ERROR)
    // ==========================================
    async voidPurchase(purchaseId) {
        const dbLocal = await getDB();
        const purchase = await dbLocal.purchases.get(purchaseId);
        if (!purchase) throw new Error("Compra no encontrada");

        await dbLocal.transaction('rw', [
            dbLocal.purchases, dbLocal.products, dbLocal.inventory, 
            dbLocal.suppliers, dbLocal.cash_movements
        ], async () => {

            // 1. Restaurar Stock
            if (purchase.items && Array.isArray(purchase.items)) {
                for (const item of purchase.items) {
                    const product = await dbLocal.products.get(item.id);
                    if (product) {
                        const newStock = Math.max(0, (product.stock || 0) - (item.qty || 0));
                        await dbLocal.products.update(item.id, { stock: newStock, syncStatus: 'pending' });
                        triggerOptimisticSync('products', { ...product, stock: newStock });
                    }
                }
            }

            // 2. Reversar Saldo Proveedor
            if (purchase.remainingBalance > 0) {
                const supplier = await dbLocal.suppliers.get(purchase.supplierId);
                if (supplier) {
                    const newBalance = Math.max(0, (supplier.balance || 0) - purchase.remainingBalance);
                    await dbLocal.suppliers.update(purchase.supplierId, { balance: newBalance, syncStatus: 'pending' });
                    triggerOptimisticSync('suppliers', { ...supplier, balance: newBalance });
                }
            }

            // 3. Eliminar movimientos de caja (Usando FILTER para evitar SchemaError)
            const relatedMovements = await dbLocal.cash_movements
                .filter(m => m.referenceId === purchaseId)
                .toArray();
            
            for (const mov of relatedMovements) {
                await dbLocal.cash_movements.delete(mov.id);
                triggerOptimisticSync('cash_movements', mov, true);
            }

            // 4. Eliminar compra
            await dbLocal.purchases.delete(purchaseId);
            triggerOptimisticSync('purchases', purchase, true);
        });

        return true;
    }
};