import { useEffect, useState } from 'react';
import { syncService } from '../../modules/sync/services/syncService';

export const useAutoSync = (intervalMs = 30000) => { // Cada 30 segundos
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  useEffect(() => {
    // Función ejecutora
    const runSync = async () => {
      // Si no hay internet, ni intentamos
      if (!navigator.onLine) return;
      
      setIsSyncing(true);
      try {
        const result = await syncService.syncPendingSales();
        if (result.synced > 0) {
           setLastSync(new Date());
        }
      } catch (error) {
        console.error("Sync falló (silencioso)", error);
      } finally {
        setIsSyncing(false);
      }
    };

    // 1. Correr al montar
    runSync();

    // 2. Correr cada X tiempo
    const intervalId = setInterval(runSync, intervalMs);

    // 3. Escuchar evento de "Volvió internet"
    const handleOnline = () => runSync();
    window.addEventListener('online', handleOnline);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
    };
  }, [intervalMs]);

  return { isSyncing, lastSync };
};