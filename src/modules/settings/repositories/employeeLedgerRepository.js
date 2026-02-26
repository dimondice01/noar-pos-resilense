import { collection, addDoc, getDocs, query, where, orderBy, serverTimestamp, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../../database/firebase';

// =================================================================
// 🏦 REPOSITORIO: LIBRO MAYOR DE EMPLEADOS (CUENTA CORRIENTE)
// =================================================================

export const employeeLedgerRepository = {
    
    /**
     * Registra un movimiento en la cuenta del empleado.
     * Tipos válidos: 'ADVANCE' (Adelanto), 'POS_CONSUMPTION' (Consumo Caja), 'LIQUIDATION' (Pago/Reseteo)
     */
    async addTransaction({ companyId, branchId, userId, type, amount, description, refId = null, operatorName }) {
        if (!companyId || !userId || !amount) throw new Error("Faltan datos requeridos para el Ledger del empleado.");

        try {
            // 1. Guardamos el registro de la transacción
            const txRef = collection(db, 'companies', companyId, 'employee_transactions');
            await addDoc(txRef, {
                userId,
                branchId,
                type,
                amount: parseFloat(amount),
                description,
                refId,
                operatorName,
                date: new Date().toISOString(),
                createdAt: serverTimestamp()
            });

            // 2. Actualizamos el saldo total en el perfil del usuario para lecturas rápidas
            const userRef = doc(db, 'users', userId);
            const userSnap = await getDoc(userRef);
            
            if (userSnap.exists()) {
                const currentDebt = parseFloat(userSnap.data().ledgerDebt || 0);
                let newDebt = currentDebt;
                
                // Si le damos plata (Adelanto) o se lleva mercadería (Consumo), su deuda aumenta.
                if (['ADVANCE', 'POS_CONSUMPTION'].includes(type)) {
                    newDebt += parseFloat(amount);
                } 
                // Si descontamos del sueldo o paga (Liquidación), su deuda baja.
                else if (['LIQUIDATION'].includes(type)) {
                    newDebt -= parseFloat(amount);
                }

                await updateDoc(userRef, { 
                    ledgerDebt: newDebt,
                    lastLedgerUpdate: serverTimestamp() 
                });
            }
            
            return true;
        } catch (error) {
            console.error("Error registrando en Employee Ledger:", error);
            throw new Error("No se pudo actualizar la cuenta del empleado.");
        }
    },

    /**
     * Obtiene el historial de movimientos de un empleado específico
     */
    async getEmployeeHistory(companyId, userId) {
        if (!companyId || !userId) return [];
        try {
            const q = query(
                collection(db, 'companies', companyId, 'employee_transactions'),
                where('userId', '==', userId),
                orderBy('date', 'desc')
            );
            const snap = await getDocs(q);
            return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            console.error("Error obteniendo historial del empleado:", error);
            return [];
        }
    }
};