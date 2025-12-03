import React, { useState, useEffect, useRef } from 'react';
import { X, Scale, DollarSign, Package, Minus, Plus } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

export const QuantityModal = ({ product, isOpen, onClose, onConfirm }) => {
  const inputRef = useRef(null);
  
  // Estado
  const [mode, setMode] = useState('weight'); // 'weight' | 'amount' | 'unit'
  const [value, setValue] = useState(''); 

  // Efecto: Cuando abre, resetea y enfoca
  useEffect(() => {
    if (isOpen && product) {
      setMode(product.isWeighable ? 'weight' : 'unit');
      setValue(''); // Empezar vacío para que escriban directo
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, product]);

  if (!isOpen || !product) return null;

  // LÓGICA DE CÁLCULO
  let finalQuantity = 0;
  let finalTotal = 0;

  if (product.isWeighable) {
    if (mode === 'weight') {
      finalQuantity = parseFloat(value || 0);
      finalTotal = finalQuantity * product.price;
    } else {
      finalTotal = parseFloat(value || 0);
      finalQuantity = finalTotal / product.price;
    }
  } else {
    // Modo Unitario
    finalQuantity = parseInt(value || 1); // Default 1
    finalTotal = finalQuantity * product.price;
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    if (finalQuantity <= 0) return;
    onConfirm(product, finalQuantity, product.price);
    onClose();
  };

  // Helpers para Unitarios (+ / -)
  const adjustUnit = (delta) => {
    const current = parseInt(value || 0);
    const next = Math.max(1, current + delta);
    setValue(next.toString());
    inputRef.current?.focus();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100">
        
        {/* Header */}
        <div className="bg-sys-50 p-4 border-b border-sys-100 flex justify-between items-center">
          <div>
            <h3 className="font-bold text-lg text-sys-800 leading-none">{product.name}</h3>
            <p className="text-xs text-sys-500 mt-1">Precio base: ${product.price}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-sys-200 text-sys-500 transition">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          
          {/* SECCIÓN 1: Selector de Modo (Solo para Pesables) */}
          {product.isWeighable && (
            <div className="flex bg-sys-100 p-1 rounded-xl mb-4">
              <button
                type="button"
                onClick={() => { setMode('weight'); setValue(''); inputRef.current?.focus(); }}
                className={cn("flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all", mode === 'weight' ? 'bg-white shadow-sm text-brand' : 'text-sys-500')}
              >
                <Scale size={16} /> Por Peso
              </button>
              <button
                type="button"
                onClick={() => { setMode('amount'); setValue(''); inputRef.current?.focus(); }}
                className={cn("flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all", mode === 'amount' ? 'bg-white shadow-sm text-green-600' : 'text-sys-500')}
              >
                <DollarSign size={16} /> Por Monto
              </button>
            </div>
          )}

          {/* SECCIÓN 2: Input Gigante */}
          <div className="relative flex items-center justify-center gap-4">
            
            {/* Botón Menos (Solo unitarios) */}
            {!product.isWeighable && (
               <button type="button" onClick={() => adjustUnit(-1)} className="w-12 h-12 rounded-full bg-sys-100 hover:bg-sys-200 flex items-center justify-center text-sys-600 active:scale-90 transition">
                 <Minus size={24} />
               </button>
            )}

            <div className="relative w-40">
                <input
                ref={inputRef}
                type="number"
                step={product.isWeighable ? "0.001" : "1"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full text-5xl font-bold text-center border-b-2 border-sys-200 focus:border-brand outline-none py-2 bg-transparent text-sys-900 placeholder-sys-200"
                placeholder={product.isWeighable ? "0.000" : "1"}
                />
            </div>

            {/* Botón Mas (Solo unitarios) */}
            {!product.isWeighable && (
               <button type="button" onClick={() => adjustUnit(1)} className="w-12 h-12 rounded-full bg-brand hover:bg-brand-hover flex items-center justify-center text-white shadow-lg active:scale-90 transition">
                 <Plus size={24} />
               </button>
            )}
          </div>
          
          <div className="text-center text-sys-400 font-medium">
             {product.isWeighable 
                ? (mode === 'weight' ? 'Kilogramos' : 'Pesos ($)')
                : 'Unidades'
             }
          </div>

          {/* SECCIÓN 3: Resumen */}
          <div className="bg-sys-50 rounded-xl p-4 border border-sys-100">
             <div className="flex justify-between items-end">
               <span className="text-sys-500 text-sm pb-1">Total Calculado:</span>
               <span className="font-bold text-2xl text-sys-900 tracking-tight">
                 $ {finalTotal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
               </span>
             </div>
             {product.isWeighable && mode === 'amount' && (
                <div className="text-right text-xs text-sys-500 mt-1">
                    Son: {finalQuantity.toFixed(3)} kg
                </div>
             )}
          </div>

          <Button type="submit" className="w-full py-4 text-lg shadow-xl shadow-brand/20">
            Confirmar e Ingresar ↵
          </Button>
        </form>
      </div>
    </div>
  );
};