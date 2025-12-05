import React, { useState } from 'react';
import { X, Lock, DollarSign, CreditCard, ShieldCheck } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

export const CashClosingModal = ({ isOpen, onClose, systemTotals, onConfirm }) => {
  const [declaredCash, setDeclaredCash] = useState('');
  
  // 🔥 LÓGICA SEGURA:
  // 1. Digital: Asumimos que lo que dice el sistema ES LA VERDAD (porque vino de MP/Clover/Transferencia registrada).
  // 2. Efectivo: Calculamos la diferencia pero NO SE LA MOSTRAMOS al cajero (Cierre Ciego).
  
  const declaredDigital = systemTotals.totalDigital; // Automático
  const difference = (parseFloat(declaredCash) || 0) - systemTotals.totalCash;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/80 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        
        {/* Header Seguro */}
        <div className="bg-sys-900 p-6 text-white flex justify-between items-center">
            <div className="flex items-center gap-3">
                <div className="bg-white/10 p-2 rounded-lg"><Lock size={24}/></div>
                <div>
                    <h3 className="font-bold text-lg leading-tight">Cierre de Turno</h3>
                    <p className="text-xs text-sys-300">Procedimiento de arqueo ciego</p>
                </div>
            </div>
            <button onClick={onClose}><X className="text-sys-400 hover:text-white transition-colors" /></button>
        </div>

        {/* Formulario */}
        <div className="p-6 space-y-6">
            
            {/* 1. DIGITAL (AUTOMÁTICO) */}
            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                <div className="flex justify-between items-start mb-1">
                    <label className="text-xs font-bold text-blue-700 uppercase flex items-center gap-1">
                        <CreditCard size={12}/> Pagos Digitales
                    </label>
                    <span className="bg-blue-200 text-blue-800 text-[9px] px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                        <ShieldCheck size={10}/> VERIFICADO
                    </span>
                </div>
                <div className="text-2xl font-black text-blue-900">
                    $ {systemTotals.totalDigital.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                </div>
                <p className="text-[10px] text-blue-600/80 mt-1 leading-tight">
                    Suma automática de MercadoPago, Clover y Transferencias registradas.
                </p>
            </div>

            {/* 2. EFECTIVO (MANUAL) */}
            <div className="space-y-2">
                <label className="text-sm font-bold text-sys-700 flex items-center gap-2">
                    <DollarSign size={16} className="text-green-600"/> Efectivo Físico en Caja
                </label>
                <div className="relative group">
                    <span className="absolute left-4 top-3.5 text-sys-400 font-bold group-focus-within:text-brand transition-colors">$</span>
                    <input 
                        type="number" 
                        autoFocus
                        className="w-full bg-white border-2 border-sys-200 rounded-xl py-3 pl-8 pr-4 font-bold text-xl outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all placeholder-sys-200"
                        placeholder="0.00"
                        value={declaredCash}
                        onChange={(e) => setDeclaredCash(e.target.value)}
                    />
                </div>
                <p className="text-[11px] text-sys-500 italic border-l-2 border-brand pl-2 py-1 bg-sys-50 rounded-r">
                    ⚠️ Cuente billetes y monedas. No incluya vouchers ni tickets.
                </p>
            </div>

        </div>

        {/* Footer */}
        <div className="p-6 bg-sys-50 border-t border-sys-100 flex flex-col gap-3">
            <Button 
                onClick={() => onConfirm({ 
                    declaredCash: parseFloat(declaredCash) || 0,
                    declaredDigital: declaredDigital, // Pasamos el automático
                    difference: difference // Guardamos la diferencia, pero NO LA MOSTRAMOS
                })}
                className="w-full py-4 text-lg shadow-xl shadow-brand/20"
                disabled={!declaredCash}
            >
                Confirmar y Cerrar
            </Button>
            <button onClick={onClose} className="text-xs text-sys-400 hover:text-sys-600 font-medium underline">
                Cancelar operación
            </button>
        </div>

      </div>
    </div>
  );
};