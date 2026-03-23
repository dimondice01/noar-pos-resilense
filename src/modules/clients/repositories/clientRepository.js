import { getDB } from '../../../database/db';
import { db } from '../../../database/firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { useAuthStore } from '../../auth/store/useAuthStore'; 

// ==========================================
// ☁️ HELPER: SYNC OPTIMISTA
// ==========================================
const triggerOptimisticSync = async (collectionName, data) => {
  if (!navigator.onLine) return; 

  const { user } = useAuthStore.getState();
  if (!user || !user.companyId) return;

  try {
    const { syncStatus, ...cloudData } = data;
    const path = `companies/${user.companyId}/${collectionName}`;

    setDoc(doc(db, path, data.id), {
      ...cloudData,
      firestoreId: data.id,
      syncedAt: new Date().toISOString(),
      syncStatus: 'synced'
    }, { merge: true }).then(async () => {
        try {
            const dbLocal = await getDB();
            const table = dbLocal.table(collectionName);
            if (table) await table.update(data.id, { syncStatus: 'synced' });
        } catch (e) { }
    });
  } catch (e) {
    console.warn(`⚠️ Sync Optimista falló (${collectionName})`);
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
  // 🔢 GENERADOR DE ID SECUENCIAL (0001, 0002...)
  // ==========================================
  async generateNextId() {
      const dbLocal = await getDB();
      const count = await dbLocal.clients.count();
      return String(count + 1).padStart(4, '0'); // 4 dígitos para clientes
  },

  // ==========================================
  // 💰 GESTIÓN FINANCIERA (Transaccional & Trazable a Caja)
  // ==========================================

  async registerMovement(clientId, type, amount, description, referenceId = null, paymentMethod = 'cash') {
    const dbLocal = await getDB();
    const { user, activeBranchId } = useAuthStore.getState();
    
    if (!user) throw new Error("Usuario no autenticado");

    let newBalance = 0;
    const movementId = `ledger_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const timestamp = new Date().toISOString();
    const currentBranch = activeBranchId || user.branchId || 'main';

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

        const movement = {
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

        // 🔥 IMPACTO EN CAJA: Si el cliente PAGA deuda, entra dinero al cajero
        if (type === 'PAYMENT' && paymentMethod !== 'debt') {
            const activeShift = await dbLocal.shifts
                .where('status').equals('OPEN')
                .filter(s => s.userId === user.uid && s.branchId === currentBranch)
                .first();

            if (activeShift) {
                const cashMovement = {
                    id: `cm_${crypto.randomUUID()}`,
                    shiftId: activeShift.id,
                    type: 'RECEIPT', // 🔥 Tipo "RECEIPT" = Cobro de Deuda (Ingreso)
                    method: paymentMethod,
                    amount: parsedAmount,
                    description: `Cobro Cta.Cte.: ${client.name} - ${description}`,
                    date: timestamp,
                    branchId: currentBranch,
                    userId: user.uid,
                    companyId: user.companyId,
                    referenceId: movementId,
                    syncStatus: 'pending'
                };
                await dbLocal.cash_movements.put(cashMovement);
                triggerOptimisticSync('cash_movements', cashMovement);
            }
        }

        // Sincronización en segundo plano
        triggerOptimisticSync('clients', updatedClient);
        triggerOptimisticSync('customer_ledger', movement);
    });

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
    const id = client.id || crypto.randomUUID();
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
            deleteDoc(doc(db, path, id)).catch(console.error);
        } catch (e) {
            console.error("Error borrando cliente nube:", e);
        }
    }
  }
};