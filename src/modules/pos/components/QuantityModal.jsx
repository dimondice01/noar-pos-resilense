import React, { useState, useEffect, useRef } from 'react';
import { X, Scale, DollarSign, Package, Minus, Plus } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

export const QuantityModal = ({ product, isOpen, onClose, onConfirm }) => {
  const inputRef = useRef(null);
  
  // Estado
  // 'amount' es el default para pesables (Cobrar por plata)
  // 'unit' para unitarios
  const [mode, setMode] = useState('amount'); 
  const [value, setValue] = useState(''); 

  // Efecto: Cuando abre, resetea y enfoca
  useEffect(() => {
    if (isOpen && product) {
      setMode(product.isWeighable ? 'amount' : 'unit');
      setValue(''); // Empezar vacío
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, product]);

  if (!isOpen || !product) return null;

  // LÓGICA DE CÁLCULO (Vista Previa)
  let finalQuantity = 0;
  let finalTotal = 0;

  if (product.isWeighable) {
    if (mode === 'weight') {
      // Input es Kilos
      finalQuantity = parseFloat(value || 0);
      finalTotal = finalQuantity * product.price;
    } else {
      // Input es Dinero ($)
      finalTotal = parseFloat(value || 0);
      finalQuantity = product.price > 0 ? finalTotal / product.price : 0;
    }
  } else {
    // Modo Unitario
    finalQuantity = parseInt(value || 1); 
    finalTotal = finalQuantity * product.price;
  }

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (finalQuantity <= 0) return;
    onConfirm(product, finalQuantity, product.price);
    onClose();
  };

  // 🔥 LÓGICA DE FLECHAS (MATEMÁTICA EXACTA)
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
    }
    if (e.key === 'Escape') onClose();

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const direction = e.key === 'ArrowUp' ? 1 : -1;
        const currentVal = parseFloat(value) || 0;
        
        // Definir el paso según el modo
        let step = 1; 
        if (mode === 'weight') step = 0.1; // 100g para peso
        
        let next = currentVal + (step * direction);
        
        // Bloqueo de negativos
        if (next < 0) next = 0;

        // Formateo para evitar errores de punto flotante (ej: 0.3000004)
        if (mode === 'weight') {
            setValue(next.toFixed(3));
        } else {
            setValue(next.toFixed(0)); // Enteros para $ y Unidades
        }
    }
  };

  // Helpers para botones visuales +/-
  const adjustValue = (delta) => {
      // Simulamos lógica de flechas
      const currentVal = parseFloat(value) || 0;
      let step = 1;
      if (mode === 'weight') step = 0.1;
      
      let next = currentVal + (step * delta);
      if (next < 0) next = 0;

      if (mode === 'weight') setValue(next.toFixed(3));
      else setValue(next.toFixed(0));
      
      inputRef.current?.focus();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-sys-900/60 backdrop-blur-md p-4 animate-in fade-in zoom-in-95 duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100 ring-1 ring-sys-900/5">
        
        {/* Header */}
        <div className="bg-gradient-to-b from-sys-50 to-white p-5 border-b border-sys-100 flex justify-between items-center">
          <div>
            <h3 className="font-black text-xl text-sys-900 leading-none tracking-tight">{product.name}</h3>
            <div className="flex items-center gap-2 mt-1.5">
                <span className="text-xs font-bold bg-sys-100 text-sys-600 px-2 py-0.5 rounded border border-sys-200">
                    $ {product.price.toLocaleString('es-AR')} {product.isWeighable ? 'x Kg' : 'un'}
                </span>
                <span className="text-[10px] text-sys-400 uppercase tracking-wider font-semibold">
                    {product.isWeighable ? 'Producto Pesable' : 'Unidad'}
                </span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-sys-100 text-sys-400 hover:text-sys-700 transition">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-8">
          
          {/* SECCIÓN 1: Selector de Modo (Solo para Pesables) */}
          {product.isWeighable && (
            <div className="bg-sys-100 p-1.5 rounded-2xl flex relative">
              <button
                type="button"
                onClick={() => { setMode('amount'); setValue(''); inputRef.current?.focus(); }}
                className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all duration-200", 
                    mode === 'amount' 
                        ? 'bg-white text-green-600 shadow-sm ring-1 ring-black/5' 
                        : 'text-sys-500 hover:text-sys-700'
                )}
              >
                <DollarSign size={18} strokeWidth={2.5} /> Por Monto ($)
              </button>
              <button
                type="button"
                onClick={() => { setMode('weight'); setValue(''); inputRef.current?.focus(); }}
                className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all duration-200", 
                    mode === 'weight' 
                        ? 'bg-white text-brand shadow-sm ring-1 ring-black/5' 
                        : 'text-sys-500 hover:text-sys-700'
                )}
              >
                <Scale size={18} strokeWidth={2.5} /> Por Peso (kg)
              </button>
            </div>
          )}

          {/* SECCIÓN 2: Input Gigante con Botones */}
          <div className="relative flex items-center justify-center gap-4">
            
            <button type="button" onClick={() => adjustValue(-1)} className="w-14 h-14 rounded-2xl bg-sys-50 border border-sys-200 hover:bg-sys-100 hover:border-sys-300 flex items-center justify-center text-sys-500 active:scale-95 transition-all">
                <Minus size={24} />
            </button>

            <div className="relative w-full max-w-[200px] group">
                {/* Signo pesos si es modo monto */}
                {mode === 'amount' && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 text-sys-300 text-4xl font-black transition-colors group-focus-within:text-green-500/50">$</span>
                )}
                
                <input
                    ref={inputRef}
                    type="number"
                    // Si es monto o unitario, step 1. Si es peso, step 0.1
                    step={mode === 'weight' ? "0.1" : "1"}
                    value={value}
                    onChange={(e) => {
                        // Permitir vacío o positivos
                        if (e.target.value === '' || parseFloat(e.target.value) >= 0) {
                            setValue(e.target.value);
                        }
                    }}
                    onKeyDown={handleKeyDown}
                    className={cn(
                        "w-full text-6xl font-black text-center border-b-2 border-sys-200 outline-none py-2 bg-transparent placeholder-sys-200 transition-all",
                        mode === 'amount' ? "focus:border-green-500 text-sys-900" : "focus:border-brand text-sys-900",
                        mode === 'amount' ? "pl-6" : "" // Ajuste visual
                    )}
                    placeholder="0"
                />
                
                {/* Sufijo KG si es modo peso */}
                {mode === 'weight' && (
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 text-sys-300 text-lg font-bold">kg</span>
                )}
            </div>

            <button type="button" onClick={() => adjustValue(1)} className="w-14 h-14 rounded-2xl bg-brand text-white shadow-lg shadow-brand/30 hover:bg-brand-hover active:scale-95 transition-all flex items-center justify-center">
                <Plus size={28} />
            </button>
          </div>
          
          <div className="text-center text-sys-400 font-medium text-sm">
              {product.isWeighable 
                ? (mode === 'weight' ? 'Ingrese los kilogramos (cada 100g)' : 'Ingrese el monto a cobrar')
                : 'Ingrese la cantidad de unidades'
              }
          </div>

          {/* SECCIÓN 3: Resumen Inteligente */}
          <div className={cn(
              "rounded-2xl p-5 border transition-colors flex items-center justify-between",
              mode === 'amount' ? "bg-green-50/50 border-green-100" : "bg-sys-50 border-sys-100"
          )}>
              <div>
                <p className="text-sys-500 text-xs font-bold uppercase tracking-wider mb-1">Total a Pagar</p>
                <p className={cn("text-3xl font-black tracking-tight", mode === 'amount' ? "text-green-700" : "text-sys-900")}>
                  $ {finalTotal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              
              {/* Si es pesable y estoy poniendo plata, muéstrame cuánto peso es */}
              {product.isWeighable && mode === 'amount' && (
                <div className="text-right">
                    <p className="text-sys-500 text-xs font-bold uppercase tracking-wider mb-1">Peso Calc.</p>
                    <div className="bg-white/80 px-3 py-1 rounded-lg border border-green-200 shadow-sm">
                        <span className="text-lg font-bold text-sys-800 font-mono">{finalQuantity.toFixed(3)}</span>
                        <span className="text-xs text-sys-500 ml-1">kg</span>
                    </div>
                </div>
              )}
          </div>

          <Button 
            onClick={handleSubmit} 
            className={cn(
                "w-full py-4 text-lg h-14 shadow-xl transition-all active:scale-[0.98]", 
                mode === 'amount' ? "bg-green-600 hover:bg-green-700 shadow-green-500/20" : "shadow-brand/20"
            )}
          >
            Confirmar e Ingresar ↵
          </Button>
        </div>
      </div>
    </div>
  );
};