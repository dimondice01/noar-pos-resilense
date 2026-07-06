import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import {
    doc,
    setDoc,
    deleteDoc,
    updateDoc,
    collection,
    getDocs,
    query,
    serverTimestamp,
    orderBy,
    where,
    limit,
    Timestamp
} from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore'; 

// =================================================================
// 🧠 MASTER REPOSITORY (RETAIL PRO EDITION)
// =================================================================

export const masterRepository = {

    _getCollectionPath(storeName) {
        const { user } = useAuthStore.getState();
        if (!user?.companyId) return null;
        return `companies/${user.companyId}/${storeName}`;
    },

    // ==========================================
    // 📖 LECTURA CON DELTA-SYNC (Solo cambios)
    // ==========================================
    async getAll(storeName) {
        const dbLocal = await getDB();
        
        // 1. Retorno inmediato desde IndexedDB (excluyendo soft-deletes)
        let items = (await dbLocal.table(storeName).toArray()).filter(i => !i.deleted);

        // 2. Disparar Sincronización Incremental en segundo plano
        if (navigator.onLine) {
            this._syncIncremental(storeName).catch(console.error);
        }
        
        return items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    },

    // 🔥 EL MOTOR DE VELOCIDAD: Solo baja lo nuevo/editado
    async _syncIncremental(storeName) {
        const path = this._getCollectionPath(storeName);
        if (!path) return;

        const dbLocal = await getDB();
        
        // 1. Obtener la fecha del último elemento sincronizado
        const lastItem = await dbLocal.table(storeName).orderBy('updatedAt').last();
        const lastSyncDate = lastItem ? lastItem.updatedAt : "1970-01-01T00:00:00Z";

        // 2. Consultar solo cambios desde esa fecha
        const q = query(
            collection(db, path),
            where('updatedAt', '>', new Date(lastSyncDate)),
            orderBy('updatedAt', 'asc'),
            limit(500) // Evitamos ráfagas masivas
        );

        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            const updates = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    ...data,
                    // Convertimos Timestamp de Firebase a ISO string para IndexedDB
                    updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
                    syncStatus: 'synced'
                };
            });

            // Guardado masivo de novedades
            await dbLocal.table(storeName).bulkPut(updates);
            
            // Si la tabla es pequeña (marcas/cats), hacemos mirror para detectar borrados
            // Si es grande (productos), los borrados se manejan con un campo 'deleted: true' (Soft Delete)
            if (storeName !== 'products' && snapshot.size < 50) {
                this._detectRemoteDeletions(storeName, path);
            }
        }
    },

    async _detectRemoteDeletions(storeName, path) {
        const snapshot = await getDocs(collection(db, path));
        const cloudIds = new Set(snapshot.docs.map(d => d.id));
        const dbLocal = await getDB();
        
        const localItems = await dbLocal.table(storeName).toArray();
        const idsToDelete = localItems
            .filter(local => local.syncStatus === 'synced' && !cloudIds.has(local.id))
            .map(local => local.id);

        if (idsToDelete.length > 0) {
            await dbLocal.table(storeName).bulkDelete(idsToDelete);
        }
    },

    // ==========================================
    // 💾 GUARDADO ROBUSTO (Con esquema para Suppliers)
    // ==========================================
    async save(storeName, item) {
        const dbLocal = await getDB();
        const path = this._getCollectionPath(storeName);
        if (!path) throw new Error("No hay contexto de empresa.");

        // Esquema enriquecido para proveedores si es el caso
        if (storeName === 'suppliers') {
            item = {
                ...item,
                docNumber: item.docNumber || '', // CUIT/DNI (usado por SuppliersPage/SupplierDashboard)
                balance: item.balance || 0, // Cuenta corriente con proveedor
                paymentTerms: item.paymentTerms || 'Efectivo',
                contactName: item.contactName || '',
                phone: item.phone || '',
                email: item.email || ''
            };

            // Generar ID secuencial visible (solo si el proveedor es nuevo o nunca tuvo uno)
            if (!item.sequentialId) {
                try {
                    const lastSupplier = await dbLocal.table('suppliers').orderBy('sequentialId').reverse().first();
                    const lastNum = lastSupplier && lastSupplier.sequentialId ? parseInt(lastSupplier.sequentialId, 10) : 0;
                    item.sequentialId = String(lastNum + 1).padStart(3, '0');
                } catch (e) {
                    const count = await dbLocal.table('suppliers').count();
                    item.sequentialId = String(count + 1).padStart(3, '0');
                }
            }
        }

        let finalId = item.id;
        if (!finalId) {
            const prefix = storeName.slice(0, 3);
            finalId = `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(-4)}`;
        }

        const newItem = {
            ...item,
            id: finalId,
            name: item.name.toUpperCase(),
            syncStatus: 'pending',
            updatedAt: new Date().toISOString()
        };

        // 1. Guardar local (UI instantánea)
        await dbLocal.table(storeName).put(newItem);

        // 2. Intentar subida a Cloud
        if (navigator.onLine) {
            const { syncStatus, ...cloudData } = newItem;
            try {
                await setDoc(doc(db, path, finalId), {
                    ...cloudData,
                    updatedAt: serverTimestamp() 
                }, { merge: true });
                
                await dbLocal.table(storeName).update(finalId, { syncStatus: 'synced' });
            } catch (e) {
                console.error("Sync diferido:", e);
            }
        }

        return newItem;
    },

    async delete(storeName, id) {
        const dbLocal = await getDB();
        const path = this._getCollectionPath(storeName);
        
        // Aplicamos SOFT DELETE para no romper la integridad de datos
        // (Especialmente importante en proveedores y productos)
        await dbLocal.table(storeName).update(id, { deleted: true, syncStatus: 'pending' });

        if (navigator.onLine && path) {
            try {
                await updateDoc(doc(db, path, id), { 
                    deleted: true, 
                    updatedAt: serverTimestamp() 
                });
                await dbLocal.table(storeName).delete(id); // Limpiar local si ya subió
            } catch (e) {
                console.error("Fallo borrado nube:", e);
            }
        }
    }
};