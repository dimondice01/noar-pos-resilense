import Dexie from 'dexie';

// =================================================================
// 🏛️ ARQUITECTURA NOAR POS ENTERPRISE (DEXIE v13 - NEXUS CORE)
// =================================================================

export const db = new Dexie('NoarPosDB');

/**
 * ESQUEMA DE DATOS v13 - NEXUS CORE EDITION
 * * Cambios Estratégicos:
 * 1. Indices 'updatedAt': Agregados en tablas maestras para permitir Sync Incremental.
 * 2. Indice '*barcode': Multi-Entry index para soportar array de códigos en productos.
 * 3. Inventario Blindado: Clave compuesta [branchId+productId].
 */
db.version(13).stores({
  // 🏢 ESTRUCTURA CORPORATIVA (Tenant)
  companies: 'id, name', 
  
  // 📍 SUCURSALES (Branch Control)
  branches: 'id, companyId, name, cuit, taxCategory, afipPtoVenta, active', 

  // 📦 CATÁLOGO MAESTRO (Global por Tenant)
  // '*barcode': Permite búsqueda rápida en arrays de códigos (Multi-Barcode).
  // 'updatedAt': Crítico para el Delta Sync.
  products: 'id, companyId, code, *barcode, name, category, brand, supplier, taxRate, active, syncStatus, stock, isWeighable, cost, price, promoId, updatedAt', 
  
  // Maestros Globales (Con updatedAt para Sync)
  categories: 'id, name, updatedAt, syncStatus',
  brands: 'id, name, updatedAt, syncStatus',
  
  // 🚛 PROVEEDORES
  suppliers: 'id, name, docNumber, taxId, updatedAt, syncStatus',

  // 🏥 INVENTARIO FÍSICO (Localizado por Sucursal)
  // [branchId+productId]: Clave única compuesta.
  inventory: '[branchId+productId], productId, branchId, stock, minStock, updatedAt',

  // 🏷️ MOTOR DE PROMOCIONES
  promotions: 'id, companyId, name, type, startDate, endDate, active, syncStatus',

  // 🧾 MOTOR DE COMPRAS (Ingreso de Mercadería)
  purchases: 'id, companyId, branchId, supplierId, invoiceNumber, date, status, total, syncStatus',
  purchase_items: '++id, purchaseId, productId, quantity, cost, newPrice',

  // 💳 FINANZAS & TASAS
  payment_methods: 'id, branchId, type, name, active', 
  installments_config: '++id, paymentMethodId, installments, interestRate',

  // 💰 VENTAS (Numeración Profesional)
  sales: 'localId, firestoreId, companyId, branchId, userId, type, number, date, status, syncStatus', 
  sale_items: '++id, saleId, productId, quantity, price, subtotal',

  // 💸 CAJA Y TURNOS OPERATIVOS
  shifts: 'id, userId, branchId, status, openedAt, syncStatus',
  cash_movements: '++id, shiftId, branchId, type, amount, date, syncStatus',

  // 👥 CRM (Clientes)
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
  tx.table('config').add({ key: 'last_migration', value: 'v13_nexus_core' });
});

// =================================================================
// 🚀 GESTIÓN DE MIGRACIÓN Y ACCESO SEGURO
// =================================================================

export const getDB = async () => {
  const MIGRATION_KEY = 'NOAR_MIGRATION_V13_NEXUS_CORE_FIXED'; // Cambié la key para forzar re-indexado
  const isMigrated = localStorage.getItem(MIGRATION_KEY);

  // 🛑 SAFETY CHECK: Migración de Estructura
  if (!isMigrated) {
      console.warn("🔄 NEXUS CORE: Re-indexando base de datos v13...");

      try {
          if (db.isOpen()) db.close();

          // Reseteamos para aplicar los nuevos índices limpios
          await Dexie.delete('NoarPosDB');
          await db.open();

          localStorage.setItem(MIGRATION_KEY, 'true');
          console.log("✅ Estructura NEXUS CORE actualizada y re-indexada.");
          
          window.location.reload(); 
          return; 
      
      } catch (error) {
          console.error("🔴 Error crítico en migración NEXUS CORE:", error);
      }
  }

  // APERTURA Y FALLSAFE
  if (!db.isOpen()) {
      try {
        await db.open();
      } catch (err) {
        if (err.name === 'VersionError' || err.name === 'OpenFailedError') {
             console.error("💥 Corrupción detectada. Ejecutando reset de fábrica.");
             await Dexie.delete('NoarPosDB');
             await db.open();
             localStorage.setItem(MIGRATION_KEY, 'true');
        }
      }
  }
  return db;
};