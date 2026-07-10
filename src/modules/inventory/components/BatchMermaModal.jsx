import React, { useState, useEffect, useRef } from 'react';
import { X, Search, Loader2, ShieldAlert, Trash2 } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { productRepository } from '../repositories/productRepository';
import { cn } from '../../../core/utils/cn';
import toast from 'react-hot-toast';

export function BatchMermaModal({ isOpen, onClose, onConfirm }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [items, setItems] = useState([]);
    const [reason, setReason] = useState('Merma / Corte');
    const [isSaving, setIsSaving] = useState(false);
    const searchInputRef = useRef(null);
    const timeoutRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            setSearchTerm('');
            setSearchResults([]);
            setItems([]);
            setReason('Merma / Corte');
            setIsSaving(false);
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    useEffect(() => {
        clearTimeout(timeoutRef.current);
        if (searchTerm.trim().length < 2) { setSearchResults([]); return; }
        setIsSearching(true);
        timeoutRef.current = setTimeout(async () => {
            try {
                const results = await productRepository.search(searchTerm);
                setSearchResults(results.filter(p => !p.deleted).slice(0, 8));
            } catch (e) { console.error(e); }
            setIsSearching(false);
        }, 200);
        return () => clearTimeout(timeoutRef.current);
    }, [searchTerm]);

    if (!isOpen) return null;

    const addItem = (product) => {
        if (items.some(i => i.productId === product.id)) {
            toast.error('Ya está en la lista');
            return;
        }
        setItems(prev => [...prev, {
            productId: product.id,
            name: product.name,
            unit: product.isWeighable ? 'kg' : 'un',
            qty: ''
        }]);
        setSearchTerm('');
        setSearchResults([]);
        searchInputRef.current?.focus();
    };

    const updateQty = (productId, qty) => {
        setItems(prev => prev.map(i => i.productId === productId ? { ...i, qty } : i));
    };

    const removeItem = (productId) => {
        setItems(prev => prev.filter(i => i.productId !== productId));
    };

    const validItems = items.filter(i => parseFloat(String(i.qty).replace(',', '.')) > 0);

    const handleConfirm = async () => {
        if (validItems.length === 0) return toast.error('Cargá la cantidad de al menos un producto');
        if (!reason.trim()) return toast.error('Ingresá un motivo para la merma');

        setIsSaving(true);
        try {
            await onConfirm(
                validItems.map(i => ({ productId: i.productId, qty: parseFloat(String(i.qty).replace(',', '.')) })),
                reason.trim()
            );
            onClose();
        } catch (e) {
            console.error(e);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
                <div className="p-5 bg-red-600 text-white flex justify-between items-center shrink-0">
                    <h3 className="font-bold flex items-center gap-2 text-lg"><ShieldAlert size={20} /> Mermas en Lote</h3>
                    <button onClick={onClose} className="hover:bg-white/20 p-1.5 rounded-full transition-colors"><X size={20} /></button>
                </div>

                <div className="p-5 border-b border-sys-200 shrink-0 space-y-3">
                    <div className="relative">
                        <Search className="absolute left-3.5 top-3.5 text-sys-400" size={18} />
                        <input
                            ref={searchInputRef}
                            type="text"
                            className="w-full pl-10 pr-4 py-3 bg-sys-50 border-2 border-transparent rounded-xl outline-none focus:border-red-400 focus:bg-white transition-all font-bold text-sm uppercase"
                            placeholder="Buscar producto por nombre o código..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        {isSearching && <Loader2 className="absolute right-3.5 top-3.5 text-red-500 animate-spin" size={18} />}

                        {searchResults.length > 0 && (
                            <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-white border border-sys-200 rounded-xl shadow-xl max-h-64 overflow-y-auto">
                                {searchResults.map(p => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => addItem(p)}
                                        className="w-full text-left px-4 py-2.5 hover:bg-red-50 transition-colors flex items-center justify-between gap-2 border-b border-sys-100 last:border-0"
                                    >
                                        <span className="text-sm font-bold text-sys-800 truncate">{p.name}</span>
                                        <span className="text-[10px] font-black text-sys-400 uppercase shrink-0">{p.isWeighable ? 'kg' : 'un'}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="text-[10px] text-sys-500 uppercase font-black tracking-widest mb-1 block">Motivo (aplica a todo el lote)</label>
                        <input
                            type="text"
                            className="w-full text-sm font-bold p-2.5 bg-white border-2 border-sys-200 rounded-xl focus:border-red-400 outline-none transition-colors"
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            placeholder="Ej: Corte para Bandeja de Picada"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-2">
                    {items.length === 0 && (
                        <p className="text-center text-sys-400 text-sm py-10">Buscá y agregá los productos que vas a pesar</p>
                    )}
                    {items.map(item => (
                        <div key={item.productId} className="flex items-center gap-3 bg-sys-50 border border-sys-200 rounded-xl px-3 py-2.5">
                            <span className="flex-1 text-sm font-bold text-sys-800 truncate">{item.name}</span>
                            <input
                                type="number"
                                step="0.001"
                                autoFocus
                                className={cn(
                                    "w-24 text-right font-black p-2 border-2 rounded-lg outline-none transition-colors",
                                    parseFloat(String(item.qty).replace(',', '.')) > 0
                                        ? "bg-red-50 border-red-200 text-red-600 focus:border-red-500"
                                        : "bg-white border-sys-200 text-sys-700 focus:border-red-400"
                                )}
                                placeholder="0"
                                value={item.qty}
                                onChange={e => updateQty(item.productId, e.target.value)}
                            />
                            <span className="text-[10px] font-black text-sys-400 uppercase w-6">{item.unit}</span>
                            <button type="button" onClick={() => removeItem(item.productId)} className="text-sys-300 hover:text-red-500 transition-colors shrink-0">
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}
                </div>

                <div className="p-5 border-t border-sys-200 shrink-0">
                    <Button
                        onClick={handleConfirm}
                        disabled={isSaving || validItems.length === 0}
                        className="w-full py-4 text-base font-black bg-red-600 hover:bg-red-700 shadow-lg shadow-red-200"
                    >
                        {isSaving ? 'Registrando...' : `Registrar Merma (${validItems.length} producto${validItems.length !== 1 ? 's' : ''})`}
                    </Button>
                </div>
            </div>
        </div>
    );
}
