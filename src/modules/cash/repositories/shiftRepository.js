import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore'; // 🔑 IMPORTANTE: Para el aislamiento

// Helper para IDs consistentes
const generateId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

// ==========================================
// ☁️ HELPER: SYNC AISLADO (SaaS)
// ==========================================
const syncToCloud = async (collectionName, data) => {
  if (!navigator.onLine) return;

  // 1. OBTENER ID EMPRESA
  const { user } = useAuthStore.getState();

  // 🛡️ SEGURIDAD: Si no hay empresa, abortamos para no ensuciar la raíz
  if (!user || !user.companyId) {
      console.warn(`⛔ Sync Turnos: Intento de escritura sin empresa asignada.`);
      return;
  }

  try {
    const { syncStatus, ...cloudData } = data;

    // 2. CONSTRUIR RUTA PRIVADA
    // companies/empresa_123/shifts
    // companies/empresa_123/cash_movements
    const path = `companies/${user.companyId}/${collectionName}`;

    await setDoc(doc(db, path, data.id), {
      ...cloudData,
      firestoreId: data.id,
      syncedAt: new Date().toISOString()
    }, { merge: true });
    
    // Marcar local como synced
    const dbLocal = await getDB();
    await dbLocal.put(collectionName, { ...data, syncStatus: 'SYNCED' });

  } catch (e) {
    console.warn(`⚠️ Error sincronizando ${collectionName} (Nube):`, e);
  }
};

export const shiftRepository = {
  
  // ==========================================
  // 🕒 GESTIÓN DE TURNOS (Apertura/Cierre)
  // ==========================================

  /**
   * Busca si hay un turno abierto actualmente
   */
  async getCurrentShift() {
    const dbLocal = await getDB();
    const tx = dbLocal.transaction('shifts', 'readonly');
    const index = tx.store.index('status');
    const openShift = await index.get('OPEN');
    return openShift;
  },

  /**
   * Obtener historial completo de turnos
   */
  async getAllShifts() {
    const dbLocal = await getDB();
    const shifts = await dbLocal.getAll('shifts');
    return shifts.sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
  },

  /**
   * Abre un nuevo turno de caja (Sync Local + Nube Aislada)
   */
  async openShift(userId, initialAmount) {
    const dbLocal = await getDB();
    
    const current = await this.getCurrentShift();
    if (current) throw new Error("Ya existe una caja abierta. Debe cerrarla primero.");

    const shiftId = generateId('shift');
    const timestamp = new Date().toISOString();

    const newShift = {
      id: shiftId,
      status: 'OPEN',
      userId: userId,
      openedAt: timestamp,
      initialAmount: parseFloat(initialAmount),
      finalAmount: 0,
      closedAt: null,
      difference: 0,
      syncStatus: 'PENDING'
    };

    // Movimiento de apertura
    const openingMovement = {
      id: generateId('mov'),
      shiftId: shiftId,
      type: 'DEPOSIT', // Estandarizado con cashRepository
      amount: parseFloat(initialAmount),
      description: 'Apertura de Caja',
      userId: userId,
      date: timestamp,
      syncStatus: 'PENDING'
    };

    // 1. Guardar Local (Transacción)
    const tx = dbLocal.transaction(['shifts', 'cash_movements'], 'readwrite');
    await tx.objectStore('shifts').put(newShift);
    await tx.objectStore('cash_movements').put(openingMovement);
    await tx.done;

    // 2. Subir a Nube (Background - Ruta Aislada)
    syncToCloud('shifts', newShift);
    syncToCloud('cash_movements', openingMovement);

    return newShift;
  },

  /**
   * Cierre de Caja (Sync Local + Nube Aislada)
   */
  async closeShift(shiftId, declaredAmount, stats) {
    const dbLocal = await getDB();
    const shift = await dbLocal.get('shifts', shiftId);
    if (!shift) throw new Error("Turno no encontrado");

    const expectedAmount = stats.expectedTotal; 
    const difference = declaredAmount - expectedAmount;

    const closedShift = {
      ...shift,
      status: 'CLOSED',
      finalAmount: parseFloat(declaredAmount),
      systemAmount: parseFloat(expectedAmount),
      difference: difference,
      closedAt: new Date().toISOString(),
      stats: stats,
      syncStatus: 'PENDING'
    };

    // 1. Actualizar Local
    await dbLocal.put('shifts', closedShift);

    // 2. Subir a Nube (Ruta Aislada)
    syncToCloud('shifts', closedShift);

    return closedShift;
  },

  // ==========================================
  // 💸 MOVIMIENTOS (Retiros / Ingresos)
  // ==========================================

  /**
   * Registra un movimiento manual (Sync Local + Nube Aislada)
   */
  async addMovement(shiftId, type, amount, description, userId) {
    if (amount <= 0) throw new Error("El monto debe ser positivo");
    if (!['WITHDRAWAL', 'DEPOSIT'].includes(type)) throw new Error("Tipo de movimiento inválido");

    const dbLocal = await getDB();
    
    const movement = {
      id: generateId('mov'),
      shiftId,
      type,
      amount: parseFloat(amount),
      description,
      userId,
      date: new Date().toISOString(),
      syncStatus: 'PENDING'
    };

    // 1. Guardar Local
    await dbLocal.put('cash_movements', movement);

    // 2. Subir a Nube (Ruta Aislada)
    syncToCloud('cash_movements', movement);

    return movement;
  },

  /**
   * Obtener movimientos de un turno
   */
  async getShiftMovements(shiftId) {
    const dbLocal = await getDB();
    // IndexedDB ya está aislada, así que leemos normal
    const movements = await dbLocal.getAllFromIndex('cash_movements', 'shiftId', shiftId);
    return movements.sort((a, b) => new Date(b.date) - new Date(a.date));
  }
};