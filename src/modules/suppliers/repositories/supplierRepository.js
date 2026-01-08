import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { cashRepository } from '../../cash/repositories/cashRepository';

// Helper Sync
const syncToCloud = async (collectionName, data) => {
    if (!navigator.onLine) return;
    const { user } = useAuthStore.getState();
    if (!user || !user.companyId) return;
    try {
        const path = `companies/${user.companyId}/${collectionName}`;
        await setDoc(doc(db, path, data.id), { ...data, syncedAt: new Date().toISOString() }, { merge: true });
    } catch (e) { console.warn("Sync error:", e); }
};

export const supplierRepository = {

    async getAllWithBalance() {
        const dbLocal = await getDB();
        const suppliers = await dbLocal.getAll('suppliers'); 
        const ledger = await dbLocal.getAll('supplier_ledger');
        return suppliers.map(sup => {
            const myMovements = ledger.filter(m => m.supplierId === sup.id);
            const balance = myMovements.reduce((acc, m) => {
                return acc + (m.type === 'PURCHASE' ? m.amount : -m.amount);
            }, 0);
            return { ...sup, balance };
        });
    },

    async registerPurchase({ supplierId, date, totalAmount, paidAmount, description, invoiceNumber }) {
        const dbLocal = await getDB();
        const purchaseId = `pur_${Date.now()}`;

        // 1. FACTURA (Deuda)
        const purchaseMovement = {
            id: purchaseId,
            supplierId,
            date: date || new Date().toISOString(),
            type: 'PURCHASE', 
            amount: parseFloat(totalAmount),
            description: description || `Compra Factura #${invoiceNumber || 'S/N'}`,
            invoiceNumber,
            syncStatus: 'PENDING'
        };
        await dbLocal.put('supplier_ledger', purchaseMovement);
        syncToCloud('supplier_ledger', purchaseMovement);

        // 2. PAGO INICIAL (Si hubo)
        if (parseFloat(paidAmount) > 0) {
            await this.registerPayment({
                supplierId,
                amount: paidAmount,
                method: 'cash', 
                description: `Pago Inicial Fac #${invoiceNumber || 'S/N'}`,
                refId: purchaseId // 🔥 Vinculamos pago a esta factura
            });
        }
        return true;
    },

    async registerPayment({ supplierId, amount, method, description, refId }) {
        const dbLocal = await getDB();
        
        const paymentMovement = {
            id: `pay_${Date.now()}_${Math.random().toString(36).substr(2,4)}`,
            supplierId,
            date: new Date().toISOString(),
            type: 'PAYMENT',
            amount: parseFloat(amount),
            description: description || 'Pago a cuenta',
            refId: refId || null, 
            method,
            syncStatus: 'PENDING'
        };

        await dbLocal.put('supplier_ledger', paymentMovement);
        syncToCloud('supplier_ledger', paymentMovement);

        try {
            await cashRepository.registerExpense(
                parseFloat(amount), 
                `${description} (Prov)`, 
                supplierId, 
                'Sistema'
            );
        } catch (e) {
            console.warn("Caja cerrada o error de caja:", e.message);
        }

        return paymentMovement;
    },

    // 🔥 MODIFICADO: Calculamos saldo restante por factura
    async getLedger(supplierId) {
        const dbLocal = await getDB();
        const all = await dbLocal.getAll('supplier_ledger');
        
        // Filtramos solo los de este proveedor
        const supplierMovements = all.filter(m => m.supplierId === supplierId);

        // Separmos Compras y Pagos
        const purchases = supplierMovements.filter(m => m.type === 'PURCHASE');
        const payments = supplierMovements.filter(m => m.type === 'PAYMENT');

        // Enriquecemos las compras con su saldo pendiente
        const enrichedPurchases = purchases.map(pur => {
            // Buscamos pagos que tengan como referencia ESTA compra
            const relatedPayments = payments.filter(p => p.refId === pur.id);
            const totalPaid = relatedPayments.reduce((sum, p) => sum + p.amount, 0);
            
            return {
                ...pur,
                paidAmount: totalPaid,
                remainingBalance: pur.amount - totalPaid
            };
        });

        // Combinamos de nuevo para mostrar cronológicamente
        // (Reemplazamos las compras originales por las enriquecidas)
        const finalLedger = supplierMovements.map(m => {
            if (m.type === 'PURCHASE') {
                return enrichedPurchases.find(p => p.id === m.id) || m;
            }
            return m;
        });

        return finalLedger.sort((a, b) => new Date(b.date) - new Date(a.date));
    }
};