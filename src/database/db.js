// src/database/db.js
import { openDB } from 'idb';

const DB_NAME = 'NoarPosDB';
const DB_VERSION = 7; // ⚠️ SUBIMOS A v7 PARA CREAR LA TABLA 'config'

export const initDB = async () => {
  return openDB(DB_NAME, DB_VERSION, {
    async upgrade(db, oldVersion, newVersion, transaction) {
      console.log(`🔄 Migrando base de datos de v${oldVersion} a v${newVersion}...`);

      // -----------------------------------------------------------------------
      // BLOQUE 1: ESTRUCTURA BASE (LEGACY)
      // -----------------------------------------------------------------------
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('products')) {
          const productStore = db.createObjectStore('products', { keyPath: 'id' });
          productStore.createIndex('code', 'code', { unique: true });
          productStore.createIndex('name', 'name', { unique: false });
        }
        if (!db.objectStoreNames.contains('sales')) {
          const salesStore = db.createObjectStore('sales', { keyPath: 'localId' }); 
          salesStore.createIndex('status', 'status', { unique: false });
          salesStore.createIndex('date', 'date', { unique: false });
        }
        if (!db.objectStoreNames.contains('clients')) {
          db.createObjectStore('clients', { keyPath: 'id' });
        }
      }

      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('brands')) db.createObjectStore('brands', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('suppliers')) db.createObjectStore('suppliers', { keyPath: 'id', autoIncrement: true });
      }

      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains('movements')) {
          const movementStore = db.createObjectStore('movements', { keyPath: 'id', autoIncrement: true });
          movementStore.createIndex('productId', 'productId', { unique: false });
          movementStore.createIndex('date', 'date', { unique: false });
        }
      }

      // -----------------------------------------------------------------------
      // BLOQUE 2: SEGURIDAD, CAJA Y CRM (CONSOLIDADO)
      // -----------------------------------------------------------------------
      if (oldVersion < 6) {
        // A. Seguridad (Usuarios Locales)
        if (!db.objectStoreNames.contains('users')) {
          const userStore = db.createObjectStore('users', { keyPath: 'email' });
          userStore.createIndex('role', 'role', { unique: false });
        }
        
        // B. CRM: Índices para Clientes
        if (db.objectStoreNames.contains('clients')) {
            const clientStore = transaction.objectStore('clients');
            if (!clientStore.indexNames.contains('docNumber')) clientStore.createIndex('docNumber', 'docNumber', { unique: false });
            if (!clientStore.indexNames.contains('name')) clientStore.createIndex('name', 'name', { unique: false });
        }

        // C. Cash Management (Tablas de Caja)
        if (!db.objectStoreNames.contains('shifts')) {
          const shiftsStore = db.createObjectStore('shifts', { keyPath: 'id' });
          shiftsStore.createIndex('status', 'status', { unique: false });
          shiftsStore.createIndex('userId', 'userId', { unique: false });
          shiftsStore.createIndex('openedAt', 'openedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('cash_movements')) {
          const cashStore = db.createObjectStore('cash_movements', { keyPath: 'id', autoIncrement: true });
          cashStore.createIndex('shiftId', 'shiftId', { unique: false });
          cashStore.createIndex('type', 'type', { unique: false });
        }

        // D. Actualizar Ventas (Shift ID)
        if (db.objectStoreNames.contains('sales')) {
            const salesStore = transaction.objectStore('sales');
            if (!salesStore.indexNames.contains('shiftId')) {
              salesStore.createIndex('shiftId', 'shiftId', { unique: false });
            }
        }

        // E. Ledger (Cuenta Corriente)
        if (!db.objectStoreNames.contains('customer_ledger')) {
          const ledgerStore = db.createObjectStore('customer_ledger', { keyPath: 'id', autoIncrement: true });
          ledgerStore.createIndex('clientId', 'clientId', { unique: false });
          ledgerStore.createIndex('date', 'date', { unique: false });
          ledgerStore.createIndex('type', 'type', { unique: false }); 
        }
      }

      // -----------------------------------------------------------------------
      // BLOQUE 3: CONFIGURACIÓN LOCAL (EL FIX PARA EL PIN)
      // -----------------------------------------------------------------------
      // 🔥 ESTO SOLUCIONA EL ERROR "Object store not found"
      if (oldVersion < 7) {
         if (!db.objectStoreNames.contains('config')) {
            // Creamos la tabla 'config' para guardar el PIN y preferencias
            db.createObjectStore('config', { keyPath: 'key' });
            console.log("✅ Tabla 'config' creada correctamente.");
         }
      }
      
      console.log(`✅ Base de datos actualizada y verificada a v${newVersion}`);
    },
  });
};

export const getDB = async () => await initDB();