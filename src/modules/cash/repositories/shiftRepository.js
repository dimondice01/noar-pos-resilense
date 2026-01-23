import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore'; 

// Helper IDs
const generateId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

// ==========================================
// ☁️ HELPER: SYNC PRIVADO (Blindado por CompanyID)
// ==========================================
const triggerOptimisticSync = async (collectionName, data) => {
  if (!navigator.onLine) return;

  const { user } = useAuthStore.getState();
  if (!user || !user.companyId) return;

  try {
    const { syncStatus, ...cloudData } = data;
    const path = `companies/${user.companyId}/${collectionName}`;

    // Fire & Forget
    setDoc(doc(db, path, data.id), {
      ...cloudData,
      firestoreId: data.id,
      syncedAt: new Date().toISOString(),
      syncStatus: 'synced'
    }, { merge: true }).then(async () => {
        try {
            const dbLocal = await getDB();
            const table = collectionName === 'shifts' ? dbLocal.shifts : dbLocal.cash_movements;
            await table.update(data.id, { syncStatus: 'synced' });
        } catch (e) { /* ignore */ }
    });

  } catch (e) {
    console.warn(`⚠️ Error sync ${collectionName}:`, e);
  }
};

export const shiftRepository = {
  
  // ==========================================
  // 🕒 GESTIÓN DE TURNOS (Blindado por Usuario)
  // ==========================================

  /**
   * Busca si ESTE usuario tiene turno abierto
   */
  async getCurrentShift() {
    const { user } = useAuthStore.getState();
    if (!user) return null;

    const dbLocal = await getDB();
    
    // Dexie query: Busca caja OPEN del usuario actual
    return await dbLocal.shifts
        .where('status').equals('OPEN')
        .filter(s => s.userId === user.uid)
        .first();
  },

  /**
   * Historial (Admin ve todo, Cajero solo suyo)
   */
  async getAllShifts() {
    const { user } = useAuthStore.getState();
    if (!user) return [];

    const dbLocal = await getDB();
    
    if (user.role === 'ADMIN') {
        // Admin ve todo ordenado por fecha
        return await dbLocal.shifts.orderBy('openedAt').reverse().toArray();
    } else {
        // Cajero solo ve SUS turnos
        return await dbLocal.shifts
            .where('userId').equals(user.uid)
            .reverse()
            .sortBy('openedAt');
    }
  },

  /**
   * Abre turno (Blindado)
   */
  async openShift(initialAmount) {
    const { user } = useAuthStore.getState();
    if (!user) throw new Error("No autenticado");

    const dbLocal = await getDB();
    
    // Check concurrent open shift
    const current = await this.getCurrentShift();
    if (current) throw new Error("Ya tienes una caja abierta.");

    const shiftId = generateId('shift');
    const timestamp = new Date().toISOString();

    const newShift = {
      id: shiftId,
      status: 'OPEN',
      userId: user.uid,
      userEmail: user.email,
      userName: user.name || 'Cajero',
      companyId: user.companyId,
      openedAt: timestamp,
      initialAmount: parseFloat(initialAmount),
      finalAmount: 0,
      closedAt: null,
      difference: 0,
      syncStatus: 'pending'
    };

    // Movimiento Inicial
    const openingMovement = {
      id: generateId('mov'),
      shiftId: shiftId,
      type: 'DEPOSIT', 
      amount: parseFloat(initialAmount),
      description: 'Fondo Inicial de Caja',
      userId: user.uid,
      companyId: user.companyId,
      date: timestamp,
      syncStatus: 'pending'
    };

    // 1. Guardar Local (Transacción)
    await dbLocal.transaction('rw', [dbLocal.shifts, dbLocal.cash_movements], async () => {
        await dbLocal.shifts.put(newShift);
        await dbLocal.cash_movements.put(openingMovement);
    });

    // 2. Sync Nube
    triggerOptimisticSync('shifts', newShift);
    triggerOptimisticSync('cash_movements', openingMovement);

    return newShift;
  },

  /**
   * Cierre de Caja (Validación de Propiedad)
   */
  async closeShift(shiftId, declaredAmount, stats) {
    const dbLocal = await getDB();
    const shift = await dbLocal.shifts.get(shiftId);
    
    if (!shift) throw new Error("Turno no encontrado");

    // 🔥 SEGURIDAD: Solo dueño o Admin cierra
    const { user } = useAuthStore.getState();
    if (shift.userId !== user?.uid && user?.role !== 'ADMIN') {
        throw new Error("No tienes permiso para cerrar esta caja.");
    }

    const expectedAmount = stats.expectedTotal || 0; 
    const difference = declaredAmount - expectedAmount;

    const closedShift = {
      ...shift,
      status: 'CLOSED',
      finalAmount: parseFloat(declaredAmount),
      systemAmount: parseFloat(expectedAmount), // Guardamos lo que decía el sistema
      difference: difference,
      closedAt: new Date().toISOString(),
      stats: stats, // Guardamos resumen completo congelado
      syncStatus: 'pending'
    };

    await dbLocal.shifts.put(closedShift);
    triggerOptimisticSync('shifts', closedShift);

    return closedShift;
  },

  // ==========================================
  // 💸 MOVIMIENTOS EXTRA
  // ==========================================
  async addMovement(shiftId, type, amount, description) {
    if (amount <= 0) throw new Error("Monto debe ser positivo");
    if (!['WITHDRAWAL', 'DEPOSIT', 'EXPENSE'].includes(type)) throw new Error("Tipo inválido");

    const { user } = useAuthStore.getState();
    const dbLocal = await getDB();
    
    const movement = {
      id: generateId('mov'),
      shiftId,
      type,
      amount: parseFloat(amount),
      description,
      userId: user.uid,
      companyId: user.companyId,
      date: new Date().toISOString(),
      syncStatus: 'pending'
    };

    await dbLocal.cash_movements.put(movement);
    triggerOptimisticSync('cash_movements', movement);

    return movement;
  },

  /**
   * Obtener movimientos (Filtrado implícito por shiftId, que ya es único)
   */
  async getShiftMovements(shiftId) {
    const dbLocal = await getDB();
    return await dbLocal.cash_movements
        .where('shiftId').equals(shiftId)
        .reverse()
        .sortBy('date');
  }
};