// ✅ URL DE PRODUCCIÓN (salvadorpos1)
const API_URL = 'https://us-central1-salvadorpos1.cloudfunctions.net/api'; 

export const billingService = {
  /**
   * Solicita Factura C (Venta)
   * @param {object} sale - Objeto de venta completo
   */
  async emitirFactura(sale) {
    try {
      const payload = {
        total: sale.total,
        // 👇 Corregido: Enviamos el objeto 'client' completo
        client: sale.client || { docNumber: "0" } 
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

      return await response.json(); // Retorna { cae, vto, numero, qr_data, tipo: "C" }

    } catch (error) {
      console.error("Billing Service Error (Factura):", error);
      throw error;
    }
  },

  /**
   * Solicita Nota de Crédito C (Anulación)
   * @param {object} sale - Objeto de venta a anular
   */
  async emitirNotaCredito(sale) {
    try {
      // 1. VALIDACIÓN: No podemos anular si no hay factura previa
      if (!sale.afip || !sale.afip.cbteNumero) {
        throw new Error("No se puede anular una venta que no tiene factura aprobada.");
      }

      const payload = {
        total: sale.total,
        client: sale.client || { docNumber: "0" },
        
        // 👇 ESTO ES LO QUE FALTABA: Datos de la factura original
        associatedDocument: {
            tipo: sale.afip.cbteLetra === 'A' ? 1 : 11, // 11 es Factura C
            ptoVta: 5, // El punto de venta fijo que usamos
            nro: sale.afip.cbteNumero // El número de la factura a anular
        }
      };

      // 👇 Llamamos al nuevo endpoint de anulación
      const response = await fetch(`${API_URL}/create-credit-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || "Error al generar Nota de Crédito");
      }

      return await response.json(); // Retorna { cae, vto, numero, tipo: "NC" ... }

    } catch (error) {
      console.error("Billing Service Error (Nota Crédito):", error);
      throw error;
    }
  }
};