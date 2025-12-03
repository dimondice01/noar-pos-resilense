import React, { useState } from 'react';
import { X, Lock, Calculator, AlertTriangle, CheckCircle } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { shiftRepository } from '../repositories/shiftRepository';
import { useShiftStore } from '../store/useShiftStore';

export const CloseShiftModal = ({ isOpen, onClose }) => {
  const { currentShift, clearSession } = useShiftStore();
  const [declaredAmount, setDeclaredAmount] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleCloseShift = async (e) => {
    e.preventDefault();
    if (!declaredAmount) return;
    
    if (!confirm("⚠️ ¿Estás seguro de cerrar la caja?\nEsta acción es irreversible.")) return;

    setLoading(true);
    try {
      // En un sistema real, aquí calcularíamos el "expectedTotal" sumando ventas
      const stats = { expectedTotal: 0 }; // Mock por ahora
      
      await shiftRepository.closeShift(currentShift.id, parseFloat(declaredAmount), stats);
      
      // Limpiamos sesión global -> Esto disparará el CashGuard y bloqueará la pantalla
      clearSession(); 
      onClose();
      
    } catch (error) {
      console.error(error);
      alert("Error al cerrar caja");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-sys-900/80 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        
        <div className="bg-red-50 p-6 border-b border-red-100 flex items-center gap-4">
           <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600">
              <Lock size={24} />
           </div>
           <div>
              <h3 className="font-bold text-lg text-red-900">Cierre de Caja</h3>
              <p className="text-xs text-red-600">Turno iniciado: {new Date(currentShift?.openedAt).toLocaleTimeString()}</p>
           </div>
           <button onClick={onClose} className="ml-auto p-2 hover:bg-red-100 rounded-full text-red-400"><X size={20}/></button>
        </div>

        <form onSubmit={handleCloseShift} className="p-6 space-y-6">
           <div className="bg-sys-50 p-4 rounded-xl border border-sys-200">
              <p className="text-sm text-sys-600 mb-2 font-medium flex items-center gap-2">
                 <Calculator size={16}/> Arqueo Ciego
              </p>
              <p className="text-xs text-sys-400 mb-4">
                 Cuenta todo el dinero en efectivo (billetes y monedas) e ingrésalo aquí. El sistema comparará con lo registrado.
              </p>
              
              <div className="relative">
                 <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sys-400 font-bold text-xl">$</span>
                 <input 
                    autoFocus
                    type="number" 
                    step="0.01"
                    className="w-full pl-10 pr-4 py-4 text-3xl font-black text-sys-900 bg-white border-2 border-sys-200 rounded-xl focus:border-red-500 outline-none transition-all placeholder:text-sys-200"
                    placeholder="0.00"
                    value={declaredAmount}
                    onChange={(e) => setDeclaredAmount(e.target.value)}
                 />
              </div>
           </div>

           <div className="flex gap-3">
              <Button type="button" variant="ghost" onClick={onClose} className="flex-1">Cancelar</Button>
              <Button type="submit" variant="danger" className="flex-1 shadow-lg shadow-red-500/20" disabled={loading || !declaredAmount}>
                 {loading ? 'Cerrando...' : 'Confirmar Cierre Z'}
              </Button>
           </div>
        </form>

      </div>
    </div>
  );
};