import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  disableNetwork,
  enableNetwork,
  terminate,
  clearIndexedDbPersistence
} from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyCYfKaTKoI6q1FZYT4v8Lnqsp4osBd5aP8",
  authDomain: "salvadorpos1.firebaseapp.com",
  projectId: "salvadorpos1",
  storageBucket: "salvadorpos1.firebasestorage.app",
  messagingSenderId: "975094283854",
  appId: "1:975094283854:web:5ce9c42f6470c186920d1f"
};

// 1. Inicializar App
const app = initializeApp(firebaseConfig);

// 2. Inicializar Firestore con Caché Robusto (Offline First)
// Usamos la configuración moderna que soporta múltiples pestañas abiertas sin romper la base de datos
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

// 3. Exportar servicios
export const functions = getFunctions(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// =================================================================
// 🛠️ HERRAMIENTAS ENTERPRISE (Auto-Healing & Network)
// =================================================================

// A. Reconexión Manual: Útil cuando el internet vuelve pero Firestore se quedó "dormido"
export const reconnectFirestore = async () => {
    try {
        console.log("🔄 Reiniciando conexión a red Firestore...");
        await disableNetwork(db);
        await enableNetwork(db);
        console.log("✅ Conexión restablecida.");
    } catch (e) {
        console.error("Error reconectando:", e);
    }
};

// B. Limpieza de Emergencia: EJECUTAR SI APARECE EL ERROR "INTERNAL ASSERTION FAILED"
// Esto borra la base de datos local corrupta y la baja limpia de nuevo de la nube.
export const emergencyClearCache = async () => {
    try {
        console.warn("🧹 Iniciando purga de caché corrupto...");
        await terminate(db); // Apagar Firestore
        await clearIndexedDbPersistence(db); // Borrar DB Local
        console.log("✨ Caché purgado. Recargando sistema...");
        window.location.reload(); // Reinicio forzado
    } catch (e) {
        console.error("Error fatal purgando caché:", e);
    }
};

// Para ejecutar la limpieza si estás trabado, abre la consola del navegador (F12) y escribe:
// import('./src/database/firebase.js').then(m => m.emergencyClearCache()) 
// O simplemente asigna esto a window temporalmente:
window.fixFirebase = emergencyClearCache;