import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Package, Search, Trash2, Loader2, ShoppingBag } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { productRepository } from '../repositories/productRepository';
import toast from 'react-hot-toast';

export function ComboModal({ isOpen, onClose, comboToEdit, onSave }) {
    const [isSaving, setIsSaving] = useState(false);
    const [formData, setFormData] = useState({ name: '', price: '', code: '' });
    const [components, setComponents] = useState([]);

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [tempQty, setTempQty] = useState('1');
    const searchTimeoutRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return;
        if (comboToEdit) {
            setFormData({
                name: comboToEdit.name || '',
                price: String(comboToEdit.price || ''),
                code: comboToEdit.code || ''
            });
            setComponents(Array.isArray(comboToEdit.components) ? comboToEdit.components : []);
        } else {
            setFormData({ name: '', price: '', code: '' });
            setComponents([]);
        }
        setSearchQuery('');
        setSearchResults([]);
        setSelectedProduct(null);
        setTempQty('1');
    }, [isOpen, comboToEdit]);

    useEffect(() => {
        if (!searchQuery.trim() || searchQuery.length < 2) {
            setSearchResults([]);
            return;
        }
        clearTimeout(searchTimeoutRef.current);
        setIsSearching(true);
        searchTimeoutRef.current = setTimeout(async () => {
            try {
                const results = await productRepository.search(searchQuery);
                setSearchResults(results.filter(p => !p.isCombo && !p.deleted).slice(0, 6));
            } catch (e) { }
            setIsSearching(false);
        }, 300);
    }, [searchQuery]);

    const addComponent = () => {
        if (!selectedProduct) return;
        const qty = parseFloat(String(tempQty).replace(',', '.'));
        if (!qty || qty <= 0) return toast.error('Ingresá una cantidad válida');
        if (components.some(c => c.productId === selectedProduct.id)) return toast.error('Ese producto ya está en el combo');
        setComponents(prev => [...prev, {
            productId: selectedProduct.id,
            name: selectedProduct.name,
            qty,
            isWeighable: selectedProduct.isWeighable || false
        }]);
        setSelectedProduct(null);
        setSearchQuery('');
        setSearchResults([]);
        setTempQty('1');
    };

    const removeComponent = (productId) => {
        setComponents(prev => prev.filter(c => c.productId !== productId));
    };

    const handleSubmit = async () => {
        if (!formData.name.trim()) return toast.error('El nombre del combo es obligatorio');
        const price = parseFloat(String(formData.price).replace(',', '.'));
        if (!price || price <= 0) return toast.error('El precio del combo es obligatorio');
        if (components.length === 0) return toast.error('Agregá al menos un producto al combo');

        setIsSaving(true);
        try {
            await onSave({
                id: comboToEdit?.id,
                name: formData.name.trim().toUpperCase(),
                price,
                cost: 0,
                code: formData.code.trim() || `COMBO-${Date.now().toString().slice(-6)}`,
                barcode: [],
                isCombo: true,
                components,
                isWeighable: false,
                taxRate: 21,
                category: 'COMBOS',
                priceTiers: [],
            });
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-5 border-b border-sys-100">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-100 rounded-xl">
                            <ShoppingBag size={20} className="text-purple-600" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-sys-900">
                                {comboToEdit ? 'Editar Combo' : 'Nuevo Combo'}
                            </h2>
                            <p className="text-[10px] text-sys-400">Precio fijo · Descuenta stock de cada componente</p>
                        </div>
                    </div>
                    <button onClick={onClose} disabled={isSaving} className="p-2 hover:bg-sys-100 rounded-xl transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                            <label className="text-[10px] font-bold text-sys-500 uppercase block mb-1.5">Nombre del Combo *</label>
                            <input
                                type="text"
                                placeholder="Ej: MERIENDA COMPLETA"
                                value={formData.name}
                                onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                                disabled={isSaving}
                                className="w-full border border-sys-200 rounded-xl py-2.5 px-3 text-sm font-medium outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-sys-500 uppercase block mb-1.5">Precio *</label>
                            <input
                                type="number"
                                placeholder="500"
                                value={formData.price}
                                onChange={e => setFormData(p => ({ ...p, price: e.target.value }))}
                                disabled={isSaving}
                                className="w-full border border-sys-200 rounded-xl py-2.5 px-3 text-sm font-medium outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-sys-500 uppercase block mb-1.5">Código / PLU <span className="text-sys-400 font-normal normal-case">(opcional)</span></label>
                            <input
                                type="text"
                                placeholder="COMBO-001"
                                value={formData.code}
                                onChange={e => setFormData(p => ({ ...p, code: e.target.value }))}
                                disabled={isSaving}
                                className="w-full border border-sys-200 rounded-xl py-2.5 px-3 text-sm font-mono outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                            />
                        </div>
                    </div>

                    <div className="border border-purple-100 bg-purple-50 rounded-xl p-4 space-y-3">
                        <p className="text-[10px] font-bold text-purple-700 uppercase tracking-wider">Productos incluidos en el combo</p>

                        {components.length === 0 && (
                            <p className="text-xs text-sys-400 text-center py-2">Buscá productos abajo para agregar</p>
                        )}

                        {components.map(c => (
                            <div key={c.productId} className="flex items-center gap-2 bg-white border border-purple-100 rounded-lg px-3 py-2">
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-sys-800 truncate">{c.name}</p>
                                    <p className="text-[10px] text-sys-400">
                                        {c.isWeighable ? `${c.qty} kg` : `${c.qty} ${c.qty === 1 ? 'unidad' : 'unidades'}`}
                                    </p>
                                </div>
                                <button type="button" onClick={() => removeComponent(c.productId)} disabled={isSaving}
                                    className="text-sys-300 hover:text-red-500 shrink-0 transition-colors">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}

                        <div className="space-y-2 pt-1">
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400 pointer-events-none" />
                                {isSearching && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-purple-400" />}
                                <input
                                    type="text"
                                    placeholder="Buscar producto para agregar..."
                                    value={selectedProduct ? selectedProduct.name : searchQuery}
                                    onChange={e => { setSelectedProduct(null); setSearchQuery(e.target.value); }}
                                    disabled={isSaving}
                                    className="w-full bg-white border border-sys-200 rounded-lg py-2 pl-8 pr-8 text-xs font-medium outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                                />
                            </div>

                            {searchResults.length > 0 && !selectedProduct && (
                                <div className="bg-white border border-sys-200 rounded-xl shadow-lg overflow-hidden max-h-36 overflow-y-auto">
                                    {searchResults.map(p => (
                                        <div
                                            key={p.id}
                                            onClick={() => { setSelectedProduct(p); setSearchQuery(''); setSearchResults([]); }}
                                            className="px-3 py-2 hover:bg-purple-50 cursor-pointer flex items-center gap-2 border-b border-sys-100 last:border-0"
                                        >
                                            <Package size={13} className="text-purple-400 shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-bold text-sys-800 truncate">{p.name}</p>
                                                <p className="text-[10px] text-sys-400">
                                                    {p.isWeighable ? 'Pesable (kg)' : `Stock: ${p.stock ?? 0}`}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {selectedProduct && (
                                <div className="flex gap-2">
                                    <div className="flex-1 bg-purple-100 rounded-lg px-3 py-2 text-xs font-bold text-purple-700 truncate">
                                        {selectedProduct.name} {selectedProduct.isWeighable ? '(kg)' : '(un.)'}
                                    </div>
                                    <input
                                        type="number"
                                        step={selectedProduct.isWeighable ? '0.01' : '1'}
                                        min="0.001"
                                        placeholder="Cant."
                                        value={tempQty}
                                        onChange={e => setTempQty(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && addComponent()}
                                        className="w-20 border border-sys-200 rounded-lg py-2 px-2 text-xs text-center outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                                    />
                                    <button type="button" onClick={addComponent}
                                        className="bg-purple-500 hover:bg-purple-600 text-white rounded-lg px-3 text-xs font-bold transition-colors shrink-0">
                                        +
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-sys-100 flex justify-end gap-2">
                    <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancelar</Button>
                    <Button onClick={handleSubmit} disabled={isSaving}
                        className="bg-purple-600 hover:bg-purple-700 shadow-lg shadow-purple-500/20">
                        {isSaving
                            ? <Loader2 size={16} className="animate-spin mr-2" />
                            : <Save size={16} className="mr-2" />
                        }
                        {comboToEdit ? 'Guardar Cambios' : 'Crear Combo'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
