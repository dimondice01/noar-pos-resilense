import Dexie from 'dexie';

// =================================================================
// 🏛️ ARQUITECTURA NOAR POS ENTERPRISE (LOCAL-FIRST CORE)
// =================================================================

// 🚨 MANTENEMOS EL NOMBRE DE LA V17 (Tus datos están a salvo aquí)
export const db = new Dexie('NoarPosDB_V17');

// 🔥 Subimos a 19 para incluir indexación de shiftId en ventas y blindar el motor de auditoría.
db.version(19).stores({
  companies: 'id, name, updatedAt, syncStatus', 
  branches: 'id, companyId, name, active, updatedAt, syncStatus', 
  products: 'id, code, *barcode, name, category, categoryId, brand, brandId, active, syncStatus, updatedAt, priceActivationDate', 
  categories: 'id, name, updatedAt, syncStatus',
  brands: 'id, name, updatedAt, syncStatus',
  suppliers: 'id, sequentialId, name, docNumber, updatedAt, syncStatus',

  inventory: '[branchId+productId], branchId, productId, stock, hasPromo, updatedAt, syncStatus',
  promotions: 'id, branchId, name, type, active, updatedAt, syncStatus',

  purchases: 'id, date, supplierId, branchId, invoiceNumber, paymentStatus, updatedAt, syncStatus',
  
  purchase_items: '++id, purchaseId, productId', 
  
  // 🔥 INDEXADO shiftId para evitar fallos en la matemática de auditorías
  sales: 'id, shiftId, date, number, ticketNumber, invoiceNumber, branchId, userId, status, updatedAt, syncStatus', 
  
  sale_items: '++id, saleId, productId', 
  shifts: 'id, userId, branchId, status, [userId+status], openedAt, closedAt, updatedAt, syncStatus',
  cash_movements: '++id, shiftId, branchId, type, date, referenceId, updatedAt, syncStatus', 
  clients: 'id, docNumber, name, email, updatedAt, syncStatus',
  customer_ledger: '++id, clientId, date, type, refId, updatedAt, syncStatus', 
  supplier_ledger: '++id, supplierId, date, type, refId, updatedAt, syncStatus', 
  movements: '++id, productId, branchId, date, type, refId, updatedAt, syncStatus', 
  
  config: 'key',
  users: 'uid, email, role, companyId, activeBranchId'
});

// Middlewares: Inicialización de Configuración Base
db.on('populate', (tx) => {
  tx.table('config').add({ key: 'theme', value: 'light' });
  tx.table('config').add({ key: 'offline_mode', value: false });
  tx.table('config').add({ key: 'last_full_sync', value: null });
  tx.table('config').add({ key: 'install_date', value: new Date().toISOString() });
});

// =================================================================
// 🚀 ACCESO SEGURO & SINGLETON PATTERN
// =================================================================

export const getDB = async () => {
  if (!db.isOpen()) {
      try {
        await db.open();
        console.log("💽 Motor Local-First (Dexie) V18 operativo e indexado.");
      } catch (err) {
        console.error("💥 Falla Crítica en Motor Local:", err);
        throw err; 
      }
  }
  return db;
};