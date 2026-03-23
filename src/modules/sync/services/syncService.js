import { 
    collection, 
    writeBatch, 
    doc, 
    setDoc, 
    onSnapshot, 
    query, 
    orderBy, 
    limit, 
    serverTimestamp, 
    where,
    getDocs, 
    Timestamp 
} from 'firebase/firestore'; 
import { db } from '../../../database/firebase'; 
import { getDB } from '../../../database/db'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 

const SYNC_KEYS = {
    PRODUCTS: 'last_sync_products_v4', 
    INVENTORY_PREFIX: 'last_sync_inv_br_', 
    GLOBAL_CONFIG: 'last_sync_config',
    SALES_PREFIX: 'last_sync_sales_br_',
    PURCHASES_PREFIX: 'last_sync_purchases_br_', // 🔥 NUEVO: Clave para Compras
    KARDEX_PREFIX: 'last_sync_kardex_br_', 
    CUSTOMER_LEDGER: 'last_sync_customer_ledger',
    SUPPLIER_LEDGER: 'last_sync_supplier_ledger'
};

export const syncService = {
  
  _unsubscribes: [],

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
          supplier: data.supplier || data.provider || '', 
          suppliers: Array.isArray(data.suppliers) ? data.suppliers : [],
          minStock: parseFloat(data.minStock) || 5,
          isWeighable: data.isWeighable === true,
          active: data.active !== false,
          deleted: data.deleted === true,
          updatedAt: data.updatedAt || data.lastUpdated || new Date().toISOString(),
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
          updatedAt: data.updatedAt || data.date || new Date().toISOString(),
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
          updatedAt: data.updatedAt || new Date().toISOString(),
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
          updatedAt: data.updatedAt || new Date().toISOString(),
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

  async syncProducts(companyId) {
    if (!companyId) return;
    const localDb = await getDB();
    const productsCount = await localDb.products.count();
    const isDbEmpty = productsCount === 0;
    const lastSyncStr = localStorage.getItem(SYNC_KEYS.PRODUCTS);
    const lastSyncDate = lastSyncStr ? new Date(lastSyncStr) : new Date(0); 

    const productsRef = collection(db, 'companies', companyId, 'products');
    let q = (!isDbEmpty && lastSyncStr) 
        ? query(productsRef, where('updatedAt', '>', Timestamp.fromDate(lastSyncDate)))
        : productsRef; 

    try {
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            const allDocs = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
            const toDelete = allDocs.filter(d => d.data.deleted === true).map(d => d.id);
            const toUpsert = allDocs.filter(d => d.data.deleted !== true).map(d => this._sanitizeCloudProduct(d.data, d.id));

            if (toDelete.length > 0) await localDb.products.bulkDelete(toDelete);
            if (toUpsert.length > 0) await localDb.products.bulkPut(toUpsert);
        }
        localStorage.setItem(SYNC_KEYS.PRODUCTS, new Date().toISOString());
        await this.processScheduledPriceChanges();
    } catch (error) {
        if (error.code === 'failed-precondition') {
             const fullQ = query(productsRef);
             const snap = await getDocs(fullQ);
             const allDocs = snap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
             const toUpsert = allDocs.filter(d => !d.data.deleted).map(d => this._sanitizeCloudProduct(d.data, d.id));
             await localDb.products.bulkPut(toUpsert);
             localStorage.setItem(SYNC_KEYS.PRODUCTS, new Date().toISOString());
             await this.processScheduledPriceChanges();
        }
    }
  },

  async syncAllInventoryForOwner(companyId, branches) {
      if (!companyId || !branches || branches.length === 0) return;
      await Promise.all(branches.map(branch => this.syncInitialInventory(companyId, branch.id)));
  },

  async syncInitialInventory(companyId, branchId) {
      if (!companyId || !branchId) return;
      const localDb = await getDB();
      const lastSyncKey = SYNC_KEYS.INVENTORY_PREFIX + branchId;
      const lastSyncStr = localStorage.getItem(lastSyncKey);
      const lastSyncDate = lastSyncStr ? new Date(lastSyncStr) : new Date(0); 

      const invRef = collection(db, 'companies', companyId, 'branches', branchId, 'inventory');
      const localInventoryCount = await localDb.inventory.where('branchId').equals(branchId).count();

      let q = (lastSyncStr && localInventoryCount > 0)
          ? query(invRef, where('updatedAt', '>', Timestamp.fromDate(lastSyncDate)))
          : invRef;
      
      try {
          const snapshot = await getDocs(q);
          if (snapshot.empty) {
              localStorage.setItem(lastSyncKey, new Date().toISOString());
              return;
          }
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
          if (inventoryItems.length > 0) await localDb.inventory.bulkPut(inventoryItems);
          localStorage.setItem(lastSyncKey, new Date().toISOString());
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
               await localDb.inventory.bulkPut(allItems);
               localStorage.setItem(lastSyncKey, new Date().toISOString());
          }
      }
  },

  async syncInitialMovements(companyId, branchId, role) {
      if (!companyId) return;
      const localDb = await getDB();
      
      const keySuffix = (role === 'OWNER' && (!branchId || branchId === 'ALL')) ? 'GLOBAL' : branchId;
      const lastSyncKey = SYNC_KEYS.KARDEX_PREFIX + keySuffix;
      const lastSyncStr = localStorage.getItem(lastSyncKey);
      
      const movRef = collection(db, 'companies', companyId, 'movements');
      let q;

      if (lastSyncStr) {
          const lastSyncDate = new Date(lastSyncStr);
          if (role === 'OWNER' && (!branchId || branchId === 'ALL')) {
              q = query(movRef, where('updatedAt', '>', Timestamp.fromDate(lastSyncDate)));
          } else {
              q = query(movRef, where('branchId', '==', branchId), where('updatedAt', '>', Timestamp.fromDate(lastSyncDate)));
          }
      } else {
          if (role === 'OWNER' && (!branchId || branchId === 'ALL')) {
              q = query(movRef, orderBy('date', 'desc'), limit(500));
          } else {
              q = query(movRef, where('branchId', '==', branchId), orderBy('date', 'desc'), limit(500));
          }
      }

      try {
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
              const pendingIds = await localDb.movements.where('syncStatus').equals('pending').primaryKeys();
              const pendingSet = new Set(pendingIds);
              
              const movsToPut = [];
              snapshot.docs.forEach(docSnap => {
                  if (!pendingSet.has(docSnap.id)) {
                      const d = docSnap.data();
                      movsToPut.push({
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
                      });
                  }
              });

              if (movsToPut.length > 0) await localDb.movements.bulkPut(movsToPut);
          }
          localStorage.setItem(lastSyncKey, new Date().toISOString());
      } catch (error) {
          console.warn("Kardex sync missing index, relying on push only:", error);
      }
  },

  async syncInitialSales(companyId, branchId, role) {
      if (!companyId) return;
      try {
          const localDb = await getDB();
          const keySuffix = (role === 'OWNER' && (!branchId || branchId === 'ALL')) ? 'GLOBAL' : branchId;
          const lastSyncKey = SYNC_KEYS.SALES_PREFIX + keySuffix;
          const lastSyncStr = localStorage.getItem(lastSyncKey);
          
          const salesRef = collection(db, 'companies', companyId, 'sales');
          let q;

          if (lastSyncStr) {
              const lastSyncDate = new Date(lastSyncStr);
              if (role === 'OWNER' && (!branchId || branchId === 'ALL')) {
                  q = query(salesRef, where('updatedAt', '>', Timestamp.fromDate(lastSyncDate)));
              } else {
                  q = query(salesRef, where('branchId', '==', branchId), where('updatedAt', '>', Timestamp.fromDate(lastSyncDate)));
              }
          } else {
              if (role === 'OWNER' && (!branchId || branchId === 'ALL')) {
                  q = query(salesRef, orderBy('date', 'desc'), limit(150));
              } else {
                  q = query(salesRef, where('branchId', '==', branchId), orderBy('date', 'desc'), limit(150));
              }
          }

          const snapshot = await getDocs(q);
          
          if (!snapshot.empty) {
              const pendingIds = await localDb.sales.where('syncStatus').equals('pending').primaryKeys();
              const pendingSet = new Set(pendingIds);
              
              const salesToPut = [];
              snapshot.docs.forEach(docSnap => {
                  if (!pendingSet.has(docSnap.id)) {
                      salesToPut.push(this._sanitizeCloudSale(docSnap.data(), docSnap.id));
                  }
              });

              if (salesToPut.length > 0) {
                  await localDb.sales.bulkPut(salesToPut);
              }
          }
          localStorage.setItem(lastSyncKey, new Date().toISOString());

      } catch (error) {}
  },

  // 🔥 NUEVO: BAJADA INICIAL DE COMPRAS PARA LOCAL-FIRST ABSOLUTO
  async syncInitialPurchases(companyId, branchId, role) {
      if (!companyId) return;
      try {
          const localDb = await getDB();
          const keySuffix = (role === 'OWNER' && (!branchId || branchId === 'ALL')) ? 'GLOBAL' : branchId;
          const lastSyncKey = SYNC_KEYS.PURCHASES_PREFIX + keySuffix;
          const lastSyncStr = localStorage.getItem(lastSyncKey);
          
          const colRef = collection(db, 'companies', companyId, 'purchases');
          let q;

          if (lastSyncStr) {
              const lastSyncDate = new Date(lastSyncStr);
              if (role === 'OWNER' && (!branchId || branchId === 'ALL')) {
                  q = query(colRef, where('updatedAt', '>', Timestamp.fromDate(lastSyncDate)));
              } else {
                  q = query(colRef, where('branchId', '==', branchId), where('updatedAt', '>', Timestamp.fromDate(lastSyncDate)));
              }
          } else {
              if (role === 'OWNER' && (!branchId || branchId === 'ALL')) {
                  q = query(colRef, orderBy('date', 'desc'), limit(150));
              } else {
                  q = query(colRef, where('branchId', '==', branchId), orderBy('date', 'desc'), limit(150));
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
          
          const ledgerRef = collection(db, 'companies', companyId, 'customer_ledger');
          let q;

          if (lastSyncStr) {
              const lastSyncDate = new Date(lastSyncStr);
              q = query(ledgerRef, where('updatedAt', '>', Timestamp.fromDate(lastSyncDate)));
          } else {
              q = query(ledgerRef, orderBy('date', 'desc'), limit(500));
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

  async syncInitialSupplierLedger(companyId) {
      if (!companyId) return;
      try {
          const localDb = await getDB();
          const lastSyncKey = SYNC_KEYS.SUPPLIER_LEDGER;
          const lastSyncStr = localStorage.getItem(lastSyncKey);
          
          const ledgerRef = collection(db, 'companies', companyId, 'supplier_ledger');
          let q;

          if (lastSyncStr) {
              const lastSyncDate = new Date(lastSyncStr);
              q = query(ledgerRef, where('updatedAt', '>', Timestamp.fromDate(lastSyncDate)));
          } else {
              q = query(ledgerRef, orderBy('date', 'desc'), limit(500));
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

  // 🔥 MOTOR DE ARRANQUE INTELIGENTE
  async syncInitialData(user, activeBranchId) {
      // 🔥 MODO DIOS BYPASS: El superadmin no sincroniza datos de empresa
      if (!user?.companyId || user.companyId === 'master_admin' || user.superAdmin) return;

      await this.syncConfig(user.companyId);
      await this.syncProducts(user.companyId);
      await this.syncInitialSales(user.companyId, activeBranchId, user.role);
      await this.syncInitialMovements(user.companyId, activeBranchId, user.role);
      
      await this.syncInitialCustomerLedger(user.companyId);
      
      // 🔥 SPRINT 7: Carga Inicial de Compras y Proveedores
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

  // =================================================================
  // 📡 REAL-TIME LISTENERS
  // =================================================================

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

  async startRealTimeListeners(companyIdArg = null) {
    this.stopListeners();

    const { user } = useAuthStore.getState();
    // 🔥 MODO DIOS BYPASS: El superadmin no levanta listeners
    if (user?.superAdmin || user?.companyId === 'master_admin') return; 

    const companyId = companyIdArg || this._getCompanyId();
    const activeBranchId = this._getActiveBranchId(); 

    if (!companyId) return;

    await this.checkTenantIntegrity(companyId);

    const configQuery = query(collection(db, 'companies', companyId, 'config'));
    this._unsubscribes.push(onSnapshot(configQuery, async (snapshot) => {
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
                }
            }
        } catch (e) {}
    }));

    // Real-Time Ventas
    try {
        let salesQuery;
        const salesRef = collection(db, 'companies', companyId, 'sales');

        if (user?.role === 'OWNER' && (!activeBranchId || activeBranchId === 'ALL')) {
            salesQuery = query(salesRef, orderBy('date', 'desc'), limit(30));
        } else if (activeBranchId) {
            salesQuery = query(salesRef, where('branchId', '==', activeBranchId), orderBy('date', 'desc'), limit(30));
        }

        if (salesQuery) {
            this._unsubscribes.push(onSnapshot(salesQuery, async (snapshot) => {
                const localDb = await getDB();
                const pendingIds = await localDb.sales.where('syncStatus').equals('pending').primaryKeys();
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
                }
            }));
        }
    } catch (e) { }

    // 🔥 Real-Time Compras y Devoluciones (Purchases)
    try {
        let purchQuery;
        const purchRef = collection(db, 'companies', companyId, 'purchases');

        if (user?.role === 'OWNER' && (!activeBranchId || activeBranchId === 'ALL')) {
            purchQuery = query(purchRef, orderBy('date', 'desc'), limit(30));
        } else if (activeBranchId) {
            purchQuery = query(purchRef, where('branchId', '==', activeBranchId), orderBy('date', 'desc'), limit(30));
        }

        if (purchQuery) {
            this._unsubscribes.push(onSnapshot(purchQuery, async (snapshot) => {
                const localDb = await getDB();
                const pendingIds = await localDb.purchases.where('syncStatus').equals('pending').primaryKeys();
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
    masterCollections.forEach(collectionName => {
        const q = query(collection(db, 'companies', companyId, collectionName));
        this._unsubscribes.push(onSnapshot(q, async (snapshot) => {
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
  },

  async _applyProductChangesStrict(itemsToPut, idsToDelete) {
      const localDb = await getDB();
      try {
          await localDb.transaction('rw', localDb.products, async () => {
              if (idsToDelete.length > 0) await localDb.products.bulkDelete(idsToDelete);
              if (itemsToPut.length > 0) {
                  await localDb.products.bulkPut(itemsToPut);
              }
          });
      } catch (err) {}
  },

  stopListeners() {
      this._unsubscribes.forEach(unsub => unsub());
      this._unsubscribes = [];
  },

  // =================================================================
  // 🚀 SUBIDA (LOCAL -> NUBE)
  // =================================================================

  async syncAll() { 
    if (!navigator.onLine) return { uploaded: 0, errors: 0 };
    const companyId = this._getCompanyId();
    const branchId = this._getActiveBranchId();
    if (!companyId) return { uploaded: 0, errors: 0 };

    try {
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
            
        return { uploaded: totalUploaded, errors: 0 };
    } catch (error) {
        console.error("❌ Error Sync Up:", error);
        return { uploaded: 0, errors: 1 };
    }
  },

  async pushGlobalConfig(key, value) {
      const { user } = useAuthStore.getState();
      // 🔥 Evitar push de config si es el Master Admin
      if (!user?.companyId || user.companyId === 'master_admin' || user.superAdmin) throw new Error("No hay sesión de empresa activa");
      const configRef = doc(db, `companies/${user.companyId}/config`, key);
      await setDoc(configRef, { key, value, updatedAt: new Date().toISOString() }, { merge: true });
      const localDb = await getDB();
      await localDb.config.put({ key: key, value, updatedAt: new Date().toISOString() });
      return true;
  },

  async syncPendingProducts(companyId, branchId) {
    const localDb = await getDB();
    const pendingProducts = await localDb.products
        .filter(p => p.syncStatus === 'pending' || p.syncStatus === 'pending_update')
        .toArray();

    const pendingInventory = await localDb.inventory
        .filter(i => i.syncStatus === 'pending' || i.syncStatus === 'pending_stock')
        .toArray();

    if (pendingProducts.length === 0 && pendingInventory.length === 0) return { synced: 0 };

    let totalSynced = 0;

    if (pendingProducts.length > 0) {
        const productChunks = this.chunkArray(pendingProducts, 100); 
        for (const chunk of productChunks) {
            const batch = writeBatch(db);
            const syncedIds = [];
            
            for (const product of chunk) {
                if (!product.id) continue;
                const docRef = doc(collection(db, 'companies', companyId, 'products'), String(product.id));
                const { syncStatus, stock, promo, ...masterData } = product; 

                batch.set(docRef, {
                     ...this._deepSanitize(masterData),
                     lastUpdated: serverTimestamp()
                }, { merge: true }); 
                syncedIds.push(product.id);
            }

            if (syncedIds.length > 0) {
                await batch.commit();
                await localDb.products.bulkUpdate(
                    syncedIds.map(id => ({ key: id, changes: { syncStatus: 'synced' } }))
                );
                totalSynced += syncedIds.length;
                await this._sleep(150); 
            }
        }
    }

    if (pendingInventory.length > 0) {
        const invChunks = this.chunkArray(pendingInventory, 100);
        for (const chunk of invChunks) {
            const batch = writeBatch(db);
            const syncedKeys = [];
            
            for (const inv of chunk) {
                const stockRef = doc(db, `companies/${companyId}/branches/${inv.branchId}/inventory`, String(inv.productId));
                batch.set(stockRef, {
                    productId: inv.productId,
                    stock: parseFloat(inv.stock) || 0,
                    promo: inv.promo || null, 
                    updatedAt: serverTimestamp()
                }, { merge: true });
                syncedKeys.push([inv.branchId, inv.productId]);
            }

            if (syncedKeys.length > 0) {
                await batch.commit();
                await localDb.transaction('rw', localDb.inventory, async () => {
                    for (const key of syncedKeys) {
                        await localDb.inventory.update(key, { syncStatus: 'synced' });
                    }
                });
                totalSynced += syncedKeys.length;
                await this._sleep(150); 
            }
        }
    }
    
    return { synced: totalSynced };
  },

  async syncPendingMasters(companyId) {
      const localDb = await getDB();
      const masterCollections = ['categories', 'brands', 'suppliers', 'clients'];
      let totalSynced = 0;

      for (const collectionName of masterCollections) {
          try {
              const pendingItems = await localDb.table(collectionName).where('syncStatus').equals('pending').toArray();
              if (pendingItems.length === 0) continue;

              const chunks = this.chunkArray(pendingItems, 100);
              const colRef = collection(db, 'companies', companyId, collectionName);

              for (const chunk of chunks) {
                  const batch = writeBatch(db);
                  const syncedIds = [];

                  for (const item of chunk) {
                      const docRef = doc(colRef, String(item.id));
                      const { syncStatus, ...cleanItem } = item;
                      batch.set(docRef, this._deepSanitize(cleanItem), { merge: true });
                      syncedIds.push(item.id);
                  }

                  await batch.commit();
                  await localDb.table(collectionName).bulkUpdate(
                      syncedIds.map(id => ({ key: id, changes: { syncStatus: 'synced' } }))
                  );
                  totalSynced += syncedIds.length;
                  await this._sleep(100); 
              }
          } catch(e) { }
      }
      return { synced: totalSynced };
  },

  async syncPendingSales(companyId, branchId) {
    const localDb = await getDB();
    const pendingSales = await localDb.sales.where('syncStatus').equals('pending').toArray();
    
    if (pendingSales.length === 0) return { synced: 0 };

    const chunks = this.chunkArray(pendingSales, 100); 
    let totalSynced = 0;

    for (const batchSales of chunks) {
        const batch = writeBatch(db);
        const salesCollection = collection(db, 'companies', companyId, 'sales');
        const syncedIds = [];

        for (const sale of batchSales) {
            const safeId = sale.firestoreId || sale.localId;
            const docRef = doc(salesCollection, String(safeId)); 
            const { localId, syncStatus, ...cleanSale } = sale;

            batch.set(docRef, {
                ...this._deepSanitize(cleanSale),
                branchId: sale.branchId || branchId || 'main',
                syncedAt: serverTimestamp(),
                origin: 'POS_WEB' 
            }, { merge: true });
            
            syncedIds.push(sale.localId || sale.id);
        }

        await batch.commit();
        await localDb.sales.bulkUpdate(
             syncedIds.map(id => ({ key: id, changes: { syncStatus: 'synced' } }))
        );
        totalSynced += batchSales.length;
        await this._sleep(150); 
    }
    return { synced: totalSynced };
  },

  async syncPendingShifts(companyId) {
      const localDb = await getDB();
      const pendingShifts = await localDb.shifts.where('syncStatus').equals('pending').toArray();
      
      if (pendingShifts.length === 0) return { synced: 0 };

      const chunks = this.chunkArray(pendingShifts, 100);
      let totalSynced = 0;
      const colRef = collection(db, 'companies', companyId, 'shifts');

      for (const chunk of chunks) {
          const batch = writeBatch(db);
          const syncedIds = [];

          for (const shift of chunk) {
              const safeId = shift.firestoreId || shift.localId || shift.id;
              const docRef = doc(colRef, String(safeId)); 
              
              const { localId, syncStatus, ...cleanShift } = shift;

              batch.set(docRef, this._deepSanitize(cleanShift), { merge: true });
              syncedIds.push(shift.id); 
          }

          await batch.commit();
          await localDb.shifts.bulkUpdate(
               syncedIds.map(id => ({ key: id, changes: { syncStatus: 'synced' } }))
          );
          totalSynced += syncedIds.length;
          await this._sleep(100); 
      }
      return { synced: totalSynced };
  },

  async syncPendingCashMovements(companyId) {
      const localDb = await getDB();
      const pendingMovs = await localDb.cash_movements.where('syncStatus').equals('pending').toArray();
      
      if (pendingMovs.length === 0) return { synced: 0 };

      const chunks = this.chunkArray(pendingMovs, 100);
      let totalSynced = 0;
      const colRef = collection(db, 'companies', companyId, 'cash_movements');

      for (const chunk of chunks) {
          const batch = writeBatch(db);
          const syncedIds = [];

          for (const mov of chunk) {
              const safeId = mov.firestoreId || mov.id;
              const docRef = doc(colRef, String(safeId)); 
              const { syncStatus, ...cleanMov } = mov;

              batch.set(docRef, this._deepSanitize(cleanMov), { merge: true });
              syncedIds.push(mov.id);
          }

          await batch.commit();
          await localDb.cash_movements.bulkUpdate(
               syncedIds.map(id => ({ key: id, changes: { syncStatus: 'synced' } }))
          );
          totalSynced += syncedIds.length;
          await this._sleep(100); 
      }
      return { synced: totalSynced };
  },

  async syncPendingPurchases(companyId) {
      const localDb = await getDB();
      const pendingPurchases = await localDb.purchases.where('syncStatus').equals('pending').toArray();
      
      if (pendingPurchases.length === 0) return { synced: 0 };

      const chunks = this.chunkArray(pendingPurchases, 100);
      let totalSynced = 0;
      const colRef = collection(db, 'companies', companyId, 'purchases');

      for (const chunk of chunks) {
          const batch = writeBatch(db);
          const syncedIds = [];

          for (const purchase of chunk) {
              const safeId = purchase.firestoreId || purchase.id;
              const docRef = doc(colRef, String(safeId)); 
              const { syncStatus, ...cleanPurchase } = purchase;

              batch.set(docRef, {
                  ...this._deepSanitize(cleanPurchase),
                  syncedAt: serverTimestamp()
              }, { merge: true });
              
              syncedIds.push(purchase.id);
          }

          await batch.commit();
          await localDb.purchases.bulkUpdate(
               syncedIds.map(id => ({ key: id, changes: { syncStatus: 'synced' } }))
          );
          totalSynced += syncedIds.length;
          await this._sleep(100); 
      }
      return { synced: totalSynced };
  },

  async syncPendingSupplierLedger(companyId) {
      const localDb = await getDB();
      const pendingLedger = await localDb.supplier_ledger.where('syncStatus').equals('pending').toArray();
      
      if (pendingLedger.length === 0) return { synced: 0 };

      const chunks = this.chunkArray(pendingLedger, 100);
      let totalSynced = 0;
      const colRef = collection(db, 'companies', companyId, 'supplier_ledger');

      for (const chunk of chunks) {
          const batch = writeBatch(db);
          const syncedIds = [];

          for (const mov of chunk) {
              const safeId = mov.firestoreId || mov.id;
              const docRef = doc(colRef, String(safeId)); 
              const { syncStatus, ...cleanMov } = mov;

              batch.set(docRef, {
                  ...this._deepSanitize(cleanMov),
                  syncedAt: serverTimestamp()
              }, { merge: true });
              
              syncedIds.push(mov.id);
          }

          await batch.commit();
          await localDb.supplier_ledger.bulkUpdate(
               syncedIds.map(id => ({ key: id, changes: { syncStatus: 'synced' } }))
          );
          totalSynced += syncedIds.length;
          await this._sleep(100); 
      }
      return { synced: totalSynced };
  },

  async syncPendingMovements(companyId) {
      const localDb = await getDB();
      const pendingMovs = await localDb.movements.where('syncStatus').equals('pending').toArray();
      
      if (pendingMovs.length === 0) return { synced: 0 };

      const chunks = this.chunkArray(pendingMovs, 100);
      let totalSynced = 0;
      const colRef = collection(db, 'companies', companyId, 'movements');

      for (const chunk of chunks) {
          const batch = writeBatch(db);
          const syncedIds = [];

          for (const mov of chunk) {
              const safeId = mov.firestoreId || mov.id;
              const docRef = doc(colRef, String(safeId)); 
              const { syncStatus, ...cleanMov } = mov;

              batch.set(docRef, {
                  ...this._deepSanitize(cleanMov),
                  syncedAt: serverTimestamp()
              }, { merge: true });
              
              syncedIds.push(mov.id);
          }

          await batch.commit();
          await localDb.movements.bulkUpdate(
               syncedIds.map(id => ({ key: id, changes: { syncStatus: 'synced' } }))
          );
          totalSynced += syncedIds.length;
          await this._sleep(100); 
      }
      return { synced: totalSynced };
  },

  async syncPendingCustomerLedger(companyId) {
      const localDb = await getDB();
      const pendingLedger = await localDb.customer_ledger.where('syncStatus').equals('pending').toArray();
      
      if (pendingLedger.length === 0) return { synced: 0 };

      const chunks = this.chunkArray(pendingLedger, 100);
      let totalSynced = 0;
      const colRef = collection(db, 'companies', companyId, 'customer_ledger');

      for (const chunk of chunks) {
          const batch = writeBatch(db);
          const syncedIds = [];

          for (const mov of chunk) {
              const safeId = mov.firestoreId || mov.id;
              const docRef = doc(colRef, String(safeId)); 
              const { syncStatus, ...cleanMov } = mov;

              batch.set(docRef, {
                  ...this._deepSanitize(cleanMov),
                  syncedAt: serverTimestamp()
              }, { merge: true });
              
              syncedIds.push(mov.id);
          }

          await batch.commit();
          await localDb.customer_ledger.bulkUpdate(
               syncedIds.map(id => ({ key: id, changes: { syncStatus: 'synced' } }))
          );
          totalSynced += syncedIds.length;
          await this._sleep(100); 
      }
      return { synced: totalSynced };
  },

  _sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
  },

  _getCompanyId() {
    const { user } = useAuthStore.getState();
    // 🔥 MODO DIOS BYPASS: El superadmin no tiene un companyId real de negocio
    if (!user || !user.companyId || user.companyId === 'undefined' || user.companyId === 'master_admin' || user.superAdmin) return null;
    return user.companyId;
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
  }
};