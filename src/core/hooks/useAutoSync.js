import { useEffect, useState, useRef } from 'react';
// ⚠️ Verifica que esta ruta apunte a tu syncService corregido
import { syncService } from '../../modules/sync/services/syncService'; 
import { useAuthStore } from '../../modules/auth/store/useAuthStore';

export const useAutoSync = (intervalMs = 30000) => { // Default: 30 segundos
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  
  // Semáforo para evitar colisiones
  const syncingRef = useRef(false);

  // 👇 Obtenemos el usuario para saber si estamos listos
  const { user, isAuthenticated } = useAuthStore();

  useEffect(() => {
    // Si no está autenticado o no tiene empresa, NO arrancamos el cronómetro
    if (!isAuthenticated || !user?.companyId) return;

    const runSync = async () => {
      // 1. Chequeos de seguridad:
      if (!navigator.onLine || syncingRef.current) return;
      
      // Doble chequeo de usuario (por si se deslogueó durante el intervalo)
      const currentUser = useAuthStore.getState().user;
      if (!currentUser?.companyId) return;

      syncingRef.current = true;
      setIsSyncing(true);

      try {
        // No logueamos "Buscando cambios" cada 30s para no ensuciar la consola,
        // solo si realmente hay acción.
        // console.log("☁️ AutoSync: Heartbeat..."); 

        const result = await syncService.syncAll();
        
        // Solo actualizamos estado si hubo movimiento real
        if (result.sales > 0 || result.products > 0) {
           console.log(`✅ AutoSync: Subidos ${result.sales} ventas y ${result.products} productos.`);
           setLastSync(new Date());
        }

      } catch (error) {
        console.error("⚠️ AutoSync falló:", error);
      } finally {
        setIsSyncing(false);
        syncingRef.current = false;
      }
    };

    // 1. Correr al montar (o al loguearse)
    runSync();

    // 2. Correr cada X tiempo
    const intervalId = setInterval(runSync, intervalMs);

    // 3. Reacción a "Volvió internet"
    const handleOnline = () => {
        console.log("🌐 Conexión recuperada. Sincronizando...");
        runSync();
    };
    
    window.addEventListener('online', handleOnline);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
    };
  }, [intervalMs, isAuthenticated, user?.companyId]); // 👈 CLAVE: Se reinicia si cambia el usuario

  return { isSyncing, lastSync };
};