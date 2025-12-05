import { salesRepository } from '../../sales/repositories/salesRepository';

// URL de tu Backend (Nube o Local)
const API_URL = 'https://us-central1-noar-pos-prod.cloudfunctions.net/api'; // ⚠️ Ajusta tu ID

export const paymentService = {
  
  /**
   * Método Universal de Cobro
   * @param {string} provider - 'mercadopago' | 'clover' | 'cash'
   * @param {number} amount - Monto total
   * @param {string} [terminalId] - ID opcional de la terminal (para Clover)
   */
  async processPayment(provider, amount, terminalId = null) {
    console.log(`💳 Iniciando cobro con ${provider.toUpperCase()} por $${amount}`);

    try {
      let result;

      switch (provider) {
        case 'mercadopago':
          result = await this._payWithMercadoPago(amount);
          break;
        
        case 'clover':
          result = await this._payWithClover(amount, terminalId);
          break;
          
        case 'cash':
          // El efectivo es inmediato, no requiere API
          result = { status: 'approved', method: 'cash' };
          break;

        default:
          throw new Error('Proveedor de pagos no soportado');
      }

      return result;

    } catch (error) {
      console.error(`❌ Error en pago ${provider}:`, error);
      throw error;
    }
  },

  // --- ADAPTADORES PRIVADOS ---

  async _payWithMercadoPago(amount) {
    const response = await fetch(`${API_URL}/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ total: amount, title: "Venta Noar POS" }),
    });

    if (!response.ok) throw new Error('Falló MP');
    return await response.json();
  },

  async _payWithClover(amount, terminalId) {
    // Aquí conectaremos el endpoint de Clover que haremos pronto
    const response = await fetch(`${API_URL}/create-clover-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        total: amount, 
        terminalId: terminalId || "DEFAULT_CLOVER_ID" 
      }),
    });

    if (!response.ok) throw new Error('Falló Clover');
    return await response.json();
  }
};