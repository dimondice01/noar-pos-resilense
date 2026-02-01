import React from 'react';
import { Delete, Loader2 } from 'lucide-react';
import { cn } from '../../../core/utils/cn';

export const PinPad = ({ onInput, onClear, value = "", loading = false, hasError = false }) => {
    const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    // Manejador interno para evitar entradas si está cargando
    const handlePress = (num) => {
        if (loading || value.length >= 4) return;
        onInput(num.toString());
    };

    return (
        <div className={cn(
            "w-full max-w-[300px] mx-auto transition-transform duration-300",
            hasError && "animate-shake" // 🔥 Feedback visual de error
        )}>
            {/* ==========================================
                VISOR DEL PIN (PUNTOS MÁGICOS)
            ========================================== */}
            <div className="mb-8 flex justify-center gap-5">
                {[0, 1, 2, 3].map((i) => (
                    <div 
                        key={i} 
                        className={cn(
                            "w-5 h-5 rounded-full border-2 transition-all duration-300",
                            i < value.length 
                                ? "bg-brand border-brand scale-125 shadow-[0_0_15px_rgba(0,102,204,0.6)]" 
                                : "bg-transparent border-sys-300"
                        )}
                    />
                ))}
            </div>

            {/* ==========================================
                GRID NUMÉRICO TÁCTIL
            ========================================== */}
            <div className="grid grid-cols-3 gap-4">
                {numbers.map((num) => (
                    <button
                        key={num}
                        type="button"
                        onClick={() => handlePress(num)}
                        disabled={loading || value.length >= 4}
                        className={cn(
                            "h-16 rounded-2xl text-2xl font-black transition-all active:scale-90 disabled:opacity-40",
                            "bg-white border-2 border-sys-100 text-sys-900 shadow-sm",
                            "hover:border-brand hover:text-brand hover:shadow-md"
                        )}
                    >
                        {num}
                    </button>
                ))}
                
                {/* Botón de Limpiar / Reset */}
                <button
                    type="button"
                    onClick={() => onInput("")} // Limpia todo el PIN
                    disabled={loading || value.length === 0}
                    className="h-16 rounded-2xl bg-sys-50 text-sys-400 text-xs font-black hover:bg-sys-100 transition-all active:scale-95 uppercase"
                >
                    C
                </button>

                {/* Cero */}
                <button
                    type="button"
                    onClick={() => handlePress(0)}
                    disabled={loading || value.length >= 4}
                    className={cn(
                        "h-16 rounded-2xl text-2xl font-black transition-all active:scale-90",
                        "bg-white border-2 border-sys-100 text-sys-900 shadow-sm",
                        "hover:border-brand hover:text-brand"
                    )}
                >
                    0
                </button>

                {/* Borrar (Backsapce) */}
                <button
                    type="button"
                    onClick={onClear}
                    disabled={loading || value.length === 0}
                    className="h-16 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100 border-2 border-red-100 transition-all active:scale-95"
                >
                    {loading ? <Loader2 className="animate-spin" size={24} /> : <Delete size={28} />}
                </button>
            </div>

            {/* Texto de Ayuda Inferior */}
            <div className="mt-6 text-center">
                <p className="text-[10px] font-bold text-sys-400 uppercase tracking-[0.2em]">
                    {loading ? "Validando PIN..." : "Seguridad de Sucursal Activa"}
                </p>
            </div>
        </div>
    );
};