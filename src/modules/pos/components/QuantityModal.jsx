import React, { useState, useEffect, useRef } from 'react';
import { X, Scale, DollarSign, Package, Minus, Plus, Calculator } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

export const QuantityModal = ({ product, isOpen, onClose, onConfirm }) => {
  const inputRef = useRef(null);
  
  // Estado
  // 'amount' es el default ahora para productos pesables (Dinero primero)
  const [mode, setMode] = useState('amount'); // 'weight' | 'amount' | 'unit'
  const [value, setValue] = useState(''); 

  // Efecto: Cuando abre, resetea y enfoca
  useEffect(() => {
    if (isOpen && product) {
      // 🔥 CAMBIO CLAVE: Si es pesable, priorizamos 'amount' (Dinero)
      setMode(product.isWeighable ? 'amount' : 'unit');
      setValue(''); // Empezar vacío para escribir directo
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, product]);

  if (!isOpen || !product) return null;

  // LÓGICA DE CÁLCULO
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
      // Evitamos división por cero si el precio es 0 (aunque no debería)
      finalQuantity = product.price > 0 ? finalTotal / product.price : 0;
    }
  } else {
    // Modo Unitario (Input es Cantidad)
    finalQuantity = parseInt(value || 1); 
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
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-sys-900/60 backdrop-blur-md p-4 animate-in fade-in zoom-in-95 duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100 ring-1 ring-sys-900/5">
        
        {/* Header con gradiente sutil */}
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

        <form onSubmit={handleSubmit} className="p-6 space-y-8">
          
          {/* SECCIÓN 1: Selector de Modo (Solo para Pesables) */}
          {product.isWeighable && (
            <div className="bg-sys-100 p-1.5 rounded-2xl flex relative">
                {/* Fondo animado del toggle (opcional, simplificado con clases condicionales) */}
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

          {/* SECCIÓN 2: Input Gigante */}
          <div className="relative flex items-center justify-center gap-4">
            
            {/* Botón Menos (Solo unitarios) */}
            {!product.isWeighable && (
               <button type="button" onClick={() => adjustUnit(-1)} className="w-14 h-14 rounded-2xl bg-sys-50 border border-sys-200 hover:bg-sys-100 hover:border-sys-300 flex items-center justify-center text-sys-500 active:scale-95 transition-all">
                 <Minus size={24} />
               </button>
            )}

            <div className="relative w-full max-w-[200px] group">
                {/* Signo pesos si es modo monto */}
                {mode === 'amount' && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 text-sys-300 text-4xl font-black transition-colors group-focus-within:text-green-500/50">$</span>
                )}
                
                <input
                    ref={inputRef}
                    type="number"
                    step={product.isWeighable ? "0.001" : "1"}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className={cn(
                        "w-full text-6xl font-black text-center border-b-2 border-sys-200 outline-none py-2 bg-transparent placeholder-sys-200 transition-all",
                        mode === 'amount' ? "focus:border-green-500 text-sys-900" : "focus:border-brand text-sys-900",
                        mode === 'amount' ? "pl-8" : "" // Espacio para el signo $
                    )}
                    placeholder="0"
                />
                
                {/* Sufijo KG si es modo peso */}
                {mode === 'weight' && (
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 text-sys-300 text-lg font-bold">kg</span>
                )}
            </div>

            {/* Botón Mas (Solo unitarios) */}
            {!product.isWeighable && (
               <button type="button" onClick={() => adjustUnit(1)} className="w-14 h-14 rounded-2xl bg-brand text-white shadow-lg shadow-brand/30 hover:bg-brand-hover active:scale-95 transition-all flex items-center justify-center">
                 <Plus size={28} />
               </button>
            )}
          </div>
          
          <div className="text-center text-sys-400 font-medium text-sm">
             {product.isWeighable 
                ? (mode === 'weight' ? 'Ingrese los kilogramos' : 'Ingrese el monto a cobrar')
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

             {/* Si es pesable y estoy poniendo peso, muéstrame el precio por kilo de nuevo */}
             {product.isWeighable && mode === 'weight' && (
                 <div className="text-right opacity-60">
                     <Calculator size={32} />
                 </div>
             )}
          </div>

          <Button 
            type="submit" 
            className={cn(
                "w-full py-4 text-lg h-14 shadow-xl transition-all active:scale-[0.98]", 
                mode === 'amount' ? "bg-green-600 hover:bg-green-700 shadow-green-500/20" : "shadow-brand/20"
            )}
          >
            Confirmar e Ingresar ↵
          </Button>
        </form>
      </div>
    </div>
  );
};