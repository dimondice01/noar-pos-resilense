import { 
  collection, 
  writeBatch, 
  doc, 
  setDoc, // 🔥 Agregado para pushGlobalConfig
  onSnapshot, 
  query, 
  orderBy, 
  limit, 
  serverTimestamp, 
  where 
} from 'firebase/firestore'; 
import { db } from '../../../database/firebase'; 
import { getDB } from '../../../database/db'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 

export const syncService = {
  
  _unsubscribes: [],

  // =================================================================
  // 🧼 SANITIZADORES (Defensa de Datos & Integridad)
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

  // 1. PRODUCTOS (Entrada Cloud -> Local)
  _sanitizeCloudProduct(data, id) {
      return {
          id: id, 
          code: data.code ? String(data.code).trim() : 'SIN_CODIGO_' + id.slice(-4),
          barcode: Array.isArray(data.barcode) ? data.barcode : [], 
          name: data.name || 'Producto Sin Nombre',
          
          price: parseFloat(data.price) || 0,
          cost: parseFloat(data.cost) || 0,
          taxRate: parseFloat(data.taxRate) || 21,
          
          promo: data.promo ? {
              type: data.promo.type || 'PERCENTAGE',
              value: parseFloat(data.promo.value) || 0,
              discountValue: parseFloat(data.promo.discountValue) || 0,
              payValue: parseFloat(data.promo.payValue) || 0,
              startDate: data.promo.startDate || '',
              endDate: data.promo.endDate || '',
              name: data.promo.name || 'Promo'
          } : null,

          categoryId: data.categoryId || 'uncategorized',
          category: data.category || '', 
          brand: data.brand || '',      
          supplier: data.supplier || data.provider || '', 
          suppliers: Array.isArray(data.suppliers) ? data.suppliers : [],

          minStock: parseFloat(data.minStock) || 5,
          isWeighable: data.isWeighable === true,
          active: data.active !== false,
          deleted: data.deleted === true,
          
          lastUpdated: data.lastUpdated || new Date().toISOString(),
          syncStatus: 'synced' 
      };
  },

  // 2. VENTAS (Asegura Branch ID)
  _sanitizeCloudSale(data, id) {
      let rawItems = data.items || data.cart || data.details || [];
      if (typeof rawItems === 'string') { try { rawItems = JSON.parse(rawItems); } catch (e) { rawItems = []; } }

      return {
          localId: data.localId || id, 
          firestoreId: id,
          branchId: data.branchId || 'main', 
          
          date: data.date || new Date().toISOString(),
          
          total: parseFloat(data.total) || 0,
          baseAmount: parseFloat(data.baseAmount) || 0, 
          surcharge: parseFloat(data.surcharge) || 0,
          subtotal: parseFloat(data.subtotal) || 0,
          discount: parseFloat(data.discount) || 0,
          
          status: data.status || 'COMPLETED',
          
          items: Array.isArray(rawItems) ? rawItems.map(item => ({
              ...item,
              price: parseFloat(item.price) || 0,
              originalPrice: parseFloat(item.originalPrice) || parseFloat(item.price) || 0
          })) : [],
          itemCount: Array.isArray(rawItems) ? rawItems.length : 0, 
          
          payment: data.payment || { method: 'cash' },
          
          userId: data.userId || 'unknown',
          userName: data.userName || 'Vendedor',
          
          client: data.client || null, 
          
          afip: data.afip ? {
              status: data.afip.status || 'PENDING',
              cae: data.afip.cae || null,
              vtoCAE: data.afip.vtoCAE || null,
              cbteTipo: data.afip.cbteTipo || null,
              cbteNumero: data.afip.cbteNumero || null,
              qr_data: data.afip.qr_data || null
          } : null,
          
          syncStatus: 'synced'
      };
  },

  // 3. MOVIMIENTOS STOCK
  _sanitizeCloudMovement(data, id) {
      return {
          id: id, 
          productId: data.productId || 'unknown',
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

  // 4. CAJAS (SHIFTS)
  _sanitizeCloudShift(data, id) {
      const finalVal = data.finalCash !== undefined ? data.finalCash : (data.finalAmount || 0);
      const systemVal = data.expectedCash !== undefined ? data.expectedCash : (data.systemAmount || 0);
      const leftVal = data.leftInCash !== undefined ? data.leftInCash : 0; 

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
          leftInCash: parseFloat(leftVal),
          
          difference: parseFloat(data.difference) || 0,
          expectedDigital: parseFloat(data.expectedDigital || 0),
          audited: data.audited === true,
          
          syncStatus: 'synced'
      };
  },

  // 5. MOVIMIENTOS CAJA
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
          syncStatus: 'synced'
      };
  },

  // =================================================================
  // ⚙️ HELPERS INTERNOS
  // =================================================================

  _getCompanyId() {
    const { user } = useAuthStore.getState();
    if (!user || !user.companyId || user.companyId === 'undefined') return null;
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
                  localDb.supplier_ledger.clear()
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
    const branchId = this._getActiveBranchId();

    if (!companyId) return;

    console.log(`📡 [SYNC] Motor Iniciado: ${companyId} | Sucursal: ${branchId || 'N/A'}`);
    await this.checkTenantIntegrity(companyId);

   // 1. CONFIGURACIÓN (Blindado contra DataError)
const configQuery = query(collection(db, 'companies', companyId, 'config'));
this._unsubscribes.push(onSnapshot(configQuery, async (snapshot) => {
  try {
      const localDb = await getDB();
      for (const change of snapshot.docChanges()) {
          const data = change.doc.data();
          if (change.type === 'added' || change.type === 'modified') {
              // 🔥 FIX: Aseguramos que el objeto tenga la propiedad 'key'
              // Si el doc de Firestore no tiene 'value', usamos el objeto entero
              const configId = change.doc.id;
              const configValue = data.value !== undefined ? data.value : data;

              await localDb.config.put({ 
                  key: configId, 
                  value: configValue,
                  updatedAt: new Date().toISOString()
              }).catch(err => {
                  console.error(`❌ Dexie falló al guardar config [${configId}]:`, err);
              });
          }
      }
  } catch (e) { 
      console.error("🔥 Error crítico en Listener Config:", e); 
  }
}));

    // 2. PRODUCTOS (MAESTRO GLOBAL)
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

    // 3. INVENTARIO (STOCK DE SUCURSAL)
    if (branchId) {
        const inventoryQuery = query(collection(db, 'companies', companyId, 'branches', branchId, 'inventory'));
        this._unsubscribes.push(onSnapshot(inventoryQuery, async (snapshot) => {
            if (snapshot.empty) return;
            const localDb = await getDB();
            const updates = [];
            
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added' || change.type === 'modified') {
                    const data = change.doc.data();
                    updates.push({ 
                        key: data.productId, 
                        changes: { stock: data.stock, syncStatus: 'synced' } 
                    });
                }
            });

            if (updates.length > 0) {
                await localDb.products.bulkUpdate(updates);
            }
        }));
    }

    // 4. VENTAS
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
                        salesToPut.push(this._sanitizeCloudSale(change.doc.data(), change.doc.id));
                    }
                }
            });
            if (salesToPut.length > 0) {
                await localDb.sales.bulkPut(salesToPut);
            }
        }));
    } catch (e) { console.warn("Listener Ventas off:", e); }

    // 5. CAJAS / SHIFTS
    try {
        const shiftsQuery = query(collection(db, 'companies', companyId, 'shifts'), orderBy('openedAt', 'desc'), limit(50));
        this._unsubscribes.push(onSnapshot(shiftsQuery, async (snapshot) => {
            const localDb = await getDB();
            const pendingIds = await localDb.shifts.where('syncStatus').equals('pending').primaryKeys();
            const pendingSet = new Set(pendingIds);

            const shiftsToPut = [];
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added' || change.type === 'modified') {
                    const sanitized = this._sanitizeCloudShift(change.doc.data(), change.doc.id);
                    
                    const isPending = pendingSet.has(sanitized.id);
                    const cloudSaysClosed = sanitized.status === 'CLOSED';
                    
                    if (!isPending || cloudSaysClosed) {
                         shiftsToPut.push(sanitized);
                    }
                }
            });
            if (shiftsToPut.length > 0) {
                await localDb.shifts.bulkPut(shiftsToPut); 
            }
        }));
    } catch (e) { console.warn("Listener Cajas off:", e); }

    // 6. MAESTROS GLOBALES
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

    // 7. SUCURSALES
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

  async _applyProductChangesStrict(itemsToPut, idsToDelete) {
      const localDb = await getDB();
      try {
          await localDb.transaction('rw', localDb.products, async () => {
              if (idsToDelete.length > 0) await localDb.products.bulkDelete(idsToDelete);
              
              if (itemsToPut.length > 0) {
                  for (const incoming of itemsToPut) {
                      const currentLocal = await localDb.products.get(incoming.id);
                      const finalItem = {
                          ...incoming,
                          stock: currentLocal ? currentLocal.stock : 0, // Preservar stock local
                          syncStatus: 'synced'
                      };
                      await localDb.products.put(finalItem);
                  }
              }
          });
      } catch (err) { console.error("❌ Error FATAL en Sync:", err); }
  },

  stopListeners() {
      this._unsubscribes.forEach(unsub => unsub());
      this._unsubscribes = [];
  },

  // =================================================================
  // 🚀 SUBIDA (LOCAL -> NUBE) [NEXUS CORE ENGINE]
  // =================================================================

  async syncAll() { 
    if (!navigator.onLine) return { uploaded: 0, errors: 0 };
    
    const companyId = this._getCompanyId();
    const branchId = this._getActiveBranchId();
    
    if (!companyId) return { uploaded: 0, errors: 0 };

    try {
        const [salesRes, prodRes, mastersRes] = await Promise.all([
            this.syncPendingSales(companyId, branchId),
            this.syncPendingProducts(companyId, branchId),
            this.syncPendingMasters(companyId) 
        ]);

        const totalUploaded = (salesRes.synced || 0) + (prodRes.synced || 0) + (mastersRes?.synced || 0);
        return { uploaded: totalUploaded, errors: 0 };
    } catch (error) {
        console.error("❌ Error Sync Up:", error);
        return { uploaded: 0, errors: 1 };
    }
  },

  // 🔥 NUEVA FUNCIÓN CRÍTICA: Empuja config global (PIN, etc)
  async pushGlobalConfig(key, value) {
      const { user } = useAuthStore.getState();
      if (!user?.companyId) throw new Error("No hay sesión de empresa activa");

      try {
          // 1. Guardar en Firebase (Nube) para replicación
          const configRef = doc(db, `companies/${user.companyId}/config`, key);
          await setDoc(configRef, {
              key,
              value,
              updatedAt: new Date().toISOString(),
              updatedBy: user.uid
          }, { merge: true });

          // 2. Guardar en IndexedDB (Local) para acceso inmediato
          const dbLocal = await getDB();
         await dbLocal.config.put({ key: key, value, updatedAt: new Date().toISOString() });

          return true;
      } catch (error) {
          console.error("Error en pushGlobalConfig:", error);
          throw error;
      }
  },

  // A. SUBIDA DE PRODUCTOS
  async syncPendingProducts(companyId, branchId) {
    const localDb = await getDB();
    const pendingProducts = await localDb.products
        .filter(p => p.syncStatus === 'pending' || p.syncStatus === 'pending_update')
        .toArray();

    if (pendingProducts.length === 0) return { synced: 0 };

    const safeBranchId = branchId || 'main';
    const chunks = this.chunkArray(pendingProducts, 300); 
    let totalSynced = 0;

    for (const chunk of chunks) {
        const batch = writeBatch(db);
        const productsCollection = collection(db, 'companies', companyId, 'products');
        const syncedIds = [];

        for (const product of chunk) {
            if (!product.id) continue;
            const docRef = doc(productsCollection, String(product.id));
            
            const { syncStatus, stock, ...masterData } = product;

            batch.set(docRef, {
                 ...this._deepSanitize(masterData),
                 lastUpdated: serverTimestamp()
            }, { merge: true }); 

            if (stock !== undefined) {
                const stockRef = doc(db, `companies/${companyId}/branches/${safeBranchId}/inventory`, String(product.id));
                batch.set(stockRef, {
                    productId: product.id,
                    stock: parseFloat(stock) || 0,
                    updatedAt: serverTimestamp()
                }, { merge: true });
            }

            syncedIds.push(product.id);
        }

        await batch.commit();
        
        await localDb.products.bulkUpdate(
            syncedIds.map(id => ({ key: id, changes: { syncStatus: 'synced' } }))
        );
        
        totalSynced += chunk.length;
    }
    return { synced: totalSynced };
  },

  // B. SUBIDA DE MAESTROS
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

  // C. SUBIDA DE VENTAS
  async syncPendingSales(companyId, branchId) {
    const localDb = await getDB();
    const pendingSales = await localDb.sales.where('syncStatus').equals('pending').toArray();
    
    if (pendingSales.length === 0) return { synced: 0 };

    const chunks = this.chunkArray(pendingSales, 300); 
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
    }
    return { synced: totalSynced };
  },

  // =================================================================
  // 🔄 ALIAS DE COMPATIBILIDAD (Nexus Core Sync Bridge)
  // =================================================================
  
  async syncPending() {
      return this.syncAll();
  }
};