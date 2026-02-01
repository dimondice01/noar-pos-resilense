import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { collection, query, where, getDocs, orderBy, limit, doc, getDoc } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore';

// =================================================================
// 📚 PURCHASE HISTORY REPOSITORY (FINANCIAL AUDIT)
// =================================================================

export const purchaseHistoryRepository = {

    /**
     * Obtiene el historial de facturas filtrado por la sucursal activa.
     */
    async getAllByBranch(limitCount = 50) {
        const dbLocal = await getDB();
        const { activeBranchId } = useAuthStore.getState();

        if (!activeBranchId) return [];

        return await dbLocal.purchases
            .where('branchId').equals(activeBranchId)
            .reverse() 
            .limit(limitCount)
            .toArray();
    },

    /**
     * Obtiene el detalle completo de una factura
     */
    async getFullDetail(purchaseId) {
        const dbLocal = await getDB();
        const { user } = useAuthStore.getState();
        
        let header = await dbLocal.purchases.get(purchaseId);
        let items = await dbLocal.purchase_items
            .where('purchaseId')
            .equals(purchaseId)
            .toArray();

        if (!header && user?.companyId && navigator.onLine) {
            try {
                const docRef = doc(db, `companies/${user.companyId}/purchases`, purchaseId);
                const docSnap = await getDoc(docRef);
                
                if (docSnap.exists()) {
                    header = { ...docSnap.data(), id: docSnap.id, syncStatus: 'synced' };
                    await dbLocal.purchases.put(header);
                    if (header.items) items = header.items;
                }
            } catch (e) { console.error("Error recuperando detalle:", e); }
        }

        if (!header) return null;
        return { ...header, items: items || [] };
    },

    async getBySupplier(supplierId) {
        const dbLocal = await getDB();
        const { activeBranchId } = useAuthStore.getState();
        return await dbLocal.purchases
            .where('supplierId').equals(supplierId)
            .filter(p => p.branchId === activeBranchId)
            .reverse()
            .toArray();
    },

    // ==========================================
    // 📖 HISTORIAL PAGINADO
    // ==========================================
    async getHistoryPaged(page = 1, pageSize = 20, filters = {}) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();

        // Cloud Hydration
        const localCount = await dbLocal.purchases.count();
        if (localCount === 0 && navigator.onLine && user?.companyId) {
            try {
                let q = query(collection(db, `companies/${user.companyId}/purchases`), orderBy('date', 'desc'), limit(50));
                if (activeBranchId && activeBranchId !== 'ALL') q = query(q, where('branchId', '==', activeBranchId));
                
                const snap = await getDocs(q);
                const cloudData = snap.docs.map(d => ({ ...d.data(), id: d.id, syncStatus: 'synced' }));
                if (cloudData.length > 0) await dbLocal.purchases.bulkPut(cloudData);
            } catch (e) { console.error("Error cloud sync:", e); }
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

    // 🔥🔥 AQUÍ ESTABA EL FALTANTE: ESTADÍSTICAS PARA LA PÁGINA
    async getBranchStats() {
        const dbLocal = await getDB();
        const { activeBranchId } = useAuthStore.getState();
        
        const allPurchases = await dbLocal.purchases
            .filter(p => !activeBranchId || activeBranchId === 'ALL' || p.branchId === activeBranchId)
            .toArray();
        
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        let monthTotal = 0;
        let totalDebt = 0;

        allPurchases.forEach(p => {
            const pDate = new Date(p.date);
            // Sumar al mes actual
            if (pDate.getMonth() === currentMonth && pDate.getFullYear() === currentYear) {
                monthTotal += (parseFloat(p.total) || 0);
            }
            // Sumar deuda viva
            if (p.remainingBalance > 0) {
                totalDebt += parseFloat(p.remainingBalance);
            }
        });

        return {
            count: allPurchases.length,
            monthTotal,
            totalDebt
        };
    },

    async searchInvoices(queryText) {
        const dbLocal = await getDB();
        const { activeBranchId } = useAuthStore.getState();
        const term = queryText.toUpperCase();
        return await dbLocal.purchases
            .filter(p => {
                if (activeBranchId && activeBranchId !== 'ALL' && p.branchId !== activeBranchId) return false;
                return (p.invoiceNumber || '').toUpperCase().includes(term) || (p.supplierName || '').toUpperCase().includes(term);
            })
            .limit(10)
            .toArray();
    }
};