import { getDB } from '../../../database/db';
import { syncService } from '../../sync/services/syncService';
import { useAuthStore } from '../../auth/store/useAuthStore';

const DEFAULT_PIN = '1234';

export const securityService = {
  
  /**
   * 🔥 VERIFICACIÓN POR SUCURSAL
   */
  async verifyPin(inputPin) {
    try {
      const { activeBranchId } = useAuthStore.getState();
      
      // Si estamos en modo "Todas las Sucursales" o sin sucursal, usamos Default por ahora
      // (Opcional: Podrías requerir seleccionar sucursal obligatoriamente)
      if (!activeBranchId || activeBranchId === 'ALL') {
          console.warn("Security: PIN verificado sin sucursal específica. Usando Default.");
          return inputPin === DEFAULT_PIN;
      }

      const db = await getDB();
      const configKey = `BRANCH_PIN_${activeBranchId}`;
      
      // Buscamos en la tabla config por ID
      const configEntry = await db.config.get(configKey);
      
      // Lógica de verdad: Si existe en DB usa ese, sino el Default
      const realPin = configEntry ? configEntry.value : DEFAULT_PIN;
      
      // 🔍 DEBUG: Ver en consola qué pasa (borrar en producción)
      console.log(`🔐 Verificando PIN Sucursal [${activeBranchId}]`);
      console.log(`   Expectativa: ${realPin} | Ingresado: ${inputPin}`);
      
      return String(inputPin) === String(realPin);

    } catch (error) {
      console.error("Error verificando PIN sucursal:", error);
      return false; // Ante la duda, bloquear
    }
  },

  /**
   * Valida autorización para acciones críticas
   */
  async authorizeManager(inputPin) {
    const isValid = await this.verifyPin(inputPin);
    if (!isValid) {
      throw new Error('PIN de Sucursal incorrecto.');
    }
    return { role: 'ADMIN', name: 'Autorizado (PIN)' };
  },

  /**
   * Actualiza el PIN
   */
  async setBranchPin(newPin, branchId) {
    if (!branchId || branchId === 'ALL') throw new Error("Se requiere una sucursal específica.");
    
    const configKey = `BRANCH_PIN_${branchId}`;
    
    // Guardamos usando el servicio corregido
    await syncService.pushGlobalConfig(configKey, newPin);
    
    console.log(`🔒 PIN para sucursal ${branchId} actualizado a: ${newPin}`);
  },

  async login(pin) {
    const isValid = await this.verifyPin(pin);
    if (isValid) {
      const { user } = useAuthStore.getState();
      return { 
        id: user?.uid || 'cajero_gen', 
        name: user?.name || 'Operador', 
        role: 'CASHIER' 
      };
    }
    throw new Error('PIN de sucursal no reconocido');
  }
};