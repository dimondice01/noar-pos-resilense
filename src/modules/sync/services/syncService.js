import { 
  collection, 
  writeBatch, 
  doc, 
  onSnapshot, 
  query,
  orderBy,
  limit
} from 'firebase/firestore'; 
import { db } from '../../../database/firebase'; 
import { salesRepository } from '../../sales/repositories/salesRepository';
import { productRepository } from '../../inventory/repositories/productRepository';
import { getDB } from '../../../database/db'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 

export const syncService = {
  
  _unsubscribes: [],

  // =================================================================
  // 🧼 SANITIZADORES
  // =================================================================

  _deepSanitize(obj) {
    if (obj === undefined) return null;
    if (obj === null) return null;
    if (typeof obj === 'object') {
      if (obj instanceof Date) return obj.toISOString();
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

  // 1. PRODUCTOS
  _sanitizeCloudProduct(data, id) {
      return {
          id: id, 
          code: data.code ? String(data.code).trim() : 'SIN_CODIGO_' + id.slice(-4),
          name: data.name || 'Producto Sin Nombre',
          price: parseFloat(data.price) || 0,
          cost: parseFloat(data.cost) || 0,
          stock: parseFloat(data.stock) || 0,
          categoryId: data.categoryId || 'uncategorized',
          category: data.category || '', 
          brand: data.brand || '',       
          supplier: data.supplier || data.provider || '', 
          batches: Array.isArray(data.batches) ? data.batches : [],
          minStock: parseFloat(data.minStock) || 5,
          isWeighable: data.isWeighable === true,
          active: data.active !== false,
          deleted: data.deleted === true,
          lastUpdated: data.lastUpdated || new Date().toISOString(),
          syncStatus: 'synced' 
      };
  },

  // 2. VENTAS
  _sanitizeCloudSale(data, id) {
      let rawItems = data.items || data.cart || data.details || [];
      if (typeof rawItems === 'string') { try { rawItems = JSON.parse(rawItems); } catch (e) { rawItems = []; } }

      return {
          localId: data.localId || id, 
          firestoreId: id,
          date: data.date || new Date().toISOString(),
          total: parseFloat(data.total) || 0,
          subtotal: parseFloat(data.subtotal) || 0,
          discount: parseFloat(data.discount) || 0,
          status: data.status || 'COMPLETED',
          items: Array.isArray(rawItems) ? rawItems : [],
          itemCount: Array.isArray(rawItems) ? rawItems.length : 0, 
          payment: data.payment || { method: 'cash' },
          userId: data.userId || 'unknown',
          userName: data.userName || 'Vendedor',
          sellerName: data.sellerName || data.userName || 'Cajero',
          createdBy: data.createdBy || '',
          client: data.client || null, 
          afip: data.afip || null,
          syncStatus: 'synced'
      };
  },

  // 3. MOVIMIENTOS STOCK
  _sanitizeCloudMovement(data, id) {
      return {
          id: id, 
          productId: data.productId || 'unknown',
          type: data.type || 'INFO',
          amount: parseFloat(data.amount) || 0,
          description: data.description || '',
          date: data.date || new Date().toISOString(),
          user: data.user || 'Sistema', 
          refId: data.refId || null,
          syncStatus: 'synced'
      };
  },

  // 4. CAJAS (SHIFTS)
  _sanitizeCloudShift(data, id) {
      const finalAmount = data.finalAmount !== undefined ? data.finalAmount : (data.finalCash || 0);
      const systemAmount = data.systemAmount !== undefined ? data.systemAmount : (data.expectedCash || 0);

      return {
          id: id,
          localId: data.localId || id,
          userId: data.userId || 'unknown',
          userName: data.userName || 'Cajero',
          userEmail: data.userEmail || '',
          status: data.status || 'CLOSED',
          
          openedAt: data.openedAt || new Date().toISOString(),
          closedAt: data.closedAt || null,
          
          initialAmount: parseFloat(data.initialAmount) || 0,
          
          finalAmount: parseFloat(finalAmount),
          systemAmount: parseFloat(systemAmount),
          finalCash: parseFloat(finalAmount), 
          expectedCash: parseFloat(systemAmount), 
          
          difference: parseFloat(data.difference) || 0,
          stats: data.stats || {}, 
          
          audited: data.audited === true,
          
          syncStatus: 'synced'
      };
  },

  // 5. MOVIMIENTOS CAJA
  _sanitizeCloudCashMovement(data, id) {
      return {
          id: id,
          shiftId: data.shiftId,
          type: data.type,
          amount: parseFloat(data.amount) || 0,
          description: data.description || '',
          date: data.date || new Date().toISOString(),
          method: data.method || 'cash',
          userId: data.userId, 
          userName: data.userName,
          syncStatus: 'synced'
      };
  },

  _getCompanyId() {
    const { user } = useAuthStore.getState();
    if (!user || !user.companyId || user.companyId === 'undefined') return null;
    return user.companyId;
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
                  localDb.movements.clear() 
              ]);
          } catch (error) { console.error(error); }
      }
      localStorage.setItem('NOAR_LAST_COMPANY_ID', currentCompanyId);
  },

  // =================================================================
  // 📡 LISTENERS
  // =================================================================
  
  async startRealTimeListeners(companyIdArg = null) {
    this.stopListeners();

    const companyId = companyIdArg || this._getCompanyId();
    if (!companyId) return;

    console.log(`📡 [SYNC] Motor Iniciado: ${companyId}`);
    await this.checkTenantIntegrity(companyId);

    // 1. CONFIGURACIÓN
    const configQuery = query(collection(db, 'companies', companyId, 'config'));
    this._unsubscribes.push(onSnapshot(configQuery, async (snapshot) => {
      try {
          const localDb = await getDB();
          snapshot.docChanges().forEach(async (change) => {
             const data = change.doc.data();
             if (change.type === 'added' || change.type === 'modified') {
                 await localDb.config.put({ key: change.doc.id, value: data.value });
             }
          });
      } catch (e) { console.error("Error config:", e); }
    }));

    // 2. PRODUCTOS
    const productsQuery = query(collection(db, 'companies', companyId, 'products'));
    this._unsubscribes.push(onSnapshot(productsQuery, async (snapshot) => {
      if (snapshot.empty) return;
      const toPut = [];
      const toDelete = [];
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'removed') { toDelete.push(change.doc.id); } 
        else { toPut.push(this._sanitizeCloudProduct(change.doc.data(), change.doc.id)); }
      });
      if (toPut.length > 0 || toDelete.length > 0) {
          await this._applyProductChangesStrict(toPut, toDelete);
      }
    }, (error) => console.error("Error Listener Productos:", error)));

    // 3. VENTAS
    try {
        const salesQuery = query(collection(db, 'companies', companyId, 'sales'), orderBy('date', 'desc'), limit(500));
        this._unsubscribes.push(onSnapshot(salesQuery, async (snapshot) => {
            const salesToPut = [];
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added' || change.type === 'modified') {
                    salesToPut.push(this._sanitizeCloudSale(change.doc.data(), change.doc.id));
                }
            });
            if (salesToPut.length > 0) {
                const localDb = await getDB();
                await localDb.sales.bulkPut(salesToPut);
            }
        }));
    } catch (e) { console.warn("Listener Ventas off:", e); }

    // 4. MOVIMIENTOS KARDEX
    try {
        const movementsQuery = query(collection(db, 'companies', companyId, 'movements'), orderBy('date', 'desc'), limit(200));
        this._unsubscribes.push(onSnapshot(movementsQuery, async (snapshot) => {
            const movsToPut = [];
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added' || change.type === 'modified') {
                    movsToPut.push(this._sanitizeCloudMovement(change.doc.data(), change.doc.id));
                }
            });
            if (movsToPut.length > 0) {
                const localDb = await getDB();
                await localDb.movements.bulkPut(movsToPut);
            }
        }));
    } catch (e) { console.warn("Listener Movements off:", e); }

    // 5. CAJAS (SHIFTS)
    try {
        const shiftsQuery = query(
            collection(db, 'companies', companyId, 'shifts'), 
            orderBy('openedAt', 'desc'),
            limit(100)
        );
        this._unsubscribes.push(onSnapshot(shiftsQuery, async (snapshot) => {
            const shiftsToPut = [];
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added' || change.type === 'modified') {
                    shiftsToPut.push(this._sanitizeCloudShift(change.doc.data(), change.doc.id));
                }
            });
            if (shiftsToPut.length > 0) {
                const localDb = await getDB();
                await localDb.shifts.bulkPut(shiftsToPut); 
            }
        }));
    } catch (e) { console.warn("Listener Cajas off:", e); }

    // 6. MOVIMIENTOS DE CAJA
    try {
        const cashMovsQuery = query(
            collection(db, 'companies', companyId, 'cash_movements'),
            orderBy('date', 'desc'),
            limit(500)
        );
        this._unsubscribes.push(onSnapshot(cashMovsQuery, async (snapshot) => {
            const movsToPut = [];
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added' || change.type === 'modified') {
                    movsToPut.push(this._sanitizeCloudCashMovement(change.doc.data(), change.doc.id));
                }
            });
            if (movsToPut.length > 0) {
                const localDb = await getDB();
                await localDb.cash_movements.bulkPut(movsToPut);
            }
        }));
    } catch (e) { console.warn("Listener Cash Movs off:", e); }

    // 7. MAESTROS
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
            if (idsToDelete.length > 0) { try { await localDb.table(collectionName).bulkDelete(idsToDelete); } catch(e){} }
            if (itemsToPut.length > 0) { try { await localDb.table(collectionName).bulkPut(itemsToPut); } catch(e){} }
        }));
    });
  },

  async _applyProductChangesStrict(itemsToPut, idsToDelete) {
      const localDb = await getDB();
      try {
          await localDb.transaction('rw', localDb.products, async () => {
              if (idsToDelete.length > 0) await localDb.products.bulkDelete(idsToDelete);
              if (itemsToPut.length > 0) {
                  const finalItems = [];
                  const idsToKillLocal = []; 
                  const incomingCodes = itemsToPut.map(i => i.code).filter(c => c);
                  
                  const conflicts = await localDb.products.where('code').anyOf(incomingCodes).toArray();
                  const conflictsMap = new Map(); 
                  conflicts.forEach(p => conflictsMap.set(String(p.code), p));

                  for (const incoming of itemsToPut) {
                      const code = String(incoming.code);
                      const localMatch = conflictsMap.get(code);
                      if (localMatch) {
                          const localId = String(localMatch.id);
                          const incomingId = String(incoming.id);
                          if (localId === incomingId) { finalItems.push(incoming); } 
                          else {
                              const isIncomingLegacy = incomingId.length < 20; 
                              const isLocalLegacy = localId.length < 20;
                              if (isIncomingLegacy && !isLocalLegacy) { idsToKillLocal.push(localMatch.id); finalItems.push(incoming); } 
                          }
                      } else { finalItems.push(incoming); }
                  }
                  if (idsToKillLocal.length > 0) await localDb.products.bulkDelete(idsToKillLocal);
                  if (finalItems.length > 0) await localDb.products.bulkPut(finalItems);
              }
          });
      } catch (err) { console.error("❌ Error FATAL en Sync:", err); }
  },

  stopListeners() {
      this._unsubscribes.forEach(unsub => unsub());
      this._unsubscribes = [];
  },

  // =================================================================
  // 🚀 SUBIDA (LOCAL -> NUBE)
  // =================================================================

  async syncUp() { return this.syncAll(); },

  async syncAll() { 
    if (!navigator.onLine) return { sales: 0, products: 0 };
    const companyId = this._getCompanyId();
    if (!companyId) return { sales: 0, products: 0 };

    try {
        const salesRes = await this.syncPendingSales(companyId);
        const prodRes = await this.syncPendingProducts(companyId);
        await this.syncPendingMasters(companyId); 
        return { sales: salesRes.synced, products: prodRes.synced };
    } catch (error) {
        console.error("❌ Error Sync Up:", error);
        return { sales: 0, products: 0 };
    }
  },

  async syncPendingMasters(companyId) {
      const localDb = await getDB();
      const masterCollections = ['categories', 'brands', 'suppliers', 'clients'];
      for (const collectionName of masterCollections) {
          try {
              const pendingItems = await localDb.table(collectionName).where('syncStatus').equals('pending').toArray();
              if (pendingItems.length === 0) continue;
              const batch = writeBatch(db);
              const colRef = collection(db, 'companies', companyId, collectionName);
              for (const item of pendingItems) {
                  // 🔥 FIX: Validar que el ID no sea vacío
                  if (!item.id) continue; 
                  const docRef = doc(colRef, String(item.id));
                  const { syncStatus, ...cleanItem } = item;
                  batch.set(docRef, this._deepSanitize(cleanItem), { merge: true });
              }
              await batch.commit();
              await localDb.table(collectionName).bulkPut(pendingItems.map(i => ({ ...i, id: i.id, syncStatus: 'synced' })));
          } catch(e) { console.warn(`Error syncing masters (${collectionName}):`, e); }
      }
  },

  async syncPendingSales(companyId) {
    const localDb = await getDB();
    const allSales = await salesRepository.getTodaySales(); 
    const pendingSales = allSales.filter(s => s.syncStatus === 'pending');
    if (pendingSales.length === 0) return { synced: 0 };

    const chunks = this.chunkArray(pendingSales, 400); 
    let totalSynced = 0;
    for (const batchSales of chunks) {
        const batch = writeBatch(db);
        const salesCollection = collection(db, 'companies', companyId, 'sales');
        const syncedIds = [];
        for (const sale of batchSales) {
            // 🔥 FIX: Validar ID
            const safeId = sale.firestoreId || sale.localId;
            if (!safeId) continue;

            const docRef = doc(salesCollection, String(safeId)); 
            const { localId, syncStatus, ...cleanSale } = sale;
            batch.set(docRef, {
                ...this._deepSanitize(cleanSale),
                date: new Date(cleanSale.date).toISOString(), 
                firestoreId: docRef.id,
                syncedAt: new Date().toISOString(),
                origin: 'POS_WEB' 
            }, { merge: true });
            syncedIds.push(sale.localId);
        }
        await batch.commit();
        const tx = localDb.transaction('rw', localDb.sales, async () => {
             for (const id of syncedIds) { await localDb.sales.update(id, { syncStatus: 'synced' }); }
        });
        await tx;
        totalSynced += batchSales.length;
    }
    return { synced: totalSynced };
  },

  async syncPendingProducts(companyId) {
    const pendingProducts = await productRepository.getPendingSync();
    if (pendingProducts.length === 0) return { synced: 0 };
    const chunks = this.chunkArray(pendingProducts, 400); 
    let totalSynced = 0;
    for (const chunk of chunks) {
        const batch = writeBatch(db);
        const productsCollection = collection(db, 'companies', companyId, 'products');
        const syncedIds = [];
        for (const product of chunk) {
            // 🔥 FIX: Validar ID antes de llamar a doc()
            if (!product.id) continue;
            
            const docRef = doc(productsCollection, String(product.id));
            const { syncStatus, ...dataToUpload } = product;
            batch.set(docRef, {
                 ...this._deepSanitize(dataToUpload),
                 category: dataToUpload.category || '',
                 brand: dataToUpload.brand || '',
                 supplier: dataToUpload.supplier || '',
                 lastUpdated: new Date().toISOString()
            }, { merge: true });
            syncedIds.push(product.id);
        }
        await batch.commit();
        await productRepository.markAsSynced(syncedIds);
        totalSynced += chunk.length;
    }
    return { synced: totalSynced };
  },

  chunkArray(myArray, chunk_size){
      var results = [];
      const arrayCopy = [...myArray];
      while (arrayCopy.length) { results.push(arrayCopy.splice(0, chunk_size)); }
      return results;
  }
};