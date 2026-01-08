import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore'; // Agregamos getDoc
import { useAuthStore } from '../../auth/store/useAuthStore'; 

// ==========================================
// ☁️ HELPER: SYNC AISLADO (SaaS)
// ==========================================
const syncToCloud = async (collectionName, data) => {
  if (!navigator.onLine) return; 

  const { user } = useAuthStore.getState();
  
  if (!user || !user.companyId) {
      console.warn(`⛔ Sync: Venta no subida (Sin empresa asignada). Se guardó local.`);
      return;
  }

  try {
    const { syncStatus, ...cloudData } = data;
    
    // Ruta aislada: companies/empresa_123/sales
    const path = `companies/${user.companyId}/${collectionName}`;

    await setDoc(doc(db, path, data.id || data.localId), {
      ...cloudData,
      firestoreId: data.id || data.localId,
      syncedAt: new Date().toISOString(),
      origin: 'POS_TABLET'
    }, { merge: true });
    
    if (collectionName === 'sales') {
        const dbLocal = await getDB();
        await dbLocal.put('sales', { ...data, syncStatus: 'SYNCED' });
    }
  } catch (e) {
    console.warn(`⚠️ Error sincronizando ${collectionName} (Nube):`, e);
  }
};

export const salesRepository = {
  
  // ==========================================
  // 🔥 NUEVO: BUSCAR VENTA POR ID (Local o Nube)
  // ==========================================
  async getSaleById(saleId) {
    if (!saleId) return null;

    // 1. Intentar buscar en Local (IndexedDB)
    const dbLocal = await getDB();
    let sale = await dbLocal.get('sales', saleId);

    if (sale) return sale;

    // 2. Si no está local, buscar en Nube (Cloud Firestore)
    if (navigator.onLine) {
        try {
            const { user } = useAuthStore.getState();
            if (user?.companyId) {
                // Buscamos en la ruta de la empresa
                const docRef = doc(db, `companies/${user.companyId}/sales`, saleId);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    sale = docSnap.data();
                    // Opcional: Cachearla en local para la próxima
                    await dbLocal.put('sales', sale);
                    return sale;
                }
            }
        } catch (error) {
            console.warn("Error buscando venta en nube:", error);
        }
    }
    return null;
  },

  /**
   * Crea una venta y descuenta stock atómicamente.
   */
  async createSale(saleData) {
    const dbLocal = await getDB();
    const tx = dbLocal.transaction(['sales', 'products', 'movements'], 'readwrite');
    
    const salesStore = tx.objectStore('sales');
    const productsStore = tx.objectStore('products');
    const movementsStore = tx.objectStore('movements');

    // 1. Preparar datos de la venta
    const saleId = `sale_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString(); 

    const sale = {
      ...saleData,
      localId: saleId, 
      date: saleData.date ? new Date(saleData.date).toISOString() : timestamp, 
      createdAt: timestamp,
      status: 'COMPLETED', 
      syncStatus: 'pending', 
    };

    const movementsToSync = [];

    // 2. Procesar ítems (Descuento Stock)
    for (const item of saleData.items) {
        const product = await productsStore.get(item.id);
        
        if (!product) continue;

        const quantityToDeduct = item.isWeighable ? parseFloat(item.quantity) : parseInt(item.quantity);
        const newStock = (parseFloat(product.stock || 0) - quantityToDeduct);

        // Lógica Lotes FIFO
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
                    return batch;
                } else {
                    remaining -= currentQty;
                    batch.quantity = 0;
                    return batch;
                }
            });
        }

        // Actualizar Producto Local
        await productsStore.put({
            ...product,
            stock: newStock,
            batches: batches,
            updatedAt: timestamp,
            syncStatus: 'pending' 
        });

        // Registrar Kardex
        const movement = {
            id: `mov_sale_${saleId}_${item.id}`,
            productId: product.id,
            type: 'STOCK_OUT', 
            description: `Venta POS #${saleId.slice(-4)}`,
            amount: -quantityToDeduct, 
            date: timestamp,
            user: saleData.sellerName || 'Cajero', 
            refId: saleId,
            syncStatus: 'pending'
        };

        await movementsStore.put(movement);
        movementsToSync.push(movement);
    }

    await salesStore.put(sale);
    await tx.done;
    
    // 3. Sync Cloud
    syncToCloud('sales', sale);
    movementsToSync.forEach(m => syncToCloud('movements', m));

    return sale;
  },

  /**
   * Obtiene Ventas del día + Cobros de Deuda.
   */
  async getTodayOperations() {
    const dbLocal = await getDB();
    const today = new Date();
    today.setHours(0,0,0,0);

    const allSales = await dbLocal.getAll('sales');
    const todaySales = allSales.filter(s => new Date(s.date) >= today);

    const allMovements = await dbLocal.getAll('cash_movements');
    const todayReceipts = allMovements.filter(m => 
        new Date(m.date) >= today && 
        m.type === 'DEPOSIT' && 
        (m.description || '').includes('Cobro Cta Cte') 
    );

    const normalizedReceipts = todayReceipts.map(r => ({
        localId: r.referenceId || `rec_${r.id}`,
        date: r.date, 
        total: r.amount,
        type: 'RECEIPT', 
        client: { name: r.description.split(': ')[1] || 'Cliente' },
        payment: { method: r.method || 'cash' },
        itemCount: 0, 
        items: [],
        afip: { status: 'SKIPPED' },
        // 🔥 Agregamos datos de usuario también aquí para que SalesPage filtre bien
        userId: r.userId,
        createdBy: r.userEmail || r.userId, 
        companyId: r.companyId
    }));

    const combined = [...todaySales, ...normalizedReceipts];
    return combined.sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  async getTodaySales() {
    return this.getTodayOperations();
  },

  async forcePendingState() {
    const dbLocal = await getDB();
    const tx = dbLocal.transaction('sales', 'readwrite');
    const store = tx.store;
    const allSales = await store.getAll();
    for (const sale of allSales) {
        sale.syncStatus = 'pending'; 
        store.put(sale);
    }
    await tx.done;
    return allSales.length;
  },

  // Monitor Fiscal
  async getFiscalStats() {
    const dbLocal = await getDB();
    const allSales = await dbLocal.getAll('sales');
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = now.getDay() || 7; 
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - dayOfWeek + 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let daily = 0;
    let weekly = 0;
    let monthly = 0;
    let lastFiscalTime = null;

    for (const sale of allSales) {
        if (sale.afip?.status === 'APPROVED') {
            const saleDate = new Date(sale.date);
            if (saleDate >= startOfDay) daily++;
            if (saleDate >= startOfWeek) weekly++;
            if (saleDate >= startOfMonth) monthly++;
            if (!lastFiscalTime || saleDate > lastFiscalTime) {
                lastFiscalTime = saleDate;
            }
        }
    }

    return { daily, weekly, monthly, lastTime: lastFiscalTime };
  }
};