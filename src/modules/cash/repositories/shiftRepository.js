import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore'; // 🔑 CLAVE

// Helper IDs
const generateId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

// ==========================================
// ☁️ HELPER: SYNC PRIVADO (Blindado por CompanyID)
// ==========================================
const syncToCloud = async (collectionName, data) => {
  if (!navigator.onLine) return;

  const { user } = useAuthStore.getState();
  if (!user || !user.companyId) {
      console.warn(`⛔ Sync Abortado: Falta usuario o empresa.`);
      return;
  }

  try {
    const { syncStatus, ...cloudData } = data;
    // Ruta aislada: companies/{id}/shifts/{shiftId}
    const path = `companies/${user.companyId}/${collectionName}`;

    await setDoc(doc(db, path, data.id), {
      ...cloudData,
      firestoreId: data.id,
      syncedAt: new Date().toISOString()
    }, { merge: true });
    
    const dbLocal = await getDB();
    await dbLocal.put(collectionName, { ...data, syncStatus: 'SYNCED' });

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
    const all = await dbLocal.getAll('shifts');
    
    // 🔥 FILTRO EN MEMORIA: Solo turnos ABIERTOS de ESTE USUARIO
    return all.find(s => s.status === 'OPEN' && s.userId === user.uid);
  },

  /**
   * Historial (Admin ve todo, Cajero solo suyo)
   */
  async getAllShifts() {
    const { user } = useAuthStore.getState();
    if (!user) return [];

    const dbLocal = await getDB();
    const all = await dbLocal.getAll('shifts');
    
    let filtered = [];
    if (user.role === 'ADMIN') {
        // Admin ve todos los turnos de SU empresa
        filtered = all.filter(s => s.companyId === user.companyId);
    } else {
        // Cajero solo ve SUS turnos
        filtered = all.filter(s => s.userId === user.uid);
    }

    return filtered.sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
  },

  /**
   * Abre turno (Blindado)
   */
  async openShift(userId, initialAmount) {
    const { user } = useAuthStore.getState();
    if (!user) throw new Error("No autenticado");

    const dbLocal = await getDB();
    
    const current = await this.getCurrentShift();
    if (current) throw new Error("Ya tienes una caja abierta.");

    const shiftId = generateId('shift');
    const timestamp = new Date().toISOString();

    const newShift = {
      id: shiftId,
      status: 'OPEN',
      userId: user.uid,        // 🔥 ID Real
      userEmail: user.email,   // Trazabilidad
      userName: user.name || 'Cajero',
      companyId: user.companyId, // Aislamiento
      openedAt: timestamp,
      initialAmount: parseFloat(initialAmount),
      finalAmount: 0,
      closedAt: null,
      difference: 0,
      syncStatus: 'PENDING'
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
      syncStatus: 'PENDING'
    };

    // 1. Guardar Local
    const tx = dbLocal.transaction(['shifts', 'cash_movements'], 'readwrite');
    await tx.objectStore('shifts').put(newShift);
    await tx.objectStore('cash_movements').put(openingMovement);
    await tx.done;

    // 2. Sync Nube
    syncToCloud('shifts', newShift);
    syncToCloud('cash_movements', openingMovement);

    return newShift;
  },

  /**
   * Cierre de Caja (Validación de Propiedad)
   */
  async closeShift(shiftId, declaredAmount, stats) {
    const dbLocal = await getDB();
    const shift = await dbLocal.get('shifts', shiftId);
    
    if (!shift) throw new Error("Turno no encontrado");

    // 🔥 SEGURIDAD: Solo dueño o Admin cierra
    const { user } = useAuthStore.getState();
    if (shift.userId !== user?.uid && user?.role !== 'ADMIN') {
        throw new Error("No tienes permiso para cerrar esta caja.");
    }

    const expectedAmount = stats.expectedTotal; 
    const difference = declaredAmount - expectedAmount;

    const closedShift = {
      ...shift,
      status: 'CLOSED',
      finalAmount: parseFloat(declaredAmount),
      systemAmount: parseFloat(expectedAmount), // Guardamos lo que decía el sistema
      difference: difference,
      closedAt: new Date().toISOString(),
      stats: stats, // Guardamos resumen completo
      syncStatus: 'PENDING'
    };

    await dbLocal.put('shifts', closedShift);
    syncToCloud('shifts', closedShift);

    return closedShift;
  },

  // ==========================================
  // 💸 MOVIMIENTOS EXTRA
  // ==========================================
  async addMovement(shiftId, type, amount, description) {
    if (amount <= 0) throw new Error("Monto debe ser positivo");
    if (!['WITHDRAWAL', 'DEPOSIT'].includes(type)) throw new Error("Tipo inválido");

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
      syncStatus: 'PENDING'
    };

    await dbLocal.put('cash_movements', movement);
    syncToCloud('cash_movements', movement);

    return movement;
  },

  /**
   * Obtener movimientos (Filtrado implícito por shiftId, que ya es único)
   */
  async getShiftMovements(shiftId) {
    const dbLocal = await getDB();
    const movements = await dbLocal.getAllFromIndex('cash_movements', 'shiftId', shiftId);
    return movements.sort((a, b) => new Date(b.date) - new Date(a.date));
  }
};