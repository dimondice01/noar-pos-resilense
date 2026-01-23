import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 

// ==========================================
// ☁️ HELPER: SYNC OPTIMISTA (Best Effort)
// ==========================================
// Intenta subir inmediatamente para UX rápida, pero si falla, 
// el syncService lo recogerá después porque queda en 'pending'.
const triggerOptimisticSync = async (collectionName, data) => {
  if (!navigator.onLine) return; 

  const { user } = useAuthStore.getState();
  if (!user || !user.companyId) return;

  // Ejecutamos sin await para no bloquear la UI del cajero (Fire & Forget)
  setDoc(doc(db, `companies/${user.companyId}/${collectionName}`, data.id || data.localId), {
      ...data,
      firestoreId: data.id || data.localId,
      syncedAt: new Date().toISOString(),
      origin: 'POS_WEB',
      syncStatus: 'synced' // En la nube ya es synced
  }, { merge: true }).then(async () => {
      // Si tuvo éxito, actualizamos localmente a synced
      try {
          const dbLocal = await getDB();
          if (collectionName === 'sales') {
              await dbLocal.sales.update(data.localId, { syncStatus: 'synced' });
          } else if (collectionName === 'movements') {
              await dbLocal.movements.update(data.id, { syncStatus: 'synced' });
          }
      } catch (e) { /* Ignorar error de update local secundario */ }
  }).catch(err => {
      console.warn(`☁️ Sync optimista falló (${collectionName}), se reintentará en background.`);
  });
};

export const salesRepository = {
  
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
  // 📅 OPERACIONES POR RANGO (Vital para SalesPage)
  // ==========================================
  async getOperationsByDateRange(startDate, endDate) {
    const dbLocal = await getDB();
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    // 1. Ventas en rango
    const sales = await dbLocal.sales
        .where('date')
        .between(startISO, endISO, true, true)
        .toArray();

    // 2. Cobros de Caja (Opcional)
    let receipts = [];
    try {
        receipts = await dbLocal.cash_movements
            .where('date')
            .between(startISO, endISO, true, true)
            .filter(m => m.type === 'DEPOSIT' && (m.description || '').includes('Cobro'))
            .toArray();
    } catch(e) { /* Si no existe tabla, ignorar */ }

    // Normalizar recibos
    const normReceipts = receipts.map(r => ({
        localId: r.referenceId || `rec_${r.id}`,
        date: r.date, 
        total: r.amount,
        type: 'RECEIPT', 
        client: { name: r.description.split(': ')[1] || 'Cliente' },
        payment: { method: r.method || 'cash' },
        itemCount: 0, items: [], afip: { status: 'SKIPPED' },
        userId: r.userId, createdBy: r.userEmail || r.userId, companyId: r.companyId
    }));

    // Combinar y ordenar por fecha descendente
    return [...sales, ...normReceipts].sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  // ==========================================
  // 💰 CREAR VENTA (Transacción Atómica)
  // ==========================================
  async createSale(saleData) {
    const dbLocal = await getDB();
    const { user } = useAuthStore.getState();
    
    // Generamos IDs y Timestamps
    const saleId = `sale_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const timestamp = new Date().toISOString(); 

    const sale = {
      ...saleData,
      localId: saleId, 
      date: saleData.date ? new Date(saleData.date).toISOString() : timestamp, 
      createdAt: timestamp,
      status: 'COMPLETED', 
      syncStatus: 'pending', // 👈 Clave para el SyncService
      userId: user?.uid || 'unknown',
      userName: user?.name || 'Vendedor'
    };

    const movementsToCreate = [];

    // 🔥 TRANSACCIÓN ACID: Todo o Nada.
    // Si falla el stock, no se guarda la venta.
    await dbLocal.transaction('rw', [dbLocal.sales, dbLocal.products, dbLocal.movements], async () => {
        
        // 1. Procesar ítems y descontar stock
        for (const item of saleData.items) {
            const product = await dbLocal.products.get(item.id);
            
            if (!product) continue; // O lanzar error si es estricto

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

            // Actualizar Producto
            await dbLocal.products.update(item.id, {
                stock: newStock,
                batches: batches,
                updatedAt: timestamp,
                syncStatus: 'pending' // Marcar para subir cambio de stock
            });

            // Crear Movimiento (Kardex)
            const movement = {
                id: `mov_${crypto.randomUUID()}`, // ID Único Global
                productId: product.id,
                type: 'STOCK_OUT', 
                description: `Venta POS #${saleId.slice(-4)}`,
                amount: -quantityToDeduct, 
                date: timestamp,
                user: sale.userName, 
                refId: saleId,
                syncStatus: 'pending'
            };
            
            // Guardar movimiento
            await dbLocal.movements.put(movement);
            movementsToCreate.push(movement); 
        }

        // 2. Guardar Venta
        await dbLocal.sales.put(sale);
    });
    
    // 3. Sync Optimista (Fuera de la transacción para no bloquear)
    triggerOptimisticSync('sales', sale);
    
    // 🔥 IMPORTANTE: Subir movimientos ahora para que la otra PC los vea YA.
    movementsToCreate.forEach(m => triggerOptimisticSync('movements', m));

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
    // pero limitamos por fecha (ej: ventas del mes actual hacia adelante)
    
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