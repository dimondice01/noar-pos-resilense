// src/modules/security/services/securityService.js

// En un futuro, esto vendrá de la base de datos (tabla 'users')
const MOCK_USERS = [
  { id: 'u_admin', name: 'Gerente General', pin: '9999', role: 'MANAGER' },
  { id: 'u_cajero1', name: 'Cajero Mañana', pin: '1234', role: 'CASHIER' }
];

export const securityService = {
  /**
   * Valida un PIN y retorna el usuario si es correcto
   * @param {string} pin 
   */
  async login(pin) {
    // Simulamos delay de red/criptografía
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const user = MOCK_USERS.find(u => u.pin === pin);
    if (!user) {
      throw new Error('PIN Incorrecto');
    }
    return user;
  },

  /**
   * Verifica específicamente si un PIN tiene permisos de GERENTE (para retiros)
   */
  async authorizeManager(pin) {
    const user = await this.login(pin);
    if (user.role !== 'MANAGER') {
      throw new Error('Permisos insuficientes. Se requiere un Gerente.');
    }
    return user;
  }
};