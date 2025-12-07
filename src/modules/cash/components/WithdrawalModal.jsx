import React, { useState, useRef, useEffect } from 'react';
import { X, Lock, ArrowRight, Banknote } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

export const WithdrawalModal = ({ isOpen, onClose, onConfirm }) => {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setAmount('');
      setDescription('');
      setAdminPin('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (!val || val <= 0 || !adminPin) return;
    
    // Enviamos todo al dashboard para que valide
    onConfirm({ amount: val, description, adminPin });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        
        {/* Header - Estilo "Retiro Seguro" */}
        <div className="bg-orange-50 p-4 border-b border-orange-100 flex justify-between items-center">
          <div>
            <h3 className="font-bold text-lg text-orange-800 leading-none flex items-center gap-2">
              <Banknote size={20} /> Retiro de Efectivo
            </h3>
            <p className="text-xs text-orange-600 mt-1">Requiere autorización de Supervisor</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-orange-100 text-orange-400 transition">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          
          {/* 1. Monto */}
          <div>
            <label className="block text-xs font-bold text-sys-500 uppercase tracking-wider mb-2">Monto a Retirar</label>
            <div className="relative group">
              <span className="absolute left-4 top-3.5 text-sys-400 text-xl font-medium">$</span>
              <input
                ref={inputRef}
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-10 pr-4 py-3 text-2xl font-bold border-b-2 border-sys-200 focus:border-orange-500 outline-none bg-transparent text-sys-900"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* 2. Motivo */}
          <div>
            <label className="block text-xs font-bold text-sys-500 uppercase tracking-wider mb-2">Concepto</label>
            <input 
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-sys-200 bg-sys-50 focus:bg-white focus:border-orange-500 outline-none text-sm"
              placeholder="Ej: Retiro parcial a caja fuerte"
            />
          </div>

          {/* 3. PIN de Autorización (La clave de todo) */}
          <div className="bg-sys-50 p-4 rounded-xl border border-sys-200">
            <label className="block text-[10px] font-bold text-sys-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Lock size={12} /> PIN de Administrador
            </label>
            <input 
              type="password"
              value={adminPin}
              onChange={(e) => setAdminPin(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-sys-300 bg-white text-center font-mono text-lg tracking-widest focus:border-sys-900 outline-none"
              placeholder="• • • •"
              maxLength={6}
            />
            <p className="text-[10px] text-sys-400 text-center mt-2">
              El supervisor debe ingresar su clave para confirmar.
            </p>
          </div>

          <Button 
            type="submit" 
            className="w-full py-4 text-lg bg-orange-600 hover:bg-orange-700 text-white shadow-xl shadow-orange-500/20"
            disabled={!amount || !adminPin}
          >
            Autorizar Retiro <ArrowRight size={20} className="ml-2" />
          </Button>

        </form>
      </div>
    </div>
  );
};