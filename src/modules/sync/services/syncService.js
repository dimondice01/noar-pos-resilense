import { 
  collection, 
  writeBatch, 
  doc, 
  onSnapshot, 
  query,
  orderBy,
  limit,
  where
} from 'firebase/firestore'; 
import { db } from '../../../database/firebase'; 
import { productRepository } from '../../inventory/repositories/productRepository';
import { getDB } from '../../../database/db'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 

export const syncService = {
  
  _unsubscribes: [],

  // =================================================================
  // 🧼 SANITIZADORES (Defensa de Datos & Integridad de Sucursal)
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
          // 🔥 FIX: Aunque el producto es global, preparamos terreno por si acaso
          syncStatus: 'synced' 
      };
  },

  // 2. VENTAS (FIX BRANCH ID)
  _sanitizeCloudSale(data, id) {
      let rawItems = data.items || data.cart || data.details || [];
      if (typeof rawItems === 'string') { try { rawItems = JSON.parse(rawItems); } catch (e) { rawItems = []; } }

      return {
          localId: data.localId || id, 
          firestoreId: id,
          
          // 🔥 CRÍTICO: Mantener la sucursal de origen
          branchId: data.branchId || 'main', 
          
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

  // 3. MOVIMIENTOS STOCK (FIX BRANCH ID)
  _sanitizeCloudMovement(data, id) {
      return {
          id: id, 
          productId: data.productId || 'unknown',
          
          // 🔥 CRÍTICO: Movimientos de stock son por sucursal
          branchId: data.branchId || 'main',

          type: data.type || 'INFO',
          amount: parseFloat(data.amount) || 0,
          description: data.description || '',
          date: data.date || new Date().toISOString(),
          user: data.user || 'Sistema', 
          refId: data.refId || null,
          syncStatus: 'synced'
      };
  },

  // 4. CAJAS (SHIFTS) (FIX BRANCH ID)
  _sanitizeCloudShift(data, id) {
      const finalVal = data.finalCash !== undefined ? data.finalCash : (data.finalAmount || 0);
      const systemVal = data.expectedCash !== undefined ? data.expectedCash : (data.systemAmount || 0);
      const leftVal = data.leftInCash !== undefined ? data.leftInCash : 0; 

      return {
          id: id,
          localId: data.localId || id,
          userId: data.userId || 'unknown',
          userName: data.userName || 'Cajero',
          userEmail: data.userEmail || '',
          companyId: data.companyId,
          
          // 🔥 CRÍTICO: Sin esto, el Dashboard no ve la caja en la sucursal correcta
          branchId: data.branchId || 'main',
          
          status: data.status || 'CLOSED',
          openedAt: data.openedAt || new Date().toISOString(),
          closedAt: data.closedAt || null,
          
          initialAmount: parseFloat(data.initialAmount) || 0,
          finalCash: parseFloat(finalVal), 
          expectedCash: parseFloat(systemVal), 
          leftInCash: parseFloat(leftVal),
          
          // Compatibilidad legacy
          finalAmount: parseFloat(finalVal),
          systemAmount: parseFloat(systemVal),
          
          difference: parseFloat(data.difference) || 0,
          expectedDigital: parseFloat(data.expectedDigital || 0),
          audited: data.audited === true,
          
          syncStatus: 'synced'
      };
  },

  // 5. MOVIMIENTOS CAJA (FIX BRANCH ID)
  _sanitizeCloudCashMovement(data, id) {
      return {
          id: id,
          shiftId: data.shiftId,
          companyId: data.companyId,
          
          // 🔥 CRÍTICO: El movimiento pertenece a una sucursal
          branchId: data.branchId || 'main',
          
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
                  localDb.movements.clear(),
                  localDb.inventory.clear() 
              ]);
          } catch (error) { console.error(error); }
      }
      localStorage.setItem('NOAR_LAST_COMPANY_ID', currentCompanyId);
  },

  // =================================================================
  // 📡 LISTENERS (Bajada de Datos en Tiempo Real)
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

    // 3. VENTAS (Con Protección Pending y Branch ID)
    try {
        const salesQuery = query(collection(db, 'companies', companyId, 'sales'), orderBy('date', 'desc'), limit(500));
        this._unsubscribes.push(onSnapshot(salesQuery, async (snapshot) => {
            const localDb = await getDB();
            const pendingIds = await localDb.sales.where('syncStatus').equals('pending').primaryKeys();
            const pendingSet = new Set(pendingIds);

            const salesToPut = [];
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added' || change.type === 'modified') {
                    if (!pendingSet.has(change.doc.id)) {
                        // Al sanitizar aquí, ahora incluimos branchId gracias al fix
                        salesToPut.push(this._sanitizeCloudSale(change.doc.data(), change.doc.id));
                    }
                }
            });
            if (salesToPut.length > 0) {
                await localDb.sales.bulkPut(salesToPut);
            }
        }));
    } catch (e) { console.warn("Listener Ventas off:", e); }

    // 4. MOVIMIENTOS KARDEX (Con Branch ID)
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

    // 5. CAJAS / SHIFTS (Con Branch ID y Override de Cierre)
    try {
        const shiftsQuery = query(
            collection(db, 'companies', companyId, 'shifts'), 
            orderBy('openedAt', 'desc'),
            limit(50)
        );
        this._unsubscribes.push(onSnapshot(shiftsQuery, async (snapshot) => {
            const localDb = await getDB();
            const pendingIds = await localDb.shifts.where('syncStatus').equals('pending').primaryKeys();
            const pendingSet = new Set(pendingIds);

            const shiftsToPut = [];
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added' || change.type === 'modified') {
                    const cloudData = change.doc.data();
                    const sanitized = this._sanitizeCloudShift(cloudData, change.doc.id);
                    
                    const isPending = pendingSet.has(sanitized.id);
                    const cloudSaysClosed = sanitized.status === 'CLOSED';
                    
                    if (!isPending || cloudSaysClosed) {
                         if (isPending && cloudSaysClosed) {
                             console.log(`🔒 [SYNC] Forzando cierre remoto: ${sanitized.id}`);
                         }
                         shiftsToPut.push(sanitized);
                    }
                }
            });
            
            if (shiftsToPut.length > 0) {
                await localDb.shifts.bulkPut(shiftsToPut); 
            }
        }));
    } catch (e) { console.warn("Listener Cajas off:", e); }

    // 6. MOVIMIENTOS DE CAJA (Con Branch ID)
    try {
        const cashMovsQuery = query(
            collection(db, 'companies', companyId, 'cash_movements'),
            orderBy('date', 'desc'),
            limit(500)
        );
        this._unsubscribes.push(onSnapshot(cashMovsQuery, async (snapshot) => {
            const localDb = await getDB();
            const pendingIds = await localDb.cash_movements.where('syncStatus').equals('pending').primaryKeys();
            const pendingSet = new Set(pendingIds);

            const movsToPut = [];
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added' || change.type === 'modified') {
                    if (!pendingSet.has(change.doc.id)) {
                        movsToPut.push(this._sanitizeCloudCashMovement(change.doc.data(), change.doc.id));
                    }
                }
            });
            if (movsToPut.length > 0) {
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

    // 8. SUCURSALES
    const branchesQuery = query(collection(db, 'companies', companyId, 'branches'));
    this._unsubscribes.push(onSnapshot(branchesQuery, async (snapshot) => {
        const branchesToPut = [];
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added' || change.type === 'modified') {
                branchesToPut.push({ id: change.doc.id, ...change.doc.data(), syncStatus: 'synced' });
            }
        });
        if (branchesToPut.length > 0) {
            const localDb = await getDB();
            await localDb.branches.bulkPut(branchesToPut);
        }
    }));
  },

  // Helper para aplicar cambios de productos
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
                          
                          if (localId === incomingId) { 
                              finalItems.push(incoming); 
                          } else {
                              const isIncomingLegacy = incomingId.length < 20; 
                              const isLocalLegacy = localId.length < 20;
                              if (isIncomingLegacy && !isLocalLegacy) { 
                                  idsToKillLocal.push(localMatch.id); 
                                  finalItems.push(incoming); 
                              } 
                          }
                      } else { 
                          finalItems.push(incoming); 
                      }
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

  async syncPending() {
      return this.syncAll();
  },

  async syncUp() { return this.syncAll(); },

  async syncAll() { 
    if (!navigator.onLine) return { sales: 0, products: 0 };
    const companyId = this._getCompanyId();
    if (!companyId) return { sales: 0, products: 0 };

    try {
        const [salesRes, prodRes, mastersRes] = await Promise.all([
            this.syncPendingSales(companyId),
            this.syncPendingProducts(companyId),
            this.syncPendingMasters(companyId) 
        ]);

        const totalUploaded = salesRes.synced + prodRes.synced + (mastersRes?.synced || 0);
        return { uploaded: totalUploaded, errors: 0 };
    } catch (error) {
        console.error("❌ Error Sync Up:", error);
        return { uploaded: 0, errors: 1 };
    }
  },

  // A. SUBIDA DE MAESTROS
  async syncPendingMasters(companyId) {
      const localDb = await getDB();
      const masterCollections = ['categories', 'brands', 'suppliers', 'clients'];
      let totalSynced = 0;

      for (const collectionName of masterCollections) {
          try {
              const pendingItems = await localDb.table(collectionName).where('syncStatus').equals('pending').toArray();
              if (pendingItems.length === 0) continue;

              const batch = writeBatch(db);
              const colRef = collection(db, 'companies', companyId, collectionName);
              const syncedIds = [];

              for (const item of pendingItems) {
                  if (!item.id) continue;
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
          } catch(e) { console.warn(`Error syncing masters (${collectionName}):`, e); }
      }
      return { synced: totalSynced };
  },

  // B. SUBIDA DE VENTAS
  async syncPendingSales(companyId) {
    const localDb = await getDB();
    const pendingSales = await localDb.sales.where('syncStatus').equals('pending').toArray();
    
    if (pendingSales.length === 0) return { synced: 0 };

    const chunks = this.chunkArray(pendingSales, 400); 
    let totalSynced = 0;

    for (const batchSales of chunks) {
        const batch = writeBatch(db);
        const salesCollection = collection(db, 'companies', companyId, 'sales');
        const syncedIds = [];

        for (const sale of batchSales) {
            const safeId = sale.firestoreId || sale.localId;
            if (!safeId) continue;

            const docRef = doc(salesCollection, String(safeId)); 
            const { localId, syncStatus, ...cleanSale } = sale;

            // 🔥 AQUI ASEGURAMOS QUE SUBA EL BRANCH ID
            batch.set(docRef, {
                ...this._deepSanitize(cleanSale),
                branchId: sale.branchId || 'main', // Defensa extra por si acaso
                date: new Date(cleanSale.date).toISOString(), 
                firestoreId: docRef.id,
                syncedAt: new Date().toISOString(),
                origin: 'POS_WEB' 
            }, { merge: true });
            
            syncedIds.push(sale.localId || sale.id);
        }

        await batch.commit();
        
        await localDb.sales.bulkUpdate(
             syncedIds.map(id => ({ key: id, changes: { syncStatus: 'synced' } }))
        );
        totalSynced += batchSales.length;
    }
    return { synced: totalSynced };
  },

  // C. SUBIDA DE PRODUCTOS
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
            if (!product.id) continue;
            const docRef = doc(productsCollection, String(product.id));
            
            const { syncStatus, stock, batches, ...dataToUpload } = product;

            batch.set(docRef, {
                 ...this._deepSanitize(dataToUpload),
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