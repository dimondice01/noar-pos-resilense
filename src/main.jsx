import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/index.css'

// 🔌 PWA: Importamos el registro del Service Worker
// Esto es vital para que la app se pueda "Instalar" y cargue sin internet.
import { registerSW } from 'virtual:pwa-register'

// ⚙️ LÓGICA DE ACTUALIZACIÓN INTELIGENTE
// Solo activamos el Service Worker en PRODUCCIÓN (cuando hagas el deploy).
// En desarrollo (localhost) lo desactivamos para que veas tus cambios al instante sin caché.
if (import.meta.env.PROD) {
  const updateSW = registerSW({
    immediate: true, // Intenta actualizar apenas detecta cambios
    onNeedRefresh() {
      // Si hay una nueva versión, forzamos la recarga para que el cliente siempre tenga lo último
      console.log("🔄 Nueva versión detectada. Actualizando sistema...");
      updateSW(true); 
    },
    onOfflineReady() {
      console.log("✅ Sistema listo para trabajar sin conexión (Offline Mode).");
    },
  })
}

// 🌱 SEEDER DEV (solo en desarrollo)
if (import.meta.env.DEV) {
  import('./dev/seeder.js').then(m => {
    window.__noarSeed = m.runSeed;
    window.__noarClear = m.clearSeed;
    console.info('%c🌱 NOAR Seeder listo%c  →  window.__noarSeed()  /  window.__noarClear()', 'color:#22c55e;font-weight:bold', 'color:#888');
  });
}

// 🚀 ARRANQUE DE REACT
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)