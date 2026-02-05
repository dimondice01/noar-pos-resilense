import Dexie from 'dexie';

// =================================================================
// 🏛️ ARQUITECTURA NOAR POS ENTERPRISE (DEXIE v17 - LOCAL-FIRST CORE)
// =================================================================

/**
 * ESQUEMA DE DATOS v17 - BLINDAJE OFFLINE PRO MAX
 * Principios de Diseño Local-First:
 * 1. Cero Latencia: Índices compuestos para recuperación inmediata de sesiones.
 * 2. Autonomía Total: Tablas 'config' y 'shifts' priorizadas para inicio sin internet.
 * 3. Consistencia JIT: updatedAt en cada registro para sincronización delta eficiente.
 */

export const db = new Dexie('NoarPosDB_V17');

db.version(1).stores({
  // 🏢 ESTRUCTURA CORPORATIVA & SESSION CACHE
  // Guardamos datos de empresa y sucursal activa localmente para evitar flashes de carga
  companies: 'id, name, updatedAt, syncStatus', 
  
  // 📍 SUCURSALES (Indexadas para acceso rápido por ID)
  branches: 'id, companyId, name, active, updatedAt, syncStatus', 

  // 📦 CATÁLOGO MAESTRO (Global - Alto Rendimiento)
  // priceActivationDate: para activar precios programados localmente sin esperar a la nube.
  products: 'id, code, *barcode, name, category, categoryId, brand, brandId, active, syncStatus, updatedAt, priceActivationDate', 
  
  // Maestros Globales (Carga diferida)
  categories: 'id, name, updatedAt, syncStatus',
  brands: 'id, name, updatedAt, syncStatus',
  
  // 🚛 PROVEEDORES
  suppliers: 'id, name, docNumber, updatedAt, syncStatus',

  // 🏥 INVENTARIO FÍSICO Y PROMOS (Localizado por Sucursal)
  // Clave compuesta [branchId+productId] para búsquedas directas de stock local.
  inventory: '[branchId+productId], branchId, productId, stock, hasPromo, updatedAt, syncStatus',

  // 🏷️ MOTOR DE PROMOCIONES GENERALES
  promotions: 'id, branchId, name, type, active, updatedAt, syncStatus',

  // 🧾 MOTOR DE COMPRAS (Recepción de mercadería)
  purchases: 'id, branchId, supplierId, date, status, updatedAt, syncStatus',
  purchase_items: '++id, purchaseId, productId',

  // 💰 VENTAS (Blindaje de Operación Offline)
  // userId y branchId indexados para filtrar historial local rápidamente.
  sales: 'id, date, number, ticketNumber, invoiceNumber, branchId, userId, status, updatedAt, syncStatus', 
  sale_items: '++id, saleId, productId',

  // 💸 CAJA Y TURNOS (EL CORAZÓN DEL LOCAL-FIRST)
  // 🔥 MEJORA: Índice compuesto [userId+status] para rehidratación INSTANTÁNEA al recargar F5.
  shifts: 'id, userId, branchId, status, [userId+status], openedAt, closedAt, updatedAt, syncStatus',
  cash_movements: '++id, shiftId, branchId, type, date, updatedAt, syncStatus',

  // 👥 CRM (Clientes - Búsqueda rápida por documento o nombre)
  clients: 'id, docNumber, name, email, updatedAt, syncStatus',

  // 📉 CUENTAS CORRIENTES (Saldos locales para venta a crédito offline)
  customer_ledger: '++id, clientId, date, updatedAt, syncStatus',
  supplier_ledger: '++id, supplierId, date, updatedAt, syncStatus',

  // 📈 KARDEX (Log de Movimientos de Stock local)
  movements: '++id, productId, branchId, date, type, updatedAt, syncStatus',
  
  // ⚙️ CONFIGURACIÓN & ESTADO DE LA APP
  // Almacenamos aquí el 'last_sync_timestamp' para no re-descargar todo.
  config: 'key',
  
  // Usuarios con acceso a esta terminal (Offline Auth Support)
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
        console.log("💽 Motor Local-First (Dexie) V17 operativo.");
      } catch (err) {
        console.error("💥 Falla Crítica en Motor Local:", err);
        if (err.name === 'VersionError' || err.name === 'OpenFailedError') {
             console.warn("⚠️ Ejecutando Auto-Reparación de Base de Datos...");
             // Borramos versiones que podrían causar colisión de esquemas
             await Dexie.delete('NoarPosDB_V16'); 
             await Dexie.delete('NoarPosDB_V17');
             await db.open();
        }
      }
  }
  return db;
};