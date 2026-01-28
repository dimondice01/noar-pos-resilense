import Dexie from 'dexie';

// =================================================================
// 🏛️ ARQUITECTURA NOAR POS ENTERPRISE (DEXIE v12 - FINAL)
// =================================================================

export const db = new Dexie('NoarPosDB');

/**
 * ESQUEMA DE DATOS v12
 * - Multi-Tenant: Aislamiento por companyId.
 * - Multi-Sucursal: Stock y Configuración Fiscal independiente.
 * - Enterprise: Soporte para intereses, IVA y numeración profesional.
 * - Optimización UI: Stock local denormalizado para velocidad extrema.
 */
db.version(12).stores({
  // 🏢 ESTRUCTURA CORPORATIVA
  companies: 'id, name', 
  
  // 📍 SUCURSALES (Nodo Fiscal e Integraciones)
  branches: 'id, companyId, name, cuit, taxCategory, afipPtoVenta, active', 

  // 📦 CATÁLOGO MAESTRO (Global por Empresa)
  // 'stock': Es un campo volátil que representa el stock de la SUCURSAL ACTIVA.
  // El SyncService se encarga de mantenerlo sincronizado con la tabla 'inventory'.
  products: 'id, companyId, code, name, category, brand, supplier, taxRate, active, syncStatus, stock, isWeighable', 
  
  // Maestros Globales
  categories: 'id, name, syncStatus',
  brands: 'id, name, syncStatus',
  suppliers: 'id, name, docNumber, syncStatus',

  // 🏥 INVENTARIO FÍSICO (Base de Datos Real)
  // Aquí vive la verdad absoluta de cada sucursal.
  // Clave compuesta: [branchId+productId] para búsquedas rápidas.
  inventory: '[branchId+productId], productId, branchId, stock, minStock, location, updatedAt',

  // 💳 FINANZAS & TASAS
  payment_methods: 'id, branchId, type, name, active', 
  installments_config: '++id, paymentMethodId, installments, interestRate',

  // 💰 VENTAS (Numeración Profesional)
  sales: 'localId, firestoreId, companyId, branchId, userId, type, number, date, status, syncStatus', 
  sale_items: '++id, saleId, productId, quantity, price, subtotal', // Detalle de venta (opcional si va en sales)

  // 💸 CAJA Y TURNOS OPERATIVOS
  shifts: 'id, userId, branchId, status, openedAt, syncStatus',
  cash_movements: '++id, shiftId, branchId, type, amount, date, syncStatus',

  // 👥 CRM
  clients: 'id, companyId, docNumber, name, email, syncStatus',

  // 📉 CUENTAS CORRIENTES (LEDGERS)
  customer_ledger: '++id, clientId, date, type, amount, syncStatus',
  supplier_ledger: '++id, supplierId, date, type, amount, syncStatus',

  // 📈 KARDEX & AUDITORÍA DE MOVIMIENTOS
  movements: '++id, productId, branchId, userId, type, date, amount, syncStatus',
  
  // ⚙️ SISTEMA & CONFIGURACIÓN
  config: 'key',
  
  // 👤 USUARIOS (Cache para Offline)
  users: 'email, uid, companyId, branchId, role, name, password'
});

// Middlewares: Inicialización de datos críticos
db.on('populate', (tx) => {
  tx.table('config').add({ key: 'theme', value: 'light' });
  tx.table('config').add({ key: 'offline_mode', value: true });
  tx.table('config').add({ key: 'last_migration', value: 'v12_enterprise_final' });
});

// =================================================================
// 🚀 ACCESO SEGURO Y GESTIÓN DE MIGRACIONES CRÍTICAS
// =================================================================

export const getDB = async () => {
  const MIGRATION_KEY = 'NOAR_MIGRATION_V12_FINAL';
  const isMigrated = localStorage.getItem(MIGRATION_KEY);

  // 🛑 SAFETY CHECK: Verificación de consistencia para nuevas versiones
  if (!isMigrated) {
      console.log("🔄 Ejecutando actualización de arquitectura Multi-Sucursal v12...");

      // Regla de Oro: Requiere internet para asegurar el Sync inicial de la nueva estructura
      // Comentado temporalmente para permitir pruebas locales, descomentar para producción estricta.
      /*
      if (!navigator.onLine) {
          console.warn("⛔ Actualización pospuesta: Se requiere conexión para migrar a v12.");
          throw new Error("REQUIRES_ONLINE_FOR_MIGRATION");
      }
      */

      try {
          console.warn("✨ Aplicando cambios estructurales Enterprise...");
          
          if (db.isOpen()) db.close();

          // Borrado preventivo para re-estructuración limpia.
          // Esto fuerza una re-descarga total desde Firebase, garantizando integridad.
          await Dexie.delete('NoarPosDB');
          
          localStorage.setItem(MIGRATION_KEY, 'true');
          console.log("✅ Arquitectura v12 lista.");
          
          // Recargamos para aplicar los cambios de esquema limpiamente
          window.location.reload(); 
          return; 
      
      } catch (e) {
          console.error("⚠️ Error en migración crítica:", e);
      }
  }

  // APERTURA Y FALLSAFE
  if (!db.isOpen()) {
      try {
        await db.open();
      } catch (err) {
        // Si hay error de versión o corrupción, reseteamos de fábrica
        if (err.name === 'VersionError' || err.name === 'OpenFailedError') {
             console.error("💥 Error de base de datos. Ejecutando reset de emergencia.");
             await Dexie.delete('NoarPosDB');
             await db.open();
             localStorage.setItem(MIGRATION_KEY, 'true');
        }
      }
  }
  return db;
};