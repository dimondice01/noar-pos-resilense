import React, { useState, useEffect, useRef } from 'react';
import { X, Search, Loader2, Link, ArrowRight, Package } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { productRepository } from '../repositories/productRepository';
import toast from 'react-hot-toast';

export function AnexarModal({ isOpen, onClose, childProduct, onSuccess }) {
    const [parentProduct, setParentProduct] = useState(null);
    const [label, setLabel] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const timeoutRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return;
        setParentProduct(null);
        setLabel('');
        setSearchQuery('');
        setSearchResults([]);
    }, [isOpen, childProduct]);

    // Inferir label automáticamente cuando se elige el padre
    useEffect(() => {
        if (!parentProduct || !childProduct) return;
        const childName = (childProduct.name || '').trim().toUpperCase();
        const parentName = (parentProduct.name || '').trim().toUpperCase();
        const inferred = childName.startsWith(parentName)
            ? childName.slice(parentName.length).trim()
            : childName;
        setLabel(inferred);
    }, [parentProduct, childProduct]);

    useEffect(() => {
        if (!searchQuery.trim() || searchQuery.length < 2) { setSearchResults([]); return; }
        clearTimeout(timeoutRef.current);
        setIsSearching(true);
        timeoutRef.current = setTimeout(async () => {
            try {
                const results = await productRepository.search(searchQuery);
                setSearchResults(
                    results.filter(p => !p.deleted && p.id !== childProduct?.id && p.isWeighable).slice(0, 6)
                );
            } catch (e) { }
            setIsSearching(false);
        }, 300);
    }, [searchQuery, childProduct]);

    const handleConfirm = async () => {
        if (!parentProduct) return toast.error('Seleccioná el producto padre');
        if (!label.trim()) return toast.error('Ingresá un tipo/variante (ej: PIEZA, MAYOR)');
        setIsSaving(true);
        try {
            const updated = await productRepository.mergeAsVariant(childProduct.id, parentProduct.id, label);
            toast.success(`"${childProduct.name}" anexado a "${parentProduct.name}" como variante ${label}`);
            onSuccess(childProduct.id, updated);
            onClose();
        } catch (e) {
            toast.error(e.message || 'Error al anexar');
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen || !childProduct) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
                <div className="flex items-center justify-between p-5 border-b border-sys-100">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 rounded-xl">
                            <Link size={18} className="text-indigo-600" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-sys-900">Anexar como variante</h2>
                            <p className="text-[10px] text-sys-400">Une este PLU a un producto padre compartiendo el mismo stock</p>
                        </div>
                    </div>
                    <button onClick={onClose} disabled={isSaving} className="p-2 hover:bg-sys-100 rounded-xl transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {/* Hijo (fijo) */}
                    <div>
                        <label className="text-[10px] font-bold text-sys-500 uppercase block mb-1.5">Producto a anexar</label>
                        <div className="flex items-center gap-3 bg-sys-50 border border-sys-200 rounded-xl px-4 py-3">
                            <Package size={16} className="text-sys-400 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-sys-800 truncate">{childProduct.name}</p>
                                <p className="text-[10px] text-sys-400 font-mono">PLU {childProduct.code} · ${parseFloat(childProduct.price).toLocaleString('es-AR')}</p>
                            </div>
                        </div>
                    </div>

                    {/* Flecha */}
                    <div className="flex justify-center">
                        <ArrowRight size={18} className="text-indigo-400" />
                    </div>

                    {/* Padre (búsqueda) */}
                    <div>
                        <label className="text-[10px] font-bold text-sys-500 uppercase block mb-1.5">Producto padre *</label>
                        {parentProduct ? (
                            <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
                                <Package size={16} className="text-indigo-500 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-indigo-800 truncate">{parentProduct.name}</p>
                                    <p className="text-[10px] text-indigo-400 font-mono">PLU {parentProduct.code} · ${parseFloat(parentProduct.price).toLocaleString('es-AR')}</p>
                                </div>
                                <button onClick={() => { setParentProduct(null); setLabel(''); }} className="text-sys-300 hover:text-red-500 transition-colors shrink-0">
                                    <X size={14} />
                                </button>
                            </div>
                        ) : (
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400 pointer-events-none" />
                                {isSearching && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-indigo-400" />}
                                <input
                                    type="text"
                                    placeholder="Buscar producto padre..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    autoFocus
                                    className="w-full border border-sys-200 rounded-xl py-2.5 pl-9 pr-9 text-sm font-medium outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                                />
                                {searchResults.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-sys-200 rounded-xl shadow-xl z-50 overflow-hidden max-h-44 overflow-y-auto">
                                        {searchResults.map(p => (
                                            <div key={p.id} onClick={() => { setParentProduct(p); setSearchQuery(''); setSearchResults([]); }}
                                                className="px-4 py-2.5 hover:bg-indigo-50 cursor-pointer flex items-center gap-2 border-b border-sys-100 last:border-0">
                                                <Package size={13} className="text-indigo-400 shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-bold text-sys-800 truncate">{p.name}</p>
                                                    <p className="text-[10px] text-sys-400 font-mono">PLU {p.code}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Label / Tipo */}
                    {parentProduct && (
                        <div>
                            <label className="text-[10px] font-bold text-sys-500 uppercase block mb-1.5">
                                Tipo / Variante *
                                <span className="ml-1 text-sys-400 font-normal normal-case">— aparece en la balanza como "{parentProduct.name} {label || '...'}"</span>
                            </label>
                            <input
                                type="text"
                                placeholder="ej: PIEZA / MAYOR / FETA"
                                value={label}
                                onChange={e => setLabel(e.target.value.toUpperCase())}
                                onKeyDown={e => e.key === 'Enter' && handleConfirm()}
                                className="w-full border border-sys-200 rounded-xl py-2.5 px-3 text-sm font-bold outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                            />
                        </div>
                    )}

                    {/* Preview */}
                    {parentProduct && label && (
                        <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 text-xs space-y-1">
                            <p className="font-bold text-indigo-700">Resultado:</p>
                            <p className="text-indigo-600">· PLU <span className="font-mono font-bold">{childProduct.code}</span> (${parseFloat(childProduct.price).toLocaleString('es-AR')}) → variante <strong>{label}</strong> de <strong>{parentProduct.name}</strong></p>
                            <p className="text-indigo-600">· Stock de "{childProduct.name}" se suma al de "{parentProduct.name}"</p>
                            <p className="text-indigo-600">· "{childProduct.name}" queda eliminado</p>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-sys-100 flex justify-end gap-2">
                    <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancelar</Button>
                    <Button onClick={handleConfirm} disabled={isSaving || !parentProduct || !label.trim()}
                        className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-500/20">
                        {isSaving ? <Loader2 size={16} className="animate-spin mr-2" /> : <Link size={16} className="mr-2" />}
                        Anexar
                    </Button>
                </div>
            </div>
        </div>
    );
}
