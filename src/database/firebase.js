import { initializeApp } from 'firebase/app';
// 👇 ESTA LÍNEA ES LA QUE TE FALTABA
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

// ============================================================
// CONFIGURACIÓN (Cópiala de tu consola de Firebase)
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyA1FuE-HmJnMmA844qTtmp-KcX_5YJL4Ng",
  authDomain: "noar-pos-prod.firebaseapp.com",
  projectId: "noar-pos-prod",
  storageBucket: "noar-pos-prod.firebasestorage.app",
  messagingSenderId: "19241423106",
  appId: "1:19241423106:web:ed1a2af595221ee1e9b21b"
};

// ============================================================
// INICIALIZACIÓN
// ============================================================

// 1. Iniciar la App
const app = initializeApp(firebaseConfig);

// 2. Iniciar Servicios
export const db = getFirestore(app);
export const functions = getFunctions(app);

// ============================================================
// MODO DESARROLLO (EMULADORES)
// ============================================================
// Si estamos en localhost, usamos los emuladores para no tocar la nube real
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  console.log("🔧 Usando Emuladores de Firebase (Local)");
  
  // Conectar a Firestore Local (Puerto 8080)
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  
  // Conectar a Functions Local (Puerto 5001)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}