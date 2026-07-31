import {
    collection,
    writeBatch,
    doc,
    setDoc,
    getDoc,
    onSnapshot,
    query,
    orderBy,
    limit,
    serverTimestamp,
    where,
    getDocs,
    Timestamp,
    increment
} from 'firebase/firestore'; 
import { db } from '../../../database/firebase';
import { getDB } from '../../../database/db';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { pushCashMovementWithShiftCounter } from '../../cash/services/shiftLedgerService';
import { pushLedgerMovementWithBalanceIncrement } from '../../clients/services/customerLedgerService';

const SYNC_KEYS = {}; // Deprecated: Usamos Dexie como fuente de verdad del estado de sync.

export const syncService = {
  
  _unsubscribes: [],
  _isSyncingData: false,
  _isSyncingProducts: false,
  _isSyncingInventory: false,
  _listenerSessionId: 0, // 🔥 Guardián de concurrencia para evitar "Failed to obtain primary lease"
  _startListenersTimer: null, // 🔥 Debounce timer para absorber llamadas rápidas de StrictMode/SubscriptionGuard

  // 🔥 HELPER SALVAVIDAS: Generador de IDs para evitar colisiones en Firebase
  _ensureValidCloudId(item, prefix) {
      if (item.firestoreId && item.firestoreId !== 'undefined') return String(item.firestoreId);
      if (typeof item.id === 'string' && item.id.length > 8) return item.id;
      return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  },

  _deepSanitize(obj) {
    if (obj === undefined || obj === null) return null;
    if (typeof obj === 'object') {
      if (obj instanceof Date) return obj.toISOString();
      if (obj && typeof obj.toDate === 'function') return obj.toDate().toISOString(); 
      if (Array.isArray(obj)) {
        return obj.map(v => this._deepSanitize(v));
      }
      const res = {};
      for (const key in obj) {
        res[key] = this._deepSanitize(obj[key]);
      }
      return res;
    }
    return obj;
  },

  _sanitizeCloudProduct(data, id) {
      return {
          id: id, 
          code: data.code ? String(data.code).trim() : 'SIN_CODIGO_' + id.slice(-4),
          barcode: Array.isArray(data.barcode) ? data.barcode : [], 
          name: data.name || 'Producto Sin Nombre',
          price: parseFloat(data.price) || 0,
          cost: parseFloat(data.cost) || 0,
          taxRate: parseFloat(data.taxRate) || 21,
          nextPrice: data.nextPrice !== undefined && data.nextPrice !== null ? parseFloat(data.nextPrice) : null,
          nextCost: data.nextCost !== undefined && data.nextCost !== null ? parseFloat(data.nextCost) : null,
          priceActivationDate: data.priceActivationDate || null,
          categoryId: data.categoryId || 'uncategorized',
          category: data.category || '',
          brand: data.brand || 'GENERICO',
          brandId: data.brandId || null,
          supplier: data.supplier || data.provider || '',
          suppliers: Array.isArray(data.suppliers) ? data.suppliers : [],
          unit: data.unit || 'UN',
          minPrice: parseFloat(data.minPrice) || 0,
          minStock: parseFloat(data.minStock) || 5,
          isWeighable: data.isWeighable === true,
          priceTiers: Array.isArray(data.priceTiers) ? data.priceTiers : [],
          wholesalePricing: Array.isArray(data.wholesalePricing) ? data.wholesalePricing : [],
          isCombo: data.isCombo === true,
          components: Array.isArray(data.components) ? data.components : [],
          isCase: data.isCase === true,
          caseProductId: data.caseProductId || null,
          unitsPerCase: data.unitsPerCase ? Number(data.unitsPerCase) : 1,
          active: data.active !== false,
          deleted: data.deleted === true,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : (data.updatedAt || data.lastUpdated || new Date().toISOString()),
          syncStatus: 'synced' 
      };
  },

  _sanitizeCloudSale(data, id) {
      let rawItems = data.items || data.cart || data.details || [];
      if (typeof rawItems === 'string') { try { rawItems = JSON.parse(rawItems); } catch (e) { rawItems = []; } }

      let finalNum = data.ticketNumber || data.invoiceNumber || data.number;

      if (!finalNum && data.afip && data.afip.cbteNumero) {
          const letra = data.afip.cbteLetra || 'FC';
          const pto = String(data.afip.ptoVta || '1').padStart(4, '0');
          const num = String(data.afip.cbteNumero).padStart(8, '0');
          finalNum = `${letra}-${pto}-${num}`;
      }

      return {
          id: id, 
          localId: data.localId || id, 
          firestoreId: id,
          branchId: data.branchId || 'main', 
          number: finalNum || null,
          ticketNumber: finalNum || null,
          invoiceNumber: finalNum || null,
          shiftId: data.shiftId || null, 
          date: data.date || new Date().toISOString(),
          total: parseFloat(data.total) || 0,
          baseAmount: parseFloat(data.baseAmount) || 0, 
          surcharge: parseFloat(data.surcharge) || 0,
          subtotal: parseFloat(data.subtotal) || 0,
          discount: parseFloat(data.discount) || 0,
          netProfit: parseFloat(data.netProfit) || 0,
          totalCost: parseFloat(data.totalCost) || 0,
          refundedAmount: parseFloat(data.refundedAmount) || 0,
          notes: data.notes || '',
          status: data.status || 'COMPLETED',
          type: data.type || 'SALE',          
          items: Array.isArray(rawItems) ? rawItems.map(item => ({
              ...item,
              price: parseFloat(item.price) || 0,
              cost: parseFloat(item.cost) || 0,
              originalPrice: parseFloat(item.originalPrice) || parseFloat(item.price) || 0,
              returnedQty: parseFloat(item.returnedQty) || 0 
          })) : [],
          itemCount: Array.isArray(rawItems) ? rawItems.length : 0, 
          payment: data.payment || { method: 'cash' },
          payments: Array.isArray(data.payments) ? data.payments : (data.payment ? [data.payment] : [{ method: 'cash' }]),
          userId: data.userId || 'unknown',
          userName: data.userName || 'Vendedor',
          client: data.client || null, 
          // 🔥 CLAVE: Preservamos el método global de la venta (SPLIT, cash, etc.)
          method: data.method || (Array.isArray(data.payments) && data.payments.length > 1 ? 'SPLIT' : (data.payment?.method || 'cash')),
          afip: data.afip ? {
              status: data.afip.status || 'PENDING',
              cae: data.afip.cae || null,
              vtoCAE: data.afip.vtoCAE || null,
              cbteTipo: data.afip.cbteTipo || null,
              cbteNumero: data.afip.cbteNumero || null,
              cbteLetra: data.afip.cbteLetra || null,
              ptoVta: data.afip.ptoVta || null,
              qr_data: data.afip.qr_data || null,
              impNeto: data.afip.impNeto || 0, 
              impIVA: data.afip.impIVA || 0    
          } : null,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : (data.updatedAt || data.date || new Date().toISOString()),
          syncStatus: 'synced'
      };
  },

  _sanitizeCloudShift(data, id) {
      const finalVal = data.finalCash !== undefined ? data.finalCash : (data.finalAmount || 0);
      const systemVal = data.expectedCash !== undefined ? data.expectedCash : (data.systemAmount || 0);
      return {
          id: id,
          localId: data.localId || id,
          userId: data.userId || 'unknown',
          userName: data.userName || 'Cajero',
          companyId: data.companyId,
          branchId: data.branchId || 'main',
          status: data.status || 'CLOSED',
          openedAt: data.openedAt || new Date().toISOString(),
          closedAt: data.closedAt || null,
          initialAmount: parseFloat(data.initialAmount) || 0,
          finalCash: parseFloat(finalVal), 
          expectedCash: parseFloat(systemVal), 
          leftInCash: parseFloat(data.leftInCash || 0), 
          difference: parseFloat(data.difference) || 0,
          expectedDigital: parseFloat(data.expectedDigital || 0),
          withdrawn: parseFloat(data.withdrawn || 0),
          audited: data.audited === true,
          auditSnapshot: data.auditSnapshot || null,
          // 🔥 Contador atómico de caja — solo lectura acá, nunca se re-sube tal
          // cual (ver exclusión en syncPendingShifts / cashRepository._syncToCloud).
          runningTotals: data.runningTotals || null,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : (data.updatedAt || new Date().toISOString()),
          syncStatus: 'synced'
      };
  },

  _sanitizeCloudCashMovement(data, id) {
      return {
          id: id,
          shiftId: data.shiftId,
          companyId: data.companyId,
          branchId: data.branchId || 'main',
          type: data.type,
          amount: parseFloat(data.amount) || 0,
          description: data.description || '',
          date: data.date || new Date().toISOString(),
          method: data.method || 'cash',
          userId: data.userId, 
          userName: data.userName,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : (data.updatedAt || new Date().toISOString()),
          syncStatus: 'synced'
      };
  },

  async processScheduledPriceChanges() {
    try {
        const localDb = await getDB();
        const todayStr = new Date().toLocaleDateString('sv-SE'); 

        const expiredProducts = await localDb.products
            .filter(p => p.priceActivationDate && p.priceActivationDate <= todayStr)
            .toArray();

        if (expiredProducts.length === 0) return;

        const updates = expiredProducts.map(p => ({
            key: p.id,
            changes: {
                price: p.nextPrice !== null ? p.nextPrice : p.price,
                cost: p.nextCost !== null ? p.nextCost : p.cost,
                nextPrice: null,
                nextCost: null,
                priceActivationDate: null,
                updatedAt: new Date().toISOString(),
                syncStatus: 'pending' 
            }
        }));

        await localDb.products.bulkUpdate(updates);
        
        const companyId = this._getCompanyId();
        if (companyId) {
            this.syncPendingProducts(companyId, this._getActiveBranchId());
        }
    } catch (e) {
        console.error("❌ Error en el motor de precios programados:", e);
    }
  },

  async syncConfig(companyId) {
      if (!companyId) return;
      try {
          const localDb = await getDB();
          const configRef = collection(db, 'companies', companyId, 'config');
          const snap = await getDocs(configRef);
          
          if (!snap.empty) {
              const configItems = snap.docs.map(doc => {
                  const data = doc.data();
                  const valueToSave = data.value !== undefined ? data.value : data;
                  return { key: doc.id, value: valueToSave, updatedAt: new Date().toISOString() };
              });
              await localDb.config.bulkPut(configItems);
          }
      } catch (error) {}
  },

  // 🔥 OPTIMIZADO: Sincronización Delta de Maestros (Clientes, Catálogos, etc.)
  async syncInitialMasters(companyId) {
      if (!companyId) return;
      try {
          const localDb = await getDB();
          const masterCollections = ['categories', 'brands', 'suppliers', 'clients'];
          
          for (const collectionName of masterCollections) {
              const table = localDb.table(collectionName);
              
              // 1. Buscamos el último registro sincronizado localmente
              const lastLocal = await table.orderBy('updatedAt').last();
              const lastSyncDate = lastLocal ? new Date(lastLocal.updatedAt) : new Date(0);
              
              // 2. Pedimos solo lo que se actualizó DESPUÉS de nuestro último dato
              // 🔥 FIX DEFINITIVO: Usar Firebase Timestamp para todas las queries Delta
              const safetyMarginDate = new Date(lastSyncDate.getTime() - (60 * 1000));
              const firestoreSafetyMargin = Timestamp.fromDate(safetyMarginDate);
              
              const colRef = collection(db, 'companies', companyId, collectionName);
              const q = query(colRef, where('updatedAt', '>', firestoreSafetyMargin));
              
              const snapshot = await getDocs(q);
              
              if (!snapshot.empty) {
                  const itemsToPut = snapshot.docs.map(docSnap => {
                      const data = docSnap.data();
                      return { 
                          ...data, 
                          id: docSnap.id, 
                          firestoreId: docSnap.id,
                          syncStatus: 'synced',
                          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : (data.updatedAt || new Date().toISOString())
                      };
                  });
                  await table.bulkPut(itemsToPut);
                  console.log(`☁️ [Sync] ${itemsToPut.length} ${collectionName} actualizados.`);
              }
          }
      } catch (error) {
          if (error.code === 'failed-precondition') {
              console.warn("⚠️ [Sync Masters] Falta índice compuesto. El sistema usará caché local.");
          } else {
              console.warn("Error en Delta Sync de Maestros:", error);
          }
      }
  },

  async syncProducts(companyId) {
    if (!companyId) return;
    if (this._isSyncingProducts) return;
    
    this._isSyncingProducts = true;
    try {
        const localDb = await getDB();
        const isFirstTime = !(await localDb.config.get('products_full_synced'));
        const lastLocal = await localDb.products.orderBy('updatedAt').last();
        let lastSyncDate = new Date(0);
        
        if (lastLocal?.updatedAt && !isFirstTime) {
            lastSyncDate = new Date(lastLocal.updatedAt);
            if (isNaN(lastSyncDate.getTime())) lastSyncDate = new Date(0);
        }

        // 🔥 FIX DEFINITIVO: Firestore guarda updatedAt como un objeto Timestamp.
        // Compararlo con un String ISO (safetyMargin) SIEMPRE devuelve 0 resultados.
        // Debemos convertir la fecha local de vuelta a un Firebase Timestamp para la consulta.
        const safetyMarginDate = new Date(lastSyncDate.getTime() - (60 * 1000));
        const firestoreSafetyMargin = Timestamp.fromDate(safetyMarginDate);
        
        console.log(`🔍 [Sync-Audit] Delta Sync Productos desde firestoreSafetyMargin:`, safetyMarginDate.toISOString());

        const productsRef = collection(db, 'companies', companyId, 'products');
        let q = query(productsRef, where('updatedAt', '>', firestoreSafetyMargin));
        
        if (isFirstTime) {
            console.log("🚀 [Sync] Primer Sincronización: Descargando catálogo completo...");
            q = query(productsRef);
        }

        const snapshot = await getDocs(q);
        console.log(`🔍 [Sync-Audit] Firestore devolvió ${snapshot.size} productos nuevos/cambiados.`);

        if (!snapshot.empty) {
            const allDocs = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));

            // 🛡️ Nunca sobreescribir productos con cambios locales pendientes de subir
            const pendingSet = new Set(
                (await localDb.products.where('syncStatus').equals('pending').toArray()).map(p => p.id)
            );

            const toDelete = allDocs.filter(d => d.data.deleted === true && !pendingSet.has(d.id)).map(d => d.id);
            const toUpsert = allDocs
                .filter(d => d.data.deleted !== true && !pendingSet.has(d.id))
                .map(d => this._sanitizeCloudProduct(d.data, d.id));

            if (toDelete.length > 0) await localDb.products.bulkDelete(toDelete);

            if (toUpsert.length > 0) {
                await localDb.products.bulkPut(toUpsert);
                console.log(`✅ [Sync-Audit] ${toUpsert.length} productos guardados con éxito.`);
                window.dispatchEvent(new CustomEvent('onProductsSynced'));
            }
            
            if (isFirstTime) {
                await localDb.config.put({ key: 'products_full_synced', value: true, updatedAt: new Date().toISOString() });
            }
        }

        await this.processScheduledPriceChanges();
    } catch (error) {
        console.error("❌ [Sync-Audit] Falló la sincronización de productos:", error);
    } finally {
        this._isSyncingProducts = false;
    }
  },

  async syncAllInventoryForOwner(companyId, branches) {
      if (!companyId || !branches || branches.length === 0) return;
      await Promise.all(branches.map(branch => this.syncInitialInventory(companyId, branch.id)));
  },

  async syncInitialInventory(companyId, branchId) {
      if (!companyId || !branchId) return;
      const localDb = await getDB();
      
      const lastLocal = await localDb.inventory.where('branchId').equals(branchId).sortBy('updatedAt');
      const lastItem = lastLocal.length > 0 ? lastLocal[lastLocal.length - 1] : null;
      const rawDate = lastItem ? new Date(lastItem.updatedAt) : new Date(0);
      // Guard: si updatedAt es null/inválido en Dexie, caemos a epoch para bajar todo
      const lastSyncDate = isNaN(rawDate.getTime()) ? new Date(0) : rawDate;

      const invRef = collection(db, 'companies', companyId, 'branches', branchId, 'inventory');

      const safetyMarginDate = new Date(lastSyncDate.getTime() - (60 * 1000));
      const firestoreSafetyMargin = Timestamp.fromDate(safetyMarginDate);
      let q = query(invRef, where('updatedAt', '>', firestoreSafetyMargin));
      
      try {
          const snapshot = await getDocs(q);
          if (snapshot.empty) return;

          const inventoryItems = snapshot.docs.map(doc => {
              const d = doc.data();
              return {
                  branchId,
                  productId: doc.id,
                  stock: parseFloat(d.stock) || 0,
                  promo: d.promo || null,
                  updatedAt: d.updatedAt ? (d.updatedAt.toDate ? d.updatedAt.toDate().toISOString() : d.updatedAt) : new Date().toISOString(),
                  syncStatus: 'synced'
              };
          });
          if (inventoryItems.length > 0) {
              // Nunca sobreescribir registros con ventas pendientes de subir
              const pendingSet = new Set(
                  (await localDb.inventory.where('syncStatus').equals('pending').toArray())
                      .map(i => `${i.branchId}_${i.productId}`)
              );
              const safeItems = inventoryItems.filter(i => !pendingSet.has(`${i.branchId}_${i.productId}`));
              if (safeItems.length > 0) await localDb.inventory.bulkPut(safeItems);
          }
      } catch (e) {
          if (e.code === 'failed-precondition') {
               const fullSnap = await getDocs(collection(db, 'companies', companyId, 'branches', branchId, 'inventory'));
               const allItems = fullSnap.docs.map(doc => ({
                  branchId,
                  productId: doc.id,
                  stock: parseFloat(doc.data().stock) || 0,
                  promo: doc.data().promo || null,
                  updatedAt: new Date().toISOString(),
                  syncStatus: 'synced'
               }));
               // Nunca sobreescribir registros con ventas pendientes de subir
               const pendingSet = new Set(
                   (await localDb.inventory.where('syncStatus').equals('pending').toArray())
                       .map(i => `${i.branchId}_${i.productId}`)
               );
               const safeAll = allItems.filter(i => !pendingSet.has(`${i.branchId}_${i.productId}`));
               if (safeAll.length > 0) await localDb.inventory.bulkPut(safeAll);
          }
      }
  },

   async syncInitialMovements(companyId, branchId, role) {
      if (!companyId) return;
      const localDb = await getDB();
      
      // 🔥 ESTRATEGIA DE BLINDAJE: Si la base está vacía, solo bajamos las últimas 48hs
      // para no colgar el sistema con miles de movimientos históricos.
      const count = await localDb.movements.count();
      let lastSyncDate;
      
      if (count === 0) {
          console.log("📦 [Kardex] Base limpia. Bajando solo últimas 48hs por performance.");
          lastSyncDate = new Date();
          lastSyncDate.setHours(lastSyncDate.getHours() - 48);
      } else {
          const lastLocal = await localDb.movements.orderBy('updatedAt').last();
          lastSyncDate = lastLocal ? new Date(lastLocal.updatedAt) : new Date(0);
      }
      
      const safetyMarginDate = new Date(lastSyncDate.getTime() - (60 * 1000));
      const firestoreSafetyMargin = Timestamp.fromDate(safetyMarginDate);
      const movRef = collection(db, 'companies', companyId, 'movements');
      let q = query(movRef, where('updatedAt', '>', firestoreSafetyMargin));

      if (role !== 'OWNER' || branchId !== 'ALL') {
          q = query(movRef, where('branchId', '==', branchId), where('updatedAt', '>', firestoreSafetyMargin));
      }

      try {
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
              const pendingIds = await localDb.movements.where('syncStatus').equals('pending').primaryKeys();
              const pendingSet = new Set(pendingIds);
              
              const movsToPut = snapshot.docs
                  .filter(docSnap => !pendingSet.has(docSnap.id))
                  .map(docSnap => {
                      const d = docSnap.data();
                      return {
                          id: docSnap.id,
                          firestoreId: docSnap.id,
                          productId: d.productId || 'unknown',
                          branchId: d.branchId || 'main',
                          type: d.type || 'INFO',
                          amount: parseFloat(d.amount) || 0,
                          description: d.description || '',
                          date: d.date || new Date().toISOString(),
                          user: d.user || 'Sistema',
                          refId: d.refId || null,
                          updatedAt: d.updatedAt || new Date().toISOString(),
                          syncStatus: 'synced'
                      };
                  });

              if (movsToPut.length > 0) await localDb.movements.bulkPut(movsToPut);
          }
      } catch (error) {
          if (error.code === 'failed-precondition') {
              console.warn("⚠️ [Kardex] Falta índice compuesto en Firestore. El sistema funcionará con carga local hasta que se compile el índice.");
          } else {
              console.warn("Kardex sync warning:", error);
          }
      }
  },

  async syncInitialSales(companyId, branchId, role) {
      if (!companyId) return;
      try {
          const localDb = await getDB();
          const keySuffix = (role === 'OWNER' && (!branchId || branchId === 'ALL')) ? 'GLOBAL' : branchId;
          const SYNC_KEY = `noar_sales_sync_${keySuffix}`;
          const lastSyncStr = localStorage.getItem(SYNC_KEY);
          const countLocal = await localDb.sales.count();

          const salesRef = collection(db, 'companies', companyId, 'sales');
          let q;

          if (lastSyncStr && countLocal > 0) {
              // Delta: solo lo nuevo desde el último sync
              const safetyMargin = new Date(new Date(lastSyncStr).getTime() - 60 * 1000);
              const firestoreMargin = Timestamp.fromDate(safetyMargin);
              q = (role !== 'OWNER' || branchId !== 'ALL')
                  ? query(salesRef, where('branchId', '==', branchId), where('updatedAt', '>', firestoreMargin))
                  : query(salesRef, where('updatedAt', '>', firestoreMargin));
          } else {
              // Full sync inicial: últimos 30 días
              const margin30 = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
              q = (role !== 'OWNER' || branchId !== 'ALL')
                  ? query(salesRef, where('branchId', '==', branchId), where('updatedAt', '>', margin30))
                  : query(salesRef, where('updatedAt', '>', margin30));
          }

          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
              const pendingSet = new Set(
                  (await localDb.sales.where('syncStatus').equals('pending').toArray()).map(s => s.id)
              );
              const salesToPut = snapshot.docs
                  .filter(docSnap => !pendingSet.has(docSnap.id))
                  .map(docSnap => this._sanitizeCloudSale(docSnap.data(), docSnap.id));
              if (salesToPut.length > 0) {
                  await localDb.sales.bulkPut(salesToPut);
                  window.dispatchEvent(new CustomEvent('noar:sales-synced'));
              }
          }

          localStorage.setItem(SYNC_KEY, new Date().toISOString());
      } catch (error) {
          console.warn('syncInitialSales error:', error);
      }
  },

  async syncInitialPurchases(companyId, branchId, role) {
      if (!companyId) return;
      try {
          const localDb = await getDB();
          const keySuffix = (role === 'OWNER' && (!branchId || branchId === 'ALL')) ? 'GLOBAL' : branchId;
          const lastSyncKey = SYNC_KEYS.PURCHASES_PREFIX + keySuffix;
          const lastSyncStr = localStorage.getItem(lastSyncKey);
          const countLocal = await localDb.purchases.count(); 
          
          const colRef = collection(db, 'companies', companyId, 'purchases');
          let q;

          if (lastSyncStr && countLocal > 0) {
              const lastSyncDate = new Date(lastSyncStr);
              const safetyMarginDate = new Date(lastSyncDate.getTime() - (60 * 1000));
              const firestoreSafetyMargin = Timestamp.fromDate(safetyMarginDate);
              
              if (role === 'OWNER' && (!branchId || branchId === 'ALL')) {
                  q = query(colRef, where('updatedAt', '>', firestoreSafetyMargin));
              } else {
                  q = query(colRef, where('branchId', '==', branchId), where('updatedAt', '>', firestoreSafetyMargin));
              }
          } else {
              if (role === 'OWNER' && (!branchId || branchId === 'ALL')) {
                  q = query(colRef, orderBy('date', 'desc'), limit(1000));
              } else {
                  q = query(colRef, where('branchId', '==', branchId), orderBy('date', 'desc'), limit(1000));
              }
          }

          const snapshot = await getDocs(q);
          
          if (!snapshot.empty) {
              const pendingIds = await localDb.purchases.where('syncStatus').equals('pending').primaryKeys();
              const pendingSet = new Set(pendingIds);
              
              const itemsToPut = [];
              snapshot.docs.forEach(docSnap => {
                  if (!pendingSet.has(docSnap.id)) {
                      itemsToPut.push({ ...docSnap.data(), id: docSnap.id, firestoreId: docSnap.id, syncStatus: 'synced' });
                  }
              });

              if (itemsToPut.length > 0) {
                  await localDb.purchases.bulkPut(itemsToPut);
              }
          }
          localStorage.setItem(lastSyncKey, new Date().toISOString());

      } catch (error) {
          console.warn("Error bajando purchases iniciales:", error);
      }
  },

  async syncInitialCustomerLedger(companyId) {
      if (!companyId) return;
      try {
          const localDb = await getDB();
          const lastSyncKey = SYNC_KEYS.CUSTOMER_LEDGER;
          const lastSyncStr = localStorage.getItem(lastSyncKey);
          const countLocal = await localDb.customer_ledger.count(); 
          
          const ledgerRef = collection(db, 'companies', companyId, 'customer_ledger');
          let q;

          if (lastSyncStr && countLocal > 0) {
              const lastSyncDate = new Date(lastSyncStr);
              // 🔥 FIX DEFINITIVO: Uso de Firebase Timestamp
              const safetyMarginDate = new Date(lastSyncDate.getTime() - (60 * 1000));
              const firestoreSafetyMargin = Timestamp.fromDate(safetyMarginDate);
              q = query(ledgerRef, where('updatedAt', '>', firestoreSafetyMargin));
          } else {
              q = query(ledgerRef, orderBy('date', 'desc'), limit(1000)); 
          }

          const snapshot = await getDocs(q);
          
          if (!snapshot.empty) {
              const pendingIds = await localDb.customer_ledger.where('syncStatus').equals('pending').primaryKeys();
              const pendingSet = new Set(pendingIds);
              
              const ledgerToPut = [];
              snapshot.docs.forEach(docSnap => {
                  if (!pendingSet.has(docSnap.id)) {
                      const d = docSnap.data();
                      ledgerToPut.push({
                          id: docSnap.id,
                          firestoreId: docSnap.id,
                          clientId: d.clientId,
                          date: d.date || new Date().toISOString(),
                          type: d.type,
                          amount: parseFloat(d.amount) || 0,
                          oldBalance: parseFloat(d.oldBalance) || 0,
                          newBalance: parseFloat(d.newBalance) || 0,
                          description: d.description || '',
                          referenceId: d.referenceId || null,
                          branchId: d.branchId || 'main',
                          userId: d.userId || 'unknown',
                          updatedAt: d.updatedAt || new Date().toISOString(),
                          syncStatus: 'synced'
                      });
                  }
              });

              if (ledgerToPut.length > 0) {
                  await localDb.customer_ledger.bulkPut(ledgerToPut);
              }
          }
          localStorage.setItem(lastSyncKey, new Date().toISOString());
      } catch (error) {
          console.warn("Error bajando customer_ledger:", error);
      }
  },

  async syncInitialClients(companyId) {
      if (!companyId) return;
      try {
          const localDb = await getDB();
          const lastSyncStr = localStorage.getItem('noar_last_sync_clients');
          const countLocal = await localDb.clients.count();

          const clientsRef = collection(db, 'companies', companyId, 'clients');
          let q;

          if (lastSyncStr && countLocal > 0) {
              const safetyDate = new Date(new Date(lastSyncStr).getTime() - 60000);
              q = query(clientsRef, where('updatedAt', '>', Timestamp.fromDate(safetyDate)));
          } else {
              q = query(clientsRef, orderBy('updatedAt', 'desc'), limit(2000));
          }

          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
              const pendingSet = new Set(
                  (await localDb.clients.where('syncStatus').equals('pending').toArray())
                      .map(c => String(c.id))
              );
              const toPut = snapshot.docs
                  .filter(d => !pendingSet.has(d.id))
                  .map(d => ({ ...d.data(), id: d.id, firestoreId: d.id, syncStatus: 'synced' }));
              if (toPut.length > 0) await localDb.clients.bulkPut(toPut);
          }
          localStorage.setItem('noar_last_sync_clients', new Date().toISOString());
      } catch (error) {
          console.warn('Error syncInitialClients:', error);
      }
  },

  async syncInitialSuppliers(companyId) {
      if (!companyId) return;
      try {
          const localDb = await getDB();
          const lastSyncStr = localStorage.getItem('noar_last_sync_suppliers');
          const countLocal = await localDb.suppliers.count();

          const suppliersRef = collection(db, 'companies', companyId, 'suppliers');
          let q;

          if (lastSyncStr && countLocal > 0) {
              const safetyDate = new Date(new Date(lastSyncStr).getTime() - 60000);
              q = query(suppliersRef, where('updatedAt', '>', Timestamp.fromDate(safetyDate)));
          } else {
              q = query(suppliersRef, orderBy('updatedAt', 'desc'), limit(2000));
          }

          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
              const pendingSet = new Set(
                  (await localDb.suppliers.where('syncStatus').equals('pending').toArray())
                      .map(s => String(s.id))
              );
              const toPut = snapshot.docs
                  .filter(d => !pendingSet.has(d.id))
                  .map(d => ({ ...d.data(), id: d.id, firestoreId: d.id, syncStatus: 'synced' }));
              if (toPut.length > 0) await localDb.suppliers.bulkPut(toPut);
          }
          localStorage.setItem('noar_last_sync_suppliers', new Date().toISOString());
      } catch (error) {
          console.warn('Error syncInitialSuppliers:', error);
      }
  },

  async syncInitialSupplierLedger(companyId) {
      if (!companyId) return;
      try {
          const localDb = await getDB();
          const lastSyncKey = SYNC_KEYS.SUPPLIER_LEDGER;
          const lastSyncStr = localStorage.getItem(lastSyncKey);
          const countLocal = await localDb.supplier_ledger.count(); 
          
          const ledgerRef = collection(db, 'companies', companyId, 'supplier_ledger');
          let q;

          if (lastSyncStr && countLocal > 0) {
              const lastSyncDate = new Date(lastSyncStr);
              // 🔥 FIX DEFINITIVO: Uso de Firebase Timestamp
              const safetyMarginDate = new Date(lastSyncDate.getTime() - (60 * 1000));
              const firestoreSafetyMargin = Timestamp.fromDate(safetyMarginDate);
              q = query(ledgerRef, where('updatedAt', '>', firestoreSafetyMargin));
          } else {
              q = query(ledgerRef, orderBy('date', 'desc'), limit(1000)); 
          }

          const snapshot = await getDocs(q);
          
          if (!snapshot.empty) {
              const pendingIds = await localDb.supplier_ledger.where('syncStatus').equals('pending').primaryKeys();
              const pendingSet = new Set(pendingIds);
              
              const ledgerToPut = [];
              snapshot.docs.forEach(docSnap => {
                  if (!pendingSet.has(docSnap.id)) {
                      const d = docSnap.data();
                      ledgerToPut.push({
                          ...d,
                          id: docSnap.id,
                          firestoreId: docSnap.id,
                          syncStatus: 'synced'
                      });
                  }
              });

              if (ledgerToPut.length > 0) {
                  await localDb.supplier_ledger.bulkPut(ledgerToPut);
              }
          }
          localStorage.setItem(lastSyncKey, new Date().toISOString());
      } catch (error) {
          console.warn("Error bajando supplier_ledger:", error);
      }
  },

  async syncInitialData(user, activeBranchId) {
      if (!user?.companyId || user.companyId === 'master_admin' || user.superAdmin) return;
      
      // 🔥 BLOQUEO DE CONCURRENCIA: Evitar que 8 llamadas simultáneas rompan la base de datos
      if (this._isSyncingData) {
          console.log("🔍 [Sync-Audit] syncInitialData ya en curso. Ignorando llamada duplicada.");
          return;
      }

      this._isSyncingData = true;
      try {
          console.log("🔍 [Sync-Audit] Iniciando Sincronización Delta...");
          await this.syncConfig(user.companyId);
          await this.syncInitialMasters(user.companyId); 
          await this.syncProducts(user.companyId);
          await this.syncInitialInventory(user.companyId, activeBranchId);
          // ... otros syncs ...
      } finally {
          this._isSyncingData = false;
      }
      await this.syncInitialSales(user.companyId, activeBranchId, user.role);
      await this.syncInitialMovements(user.companyId, activeBranchId, user.role);
      await this.syncInitialShifts(user.companyId, activeBranchId, user.role);
      await this.syncInitialCashMovements(user.companyId, activeBranchId);
      
      await this.syncInitialCustomerLedger(user.companyId);
      await this.syncInitialClients(user.companyId);
      await this.syncInitialSuppliers(user.companyId);

      await this.syncInitialPurchases(user.companyId, activeBranchId, user.role);
      await this.syncInitialSupplierLedger(user.companyId);

      if (user.role === 'OWNER') {
          const dbLocal = await getDB();
          let branches = await dbLocal.branches.toArray();
          
          if (branches.length === 0 && navigator.onLine) {
             const bSnap = await getDocs(collection(db, 'companies', user.companyId, 'branches'));
             branches = bSnap.docs.map(d => ({id: d.id, ...d.data()}));
             await dbLocal.branches.bulkPut(branches);
          }
          if (branches.length > 0) {
              await this.syncAllInventoryForOwner(user.companyId, branches);
          }
      } else if (activeBranchId && activeBranchId !== 'ALL') {
          await this.syncInitialInventory(user.companyId, activeBranchId);
      }
  },

  async startInventoryListener(companyId, branchId) {
    if (!companyId || !branchId) return;

    await this.syncInitialInventory(companyId, branchId);

    const q = collection(db, 'companies', companyId, 'branches', branchId, 'inventory');
    
    return onSnapshot(q, async (snapshot) => {
        if (snapshot.empty) return;
        const localDb = await getDB();
        
        const changes = snapshot.docChanges()
            .filter(c => c.type === 'added' || c.type === 'modified')
            .map(change => {
                const data = change.doc.data();
                return {
                    branchId,
                    productId: change.doc.id,
                    stock: parseFloat(data.stock) || 0,
                    promo: data.promo || null,
                    updatedAt: new Date().toISOString(),
                    syncStatus: 'synced'
                };
            });

        if (changes.length > 0) {
            await localDb.inventory.bulkPut(changes);
        }
    });
  },

  async fetchMovementsByRange(companyId, branchId, startDate, endDate) {
      if (!companyId || !navigator.onLine) return;
      try {
        const localDb = await getDB();
        const movRef = collection(db, 'companies', companyId, 'movements');
        let q;
        
        if (branchId && branchId !== 'ALL') {
            q = query(movRef, 
                where('branchId', '==', branchId), 
                where('date', '>=', startDate.toISOString()),
                where('date', '<=', endDate.toISOString()),
                limit(1000)
            );
        } else {
            q = query(movRef, 
                where('date', '>=', startDate.toISOString()),
                where('date', '<=', endDate.toISOString()),
                limit(1000)
            );
        }

        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            const movs = snapshot.docs.map(doc => ({ id: doc.id, firestoreId: doc.id, ...doc.data(), syncStatus: 'synced' }));
            await localDb.movements.bulkPut(movs);
            return movs.length;
        }
        return 0;
      } catch (error) {
          console.error("Error al bajar histórico de kardex:", error);
          throw error;
      }
  },

  async startMovementsListener(companyId, branchId, role) {
      if (!companyId) return null;
      const movRef = collection(db, 'companies', companyId, 'movements');
      let q;
      
      if (role === 'OWNER' && (!branchId || branchId === 'ALL')) {
          q = query(movRef, orderBy('updatedAt', 'desc'), limit(30));
      } else if (branchId) {
          q = query(movRef, where('branchId', '==', branchId), orderBy('updatedAt', 'desc'), limit(30));
      }

      if (!q) return null;

      return onSnapshot(q, async (snapshot) => {
          const localDb = await getDB();
          const itemsToPut = [];
          
          snapshot.docChanges().forEach(change => {
              if (change.type === 'added' || change.type === 'modified') {
                  const data = change.doc.data();
                  itemsToPut.push({ id: change.doc.id, firestoreId: change.doc.id, ...data, syncStatus: 'synced' });
              }
          });

          if (itemsToPut.length > 0) {
              await localDb.movements.bulkPut(itemsToPut);
          }
      });
  },

  startRealTimeListeners(companyIdArg = null) {
    // Debounce: App.jsx+StrictMode+SubscriptionGuard disparan 4 llamadas en <50ms.
    // Cada una mataba a la anterior via _listenerSessionId. Con 300ms absorbemos
    // todas las llamadas rápidas y ejecutamos UNA sola vez cuando se estabiliza.
    if (this._startListenersTimer) {
        clearTimeout(this._startListenersTimer);
    }
    this._startListenersTimer = setTimeout(() => {
        this._startListenersTimer = null;
        this._doStartRealTimeListeners(companyIdArg);
    }, 300);
  },

  async _doStartRealTimeListeners(companyIdArg = null) {
    const { user, activeBranchId: currentBranchId } = useAuthStore.getState();
    const companyId = companyIdArg || this._getCompanyId();
    const activeBranchId = currentBranchId || this._getActiveBranchId();

    // 1. Evitamos reinicios innecesarios si ya estamos escuchando lo mismo
    if (this._unsubscribes.length > 0 && this._lastSyncContext === `${companyId}_${activeBranchId}`) {
        return;
    }

    this.stopListeners();
    this._listenerSessionId = Date.now();
    const sessionId = this._listenerSessionId;
    this._lastSyncContext = `${companyId}_${activeBranchId}`;

    // Solo bloqueamos si es superAdmin SIN empresa asignada (admin del sistema puro)
    if (user?.companyId === 'master_admin' || !companyId) return;

    await this.checkTenantIntegrity(companyId);
    if (sessionId !== this._listenerSessionId) return;

    // 🔥 PUSH/PULL INICIAL (Background)
    this.syncInitialData(user, activeBranchId).catch(e => console.warn("Sync inicial falló:", e));

    // 🔥 LISTENER DE INVENTARIO (STOCK REAL-TIME POR SUCURSAL)
    if (activeBranchId && activeBranchId !== 'ALL') {
        try {
            const invUnsub = await this.startInventoryListener(companyId, activeBranchId);
            if (invUnsub) this._unsubscribes.push(invUnsub);
        } catch (e) {
            console.error('startInventoryListener falló:', e);
        }
    }

    // 🔥 LISTENER DE CONFIGURACIÓN
    const configQuery = query(collection(db, 'companies', companyId, 'config'));
    this._unsubscribes.push(this._safeOnSnapshot(configQuery, async (snapshot) => {
        try {
            const localDb = await getDB();
            for (const change of snapshot.docChanges()) {
                const data = change.doc.data();
                if (change.type === 'added' || change.type === 'modified') {
                    const configId = change.doc.id;
                    const configValue = data.value !== undefined ? data.value : data;
                    await localDb.config.put({
                        key: configId,
                        value: configValue,
                        updatedAt: new Date().toISOString()
                    });
                    window.dispatchEvent(new CustomEvent('noar:config-synced'));
                }
            }
        } catch (e) {}
    }));

    // 🔥 LISTENER DE PRODUCTOS (TIEMPO REAL)
    // Usamos where('updatedAt', '>=', Timestamp) para evitar el problema de tipos mixtos:
    // docs con updatedAt string ordenan ANTES que Timestamps en Firestore DESC,
    // por lo que limit(N) los excluía silenciosamente. El where filtra SOLO Timestamps.
    const liveStartTime = new Date(Date.now() - 60000); // 1 min de superposición
    const productsRecentQ = query(
        collection(db, 'companies', companyId, 'products'),
        where('updatedAt', '>=', Timestamp.fromDate(liveStartTime))
    );
    this._unsubscribes.push(onSnapshot(productsRecentQ, async (snapshot) => {
        const localDb = await getDB();
        const itemsToPut = [];

        // 🛡️ Nunca sobreescribir productos con cambios locales pendientes de subir
        const pendingSet = new Set(
            (await localDb.products.where('syncStatus').equals('pending').toArray()).map(p => p.id)
        );

        snapshot.docChanges().forEach(change => {
            if (change.type === 'added' || change.type === 'modified') {
                if (change.doc.metadata.hasPendingWrites) return;
                if (pendingSet.has(change.doc.id)) return;
                const data = change.doc.data();
                const sanitized = this._sanitizeCloudProduct(data, change.doc.id);
                itemsToPut.push(sanitized);
            }
        });

        if (itemsToPut.length > 0) {
            await localDb.products.bulkPut(itemsToPut);
            console.log(`✅ [Real-Time] ${itemsToPut.length} productos escritos en Dexie. Disparando recarga...`);
            window.dispatchEvent(new CustomEvent('onProductsSynced'));
        }
    }, (error) => {
        console.error("❌ [Real-Time] Error en Listener de Productos:", error);
    }));

    try {
        let salesQuery;
        const salesRef = collection(db, 'companies', companyId, 'sales');

        if (user?.role === 'OWNER' && (!activeBranchId || activeBranchId === 'ALL')) {
            salesQuery = query(salesRef, orderBy('date', 'desc'), limit(30));
        } else if (activeBranchId) {
            salesQuery = query(salesRef, where('branchId', '==', activeBranchId), orderBy('date', 'desc'), limit(30));
        }

        if (salesQuery) {
            this._unsubscribes.push(this._safeOnSnapshot(salesQuery, async (snapshot) => {
                const localDb = await getDB();
                const pendingIds = await localDb.sales.filter(s => s.syncStatus !== 'synced').primaryKeys();
                const pendingSet = new Set(pendingIds);
                const salesToPut = [];
                
                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added' || change.type === 'modified') {
                        const cloudData = change.doc.data();
                        const isPendingLocally = pendingSet.has(change.doc.id);
                        
                        const hasAfipData = cloudData.afip && (cloudData.afip.status === 'APPROVED' || cloudData.afip.cae);
                        const hasFinalNumber = cloudData.number || cloudData.ticketNumber;

                        if (!isPendingLocally || hasAfipData || hasFinalNumber) {
                            salesToPut.push(this._sanitizeCloudSale(cloudData, change.doc.id));
                        }
                    }
                });
                
                if (salesToPut.length > 0) {
                    await localDb.sales.bulkPut(salesToPut);
                    window.dispatchEvent(new CustomEvent('noar:sales-synced'));
                }
            }));
        }

        // 🔥 LISTENER DE MOVIMIENTOS (KARDEX REAL-TIME)
        const movUnsub = await this.startMovementsListener(companyId, activeBranchId, user?.role);
        if (movUnsub) this._unsubscribes.push(movUnsub);

    } catch (e) { }

    try {
        let purchQuery;
        const purchRef = collection(db, 'companies', companyId, 'purchases');

        if (user?.role === 'OWNER' && (!activeBranchId || activeBranchId === 'ALL')) {
            purchQuery = query(purchRef, orderBy('date', 'desc'), limit(30));
        } else if (activeBranchId) {
            purchQuery = query(purchRef, where('branchId', '==', activeBranchId), orderBy('date', 'desc'), limit(30));
        }

        if (purchQuery) {
            this._unsubscribes.push(this._safeOnSnapshot(purchQuery, async (snapshot) => {
                const localDb = await getDB();
                const pendingIds = await localDb.purchases.filter(p => p.syncStatus !== 'synced').primaryKeys();
                const pendingSet = new Set(pendingIds);
                const itemsToPut = [];
                
                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added' || change.type === 'modified') {
                        if (!pendingSet.has(change.doc.id)) {
                            itemsToPut.push({ ...change.doc.data(), id: change.doc.id, syncStatus: 'synced' });
                        }
                    }
                });
                
                if (itemsToPut.length > 0) {
                    await localDb.purchases.bulkPut(itemsToPut);
                }
            }));
        }
    } catch (e) { }

    const masterCollections = ['categories', 'brands', 'clients', 'suppliers'];
    const mastersLiveStart = new Date(Date.now() - 60000);
    masterCollections.forEach(collectionName => {
        const q = query(
            collection(db, 'companies', companyId, collectionName),
            where('updatedAt', '>=', Timestamp.fromDate(mastersLiveStart))
        );
        this._unsubscribes.push(this._safeOnSnapshot(q, async (snapshot) => {
            const itemsToPut = [];
            const idsToDelete = [];
            snapshot.docChanges().forEach(change => {
                if (change.type === 'removed') { idsToDelete.push(change.doc.id); } 
                else if (change.type === 'added' || change.type === 'modified') {
                    const cleanData = this._deepSanitize(change.doc.data());
                    itemsToPut.push({ id: change.doc.id, ...cleanData, syncStatus: 'synced' });
                }
            });
            const localDb = await getDB();
            if (idsToDelete.length > 0) try { await localDb.table(collectionName).bulkDelete(idsToDelete); } catch(e){}
            if (itemsToPut.length > 0) try { await localDb.table(collectionName).bulkPut(itemsToPut); } catch(e){}
        }));
    });

    // 🔥 LISTENER DE SHIFTS (TIEMPO REAL — FILTRADO POR SUCURSAL)
    try {
        const liveStartShifts = new Date(Date.now() - 60_000);
        let shiftsQ;
        if (user?.role === 'OWNER' && (!activeBranchId || activeBranchId === 'ALL')) {
            shiftsQ = query(
                collection(db, 'companies', companyId, 'shifts'),
                where('updatedAt', '>=', Timestamp.fromDate(liveStartShifts))
            );
        } else if (activeBranchId) {
            shiftsQ = query(
                collection(db, 'companies', companyId, 'shifts'),
                where('branchId', '==', activeBranchId),
                where('updatedAt', '>=', Timestamp.fromDate(liveStartShifts))
            );
        }
        if (shiftsQ) {
            this._unsubscribes.push(this._safeOnSnapshot(shiftsQ, async (snapshot) => {
                const localDb = await getDB();
                const pendingIds = await localDb.shifts.filter(s => s.syncStatus !== 'synced').primaryKeys();
                const pendingSet = new Set(pendingIds);
                const toPut = [];
                snapshot.docChanges().forEach(change => {
                    if ((change.type === 'added' || change.type === 'modified') && !pendingSet.has(change.doc.id)) {
                        toPut.push(this._sanitizeCloudShift(change.doc.data(), change.doc.id));
                    }
                });
                if (toPut.length > 0) {
                    await localDb.shifts.bulkPut(toPut);
                    window.dispatchEvent(new CustomEvent('noar:shifts-synced'));
                }
            }));
        }
    } catch (e) { console.warn("Error en listener de shifts:", e); }

    // 🔥 LISTENER DE CASH MOVEMENTS (TIEMPO REAL — FILTRADO POR SUCURSAL)
    try {
        if (activeBranchId && activeBranchId !== 'ALL') {
            const liveStartMovs = new Date(Date.now() - 60_000);
            const movsQ = query(
                collection(db, 'companies', companyId, 'cash_movements'),
                where('branchId', '==', activeBranchId),
                where('date', '>=', Timestamp.fromDate(liveStartMovs))
            );
            this._unsubscribes.push(this._safeOnSnapshot(movsQ, async (snapshot) => {
                const localDb = await getDB();
                const pendingIds = await localDb.cash_movements.filter(m => m.syncStatus !== 'synced').primaryKeys();
                const pendingSet = new Set(pendingIds);
                const toPut = [];
                snapshot.docChanges().forEach(change => {
                    if ((change.type === 'added' || change.type === 'modified') && !pendingSet.has(change.doc.id)) {
                        toPut.push(this._sanitizeCloudCashMovement(change.doc.data(), change.doc.id));
                    }
                });
                if (toPut.length > 0) {
                    await localDb.cash_movements.bulkPut(toPut);
                    window.dispatchEvent(new CustomEvent('noar:cash-movements-synced'));
                }
            }));
        }
    } catch (e) { console.warn("Error en listener de cash_movements:", e); }

    // 🔥 AUTO-SYNC + RESTART LISTENERS AL VOLVER A ESTAR ONLINE
    if (typeof window !== 'undefined' && !window._noar_online_init) {
        window.addEventListener('online', () => {
            console.log("🌐 Internet restaurado. Sincronizando y reconectando listeners...");
            this.syncAll();
            this._lastSyncContext = null;
            this.startRealTimeListeners();
        });
        window._noar_online_init = true;
    }

    // 🔄 RETRY PERIÓDICO: flush pendientes cada 90s aunque nunca se haya cortado la red
    const _retryInterval = setInterval(() => {
        if (navigator.onLine) this.syncAll().catch(() => {});
    }, 90 * 1000);
    this._unsubscribes.push(() => clearInterval(_retryInterval));
  },

  stopListeners() {
      // Cancelamos el debounce pendiente para que no arranque listeners después del stop
      if (this._startListenersTimer) {
          clearTimeout(this._startListenersTimer);
          this._startListenersTimer = null;
      }
      this._listenerSessionId++; // Invalidamos cualquier proceso de arranque en curso
      this._unsubscribes.forEach(unsub => unsub());
      this._unsubscribes = [];
      // Reseteamos flags para que el próximo login no quede bloqueado
      this._isSyncingData = false;
      this._isSyncingProducts = false;
      this._isSyncingInventory = false;
      this._lastSyncContext = null;
  },

  async syncAll() {
    if (!navigator.onLine) return { uploaded: 0, errors: 0 };
    const companyId = this._getCompanyId();
    const branchId = this._getActiveBranchId();
    if (!companyId) return { uploaded: 0, errors: 0 };

    try {
        // 🔥 HOUSEKEEPING: Rotar datos locales antiguos (>45 días) una vez al día
        this.rotateOldData(45).catch(e => {});

        const [
            salesRes, prodRes, mastersRes, shiftsRes, movsRes, 
            purchasesRes, supplierLedgerRes, kardexRes, customerLedgerRes 
        ] = await Promise.all([
            this.syncPendingSales(companyId, branchId),
            this.syncPendingProducts(companyId, branchId),
            this.syncPendingMasters(companyId),
            this.syncPendingShifts(companyId),
            this.syncPendingCashMovements(companyId),
            this.syncPendingPurchases(companyId),       
            this.syncPendingSupplierLedger(companyId),   
            this.syncPendingMovements(companyId),
            this.syncPendingCustomerLedger(companyId)    
        ]);
        
        const totalUploaded = 
            (salesRes?.synced || 0) + 
            (prodRes?.synced || 0) + 
            (mastersRes?.synced || 0) + 
            (shiftsRes?.synced || 0) + 
            (movsRes?.synced || 0) + 
            (purchasesRes?.synced || 0) + 
            (supplierLedgerRes?.synced || 0) +
            (kardexRes?.synced || 0) +
            (customerLedgerRes?.synced || 0);
            
        if (totalUploaded > 0) console.log(`✅ [SyncAll] ${totalUploaded} items subidos a Firestore.`);
        return { uploaded: totalUploaded, errors: 0 };
    } catch (error) {
        console.error("❌ Error Sync Up:", error);
        return { uploaded: 0, errors: 1 };
    }
  },

  async pushGlobalConfig(key, value) {
      const { user } = useAuthStore.getState();
      if (!user?.companyId || user.companyId === 'master_admin' || user.superAdmin) throw new Error("No hay sesión de empresa activa");
      const configRef = doc(db, `companies/${user.companyId}/config`, key);
      await setDoc(configRef, { key, value, updatedAt: new Date().toISOString() }, { merge: true });
      const localDb = await getDB();
      await localDb.config.put({ key: key, value, updatedAt: new Date().toISOString() });
      return true;
  },

  // 🔥 TÁCTICA DE ASPIRADORA: Usamos filter(x !== 'synced') en lugar de equals('pending')
  async syncPendingProducts(companyId, branchId) {
    const localDb = await getDB();
    const pendingProducts = await localDb.products
        .filter(p => p.syncStatus !== 'synced')
        .toArray();

    const pendingInventory = await localDb.inventory
        .filter(i => i.syncStatus !== 'synced')
        .toArray();

    if (pendingProducts.length === 0 && pendingInventory.length === 0) return { synced: 0 };

    let totalSynced = 0;

    if (pendingProducts.length > 0) {
        // 🔒 Batch atómico (chunks de 450, límite Firestore 500 ops): si un merge padre-hijo
        // (mergeAsVariant) quedó pendiente offline, padre y hijo suben juntos en el mismo commit.
        // Subirlos con setDoc sueltos deja una ventana donde otra sucursal ve al padre con el
        // tier nuevo pero al hijo todavía "vivo" (o viceversa), duplicando filas en la exportación a balanza.
        const chunkSize = 450;
        for (let i = 0; i < pendingProducts.length; i += chunkSize) {
            const chunk = pendingProducts.filter(p => p.id).slice(i, i + chunkSize);
            if (chunk.length === 0) continue;

            const batch = writeBatch(db);
            const nowIso = new Date().toISOString();

            for (const product of chunk) {
                const docRef = doc(collection(db, 'companies', companyId, 'products'), String(product.id));
                const { syncStatus, stock, promo, ...masterData } = product;
                batch.set(docRef, {
                    ...this._deepSanitize(masterData),
                    lastUpdated: serverTimestamp(),
                    updatedAt: serverTimestamp()
                }, { merge: true });
            }

            try {
                await batch.commit();
                await Promise.all(chunk.map(p => localDb.products.update(p.id, {
                    syncStatus: 'synced',
                    updatedAt: nowIso
                })));
                totalSynced += chunk.length;
            } catch (err) {
                console.warn(`❌ Error sinc. batch de productos:`, err);
            }
        }
    }

    if (pendingInventory.length > 0) {
        for (const inv of pendingInventory) {
            try {
                const stockRef = doc(db, `companies/${companyId}/branches/${inv.branchId}/inventory`, String(inv.productId));
                const nowIso = new Date().toISOString();

                if (inv.stockDelta !== undefined && inv.stockDelta !== null) {
                    // 🔥 ATÓMICO: aplica el delta — safe con 5 cajas simultáneas
                    await setDoc(stockRef, {
                        productId: inv.productId,
                        stock: increment(inv.stockDelta),
                        updatedAt: serverTimestamp()
                    }, { merge: true });

                    // 🔄 RECONCILE: lee el valor autoritativo de Firestore y actualiza Dexie
                    const cloudSnap = await getDoc(stockRef);
                    const cloudStock = cloudSnap.exists() ? parseFloat(cloudSnap.data().stock) : inv.stock;
                    await localDb.inventory.update([inv.branchId, inv.productId], {
                        stock: cloudStock,
                        stockDelta: null,
                        syncStatus: 'synced',
                        updatedAt: nowIso
                    });
                } else {
                    // Fallback: registros sin delta (backwards compat)
                    await setDoc(stockRef, {
                        productId: inv.productId,
                        stock: parseFloat(inv.stock) || 0,
                        promo: inv.promo || null,
                        updatedAt: serverTimestamp()
                    }, { merge: true });
                    await localDb.inventory.update([inv.branchId, inv.productId], {
                        syncStatus: 'synced',
                        updatedAt: nowIso
                    });
                }
                totalSynced++;
            } catch (err) {
                console.warn(`❌ Error sinc. inventario ${inv.productId || '?'}:`, err);
            }
        }
    }
    
    return { synced: totalSynced };
  },

  // 🔥 TÁCTICA DE ASPIRADORA: Sube clientes atascados sin etiqueta
  async syncPendingMasters(companyId) {
      const localDb = await getDB();
      const masterCollections = ['categories', 'brands', 'suppliers', 'clients'];
      let totalSynced = 0;

      for (const collectionName of masterCollections) {
          try {
              const pendingItems = await localDb.table(collectionName).filter(i => i.syncStatus !== 'synced').toArray();
              if (pendingItems.length === 0) continue;

              for (const item of pendingItems) {
                  try {
                      if (!item.id) continue;
                      const safeId = this._ensureValidCloudId(item, collectionName.slice(0, 3));
                      const docRef = doc(collection(db, 'companies', companyId, collectionName), safeId);
                      const { syncStatus, localId, id, ...cleanItem } = item;
                      const nowIso = new Date().toISOString();

                      await setDoc(docRef, {
                          ...this._deepSanitize(cleanItem),
                          firestoreId: safeId,
                          updatedAt: serverTimestamp()
                      }, { merge: true });

                      await localDb.table(collectionName).update(item.id, { 
                          syncStatus: 'synced', 
                          firestoreId: safeId, 
                          updatedAt: nowIso 
                      });
                      totalSynced++;
                  } catch (itemErr) {
                      console.warn(`❌ Error sinc. maestro [${collectionName}] ${item.id}:`, itemErr);
                  }
              }
          } catch(e) {
              console.error(`Error en syncPendingMasters [${collectionName}]:`, e);
          }
      }
      return { synced: totalSynced };
  },

  async syncPendingSales(companyId, branchId) {
    const localDb = await getDB();
    // 🛡️ Excluir items con demasiados intentos fallidos (prob. corruptos)
    const pendingSales = await localDb.sales
        .filter(s => s.syncStatus !== 'synced' && (s.syncRetries || 0) < 5)
        .toArray();

    console.log(`[SyncPendingSales] ${pendingSales.length} ventas pendientes`);
    if (pendingSales.length === 0) return { synced: 0 };

    let totalSynced = 0;
    const salesCollection = collection(db, 'companies', companyId, 'sales');

    for (const sale of pendingSales) {
        try {
            if (!sale.id) continue;
            const safeId = this._ensureValidCloudId(sale, 'sale');
            const docRef = doc(salesCollection, safeId);
            const { localId, syncStatus, syncRetries, id, ...cleanSale } = sale;
            const nowIso = new Date().toISOString();

            await setDoc(docRef, {
                ...this._deepSanitize(cleanSale),
                firestoreId: safeId,
                branchId: sale.branchId || branchId || 'main',
                syncedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                origin: 'POS_WEB'
            }, { merge: true });

            await localDb.sales.update(sale.id, {
                syncStatus: 'synced',
                firestoreId: safeId,
                updatedAt: nowIso
            });
            totalSynced++;
        } catch (err) {
            // 🔄 Incrementar contador de reintentos — se reintentará en el próximo ciclo
            const retries = (sale.syncRetries || 0) + 1;
            console.warn(`❌ Sync venta ${sale.id} — intento ${retries}/5:`, err.code || err.message);
            try { await localDb.sales.update(sale.id, { syncRetries: retries }); } catch (_) {}
        }
    }
    return { synced: totalSynced };
  },

  async syncInitialShifts(companyId, branchId, role) {
      if (!companyId) return;
      try {
          const localDb = await getDB();
          const lastLocal = await localDb.shifts.orderBy('updatedAt').last();
          const rawDate = lastLocal ? new Date(lastLocal.updatedAt) : new Date(0);
          const lastSyncDate = isNaN(rawDate.getTime()) ? new Date(0) : rawDate;
          const safetyMarginDate = new Date(lastSyncDate.getTime() - 60_000);
          const firestoreSafetyMargin = Timestamp.fromDate(safetyMarginDate);

          const shiftsRef = collection(db, 'companies', companyId, 'shifts');
          const q = (role === 'OWNER' && (!branchId || branchId === 'ALL'))
              ? query(shiftsRef, where('updatedAt', '>', firestoreSafetyMargin))
              : query(shiftsRef, where('branchId', '==', branchId), where('updatedAt', '>', firestoreSafetyMargin));

          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
              const pendingIds = await localDb.shifts.filter(s => s.syncStatus !== 'synced').primaryKeys();
              const pendingSet = new Set(pendingIds);
              const toPut = snapshot.docs
                  .filter(d => !pendingSet.has(d.id))
                  .map(d => this._sanitizeCloudShift(d.data(), d.id));
              if (toPut.length > 0) await localDb.shifts.bulkPut(toPut);
          }
      } catch (e) {
          if (e.code !== 'failed-precondition') console.warn("Shifts delta sync warning:", e);
      }
  },

  async syncInitialCashMovements(companyId, branchId) {
      if (!companyId || !branchId || branchId === 'ALL') return;
      try {
          const localDb = await getDB();
          const count = await localDb.cash_movements.count();
          let lastSyncDate;

          if (count === 0) {
              lastSyncDate = new Date(Date.now() - 48 * 3600_000);
          } else {
              const lastLocals = await localDb.cash_movements
                  .where('branchId').equals(branchId).sortBy('date');
              const lastItem = lastLocals.length > 0 ? lastLocals[lastLocals.length - 1] : null;
              lastSyncDate = lastItem ? new Date(lastItem.date || lastItem.updatedAt || 0) : new Date(0);
          }

          const safetyMarginDate = new Date(lastSyncDate.getTime() - 60_000);
          const firestoreMargin = Timestamp.fromDate(safetyMarginDate);
          const movRef = collection(db, 'companies', companyId, 'cash_movements');
          const q = query(movRef, where('branchId', '==', branchId), where('date', '>', firestoreMargin));

          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
              const pendingIds = await localDb.cash_movements.filter(m => m.syncStatus !== 'synced').primaryKeys();
              const pendingSet = new Set(pendingIds);
              const toPut = snapshot.docs
                  .filter(d => !pendingSet.has(d.id))
                  .map(d => this._sanitizeCloudCashMovement(d.data(), d.id));
              if (toPut.length > 0) await localDb.cash_movements.bulkPut(toPut);
          }
      } catch (e) {
          console.warn("CashMovements delta sync warning:", e);
      }
  },

  async syncPendingShifts(companyId) {
      const localDb = await getDB();
      const pendingShifts = await localDb.shifts
          .filter(s => s.syncStatus !== 'synced' && (s.syncRetries || 0) < 5)
          .toArray();

      if (pendingShifts.length === 0) return { synced: 0 };

      let totalSynced = 0;
      const colRef = collection(db, 'companies', companyId, 'shifts');

      for (const shift of pendingShifts) {
          try {
              if (!shift.id) continue;
              const safeId = this._ensureValidCloudId(shift, `shift_${shift.branchId || 'b'}`);
              const docRef = doc(colRef, safeId);

              // 🔥 runningTotals SOLO se muta vía shiftLedgerService (transacción con
              // increment()). Re-subir el objeto shift local completo con ese campo
              // pisaría el valor ya incrementado en el servidor — se excluye acá.
              const { localId, syncStatus, syncRetries, id, runningTotals, ...cleanShift } = shift;
              const nowIso = new Date().toISOString();

              await setDoc(docRef, {
                  ...this._deepSanitize(cleanShift),
                  firestoreId: safeId,
                  updatedAt: serverTimestamp()
              }, { merge: true });

              await localDb.shifts.update(shift.id, {
                  syncStatus: 'synced',
                  firestoreId: safeId,
                  updatedAt: nowIso
              });
              totalSynced++;
          } catch (err) {
              const retries = (shift.syncRetries || 0) + 1;
              console.warn(`❌ Sync turno ${shift.id} — intento ${retries}/5:`, err.code || err.message);
              try { await localDb.shifts.update(shift.id, { syncRetries: retries }); } catch (_) {}
          }
      }
      return { synced: totalSynced };
  },

  async syncPendingCashMovements(companyId) {
      const localDb = await getDB();
      const pendingMovs = await localDb.cash_movements
          .filter(c => c.syncStatus !== 'synced' && (c.syncRetries || 0) < 5)
          .toArray();

      if (pendingMovs.length === 0) return { synced: 0 };

      let totalSynced = 0;

      for (const mov of pendingMovs) {
          try {
              if (!mov.id) continue;
              const safeId = this._ensureValidCloudId(mov, 'cash');

              // 🔥 CONTADOR ATÓMICO DE CAJA: escribe el movimiento e incrementa
              // shifts/{shiftId}.runningTotals en la misma transacción (ver
              // shiftLedgerService) — idempotente frente a reintentos duplicados,
              // incluso si este mismo doc ya se había subido antes desde otro ciclo.
              await pushCashMovementWithShiftCounter(companyId, { ...mov, id: safeId });

              await localDb.cash_movements.update(mov.id, {
                  syncStatus: 'synced',
                  firestoreId: safeId,
                  updatedAt: new Date().toISOString()
              });
              totalSynced++;
          } catch (err) {
              const retries = (mov.syncRetries || 0) + 1;
              console.warn(`❌ Sync mov. caja ${mov.id} — intento ${retries}/5:`, err.code || err.message);
              try { await localDb.cash_movements.update(mov.id, { syncRetries: retries }); } catch (_) {}
          }
      }
      return { synced: totalSynced };
  },

  async syncPendingPurchases(companyId) {
      const localDb = await getDB();
      const pendingPurchases = await localDb.purchases.filter(p => p.syncStatus !== 'synced').toArray();
      
      if (pendingPurchases.length === 0) return { synced: 0 };

      let totalSynced = 0;
      const colRef = collection(db, 'companies', companyId, 'purchases');

      for (const purchase of pendingPurchases) {
          try {
              if (!purchase.id) continue;
              const safeId = this._ensureValidCloudId(purchase, 'purch');
              const docRef = doc(colRef, safeId); 
              const { syncStatus, localId, id, ...cleanPurchase } = purchase;
              const nowIso = new Date().toISOString();

              await setDoc(docRef, {
                  ...this._deepSanitize(cleanPurchase),
                  firestoreId: safeId,
                  syncedAt: serverTimestamp(),
                  updatedAt: serverTimestamp()
              }, { merge: true });

              await localDb.purchases.update(purchase.id, { 
                  syncStatus: 'synced', 
                  firestoreId: safeId, 
                  updatedAt: nowIso 
              });
              totalSynced++;
          } catch (err) {
              console.warn(`❌ Error sinc. compra ${purchase.id}:`, err);
          }
      }
      return { synced: totalSynced };
  },

  async syncPendingSupplierLedger(companyId) {
      const localDb = await getDB();
      const pendingLedger = await localDb.supplier_ledger.filter(s => s.syncStatus !== 'synced').toArray();
      
      if (pendingLedger.length === 0) return { synced: 0 };

      let totalSynced = 0;
      const colRef = collection(db, 'companies', companyId, 'supplier_ledger');

      for (const mov of pendingLedger) {
          try {
              if (!mov.id) continue;
              const safeId = this._ensureValidCloudId(mov, 'sledg');
              const docRef = doc(colRef, safeId); 
              const { syncStatus, localId, id, ...cleanMov } = mov;
              const nowIso = new Date().toISOString();

              await setDoc(docRef, {
                  ...this._deepSanitize(cleanMov),
                  firestoreId: safeId,
                  syncedAt: serverTimestamp(),
                  updatedAt: serverTimestamp()
              }, { merge: true });

              await localDb.supplier_ledger.update(mov.id, { 
                  syncStatus: 'synced', 
                  firestoreId: safeId, 
                  updatedAt: nowIso 
              });
              totalSynced++;
          } catch (err) {
              console.warn(`❌ Error sinc. ledger proveedor ${mov.id}:`, err);
          }
      }
      return { synced: totalSynced };
  },

  async syncPendingMovements(companyId) {
      const localDb = await getDB();
      const pendingMovs = await localDb.movements.filter(m => m.syncStatus !== 'synced').toArray();
      
      if (pendingMovs.length === 0) return { synced: 0 };

      let totalSynced = 0;
      const colRef = collection(db, 'companies', companyId, 'movements');

      for (const mov of pendingMovs) {
          try {
              if (!mov.id) continue;
              const safeId = this._ensureValidCloudId(mov, 'mov');
              const docRef = doc(colRef, safeId); 
              const { syncStatus, localId, id, ...cleanMov } = mov;
              const nowIso = new Date().toISOString();

              await setDoc(docRef, {
                  ...this._deepSanitize(cleanMov),
                  firestoreId: safeId,
                  syncedAt: serverTimestamp(),
                  updatedAt: serverTimestamp()
              }, { merge: true });

              await localDb.movements.update(mov.id, { 
                  syncStatus: 'synced', 
                  firestoreId: safeId, 
                  updatedAt: nowIso 
              });
              totalSynced++;
          } catch (err) {
              console.warn(`❌ Error sinc. kardex ${mov.id}:`, err);
          }
      }
      return { synced: totalSynced };
  },

  async syncPendingCustomerLedger(companyId) {
      const localDb = await getDB();
      const pendingLedger = await localDb.customer_ledger.filter(c => c.syncStatus !== 'synced').toArray();

      if (pendingLedger.length === 0) return { synced: 0 };

      let totalSynced = 0;

      for (const mov of pendingLedger) {
          try {
              if (!mov.id) continue;
              const safeId = this._ensureValidCloudId(mov, 'cledg');

              // 🔥 CONTADOR ATÓMICO DE SALDO: escribe el movimiento e incrementa
              // clients/{clientId}.balance en la misma transacción (ver
              // customerLedgerService) — idempotente frente a reintentos. Esta
              // cola es el único camino de reintento confiable para el balance
              // (no existe syncPendingClients).
              await pushLedgerMovementWithBalanceIncrement(companyId, { ...mov, id: safeId });

              await localDb.customer_ledger.update(mov.id, {
                  syncStatus: 'synced',
                  firestoreId: safeId,
                  updatedAt: new Date().toISOString()
              });
              totalSynced++;
          } catch (err) {
              console.warn(`❌ Error sinc. ledger cliente ${mov.id}:`, err);
          }
      }
      return { synced: totalSynced };
  },

  _sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
  },

  // 🔄 Wrapper de onSnapshot con auto-restart en caso de error permanente
  _safeOnSnapshot(q, onNext, listenerName = 'unknown') {
      return onSnapshot(q, onNext, (error) => {
          console.warn(`⚠️ [Listener ${listenerName}] Error — reconectando en 5s:`, error.code || error.message);
          setTimeout(() => {
              if (navigator.onLine) {
                  this._lastSyncContext = null;
                  this.startRealTimeListeners();
              }
          }, 5000);
      });
  },

  _getCompanyId() {
    // El master admin del SaaS queda bloqueado por companyId === 'master_admin'.
    // NO bloqueamos por user.superAdmin: owners de empresa pueden tener ese flag.
    const _isValid = (id) => id && id !== 'undefined' && id !== 'master_admin';

    // Intento 1: Zustand store (disponible cuando la app ya está corriendo)
    const { user } = useAuthStore.getState();
    if (user && _isValid(user.companyId)) return user.companyId;

    // Intento 2: localStorage directo (disponible antes de que Zustand hidrate)
    try {
        const stored = localStorage.getItem('auth-storage');
        if (stored) {
            const parsed = JSON.parse(stored);
            const storedUser = parsed?.state?.user;
            if (storedUser && _isValid(storedUser.companyId)) return storedUser.companyId;
        }
    } catch (_) {}
    return null;
  },

  _getActiveBranchId() {
    const { activeBranchId } = useAuthStore.getState();
    return activeBranchId;
  },

  chunkArray(myArray, chunk_size){
      var results = [];
      const arrayCopy = [...myArray];
      while (arrayCopy.length) { results.push(arrayCopy.splice(0, chunk_size)); }
      return results;
  },

  async checkTenantIntegrity(currentCompanyId) {
      if (!currentCompanyId) return;
      const lastCompanyId = localStorage.getItem('NOAR_LAST_COMPANY_ID');

      if (lastCompanyId && lastCompanyId !== currentCompanyId) {
          console.warn(`🚨 Cambio de Empresa detectado. Limpiando DB Local...`);
          try {
              const localDb = await getDB();
              await Promise.all([
                  localDb.products.clear(),
                  localDb.clients.clear(),
                  localDb.sales.clear(),
                  localDb.categories.clear(),
                  localDb.brands.clear(),
                  localDb.suppliers.clear(),
                  localDb.config.clear(),
                  localDb.cash_movements.clear(),
                  localDb.shifts.clear(), 
                  localDb.movements.clear(),
                  localDb.inventory.clear(),
                  localDb.purchases.clear(),
                  localDb.purchase_items.clear(),
                  localDb.supplier_ledger.clear(),
                  localDb.customer_ledger.clear()
              ]);
          } catch (error) { console.error(error); }
      }
      localStorage.setItem('NOAR_LAST_COMPANY_ID', currentCompanyId);
  },

  async syncPending() {
      return this.syncAll();
  },

  // 🔥 PILAR DE HIGIENE: Rotar datos antiguos para mantener Dexie ligero
  async rotateOldData(days = 45) {
      if (!navigator.onLine) return; // Solo rotamos si estamos seguros de que podemos validar sync

      const lastCleanup = localStorage.getItem('NOAR_LAST_CLEANUP_DATE');
      const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
      
      if (lastCleanup === today) return; 

      const localDb = await getDB();
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() - days);
      const thresholdIso = thresholdDate.toISOString();

      console.log(`🧹 [Nexus Housekeeping] Analizando rotación de datos (> ${days} días)...`);

      try {
          // 1. Rotar Ventas (Sales + Items)
          const oldSalesIds = await localDb.sales
              .filter(s => s.date < thresholdIso && s.syncStatus === 'synced')
              .primaryKeys();
          
          if (oldSalesIds.length > 0) {
              await localDb.sales.bulkDelete(oldSalesIds);
              // Borrar items asociados (si son auto-incrementales por saleId o similar)
              await localDb.sale_items.where('saleId').anyOf(oldSalesIds).delete();
              console.log(`✅ ${oldSalesIds.length} ventas antiguas rotadas de la base local.`);
          }

          // 2. Rotar Movimientos de Caja
          const oldCashMovIds = await localDb.cash_movements
              .filter(m => m.date < thresholdIso && m.syncStatus === 'synced')
              .primaryKeys();
          if (oldCashMovIds.length > 0) {
              await localDb.cash_movements.bulkDelete(oldCashMovIds);
          }

          // 3. Rotar Kardex de Inventario (Movements)
          const oldKardexIds = await localDb.movements
               .filter(m => m.date < thresholdIso && m.syncStatus === 'synced')
               .primaryKeys();
          if (oldKardexIds.length > 0) {
               await localDb.movements.bulkDelete(oldKardexIds);
          }

          // 4. Rotar Turnos Cerrados antiguos (> 90 días para preservar auditoría reciente)
          const thresholdShifts = new Date();
          thresholdShifts.setDate(thresholdShifts.getDate() - 90);
          const thresholdShiftsIso = thresholdShifts.toISOString();
          
          const oldShiftsIds = await localDb.shifts
              .filter(s => s.status === 'CLOSED' && s.closedAt < thresholdShiftsIso && s.syncStatus === 'synced')
              .primaryKeys();
          
          if (oldShiftsIds.length > 0) {
              await localDb.shifts.bulkDelete(oldShiftsIds);
              console.log(`✅ ${oldShiftsIds.length} turnos antiguos rotados.`);
          }

          localStorage.setItem('NOAR_LAST_CLEANUP_DATE', today);
      } catch (error) {
          console.warn("⚠️ Fallo en Housekeeping:", error);
      }
  }
};