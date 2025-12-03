import { openDB } from 'idb';

const DB_NAME = 'NoarPosDB';
const DB_VERSION = 3; // ⚠️ SUBIMOS VERSIÓN A 3 (Para el Kardex)

export const initDB = async () => {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
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
      
      console.log(`✅ Base de datos actualizada a v${newVersion}`);
    },
  });
};

export const getDB = async () => await initDB();