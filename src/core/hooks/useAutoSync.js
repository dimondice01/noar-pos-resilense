import { useEffect, useState, useRef } from 'react';
import { onSnapshot, collection, query, where } from 'firebase/firestore';
import { db as firestoreDB } from '../../database/firebase'; // Firebase
import { getDB } from '../../database/db'; // Dexie
import { useAuthStore } from '../../modules/auth/store/useAuthStore';
import { syncService } from '../../modules/sync/services/syncService'; 

export const useAutoSync = (intervalMs = 30000) => {
    const [status, setStatus] = useState('idle'); // idle | syncing | error
    const [lastSync, setLastSync] = useState(null);
    
    // Referencias para cancelar escuchas al salir
    const unsubscribeProducts = useRef(null);
    const unsubscribeInventory = useRef(null);
    
    // Datos de sesión
    const { user, activeBranchId } = useAuthStore();
    const companyId = user?.companyId;
    const currentBranchId = activeBranchId || user?.branchId;

    // =================================================================
    // 1. 👂 LISTENER DE BAJADA (REAL-TIME DOWNLOAD)
    // =================================================================
    // Escucha cambios en la nube y actualiza Dexie al instante.
    useEffect(() => {
        if (!companyId) return;

        const startListeners = async () => {
            const dbLocal = await getDB();
            console.log("📡 Conectando antena a Firebase...");

            // A. ESCUCHAR PRODUCTOS MAESTROS (Globales)
            // Si el dueño cambia un precio en su casa, aquí lo recibimos.
            const productsQuery = query(collection(firestoreDB, `companies/${companyId}/products`));
            
            unsubscribeProducts.current = onSnapshot(productsQuery, async (snapshot) => {
                // Solo procesamos si hay cambios reales
                if (snapshot.docChanges().length === 0) return;

                await dbLocal.transaction('rw', dbLocal.products, async () => {
                    for (const change of snapshot.docChanges()) {
                        const data = change.doc.data();
                        const id = change.doc.id;

                        if (change.type === 'removed') {
                            await dbLocal.products.update(id, { deleted: true });
                        } else {
                            // Upsert: Si existe actualiza, si no crea.
                            // 🔥 IMPORTANTE: No pisamos el stock local aquí, solo datos maestros.
                            const existing = await dbLocal.products.get(id);
                            if (existing) {
                                await dbLocal.products.update(id, { ...data, syncStatus: 'synced' });
                            } else {
                                await dbLocal.products.put({ ...data, id, stock: 0, syncStatus: 'synced' });
                            }
                        }
                    }
                });
            });

            // B. ESCUCHAR INVENTARIO DE MI SUCURSAL (Local)
            // Si entra stock desde otra PC a mi sucursal, aquí lo recibimos.
            if (currentBranchId) {
                const inventoryQuery = query(collection(firestoreDB, `companies/${companyId}/branches/${currentBranchId}/inventory`));
                
                unsubscribeInventory.current = onSnapshot(inventoryQuery, async (snapshot) => {
                    if (snapshot.docChanges().length === 0) return;

                    await dbLocal.transaction('rw', [dbLocal.products, dbLocal.inventory], async () => {
                        for (const change of snapshot.docChanges()) {
                            const inv = change.doc.data();
                            const prodId = inv.productId || change.doc.id;

                            if (change.type !== 'removed') {
                                // 1. Guardar en tabla Inventory
                                await dbLocal.inventory.put({
                                    branchId: currentBranchId,
                                    productId: prodId,
                                    stock: inv.stock,
                                    updatedAt: inv.updatedAt
                                });

                                // 2. 🔥 MAGIA: Actualizar el campo 'stock' en Products para que la UI vuele
                                // Esto arregla el problema de las "Salchichas Fantasmas"
                                await dbLocal.products.update(prodId, { stock: inv.stock });
                            }
                        }
                    });
                });
            }
        };

        startListeners();

        // Limpieza al desmontar
        return () => {
            if (unsubscribeProducts.current) unsubscribeProducts.current();
            if (unsubscribeInventory.current) unsubscribeInventory.current();
        };

    }, [companyId, currentBranchId]);


    // =================================================================
    // 2. 🗣️ CRON DE SUBIDA (BACKGROUND UPLOAD)
    // =================================================================
    // Sube lo que hiciste offline o lo que quedó pendiente.
    useEffect(() => {
        if (!companyId) return;

        const runUploadProcess = async () => {
            if (!navigator.onLine) return; // Ahorramos batería/datos

            try {
                setStatus('syncing');
                // Llamamos a tu servicio existente que busca 'pending' y sube
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

        // Ejecutar al inicio y luego cada X segundos
        runUploadProcess();
        const intervalId = setInterval(runUploadProcess, intervalMs);

        // Listener para "Volvió Internet"
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