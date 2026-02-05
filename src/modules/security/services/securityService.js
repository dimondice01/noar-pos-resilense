import { getDB } from '../../../database/db';
import { syncService } from '../../sync/services/syncService';
import { useAuthStore } from '../../auth/store/useAuthStore';

const DEFAULT_PIN = '1234';

export const securityService = {
  
  /**
   * 🔥 VERIFICACIÓN POR SUCURSAL (Offline-First)
   * Valida el PIN contra la base de datos local (Dexie)
   */
  async verifyPin(inputPin) {
    try {
      const { activeBranchId, user } = useAuthStore.getState();
      
      // Determinar qué Branch ID verificar
      // Si el usuario es cajero, tiene su branchId en el perfil. Si es Admin/Owner, usa la activa.
      let targetBranchId = activeBranchId;

      if (!targetBranchId || targetBranchId === 'ALL') {
          if (user?.branchId) {
              targetBranchId = user.branchId;
          } else {
              console.warn("Security: PIN verificado en modo Global/Sin Sucursal. Usando Default.");
              // En modo global, podríamos validar un MASTER_PIN, por ahora fallback a default
              return String(inputPin) === DEFAULT_PIN;
          }
      }

      const db = await getDB();
      const configKey = `BRANCH_PIN_${targetBranchId}`;
      
      // 1. Buscamos en la tabla 'config' local (Dexie)
      // Esto garantiza velocidad y funcionamiento sin internet
      const configEntry = await db.config.get(configKey);
      
      // 2. Lógica de verdad: Si existe en DB local usa ese, sino el Default
      const realPin = configEntry ? configEntry.value : DEFAULT_PIN;
      
      // Compara como strings para evitar errores de tipo
      const isValid = String(inputPin).trim() === String(realPin).trim();

      if (!isValid) {
          console.warn(`🔐 Intento de acceso fallido en Sucursal [${targetBranchId}]`);
      }
      
      return isValid;

    } catch (error) {
      console.error("Error crítico verificando PIN:", error);
      return false; // Ante error de sistema, bloquear por seguridad
    }
  },

  /**
   * 🛡️ ALIAS DE COMPATIBILIDAD
   * Evita crashes si algún componente antiguo llama a verifyMasterPin
   */
  async verifyMasterPin(inputPin) {
      return this.verifyPin(inputPin);
  },

  /**
   * Valida autorización para acciones críticas (Managers)
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
   * Guarda en Dexie y empuja a Firebase
   */
  async setBranchPin(newPin, branchId) {
    if (!branchId || branchId === 'ALL') throw new Error("Se requiere una sucursal específica para configurar el PIN.");
    
    const configKey = `BRANCH_PIN_${branchId}`;
    
    // Usamos syncService para garantizar que el cambio impacte local y suba a la nube
    await syncService.pushGlobalConfig(configKey, newPin);
    
    console.log(`🔒 PIN para sucursal ${branchId} actualizado y sincronizado.`);
  },

  /**
   * Login simple por PIN (Para modo Kiosco/Rápido)
   */
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