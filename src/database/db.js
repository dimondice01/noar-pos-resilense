import Dexie from 'dexie';

// =================================================================
// 🏛️ ARQUITECTURA NOAR POS ENTERPRISE (DEXIE v11)
// =================================================================

export const db = new Dexie('NoarPosDB');

/**
 * ESQUEMA DE DATOS v11
 * - Multi-Tenant: Aislamiento por companyId.
 * - Multi-Sucursal: Stock y Configuración Fiscal independiente.
 * - Enterprise: Soporte para intereses, IVA y numeración profesional.
 */
db.version(11).stores({
  // 🏢 ESTRUCTURA CORPORATIVA
  companies: 'id, name', 
  
  // 📍 SUCURSALES (Nodo Fiscal e Integraciones)
  // Cada sucursal puede tener su propio CUIT y configuración AFIP/MercadoPago
  branches: 'id, companyId, name, cuit, taxCategory, afipPtoVenta, active', 

  // 📦 CATÁLOGO MAESTRO (Global por Empresa)
  // El precio y el taxRate (IVA) se definen aquí para consistencia total.
  // NOTA: El stock ya no vive aquí, se movió a la tabla 'inventory'.
  products: 'id, companyId, code, name, categoryId, brandId, taxRate, active, syncStatus', 
  categories: 'id, name, syncStatus',
  brands: 'id, name, syncStatus',

  // 🏥 INVENTARIO FÍSICO (Por Sucursal)
  // La clave compuesta [productId+branchId] asegura un registro único de stock por producto/sucursal
  inventory: '[productId+branchId], productId, branchId, stock, minStock, location',

  // 💳 FINANZAS & TASAS (Configurables por Sucursal o Empresa)
  // Permite manejar planes como Naranja (3, 6, 12 cuotas) con diferentes intereses
  payment_methods: 'id, branchId, type, name, active', 
  installments_config: '++id, paymentMethodId, installments, interestRate',

  // 💰 VENTAS (Numeración Profesional A, B, C, X)
  // Se indexa por branchId para cierres de caja y auditorías locales
  // 'number' guardará el formato legal (ej: 0001-00000045)
  sales: 'localId, firestoreId, companyId, branchId, userId, type, number, date, status, syncStatus', 

  // 💸 CAJA Y TURNOS OPERATIVOS
  shifts: 'id, userId, branchId, status, openedAt, syncStatus',
  cash_movements: '++id, shiftId, branchId, type, amount, date, syncStatus',

  // 👥 CRM & TERCEROS
  clients: 'id, companyId, docNumber, name, email, syncStatus',
  suppliers: 'id, branchId, name, docNumber, syncStatus', // Proveedores pueden ser por sucursal

  // 📉 CUENTAS CORRIENTES (LEDGERS)
  customer_ledger: '++id, clientId, date, type, syncStatus',
  supplier_ledger: '++id, supplierId, date, type, syncStatus',

  // 📈 KARDEX & AUDITORÍA DE MOVIMIENTOS
  // Rastreabilidad total: Qué se movió, quién, dónde y cuándo
  movements: '++id, productId, branchId, userId, type, date, amount, syncStatus',
  
  // ⚙️ SISTEMA & CONFIGURACIÓN
  config: 'key',
  // El usuario ahora tiene companyId y branchId para definir qué ve
  users: 'email, companyId, branchId, role'
});

// Middlewares: Inicialización de datos críticos
db.on('populate', (tx) => {
  tx.table('config').add({ key: 'theme', value: 'light' });
  tx.table('config').add({ key: 'offline_mode', value: true });
  tx.table('config').add({ key: 'last_migration', value: 'v11_enterprise' });
});

// =================================================================
// 🚀 ACCESO SEGURO Y GESTIÓN DE MIGRACIONES CRÍTICAS
// =================================================================

export const getDB = async () => {
  const MIGRATION_KEY = 'NOAR_MIGRATION_V11_FINAL';
  const isMigrated = localStorage.getItem(MIGRATION_KEY);

  // 🛑 SAFETY CHECK: Verificación de consistencia para nuevas versiones
  if (!isMigrated) {
      console.log("🔄 Ejecutando actualización de arquitectura Multi-Sucursal...");

      // Regla de Oro: Requiere internet para asegurar el Sync inicial de la nueva estructura
      if (!navigator.onLine) {
          console.warn("⛔ Actualización pospuesta: Se requiere conexión para migrar a v11.");
          // Lanzamos error controlado para que la UI avise al usuario
          throw new Error("REQUIRES_ONLINE_FOR_MIGRATION");
      }

      try {
          console.warn("✨ Aplicando cambios estructurales Enterprise...");
          
          if (db.isOpen()) db.close();

          // Borrado preventivo para re-estructuración de índices compuestos.
          // Esto limpia la base local legacy para que al reiniciar baje todo limpio de Firebase
          // con la nueva estructura de colecciones.
          await Dexie.delete('NoarPosDB');
          
          localStorage.setItem(MIGRATION_KEY, 'true');
          console.log("✅ Arquitectura v11 lista.");
          
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