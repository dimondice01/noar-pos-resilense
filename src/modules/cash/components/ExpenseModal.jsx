import React, { useState, useRef, useEffect } from 'react';
import { X, DollarSign, FileText, ArrowRight, TrendingDown } from 'lucide-react';
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
    
    // Validaciones
    if (!val || val <= 0) return;
    if (!description.trim()) return;
    
    onConfirm({ amount: val, description });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100 ring-1 ring-black/5">
        
        {/* Header - Estilo Gasto (Rose/Red) */}
        <div className="bg-rose-50 p-5 border-b border-rose-100 flex justify-between items-center">
          <div>
            <h3 className="font-bold text-lg text-rose-800 leading-none flex items-center gap-2">
              <TrendingDown size={20} /> Registrar Gasto
            </h3>
            <p className="text-xs text-rose-600 mt-1 font-medium">Salida de dinero operativa</p>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 rounded-full hover:bg-rose-100 text-rose-400 hover:text-rose-600 transition"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          
          {/* Input Monto Gigante */}
          <div>
            <label className="block text-xs font-bold text-sys-500 uppercase tracking-wider mb-2">Monto a Pagar</label>
            <div className="relative group">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sys-400 text-xl font-medium group-focus-within:text-rose-500 transition-colors">$</span>
              <input
                ref={inputRef}
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-10 pr-4 py-3 text-3xl font-black border-b-2 border-sys-200 focus:border-rose-500 outline-none bg-transparent text-sys-900 placeholder-sys-200 transition-colors"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Input Descripción */}
          <div>
            <label className="block text-xs font-bold text-sys-500 uppercase tracking-wider mb-2">Concepto / Detalle</label>
            <div className="relative">
              <div className="absolute left-3 top-3 text-sys-400">
                <FileText size={18} />
              </div>
              <textarea 
                rows="2"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-sys-200 bg-sys-50 focus:bg-white focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 outline-none transition-all text-sm resize-none font-medium text-sys-800"
                placeholder="Ej: Pago Proveedor Pan, Artículos de Limpieza..."
              />
            </div>
          </div>

          {/* Botón Acción */}
          <Button 
            type="submit" 
            className="w-full py-4 text-lg bg-rose-600 hover:bg-rose-700 text-white shadow-xl shadow-rose-500/20 h-14 rounded-xl"
            disabled={!amount || !description}
          >
            Confirmar Gasto <ArrowRight size={20} className="ml-2" />
          </Button>

        </form>
      </div>
    </div>
  );
};