// ✅ URL DE PRODUCCIÓN (salvadorpos1)
const API_URL = import.meta.env.VITE_API_URL; 

// 👇 1. IMPORTANTE: Necesitamos el Store para saber qué empresa y sucursal están facturando
import { useAuthStore } from '../../auth/store/useAuthStore'; 

export const billingService = {
  /**
   * Solicita Factura (Venta)
   * @param {object} sale - Objeto de venta completo
   */
  async emitirFactura(sale) {
    try {
      // 👇 2. OBTENER ID DE EMPRESA Y SUCURSAL
      const { user, activeBranchId } = useAuthStore.getState();
      
      if (!user || !user.companyId) {
          throw new Error("Error: No se identificó la empresa para facturar.");
      }

      // 🔥 FIX CRÍTICO: Inyectar branchId al payload
      const payload = {
        companyId: sale.companyId || user.companyId, 
        branchId: sale.branchId || activeBranchId, // 🔑 AHORA SÍ VIAJA LA SUCURSAL
        total: sale.total,
        client: sale.client || { docNumber: "0", name: "Consumidor Final", fiscalCondition: "CONSUMIDOR_FINAL" } 
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

      return await response.json();

    } catch (error) {
      console.error("Billing Service Error (Factura):", error);
      throw error;
    }
  },

  /**
   * Solicita Nota de Crédito (Anulación)
   * @param {object} sale - Objeto de venta a anular
   */
  async emitirNotaCredito(sale) {
    try {
      const { user, activeBranchId } = useAuthStore.getState();
      
      if (!user || !user.companyId) {
          throw new Error("Error: No se identificó la empresa para anular.");
      }

      // VALIDACIÓN: No podemos anular si no hay factura previa
      if (!sale.afip || !sale.afip.cbteNumero) {
        throw new Error("No se puede anular una venta que no tiene factura aprobada.");
      }

      // 🔥 FIX CRÍTICO: Inyectar branchId y respetar el documento asociado
      const payload = {
        companyId: sale.companyId || user.companyId, 
        branchId: sale.branchId || activeBranchId, // 🔑 AHORA SÍ VIAJA LA SUCURSAL
        total: sale.total,
        client: sale.client || { docNumber: "0", fiscalCondition: "CONSUMIDOR_FINAL" },
        
        // Datos de la factura original para vincular (Respetamos el que armó SalesPage o calculamos)
        associatedDocument: sale.associatedDocument || {
            tipo: sale.afip.cbteTipo || (sale.afip.cbteLetra === 'A' ? 1 : sale.afip.cbteLetra === 'B' ? 6 : 11),
            ptoVta: sale.afip.ptoVta || 1, 
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

      return await response.json();

    } catch (error) {
      console.error("Billing Service Error (Nota Crédito):", error);
      throw error;
    }
  }
};