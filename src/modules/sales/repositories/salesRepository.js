import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { 
    doc, 
    setDoc, 
    getDoc, 
    getDocs,
    serverTimestamp,
    collection,
    query,
    where,
    orderBy
} from 'firebase/firestore'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import { productRepository } from '../../inventory/repositories/productRepository';

// ==========================================
// ☁️ HELPER: SYNC OPTIMISTA (Best Effort)
// ==========================================
// Sube inmediatamente para UX rápida. Si falla, el syncService lo recoge luego.
const triggerOptimisticSync = async (collectionName, data, companyId) => {
    if (!navigator.onLine) return; 
    if (!companyId) return;

    // 🔥 FIX: Ruta correcta multi-tenant: companies/{id}/{collection}
    try {
        await setDoc(doc(db, `companies/${companyId}/${collectionName}`, data.id || data.localId), {
            ...data,
            firestoreId: data.id || data.localId,
            syncedAt: new Date().toISOString(),
            origin: 'POS_WEB',
            syncStatus: 'synced' 
        }, { merge: true });

        // Si tuvo éxito, actualizamos localmente
        const dbLocal = await getDB();
        if (collectionName === 'sales') {
            await dbLocal.sales.update(data.localId, { syncStatus: 'synced' });
        } else if (collectionName === 'movements') {
            await dbLocal.movements.update(data.id, { syncStatus: 'synced' });
        }
    } catch (err) {
        console.warn(`☁️ Sync optimista falló (${collectionName}), se reintentará en background.`);
    }
};

export const salesRepository = {
  
  // ==========================================
  // 🔢 GENERADOR DE NÚMEROS DE TICKET (Enterprise)
  // ==========================================
  // Genera: TIPO-PTOVTA-SECUENCIAL (Ej: B-0001-00000045)
  // Soporta múltiples cajas por sucursal sin colisiones.
  async _generateTicketNumber(type = 'X') {
      const dbLocal = await getDB();
      const { activeBranchId } = useAuthStore.getState();
      
      // 1. Obtener Punto de Venta (Configuración de la Caja/Sucursal)
      let ptoVenta = 1;
      // Usamos 'main' si no hay sucursal seleccionada para evitar errores
      const branchId = activeBranchId || 'main';
      
      try {
          const branch = await dbLocal.branches.get(branchId);
          if (branch && branch.number) ptoVenta = branch.number;
      } catch(e) { /* Fallback a 1 */ }
      
      // 2. Obtener Último Correlativo Local para este Tipo y Punto de Venta
      const configKey = `last_ticket_${type}_${ptoVenta}`;
      const lastConfig = await dbLocal.config.get(configKey);
      
      let nextSequence = 1;
      if (lastConfig) {
          nextSequence = parseInt(lastConfig.value) + 1;
      }

      // 3. Formatear (Estándar Fiscal 0001-00000001)
      const ptoVentaStr = String(ptoVenta).padStart(4, '0');
      const seqStr = String(nextSequence).padStart(8, '0');
      const finalNumber = `${type}-${ptoVentaStr}-${seqStr}`;

      return { finalNumber, nextSequence, configKey };
  },

  // ==========================================
  // 🔍 BUSQUEDA HÍBRIDA (Local -> Nube)
  // ==========================================
  async getSaleById(saleId) {
    if (!saleId) return null;

    const dbLocal = await getDB();

    // 1. Local (Dexie API)
    let sale = await dbLocal.sales.get(saleId);
    if (sale) return sale;

    // 2. Nube (Firestore Fallback)
    if (navigator.onLine) {
        try {
            const { user } = useAuthStore.getState();
            if (user?.companyId) {
                const docRef = doc(db, `companies/${user.companyId}/sales`, saleId);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    sale = docSnap.data();
                    // Guardar en caché local para la próxima
                    await dbLocal.sales.put({ ...sale, syncStatus: 'synced' });
                    return sale;
                }
            }
        } catch (error) {
            console.warn("Error buscando venta en nube:", error);
        }
    }
    return null;
  },

  // ==========================================
  // 📅 OPERACIONES POR RANGO (HYBRID FETCH)
  // ==========================================
  // 🔥 ESTE ES EL MÉTODO QUE ARREGLA TU PROBLEMA DE DATOS VACÍOS
  async getOperationsByDateRange(startDate, endDate) {
    const dbLocal = await getDB();
    const { user } = useAuthStore.getState();
    
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    // 1. Obtener LOCAL (Dexie)
    const localSales = await dbLocal.sales
        .where('date')
        .between(startISO, endISO, true, true)
        .toArray();

    // 2. Obtener CLOUD (Firestore) - Para rellenar si borraste caché o estás en otro PC
    let cloudSales = [];
    if (navigator.onLine && user?.companyId) {
        try {
            // Consulta simple solo por fecha para evitar errores de índice compuesto
            const q = query(
                collection(db, `companies/${user.companyId}/sales`),
                where('date', '>=', startISO),
                where('date', '<=', endISO)
                // Nota: No usamos orderBy aquí para evitar exigir índice compuesto complejo si no existe
            );
            
            const snapshot = await getDocs(q);
            cloudSales = snapshot.docs.map(doc => ({ ...doc.data(), localId: doc.id }));
            
            // 💾 AUTO-SYNC: Guardar en local lo que bajamos de la nube para la próxima (Cache Warming)
            if (cloudSales.length > 0) {
                // Usamos bulkPut para ser eficientes y no bloquear la UI
                // Marcamos como 'synced' porque vienen de la nube
                const toCache = cloudSales.map(s => ({ ...s, syncStatus: 'synced' }));
                await dbLocal.sales.bulkPut(toCache).catch(e => console.warn("Cache warming warning:", e));
            }
        } catch (e) {
            console.error("Error fetching cloud sales:", e);
        }
    }

    // 3. Obtener Recibos de Caja (Local)
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
        branchId: r.branchId // Importante para filtros
    }));

    // 4. UNIFICACIÓN: Usamos un Map para eliminar duplicados (Local vs Cloud)
    // Priorizamos Cloud si hay conflicto (aunque deberían ser iguales)
    const salesMap = new Map();
    
    // Primero cloud (más autoritativo)
    cloudSales.forEach(sale => {
        salesMap.set(sale.localId || sale.id, sale);
    });
    
    // Luego local (puede tener updates pendientes más recientes)
    localSales.forEach(sale => {
        // Si está pendiente de sync, gana local. Si está synced, gana cloud o da igual.
        if (sale.syncStatus === 'pending' || !salesMap.has(sale.localId)) {
             salesMap.set(sale.localId, sale);
        }
    });

    const allSales = Array.from(salesMap.values());

    // 5. Retornar combinado y ordenado
    return [...allSales, ...normReceipts].sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  // ==========================================
  // 💰 CREAR VENTA (Transacción Atómica Enterprise)
  // ==========================================
  async createSale(saleData) {
    const dbLocal = await getDB();
    const { user, activeBranchId } = useAuthStore.getState();
    
    if (!user?.companyId) throw new Error("Error crítico: Sesión inválida (Sin Empresa).");

    // 1. Generar ID y Numeración Profesional
    const saleId = `sale_${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString(); 
    const docType = saleData.afip ? saleData.afip.type : 'X';
    const branchId = activeBranchId || user.branchId || 'main'; // 🔥 Contexto Seguro
    
    // Generamos número legible (B-0001-000045)
    const { finalNumber, nextSequence, configKey } = await this._generateTicketNumber(docType);

    const sale = {
      ...saleData,
      id: saleId, // 🔥 Estandarizamos para que coincida con localId
      localId: saleId,
      number: finalNumber, // ✅ Dato buscable
      branchId: branchId, // ✅ Dato Multisucursal
      date: saleData.date ? new Date(saleData.date).toISOString() : timestamp, 
      createdAt: timestamp,
      status: 'COMPLETED', 
      syncStatus: 'pending', 
      userId: user?.uid || 'unknown',
      userName: user?.name || 'Vendedor',
      companyId: user.companyId
    };

    const movementsToCreate = [];

    // 🔥 TRANSACCIÓN ACID LOCAL: Todo o Nada.
    // Incluye: Venta, Contador de Tickets, Movimiento de Caja, Movimientos de Stock (Local)
    
    await dbLocal.transaction('rw', [dbLocal.sales, dbLocal.config, dbLocal.products, dbLocal.movements, dbLocal.cash_movements], async () => {
        
        // A. Guardar Venta
        await dbLocal.sales.put(sale);

        // B. Actualizar Contador de Tickets
        await dbLocal.config.put({ key: configKey, value: nextSequence });

        // C. Procesar ítems y descontar stock (Lógica Local FIFO)
        for (const item of saleData.items) {
            const product = await dbLocal.products.get(item.id);
            
            if (product) {
                const quantityToDeduct = item.isWeighable ? parseFloat(item.quantity) : parseInt(item.quantity);
                const newStock = (parseFloat(product.stock || 0) - quantityToDeduct);

                // Lógica FIFO de Lotes
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

                // Actualizar Producto Local (Cache)
                await dbLocal.products.update(item.id, {
                    stock: newStock,
                    batches: batches,
                    updatedAt: timestamp,
                    syncStatus: 'pending' 
                });

                // Crear Movimiento Local (Kardex)
                const movement = {
                    id: `mov_${crypto.randomUUID()}`, 
                    productId: product.id,
                    type: 'STOCK_OUT', 
                    description: `Venta ${finalNumber}`,
                    amount: quantityToDeduct, // Positivo porque el tipo ya indica salida
                    date: timestamp,
                    user: sale.userName, 
                    refId: saleId,
                    branchId: sale.branchId,
                    syncStatus: 'pending'
                };
                
                await dbLocal.movements.put(movement);
                movementsToCreate.push(movement); 
            }
        }

        // D. Registrar Ingreso de Caja (Si fue en efectivo)
        // 🔥 FIX: Validamos que se guarde en el branch correcto
        if (sale.payment && sale.payment.method === 'cash') {
             await dbLocal.cash_movements.put({
                 id: `cm_${crypto.randomUUID()}`,
                 type: 'IN',
                 amount: sale.total,
                 description: `Venta ${finalNumber}`,
                 date: timestamp,
                 method: 'cash',
                 userId: user.uid,
                 branchId: branchId, // 🔥 Fundamental para el cierre de caja
                 shiftId: saleData.shiftId || null, // Ligamos al turno si viene
                 syncStatus: 'pending'
             });
        }
    });
    
    // 4. DESCUENTO DE STOCK DISTRIBUIDO (CLOUD)
    // Disparamos la actualización de stock en Firebase (Increment negativo)
    // Esto asegura integridad entre sucursales.
    const stockPromises = saleData.items.map(item => {
        const qty = item.isWeighable ? parseFloat(item.quantity) : parseInt(item.quantity);
        return productRepository.addStock(item.id, -qty, null, user.name)
            .catch(err => console.error(`Error background stock update ${item.id}:`, err));
    });
    // No esperamos (await) para no bloquear, pero iniciamos el proceso
    Promise.all(stockPromises);

    // 5. Sync Optimista Venta (Background)
    // 🔥 FORZAMOS que el campo 'number' se suba correctamente
    const saleToUpload = { ...sale, number: finalNumber };
    triggerOptimisticSync('sales', saleToUpload, user.companyId);
    
    // 6. Sync Optimista Movimientos (Background)
    movementsToCreate.forEach(m => triggerOptimisticSync('movements', m, user.companyId));

    return sale;
  },

  // ==========================================
  // 📅 OPERACIONES DEL DÍA (Optimizado)
  // ==========================================
  async getTodayOperations() {
    const start = new Date();
    start.setHours(0,0,0,0);
    const end = new Date();
    end.setHours(23,59,59,999);
    // Reutilizamos el método de rango para no duplicar lógica
    return this.getOperationsByDateRange(start, end);
  },

  // Alias para compatibilidad
  async getTodaySales() {
    return this.getTodayOperations();
  },

  // ==========================================
  // 🛠️ HERRAMIENTAS DE MANTENIMIENTO
  // ==========================================
  async forcePendingState() {
    const dbLocal = await getDB();
    // Actualización masiva con Dexie (Rápido)
    return await dbLocal.sales
        .where('syncStatus')
        .notEqual('pending')
        .modify({ syncStatus: 'pending' });
  },

  // ==========================================
  // 📊 MONITOR FISCAL (Reportes)
  // ==========================================
  async getFiscalStats() {
    const dbLocal = await getDB();
    const now = new Date();
    
    // Definir rangos de tiempo
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - (now.getDay() || 7) + 1);
    startOfWeek.setHours(0,0,0,0);
    
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Traemos solo las ventas que tienen AFIP aprobado para no iterar todo
    // Como no tenemos índice específico 'afip.status', filtramos en memoria
    
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