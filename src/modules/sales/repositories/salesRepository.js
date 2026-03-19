import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { 
    doc, 
    setDoc, 
    getDoc, 
    collection, 
    serverTimestamp,
    increment // 🔥 IMPORTANTE: Atomicidad para Stock
} from 'firebase/firestore'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import { productRepository } from '../../inventory/repositories/productRepository';
import { cashRepository } from '../../cash/repositories/cashRepository';

// ==========================================
// ☁️ HELPER: SYNC OPTIMISTA NEXUS CORE
// ==========================================
const triggerOptimisticSync = async (collectionName, data, companyId) => {
    if (!navigator.onLine || !companyId) return;

    // 🔥 Fire and forget: No esperamos respuesta para no trabar la UI.
    try {
        const docId = data.id || data.localId;
        
        // Operación no bloqueante (sin await en el flujo principal)
        setDoc(doc(db, `companies/${companyId}/${collectionName}`, docId), {
            ...data,
            firestoreId: docId,
            syncedAt: new Date().toISOString(),
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
      
      // Inteligencia Nexus (Reporting)
      totalCost: enrichedItems.reduce((acc, i) => acc + (i.cost * i.quantity), 0),
      netProfit: parseFloat(totalProfit.toFixed(2)),
      
      client: saleData.client || null,
      
      // Pagos
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
    
    // 4. ACTUALIZACIÓN CLOUD ATÓMICA (BLINDAJE DE STOCK) - Solo si no es Presupuesto
    if (!isBudget) {
        enrichedItems.forEach(item => {
            const stockRef = doc(db, `companies/${user.companyId}/branches/${targetBranchId}/inventory`, item.id);
            setDoc(stockRef, { 
                stock: increment(-item.quantity), 
                updatedAt: serverTimestamp() 
            }, { merge: true }).catch(err => console.error("Error atomic stock decrement:", err));
        });
    }

    // 5. SYNC OPTIMISTA (Cloud Replication)
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
  }
};