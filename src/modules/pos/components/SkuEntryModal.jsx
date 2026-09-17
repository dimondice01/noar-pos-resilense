import React, { useState, useEffect, useRef } from 'react';
import { X, Fingerprint, Trash2, Plus } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

// 🔥 SKU único por unidad física (ej: perfumes originales): la cantidad del ítem
// se DERIVA de cuántos SKU se escaneen/tipeen acá, no al revés. Cubre tanto agregar
// el producto por primera vez como sumar/quitar unidades de uno ya en el carrito.
export const SkuEntryModal = ({ request, onConfirm, onClose }) => {
    const [skus, setSkus] = useState([]);
    const [value, setValue] = useState('');
    const inputRef = useRef(null);

    const isOpen = !!request;
    const product = request?.product;

    useEffect(() => {
        if (isOpen) {
            setSkus(request.existingSkus || []);
            setValue('');
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen, request]);

    if (!isOpen) return null;

    const addSku = () => {
        const clean = value.trim();
        if (!clean) return;
        if (skus.includes(clean)) {
            setValue('');
            return;
        }
        setSkus(prev => [...prev, clean]);
        setValue('');
    };

    const removeSku = (idx) => {
        setSkus(prev => prev.filter((_, i) => i !== idx));
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addSku();
        }
        if (e.key === 'Escape') onClose();
    };

    const handleConfirm = () => {
        onConfirm(product, skus);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-sys-900/60 p-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden ring-1 ring-sys-900/5">
                <div className="bg-gradient-to-b from-purple-50 to-white p-5 border-b border-sys-100 flex justify-between items-center">
                    <div>
                        <h3 className="font-black text-lg text-sys-900 leading-none tracking-tight flex items-center gap-2">
                            <Fingerprint size={20} className="text-purple-600" /> {product?.name}
                        </h3>
                        <p className="text-xs text-purple-600 font-bold mt-1.5">SKU único por unidad — escaneá o escribí cada uno</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-sys-100 text-sys-400 hover:text-sys-700 transition">
                        <X size={22} />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <div className="flex gap-2">
                        <input
                            ref={inputRef}
                            type="text"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Escanear o tipear SKU..."
                            className="flex-1 bg-sys-50 border-2 border-sys-200 rounded-xl px-4 py-3 text-sm font-mono font-bold outline-none focus:border-purple-400"
                        />
                        <button
                            type="button"
                            onClick={addSku}
                            className="w-12 h-12 rounded-xl bg-purple-600 text-white flex items-center justify-center hover:bg-purple-700 active:scale-95 transition-all shrink-0"
                        >
                            <Plus size={22} />
                        </button>
                    </div>

                    <div className="max-h-[220px] overflow-y-auto space-y-1.5 custom-scrollbar">
                        {skus.length === 0 ? (
                            <p className="text-center text-xs text-sys-400 py-6">Todavía no agregaste ningún SKU.</p>
                        ) : (
                            skus.map((sku, idx) => (
                                <div key={`${sku}-${idx}`} className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-xl px-3 py-2">
                                    <span className="text-xs font-mono font-bold text-purple-800">Unidad {idx + 1}: {sku}</span>
                                    <button onClick={() => removeSku(idx)} className="text-purple-400 hover:text-red-500 transition-colors">
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="flex items-center justify-between bg-sys-50 rounded-2xl px-5 py-3 border border-sys-100">
                        <span className="text-xs font-bold text-sys-500 uppercase tracking-wider">Cantidad</span>
                        <span className="text-2xl font-black text-sys-900">{skus.length}</span>
                    </div>

                    <Button
                        onClick={handleConfirm}
                        className={cn("w-full py-4 text-base h-14 shadow-xl transition-all active:scale-[0.98]", skus.length === 0 ? "bg-red-500 hover:bg-red-600 shadow-red-500/20" : "bg-purple-600 hover:bg-purple-700 shadow-purple-500/20")}
                    >
                        {skus.length === 0 ? 'Quitar del carrito' : `Confirmar ${skus.length} unidad(es)`}
                    </Button>
                </div>
            </div>
        </div>
    );
};
