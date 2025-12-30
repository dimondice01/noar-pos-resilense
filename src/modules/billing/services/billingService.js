// ✅ URL DE PRODUCCIÓN (salvadorpos1)
const API_URL = import.meta.env.VITE_API_URL; 

// 👇 1. IMPORTANTE: Necesitamos el Store para saber qué empresa está facturando
import { useAuthStore } from '../../auth/store/useAuthStore'; 

export const billingService = {
  /**
   * Solicita Factura C (Venta)
   * @param {object} sale - Objeto de venta completo
   */
  async emitirFactura(sale) {
    try {
      // 👇 2. OBTENER ID DE EMPRESA
      const { user } = useAuthStore.getState();
      if (!user || !user.companyId) {
          throw new Error("Error: No se identificó la empresa para facturar.");
      }

      const payload = {
        companyId: user.companyId, // 🔑 LA CLAVE DEL ÉXITO
        total: sale.total,
        // Enviamos el objeto 'client' completo o un consumidor final por defecto
        client: sale.client || { docNumber: "0", name: "Consumidor Final" } 
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
      // 👇 3. OBTENER ID DE EMPRESA TAMBIÉN AQUÍ
      const { user } = useAuthStore.getState();
      if (!user || !user.companyId) {
          throw new Error("Error: No se identificó la empresa para anular.");
      }

      // VALIDACIÓN: No podemos anular si no hay factura previa
      if (!sale.afip || !sale.afip.cbteNumero) {
        throw new Error("No se puede anular una venta que no tiene factura aprobada.");
      }

      const payload = {
        companyId: user.companyId, // 🔑 CLAVE SaaS
        total: sale.total,
        client: sale.client || { docNumber: "0" },
        
        // Datos de la factura original para vincular
        associatedDocument: {
            tipo: sale.afip.cbteLetra === 'A' ? 1 : 11, // 11 es Factura C
            ptoVta: sale.afip.ptoVta || 5, // Usamos el mismo pto de venta que la original
            nro: sale.afip.cbteNumero 
        }
      };

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