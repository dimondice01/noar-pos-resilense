import { getDB } from '../../../database/db';

export const cashRepository = {
  /**
   * Obtiene el turno actual abierto (si existe)
   */
  async getCurrentShift() {
    const db = await getDB();
    // Buscamos turnos abiertos usando el índice 'status'
    const allShifts = await db.getAllFromIndex('shifts', 'status');
    return allShifts.find(s => s.status === 'OPEN');
  },

  /**
   * Abre un nuevo turno de caja
   * @param {number} initialAmount - Fondo fijo / Cambio inicial
   * @param {string} userId - ID o nombre del usuario (opcional)
   */
  async openShift(initialAmount = 0, userId = 'Admin') {
    const db = await getDB();
    
    // Validar si ya hay uno abierto
    const current = await this.getCurrentShift();
    if (current) throw new Error("Ya existe una caja abierta. Debe cerrarla primero.");

    const shift = {
        id: `shift_${Date.now()}`,
        openedAt: new Date(),
        status: 'OPEN',
        initialAmount: parseFloat(initialAmount) || 0,
        userId: userId,
        syncStatus: 'PENDING'
    };

    await db.put('shifts', shift);
    return shift;
  },

  /**
   * Registra un ingreso de dinero (Venta, Cobro, etc.)
   */
  async registerIncome({ amount, description, referenceId, method }) {
    if (amount <= 0) return null; // Si no entra plata, no hay movimiento

    const db = await getDB();
    const shift = await this.getCurrentShift();

    if (!shift) throw new Error("No hay una caja abierta. Debe abrir turno para operar.");

    const movement = {
      shiftId: shift.id,
      type: 'DEPOSIT', // Ingreso
      concept: description.includes('Cobro Cta Cte') ? 'DEBT_PAYMENT' : 'SALE',
      amount: parseFloat(amount),
      method: method, // 'cash', 'mercadopago', etc.
      description: description,
      referenceId: referenceId, // ID de venta o recibo
      date: new Date(),
      syncStatus: 'PENDING'
    };

    await db.add('cash_movements', movement);
    return movement;
  },

  /**
   * 🔥 CALCULA EL BALANCE DEL TURNO (El método que faltaba)
   */
  async getShiftBalance(shiftId) {
    const db = await getDB();
    
    // Traer todos los movimientos asociados a este turno
    const allMovements = await db.getAllFromIndex('cash_movements', 'shiftId', shiftId);
    
    // Obtenemos el turno para saber el monto inicial
    const shift = await db.get('shifts', shiftId);
    const initialAmount = shift?.initialAmount || 0;

    // Estructura del Balance
    const balance = {
        totalCash: initialAmount,  // Efectivo Físico (Empieza con el cambio)
        totalDigital: 0,           // MP/Tarjetas
        salesCash: 0,              // Ventas en Efectivo
        salesDigital: 0,           // Ventas Digitales
        collections: 0,            // Cobranzas Cta Cte (Efectivo)
        withdrawals: 0,            // Retiros/Gastos
        initialAmount: initialAmount,
        movements: allMovements.sort((a, b) => new Date(b.date) - new Date(a.date)) // Historial ordenado
    };

    // Procesamos cada movimiento para sumarizar
    allMovements.forEach(m => {
        if (m.method === 'cash') {
            if (m.type === 'DEPOSIT') {
                balance.totalCash += m.amount;
                if (m.concept === 'DEBT_PAYMENT') balance.collections += m.amount;
                else balance.salesCash += m.amount;
            } else if (m.type === 'WITHDRAWAL') {
                balance.totalCash -= m.amount;
                balance.withdrawals += m.amount;
            }
        } else {
            // Pagos digitales no tocan el "totalCash" físico
            if (m.type === 'DEPOSIT') {
                balance.totalDigital += m.amount;
                balance.salesDigital += m.amount;
            }
        }
    });

    return balance;
  },

  /**
   * Cierra el turno actual con los datos del arqueo
   */
  async closeShift(shiftId, closingData) {
      const db = await getDB();
      const tx = db.transaction('shifts', 'readwrite');
      const store = tx.objectStore('shifts');

      const shift = await store.get(shiftId);
      if (!shift) throw new Error("Turno no encontrado");

      const closedShift = {
          ...shift,
          status: 'CLOSED',
          closedAt: new Date(),
          finalCount: closingData.declaredCash, // Declarado por el cajero
          expectedCount: closingData.expectedCash, // Calculado por sistema
          difference: closingData.difference, // Sobrante/Faltante
          digitalCount: closingData.declaredDigital,
          syncStatus: 'PENDING'
      };

      await store.put(closedShift);
      await tx.done;
      return closedShift;
  }
};