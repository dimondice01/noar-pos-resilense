import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const firebaseConfig = {
  // ... (Tus credenciales siguen igual)
  apiKey: "AIzaSyA1FuE-HmJnMmA844qTtmp-KcX_5YJL4Ng",
  authDomain: "noar-pos-prod.firebaseapp.com",
  projectId: "noar-pos-prod",
  storageBucket: "noar-pos-prod.firebasestorage.app",
  messagingSenderId: "19241423106",
  appId: "1:19241423106:web:ed1a2af595221ee1e9b21b"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const functions = getFunctions(app);

// 🔴 COMENTA ESTE BLOQUE TEMPORALMENTE PARA PROBAR LA NUBE REAL
/*
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  console.log("🔧 Usando Emuladores de Firebase (Local)");
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
*/