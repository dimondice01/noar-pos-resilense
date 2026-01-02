import { initializeApp } from 'firebase/app';
// 👇 Importamos las funciones de persistencia
import { 
  getFirestore, 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager 
} from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage'; // 1. IMPORTAR STORAGE

const firebaseConfig = {
  apiKey: "AIzaSyCYfKaTKoI6q1FZYT4v8Lnqsp4osBd5aP8",
  authDomain: "salvadorpos1.firebaseapp.com",
  projectId: "salvadorpos1",
  storageBucket: "salvadorpos1.firebasestorage.app",
  messagingSenderId: "975094283854",
  appId: "1:975094283854:web:5ce9c42f6470c186920d1f"
};

const app = initializeApp(firebaseConfig);

// 👇 CONFIGURACIÓN DE BASE DE DATOS (OFFLINE FIRST)
// Mantenemos esto intacto porque es vital para la resiliencia
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

export const functions = getFunctions(app);
export const auth = getAuth(app);
export const storage = getStorage(app); // 2. EXPORTAR STORAGE

// 🔴 COMENTA ESTE BLOQUE TEMPORALMENTE PARA PROBAR LA NUBE REAL
/*
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  console.log("🔧 Usando Emuladores de Firebase (Local)");
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
*/