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
    limit,
    getAggregateFromServer,
    count,
    sum
} from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { productRepository } from '../../inventory/repositories/productRepository';
import { cashRepository } from '../../cash/repositories/cashRepository';
import { pushCashMovementWithShiftCounter } from '../../cash/services/shiftLedgerService';

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
            updatedAt: serverTimestamp(),
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

// =========================================================================
// ☁️ SYNC OPTIMISTA DE CASH_MOVEMENTS (CONTADOR ATÓMICO DE CAJA)
// =========================================================================
// A diferencia de triggerOptimisticSync, este push va por shiftLedgerService:
// escribe el cash_movement y, si corresponde, incrementa shifts/{shiftId}.runningTotals
// atómicamente en la misma transacción — así el "esperado" de un turno no depende
// de qué dispositivo tiene replicadas localmente las ventas de otro.
const pushCashMovementOptimistic = async (cm, companyId) => {
    if (!navigator.onLine || !companyId || !cm) return;
    try {
        await pushCashMovementWithShiftCounter(companyId, cm);
        const dbLocal = await getDB();
        await dbLocal.cash_movements.update(cm.id, { syncStatus: 'synced' });
    } catch (err) {
        console.warn('☁️ Sync optimista (cash_movements) falló, background sync lo tomará.', err);
    }
};

// ==========================================
// 🧮 DOMINIO DE ESTADOS/TIPOS VÁLIDOS PARA TOTALES (Auditoría)
// ==========================================
// 🔥 Espejo exacto del filtro client-side histórico (validForTotals en SalesPage.jsx).
// Firestore exige inclusión ('in'/'==') en vez de exclusión ('!=') para poder
// combinarse con el rango de 'date' en la misma query (todas las desigualdades
// de una query deben apuntar al mismo campo). Si se agrega un nuevo valor de
// `status` o `type` a una venta (en createSale, refund, anulación, etc.), HAY
// QUE ACTUALIZAR ESTA LISTA EN EL MISMO COMMIT — si no, esas ventas quedan
// excluidas SILENCIOSAMENTE de los totales agregados.
export const SALES_TOTALS_INCLUDED_STATUS = ['COMPLETED'];
export const SALES_TOTALS_INCLUDED_TYPES = ['SALE', 'RECEIPT', 'INTERNAL', 'ABANDONED_CART'];

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

    // 🔥 BLINDAJE DE SUCURSAL: Forzamos la sucursal activa. Nunca adivinar con
    // 'main' — con más de una sucursal real ese id no matchea ninguna y la
    // venta queda huérfana (invisible en reportes de esa sucursal).
    const targetBranchId = activeBranchId || user.branchId;
    if (!targetBranchId) throw new Error("Error Crítico: No se pudo determinar la sucursal activa para registrar la venta.");
    
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
            if (item.isCombo && Array.isArray(item.components) && item.components.length > 0) {
                // Combo: descontar stock de cada componente, no del combo en sí
                for (const comp of item.components) {
                    const compQty = comp.qty * item.quantity;
                    const compKey = [targetBranchId, comp.productId];
                    const compInv = await dbLocal.inventory.get(compKey);
                    const compStock = compInv ? parseFloat(compInv.stock) : 0;
                    // 🔥 FIX: acumular stockDelta pendiente (mismo motivo que la rama no-combo abajo)
                    const compPendingDelta = (compInv && compInv.syncStatus === 'pending') ? (parseFloat(compInv.stockDelta) || 0) : 0;

                    await dbLocal.inventory.put({
                        branchId: targetBranchId,
                        productId: comp.productId,
                        stock: compStock - compQty,
                        stockDelta: compPendingDelta - compQty,
                        promo: compInv?.promo || null,
                        updatedAt: timestamp,
                        syncStatus: 'pending'
                    });

                    const movement = {
                        id: `mov_${crypto.randomUUID()}`,
                        productId: comp.productId,
                        type: 'STOCK_OUT',
                        description: `Venta ${finalNumber} [COMBO: ${item.name}]`,
                        amount: compQty,
                        date: timestamp,
                        user: sale.userName,
                        refId: saleId,
                        branchId: targetBranchId,
                        syncStatus: 'pending'
                    };
                    await dbLocal.movements.put(movement);
                    movementsToCreate.push(movement);
                }
            } else {
                const inventoryKey = [targetBranchId, item.id];
                const currentInv = await dbLocal.inventory.get(inventoryKey);
                const currentStock = currentInv ? parseFloat(currentInv.stock) : 0;
                const newStock = currentStock - item.quantity;
                // 🔥 FIX: acumular stockDelta pendiente (no pisarlo) — si 2 líneas de la misma venta
                // (ej: producto padre + variante anexada) comparten productId, el put() anterior
                // ya escribió su propio delta parcial acá. Si lo reemplazamos en vez de sumarlo,
                // el push a Firestore (increment(stockDelta)) solo aplica el último delta y el
                // reconcile posterior pisa el stock local correcto con el valor incompleto de la nube.
                const pendingDelta = (currentInv && currentInv.syncStatus === 'pending') ? (parseFloat(currentInv.stockDelta) || 0) : 0;

                await dbLocal.inventory.put({
                    branchId: targetBranchId,
                    productId: item.id,
                    stock: newStock,
                    stockDelta: pendingDelta - item.quantity,
                    promo: currentInv?.promo || null,
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
        cashMovementsToCreate.forEach(cm => pushCashMovementOptimistic(cm, user.companyId));
    }

    return sale;
  },

  // ==========================================
  // 🔄 PARCHE DE RESULTADO ARCA/AFIP TARDÍO
  // ==========================================
  // La venta ya se creó y se imprimió como ticket de contingencia (X) porque ARCA
  // no respondió dentro del timeout de usePosController. Este método actualiza esa
  // MISMA venta cuando el pedido original (que sigue corriendo en segundo plano,
  // nunca se aborta) finalmente resuelve — con CAE o con error definitivo.
  async updateAfipResult(saleId, patch) {
    const dbLocal = await getDB();
    const { user } = useAuthStore.getState();
    const existing = await dbLocal.sales.get(saleId);
    if (!existing) return null;

    const updated = {
        ...existing,
        ...patch,
        afip: { ...existing.afip, ...patch.afip },
        syncStatus: 'pending',
        updatedAt: new Date().toISOString()
    };

    await dbLocal.sales.put(updated);
    if (user?.companyId) triggerOptimisticSync('sales', updated, user.companyId);
    return updated;
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
  // ☁️ FALLBACK BAJO DEMANDA (DISPOSITIVO SIN HISTORIAL LOCAL)
  // ==========================================
  // 🔥 Solo debe llamarse cuando Dexie ya devolvió 0 resultados para el rango exacto
  // (ej: dueño revisando reportes desde un dispositivo que nunca hizo la sync inicial).
  // NO reemplaza ni modifica syncInitialSales/syncService — es una lectura puntual,
  // acotada por fecha + limit(), que además cachea el resultado en Dexie para que
  // la próxima consulta del mismo rango sea gratis (0 lecturas).
  async fetchRemoteSalesRange(startDate, endDate, { limit: maxDocs = 500 } = {}) {
      const { user, activeBranchId } = useAuthStore.getState();
      const companyId = user?.companyId || user?.tenantId;
      if (!companyId) return [];

      try {
          const salesRef = collection(db, 'companies', companyId, 'sales');
          let q = query(
              salesRef,
              where('date', '>=', startDate.toISOString()),
              where('date', '<=', endDate.toISOString()),
              limit(maxDocs)
          );
          if (activeBranchId && activeBranchId !== 'ALL') {
              q = query(q, where('branchId', '==', activeBranchId));
          }

          console.log(`🔎 [fetchRemoteSalesRange] companyId=${companyId} branchId=${activeBranchId} date>=${startDate.toISOString()} date<=${endDate.toISOString()}`);
          const snapshot = await getDocs(q);
          console.log(`🔎 [fetchRemoteSalesRange] Firestore devolvió ${snapshot.size} docs.`);
          if (snapshot.empty) return [];

          const dbLocal = await getDB();
          const pendingSet = new Set(
              (await dbLocal.sales.where('syncStatus').equals('pending').toArray()).map(s => s.id)
          );

          const cloudSales = snapshot.docs
              .filter(docSnap => !pendingSet.has(docSnap.id))
              .map(docSnap => ({ ...docSnap.data(), id: docSnap.id, syncStatus: 'synced' }));

          if (cloudSales.length > 0) {
              await dbLocal.sales.bulkPut(cloudSales);
          }

          return cloudSales.sort((a, b) => new Date(b.date) - new Date(a.date));
      } catch (error) {
          console.warn('fetchRemoteSalesRange error:', error);
          return [];
      }
  },

  // ==========================================
  // 🧮 TOTALES EXACTOS VÍA AGREGACIÓN SERVER-SIDE
  // ==========================================
  // 🔥 count()/sum() de Firestore facturan por entradas de índice escaneadas
  // (no por documento bajado a memoria), así que da el total EXACTO de un rango
  // sin importar el volumen, sin el techo de limit() de fetchRemoteSalesRange.
  // Nunca lanza: si algo falla (offline, falta índice, permisos) devuelve null
  // y el llamador debe caer al reduce() client-side existente.
  async fetchRemoteSalesTotals(startDate, endDate, { filterAfip = false } = {}) {
      const { user, activeBranchId } = useAuthStore.getState();
      const companyId = user?.companyId || user?.tenantId;
      if (!companyId) return null;

      try {
          const salesRef = collection(db, 'companies', companyId, 'sales');
          const baseClauses = [
              where('date', '>=', startDate.toISOString()),
              where('date', '<=', endDate.toISOString()),
              where('status', 'in', SALES_TOTALS_INCLUDED_STATUS),
              where('type', 'in', SALES_TOTALS_INCLUDED_TYPES),
          ];
          if (activeBranchId && activeBranchId !== 'ALL') {
              baseClauses.push(where('branchId', '==', activeBranchId));
          }

          const aggSpec = { count: count(), gross: sum('total'), netProfit: sum('netProfit') };

          if (filterAfip) {
              // Caso simple: afip.status=='APPROVED' es una igualdad directa,
              // no choca con el rango de date -> 1 sola query de agregación.
              const q = query(salesRef, ...baseClauses, where('afip.status', '==', 'APPROVED'));
              const snap = await getAggregateFromServer(q, aggSpec);
              const d = snap.data();
              return { count: d.count || 0, gross: d.gross || 0, netProfit: d.netProfit || 0 };
          }

          // Caso general: no se puede excluir afip.status=='VOIDED' con un where
          // directo (sería una 2da desigualdad sobre otro campo, prohibido junto
          // al rango de date). Se resuelve restando: la sub-query VOIDED comparte
          // exactamente los mismos where de status/type que la principal, así que
          // es un subconjunto exacto de ella -> restar una vez no duplica ni
          // descuenta de más (los REFUNDED, que también quedan con afip.status
          // VOIDED, ya están excluidos de AMBAS queries por el where('status','in',...)).
          const mainQ = query(salesRef, ...baseClauses);
          const voidedQ = query(salesRef, ...baseClauses, where('afip.status', '==', 'VOIDED'));

          const [mainSnap, voidedSnap] = await Promise.all([
              getAggregateFromServer(mainQ, aggSpec),
              getAggregateFromServer(voidedQ, aggSpec)
          ]);
          const m = mainSnap.data();
          const v = voidedSnap.data();

          return {
              count: (m.count || 0) - (v.count || 0),
              gross: (m.gross || 0) - (v.gross || 0),
              netProfit: (m.netProfit || 0) - (v.netProfit || 0)
          };
      } catch (error) {
          console.warn('fetchRemoteSalesTotals error (fallback a reduce local):', error);
          return null;
      }
  },

  // 🔧 DEBUG DEV: consulta cruda a Firestore por rango de fecha, SIN filtrar por
  // branchId, y desglosa el conteo por branchId encontrado. Uso: window.__noarDebugSales('2026-08-01','2026-08-01')
  async debugSalesRange(startStr, endStr) {
      const { user } = useAuthStore.getState();
      const companyId = user?.companyId || user?.tenantId;
      if (!companyId) { console.warn('[debugSalesRange] No hay companyId en sesión'); return []; }

      const start = new Date(startStr + 'T00:00:00');
      const end = new Date(endStr + 'T23:59:59');
      const salesRef = collection(db, 'companies', companyId, 'sales');
      const q = query(
          salesRef,
          where('date', '>=', start.toISOString()),
          where('date', '<=', end.toISOString())
      );
      const snapshot = await getDocs(q);
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      const byBranch = {};
      docs.forEach(s => {
          const b = s.branchId || '(sin branchId)';
          byBranch[b] = (byBranch[b] || 0) + 1;
      });

      console.log(`[debugSalesRange] companyId=${companyId} rango=${start.toISOString()}..${end.toISOString()} → total=${docs.length}`);
      console.table(byBranch);

      // 🔎 Replica el filtro pendingSet que usa fetchRemoteSalesRange, para ver
      // cuántos docs cloud están siendo descartados por creer que son pendientes locales.
      const dbLocal = await getDB();
      const localPending = await dbLocal.sales.where('syncStatus').equals('pending').toArray();
      const pendingSet = new Set(localPending.map(s => s.id));
      const excluded = docs.filter(d => pendingSet.has(d.id));
      const wouldReturn = docs.filter(d => !pendingSet.has(d.id));

      console.log(`[debugSalesRange] Dexie local total 'pending': ${localPending.length}`);
      console.log(`[debugSalesRange] De los ${docs.length} docs cloud, ${excluded.length} están marcados 'pending' en Dexie local y SE EXCLUYEN. Quedarían: ${wouldReturn.length}`);
      if (excluded.length > 0) {
          console.log('[debugSalesRange] Ejemplo de local "pending" que bloquea un doc cloud real:', localPending.find(p => pendingSet.has(p.id)));
      }

      return docs;
  },

  // 🔧 DEBUG DEV: compara el total exacto (agregación server-side) contra el
  // reduce() client-side sobre TODOS los docs del rango, y avisa si hay
  // documentos con total/netProfit no-numérico (sum() los ignora en silencio).
  // Uso: window.__noarDebugTotals('2026-08-01','2026-08-01')
  async debugTotalsParity(startStr, endStr, { filterAfip = false } = {}) {
      const { user, activeBranchId } = useAuthStore.getState();
      const companyId = user?.companyId || user?.tenantId;
      if (!companyId) { console.warn('[debugTotalsParity] No hay companyId en sesión'); return; }

      const start = new Date(startStr + 'T00:00:00');
      const end = new Date(endStr + 'T23:59:59');

      const exact = await salesRepository.fetchRemoteSalesTotals(start, end, { filterAfip });

      const salesRef = collection(db, 'companies', companyId, 'sales');
      let q = query(salesRef, where('date', '>=', start.toISOString()), where('date', '<=', end.toISOString()));
      if (activeBranchId && activeBranchId !== 'ALL') q = query(q, where('branchId', '==', activeBranchId));
      const snapshot = await getDocs(q);
      const docs = snapshot.docs.map(d => d.data());

      const validForTotals = docs.filter(op =>
          op.afip?.status !== 'VOIDED' &&
          op.status !== 'REFUNDED' &&
          op.status !== 'ABANDONED' &&
          op.type !== 'BUDGET' &&
          (!filterAfip || op.afip?.status === 'APPROVED')
      );
      const gross = validForTotals.reduce((acc, op) => acc + (parseFloat(op.total) || 0), 0);
      const netProfit = validForTotals.reduce((acc, op) => acc + (parseFloat(op.netProfit) || 0), 0);
      const clientSide = { count: validForTotals.length, gross, netProfit };

      console.log('[debugTotalsParity] Agregación server-side:', exact);
      console.log('[debugTotalsParity] Reduce client-side (todos los docs del rango):', clientSide);
      if (exact) {
          console.log(`[debugTotalsParity] Delta count=${exact.count - clientSide.count} gross=${(exact.gross - clientSide.gross).toFixed(2)} netProfit=${(exact.netProfit - clientSide.netProfit).toFixed(2)} (debería ser 0)`);
      }

      const badTypeDocs = docs.filter(op => typeof op.total !== 'number' || typeof op.netProfit !== 'number');
      if (badTypeDocs.length > 0) {
          console.warn(`[debugTotalsParity] ⚠️ ${badTypeDocs.length} docs con total/netProfit NO numérico — sum() los ignora en silencio, esto explica cualquier delta.`, badTypeDocs.slice(0, 5));
      } else {
          console.log('[debugTotalsParity] ✅ Todos los docs del rango tienen total/netProfit numérico.');
      }

      return { exact, clientSide, badTypeCount: badTypeDocs.length };
  },

  // ==========================================
  // 🚨 AUDITORÍA DE SINIESTROS (ABANDONOS)
  // ==========================================
  async logAbandonedSale(saleData) {
    if (!saleData.items || saleData.items.length === 0) return null;
    
    const { user, activeBranchId } = useAuthStore.getState();
    if (!user?.companyId) return null;
    // 🔥 Nunca adivinar con 'main': si no hay sucursal resuelta, mejor no loguear
    // el abandono que loguearlo bajo una sucursal inventada.
    const branchId = activeBranchId || user.branchId;
    if (!branchId) return null;

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
      branchId,
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
    // 🔥 Nunca adivinar con 'main': si no hay sucursal resuelta, mejor no loguear
    // el abandono que loguearlo bajo una sucursal inventada.
    const branchId = activeBranchId || user.branchId;
    if (!branchId) return null;

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
      branchId,
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

  async getSalesByClientId(clientId) {
    if (!clientId) return [];
    const dbLocal = await getDB();
    const all = await dbLocal.sales.toArray();
    return all.filter(s => s.client?.id === clientId && s.status !== 'abandoned');
  }
};

// 🔧 DEBUG: expone debugSalesRange/debugTotalsParity en window (solo lectura, no
// escriben nada) para poder investigar diferencias de totales desde la consola del
// navegador en producción, tal como ya prometían los comentarios de esas funciones.
// Uso: window.__noarDebugSales('2026-08-31','2026-09-06')
//      window.__noarDebugTotals('2026-08-31','2026-09-06')
if (typeof window !== 'undefined') {
  window.__noarDebugSales = (startStr, endStr) => salesRepository.debugSalesRange(startStr, endStr);
  window.__noarDebugTotals = (startStr, endStr, opts) => salesRepository.debugTotalsParity(startStr, endStr, opts);

  // 🔧 DEBUG: lista las ventas que quedaron TRABADAS en esta PC/navegador (nunca
  // llegaron a la nube). syncPendingSales (syncService.js) deja de reintentar
  // después de 5 fallos (syncRetries >= 5) y las abandona en silencio — siguen acá
  // en Dexie, pero fuera del loop de reintento. Solo lectura, corre 100% local.
  // Uso: window.__noarDebugStuckSales() — CORRER EN LA PC/NAVEGADOR SOSPECHOSO,
  // no sirve desde otra máquina (lee IndexedDB local, no la nube).
  window.__noarDebugStuckSales = async () => {
    const dbLocal = await getDB();
    const all = await dbLocal.sales.filter(s => s.syncStatus !== 'synced').toArray();
    const stuck = all.filter(s => (s.syncRetries || 0) >= 5);
    const stillRetrying = all.filter(s => (s.syncRetries || 0) < 5);
    const total = stuck.reduce((acc, s) => acc + (parseFloat(s.total) || 0), 0);

    console.log(`[debugStuckSales] Total ventas no sincronizadas en esta PC: ${all.length}`);
    console.log(`[debugStuckSales] De esas, TRABADAS (syncRetries >= 5, abandonadas para siempre): ${stuck.length} — suma $${total.toFixed(2)}`);
    console.log(`[debugStuckSales] Todavía en cola de reintento (syncRetries < 5): ${stillRetrying.length}`);
    if (stuck.length > 0) {
      console.table(stuck.map(s => ({ id: s.id, date: s.date, total: s.total, shiftId: s.shiftId, syncRetries: s.syncRetries })));
      console.log('[debugStuckSales] Para forzar un reintento de estas, correr: window.__noarRetryStuckSales()');
    }
    return stuck;
  };

  // 🔧 Fuerza un reintento de las ventas trabadas (resetea syncRetries a 0 y llama
  // a syncPendingSales). Solo hace un intento más de subida — no inventa datos, si
  // el doc ya no está en Dexie no puede recuperar nada.
  window.__noarRetryStuckSales = async () => {
    const { user } = useAuthStore.getState();
    if (!user?.companyId) { console.warn('[retryStuckSales] No hay companyId en sesión'); return; }
    const dbLocal = await getDB();
    const stuck = await dbLocal.sales.filter(s => s.syncStatus !== 'synced' && (s.syncRetries || 0) >= 5).toArray();
    if (stuck.length === 0) { console.log('[retryStuckSales] No hay ventas trabadas para reintentar.'); return; }

    for (const s of stuck) {
      await dbLocal.sales.update(s.id, { syncRetries: 0 });
    }
    const { syncService } = await import('../../sync/services/syncService');
    const result = await syncService.syncPendingSales(user.companyId, useAuthStore.getState().activeBranchId);
    console.log(`[retryStuckSales] Reintentadas ${stuck.length} ventas trabadas. Resultado:`, result);
    return result;
  };
}