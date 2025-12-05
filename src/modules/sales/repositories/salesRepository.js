import { getDB } from '../../../database/db';

export const salesRepository = {
  /**
   * Crea una venta y descuenta stock atómicamente.
   * Maneja la transacción ACID: Venta + Stock + Kardex.
   */
  async createSale(saleData) {
    const db = await getDB();
    
    // 🔥 INICIO DE TRANSACCIÓN MULTI-STORE
    // Tocamos 'sales', 'products' y 'movements' simultáneamente.
    const tx = db.transaction(['sales', 'products', 'movements'], 'readwrite');
    
    const salesStore = tx.objectStore('sales');
    const productsStore = tx.objectStore('products');
    const movementsStore = tx.objectStore('movements');

    // 1. Preparar datos de la venta
    const saleId = `sale_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const sale = {
      ...saleData,
      localId: saleId,
      // Aseguramos que exista 'date' para el ordenamiento en listados
      date: saleData.date || new Date(), 
      createdAt: new Date(),
      status: 'COMPLETED', 
      syncStatus: 'PENDING',
    };

    // 2. Procesar cada ítem del carrito (Descuento de Stock)
    for (const item of saleData.items) {
        // a) Obtenemos el producto fresco de la DB
        const product = await productsStore.get(item.id);
        
        if (!product) {
            console.warn(`Producto ID ${item.id} no encontrado en DB, saltando stock...`);
            continue;
        }

        // b) Calcular nuevo stock
        const quantityToDeduct = item.isWeighable ? parseFloat(item.quantity) : parseInt(item.quantity);
        const newStock = (parseFloat(product.stock || 0) - quantityToDeduct);

        // c) Actualizar Producto y MARCAR PARA SYNC
        await productsStore.put({
            ...product,
            stock: newStock,
            updatedAt: new Date(),
            syncStatus: 'PENDING' // 👈 LA CLAVE DEL SYNC DE STOCK
        });

        // d) Registrar en KARDEX (Auditoría)
        await movementsStore.put({
            productId: product.id,
            type: 'STOCK_OUT', 
            description: `Venta POS #${saleId.slice(-4)}`,
            amount: -quantityToDeduct, 
            date: new Date(),
            user: saleData.client?.name || 'Cliente', 
            refId: saleId 
        });
    }

    // 3. Guardar la Venta
    await salesStore.put(sale);

    // 4. Confirmar Transacción
    await tx.done;
    
    return sale;
  },

  /**
   * 🔥 NUEVO MÉTODO UNIFICADO
   * Obtiene Ventas del día + Cobros de Deuda del día.
   * Normaliza los datos para que la tabla no falle.
   */
  async getTodayOperations() {
    const db = await getDB();
    const today = new Date();
    today.setHours(0,0,0,0);

    // 1. Obtener Ventas
    const allSales = await db.getAll('sales');
    const todaySales = allSales.filter(s => new Date(s.date) >= today);

    // 2. Obtener Cobros de Deuda (Desde Cash Movements)
    // Filtramos movimientos que sean ingresos de tipo 'DEPOSIT' y que parezcan cobros de clientes
    const allMovements = await db.getAll('cash_movements');
    const todayReceipts = allMovements.filter(m => 
        new Date(m.date) >= today && 
        m.type === 'DEPOSIT' && 
        (m.description || '').includes('Cobro Cta Cte') // Identificador clave del Dashboard
    );

    // 3. Normalizar Recibos para que parezcan Ventas en la tabla (Adapter Pattern)
    const normalizedReceipts = todayReceipts.map(r => ({
        localId: r.referenceId || `rec_${r.id}`,
        date: r.date,
        total: r.amount,
        type: 'RECEIPT', // 🚩 Flag para distinguir en UI
        
        // Intentamos extraer el nombre del cliente de la descripción "Cobro Cta Cte: Juan Perez"
        client: { name: r.description.split(': ')[1] || 'Cliente' },
        
        // Estructura de pago segura
        payment: { method: r.method || 'cash' },
        
        // Datos dummy para completar estructura de venta
        itemCount: 0, 
        items: [],
        afip: { status: 'SKIPPED' } // Recibos no se facturan
    }));

    // 4. Unir y Ordenar Cronológicamente (Más nuevo arriba)
    const combined = [...todaySales, ...normalizedReceipts];
    return combined.sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  // Mantener por compatibilidad (aunque getTodayOperations es el recomendado)
  async getTodaySales() {
    return this.getTodayOperations();
  }
};