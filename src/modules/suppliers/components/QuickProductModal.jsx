import React, { useState, useEffect } from 'react';
import { 
    X, Save, Loader2, Tag, Layers, 
    Barcode, DollarSign, Calculator, Plus, Package 
} from 'lucide-react';
import { masterRepository } from '../../inventory/repositories/masterRepository';
import { productRepository } from '../../inventory/repositories/productRepository';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import toast from 'react-hot-toast';

export const QuickProductModal = ({ isOpen, onClose, onProductCreated, initialBarcode = '' }) => {
    const [isLoading, setIsLoading] = useState(false);
    
    // Maestros en memoria
    const [categories, setCategories] = useState([]);
    const [brands, setBrands] = useState([]);

    // Estado del Formulario
    const [formData, setFormData] = useState({
        barcode: '',
        name: '',
        categoryId: '',
        brandId: '',
        cost: '',
        margin: '40', // Margen sugerido por defecto (Estrategia Comercial)
        price: '',
        taxRate: '21',
        isWeighable: false
    });

    // Cargar Maestros al abrir y setear código escaneado
    useEffect(() => {
        if (isOpen) {
            setFormData(prev => ({ 
                ...prev, 
                barcode: initialBarcode,
                name: '',
                cost: '',
                price: ''
            }));
            loadMasters();
        }
    }, [isOpen, initialBarcode]);

    const loadMasters = async () => {
        try {
            const [cats, brs] = await Promise.all([
                masterRepository.getAll('categories'),
                masterRepository.getAll('brands')
            ]);
            setCategories(cats);
            setBrands(brs);
        } catch (e) {
            console.error("Error cargando maestros:", e);
        }
    };

    // =================================================================
    // 🧮 CALCULADORA DE PRECIOS NEXUS (Bidireccional)
    // =================================================================
    const handlePriceCalc = (field, value) => {
        let newData = { ...formData, [field]: value };
        
        const cost = parseFloat(newData.cost) || 0;
        const margin = parseFloat(newData.margin) || 0;
        const price = parseFloat(newData.price) || 0;

        // Caso A: Usuario cambia Costo o Margen -> Calculamos Precio
        if (field === 'cost' || field === 'margin') {
            if (cost > 0) {
                // Precio = Costo * (1 + Margen%)
                const rawPrice = cost * (1 + margin / 100);
                // Redondeo inteligente a 10 (Regla de negocio Nexus)
                newData.price = (Math.ceil(rawPrice / 10) * 10).toFixed(2);
            }
        } 
        // Caso B: Usuario cambia Precio Final -> Recalculamos Margen real
        else if (field === 'price') {
            if (cost > 0 && price > 0) {
                // Margen = ((Precio / Costo) - 1) * 100
                newData.margin = (((price / cost) - 1) * 100).toFixed(1);
            }
        }
        
        setFormData(newData);
    };

    // =================================================================
    // ⚡ CREACIÓN RÁPIDA DE MAESTROS
    // =================================================================
    const handleQuickCreate = async (type) => {
        const label = type === 'categories' ? 'Categoría' : 'Marca';
        const name = prompt(`Nombre de la nueva ${label}:`);
        
        if (!name) return;

        try {
            // Guardamos en el repositorio maestro (Esto ya maneja Sync Cloud)
            const newItem = await masterRepository.save(type, { name });
            toast.success(`${label} creada`);
            
            // Recargamos listas
            await loadMasters();
            
            // Auto-seleccionar lo recién creado
            setFormData(prev => ({
                ...prev,
                [type === 'categories' ? 'categoryId' : 'brandId']: newItem.id
            }));
        } catch (e) {
            toast.error("Error creando maestro");
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // Validaciones
        if (!formData.name) return toast.error("El nombre es obligatorio");
        if (!formData.cost) return toast.error("El costo es obligatorio");
        if (!formData.price) return toast.error("El precio de venta es obligatorio");

        setIsLoading(true);
        try {
            // 1. Resolver Nombres de Categoría/Marca (Denormalización para velocidad)
            const selectedCat = categories.find(c => c.id === formData.categoryId);
            const selectedBrand = brands.find(b => b.id === formData.brandId);

            // 2. Construir Objeto Maestro
            const newProduct = {
                // Soporte Multi-Barcode: Iniciamos el array con el código actual
                barcode: formData.barcode ? [formData.barcode] : [], 
                code: formData.barcode, 
                
                name: formData.name.toUpperCase(),
                category: selectedCat?.name || 'GENERAL',
                brand: selectedBrand?.name || 'GENERICO',
                
                // Datos Financieros Globales
                cost: parseFloat(formData.cost),
                price: parseFloat(formData.price),
                taxRate: parseFloat(formData.taxRate),
                
                isWeighable: formData.isWeighable
            };

            // 3. Guardar (Nexus Core se encarga de IndexDB + Firestore)
            const savedProduct = await productRepository.save(newProduct);
            
            // 4. Callback al Padre (PurchasePage) para agregarlo a la factura
            onProductCreated(savedProduct);
            onClose();
            toast.success("Producto creado correctamente");

        } catch (error) {
            console.error(error);
            toast.error("Error al guardar producto");
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] border border-sys-200">
                
                {/* Header */}
                <div className="px-8 py-5 border-b border-sys-200 flex justify-between items-center bg-sys-50/50">
                    <div>
                        <h2 className="text-xl font-black text-sys-900 flex items-center gap-2">
                            <Package className="text-brand" strokeWidth={2.5} /> 
                            Alta Rápida de Producto
                        </h2>
                        <p className="text-xs text-sys-500 font-medium mt-0.5">
                            Se agregará al Catálogo Maestro y a la Factura actual.
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full transition-colors text-sys-400">
                        <X size={24} />
                    </button>
                </div>

                {/* Formulario */}
                <form onSubmit={handleSubmit} className="p-8 overflow-y-auto space-y-6">
                    
                    {/* Fila 1: Identificación */}
                    <div className="grid grid-cols-12 gap-4">
                        <div className="col-span-4">
                            <label className="text-[10px] font-bold uppercase text-sys-500 mb-1 block">Código Barras</label>
                            <div className="relative group">
                                <Barcode className="absolute left-3 top-2.5 text-sys-400 group-focus-within:text-brand transition-colors" size={18}/>
                                <input 
                                    type="text" 
                                    className="w-full pl-10 pr-3 py-2.5 border border-sys-200 rounded-xl font-mono font-bold text-sys-800 bg-sys-50 focus:bg-white outline-none focus:border-brand transition-all"
                                    value={formData.barcode}
                                    onChange={e => setFormData({...formData, barcode: e.target.value})}
                                    placeholder="Escanear..."
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div className="col-span-8">
                            <label className="text-[10px] font-bold uppercase text-sys-500 mb-1 block">Nombre Producto <span className="text-red-500">*</span></label>
                            <input 
                                type="text" 
                                className="w-full px-4 py-2.5 border border-sys-200 rounded-xl font-bold text-sys-900 focus:border-brand outline-none uppercase placeholder:normal-case placeholder:font-normal"
                                value={formData.name}
                                onChange={e => setFormData({...formData, name: e.target.value.toUpperCase()})}
                                placeholder="Ej: Galletitas Oreo 117g"
                            />
                        </div>
                    </div>

                    {/* Fila 2: Clasificación (Con Quick Create) */}
                    <div className="grid grid-cols-2 gap-6">
                        {/* Categoría */}
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="text-[10px] font-bold uppercase text-sys-500">Categoría</label>
                                <button type="button" onClick={() => handleQuickCreate('categories')} className="text-[10px] font-bold text-brand hover:underline flex items-center gap-1">
                                    <Plus size={10} strokeWidth={3}/> CREAR NUEVA
                                </button>
                            </div>
                            <div className="relative">
                                <select 
                                    className="w-full px-3 py-2.5 border border-sys-200 rounded-xl text-sm bg-white font-medium text-sys-700 outline-none focus:border-brand appearance-none"
                                    value={formData.categoryId}
                                    onChange={e => setFormData({...formData, categoryId: e.target.value})}
                                >
                                    <option value="">Seleccionar Categoría...</option>
                                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                                <Layers size={16} className="absolute right-3 top-3 text-sys-400 pointer-events-none"/>
                            </div>
                        </div>

                        {/* Marca */}
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="text-[10px] font-bold uppercase text-sys-500">Marca</label>
                                <button type="button" onClick={() => handleQuickCreate('brands')} className="text-[10px] font-bold text-brand hover:underline flex items-center gap-1">
                                    <Plus size={10} strokeWidth={3}/> CREAR NUEVA
                                </button>
                            </div>
                            <div className="relative">
                                <select 
                                    className="w-full px-3 py-2.5 border border-sys-200 rounded-xl text-sm bg-white font-medium text-sys-700 outline-none focus:border-brand appearance-none"
                                    value={formData.brandId}
                                    onChange={e => setFormData({...formData, brandId: e.target.value})}
                                >
                                    <option value="">Seleccionar Marca...</option>
                                    {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                </select>
                                <Tag size={16} className="absolute right-3 top-3 text-sys-400 pointer-events-none"/>
                            </div>
                        </div>
                    </div>

                    <div className="h-px bg-sys-100 w-full"></div>

                    {/* Fila 3: Economía Inteligente */}
                    <div className="bg-sys-50 p-5 rounded-2xl border border-sys-200 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-2 opacity-10 pointer-events-none">
                            <Calculator size={100} className="text-sys-900"/>
                        </div>

                        <div className="grid grid-cols-12 gap-4 relative z-10">
                            {/* Costo */}
                            <div className="col-span-4">
                                <label className="text-[10px] font-bold uppercase text-sys-500 mb-1 block">Costo Neto</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-sys-400 font-bold">$</span>
                                    <input 
                                        type="number" 
                                        className="w-full pl-7 pr-3 py-2.5 bg-white border border-sys-200 rounded-xl font-bold text-sys-800 outline-none focus:border-brand transition-all"
                                        value={formData.cost}
                                        onChange={e => handlePriceCalc('cost', e.target.value)}
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                            
                            {/* Margen */}
                            <div className="col-span-3 flex flex-col justify-end">
                                <label className="text-[10px] font-bold uppercase text-sys-500 mb-1 block text-center">Margen %</label>
                                <div className="relative">
                                    <input 
                                        type="number" 
                                        className="w-full px-2 py-2.5 border border-brand/30 bg-brand/5 rounded-xl font-black text-brand text-center outline-none focus:border-brand focus:bg-white transition-all"
                                        value={formData.margin}
                                        onChange={e => handlePriceCalc('margin', e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Precio Final */}
                            <div className="col-span-5">
                                <label className="text-[10px] font-bold uppercase text-emerald-600 mb-1 block">Precio Venta (Sugerido)</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-emerald-600 font-bold">$</span>
                                    <input 
                                        type="number" 
                                        className="w-full pl-7 pr-3 py-2.5 border-2 border-emerald-100 bg-white rounded-xl font-black text-xl text-emerald-600 outline-none focus:border-emerald-500 shadow-sm transition-all"
                                        value={formData.price}
                                        onChange={e => handlePriceCalc('price', e.target.value)}
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 px-1">
                        <label className="flex items-center gap-3 cursor-pointer select-none group">
                            <div className="relative flex items-center">
                                <input 
                                    type="checkbox" 
                                    className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-sys-300 transition-all checked:border-brand checked:bg-brand"
                                    checked={formData.isWeighable}
                                    onChange={e => setFormData({...formData, isWeighable: e.target.checked})}
                                />
                                <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 transition-opacity peer-checked:opacity-100">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                </div>
                            </div>
                            <span className="text-sm font-bold text-sys-600 group-hover:text-sys-900 transition-colors">Es Producto Pesable (Balanza)</span>
                        </label>
                    </div>

                </form>

                {/* Footer Actions */}
                <div className="p-6 border-t border-sys-200 bg-sys-50 flex justify-end gap-3">
                    <Button variant="ghost" onClick={onClose} disabled={isLoading} className="text-sys-500 hover:text-sys-800">
                        Cancelar
                    </Button>
                    <Button onClick={handleSubmit} disabled={isLoading} className="px-8 h-12 text-lg shadow-xl shadow-brand/20">
                        {isLoading ? <Loader2 className="animate-spin mr-2"/> : <Save className="mr-2"/>}
                        Crear Producto
                    </Button>
                </div>
            </div>
        </div>
    );
};