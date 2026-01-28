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

// ===========================================================================
// 🧠 PRODUCT REPOSITORY (ENTERPRISE EDITION v2.1)
// ===========================================================================

export const productRepository = {

    // ==========================================
    // 📖 LECTURA (Local - Ultra Rápida)
    // ==========================================

    async getAll() {
        const dbLocal = await getDB();
        return await dbLocal.products
            .filter(p => !p.deleted)
            .toArray();
    },

    async findByCode(code) {
        const dbLocal = await getDB();
        const product = await dbLocal.products.where('code').equals(code).first();
        if (product && product.deleted) return null;
        return product;
    },

    // 🔥 FIX: FALTABA ESTE MÉTODO CRÍTICO PARA EL POS
    async search(query) {
        const dbLocal = await getDB();
        const term = query.toLowerCase().trim();

        if (!term) return [];

        // Búsqueda optimizada en memoria local (Dexie)
        // Busca coincidencias en Nombre O Código O Código de Barras
        return await dbLocal.products
            .filter(p => 
                !p.deleted && (
                    p.name.toLowerCase().includes(term) || 
                    (p.code && p.code.toString().toLowerCase().includes(term)) ||
                    (p.barcode && p.barcode.toString().toLowerCase().includes(term))
                )
            )
            .limit(50) // Limitamos a 50 resultados para no saturar la UI
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

    // ==========================================
    // 💾 GUARDADO DE MAESTROS (Global)
    // ==========================================
    async save(product) {
        const dbLocal = await getDB();
        const { user } = useAuthStore.getState();

        if (!user || !user.companyId) throw new Error("Sesión no válida para guardar.");

        // 1. Preparar Datos
        const productId = product.id || crypto.randomUUID();
        const timestamp = new Date().toISOString();
        
        const productToSave = {
            ...product,
            id: productId,
            updatedAt: timestamp,
            syncStatus: 'pending', 
            deleted: false
        };

        // Limpieza para Nube (Separación de Concerns)
        const { stock, batches, user: _, ...cloudMasterData } = productToSave;

        // 2. Guardado Local (Dexie)
        await dbLocal.products.put(productToSave);

        // 3. Sincronización Cloud (Fondo)
        if (navigator.onLine) {
            const masterRef = doc(db, `companies/${user.companyId}/products`, productId);
            setDoc(masterRef, {
                ...cloudMasterData,
                updatedAt: serverTimestamp() 
            }, { merge: true }).catch(err => {
                console.warn("⚠️ Falló subida a Cloud (Maestro), se reintentará por SyncService:", err);
            });
        }

        return productToSave;
    },

    // ==========================================
    // ⚡ GESTIÓN DE STOCK (Transactional / Branch Aware)
    // ==========================================
    async addStock(productId, quantity, expiryDate, userName = 'Sistema') {
        const dbLocal = await getDB();
        const { user, activeBranchId } = useAuthStore.getState();

        if (!user || !user.companyId) throw new Error("No hay sesión de empresa activa.");
        
        const targetBranchId = activeBranchId || user.branchId; 
        
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

    // ==========================================
    // ☁️ HELPERS PARA SYNC SERVICE
    // ==========================================

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

    // ==========================================
    // 🗑️ SOFT DELETE (Global)
    // ==========================================
    async delete(id) {
        const dbLocal = await getDB();
        const { user } = useAuthStore.getState();

        // Local
        await dbLocal.products.update(id, { deleted: true });

        // Cloud
        if (navigator.onLine && user?.companyId) {
            const docRef = doc(db, `companies/${user.companyId}/products`, id);
            updateDoc(docRef, { 
                deleted: true, 
                updatedAt: serverTimestamp() 
            }).catch(console.error);
        }
    },

    // ==========================================
    // ✍️ IMPORTACIÓN MASIVA
    // ==========================================
    async saveAll(products) {
        const dbLocal = await getDB();
        const productsToSave = products.map(p => ({
            ...p,
            syncStatus: 'pending' 
        }));
        await dbLocal.products.bulkPut(productsToSave);
    }
};