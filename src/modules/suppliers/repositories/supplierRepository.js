import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
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
    } catch (e) { console.warn(`Sync error ${collectionName}`, e); }
};

export const supplierRepository = {
    // ==========================================
    // 📖 LECTURA
    // ==========================================
    async getAll() {
        const dbLocal = await getDB();
        return await dbLocal.suppliers.toArray();
    },

    async getById(id) {
        const dbLocal = await getDB();
        return await dbLocal.suppliers.get(id);
    },

    // 🔥 NUEVO: Obtener historial de Cuenta Corriente (Ledger)
    async getLedger(supplierId) {
        const dbLocal = await getDB();
        return await dbLocal.supplier_ledger
            .where('supplierId')
            .equals(supplierId)
            .reverse() // Del más nuevo al más viejo
            .toArray();
    },

    // ==========================================
    // 🔢 GENERADOR DE ID SECUENCIAL (001, 002...)
    // ==========================================
    async generateNextId() {
        const dbLocal = await getDB();
        // Contamos cuántos proveedores existen y sumamos 1
        const count = await dbLocal.suppliers.count();
        // Formateamos para que siempre tenga 3 dígitos (Ej: "005")
        return String(count + 1).padStart(3, '0');
    },

    // ==========================================
    // 💾 ESCRITURA (GUARDAR / EDITAR PROVEEDOR)
    // ==========================================
    async save(supplier) {
        const dbLocal = await getDB();
        
        const isNew = !supplier.id;
        const id = supplier.id || crypto.randomUUID();
        
        // Si es un proveedor nuevo, generamos su número secuencial
        const sequentialId = isNew ? await this.generateNextId() : supplier.sequentialId;

        const data = {
            ...supplier,
            id,
            sequentialId,
            balance: parseFloat(supplier.balance || 0),
            syncStatus: 'pending',
            updatedAt: new Date().toISOString()
        };

        if (isNew) {
            data.createdAt = new Date().toISOString();
        }

        await dbLocal.suppliers.put(data);
        triggerOptimisticSync('suppliers', data);
        
        return data;
    },

    // ==========================================
    // 🗑️ ELIMINAR PROVEEDOR
    // ==========================================
    async delete(id) {
        const dbLocal = await getDB();
        const supplier = await dbLocal.suppliers.get(id);
        
        if (!supplier) return false;

        // Validar que no tenga deuda antes de eliminar
        if (parseFloat(supplier.balance) > 0) {
            throw new Error("No se puede eliminar un proveedor con saldo pendiente.");
        }

        await dbLocal.suppliers.delete(id);
        triggerOptimisticSync('suppliers', { id }, true);
        return true;
    }
};