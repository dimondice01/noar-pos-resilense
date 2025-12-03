import React from 'react';
import { Delete } from 'lucide-react';
import { cn } from '../../../core/utils/cn';

export const PinPad = ({ onInput, onClear, onSubmit, value = "", loading = false }) => {
  const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  return (
    <div className="w-full max-w-[280px] mx-auto">
      {/* Visor del PIN (Oculto) */}
      <div className="mb-6 flex justify-center gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div 
            key={i} 
            className={cn(
              "w-4 h-4 rounded-full transition-all duration-300",
              i < value.length 
                ? "bg-brand scale-110 shadow-[0_0_10px_rgba(0,102,204,0.5)]" 
                : "bg-sys-200"
            )}
          />
        ))}
      </div>

      {/* Grid Numérico */}
      <div className="grid grid-cols-3 gap-3">
        {numbers.map((num) => (
          <button
            key={num}
            onClick={() => onInput(num.toString())}
            disabled={loading || value.length >= 4}
            className="h-16 rounded-2xl bg-sys-50 text-sys-900 text-xl font-bold hover:bg-white hover:shadow-md hover:-translate-y-0.5 border border-sys-200 transition-all active:scale-95 disabled:opacity-50"
          >
            {num}
          </button>
        ))}
        
        {/* Botón Vacío (Espaciador) */}
        <div /> 

        <button
          onClick={() => onInput("0")}
          disabled={loading || value.length >= 4}
          className="h-16 rounded-2xl bg-sys-50 text-sys-900 text-xl font-bold hover:bg-white hover:shadow-md hover:-translate-y-0.5 border border-sys-200 transition-all active:scale-95"
        >
          0
        </button>

        <button
          onClick={onClear}
          disabled={loading || value.length === 0}
          className="h-16 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100 border border-red-100 transition-all active:scale-95"
        >
          <Delete size={24} />
        </button>
      </div>
    </div>
  );
};