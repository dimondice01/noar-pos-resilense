import Dexie from 'dexie';

// =================================================================
// 🏛️ ARQUITECTURA ENTERPRISE (DEXIE v8)
// =================================================================

export const db = new Dexie('NoarPosDB');

// Definimos el esquema FINAL (v8).
// Dexie se encarga automáticamente de crear tablas e índices si no existen.
db.version(8).stores({
  // 📦 INVENTARIO
  products: 'id, code, name, categoryId, active, syncStatus, lastUpdated', 
  categories: 'id, name, syncStatus',
  brands: 'id, name, syncStatus',

  // 💰 VENTAS & CAJA
  sales: 'localId, firestoreId, shiftId, date, status, [date+status], syncStatus', 
  shifts: 'id, userId, status, openedAt, syncStatus',
  cash_movements: '++id, shiftId, type, date, syncStatus',

  // 👥 CRM & TERCEROS
  clients: 'id, docNumber, name, email, syncStatus',
  suppliers: 'id, name, docNumber, syncStatus',

  // 📉 CUENTAS CORRIENTES (LEDGERS)
  customer_ledger: '++id, clientId, date, type, syncStatus',
  supplier_ledger: '++id, supplierId, date, type, syncStatus', // 🔥 La nueva tabla

  // ⚙️ SISTEMA & KARDEX
  config: 'key',
  users: 'email, role',
  movements: '++id, productId, date, type, syncStatus'
});

// Middlewares: Datos por defecto al crear la DB
db.on('populate', (tx) => {
  tx.table('config').add({ key: 'theme', value: 'light' });
  tx.table('config').add({ key: 'offline_mode', value: true });
});

// =================================================================
// 🚀 ACCESO SEGURO CON "SAFETY CHECK" DE MIGRACIÓN
// =================================================================

export const getDB = async () => {
  const MIGRATION_KEY = 'NOAR_MIGRATION_DEXIE_V1';
  const isMigrated = localStorage.getItem(MIGRATION_KEY);

  // CASO: USUARIO LEGACY DETECTADO (Aun tiene la DB vieja de 'idb')
  if (!isMigrated) {
      console.log("🔄 Verificando condiciones para migración a Dexie...");

      // 🛑 REGLA DE SEGURIDAD: SI NO HAY INTERNET, NO TOCAMOS NADA
      // Esto evita borrar datos viejos si no podemos descargar los nuevos.
      if (!navigator.onLine) {
          console.warn("⛔ Migración pospuesta: Se requiere internet para actualizar.");
          // Lanzamos un error controlado. Tu App debería capturar esto y mostrar:
          // "Para actualizar a la nueva versión, conéctese a Internet una vez."
          throw new Error("REQUIRES_ONLINE_FOR_MIGRATION");
      }

      // ✅ SI HAY INTERNET: PROCEDEMOS CON EL RESET SEGURO
      try {
          console.warn("✨ Conexión detectada. Ejecutando actualización crítica...");
          
          if (db.isOpen()) db.close();

          // Borramos la base vieja corrupta/legacy
          await Dexie.delete('NoarPosDB');
          
          console.log("✅ Base de datos Legacy eliminada. Sistema limpio.");
          localStorage.setItem(MIGRATION_KEY, 'true');
          
          // Recargamos para limpiar caché de memoria y arrancar Dexie limpio
          window.location.reload(); 
          return; 
      
      } catch (e) {
          console.error("⚠️ Error migración:", e);
      }
  }

  // APERTURA NORMAL
  if (!db.isOpen()) {
      try {
        await db.open();
      } catch (err) {
        // Failsafe: Si la DB está corrupta, reset de fábrica
        if (err.name === 'VersionError' || err.name === 'OpenFailedError') {
             console.error("💥 DB Corrupta. Reset de fábrica.");
             await Dexie.delete('NoarPosDB');
             await db.open();
             localStorage.setItem(MIGRATION_KEY, 'true');
        }
      }
  }
  return db;
};