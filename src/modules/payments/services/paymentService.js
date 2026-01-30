// URL de tu Backend (Nube de Producción)
const API_URL = import.meta.env.VITE_API_URL;

import { useAuthStore } from '../../auth/store/useAuthStore';

export const paymentService = {
  
  /**
   * 1. INICIAR TRANSACCIÓN (Handshake)
   */
  async initTransaction(provider, amount, deviceId = null) {
    try {
      // 👇 OBTENEMOS USER Y BRANCH ID DESDE EL STORE
      const { user, activeBranchId } = useAuthStore.getState();
      
      if (!user || !user.companyId) {
          throw new Error("Error: No hay empresa asignada.");
      }

      if (!activeBranchId) {
          throw new Error("Error: No hay sucursal activa seleccionada.");
      }

      console.log(`💳 Iniciando orden ${provider} por $${amount} (Empresa: ${user.companyId}, Sucursal: ${activeBranchId}) | Device: ${deviceId}`);

      let endpoint = '';
      
      // 👇 INYECTAR BRANCH ID EN EL BODY (VITAL PARA EL BACKEND NUEVO)
      let bodyData = { 
          companyId: user.companyId,
          branchId: activeBranchId, // 🔑 ESTO SOLUCIONA EL ERROR 500
          total: amount 
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

  /**
   * 2. VERIFICAR ESTADO (Polling)
   */
  async checkStatus(reference, provider) {
    try {
      const { user, activeBranchId } = useAuthStore.getState();
      if (!user || !user.companyId || !activeBranchId) return { status: 'error' };

      const response = await fetch(`${API_URL}/check-payment-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            companyId: user.companyId,
            branchId: activeBranchId, // 🔑 También aquí para consultar la cuenta correcta
            reference, 
            provider 
        }),
      });

      if (!response.ok) return { status: 'error' };
      return await response.json(); 

    } catch (error) {
      return { status: 'error' };
    }
  }
};