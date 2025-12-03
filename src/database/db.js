import { openDB } from 'idb';

const DB_NAME = 'NoarPosDB';
const DB_VERSION = 4; // ⚠️ SUBIMOS VERSIÓN A 4 (Cash Management)

export const initDB = async () => {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      console.log(`🔄 Migrando base de datos de v${oldVersion} a v${newVersion}...`);

      // v1: Productos, Ventas, Clientes
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

      // v4: GESTIÓN DE CAJA Y TURNOS (Cash Management)
      if (oldVersion < 4) {
        // 1. Tabla de Turnos (Cajas Abiertas/Cerradas)
        if (!db.objectStoreNames.contains('shifts')) {
          const shiftsStore = db.createObjectStore('shifts', { keyPath: 'id' });
          shiftsStore.createIndex('status', 'status', { unique: false }); // 'OPEN', 'CLOSED'
          shiftsStore.createIndex('userId', 'userId', { unique: false });
          shiftsStore.createIndex('openedAt', 'openedAt', { unique: false });
        }

        // 2. Tabla de Movimientos de Caja (Retiros, Ingresos, Apertura)
        if (!db.objectStoreNames.contains('cash_movements')) {
          const cashStore = db.createObjectStore('cash_movements', { keyPath: 'id', autoIncrement: true });
          cashStore.createIndex('shiftId', 'shiftId', { unique: false }); // Para filtrar por turno
          cashStore.createIndex('type', 'type', { unique: false }); // 'WITHDRAWAL', 'DEPOSIT', 'OPENING'
        }

        // 3. Actualizamos Ventas para asociarlas a un Turno
        const salesStore = transaction.objectStore('sales');
        if (!salesStore.indexNames.contains('shiftId')) {
          salesStore.createIndex('shiftId', 'shiftId', { unique: false });
        }
      }
      
      console.log(`✅ Base de datos actualizada correctamente a v${newVersion}`);
    },
  });
};

export const getDB = async () => await initDB();