// src/modules/cash/repositories/shiftRepository.js
import { getDB } from '../../../database/db';

export const shiftRepository = {
  
  // ==========================================
  // 🕒 GESTIÓN DE TURNOS (Apertura/Cierre)
  // ==========================================

  /**
   * Busca si hay un turno abierto actualmente
   */
  async getCurrentShift() {
    const db = await getDB();
    const tx = db.transaction('shifts', 'readonly');
    const index = tx.store.index('status');
    // Buscamos el primero que esté 'OPEN'
    const openShift = await index.get('OPEN');
    return openShift;
  },

  /**
   * Obtener historial completo de turnos (Cierres Z)
   * Nuevo método para auditoría
   */
  async getAllShifts() {
    const db = await getDB();
    const shifts = await db.getAll('shifts');
    // Ordenar por fecha de apertura (Más reciente primero)
    return shifts.sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
  },

  /**
   * Abre un nuevo turno de caja
   */
  async openShift(userId, initialAmount) {
    const db = await getDB();
    
    // 1. Validar que no haya uno abierto
    const current = await this.getCurrentShift();
    if (current) throw new Error("Ya existe una caja abierta. Debe cerrarla primero.");

    const shiftId = `shift_${Date.now()}`;
    const timestamp = new Date();

    const newShift = {
      id: shiftId,
      status: 'OPEN',
      userId: userId,
      openedAt: timestamp,
      initialAmount: parseFloat(initialAmount),
      finalAmount: null,
      closedAt: null,
      difference: 0 // Sobrante o Faltante
    };

    // 2. Guardar Turno y Movimiento Inicial en transacción
    const tx = db.transaction(['shifts', 'cash_movements'], 'readwrite');
    
    await tx.objectStore('shifts').put(newShift);
    
    // Registramos la "Apertura" como el primer movimiento
    await tx.objectStore('cash_movements').put({
      id: `mov_${Date.now()}`,
      shiftId: shiftId,
      type: 'OPENING',
      amount: parseFloat(initialAmount),
      description: 'Apertura de Caja',
      userId: userId,
      date: timestamp
    });

    await tx.done;
    return newShift;
  },

  /**
   * Cierre de Caja (Arqueo)
   */
  async closeShift(shiftId, declaredAmount, stats) {
    const db = await getDB();
    const tx = db.transaction('shifts', 'readwrite');
    const store = tx.objectStore('shifts');
    
    const shift = await store.get(shiftId);
    if (!shift) throw new Error("Turno no encontrado");

    // Calculamos diferencia (Real vs Sistema)
    const expectedAmount = stats.expectedTotal; // Esto vendrá calculado
    const difference = declaredAmount - expectedAmount;

    shift.status = 'CLOSED';
    shift.finalAmount = declaredAmount;
    shift.systemAmount = expectedAmount;
    shift.difference = difference;
    shift.closedAt = new Date();
    shift.stats = stats; // Guardamos contadores de ventas, etc.

    await store.put(shift);
    await tx.done;
    return shift;
  },

  // ==========================================
  // 💸 MOVIMIENTOS (Retiros / Ingresos)
  // ==========================================

  /**
   * Registra un movimiento manual (Retiro o Ingreso)
   * REQUIERE userId (El Gerente que autorizó)
   */
  async addMovement(shiftId, type, amount, description, userId) {
    // Validaciones
    if (amount <= 0) throw new Error("El monto debe ser positivo");
    if (!['WITHDRAWAL', 'DEPOSIT'].includes(type)) throw new Error("Tipo de movimiento inválido");

    const db = await getDB();
    
    // Si es retiro, lo guardamos como negativo matemáticamente para facilitar sumas,
    // o positivo con type='WITHDRAWAL'. 
    // ESTRATEGIA: Guardar monto absoluto y usar el 'type' para sumar/restar en el reporte.
    
    const movement = {
      id: `mov_${Date.now()}`,
      shiftId,
      type, // 'WITHDRAWAL' | 'DEPOSIT'
      amount: parseFloat(amount),
      description,
      userId, // <--- AQUÍ ESTÁ LA TRAZABILIDAD (¿Quién fue?)
      date: new Date()
    };

    await db.put('cash_movements', movement);
    return movement;
  },

  /**
   * Obtener todos los movimientos de un turno
   * Actualizado para ordenar por fecha descendente
   */
  async getShiftMovements(shiftId) {
    const db = await getDB();
    const movements = await db.getAllFromIndex('cash_movements', 'shiftId', shiftId);
    return movements.sort((a, b) => new Date(b.date) - new Date(a.date));
  }
};