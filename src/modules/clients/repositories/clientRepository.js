import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore'; 

// ==========================================
// ☁️ HELPER: SYNC OPTIMISTA (Fire & Forget)
// ==========================================
const triggerOptimisticSync = async (collectionName, data) => {
  if (!navigator.onLine) return; 

  const { user } = useAuthStore.getState();
  if (!user || !user.companyId) return;

  try {
    const { syncStatus, ...cloudData } = data;
    const path = `companies/${user.companyId}/${collectionName}`;

    // No await to avoid blocking UI
    setDoc(doc(db, path, data.id), {
      ...cloudData,
      firestoreId: data.id,
      syncedAt: new Date().toISOString(),
      syncStatus: 'synced'
    }, { merge: true }).then(async () => {
        // Update local status on success
        try {
            const dbLocal = await getDB();
            const table = collectionName === 'customer_ledger' ? dbLocal.customer_ledger : dbLocal.clients;
            await table.update(data.id, { syncStatus: 'synced' });
        } catch (e) { /* Ignore local update error */ }
    });
  } catch (e) {
    console.warn(`⚠️ Sync Optimista falló (${collectionName})`);
  }
};

export const clientRepository = {
  
  // ==========================================
  // 📖 LECTURA (Optimizado con Dexie)
  // ==========================================

  async getAll() {
    const dbLocal = await getDB();
    // Dexie: toArray() is fast. Sort in memory for <5000 clients is fine.
    const clients = await dbLocal.clients.toArray();
    return clients.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  },

  async getById(id) {
    const dbLocal = await getDB();
    return await dbLocal.clients.get(id);
  },

  /**
   * Obtiene el historial financiero (Ledger) de un cliente
   */
  async getLedger(clientId) {
    const dbLocal = await getDB();
    // Uso de índice 'clientId' es O(1)
    return await dbLocal.customer_ledger
        .where('clientId')
        .equals(clientId)
        .reverse() // Descending order (newest first)
        .sortBy('date');
  },

  /**
   * Búsqueda híbrida optimizada
   */
  async search(query) {
    const dbLocal = await getDB();
    const term = query.toLowerCase().trim();
    
    if (!term) return [];

    // Estrategia 1: Si es numérico, usar índice docNumber (Rápido)
    if (/^\d+$/.test(term)) {
        return await dbLocal.clients
            .where('docNumber')
            .startsWith(term)
            .toArray();
    }

    // Estrategia 2: Búsqueda por Nombre (Scan optimizado)
    return await dbLocal.clients
        .filter(c => 
            (c.name && c.name.toLowerCase().includes(term)) || 
            (c.email && c.email.toLowerCase().includes(term))
        )
        .toArray();
  },

  // ==========================================
  // 💰 GESTIÓN FINANCIERA (Transaccional)
  // ==========================================

  async registerMovement(clientId, type, amount, description, referenceId = null) {
    const dbLocal = await getDB();
    const { user, activeBranchId } = useAuthStore.getState();
    
    // Safety check
    if (!user) throw new Error("Usuario no autenticado");

    let newBalance = 0;
    
    // Generar IDs y Datos fuera de la transacción
    const movementId = `ledger_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const timestamp = new Date().toISOString();
    const currentBranch = activeBranchId || user.branchId || 'main';

    // 🔥 TRANSACCIÓN ACID: Balance + Movimiento
    await dbLocal.transaction('rw', [dbLocal.clients, dbLocal.customer_ledger], async () => {
        
        const client = await dbLocal.clients.get(clientId);
        if (!client) throw new Error("Cliente no encontrado");

        const currentBalance = parseFloat(client.balance || 0);
        
        // SALE_DEBT = Aumenta Deuda (+)
        // PAYMENT = Disminuye Deuda (-)
        newBalance = type === 'SALE_DEBT' 
            ? currentBalance + parseFloat(amount) 
            : currentBalance - parseFloat(amount);

        const movement = {
            id: movementId,
            clientId,
            date: timestamp,
            type,
            amount: parseFloat(amount),
            oldBalance: currentBalance,
            newBalance: newBalance,
            description,
            referenceId,
            branchId: currentBranch, // 👈 Trazabilidad: Dónde ocurrió
            userId: user.uid,        // 👈 Trazabilidad: Quién lo hizo
            syncStatus: 'pending'
        };

        const updatedClient = {
            ...client,
            balance: newBalance,
            updatedAt: timestamp,
            syncStatus: 'pending'
        };

        // Ejecutar actualizaciones atómicas
        await dbLocal.customer_ledger.put(movement);
        await dbLocal.clients.put(updatedClient);
        
        // Disparar sync (dentro de IIFE para no bloquear)
        // Usamos el helper que respeta la compañía del usuario logueado
        (async () => {
             triggerOptimisticSync('clients', updatedClient);
             triggerOptimisticSync('customer_ledger', movement);
        })();
    });

    return newBalance;
  },

  // ==========================================
  // ✍️ ABM (Cloud Enabled)
  // ==========================================

  async save(client) {
    const dbLocal = await getDB();
    const { user } = useAuthStore.getState();
    
    if (!user?.companyId) throw new Error("Sin sesión de empresa.");

    const clientToSave = {
      ...client,
      id: client.id || crypto.randomUUID(),
      name: client.name.toUpperCase().trim(),
      docNumber: client.docNumber ? client.docNumber.replace(/\D/g, '') : '',
      companyId: user.companyId, // Aseguramos tenant
      balance: client.balance || 0,
      updatedAt: new Date().toISOString(),
      syncStatus: 'pending'
    };

    // 1. Local
    await dbLocal.clients.put(clientToSave);

    // 2. Nube (Optimista)
    triggerOptimisticSync('clients', clientToSave);

    return clientToSave;
  },

  async delete(id) {
    const dbLocal = await getDB();
    const { user } = useAuthStore.getState();
    
    // 1. Local
    await dbLocal.clients.delete(id);

    // 2. Nube (Fire & Forget)
    if (navigator.onLine && user?.companyId) {
        try {
            const path = `companies/${user.companyId}/clients`;
            deleteDoc(doc(db, path, id)).catch(console.error);
        } catch (e) {
            console.error("Error borrando cliente nube:", e);
        }
    }
  }
};