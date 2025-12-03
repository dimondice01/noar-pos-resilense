// Apuntamos a la misma URL de tu backend (Ajusta si estás en producción o local)
const API_URL = 'http://127.0.0.1:5001/noar-pos-prod/us-central1/api'; 
// (Recuerda poner tu Project ID correcto en la URL de arriba ☝️)

export const billingService = {
  /**
   * Solicita CAE a la Cloud Function
   * @param {object} sale - Objeto de venta completo
   */
  async emitirFactura(sale) {
    try {
      // Preparamos los datos
      const payload = {
        total: sale.total,
        docNro: sale.client?.docNumber || "0" // Si no hay cliente, es Consumidor Final (0)
      };

      const response = await fetch(`${API_URL}/create-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || "Error al facturar");
      }

      return await response.json(); // Retorna { cae, vto, numero, qr_data... }

    } catch (error) {
      console.error("Billing Service Error:", error);
      throw error;
    }
  }
};