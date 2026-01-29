import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { 
    doc, 
    setDoc, 
    updateDoc, 
    increment, 
    serverTimestamp, 
    collection, 
    writeBatch 
} from 'firebase/firestore'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 

export const productRepository = {

    async getAll() {
        const dbLocal = await getDB();
        return await dbLocal.products.filter(p => !p.deleted).toArray();
    },

    async findByCode(code) {
        const dbLocal = await getDB();
        const product = await dbLocal.products.where('code').equals(code).first();
        if (product && product.deleted) return null;
        return product;
    },

    async search(query) {
        const dbLocal = await getDB();
        const term = query.toLowerCase().trim();
        if (!term) return [];
        return await dbLocal.products
            .filter(p => 
                !p.deleted && (
                    p.name.toLowerCase().includes(term) || 
                    (p.code && p.code.toString().toLowerCase().includes(term)) ||
                    (p.barcode && p.barcode.toString().toLowerCase().includes(term))
                )
            )
            .limit(50)
            .toArray();
    },

    async getHistory(productId) {
        const dbLocal = await getDB();
        return await dbLocal.movements
            .where('productId')
            .equals(productId)
            .reverse() 
            .sortBy('date');
    },

    async save(product) {
        const dbLocal = await getDB();
        const { user } = useAuthStore.getState();
        if (!user || !user.companyId) throw new Error("Sesión no válida para guardar.");

        const productId = product.id || crypto.randomUUID();
        const timestamp = new Date().toISOString();
        
        const productToSave = {
            ...product,
            id: productId,
            updatedAt: timestamp,
            syncStatus: 'pending', 
            deleted: false
        };

        const { stock, batches, user: _, ...cloudMasterData } = productToSave;

        await dbLocal.products.put(productToSave);

        if (navigator.onLine) {
            const masterRef = doc(db, `companies/${user.companyId}/products`, productId);
            setDoc(masterRef, {
                ...cloudMasterData,
                updatedAt: serverTimestamp() 
            }, { merge: true }).catch(err => {
                console.warn("⚠️ Falló subida a Cloud (Maestro):", err);
            });
        }
        return productToSave;
    },

    // 🔥 FIX: Aceptamos forcedBranchId para ser invocado desde SalesRepo
    async addStock(productId, quantity, expiryDate, userName = 'Sistema', forcedBranchId = null) {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();

        if (!user || !user.companyId) throw new Error("No hay sesión de empresa activa.");
        
        // 🔥 Prioridad: Forzado > Activo > Usuario > Error
        const targetBranchId = forcedBranchId || activeBranchId || user.branchId; 
        
        if (!targetBranchId) {
            throw new Error("⚠️ Debes seleccionar una Sucursal para mover stock.");
        }

        const qty = parseFloat(quantity);
        if (isNaN(qty) || qty === 0) return;

        // --- A. LÓGICA LOCAL (DEXIE) ---
        await dbLocal.transaction('rw', [dbLocal.products, dbLocal.movements], async () => {
            const product = await dbLocal.products.get(productId);
            
            if (product) {
                const currentStock = parseFloat(product.stock) || 0;
                const newStock = currentStock + qty;

                let batches = product.batches || [];
                if (qty > 0) { 
                    batches.push({
                        id: crypto.randomUUID(),
                        quantity: qty,
                        expiryDate: expiryDate || null, 
                        dateAdded: new Date().toISOString()
                    });
                }

                await dbLocal.products.update(productId, {
                    stock: newStock,
                    batches: batches,
                    syncStatus: 'pending_stock' 
                });
            }

            const movement = {
                id: `mov_${crypto.randomUUID()}`, 
                productId,
                type: qty > 0 ? 'STOCK_IN' : 'STOCK_OUT',
                description: qty > 0 ? 'Ingreso Manual' : 'Ajuste Manual',
                amount: Math.abs(qty),
                branchId: targetBranchId, 
                user: userName, 
                date: new Date().toISOString(),
                syncStatus: 'pending'
            };
            await dbLocal.movements.put(movement);
        });

        // --- B. LÓGICA CLOUD (ATÓMICA) ---
        if (navigator.onLine) {
            const inventoryRef = doc(db, `companies/${user.companyId}/branches/${targetBranchId}/inventory`, productId);
            const movementRef = doc(collection(db, `companies/${user.companyId}/branches/${targetBranchId}/movements`));

            const batch = writeBatch(db);

            batch.set(inventoryRef, {
                stock: increment(qty),
                productId: productId,
                updatedAt: serverTimestamp()
            }, { merge: true });

            batch.set(movementRef, {
                productId,
                type: qty > 0 ? 'STOCK_IN' : 'STOCK_OUT',
                amount: Math.abs(qty),
                user: userName,
                date: serverTimestamp()
            });

            batch.commit().catch(err => {
                console.error("🔴 Error crítico sincronizando stock a Nube:", err);
            });
        }
    },

    async getPendingSync() {
        const dbLocal = await getDB();
        return await dbLocal.products
            .where('syncStatus').anyOf('pending', 'pending_stock')
            .toArray();
    },

    async markAsSynced(ids) {
        const dbLocal = await getDB();
        await dbLocal.products.bulkUpdate(
            ids.map(id => ({ key: id, changes: { syncStatus: 'synced' } }))
        );
    },

    async delete(id) {
        const dbLocal = await getDB();
        const { user } = useAuthStore.getState();

        await dbLocal.products.update(id, { deleted: true });

        if (navigator.onLine && user?.companyId) {
            const docRef = doc(db, `companies/${user.companyId}/products`, id);
            updateDoc(docRef, { 
                deleted: true, 
                updatedAt: serverTimestamp() 
            }).catch(console.error);
        }
    },

    async saveAll(products) {
        const dbLocal = await getDB();
        const productsToSave = products.map(p => ({
            ...p,
            syncStatus: 'pending' 
        }));
        await dbLocal.products.bulkPut(productsToSave);
    }
};