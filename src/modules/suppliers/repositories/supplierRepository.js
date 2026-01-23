import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { cashRepository } from '../../cash/repositories/cashRepository';

// ==========================================
// ☁️ HELPER: SYNC OPTIMISTA
// ==========================================
const triggerOptimisticSync = async (collectionName, data) => {
    if (!navigator.onLine) return;
    const { user } = useAuthStore.getState();
    if (!user || !user.companyId) return;

    try {
        const path = `companies/${user.companyId}/${collectionName}`;
        // Fire & Forget (No await) para no bloquear UI
        setDoc(doc(db, path, data.id), { 
            ...data, 
            syncedAt: new Date().toISOString(),
            syncStatus: 'synced'
        }, { merge: true });
    } catch (e) { console.warn("Sync warning:", e); }
};

export const supplierRepository = {

    // ==========================================
    // 📊 OBTENER PROVEEDORES CON SALDO
    // ==========================================
    async getAllWithBalance() {
        const dbLocal = await getDB();
        
        // Obtenemos todos los proveedores
        const suppliers = await dbLocal.suppliers.toArray(); 
        
        // Obtenemos TODOS los movimientos (Ledger)
        // Nota: Si hay millones, esto se debería paginar, pero para <10k está bien.
        const ledger = await dbLocal.supplier_ledger.toArray();
        
        // Calculamos saldo en memoria (MapReduce)
        return suppliers.map(sup => {
            const myMovements = ledger.filter(m => m.supplierId === sup.id);
            const balance = myMovements.reduce((acc, m) => {
                return acc + (m.type === 'PURCHASE' ? m.amount : -m.amount);
            }, 0);
            return { ...sup, balance };
        });
    },

    // ==========================================
    // 🛒 REGISTRAR COMPRA (FACTURA)
    // ==========================================
    async registerPurchase({ supplierId, date, totalAmount, paidAmount, description, invoiceNumber }) {
        const dbLocal = await getDB();
        const purchaseId = `pur_${Date.now()}_${Math.random().toString(36).substr(2,4)}`;
        const timestamp = date || new Date().toISOString();

        // Objeto Movimiento (Deuda)
        const purchaseMovement = {
            id: purchaseId, // Dexie usará este string como key si está definido
            supplierId,
            date: timestamp,
            type: 'PURCHASE', 
            amount: parseFloat(totalAmount),
            description: description || `Compra Factura #${invoiceNumber || 'S/N'}`,
            invoiceNumber,
            syncStatus: 'pending'
        };

        let paymentMovement = null;

        // Transacción Atómica
        await dbLocal.transaction('rw', [dbLocal.supplier_ledger, dbLocal.cash_movements, dbLocal.shifts], async () => {
            
            // 1. Guardar Deuda
            await dbLocal.supplier_ledger.put(purchaseMovement);

            // 2. Registrar Pago Inicial (Si hubo)
            if (parseFloat(paidAmount) > 0) {
                const payId = `pay_${Date.now()}_${Math.random().toString(36).substr(2,4)}`;
                
                paymentMovement = {
                    id: payId,
                    supplierId,
                    date: timestamp,
                    type: 'PAYMENT',
                    amount: parseFloat(paidAmount),
                    description: `Pago Inicial Fac #${invoiceNumber || 'S/N'}`,
                    refId: purchaseId, // Vinculado a la factura
                    method: 'cash',
                    syncStatus: 'pending'
                };

                await dbLocal.supplier_ledger.put(paymentMovement);

                // 3. Impactar en Caja (Egreso)
                // Usamos cashRepository dentro de la lógica (pero ojo con la transacción anidada)
                // Para seguridad, lo hacemos manual aquí o confiamos en que cashRepository use la misma db instance
                try {
                     await cashRepository.registerExpense(
                        parseFloat(paidAmount), 
                        `${description} (Prov)`, 
                        supplierId, 
                        'Sistema'
                    );
                } catch (e) {
                    console.warn("No se pudo descontar de caja (quizás cerrada):", e);
                }
            }
        });

        // Sync Optimista
        triggerOptimisticSync('supplier_ledger', purchaseMovement);
        if (paymentMovement) triggerOptimisticSync('supplier_ledger', paymentMovement);

        return true;
    },

    // ==========================================
    // 💸 REGISTRAR PAGO A CUENTA
    // ==========================================
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
            syncStatus: 'pending'
        };

        await dbLocal.transaction('rw', [dbLocal.supplier_ledger, dbLocal.cash_movements, dbLocal.shifts], async () => {
            // 1. Guardar en Cta Cte Proveedor
            await dbLocal.supplier_ledger.put(paymentMovement);
            
            // 2. Descontar de Caja
            try {
                await cashRepository.registerExpense(
                    parseFloat(amount), 
                    `${description} (Prov)`, 
                    supplierId, 
                    'Sistema'
                );
            } catch (e) {
                console.warn("Advertencia de Caja:", e.message);
            }
        });

        triggerOptimisticSync('supplier_ledger', paymentMovement);

        return paymentMovement;
    },

    // ==========================================
    // 📜 OBTENER HISTORIAL (CTA CTE)
    // ==========================================
    async getLedger(supplierId) {
        const dbLocal = await getDB();
        
        // Usamos índice para filtrar rápido
        const supplierMovements = await dbLocal.supplier_ledger
            .where('supplierId')
            .equals(supplierId)
            .toArray();

        // Separamos en memoria
        const purchases = supplierMovements.filter(m => m.type === 'PURCHASE');
        const payments = supplierMovements.filter(m => m.type === 'PAYMENT');

        // Enriquecemos compras con saldo pendiente
        const enrichedPurchases = purchases.map(pur => {
            // Pagos vinculados específicamente a esta factura
            const relatedPayments = payments.filter(p => p.refId === pur.id);
            const totalPaid = relatedPayments.reduce((sum, p) => sum + p.amount, 0);
            
            return {
                ...pur,
                paidAmount: totalPaid,
                remainingBalance: pur.amount - totalPaid
            };
        });

        // Reconstruimos el array final cronológico
        const finalLedger = supplierMovements.map(m => {
            if (m.type === 'PURCHASE') {
                return enrichedPurchases.find(p => p.id === m.id) || m;
            }
            return m;
        });

        return finalLedger.sort((a, b) => new Date(b.date) - new Date(a.date));
    },

    // Sync helpers
    async getPendingSync() {
        const dbLocal = await getDB();
        return await dbLocal.supplier_ledger.where('syncStatus').equals('pending').toArray();
    },

    async markAsSynced(ids) {
        const dbLocal = await getDB();
        await dbLocal.supplier_ledger.bulkUpdate(
            ids.map(id => ({ key: id, changes: { syncStatus: 'synced' } }))
        );
    }
};