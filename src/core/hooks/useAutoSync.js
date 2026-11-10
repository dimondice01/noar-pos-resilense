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

    // 2. (ELIMINADO) Listener de inventario duplicado.
    // 🐛 PERF: escuchaba la colección COMPLETA de inventario (3er listener en paralelo
    // con MainLayout y syncService), escribía fila por fila en una transacción rw sobre
    // products+inventory (bloqueaba las ventas del POS) y guardaba updatedAt como
    // Timestamp crudo (rompía el delta de syncInitialInventory). El stock vivo lo
    // mantiene syncService.startInventoryListener; el POS lee stock desde `inventory`.


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