// src/modules/clients/repositories/clientRepository.js
import { getDB } from '../../../database/db';

export const clientRepository = {
  // ==========================================
  // 📖 LECTURA
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
   * Ordenado del más reciente al más antiguo.
   */
  async getLedger(clientId) {
    const db = await getDB();
    // Obtenemos todos los movimientos de este cliente
    const movements = await db.getAllFromIndex('customer_ledger', 'clientId', clientId);
    // Ordenamos por fecha descendente
    return movements.sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  /**
   * Búsqueda híbrida optimizada para el POS
   * @param {string} query - Texto a buscar (Nombre, DNI o CUIT)
   */
  async search(query) {
    const db = await getDB();
    const term = query.toLowerCase().trim();
    
    if (!term) return [];

    // Estrategia 1: Si es numérico, usar índice docNumber (Muy rápido)
    if (/^\d+$/.test(term)) {
        const byDoc = await db.getAllFromIndex('clients', 'docNumber');
        // Filtramos "starts with" para búsqueda parcial
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
  // 💰 GESTIÓN FINANCIERA (Cuenta Corriente)
  // ==========================================

  /**
   * Registra un movimiento en la Cta Cte y actualiza el saldo de forma ATÓMICA.
   * @param {string} clientId 
   * @param {string} type - 'SALE_DEBT' (Fiado/Deuda) | 'PAYMENT' (Pago/Entrega)
   * @param {number} amount - Monto positivo siempre
   * @param {string} description 
   * @param {string} referenceId - ID de la venta o recibo asociado (opcional)
   */
  async registerMovement(clientId, type, amount, description, referenceId = null) {
    const db = await getDB();
    // Usamos una transacción que abarca ambas tablas para garantizar integridad
    const tx = db.transaction(['clients', 'customer_ledger'], 'readwrite');
    
    const clientStore = tx.objectStore('clients');
    const ledgerStore = tx.objectStore('customer_ledger');

    // 1. Obtener cliente actual para saber su saldo previo
    const client = await clientStore.get(clientId);
    if (!client) throw new Error("Cliente no encontrado");

    const currentBalance = client.balance || 0;
    
    // 2. Calcular nuevo saldo
    // SALE_DEBT (Fiado) -> Aumenta la deuda (Saldo positivo)
    // PAYMENT (Pago)    -> Disminuye la deuda
    const newBalance = type === 'SALE_DEBT' 
        ? currentBalance + amount 
        : currentBalance - amount;

    // 3. Crear el registro en el Ledger
    const movement = {
        clientId,
        date: new Date(),
        type,
        amount,
        oldBalance: currentBalance,
        newBalance: newBalance,
        description,
        referenceId,
        syncStatus: 'PENDING' // Para subir a Firestore
    };

    // 4. Actualizar Cliente
    client.balance = newBalance;
    client.updatedAt = new Date();
    client.syncStatus = 'PENDING';

    // 5. Ejecutar operaciones en paralelo dentro de la transacción
    await Promise.all([
        clientStore.put(client),
        ledgerStore.add(movement)
    ]);

    await tx.done;
    return newBalance;
  },

  // ==========================================
  // ✍️ ABM BÁSICO (Local First)
  // ==========================================

  async save(client) {
    const db = await getDB();
    
    const clientToSave = {
      ...client,
      id: client.id || crypto.randomUUID(),
      name: client.name.toUpperCase().trim(), // Normalización
      docNumber: client.docNumber.replace(/\D/g, ''), // Solo números
      balance: client.balance || 0, // Asegurar inicialización de saldo
      updatedAt: new Date(),
      syncStatus: 'PENDING'
    };

    await db.put('clients', clientToSave);
    return clientToSave;
  },

  async delete(id) {
    const db = await getDB();
    return db.delete('clients', id);
  }
};