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

// Claves para LocalStorage (Control de Delta Sync)
const SYNC_KEYS = {
    PRODUCTS: 'last_sync_products_v4', // Versionado para forzar recarga si cambia estructura
    INVENTORY_PREFIX: 'last_sync_inv_br_', // Prefijo para stock por sucursal
    GLOBAL_CONFIG: 'last_sync_config',
    SALES_PREFIX: 'last_sync_sales_br_' // 🔥 NUEVO: Checkpoint de ventas
};

export const syncService = {
  
  _unsubscribes: [],

  // =================================================================
  // 🧼 SANITIZADORES (Defensa de Datos & Integridad)
  // =================================================================

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
          
          // Programación de Precios
          nextPrice: data.nextPrice !== undefined && data.nextPrice !== null ? parseFloat(data.nextPrice) : null,
          nextCost: data.nextCost !== undefined && data.nextCost !== null ? parseFloat(data.nextCost) : null,
          priceActivationDate: data.priceActivationDate || null,

          categoryId: data.categoryId || 'uncategorized',
          category: data.category || '', 
          brand: data.brand || '',      
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

  // 2. VENTAS (Blindadas con Identidad)
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
          
          status: data.status || 'COMPLETED',
          type: data.type || 'SALE', // 🔥 Asegurar que el type exista para filtros en UI
          
          items: Array.isArray(rawItems) ? rawItems.map(item => ({
              ...item,
              price: parseFloat(item.price) || 0,
              cost: parseFloat(item.cost) || 0,
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
              cbteLetra: data.afip.cbteLetra || null,
              ptoVta: data.afip.ptoVta || null,
              qr_data: data.afip.qr_data || null
          } : null,
          
          // 🔥 CRÍTICO PARA EL DELTA SYNC: Garantizar updatedAt
          updatedAt: data.updatedAt || data.date || new Date().toISOString(),
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
          updatedAt: data.updatedAt || new Date().toISOString(),
          syncStatus: 'synced'
      };
  },

  // 4. CAJAS (SHIFTS)
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
          audited: data.audited === true,
          updatedAt: data.updatedAt || new Date().toISOString(),
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
          updatedAt: data.updatedAt || new Date().toISOString(),
          syncStatus: 'synced'
      };
  },

  // =================================================================
  // ⚡ MOTOR DE ACTUALIZACIÓN DE PRECIOS PROGRAMADOS (ROBOT)
  // =================================================================
  async processScheduledPriceChanges() {
    try {
        const localDb = await getDB();
        const todayStr = new Date().toLocaleDateString('sv-SE'); 

        const expiredProducts = await localDb.products
            .filter(p => p.priceActivationDate && p.priceActivationDate <= todayStr)
            .toArray();

        if (expiredProducts.length === 0) return;

        console.log(`🚀 [SCHEDULER] Aplicando ${expiredProducts.length} cambios de precio programados...`);

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
        
        console.log("✅ [SCHEDULER] Precios actualizados exitosamente.");
    } catch (e) {
        console.error("❌ Error en el motor de precios programados:", e);
    }
  },

  // =================================================================
  // ⬇️ BAJADA DE DATOS (CLOUD -> LOCAL) - DELTA SYNC ENGINE
  // =================================================================

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
                  return {
                      key: doc.id,
                      value: valueToSave,
                      updatedAt: new Date().toISOString()
                  };
              });
              await localDb.config.bulkPut(configItems);
          }
      } catch (error) {
          console.error("❌ Error sincronizando configuración:", error);
      }
  },

  // 1. SYNC PRODUCTOS (DELTA)
  async syncProducts(companyId) {
    if (!companyId) return;
    
    console.time("⏱️ Sync Productos");
    const localDb = await getDB();
    
    const productsCount = await localDb.products.count();
    const isDbEmpty = productsCount === 0;

    const lastSyncStr = localStorage.getItem(SYNC_KEYS.PRODUCTS);
    const lastSyncDate = lastSyncStr ? new Date(lastSyncStr) : new Date(0); 

    const productsRef = collection(db, 'companies', companyId, 'products');
    let q;

    if (!isDbEmpty && lastSyncStr) {
        q = query(productsRef, where('updatedAt', '>', Timestamp.fromDate(lastSyncDate)));
    } else {
        q = productsRef; 
    }

    try {
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            const allDocs = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));

            const toDelete = allDocs.filter(d => d.data.deleted === true).map(d => d.id);
            const toUpsert = allDocs.filter(d => d.data.deleted !== true).map(d => this._sanitizeCloudProduct(d.data, d.id));

            if (toDelete.length > 0) {
                await localDb.products.bulkDelete(toDelete);
            }

            if (toUpsert.length > 0) {
                await localDb.products.bulkPut(toUpsert);
            }
        }

        localStorage.setItem(SYNC_KEYS.PRODUCTS, new Date().toISOString());
        await this.processScheduledPriceChanges();

    } catch (error) {
        if (error.code === 'failed-precondition') {
             console.warn("⚠️ [SYNC] Falta índice compuesto. Ejecutando Full Sync de seguridad...");
             const fullQ = query(productsRef);
             const snap = await getDocs(fullQ);
             const allDocs = snap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
             const toUpsert = allDocs.filter(d => !d.data.deleted).map(d => this._sanitizeCloudProduct(d.data, d.id));
             
             await localDb.products.bulkPut(toUpsert);
             localStorage.setItem(SYNC_KEYS.PRODUCTS, new Date().toISOString());
             
             await this.processScheduledPriceChanges();
        } else {
             console.error("❌ Error en Sync Productos:", error);
        }
    } finally {
        console.timeEnd("⏱️ Sync Productos");
    }
  },

  // 2. 🔥 CARGA DE INVENTARIO MULTI-SUCURSAL (PARA OWNERS - DELTA)
  async syncAllInventoryForOwner(companyId, branches) {
      if (!companyId || !branches || branches.length === 0) return;
      await Promise.all(branches.map(branch => this.syncInitialInventory(companyId, branch.id)));
  },

  // 3. SYNC INVENTARIO DE UNA BRANCH (DELTA)
  async syncInitialInventory(companyId, branchId) {
      if (!companyId || !branchId) return;
      
      const localDb = await getDB();
      const lastSyncKey = SYNC_KEYS.INVENTORY_PREFIX + branchId;
      const lastSyncStr = localStorage.getItem(lastSyncKey);
      const lastSyncDate = lastSyncStr ? new Date(lastSyncStr) : new Date(0); 

      const invRef = collection(db, 'companies', companyId, 'branches', branchId, 'inventory');
      const q = query(invRef, where('updatedAt', '>', Timestamp.fromDate(lastSyncDate)));
      
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

          if (inventoryItems.length > 0) {
              await localDb.inventory.bulkPut(inventoryItems);
          }
          
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

  // 4. 🔥 NUEVO: SYNC INICIAL DE VENTAS (Cerrando el agujero)
  async syncInitialSales(companyId, branchId, role) {
      if (!companyId) return;
      console.time("⏱️ Sync Ventas");

      try {
          const localDb = await getDB();
          
          // El Owner que ve "ALL" usa un checkpoint global, la sucursal usa el suyo
          const keySuffix = (role === 'OWNER' && (!branchId || branchId === 'ALL')) ? 'GLOBAL' : branchId;
          const lastSyncKey = SYNC_KEYS.SALES_PREFIX + keySuffix;
          
          const lastSyncStr = localStorage.getItem(lastSyncKey);
          
          // Si es la primera vez en este navegador, traemos las últimas 150 para no reventar la RAM
          // Si ya hubo sync, traemos todo lo modificado desde la última vez (sin límite, porque es delta)
          const salesRef = collection(db, 'companies', companyId, 'sales');
          let q;

          if (lastSyncStr) {
              const lastSyncDate = new Date(lastSyncStr);
              console.log(`🔄 [SYNC VENTAS] Buscando Deltas desde ${lastSyncDate.toLocaleString()}...`);
              
              if (role === 'OWNER' && (!branchId || branchId === 'ALL')) {
                  q = query(salesRef, where('updatedAt', '>', Timestamp.fromDate(lastSyncDate)));
              } else {
                  q = query(salesRef, where('branchId', '==', branchId), where('updatedAt', '>', Timestamp.fromDate(lastSyncDate)));
              }
          } else {
              console.log("⬇️ [SYNC VENTAS] Primera Carga (Últimas 150)...");
              if (role === 'OWNER' && (!branchId || branchId === 'ALL')) {
                  q = query(salesRef, orderBy('date', 'desc'), limit(150));
              } else {
                  q = query(salesRef, where('branchId', '==', branchId), orderBy('date', 'desc'), limit(150));
              }
          }

          const snapshot = await getDocs(q);
          
          if (!snapshot.empty) {
              // Filtrar locales que estén 'pending' para no pisarlos con la versión vieja de Firebase
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
                  console.log(`📥 [SYNC VENTAS] ${salesToPut.length} ventas bajadas.`);
              }
          }
          
          localStorage.setItem(lastSyncKey, new Date().toISOString());

      } catch (error) {
          if (error.code === 'failed-precondition') {
               console.warn("⚠️ [SYNC VENTAS] Falta índice. El sistema dependerá del listener en tiempo real.");
          } else {
               console.error("❌ Error en Sync Ventas:", error);
          }
      } finally {
          console.timeEnd("⏱️ Sync Ventas");
      }
  },

  // 🔥 MOTOR DE ARRANQUE INTELIGENTE (MODIFICADO)
  async syncInitialData(user, activeBranchId) {
      if (!user?.companyId) return;

      // 1. Configuraciones Globales
      await this.syncConfig(user.companyId);

      // 2. Productos
      await this.syncProducts(user.companyId);

      // 3. Ventas (Cubriendo el agujero)
      await this.syncInitialSales(user.companyId, activeBranchId, user.role);

      // 4. Inventario por Rol
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
    const companyId = companyIdArg || this._getCompanyId();
    const activeBranchId = this._getActiveBranchId(); 

    if (!companyId) return;

    console.log(`📡 [SYNC] Listeners Secundarios Iniciados.`);
    await this.checkTenantIntegrity(companyId);

    // 1. CONFIGURACIÓN (Actualiza el POS y Finanzas en vivo)
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
        } catch (e) { console.error("Config Listener Error:", e); }
    }));

    // 2. VENTAS (Inteligente por Rol)
    try {
        let salesQuery;
        const salesRef = collection(db, 'companies', companyId, 'sales');

        if (user?.role === 'OWNER' && (!activeBranchId || activeBranchId === 'ALL')) {
            // El Owner escucha todas las ventas de la empresa que se estén haciendo AHORA
            salesQuery = query(salesRef, orderBy('date', 'desc'), limit(30));
        } else if (activeBranchId) {
            // El cajero solo escucha las de su sucursal
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

                        // Si la creamos nosotros, no la pisamos a menos que traiga datos de AFIP o de Facturación Final
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
    } catch (e) { 
        console.warn("Listener Ventas Error:", e); 
    }

    // 3. MAESTROS GLOBALES
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
      } catch (err) { console.error("❌ Error FATAL en Sync:", err); }
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

  async pushGlobalConfig(key, value) {
      const { user } = useAuthStore.getState();
      if (!user?.companyId) throw new Error("No hay sesión de empresa activa");
      const configRef = doc(db, `companies/${user.companyId}/config`, key);
      await setDoc(configRef, { key, value, updatedAt: new Date().toISOString() }, { merge: true });
      const dbLocal = await getDB();
      await dbLocal.config.put({ key: key, value, updatedAt: new Date().toISOString() });
      return true;
  },

  // A. SUBIDA DE PRODUCTOS (Y PROMOS LOCALES)
  async syncPendingProducts(companyId, branchId) {
    const localDb = await getDB();
    const pendingProducts = await localDb.products
        .filter(p => p.syncStatus === 'pending' || p.syncStatus === 'pending_update')
        .toArray();

    const pendingInventory = await localDb.inventory
        .filter(i => i.syncStatus === 'pending')
        .toArray();

    if (pendingProducts.length === 0 && pendingInventory.length === 0) return { synced: 0 };

    const batch = writeBatch(db);
    let opCount = 0;

    if (pendingProducts.length > 0) {
        for (const product of pendingProducts) {
            if (!product.id) continue;
            const docRef = doc(collection(db, 'companies', companyId, 'products'), String(product.id));
            const { syncStatus, stock, promo, ...masterData } = product; 

            batch.set(docRef, {
                 ...this._deepSanitize(masterData),
                 lastUpdated: serverTimestamp()
            }, { merge: true }); 
            opCount++;
        }
    }

    if (pendingInventory.length > 0) {
        for (const inv of pendingInventory) {
            const stockRef = doc(db, `companies/${companyId}/branches/${inv.branchId}/inventory`, String(inv.productId));
            batch.set(stockRef, {
                productId: inv.productId,
                stock: parseFloat(inv.stock) || 0,
                promo: inv.promo || null, 
                updatedAt: serverTimestamp()
            }, { merge: true });
            opCount++;
        }
    }

    if (opCount > 0) {
        await batch.commit();
        
        if (pendingProducts.length > 0) {
            await localDb.products.bulkUpdate(
                pendingProducts.map(p => ({ key: p.id, changes: { syncStatus: 'synced' } }))
            );
        }
        if (pendingInventory.length > 0) {
             await localDb.transaction('rw', localDb.inventory, async () => {
                for (const inv of pendingInventory) {
                    await localDb.inventory.update([inv.branchId, inv.productId], { syncStatus: 'synced' });
                }
             });
        }
    }
    
    return { synced: opCount };
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

    const chunks = this.chunkArray(pendingSales, 200); 
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
  // ⚙️ HELPERS
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

  async syncPending() {
      return this.syncAll();
  }
};