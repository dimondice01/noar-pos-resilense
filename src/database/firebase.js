import { initializeApp } from 'firebase/app';
// 👇 Importamos las funciones de persistencia
import { 
  getFirestore, 
  connectFirestoreEmulator, 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager 
} from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getAuth, connectAuthEmulator } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyCaHSGp-KJR5B-WRY_OtKg5XT2xKwSKTMw",
  authDomain: "laesquina-pos.firebaseapp.com",
  projectId: "laesquina-pos",
  storageBucket: "laesquina-pos.firebasestorage.app",
  messagingSenderId: "244362990428",
  appId: "1:244362990428:web:8769d1d6e7810d9fa62799"
};

const app = initializeApp(firebaseConfig);

// 👇 CAMBIO CRÍTICO: Inicializamos Firestore con Caché Persistente
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

export const functions = getFunctions(app);
export const auth = getAuth(app);

// 🔴 COMENTA ESTE BLOQUE TEMPORALMENTE PARA PROBAR LA NUBE REAL
/*
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  console.log("🔧 Usando Emuladores de Firebase (Local)");
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
*/