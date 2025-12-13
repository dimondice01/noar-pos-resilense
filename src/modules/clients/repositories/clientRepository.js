import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';

// Helper para subir a la nube sin bloquear la UI
const syncToCloud = async (collectionName, data) => {
  if (!navigator.onLine) return; // Si offline, lo agarra el syncService después
  
  try {
    const { syncStatus, ...cloudData } = data;
    // Usamos el mismo ID para mantener consistencia Local <-> Nube
    await setDoc(doc(db, collectionName, data.id), {
      ...cloudData,
      firestoreId: data.id,
      syncedAt: new Date().toISOString()
    }, { merge: true });
    
    // Marcar local como SYNCED
    const dbLocal = await getDB();
    await dbLocal.put(collectionName, { ...data, syncStatus: 'SYNCED' });
  } catch (e) {
    console.warn(`⚠️ Error sincronizando ${collectionName}:`, e);
  }
};

export const clientRepository = {
  // ==========================================
  // 📖 LECTURA (Local First - Velocidad)
  // ==========================================

  async getAll() {
    const db = await getDB();
    const clients = await db.getAll('clients');
    // Ordenar alfabéticamente
    return clients.sort((a, b) => a.name.localeCompare(b.name));
  },

  async getById(id) {
    const db = await getDB();
    return db.get('clients', id);
  },

  /**
   * Obtiene el historial financiero (Ledger) de un cliente
   */
  async getLedger(clientId) {
    const db = await getDB();
    const movements = await db.getAllFromIndex('customer_ledger', 'clientId', clientId);
    // Ordenamos por fecha descendente
    return movements.sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  /**
   * Búsqueda híbrida optimizada
   */
  async search(query) {
    const db = await getDB();
    const term = query.toLowerCase().trim();
    
    if (!term) return [];

    // Estrategia 1: Si es numérico, usar índice docNumber
    if (/^\d+$/.test(term)) {
        const byDoc = await db.getAllFromIndex('clients', 'docNumber');
        return byDoc.filter(c => c.docNumber.startsWith(term));
    }

    // Estrategia 2: Búsqueda por Nombre (Scan en memoria)
    const all = await db.getAll('clients');
    return all.filter(c => 
        c.name.toLowerCase().includes(term) || 
        (c.email && c.email.toLowerCase().includes(term))
    );
  },

  // ==========================================
  // 💰 GESTIÓN FINANCIERA (Cloud Enabled)
  // ==========================================

  async registerMovement(clientId, type, amount, description, referenceId = null) {
    const dbLocal = await getDB();
    
    // 1. Transacción Local (Atomicidad)
    const tx = dbLocal.transaction(['clients', 'customer_ledger'], 'readwrite');
    const clientStore = tx.objectStore('clients');
    const ledgerStore = tx.objectStore('customer_ledger');

    const client = await clientStore.get(clientId);
    if (!client) throw new Error("Cliente no encontrado");

    const currentBalance = client.balance || 0;
    
    // Calcular nuevo saldo
    const newBalance = type === 'SALE_DEBT' 
        ? currentBalance + amount 
        : currentBalance - amount;

    // Crear ID consistente para el movimiento
    const movementId = `ledger_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    const movement = {
        id: movementId,
        clientId,
        date: new Date().toISOString(),
        type,
        amount,
        oldBalance: currentBalance,
        newBalance: newBalance,
        description,
        referenceId,
        syncStatus: 'PENDING'
    };

    // Actualizar Cliente
    const updatedClient = {
        ...client,
        balance: newBalance,
        updatedAt: new Date().toISOString(),
        syncStatus: 'PENDING'
    };

    // Ejecutar en local
    await Promise.all([
        clientStore.put(updatedClient),
        ledgerStore.put(movement) // Usamos PUT con ID explícito
    ]);

    await tx.done;

    // 2. Sincronizar Nube (Background)
    // Disparamos ambas subidas en paralelo
    syncToCloud('clients', updatedClient);
    syncToCloud('customer_ledger', movement);

    return newBalance;
  },

  // ==========================================
  // ✍️ ABM (Cloud Enabled)
  // ==========================================

  async save(client) {
    const dbLocal = await getDB();
    
    const clientToSave = {
      ...client,
      id: client.id || crypto.randomUUID(),
      name: client.name.toUpperCase().trim(),
      docNumber: client.docNumber.replace(/\D/g, ''),
      balance: client.balance || 0,
      updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING'
    };

    // 1. Local
    await dbLocal.put('clients', clientToSave);

    // 2. Nube
    syncToCloud('clients', clientToSave);

    return clientToSave;
  },

  async delete(id) {
    const dbLocal = await getDB();
    
    // 1. Local
    await dbLocal.delete('clients', id);

    // 2. Nube (Si hay red)
    if (navigator.onLine) {
        try {
            await deleteDoc(doc(db, 'clients', id));
        } catch (e) {
            console.error("Error borrando cliente nube:", e);
        }
    }
  }
};