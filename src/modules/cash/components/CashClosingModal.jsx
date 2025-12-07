import React, { useState } from 'react';
import { X, Lock, DollarSign, CreditCard, Calculator } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

export const CashClosingModal = ({ isOpen, onClose, onConfirm, systemTotals }) => {
  const [declaredCash, setDeclaredCash] = useState('');
  const [step, setStep] = useState(1); // 1: Conteo, 2: Confirmación

  if (!isOpen) return null;

  const handleSubmit = () => {
    // Aquí es donde ocurre la magia del "Cierre Ciego"
    // Enviamos lo declarado y lo esperado (que viene oculto en props)
    onConfirm({
        declaredCash: parseFloat(declaredCash) || 0,
        expectedCash: systemTotals.totalCash, // Dato oculto al cajero visualmente
        expectedDigital: systemTotals.totalDigital
    });
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-sys-900/80 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        
        {/* Header */}
        <div className="bg-sys-50 p-6 border-b border-sys-100 flex justify-between items-center">
           <div>
              <h3 className="text-xl font-bold text-sys-900 flex items-center gap-2">
                 <Lock className="text-red-500" size={24} /> Cierre de Turno
              </h3>
              <p className="text-xs text-sys-500 mt-1">Procedimiento de Cierre Ciego (Blind Z)</p>
           </div>
           <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-400"><X/></button>
        </div>

        <div className="p-8">
           {step === 1 ? (
             <div className="space-y-6">
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-blue-800 text-sm">
                   <p className="font-medium">🔒 Modo Auditoría</p>
                   <p className="opacity-80 text-xs mt-1">Por favor, cuente el dinero físico en la caja e ingrese el total real.</p>
                </div>

                <div>
                   <label className="block text-xs font-bold text-sys-500 uppercase tracking-wider mb-2">Efectivo en Caja</label>
                   <div className="relative">
                      <DollarSign className="absolute left-4 top-4 text-sys-400" />
                      <input 
                        type="number" 
                        autoFocus
                        className="w-full pl-10 pr-4 py-4 text-2xl font-bold border-2 border-sys-200 rounded-xl focus:border-brand outline-none transition-all"
                        placeholder="0.00"
                        value={declaredCash}
                        onChange={e => setDeclaredCash(e.target.value)}
                      />
                   </div>
                </div>

                <div className="pt-4">
                   <Button onClick={() => setStep(2)} className="w-full py-4 text-lg shadow-xl" disabled={!declaredCash}>
                      Siguiente <Calculator className="ml-2" size={18}/>
                   </Button>
                </div>
             </div>
           ) : (
             <div className="text-center space-y-6">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600 mb-4">
                   <Lock size={32} />
                </div>
                <div>
                   <h4 className="text-xl font-bold text-sys-900">¿Confirmar Cierre?</h4>
                   <p className="text-sys-500 text-sm mt-2">
                      Estás declarando <b>$ {parseFloat(declaredCash).toLocaleString()}</b> en efectivo.
                      <br/>Esta acción no se puede deshacer y bloqueará la caja.
                   </p>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2">
                   <Button variant="ghost" onClick={() => setStep(1)}>Corregir</Button>
                   <Button variant="danger" onClick={handleSubmit}>Confirmar Cierre Z</Button>
                </div>
             </div>
           )}
        </div>

      </div>
    </div>
  );
};