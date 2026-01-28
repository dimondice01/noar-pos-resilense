import { cashRepository } from './cashRepository';

// ==========================================
// 🔄 FACADE: REDIRECCIÓN A REPOSITORIO MAESTRO
// ==========================================
// Este archivo existe para mantener compatibilidad con imports viejos,
// pero toda la lógica real de negocio reside en 'cashRepository.js'.
// Esto evita conflictos de lógica duplicada.

export const shiftRepository = {
  
  // Delegar Apertura
  async openShift(initialAmount, userName) {
      return await cashRepository.openShift(initialAmount, userName);
  },

  // Delegar Cierre (Con soporte para leftInCash y stats completos)
  async closeShift(shiftId, declaredAmount, stats) {
      // Mapeamos los parámetros antiguos al nuevo formato de objeto único si es necesario
      const closingData = {
          declaredCash: declaredAmount,
          expectedCash: stats.expectedCash || stats.expectedTotal || 0,
          expectedDigital: stats.expectedDigital || 0,
          leftInCash: stats.leftInCash || 0 // 🔥 Aseguramos que pase este dato
      };
      
      return await cashRepository.closeShift(shiftId, closingData);
  },

  // Delegar Obtención Actual
  async getCurrentShift() {
      return await cashRepository.getCurrentShift();
  },

  // Delegar Historial
  async getAllShifts() {
      return await cashRepository.getAllShifts();
  },

  // Delegar Movimientos Extra
  async addMovement(shiftId, type, amount, description) {
      // Adaptador para la firma nueva
      if (type === 'DEPOSIT') {
          return await cashRepository.registerIncome(amount, 'cash', description);
      } else if (type === 'WITHDRAWAL') {
          return await cashRepository.registerWithdrawal(amount, description, 'legacy_call');
      } else {
          return await cashRepository.registerExpense(amount, description);
      }
  },

  // Delegar Obtención de Movimientos
  async getShiftMovements(shiftId) {
      const balance = await cashRepository.getShiftBalance(shiftId);
      return balance.movements || [];
  }
};