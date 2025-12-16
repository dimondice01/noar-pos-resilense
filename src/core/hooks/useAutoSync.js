import { useEffect, useState, useRef } from 'react';
import { syncService } from '../../modules/sync/services/syncService';

export const useAutoSync = (intervalMs = 30000) => { // Default: 30 segundos
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  
  // Usamos ref para "semáforo" (evitar que se solapen dos sincronizaciones)
  const syncingRef = useRef(false);

  useEffect(() => {
    // Función ejecutora
    const runSync = async () => {
      // 1. Chequeos de seguridad:
      // - Si no hay internet: abortar.
      // - Si ya se está sincronizando: abortar.
      if (!navigator.onLine || syncingRef.current) return;
      
      syncingRef.current = true;
      setIsSyncing(true);

      try {
        console.log("☁️ AutoSync: Buscando cambios pendientes...");

        // 🔥 CRÍTICO: Llamamos a 'syncAll' que orquesta Ventas + Productos
        // (Asegúrate de que en syncService.js la función se llame syncAll)
        const result = await syncService.syncAll();
        
        // Si hubo movimiento real (subida), actualizamos la fecha
        if (result.sales > 0 || result.products > 0) {
           console.log(`✅ Sincronización Exitosa: ${result.sales} ventas, ${result.products} productos.`);
           setLastSync(new Date());
        }

      } catch (error) {
        // Error silencioso para no interrumpir al cajero
        console.error("⚠️ Sync falló (silencioso):", error);
      } finally {
        setIsSyncing(false);
        syncingRef.current = false;
      }
    };

    // 1. Correr al montar (para subir pendientes apenas abre la app)
    runSync();

    // 2. Correr cada X tiempo (Heartbeat)
    const intervalId = setInterval(runSync, intervalMs);

    // 3. Escuchar evento de "Volvió internet" (Reacción inmediata)
    const handleOnline = () => {
        console.log("🌐 Conexión detectada: Forzando sincronización...");
        runSync();
    };
    
    window.addEventListener('online', handleOnline);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
    };
  }, [intervalMs]);

  return { isSyncing, lastSync };
};