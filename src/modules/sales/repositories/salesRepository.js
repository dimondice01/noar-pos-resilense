import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { 
    doc, 
    setDoc, 
    getDoc, 
    getDocs,
    collection,
    query,
    where,
    serverTimestamp
} from 'firebase/firestore'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import { productRepository } from '../../inventory/repositories/productRepository';
import { cashRepository } from '../../cash/repositories/cashRepository';

// ==========================================
// ☁️ HELPER: SYNC OPTIMISTA NEXUS CORE
// ==========================================
const triggerOptimisticSync = async (collectionName, data, companyId) => {
    if (!navigator.onLine || !companyId) return;

    try {
        const docId = data.id || data.localId;
        await setDoc(doc(db, `companies/${companyId}/${collectionName}`, docId), {
            ...data,
            firestoreId: docId,
            syncedAt: new Date().toISOString(),
            origin: 'POS_WEB',
            syncStatus: 'synced' 
        }, { merge: true });

        const dbLocal = await getDB();
        await dbLocal.table(collectionName).update(docId, { syncStatus: 'synced' });
    } catch (err) {
        console.warn(`☁️ Sync optimista falló (${collectionName}), el SyncService reintentará.`);
    }
};

export const salesRepository = {
  
  // ==========================================
  // 🔢 GENERADOR DE NÚMEROS (ALBA SEQUENCE)
  // ==========================================
  async _generateTicketNumber(type = 'X', branchId) {
      const dbLocal = await getDB();
      let ptoVta = 1;
      
      try {
          const branch = await dbLocal.branches.get(branchId);
          if (branch && branch.number) ptoVta = branch.number;
      } catch(e) { }
      
      const configKey = `last_ticket_${type}_${ptoVta}`;
      const lastConfig = await dbLocal.config.get(configKey);
      
      let nextSequence = 1;
      if (lastConfig) {
          nextSequence = parseInt(lastConfig.value) + 1;
      }

      const ptoVtaStr = String(ptoVta).padStart(4, '0');
      const seqStr = String(nextSequence).padStart(8, '0');
      const finalNumber = `${type}-${ptoVtaStr}-${seqStr}`;

      return { finalNumber, nextSequence, configKey };
  },

  // ==========================================
  // 💰 CREAR VENTA (NEXUS PRO MAX ENGINE + SPLIT PAYMENTS)
  // ==========================================
  async createSale(saleData) {
    const dbLocal = await getDB();
    const { user, activeBranchId } = useAuthStore.getState();
    
    if (!user?.companyId) throw new Error("Error crítico: Sesión inválida.");

    const targetBranchId = activeBranchId || user.branchId || 'main';
    const saleId = saleData.id || `sale_${crypto.randomUUID()}`;
    const timestamp = saleData.createdAt || new Date().toISOString(); 
    
    // 1. GESTIÓN DE NUMERACIÓN
    let finalNumber = saleData.number;
    let configKeyToUpdate = null;
    let nextSequenceVal = 0;

    if (!finalNumber) {
        const docType = saleData.afip?.status === 'APPROVED' ? saleData.afip.cbteLetra : 'X';
        const gen = await this._generateTicketNumber(docType, targetBranchId);
        finalNumber = gen.finalNumber;
        configKeyToUpdate = gen.configKey;
        nextSequenceVal = gen.nextSequence;
    }

    const currentShift = await cashRepository.getCurrentShift();

    // 2. PROCESAMIENTO FINANCIERO DE ÍTEMS (PPP & MARGEN)
    const enrichedItems = saleData.items.map(item => {
        const qty = parseFloat(item.quantity);
        const costUnit = parseFloat(item.cost || 0);
        const priceSold = parseFloat(item.price); // Este es el PPP enviado por el usePos
        
        // Calculamos utilidad neta de la línea
        const lineProfit = (priceSold - costUnit) * qty;

        return {
            ...item,
            id: item.id,
            name: item.name,
            quantity: qty,
            cost: costUnit,               // Costo histórico
            originalPrice: parseFloat(item.originalPrice || item.price), // Precio lista
            price: priceSold,             // Precio cobrado (PPP)
            subtotal: parseFloat(item.subtotal),
            profit: parseFloat(lineProfit.toFixed(2)),
            appliedPromo: item.appliedPromo || false,
            promoLabel: item.promoLabel || ''
        };
    });

    // 3. ARMADO DEL OBJETO VENTA MAESTRO
    const totalProfit = enrichedItems.reduce((acc, item) => acc + item.profit, 0);

    const sale = {
      id: saleId,
      localId: saleId,
      number: finalNumber,
      branchId: targetBranchId,
      date: timestamp, 
      createdAt: timestamp,
      status: 'COMPLETED', 
      syncStatus: 'pending', 
      userId: user?.uid || 'unknown',
      userName: user?.name || 'Vendedor',
      companyId: user.companyId,
      shiftId: currentShift?.id || null,
      
      // Totales
      items: enrichedItems,
      itemCount: enrichedItems.reduce((acc, i) => acc + i.quantity, 0),
      subtotal: saleData.subtotal || saleData.total,
      discount: saleData.discount || 0,
      surcharge: saleData.surcharge || 0,
      total: saleData.total, // Monto final percibido
      
      // Inteligencia Nexus (Reporting)
      totalCost: enrichedItems.reduce((acc, i) => acc + (i.cost * i.quantity), 0),
      netProfit: parseFloat(totalProfit.toFixed(2)),
      
      client: saleData.client || null,
      
      // 🔥 SOPORTE SPLIT PAYMENTS (Array prioritario)
      payments: saleData.payments || (saleData.payment ? [saleData.payment] : [{ method: 'cash', total: saleData.total }]),
      
      // Compatibilidad Legacy
      payment: saleData.payment || { method: 'cash' },
      afip: saleData.afip || { status: 'SKIPPED' }
    };

    const movementsToCreate = [];
    const cashMovementsToCreate = []; // Array para múltiples movimientos de caja

    // 🔄 TRANSACCIÓN ATÓMICA LOCAL
    await dbLocal.transaction('rw', [
        dbLocal.sales, 
        dbLocal.config, 
        dbLocal.products, 
        dbLocal.movements, 
        dbLocal.cash_movements
    ], async () => {
        
        // 1. Guardar Venta
        await dbLocal.sales.put(sale);
        
        if (configKeyToUpdate) {
            await dbLocal.config.put({ key: configKeyToUpdate, value: nextSequenceVal });
        }

        // 2. DESCUENTO DE STOCK & KARDEX
        for (const item of enrichedItems) {
            const product = await dbLocal.products.get(item.id);
            
            if (product) {
                const newStock = (parseFloat(product.stock || 0) - item.quantity);
                
                // Manejo de lotes (FEFO) si existen
                let batches = product.batches || [];
                if (batches.length > 0) {
                    batches.sort((a, b) => new Date(a.dateAdded || 0) - new Date(b.dateAdded || 0));
                    let remaining = item.quantity;
                    batches = batches.map(batch => {
                        if (remaining <= 0) return batch;
                        const currentQty = parseFloat(batch.quantity);
                        if (currentQty >= remaining) {
                            batch.quantity = currentQty - remaining;
                            remaining = 0;
                        } else {
                            remaining -= currentQty;
                            batch.quantity = 0;
                        }
                        return batch;
                    });
                }

                await dbLocal.products.update(item.id, {
                    stock: newStock,
                    batches: batches,
                    updatedAt: timestamp,
                    syncStatus: 'pending_stock' 
                });
            }

            const movement = {
                id: `mov_${crypto.randomUUID()}`, 
                productId: item.id, 
                type: 'STOCK_OUT', 
                description: `Venta ${finalNumber} ${item.appliedPromo ? '[PROMO]' : ''}`,
                amount: item.quantity,
                date: timestamp,
                user: sale.userName, 
                refId: saleId,
                branchId: targetBranchId, 
                syncStatus: 'pending'
            };
            
            await dbLocal.movements.put(movement);
            movementsToCreate.push(movement); 
        }

        // 3. REGISTRO DE CAJA (SPLIT PAYMENTS ENGINE) 🔥
        // Iteramos sobre el array de pagos para generar N movimientos
        const paymentList = sale.payments;

        for (const p of paymentList) {
            // Validamos montos positivos
            const amount = parseFloat(p.total || p.amount || 0);
            if (amount <= 0) continue;

            const description = paymentList.length > 1 
                ? `Venta ${finalNumber} (${p.method.toUpperCase()})` 
                : `Venta ${finalNumber}`;

            const cashMovement = {
                 id: `cm_${crypto.randomUUID()}`,
                 type: 'IN',
                 subtype: 'SALE',
                 amount: amount, // Monto específico de este pago
                 description: description,
                 date: timestamp,
                 method: p.method, // Método específico (cash, card, qr...)
                 userId: user.uid,
                 branchId: targetBranchId, 
                 shiftId: currentShift?.id || null,
                 syncStatus: 'pending',
                 referenceId: saleId
            };

            await dbLocal.cash_movements.put(cashMovement);
            cashMovementsToCreate.push(cashMovement);
        }
    });
    
    // 4. ACTUALIZACIÓN CLOUD (BACKGROUND)
    // Sincronizamos stock de forma atómica en la nube
    const stockPromises = enrichedItems.map(item => {
        return productRepository.addStock(item.id, -item.quantity, `Venta ${finalNumber}`, user.name, targetBranchId)
            .catch(err => console.error(`Error cloud stock update:`, err));
    });
    Promise.all(stockPromises);

    // 5. SYNC OPTIMISTA (Cloud Replication)
    triggerOptimisticSync('sales', sale, user.companyId);
    movementsToCreate.forEach(m => triggerOptimisticSync('movements', m, user.companyId));
    // Sincronizamos todos los movimientos de caja generados
    cashMovementsToCreate.forEach(cm => triggerOptimisticSync('cash_movements', cm, user.companyId));

    return sale;
  },

  // ==========================================
  // 📖 CONSULTAS BLINDADAS
  // ==========================================

  async getSaleById(saleId) {
    if (!saleId) return null;
    const dbLocal = await getDB();
    let sale = await dbLocal.sales.get(saleId);
    if (sale) return sale;

    if (navigator.onLine) {
        try {
            const { user } = useAuthStore.getState();
            if (user?.companyId) {
                const docSnap = await getDoc(doc(db, `companies/${user.companyId}/sales`, saleId));
                if (docSnap.exists()) {
                    sale = docSnap.data();
                    await dbLocal.sales.put({ ...sale, syncStatus: 'synced' });
                    return sale;
                }
            }
        } catch (error) { console.warn("Error cloud fetch:", error); }
    }
    return null;
  },

  async getOperationsByDateRange(startDate, endDate) {
    const dbLocal = await getDB();
    const { user, activeBranchId } = useAuthStore.getState();
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    // Filtramos localmente por sucursal para coherencia Nexus
    const localSales = await dbLocal.sales
        .where('date').between(startISO, endISO, true, true)
        .filter(s => s.branchId === activeBranchId)
        .toArray();

    // En la nube buscamos todo el rango (el syncService se encarga de la consistencia)
    let cloudSales = [];
    if (navigator.onLine && user?.companyId) {
        try {
            const q = query(
                collection(db, `companies/${user.companyId}/sales`),
                where('branchId', '==', activeBranchId),
                where('date', '>=', startISO),
                where('date', '<=', endISO)
            );
            const snapshot = await getDocs(q);
            cloudSales = snapshot.docs.map(doc => ({ ...doc.data(), localId: doc.id }));
            if (cloudSales.length > 0) {
                await dbLocal.sales.bulkPut(cloudSales.map(s => ({ ...s, syncStatus: 'synced' }))).catch(()=>{});
            }
        } catch (e) { console.error("Cloud fetch error:", e); }
    }

    const salesMap = new Map();
    cloudSales.forEach(sale => salesMap.set(sale.localId || sale.id, sale));
    localSales.forEach(sale => {
        if (sale.syncStatus === 'pending' || !salesMap.has(sale.localId)) {
             salesMap.set(sale.localId, sale);
        }
    });

    return Array.from(salesMap.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  async getTodayOperations() {
    const start = new Date();
    start.setHours(0,0,0,0);
    const end = new Date();
    end.setHours(23,59,59,999);
    return this.getOperationsByDateRange(start, end);
  }
};