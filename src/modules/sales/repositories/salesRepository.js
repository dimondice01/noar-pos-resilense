import { getDB } from '../../../database/db';

export const salesRepository = {
  // Guardar una nueva venta
  async createSale(saleData) {
    const db = await getDB();
    const sale = {
      ...saleData,
      localId: `sale_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date(),
      status: 'COMPLETED', // O 'PENDING_CAE' si falta factura
      syncStatus: 'PENDING', // Falta subir a Firestore
    };
    
    await db.put('sales', sale);
    return sale;
  },

  // Obtener ventas del día (para el cierre de caja)
  async getTodaySales() {
    const db = await getDB();
    const all = await db.getAll('sales');
    // Filtro simple en memoria (idealmente usaríamos índices por fecha)
    const startOfDay = new Date();
    startOfDay.setHours(0,0,0,0);
    
    return all.filter(s => s.createdAt >= startOfDay);
  }
};