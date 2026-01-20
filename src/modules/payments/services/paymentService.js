// URL de tu Backend (Nube de Producción)
const API_URL = import.meta.env.VITE_API_URL;

// 👇 1. IMPORTAR STORE (Vital para saber de quién es la cuenta de MP/Clover)
import { useAuthStore } from '../../auth/store/useAuthStore';

export const paymentService = {
  
  /**
   * 1. INICIAR TRANSACCIÓN (Handshake)
   * Envía la orden al proveedor y obtiene una REFERENCIA única para rastreo.
   * Soporta: MercadoPago QR, MP Point (Físico) y Clover.
   */
  async initTransaction(provider, amount, deviceId = null) {
    try {
      // 👇 2. OBTENER ID DE EMPRESA
      const { user } = useAuthStore.getState();
      if (!user || !user.companyId) {
          throw new Error("Error: No hay empresa asignada para procesar el pago.");
      }

      console.log(`💳 Iniciando orden ${provider} por $${amount} (Empresa: ${user.companyId}) | Device: ${deviceId || 'DB Default'}`);

      let endpoint = '';
      
      // 👇 3. INYECTAR COMPANY ID EN EL BODY
      let bodyData = { 
          companyId: user.companyId, // 🔑 CLAVE PARA OBTENER CREDENCIALES MP
          total: amount 
      };

      // Configurar según proveedor
      if (provider === 'mercadopago') {
        // Opción 1: QR en Pantalla
        endpoint = '/create-order'; 
        bodyData.title = "Consumo Noar POS";
        
        // 🔥 CORRECCIÓN CRÍTICA:
        // Antes esto no estaba, por eso no llegaba el ID al backend.
        if (deviceId) {
            bodyData.deviceId = deviceId; 
        }
      } 
      else if (provider === 'point') {
        // Opción 2: Terminal Física (Point Smart)
        endpoint = '/create-point-order';
        bodyData.deviceId = deviceId; // ID del aparato (ej: PAX_...)
      }
      else if (provider === 'clover') {
        // Opción 3: Clover
        endpoint = '/create-clover-order';
        bodyData.reference = `CLV-${Date.now()}`;
        bodyData.externalId = deviceId; // Clover usa esto como externalId opcional
      } 
      else {
        throw new Error(`Proveedor ${provider} no soporta inicio asíncrono.`);
      }

      // Llamada al Backend
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData),
      });

      if (!response.ok) {
        const err = await response.json();
        // Propagamos el mensaje de error del backend
        throw new Error(err.details || err.error || `Falló inicio de ${provider}`);
      }
      
      const data = await response.json();
      
      // Retornamos la REFERENCIA CLAVE para el polling
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
   * Pregunta al Backend si la referencia ya está pagada.
   * Se llama repetidamente desde el UI (PaymentModal).
   */
  async checkStatus(reference, provider) {
    try {
      // 👇 4. TAMBIÉN NECESITAMOS COMPANY ID AQUÍ
      const { user } = useAuthStore.getState();
      if (!user || !user.companyId) return { status: 'error' };

      const response = await fetch(`${API_URL}/check-payment-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            companyId: user.companyId, // 🔑 Para saber qué cuenta consultar
            reference, 
            provider 
        }),
      });

      if (!response.ok) return { status: 'error' };
      
      // Respuesta esperada: { status: 'approved' | 'pending' | 'rejected', ... }
      return await response.json(); 

    } catch (error) {
      // Si falla la red, retornamos error para que el UI decida si reintentar
      return { status: 'error' };
    }
  },

  /**
   * MÉTODO LEGACY (Compatibilidad)
   * Solo para Efectivo, ya que es inmediato.
   */
  async processCashPayment(amount) {
     return { status: 'approved', method: 'cash', amount };
  }
};