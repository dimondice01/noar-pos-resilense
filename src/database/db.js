// src/database/db.js
import { openDB } from 'idb';

const DB_NAME = 'NoarPosDB';
const DB_VERSION = 5; // ⚠️ SUBIMOS VERSIÓN A 5 (Customer Ledger / Cuenta Corriente)

export const initDB = async () => {
  return openDB(DB_NAME, DB_VERSION, {
    async upgrade(db, oldVersion, newVersion, transaction) {
      console.log(`🔄 Migrando base de datos de v${oldVersion} a v${newVersion}...`);

      // v1: Productos, Ventas, Clientes (Estructura Base)
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

      // v2: Maestros (Categorías, Marcas, Proveedores)
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('categories')) {
          db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('brands')) {
          db.createObjectStore('brands', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('suppliers')) {
          db.createObjectStore('suppliers', { keyPath: 'id', autoIncrement: true });
        }
      }

      // v3: Historial de Movimientos (Kardex)
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains('movements')) {
          const movementStore = db.createObjectStore('movements', { keyPath: 'id', autoIncrement: true });
          // Índices para buscar rápido el historial de un producto específico
          movementStore.createIndex('productId', 'productId', { unique: false });
          movementStore.createIndex('date', 'date', { unique: false });
        }
      }

      // v4: GESTIÓN DE CAJA Y TURNOS + CRM CLIENTES
      if (oldVersion < 4) {
        
        // --- A. CRM: Índices para Clientes (Búsqueda Rápida) ---
        if (db.objectStoreNames.contains('clients')) {
            const clientStore = transaction.objectStore('clients');
            if (!clientStore.indexNames.contains('docNumber')) {
                clientStore.createIndex('docNumber', 'docNumber', { unique: false });
            }
            if (!clientStore.indexNames.contains('name')) {
                clientStore.createIndex('name', 'name', { unique: false });
            }
        }

        // --- B. Cash Management (Tablas Nuevas) ---
        
        // 1. Tabla de Turnos
        if (!db.objectStoreNames.contains('shifts')) {
          const shiftsStore = db.createObjectStore('shifts', { keyPath: 'id' });
          shiftsStore.createIndex('status', 'status', { unique: false });
          shiftsStore.createIndex('userId', 'userId', { unique: false });
          shiftsStore.createIndex('openedAt', 'openedAt', { unique: false });
        }

        // 2. Tabla de Movimientos de Caja
        if (!db.objectStoreNames.contains('cash_movements')) {
          const cashStore = db.createObjectStore('cash_movements', { keyPath: 'id', autoIncrement: true });
          cashStore.createIndex('shiftId', 'shiftId', { unique: false });
          cashStore.createIndex('type', 'type', { unique: false });
        }

        // 3. Actualizar Ventas
        if (db.objectStoreNames.contains('sales')) {
            const salesStore = transaction.objectStore('sales');
            if (!salesStore.indexNames.contains('shiftId')) {
              salesStore.createIndex('shiftId', 'shiftId', { unique: false });
            }
        }
      }

      // v5: CUENTA CORRIENTE (Ledger)
      if (oldVersion < 5) {
        console.log("⚡ Creando Libro Mayor de Clientes...");
        
        // 1. Tabla de Movimientos de Cuenta Corriente
        if (!db.objectStoreNames.contains('customer_ledger')) {
          const ledgerStore = db.createObjectStore('customer_ledger', { keyPath: 'id', autoIncrement: true });
          ledgerStore.createIndex('clientId', 'clientId', { unique: false });
          ledgerStore.createIndex('date', 'date', { unique: false });
          // Tipos: 'SALE_DEBT' (Fiado), 'PAYMENT' (Pago a cuenta), 'ADJUSTMENT' (Nota Debito/Credito)
          ledgerStore.createIndex('type', 'type', { unique: false }); 
        }

        // 2. Inicializar saldo en 0 para clientes existentes (Migración de datos)
        if (db.objectStoreNames.contains('clients')) {
            const clientStore = transaction.objectStore('clients');
            let cursor = await clientStore.openCursor();
            while (cursor) {
              const client = cursor.value;
              // Si no tiene saldo, lo inicializamos en 0
              if (typeof client.balance === 'undefined') {
                client.balance = 0;
                await cursor.update(client);
              }
              cursor = await cursor.continue();
            }
        }
      }
      
      console.log(`✅ Base de datos actualizada correctamente a v${newVersion}`);
    },
  });
};

export const getDB = async () => await initDB();