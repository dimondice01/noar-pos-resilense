import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import {
    doc,
    setDoc,
    getDoc,
    collection,
    serverTimestamp,
    increment, // 🔥 IMPORTANTE: Atomicidad para Stock
    query,
    where,
    getDocs,
    onSnapshot,
    Timestamp
} from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import { productRepository } from '../../inventory/repositories/productRepository';
import { cashRepository } from '../../cash/repositories/cashRepository';

// ==========================================
// ☁️ HELPER: SYNC OPTIMISTA NEXUS CORE
// ==========================================
const triggerOptimisticSync = async (collectionName, data, companyId) => {
    if (!navigator.onLine || !companyId || !data) return;

    // 🔥 Sanitización recursiva: Elimina campos 'undefined' que rompen Firestore
    const sanitize = (obj) => {
        if (Array.isArray(obj)) return obj.map(sanitize);
        if (obj !== null && typeof obj === 'object') {
            return Object.fromEntries(
                Object.entries(obj)
                    .filter(([_, v]) => v !== undefined)
                    .map(([k, v]) => [k, sanitize(v)])
            );
        }
        return obj;
    };

    // 🔥 Fire and forget: No esperamos respuesta para no trabar la UI.
    try {
        const docId = data.id || data.localId;
        const cleanData = sanitize(data);
        
        // Operación no bloqueante (sin await en el flujo principal)
        const nowIso = new Date().toISOString();
        setDoc(doc(db, `companies/${companyId}/${collectionName}`, docId), {
            ...cleanData,
            firestoreId: docId,
            updatedAt: nowIso,
            syncedAt: nowIso,
            origin: 'POS_WEB',
            syncStatus: 'synced'
        }, { merge: true }).then(async () => {
             // Si tuvo éxito, marcamos en local como 'synced' silenciosamente
             try {
                 const dbLocal = await getDB();
                 if (collectionName === 'sales') {
                     await dbLocal.sales.update(docId, { syncStatus: 'synced' });
                 } else if (collectionName === 'cash_movements') {
                     await dbLocal.cash_movements.update(docId, { syncStatus: 'synced' });
                 }
             } catch (e) { console.warn("Error update local sync status", e); }
        }).catch(err => console.warn(`☁️ Sync optimista falló (${collectionName}), background sync lo tomará.`));
    } catch (err) {
        console.warn(`Error trigger sync`, err);
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
          // Intentamos obtener el punto de venta de la sucursal localmente
          const branch = await dbLocal.branches.get(branchId);
          if (branch && branch.number) ptoVta = branch.number;
          
          // Fallback a configuración si existe
          if (!branch) {
              const configPto = await dbLocal.config.get('afip_pto_vta');
              if (configPto) ptoVta = parseInt(configPto.value) || 1;
          }
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
  // 💰 CREAR VENTA (NEXUS PRO MAX ENGINE)
  // ==========================================
  async createSale(saleData) {
    const dbLocal = await getDB();
    const { user, activeBranchId } = useAuthStore.getState();
    
    if (!user?.companyId) throw new Error("Error crítico: Sesión inválida.");

    // 🔥 BLINDAJE DE SUCURSAL: Forzamos la sucursal activa
    const targetBranchId = activeBranchId || user.branchId || 'main';
    
    const saleId = saleData.id || `sale_${crypto.randomUUID()}`;
    const timestamp = saleData.createdAt || new Date().toISOString(); 
    
    // 1. GESTIÓN DE NUMERACIÓN LOCAL
    let finalNumber = saleData.number;
    let configKeyToUpdate = null;
    let nextSequenceVal = 0;

    if (!finalNumber) {
        // 🔥 Si es presupuesto forzamos la letra P
        const isBudget = saleData.type === 'BUDGET';
        const docType = isBudget ? 'P' : (saleData.afip?.status === 'APPROVED' ? saleData.afip.cbteLetra : 'X');
        
        const gen = await this._generateTicketNumber(docType, targetBranchId);
        finalNumber = gen.finalNumber;
        configKeyToUpdate = gen.configKey;
        nextSequenceVal = gen.nextSequence;
    }

    // Obtenemos turno actual para asociar (si existe)
    const currentShift = await cashRepository.getCurrentShift();

    // 2. PROCESAMIENTO FINANCIERO (PPP & MARGEN)
    const enrichedItems = saleData.items.map(item => {
        const qty = parseFloat(item.quantity);
        const costUnit = parseFloat(item.cost || 0);
        const priceSold = parseFloat(item.price); // PPP unitario
        
        // Calculamos utilidad neta de la línea para reportes BI
        const lineProfit = (priceSold - costUnit) * qty;

        return {
            ...item,
            id: item.id,
            name: item.name,
            quantity: qty,
            cost: costUnit,               
            originalPrice: parseFloat(item.originalPrice || item.price), 
            price: priceSold,             
            subtotal: parseFloat(item.subtotal),
            profit: parseFloat(lineProfit.toFixed(2)),
            appliedPromo: item.appliedPromo || false,
            promoLabel: item.promoLabel || ''
        };
    });

    const totalProfit = enrichedItems.reduce((acc, item) => acc + item.profit, 0);
    
    // 🔥 CONTROL DE TIPO DE OPERACIÓN
    const isBudget = saleData.type === 'BUDGET';

    // 3. ARMADO DEL OBJETO VENTA MAESTRO
    const sale = {
      id: saleId,
      localId: saleId,
      
      number: finalNumber,
      ticketNumber: finalNumber, 
      invoiceNumber: finalNumber,

      branchId: targetBranchId, 
      date: timestamp, 
      createdAt: timestamp,
      status: isBudget ? 'BUDGET' : 'COMPLETED', // Status claro
      type: isBudget ? 'BUDGET' : (saleData.type || 'SALE'), // Mantenemos el tipo
      syncStatus: 'pending',
      updatedAt: timestamp,
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
      total: saleData.total,
      
      // 🔥 FIX CRÍTICO: Aseguramos guardar los montos para el Historial (Si no se perdían)
      amountPaid: saleData.amountPaid || 0,
      amountDebt: saleData.amountDebt || 0,
      
      // Inteligencia Nexus (Reporting)
      totalCost: enrichedItems.reduce((acc, i) => acc + (i.cost * i.quantity), 0),
      netProfit: parseFloat(totalProfit.toFixed(2)),
      
      client: saleData.client || null,
      
      // Pagos
      method: saleData.method || (isBudget ? 'budget' : 'cash'),
      payments: saleData.payments || (saleData.payment ? [saleData.payment] : [{ method: isBudget ? 'budget' : 'cash', total: saleData.total }]),
      payment: saleData.payment || { method: isBudget ? 'budget' : 'cash' },

      // Afip
      afip: saleData.afip ? {
          ...saleData.afip,
          impNeto: saleData.afip.impNeto || 0,
          impIVA: saleData.afip.impIVA || 0
      } : { status: 'SKIPPED' }
    };

    const movementsToCreate = [];
    const cashMovementsToCreate = []; 

    // 🔄 TRANSACCIÓN ATÓMICA LOCAL (Dexie)
    await dbLocal.transaction('rw', [
        dbLocal.sales, 
        dbLocal.config, 
        dbLocal.products, 
        dbLocal.inventory, 
        dbLocal.movements, 
        dbLocal.cash_movements
    ], async () => {
        
        // A. Guardar Venta o Presupuesto
        await dbLocal.sales.put(sale);
        
        if (configKeyToUpdate) {
            await dbLocal.config.put({ key: configKeyToUpdate, value: nextSequenceVal });
        }

        // 🔥 BLOQUEO: Si es Presupuesto, NO hacemos nada más (Ni stock ni caja)
        if (isBudget) return;

        // B. DESCUENTO DE STOCK & KARDEX (Blindado por Sucursal)
        for (const item of enrichedItems) {
            const inventoryKey = [targetBranchId, item.id];
            
            const currentInv = await dbLocal.inventory.get(inventoryKey);
            const currentStock = currentInv ? parseFloat(currentInv.stock) : 0;
            const newStock = currentStock - item.quantity;

            await dbLocal.inventory.put({
                branchId: targetBranchId,
                productId: item.id,
                stock: newStock,
                stockDelta: -item.quantity,
                updatedAt: timestamp,
                syncStatus: 'pending'
            });

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

        // C. REGISTRO DE CAJA (SPLIT PAYMENTS ENGINE)
        const paymentList = sale.payments;

        for (const p of paymentList) {
            const amount = parseFloat(p.total || p.amount || 0);
            if (amount <= 0) continue;

            // 🔥 FIX CRÍTICO: La deuda ("account") NUNCA ingresa como dinero físico en la caja
            if (p.method === 'account' || p.method === 'debt') continue;

            const description = paymentList.length > 1 
                ? `Venta ${finalNumber} (${p.method.toUpperCase()})` 
                : `Venta ${finalNumber}`;

            const cashMovement = {
                 id: `cm_${crypto.randomUUID()}`,
                 type: 'IN',
                 subtype: 'SALE',
                 amount: amount, 
                 description: description,
                 date: timestamp,
                 method: p.method, 
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
    
    // 4. SYNC OPTIMISTA (Cloud Replication)
    triggerOptimisticSync('sales', sale, user.companyId);
    
    if (!isBudget) {
        cashMovementsToCreate.forEach(cm => triggerOptimisticSync('cash_movements', cm, user.companyId));
    }

    return sale;
  },

  // ==========================================
  // 📖 CONSULTAS BLINDADAS (Local-First Real)
  // ==========================================

  async getSaleById(saleId) {
    if (!saleId) return null;
    const dbLocal = await getDB();
    
    // 1. Intento Local (Rápido)
    let sale = await dbLocal.sales.get(saleId);
    if (sale) return sale;

    // 2. Intento Nube (Lento - Fallback solo si no está en local)
    if (navigator.onLine) {
        try {
            const { user } = useAuthStore.getState();
            if (user?.companyId) {
                const docSnap = await getDoc(doc(db, `companies/${user.companyId}/sales`, saleId));
                if (docSnap.exists()) {
                    sale = docSnap.data();
                    // Guardamos en local para la próxima
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
    const { activeBranchId } = useAuthStore.getState();
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    const localSales = await dbLocal.sales
        .where('date').between(startISO, endISO, true, true)
        .filter(s => s.branchId === activeBranchId) // Filtro estricto por sucursal
        .toArray();

    return localSales.sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  async getTodayOperations() {
    const start = new Date();
    start.setHours(0,0,0,0);
    const end = new Date();
    end.setHours(23,59,59,999);
    return this.getOperationsByDateRange(start, end);
  },

  // ==========================================
  // 🚨 AUDITORÍA DE SINIESTROS (ABANDONOS)
  // ==========================================
  async logAbandonedSale(saleData) {
    if (!saleData.items || saleData.items.length === 0) return null;
    
    const { user, activeBranchId } = useAuthStore.getState();
    if (!user?.companyId) return null;

    const saleId = `abnd_${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();
    const abndNumber = `ABND-${Date.now().toString().slice(-6)}`;

    const abandonedSale = {
      ...saleData,
      id: saleId,
      localId: saleId,
      number: abndNumber,
      ticketNumber: abndNumber,
      status: 'ABANDONED',
      type: 'ABANDONED',
      createdAt: timestamp,
      date: timestamp,
      companyId: user.companyId,
      branchId: activeBranchId || user.branchId || 'main',
      userId: user.uid,
      userName: user.name || 'Vendedor',
      syncStatus: 'pending'
    };

    try {
      const dbLocal = await getDB();
      await dbLocal.sales.put(abandonedSale);
      triggerOptimisticSync('sales', abandonedSale, user.companyId);
      return abandonedSale;
    } catch (e) {
      console.error("Error logging abandoned sale:", e);
      return null;
    }
  },

  // ==========================================
  // 🚨 AUDITORÍA DE SINIESTROS (REIMPL.)
  // ==========================================
  async registerAbandonedCart(saleData, reason = 'clear_cart') {
    if (!saleData.items || saleData.items.length === 0) return null;
    
    const { user, activeBranchId } = useAuthStore.getState();
    if (!user?.companyId) return null;

    const saleId = `abnd_${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();
    const abndNumber = `ABND-${Date.now().toString().slice(-6)}`;

    const abandonedSale = {
      ...saleData,
      id: saleId,
      localId: saleId,
      number: abndNumber,
      ticketNumber: abndNumber,
      status: 'ABANDONED',
      type: 'ABANDONED_CART',
      reason: reason,
      createdAt: timestamp,
      date: timestamp,
      companyId: user.companyId,
      branchId: activeBranchId || user.activeBranchId || user.branchId || 'main',
      userId: user.uid,
      userName: user.name || 'Vendedor',
      syncStatus: 'pending'
    };

    try {
      const dbLocal = await getDB();
      await dbLocal.sales.put(abandonedSale);
      triggerOptimisticSync('sales', abandonedSale, user.companyId);
      return abandonedSale;
    } catch (e) {
      console.error("Error logging abandoned sale:", e);
      return null;
    }
  },

  // ==========================================
  // 📥 SINCRONIZACIÓN DE BAJADA (CLOUD -> LOCAL)
  // ==========================================
  async saveFromCloud(saleData) {
    if (!saleData || !saleData.id) return null;

    try {
      const dbLocal = await getDB();

      // Verificamos si ya existe para no pisar estados locales 'pending' si el cloud es viejo
      const existing = await dbLocal.sales.get(saleData.id);
      if (existing && existing.syncStatus === 'pending') {
          // Si el local está pendiente, respetamos el local (el cloud se actualizará luego)
          return existing;
      }

      const saleToSave = {
          ...saleData,
          syncStatus: 'synced', // Marcamos como sincronizado ya que viene de la nube
          updatedAt: saleData.updatedAt || new Date().toISOString()
      };

      await dbLocal.sales.put(saleToSave);
      return saleToSave;
    } catch (e) {
      console.warn("Error saving sale from cloud:", e);
      return null;
    }
  },

  // ==========================================
  // ☁️ DELTA SYNC INICIAL (últimas 48h)
  // ==========================================
  async syncInitialSales(companyId, branchId) {
    if (!navigator.onLine || !companyId || !branchId) return;
    try {
      const margin = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const q = query(
        collection(db, `companies/${companyId}/sales`),
        where('branchId', '==', branchId),
        where('updatedAt', '>', Timestamp.fromDate(margin))
      );
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        await salesRepository.saveFromCloud(d.data());
      }
      window.dispatchEvent(new CustomEvent('noar:sales-synced'));
    } catch (e) {
      console.warn('☁️ syncInitialSales falló (offline?):', e);
    }
  },

  // ==========================================
  // 📡 LISTENER REAL-TIME (ventas nuevas/modificadas)
  // ==========================================
  startSalesListener(companyId, branchId) {
    if (!companyId || !branchId) return () => {};
    const liveStart = Timestamp.now();
    const q = query(
      collection(db, `companies/${companyId}/sales`),
      where('branchId', '==', branchId),
      where('updatedAt', '>=', liveStart)
    );
    return onSnapshot(q, (snap) => {
      snap.docChanges().forEach(async (change) => {
        if (change.type === 'added' || change.type === 'modified') {
          await salesRepository.saveFromCloud(change.doc.data());
        }
      });
      if (!snap.empty) {
        window.dispatchEvent(new CustomEvent('noar:sales-synced'));
      }
    }, (err) => console.warn('📡 salesListener error:', err));
  },

  async getSalesByClientId(clientId) {
    if (!clientId) return [];
    const dbLocal = await getDB();
    const all = await dbLocal.sales.toArray();
    return all.filter(s => s.client?.id === clientId && s.status !== 'abandoned');
  }
};