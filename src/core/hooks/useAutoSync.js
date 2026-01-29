import { useEffect, useState, useRef } from 'react';
import { onSnapshot, collection, query, where } from 'firebase/firestore';
import { db as firestoreDB } from '../../database/firebase'; // Firebase
import { getDB } from '../../database/db'; // Dexie
import { useAuthStore } from '../../modules/auth/store/useAuthStore';
import { syncService } from '../../modules/sync/services/syncService'; 

export const useAutoSync = (intervalMs = 30000) => {
    const [status, setStatus] = useState('idle'); // idle | syncing | error
    const [lastSync, setLastSync] = useState(null);
    
    // Datos de sesión
    const { user, activeBranchId } = useAuthStore();
    const companyId = user?.companyId;
    const currentBranchId = activeBranchId || user?.branchId;

    // =================================================================
    // 1. 👂 INICIALIZAR LISTENERS PROTEGIDOS
    // =================================================================
    useEffect(() => {
        if (!companyId) return;

        // 🔥 Iniciamos los listeners "Blindados" del servicio
        syncService.startRealTimeListeners(companyId);

        // Limpieza al desmontar
        return () => {
            syncService.stopListeners();
        };
    }, [companyId]);

    // =================================================================
    // 2. 👂 LISTENER DE INVENTARIO LOCAL (Específico para UI)
    // =================================================================
    // Mantenemos este listener manual aquí porque actualiza el campo 'stock'
    // denormalizado en la tabla de productos para velocidad de UI.
    const unsubscribeInventory = useRef(null);

    useEffect(() => {
        if (!companyId || !currentBranchId) return;

        const startInventoryListener = async () => {
            const dbLocal = await getDB();
            
            const inventoryQuery = query(collection(firestoreDB, `companies/${companyId}/branches/${currentBranchId}/inventory`));
            
            unsubscribeInventory.current = onSnapshot(inventoryQuery, async (snapshot) => {
                if (snapshot.docChanges().length === 0) return;

                await dbLocal.transaction('rw', [dbLocal.products, dbLocal.inventory], async () => {
                    for (const change of snapshot.docChanges()) {
                        const inv = change.doc.data();
                        const prodId = inv.productId || change.doc.id;

                        if (change.type !== 'removed') {
                            // 1. Guardar en tabla Inventory (Realidad Física)
                            await dbLocal.inventory.put({
                                branchId: currentBranchId,
                                productId: prodId,
                                stock: inv.stock,
                                updatedAt: inv.updatedAt
                            });

                            // 2. Actualizar campo 'stock' visual en Productos
                            await dbLocal.products.update(prodId, { stock: inv.stock });
                        }
                    }
                });
            });
        };

        startInventoryListener();

        return () => {
            if (unsubscribeInventory.current) unsubscribeInventory.current();
        };
    }, [companyId, currentBranchId]);


    // =================================================================
    // 3. 🗣️ CRON DE SUBIDA (BACKGROUND UPLOAD)
    // =================================================================
    useEffect(() => {
        if (!companyId) return;

        const runUploadProcess = async () => {
            if (!navigator.onLine) return; 

            try {
                setStatus('syncing');
                const result = await syncService.syncPending(); 
                
                if (result && (result.uploaded > 0)) {
                    console.log(`☁️ AutoSync: Se subieron ${result.uploaded} cambios.`);
                    setLastSync(new Date());
                }
                setStatus('idle');
            } catch (e) {
                console.error("AutoSync Upload Error:", e);
                setStatus('error');
            }
        };

        runUploadProcess();
        const intervalId = setInterval(runUploadProcess, intervalMs);

        const handleOnline = () => {
            console.log("🌐 Red detectada. Forzando subida...");
            runUploadProcess();
        };
        window.addEventListener('online', handleOnline);

        return () => {
            clearInterval(intervalId);
            window.removeEventListener('online', handleOnline);
        };

    }, [intervalMs, companyId]);

    return { status, lastSync };
};