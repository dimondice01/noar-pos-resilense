import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { 
    doc, 
    setDoc, 
    getDoc, 
    getDocs,
    collection,
    query,
    where
} from 'firebase/firestore'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import { productRepository } from '../../inventory/repositories/productRepository';
import { cashRepository } from '../../cash/repositories/cashRepository'; // 🔥 IMPORT CRÍTICO

// ==========================================
// ☁️ HELPER: SYNC OPTIMISTA
// ==========================================
const triggerOptimisticSync = async (collectionName, data, companyId) => {
    if (!navigator.onLine) return; 
    if (!companyId) return;

    try {
        await setDoc(doc(db, `companies/${companyId}/${collectionName}`, data.id || data.localId), {
            ...data,
            firestoreId: data.id || data.localId,
            syncedAt: new Date().toISOString(),
            origin: 'POS_WEB',
            syncStatus: 'synced' 
        }, { merge: true });

        const dbLocal = await getDB();
        if (collectionName === 'sales') {
            await dbLocal.sales.update(data.localId, { syncStatus: 'synced' });
        } else if (collectionName === 'movements') {
            await dbLocal.movements.update(data.id, { syncStatus: 'synced' });
        } else if (collectionName === 'cash_movements') {
            await dbLocal.cash_movements.update(data.id, { syncStatus: 'synced' });
        }
    } catch (err) {
        console.warn(`☁️ Sync optimista falló (${collectionName}), se reintentará en background.`);
    }
};

export const salesRepository = {
  
  // ==========================================
  // 🔢 GENERADOR DE NÚMEROS DE TICKET
  // ==========================================
  async _generateTicketNumber(type = 'X', branchId) {
      const dbLocal = await getDB();
      
      let ptoVenta = 1;
      
      try {
          const branch = await dbLocal.branches.get(branchId);
          if (branch && branch.number) ptoVenta = branch.number;
      } catch(e) { }
      
      const configKey = `last_ticket_${type}_${ptoVenta}`;
      const lastConfig = await dbLocal.config.get(configKey);
      
      let nextSequence = 1;
      if (lastConfig) {
          nextSequence = parseInt(lastConfig.value) + 1;
      }

      const ptoVentaStr = String(ptoVenta).padStart(4, '0');
      const seqStr = String(nextSequence).padStart(8, '0');
      const finalNumber = `${type}-${ptoVentaStr}-${seqStr}`;

      return { finalNumber, nextSequence, configKey };
  },

  async getSaleById(saleId) {
    if (!saleId) return null;
    const dbLocal = await getDB();
    let sale = await dbLocal.sales.get(saleId);
    if (sale) return sale;

    if (navigator.onLine) {
        try {
            const { user } = useAuthStore.getState();
            if (user?.companyId) {
                const docRef = doc(db, `companies/${user.companyId}/sales`, saleId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    sale = docSnap.data();
                    await dbLocal.sales.put({ ...sale, syncStatus: 'synced' });
                    return sale;
                }
            }
        } catch (error) { console.warn("Error buscando venta en nube:", error); }
    }
    return null;
  },

  async getOperationsByDateRange(startDate, endDate) {
    const dbLocal = await getDB();
    const { user } = useAuthStore.getState();
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    const localSales = await dbLocal.sales
        .where('date')
        .between(startISO, endISO, true, true)
        .toArray();

    let cloudSales = [];
    if (navigator.onLine && user?.companyId) {
        try {
            const q = query(
                collection(db, `companies/${user.companyId}/sales`),
                where('date', '>=', startISO),
                where('date', '<=', endISO)
            );
            const snapshot = await getDocs(q);
            cloudSales = snapshot.docs.map(doc => ({ ...doc.data(), localId: doc.id }));
            
            if (cloudSales.length > 0) {
                const toCache = cloudSales.map(s => ({ ...s, syncStatus: 'synced' }));
                await dbLocal.sales.bulkPut(toCache).catch(e => {});
            }
        } catch (e) { console.error("Error fetching cloud sales:", e); }
    }

    let receipts = [];
    try {
        receipts = await dbLocal.cash_movements
            .where('date')
            .between(startISO, endISO, true, true)
            .filter(m => m.type === 'DEPOSIT' && (m.description || '').includes('Cobro'))
            .toArray();
    } catch(e) {}

    const normReceipts = receipts.map(r => ({
        localId: r.referenceId || `rec_${r.id}`,
        date: r.date, 
        total: r.amount,
        type: 'RECEIPT', 
        client: { name: r.description.split(': ')[1] || 'Cliente' },
        payment: { method: r.method || 'cash' },
        itemCount: 0, items: [], afip: { status: 'SKIPPED' },
        userId: r.userId, createdBy: r.userEmail || r.userId, companyId: r.companyId,
        number: `REC-${r.id.slice(-6)}`,
        branchId: r.branchId 
    }));

    const salesMap = new Map();
    cloudSales.forEach(sale => salesMap.set(sale.localId || sale.id, sale));
    localSales.forEach(sale => {
        if (sale.syncStatus === 'pending' || !salesMap.has(sale.localId)) {
             salesMap.set(sale.localId, sale);
        }
    });

    const allSales = Array.from(salesMap.values());
    return [...allSales, ...normReceipts].sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  // ==========================================
  // 💰 CREAR VENTA (FIX INTERESES + CAJA + AFIP)
  // ==========================================
  async createSale(saleData) {
    const dbLocal = await getDB();
    const { user, activeBranchId } = useAuthStore.getState();
    
    if (!user?.companyId) throw new Error("Error crítico: Sesión inválida (Sin Empresa).");

    const targetBranchId = activeBranchId || user.branchId || 'main';

    const saleId = saleData.id || `sale_${crypto.randomUUID()}`; // Usamos ID si viene de AFIP service
    const timestamp = saleData.createdAt || new Date().toISOString(); 
    
    // 🔥 LÓGICA DE NUMERACIÓN INTELIGENTE
    let finalNumber = saleData.number; // Si viene de AFIP, ya tiene número fiscal
    let configKeyToUpdate = null;
    let nextSequenceVal = 0;

    // Si NO tiene número (es venta local o Ticket X), lo generamos
    if (!finalNumber) {
        const docType = saleData.afip?.status === 'APPROVED' ? saleData.afip.cbteLetra : 'X';
        const gen = await this._generateTicketNumber(docType, targetBranchId);
        finalNumber = gen.finalNumber;
        configKeyToUpdate = gen.configKey;
        nextSequenceVal = gen.nextSequence;
    }

    // 2. LINK FUERTE: Obtenemos el turno activo para vincularlo a la venta
    const currentShift = await cashRepository.getCurrentShift();

    // 3. Armado del Objeto Venta (Asegurando campos de Auditoría)
    const sale = {
      ...saleData,
      id: saleId,
      localId: saleId,
      number: finalNumber,
      branchId: targetBranchId,
      date: saleData.date || timestamp, 
      createdAt: timestamp,
      status: 'COMPLETED', 
      syncStatus: 'pending', 
      userId: user?.uid || 'unknown',
      userName: user?.name || 'Vendedor',
      companyId: user.companyId,
      shiftId: currentShift ? currentShift.id : null,
      
      // 🛡️ Aseguramos que los campos de doble columna existan sí o sí
      total: saleData.totalSale || saleData.total, // El monto final cobrado
      baseAmount: saleData.baseAmount || saleData.total, // El monto de la mercadería
      surcharge: saleData.surcharge || 0, // El interés
      
      // Persistencia obligatoria de datos AFIP
      afip: saleData.afip || { status: 'SKIPPED' }
    };

    const movementsToCreate = [];
    let cashMovement = null;

    await dbLocal.transaction('rw', [dbLocal.sales, dbLocal.config, dbLocal.products, dbLocal.movements, dbLocal.cash_movements], async () => {
        
        await dbLocal.sales.put(sale);
        
        // Solo actualizamos el contador local si generamos nosotros el número
        if (configKeyToUpdate) {
            await dbLocal.config.put({ key: configKeyToUpdate, value: nextSequenceVal });
        }

        // A. Descuento de Stock
        for (const item of saleData.items) {
            const product = await dbLocal.products.get(item.id);
            
            if (product) {
                const quantityToDeduct = item.isWeighable ? parseFloat(item.quantity) : parseInt(item.quantity);
                const newStock = (parseFloat(product.stock || 0) - quantityToDeduct);

                let batches = product.batches || [];
                if (batches.length > 0) {
                    batches.sort((a, b) => new Date(a.dateAdded || 0) - new Date(b.dateAdded || 0));
                    let remaining = quantityToDeduct;
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
                description: `Venta ${finalNumber}`,
                amount: item.isWeighable ? parseFloat(item.quantity) : parseInt(item.quantity),
                date: timestamp,
                user: sale.userName, 
                refId: saleId,
                branchId: targetBranchId, 
                syncStatus: 'pending'
            };
            
            await dbLocal.movements.put(movement);
            movementsToCreate.push(movement); 
        }

        // B. Registro de Movimiento Financiero (CAJA / BANCO)
        const method = sale.payment?.method || 'cash';
        
        cashMovement = {
             id: `cm_${crypto.randomUUID()}`,
             type: 'IN', // Ingreso
             amount: sale.total, // Usamos el total con interés
             description: `Venta ${finalNumber} (${method.toUpperCase()}) ${sale.afip?.status === 'APPROVED' ? '[AFIP]' : ''}`,
             date: timestamp,
             method: method, // 'cash', 'card', 'qr', etc.
             userId: user.uid,
             branchId: targetBranchId, 
             shiftId: currentShift ? currentShift.id : null,
             subtype: 'SALE', 
             syncStatus: 'pending',
             referenceId: saleId // Link a la venta
        };

        await dbLocal.cash_movements.put(cashMovement);
    });
    
    // 4. DESCUENTO DE STOCK CLOUD (Background)
    const stockPromises = saleData.items.map(item => {
        const qty = item.isWeighable ? parseFloat(item.quantity) : parseInt(item.quantity);
        return productRepository.addStock(item.id, -qty, null, user.name, targetBranchId)
            .catch(err => console.error(`Error background stock update ${item.id}:`, err));
    });
    Promise.all(stockPromises);

    // 5. Sync Optimista Venta
    const saleToUpload = { ...sale, number: finalNumber };
    triggerOptimisticSync('sales', saleToUpload, user.companyId);
    
    // 6. Sync Optimista Movimientos de Stock
    movementsToCreate.forEach(m => triggerOptimisticSync('movements', m, user.companyId));

    // 7. Sync Optimista Movimiento Financiero (Caja)
    if (cashMovement) {
        triggerOptimisticSync('cash_movements', cashMovement, user.companyId);
    }

    return sale;
  },

  async getTodayOperations() {
    const start = new Date();
    start.setHours(0,0,0,0);
    const end = new Date();
    end.setHours(23,59,59,999);
    return this.getOperationsByDateRange(start, end);
  },

  async getTodaySales() {
    return this.getTodayOperations();
  },

  async forcePendingState() {
    const dbLocal = await getDB();
    return await dbLocal.sales
        .where('syncStatus')
        .notEqual('pending')
        .modify({ syncStatus: 'pending' });
  },

  async getFiscalStats() {
    const dbLocal = await getDB();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - (now.getDay() || 7) + 1);
    startOfWeek.setHours(0,0,0,0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const monthlySales = await dbLocal.sales
        .where('date')
        .aboveOrEqual(startOfMonth)
        .toArray();

    let daily = 0;
    let weekly = 0;
    let monthly = 0;
    let lastFiscalTime = null;
    const startOfWeekISO = startOfWeek.toISOString();

    for (const sale of monthlySales) {
        if (sale.afip?.status === 'APPROVED') {
            monthly++;
            if (sale.date >= startOfWeekISO) weekly++;
            if (sale.date >= startOfDay) daily++;
            if (!lastFiscalTime || sale.date > lastFiscalTime) {
                lastFiscalTime = sale.date;
            }
        }
    }
    return { daily, weekly, monthly, lastTime: lastFiscalTime };
  }
};