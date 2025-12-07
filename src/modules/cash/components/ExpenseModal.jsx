import React, { useState, useRef, useEffect } from 'react';
import { X, DollarSign, FileText, ArrowRight, AlertTriangle } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

export const ExpenseModal = ({ isOpen, onClose, onConfirm }) => {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const inputRef = useRef(null);

  // Auto-focus al abrir
  useEffect(() => {
    if (isOpen) {
      setAmount('');
      setDescription('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (!val || val <= 0 || !description.trim()) return;
    
    onConfirm({ amount: val, description });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100">
        
        {/* Header */}
        <div className="bg-red-50 p-4 border-b border-red-100 flex justify-between items-center">
          <div>
            <h3 className="font-bold text-lg text-red-800 leading-none flex items-center gap-2">
              <AlertTriangle size={20} /> Registrar Gasto
            </h3>
            <p className="text-xs text-red-600 mt-1">Salida de dinero de la caja actual</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-red-100 text-red-400 hover:text-red-600 transition">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          
          {/* Input Monto Gigante */}
          <div>
            <label className="block text-xs font-bold text-sys-500 uppercase tracking-wider mb-2">Monto a Retirar</label>
            <div className="relative group">
              <span className="absolute left-4 top-4 text-sys-400 text-xl font-medium group-focus-within:text-red-500 transition-colors">$</span>
              <input
                ref={inputRef}
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-10 pr-4 py-3 text-3xl font-bold border-b-2 border-sys-200 focus:border-red-500 outline-none bg-transparent text-sys-900 placeholder-sys-200 transition-colors"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Input Descripción */}
          <div>
            <label className="block text-xs font-bold text-sys-500 uppercase tracking-wider mb-2">Motivo / Detalle</label>
            <div className="relative">
              <div className="absolute left-3 top-3 text-sys-400">
                <FileText size={18} />
              </div>
              <textarea 
                rows="2"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-sys-200 bg-sys-50 focus:bg-white focus:border-red-500 focus:ring-4 focus:ring-red-500/10 outline-none transition-all text-sm resize-none"
                placeholder="Ej: Pago Proveedor Pan, Compra Librería..."
              />
            </div>
          </div>

          {/* Botón Acción */}
          <Button 
            type="submit" 
            className="w-full py-4 text-lg bg-red-600 hover:bg-red-700 text-white shadow-xl shadow-red-500/20"
            disabled={!amount || !description}
          >
            Confirmar Salida <ArrowRight size={20} className="ml-2" />
          </Button>

        </form>
      </div>
    </div>
  );
};