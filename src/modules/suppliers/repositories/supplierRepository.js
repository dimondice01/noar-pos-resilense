import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
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
            // eslint-disable-next-line no-unused-vars
            const { syncStatus, localId, ...rest } = data;
            // 🔥 balance SOLO se muta vía supplierLedgerService (transacción con
            // increment()) — subir el número plano acá pisaría un incremento concurrente.
            const cloudData = collectionName === 'suppliers' ? (() => {
                // eslint-disable-next-line no-unused-vars
                const { balance, ...withoutBalance } = rest;
                return withoutBalance;
            })() : rest;
            await setDoc(doc(db, path, cloudId), {
                ...cloudData,
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
        console.warn(`Sync error ${collectionName}`, e); 
    }
};

export const supplierRepository = {
    // ==========================================
    // 📖 LECTURA
    // ==========================================
    async getAll() {
        const dbLocal = await getDB();
        const suppliers = await dbLocal.suppliers.toArray();
        // Ordenamos por secuencial
        return suppliers.sort((a, b) => {
            const idA = parseInt(a.sequentialId || 0, 10);
            const idB = parseInt(b.sequentialId || 0, 10);
            return idB - idA;
        });
    },

    async getById(id) {
        const dbLocal = await getDB();
        return await dbLocal.suppliers.get(id);
    },

    // 🔥 Obtener historial de Cuenta Corriente (Ledger)
    async getLedger(supplierId) {
        const dbLocal = await getDB();
        return await dbLocal.supplier_ledger
            .where('supplierId')
            .equals(supplierId)
            .reverse() // Del más nuevo al más viejo
            .toArray();
    },

    // ==========================================
    // 🔢 GENERADOR DE ID SECUENCIAL A PRUEBA DE BORRADOS
    // ==========================================
    async generateNextId() {
        const dbLocal = await getDB();
        try {
            // Buscamos el ID real más alto en la base
            const lastSupplier = await dbLocal.suppliers.orderBy('sequentialId').reverse().first();
            const lastId = lastSupplier && lastSupplier.sequentialId ? parseInt(lastSupplier.sequentialId, 10) : 0;
            return String(lastId + 1).padStart(3, '0');
        } catch (e) {
            // Fallback por si el índice no está listo
            const count = await dbLocal.suppliers.count();
            return String(count + 1).padStart(3, '0');
        }
    },

    // ==========================================
    // 💾 ESCRITURA (GUARDAR / EDITAR PROVEEDOR)
    // ==========================================
    async save(supplier) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();
        
        if (!user?.companyId) throw new Error("Sin sesión de empresa.");
        
        const isNew = !supplier.id;
        // 🔥 Usamos generateGlobalId en lugar de crypto.randomUUID()
        const id = supplier.id || generateGlobalId('sup');
        
        // Si es un proveedor nuevo, generamos su número secuencial
        const sequentialId = isNew ? await this.generateNextId() : supplier.sequentialId;

        const data = {
            ...supplier,
            id,
            sequentialId,
            companyId: user.companyId,
            // 🔥 Proveedores son company-wide (no se filtran por sucursal), así que esto
            // es solo trazabilidad de quién lo creó — null es más honesto que inventar 'main'.
            branchId: activeBranchId || null,
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
        // Pasamos el firestoreId original o el id local casteado a string para el borrado en nube
        triggerOptimisticSync('suppliers', { id, firestoreId: supplier.firestoreId || id }, true);
        return true;
    }
};