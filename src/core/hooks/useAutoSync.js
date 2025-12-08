import { useEffect, useState, useRef } from 'react';
import { syncService } from '../../modules/sync/services/syncService';

export const useAutoSync = (intervalMs = 30000) => { // Default: 30 segundos
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  
  // Usamos ref para controlar el estado de sincronización dentro del intervalo
  // sin causar re-renders innecesarios o dependencias circulares en el useEffect
  const syncingRef = useRef(false);

  useEffect(() => {
    // Función ejecutora
    const runSync = async () => {
      // 1. Chequeos de seguridad:
      // - Si no hay internet: abortar.
      // - Si ya se está sincronizando: abortar (evitar solapamiento).
      if (!navigator.onLine || syncingRef.current) return;
      
      syncingRef.current = true;
      setIsSyncing(true);

      try {
        // 🔥 CAMBIO CRÍTICO: Llamamos al orquestador que sube Ventas Y Productos
        const result = await syncService.syncUp();
        
        // Si hubo algún movimiento de datos, actualizamos la estampa de tiempo
        if (result.sales > 0 || result.products > 0) {
           setLastSync(new Date());
        }

      } catch (error) {
        console.error("Sync falló (silencioso)", error);
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