// URL de tu Backend (Nube de Producción)
// Se añade un fallback por seguridad si la variable de entorno falla
const API_URL = import.meta.env.VITE_API_URL || "https://us-central1-salvadorpos1.cloudfunctions.net/api";

import { useAuthStore } from '../../auth/store/useAuthStore';

export const paymentService = {
  
  // ============================================================
  // 1. INICIAR TRANSACCIÓN DE PAGO (QR / POINT / CLOVER)
  // ============================================================
  async initTransaction(provider, amount, deviceId = null, extraContext = {}) {
    try {
      // 👇 OBTENEMOS USER Y BRANCH ID DESDE EL STORE
      const { user, activeBranchId } = useAuthStore.getState();
      
      if (!user || !user.companyId) throw new Error("Error: No hay empresa asignada.");
      if (!activeBranchId) throw new Error("Error: No hay sucursal activa seleccionada.");

      console.log(`💳 Iniciando ${provider} ($${amount}) | Sucursal: ${activeBranchId}`);

      let endpoint = '';
      
      // 👇 INYECTAR BRANCH ID (CRÍTICO PARA MULTI-TENANT REAL)
      let bodyData = { 
          companyId: user.companyId,
          branchId: activeBranchId, // 🔑 El backend usará esto para buscar el token correcto
          total: amount,
          ...extraContext
      };

      if (provider === 'mercadopago') {
        endpoint = '/create-order'; 
        bodyData.title = "Venta Salvador POS";
        if (deviceId) bodyData.deviceId = deviceId; 
      } 
      else if (provider === 'point') {
        endpoint = '/create-point-order';
        bodyData.deviceId = deviceId; 
      }
      else if (provider === 'clover') {
        endpoint = '/create-clover-order';
        bodyData.externalId = deviceId; 
      } 
      else {
        throw new Error(`Proveedor ${provider} no soportado.`);
      }

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.details || data.error || `Falló inicio de ${provider}`);
      }
      
      // Normalizamos la referencia de seguimiento
      const trackingRef = data.reference || data.paymentId;
      if (!trackingRef) throw new Error("El proveedor no devolvió referencia de rastreo");

      return {
        success: true,
        reference: trackingRef
      };

    } catch (error) {
      console.error(`❌ Error iniciando pago ${provider}:`, error);
      throw error;
    }
  },

  // ============================================================
  // 2. VERIFICAR ESTADO DE PAGO (POLLING)
  // ============================================================
  async checkStatus(reference, provider) {
    try {
      const { user, activeBranchId } = useAuthStore.getState();
      
      // Sin contexto no podemos validar
      if (!user || !user.companyId || !activeBranchId) return { status: 'error' };

      const response = await fetch(`${API_URL}/check-payment-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            companyId: user.companyId,
            branchId: activeBranchId, // 🔑 Consultamos con las credenciales de LA SUCURSAL
            reference, 
            provider 
        }),
      });

      if (!response.ok) return { status: 'error' };
      return await response.json(); 

    } catch (error) {
      console.error("Polling Error:", error);
      return { status: 'error' };
    }
  },

  // ============================================================
  // 3. FACTURACIÓN ELECTRÓNICA (AFIP)
  // ============================================================
  async createInvoice(saleData) {
      try {
          const { user, activeBranchId } = useAuthStore.getState();
          
          if (!user?.companyId) throw new Error("Error: No hay empresa asignada.");
          if (!activeBranchId) throw new Error("Error: No hay sucursal activa para facturar.");

          console.log(`📠 Solicitando CAE para venta ${saleData.total}...`);

          const response = await fetch(`${API_URL}/create-invoice`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  // Enviamos todo el objeto de venta
                  ...saleData,
                  
                  // Sobrescribimos/Aseguramos los datos de contexto fiscal
                  companyId: user.companyId,
                  branchId: activeBranchId // 🔑 El backend buscará el CERTIFICADO de esta sucursal
              })
          });

          const result = await response.json();

          if (!response.ok) {
              throw new Error(result.details || result.error || "Error al facturar en AFIP");
          }

          return result; // Retorna { cae, vto, qr_data, etc }

      } catch (error) {
          console.error("❌ Error Facturación:", error);
          throw error;
      }
  },

  // ============================================================
  // 4. NOTA DE CRÉDITO (ANULACIÓN)
  // ============================================================
  async createCreditNote(ncData) {
      try {
          const { user, activeBranchId } = useAuthStore.getState();
          
          if (!user?.companyId || !activeBranchId) throw new Error("Sesión inválida.");

          const response = await fetch(`${API_URL}/create-credit-note`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  total: ncData.total,
                  client: ncData.client,
                  associatedDocument: ncData.associatedDocument, // { tipo, ptoVta, nro }
                  companyId: user.companyId,
                  branchId: activeBranchId // 🔑
              })
          });

          const result = await response.json();

          if (!response.ok) {
              throw new Error(result.details || result.error || "Error al emitir Nota de Crédito");
          }

          return result;

      } catch (error) {
          console.error("❌ Error Nota Crédito:", error);
          throw error;
      }
  }
};