import { getDB } from '../../../database/db';
import { syncService } from '../../sync/services/syncService'; // 🔥 Importamos el servicio conectado

const DEFAULT_MASTER_PIN = '1234';

export const securityService = {
  
  /**
   * 🔥 VERIFICACIÓN REAL (Lectura Local Rápida)
   * Lee de IndexedDB, que se mantiene actualizado gracias a los listeners del syncService.
   */
  async verifyMasterPin(inputPin) {
    try {
      const db = await getDB();
      const configEntry = await db.get('config', 'MASTER_PIN');
      const realPin = configEntry ? configEntry.value : DEFAULT_MASTER_PIN;
      return inputPin === realPin;
    } catch (error) {
      console.error("Error verificando PIN en DB:", error);
      return false;
    }
  },

  /**
   * Valida si el PIN corresponde a un Gerente/Admin
   */
  async authorizeManager(inputPin) {
    const isValid = await this.verifyMasterPin(inputPin);
    if (!isValid) {
      throw new Error('PIN Incorrecto o Permisos Insuficientes.');
    }
    return { role: 'ADMIN', name: 'Administrador (PIN)' };
  },

  /**
   * 🔥 ACTUALIZACIÓN CLOUD-FIRST
   * Al cambiar el PIN, lo enviamos a Firebase. Los listeners se encargarán
   * de bajarlo a este y otros dispositivos.
   */
  async setMasterPin(newPin) {
    await syncService.pushGlobalConfig('MASTER_PIN', newPin);
    console.log("🔒 PIN Maestro enviado a la nube y actualizado localmente.");
  },

  async login(pin) {
    const isMaster = await this.verifyMasterPin(pin);
    if (isMaster) {
      return { id: 'admin_pin', name: 'Admin', role: 'ADMIN' };
    }
    throw new Error('PIN no reconocido');
  }
};