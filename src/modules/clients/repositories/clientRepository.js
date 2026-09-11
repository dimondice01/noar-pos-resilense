import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, deleteDoc, collection, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { pushLedgerMovementWithBalanceIncrement } from '../services/customerLedgerService';

// 🔥 HELPER UNIVERSAL: Generador de IDs que funciona en cualquier navegador (reemplaza a crypto.randomUUID)
const generateId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

// ==========================================
// ☁️ HELPER: SYNC OPTIMISTA BLINDADO
// ==========================================
const triggerOptimisticSync = async (collectionName, data) => {
  if (!navigator.onLine) return; 

  const { user } = useAuthStore.getState();
  if (!user || !user.companyId) return;

  try {
    // 🔥 balance SOLO se muta vía customerLedgerService (transacción con increment()).
    // Re-subir el objeto 'client' local con ese campo pisaría el valor ya incrementado
    // en el servidor (merge reemplaza el campo entero, no lo combina con increment()).
    const { syncStatus, localId, balance, ...cloudData } = data;
    const path = `companies/${user.companyId}/${collectionName}`;
    
    // 🔥 FIX CRÍTICO: Firebase crashea si el ID es numérico. Lo forzamos a String.
    const cloudId = String(data.firestoreId || data.id);

    setDoc(doc(db, path, cloudId), {
      ...cloudData,
      firestoreId: cloudId,
      syncedAt: new Date().toISOString(),
      syncStatus: 'synced'
    }, { merge: true }).then(async () => {
        try {
            const dbLocal = await getDB();
            const table = dbLocal.table(collectionName);
            // Actualizamos en Dexie usando su ID original (sea número o string)
            if (table) await table.update(data.id, { syncStatus: 'synced', firestoreId: cloudId });
        } catch (e) { }
    }).catch(err => console.warn(`Error Firebase en ${collectionName}:`, err));
    
  } catch (e) {
    console.warn(`⚠️ Sync Optimista falló (${collectionName})`, e);
  }
};

export const clientRepository = {
  
  // ==========================================
  // 📖 LECTURA
  // ==========================================

  async getAll() {
    const dbLocal = await getDB();
    const clients = await dbLocal.clients.toArray();
    // Ordenamos por ID Secuencial (los más nuevos arriba)
    return clients.sort((a, b) => {
        const idA = parseInt(a.sequentialId || 0, 10);
        const idB = parseInt(b.sequentialId || 0, 10);
        return idB - idA;
    });
  },

  // Versión eficiente: trae solo los N más recientes sin cargar todo en memoria
  async getRecent(n = 10) {
    const dbLocal = await getDB();
    const clients = await dbLocal.clients.toArray();
    return clients
        .sort((a, b) => parseInt(b.sequentialId || 0, 10) - parseInt(a.sequentialId || 0, 10))
        .slice(0, n);
  },

  async getById(id) {
    const dbLocal = await getDB();
    return await dbLocal.clients.get(id);
  },

  async getLedger(clientId) {
    const dbLocal = await getDB();
    return await dbLocal.customer_ledger
        .where('clientId')
        .equals(clientId)
        .reverse() 
        .sortBy('date');
  },

  async search(query) {
    const dbLocal = await getDB();
    const term = query.toLowerCase().trim();
    
    if (!term) return [];

    if (/^\d+$/.test(term)) {
        return await dbLocal.clients
            .where('docNumber')
            .startsWith(term)
            .toArray();
    }

    return await dbLocal.clients
        .filter(c => 
            (c.name && c.name.toLowerCase().includes(term)) || 
            (c.email && c.email.toLowerCase().includes(term)) ||
            (c.sequentialId && c.sequentialId.includes(term))
        )
        .toArray();
  },

  // ==========================================
  // 🔢 GENERADOR DE ID SECUENCIAL A PRUEBA DE BORRADOS
  // ==========================================
  async generateNextId() {
      const dbLocal = await getDB();
      try {
          const lastClient = await dbLocal.clients.orderBy('sequentialId').reverse().first();
          const lastId = lastClient && lastClient.sequentialId ? parseInt(lastClient.sequentialId, 10) : 0;
          return String(lastId + 1).padStart(4, '0'); // 4 dígitos para clientes
      } catch (e) {
          // Fallback por si el índice sequentialId no está listo
          const count = await dbLocal.clients.count();
          return String(count + 1).padStart(4, '0');
      }
  },

  // ==========================================
  // 💰 GESTIÓN FINANCIERA (Transaccional & Trazable a Caja)
  // ==========================================

  async registerMovement(clientId, type, amount, description, referenceId = null, paymentMethod = 'cash') {
    const dbLocal = await getDB();
    const { user, activeBranchId } = useAuthStore.getState();
    
    if (!user) throw new Error("Usuario no autenticado");

    let newBalance = 0;
    let movement = null; // 🔥 se llena dentro de la transacción, se usa después para el push atómico
    const movementId = generateId('ledger'); // ID Blindado
    const timestamp = new Date().toISOString();
    // 🔥 Nunca adivinar con 'main': con más de una sucursal real ese id no
    // matchea ninguna y el movimiento del cliente queda huérfano.
    const currentBranch = activeBranchId || user.branchId;
    if (!currentBranch) throw new Error("Error Crítico: No se pudo determinar la sucursal activa para registrar el movimiento.");

    // 🔥 TRANSACCIÓN ACID: Ledger Cliente + Saldo Cliente + Movimiento de Caja
    await dbLocal.transaction('rw', [
        dbLocal.clients, 
        dbLocal.customer_ledger, 
        dbLocal.cash_movements, 
        dbLocal.shifts
    ], async () => {
        
        const client = await dbLocal.clients.get(clientId);
        if (!client) throw new Error("Cliente no encontrado");

        const currentBalance = parseFloat(client.balance || 0);
        const parsedAmount = parseFloat(amount);
        
        // SALE_DEBT = Aumenta Deuda (+)
        // PAYMENT = Disminuye Deuda (-)
        newBalance = type === 'SALE_DEBT' 
            ? currentBalance + parsedAmount 
            : currentBalance - parsedAmount;

        movement = {
            id: movementId,
            clientId,
            date: timestamp,
            type,
            amount: parsedAmount,
            oldBalance: currentBalance,
            newBalance: newBalance,
            description,
            referenceId,
            branchId: currentBranch,
            userId: user.uid,
            userName: user.name || user.email || 'Cajero',
            syncStatus: 'pending'
        };

        await dbLocal.customer_ledger.put(movement);
        
        const updatedClient = {
            ...client,
            balance: newBalance,
            updatedAt: timestamp,
            syncStatus: 'pending'
        };
        await dbLocal.clients.put(updatedClient);

        // 🔥 NOTA: registerMovement NO mueve caja. El caller es responsable de
        // llamar cashRepository.registerIncome() antes, si corresponde (así lo
        // hace hoy ClientDashboard.handlePaymentConfirm). Antes existía acá un
        // segundo cash_movement tipo RECEIPT para el mismo cobro — duplicaba el
        // efectivo esperado en caja (contado dos veces al cerrar turno). Eliminado.
    });

    // 🔥 CONTADOR ATÓMICO: escribe el movimiento e incrementa clients/{id}.balance
    // en la misma transacción (ver customerLedgerService) — idempotente frente a
    // reintentos, no depende de qué dispositivo tiene el balance más reciente.
    // Si falla o está offline, syncPendingCustomerLedger lo reintenta después.
    if (navigator.onLine && user.companyId) {
        pushLedgerMovementWithBalanceIncrement(user.companyId, movement)
            .then(async () => {
                try {
                    const dbLocal2 = await getDB();
                    await dbLocal2.customer_ledger.update(movementId, { syncStatus: 'synced' });
                } catch (e) { /* la cola de reintento lo toma después */ }
            })
            .catch(err => console.warn('☁️ Sync optimista (customer_ledger) falló, background sync lo tomará.', err));
    }

    return newBalance;
  },

  // ==========================================
  // ✍️ ABM (Fiscal Aware)
  // ==========================================

  validateForFiscal(client) {
      if (client.fiscalCondition === 'RESPONSABLE_INSCRIPTO') {
          if (client.docType !== '80') return { valid: false, error: 'RI requiere CUIT' };
          const cleanDoc = client.docNumber ? client.docNumber.replace(/\D/g, '') : '';
          if (cleanDoc.length !== 11) return { valid: false, error: 'CUIT debe tener 11 dígitos' };
      }
      if (client.docType === '80') {
          const cleanDoc = client.docNumber ? client.docNumber.replace(/\D/g, '') : '';
          if (cleanDoc.length !== 11) return { valid: false, error: 'CUIT inválido (largo incorrecto)' };
      }
      return { valid: true };
  },

  async save(client) {
    const dbLocal = await getDB();
    const { user } = useAuthStore.getState();
    
    if (!user?.companyId) throw new Error("Sin sesión de empresa.");

    const isNew = !client.id;
    // 🔥 Usamos generateId en lugar de crypto.randomUUID()
    const id = client.id || generateId('cli');
    const sequentialId = isNew ? await this.generateNextId() : client.sequentialId;

    const cleanDocNumber = client.docNumber ? client.docNumber.replace(/\D/g, '') : '';
    const cleanName = client.name.toUpperCase().trim();
    
    const fiscalCheck = this.validateForFiscal({ ...client, docNumber: cleanDocNumber });
    if (!fiscalCheck.valid) {
        throw new Error(`Error Fiscal: ${fiscalCheck.error}`);
    }

    const clientToSave = {
      ...client,
      id,
      sequentialId,
      name: cleanName,
      docType: client.docType || '96', 
      docNumber: cleanDocNumber,
      address: client.address || '-',
      fiscalCondition: client.fiscalCondition || 'CONSUMIDOR_FINAL', 
      companyId: user.companyId, 
      balance: parseFloat(client.balance || 0),
      updatedAt: new Date().toISOString(),
      syncStatus: 'pending'
    };

    if (isNew) clientToSave.createdAt = new Date().toISOString();

    await dbLocal.clients.put(clientToSave);
    triggerOptimisticSync('clients', clientToSave);

    return clientToSave;
  },

  async delete(id) {
    const dbLocal = await getDB();
    const { user } = useAuthStore.getState();
    
    const client = await dbLocal.clients.get(id);
    if (client && parseFloat(client.balance) > 0) {
        throw new Error("No se puede eliminar un cliente con deuda pendiente.");
    }

    await dbLocal.clients.delete(id);

    if (navigator.onLine && user?.companyId) {
        try {
            const path = `companies/${user.companyId}/clients`;
            // 🔥 Aseguramos que el ID de borrado en Firebase sea string
            deleteDoc(doc(db, path, String(client?.firestoreId || id))).catch(console.error);
        } catch (e) {
            console.error("Error borrando cliente nube:", e);
        }
    }
  },

  // ==========================================
  // 🩹 REPARACIÓN DE SALDOS (AUTOSERVICIO POR EMPRESA)
  // ==========================================
  // Recalcula clients/{id}.balance desde customer_ledger completo (sin límite
  // de paginación), con la misma regla de signo que ClientDashboard.currentDebt
  // (la única fuente que nunca estuvo corrompida). Scopeado automáticamente a
  // la empresa de la sesión activa — cada admin corrige solo sus propios clientes.

  async previewBalanceRecalculation() {
      const { user } = useAuthStore.getState();
      if (!user?.companyId) throw new Error("Sin sesión de empresa.");
      if (user.role !== 'ADMIN' && user.role !== 'OWNER') {
          throw new Error("Solo un administrador puede recalcular saldos.");
      }

      const clientsSnap = await getDocs(collection(db, `companies/${user.companyId}/clients`));
      const ledgerSnap = await getDocs(collection(db, `companies/${user.companyId}/customer_ledger`));

      // Suma con signo por cliente — misma regla que ClientDashboard.currentDebt
      const sumsByClient = new Map();
      ledgerSnap.docs.forEach(docSnap => {
          const d = docSnap.data();
          if (!d.clientId) return;
          const amount = parseFloat(d.amount) || 0;
          const delta = d.type === 'SALE_DEBT' ? amount : -amount;
          sumsByClient.set(d.clientId, (sumsByClient.get(d.clientId) || 0) + delta);
      });

      const diffs = [];
      clientsSnap.docs.forEach(docSnap => {
          const client = docSnap.data();
          const clientId = docSnap.id;
          const correctBalance = Math.max(0, sumsByClient.get(clientId) || 0);
          const oldBalance = parseFloat(client.balance || 0);
          const delta = correctBalance - oldBalance;

          // Umbral de $1 — ignora ruido de redondeo, mismo criterio que
          // hasDriftWarning en cashRepository._calculateShiftState.
          if (Math.abs(delta) > 1) {
              diffs.push({
                  clientId,
                  name: client.name || 'Cliente sin nombre',
                  oldBalance,
                  newBalance: correctBalance,
                  delta
              });
          }
      });

      return diffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  },

  async applyBalanceRecalculation(diffs) {
      const { user } = useAuthStore.getState();
      if (!user?.companyId) throw new Error("Sin sesión de empresa.");
      if (user.role !== 'ADMIN' && user.role !== 'OWNER') {
          throw new Error("Solo un administrador puede recalcular saldos.");
      }
      if (!Array.isArray(diffs) || diffs.length === 0) return { applied: 0 };

      const dbLocal = await getDB();
      const nowIso = new Date().toISOString();
      let applied = 0;

      // Tandas de 225 correcciones (2 writes c/u: cliente + log de auditoría)
      // para no pasar el límite de 500 operaciones por batch de Firestore.
      const CHUNK_SIZE = 225;
      for (let i = 0; i < diffs.length; i += CHUNK_SIZE) {
          const chunk = diffs.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(db);

          for (const d of chunk) {
              const clientRef = doc(db, `companies/${user.companyId}/clients`, String(d.clientId));
              batch.set(clientRef, { balance: d.newBalance, updatedAt: serverTimestamp() }, { merge: true });

              // 🔥 Auditoría: qué se corrigió, de cuánto a cuánto, quién y cuándo —
              // ningún documento histórico del ledger se toca ni se modifica.
              const repairRef = doc(collection(db, `companies/${user.companyId}/balance_repairs`));
              batch.set(repairRef, {
                  clientId: d.clientId,
                  clientName: d.name,
                  oldBalance: d.oldBalance,
                  newBalance: d.newBalance,
                  delta: d.delta,
                  appliedBy: user.uid,
                  appliedByName: user.name || user.email || 'Admin',
                  timestamp: nowIso
              });
          }

          await batch.commit();
          applied += chunk.length;

          for (const d of chunk) {
              try {
                  await dbLocal.clients.update(d.clientId, { balance: d.newBalance, updatedAt: nowIso, syncStatus: 'synced' });
              } catch (e) { /* no crítico: el próximo pull de clientes lo trae igual */ }
          }
      }

      return { applied };
  }
};