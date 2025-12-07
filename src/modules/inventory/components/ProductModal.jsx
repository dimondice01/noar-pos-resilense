// src/modules/inventory/components/ProductModal.jsx

import React, { useState, useEffect, useRef } from 'react';
import { X, Save, ScanLine, Scale, Package, DollarSign, Tag, Truck, AlertTriangle, Award, ChevronDown, Check } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { Switch } from '../../../core/ui/Switch';
import { cn } from '../../../core/utils/cn';
import { masterRepository } from '../repositories/masterRepository';
import { productRepository } from '../repositories/productRepository';

// ... (Los componentes PremiumSelect y PremiumInput se mantienen IGUAL, no cambian) ...

const PremiumSelect = ({ label, icon: Icon, value, onChange, options, placeholder = "Seleccionar..." }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find(opt => opt.name === value);

  return (
    <div className="group relative" ref={containerRef}>
      <label className="block text-[11px] font-bold text-sys-500 uppercase tracking-wider mb-1.5 ml-1 transition-colors group-focus-within:text-brand">
        {label}
      </label>
      
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full bg-sys-50 border border-sys-200 text-sys-900 rounded-xl py-3 pl-11 pr-10 text-sm font-medium outline-none cursor-pointer transition-all duration-200 flex items-center select-none",
          isOpen ? "bg-white border-brand ring-4 ring-brand/10 shadow-sm" : "hover:bg-sys-100"
        )}
      >
        {Icon && (
          <div className={cn("absolute left-3.5 transition-colors", isOpen ? "text-brand" : "text-sys-400")}>
            <Icon size={18} />
          </div>
        )}
        
        <span className={cn("truncate", !selectedOption && "text-sys-400")}>
          {selectedOption ? selectedOption.name : placeholder}
        </span>

        <div className="absolute right-3 text-sys-400">
          <ChevronDown size={16} className={cn("transition-transform duration-200", isOpen && "rotate-180 text-brand")} />
        </div>
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 w-full mt-2 bg-white rounded-xl shadow-xl border border-sys-100 overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100 origin-top">
          <div className="max-h-60 overflow-y-auto custom-scrollbar p-1">
            {options.length === 0 ? (
                <div className="px-4 py-3 text-xs text-sys-400 text-center italic">No hay opciones disponibles</div>
            ) : (
                options.map((opt) => (
                <div
                    key={opt.id}
                    onClick={() => { onChange(opt.name); setIsOpen(false); }}
                    className={cn(
                    "px-3 py-2.5 rounded-lg text-sm cursor-pointer transition-colors flex items-center justify-between",
                    value === opt.name 
                        ? "bg-brand-light/20 text-brand font-semibold" 
                        : "text-sys-700 hover:bg-sys-50"
                    )}
                >
                    <span>{opt.name}</span>
                    {value === opt.name && <Check size={14} className="text-brand" />}
                </div>
                ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const PremiumInput = ({ label, icon: Icon, rightIcon, className, ...props }) => (
    <div className="group">
      <label className="block text-[11px] font-bold text-sys-500 uppercase tracking-wider mb-1.5 ml-1 transition-colors group-focus-within:text-brand">
        {label}
      </label>
      <div className="relative transition-all duration-200">
        {Icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sys-400 group-focus-within:text-brand transition-colors pointer-events-none z-10">
            <Icon size={18} />
          </div>
        )}
        <input 
          className={cn(
            "w-full bg-sys-50 border border-sys-200 text-sys-900 rounded-xl py-3 text-sm font-medium outline-none transition-all duration-200 placeholder:text-sys-400",
            "focus:bg-white focus:border-brand focus:ring-4 focus:ring-brand/10 focus:shadow-sm",
            Icon ? "pl-11" : "pl-4", 
            rightIcon ? "pr-10" : "pr-4",
            className 
          )}
          {...props}
        />
        {rightIcon && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sys-400 pointer-events-none">
            {rightIcon}
          </div>
        )}
      </div>
    </div>
  );

export const ProductModal = ({ isOpen, onClose, productToEdit, onSave }) => {
  const [activeTab, setActiveTab] = useState('general'); 
  const [lists, setLists] = useState({ categories: [], brands: [], suppliers: [] });
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    code: '',
    category: '',
    brand: '',
    cost: '',
    markup: '30',
    price: '',
    stock: '',
    minStock: '5',
    supplier: '',
    isWeighable: false
  });

  // Cargar Listas
  useEffect(() => {
    if (isOpen) {
        const loadMasters = async () => {
            try {
                const [cats, brands, supps] = await Promise.all([
                    masterRepository.getAll('categories'),
                    masterRepository.getAll('brands'),
                    masterRepository.getAll('suppliers')
                ]);
                setLists({ categories: cats, brands: brands, suppliers: supps });
            } catch (error) {
                console.error("Error loading masters:", error);
            }
        };
        loadMasters();
    }
  }, [isOpen]);

  // Cargar Datos
  useEffect(() => {
    if (isOpen) {
      if (productToEdit) {
        let calculatedMarkup = productToEdit.markup;
        if (!calculatedMarkup && productToEdit.cost && productToEdit.price) {
           calculatedMarkup = ((productToEdit.price - productToEdit.cost) / productToEdit.cost * 100).toFixed(2);
        }
        setFormData({
            ...productToEdit,
            markup: calculatedMarkup || '0',
            brand: productToEdit.brand || '',
            category: productToEdit.category || '',
            supplier: productToEdit.supplier || '',
            minStock: productToEdit.minStock || '5'
        });
      } else {
        setFormData({ 
            name: '', code: '', category: '', brand: '',
            cost: '', markup: '30', price: '',
            stock: '', minStock: '5', supplier: '', isWeighable: false 
        });
      }
      setActiveTab('general');
      setIsSaving(false);
    }
  }, [isOpen, productToEdit]);

  // Cálculos
  const handlePriceCalculation = (field, value) => {
    let newData = { ...formData, [field]: value };
    const cost = parseFloat(field === 'cost' ? value : formData.cost) || 0;
    const markup = parseFloat(field === 'markup' ? value : formData.markup) || 0;
    const price = parseFloat(field === 'price' ? value : formData.price) || 0;

    if (field === 'cost' || field === 'markup') {
        if (cost > 0) {
            const newPrice = cost * (1 + markup / 100);
            newData.price = newPrice.toFixed(2);
        }
    } else if (field === 'price') {
        if (cost > 0 && price > 0) {
            const newMarkup = ((price - cost) / cost) * 100;
            newData.markup = newMarkup.toFixed(2);
        }
    }
    setFormData(newData);
  };

  // 🔥 VALIDACIÓN Y LIMPIEZA DE DATOS (FIX PARA ERROR DE CONSTRAINT)
  const handleSubmit = async (e) => { 
    e.preventDefault();
    
    if (!formData.name || !formData.price) return alert("Nombre y Precio son obligatorios");
    
    setIsSaving(true); 

    try {
        // 1. Limpieza de datos (SANITIZACIÓN)
        // Si el código está vacío, LO BORRAMOS del objeto para que la DB no lo indexe como duplicado
        const dataToSave = { ...formData };
        if (!dataToSave.code || dataToSave.code.trim() === '') {
            delete dataToSave.code; // 🔥 ESTA LÍNEA ES LA CLAVE DE TU ARREGLO
        }

        // 2. Validación de duplicados (Solo si hay código real)
        if (dataToSave.code) {
            const existing = await productRepository.findByCode(dataToSave.code);
            // Si existe otro producto con ese código
            if (existing && (!productToEdit || existing.id !== productToEdit.id)) {
                setIsSaving(false);
                return alert(`⛔ EL CÓDIGO YA EXISTE\n\nEl código "${dataToSave.code}" ya pertenece a: "${existing.name}".`);
            }
        }

        // 3. Guardar
        await onSave({
          ...dataToSave,
          price: parseFloat(dataToSave.price),
          cost: parseFloat(dataToSave.cost || 0),
          markup: parseFloat(dataToSave.markup || 0),
          stock: parseFloat(dataToSave.stock || 0),
          minStock: parseFloat(dataToSave.minStock || 0)
        });
        
        onClose();

    } catch (error) {
        console.error(error);
        alert("Error técnico al guardar: " + error.message);
    } finally {
        setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-sys-900/40 backdrop-blur-md p-4 animate-in fade-in zoom-in-95 duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-5 border-b border-sys-100 bg-white">
          <div>
             <h3 className="font-bold text-xl text-sys-900 tracking-tight">
               {productToEdit ? 'Editar Producto' : 'Nuevo Producto'}
             </h3>
             <p className="text-xs text-sys-500 font-medium">Gestión de inventario</p>
          </div>
          <button onClick={onClose} className="p-2 bg-sys-50 hover:bg-sys-100 rounded-full text-sys-500 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-4 pb-2 bg-white">
            <div className="flex p-1 bg-sys-100 rounded-xl">
                {['general', 'precios', 'avanzado'].map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                            "flex-1 py-2 text-xs font-bold rounded-lg transition-all duration-200 capitalize",
                            activeTab === tab 
                                ? "bg-white text-sys-900 shadow-sm" 
                                : "text-sys-500 hover:text-sys-700 hover:bg-sys-200/50"
                        )}
                    >
                        {tab === 'general' ? 'Datos Básicos' : tab === 'precios' ? 'Costos y Precios' : 'Avanzado'}
                    </button>
                ))}
            </div>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-white">
          
          {/* TAB 1: GENERAL */}
          {activeTab === 'general' && (
             <div className="space-y-6 animate-in slide-in-from-right-8 duration-300 fade-in">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    
                    <div className="col-span-2">
                        <PremiumInput 
                            label="Nombre del Producto"
                            autoFocus
                            placeholder="Ej: Coca Cola 2.25L Sabor Original"
                            value={formData.name}
                            onChange={e => setFormData({...formData, name: e.target.value})}
                        />
                    </div>
                    
                    <div>
                        <PremiumInput 
                            label="Código de Barras"
                            icon={ScanLine}
                            placeholder="Escanee o escriba..."
                            value={formData.code}
                            onChange={e => setFormData({...formData, code: e.target.value})}
                        />
                    </div>

                    <div>
                        <PremiumSelect 
                            label="Categoría"
                            icon={Tag}
                            options={lists.categories}
                            value={formData.category}
                            onChange={(val) => setFormData({...formData, category: val})}
                        />
                    </div>

                    <div>
                        <PremiumSelect 
                            label="Marca"
                            icon={Award}
                            options={lists.brands}
                            value={formData.brand}
                            onChange={(val) => setFormData({...formData, brand: val})}
                        />
                    </div>

                    {/* Switch Pesable */}
                    <div className="bg-sys-50 p-3 rounded-xl border border-sys-200 flex items-center justify-between h-[74px] mt-auto">
                        <div className="flex items-center gap-3 text-sys-700 pl-2">
                            <div className={cn("p-2 rounded-lg", formData.isWeighable ? "bg-orange-100 text-orange-600" : "bg-blue-100 text-blue-600")}>
                                {formData.isWeighable ? <Scale size={20}/> : <Package size={20}/>}
                            </div>
                            <div>
                                <p className="text-sm font-bold">{formData.isWeighable ? 'Producto Pesable' : 'Producto Unitario'}</p>
                                <p className="text-[10px] text-sys-500 font-medium">
                                    {formData.isWeighable ? 'Se vende por Kilogramos' : 'Se vende por Unidad (bulto)'}
                                </p>
                            </div>
                        </div>
                        <Switch checked={formData.isWeighable} onCheckedChange={(c) => setFormData({...formData, isWeighable: c})} />
                    </div>
                </div>
             </div>
          )}

          {/* TAB 2: PRECIOS */}
          {activeTab === 'precios' && (
             <div className="space-y-6 animate-in slide-in-from-right-8 duration-300 fade-in">
                <div className="bg-brand-light/30 p-4 rounded-xl border border-brand/20 flex gap-4 items-start">
                    <div className="p-2 bg-brand/10 text-brand rounded-lg shrink-0"><DollarSign size={20} /></div>
                    <div>
                        <h4 className="text-sm font-bold text-brand-hover">Calculadora de Rentabilidad</h4>
                        <p className="text-xs text-sys-600 mt-1 leading-relaxed">
                            Ingresa el <b>Costo</b> y el <b>Margen %</b>. El sistema sugiere el <b>Precio Final</b>.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-5 items-end">
                    <div className="col-span-1">
                        <PremiumInput 
                            label="Costo Unitario" type="number" step="0.01" placeholder="0.00"
                            value={formData.cost} onChange={e => handlePriceCalculation('cost', e.target.value)}
                            rightIcon={<span className="text-xs font-bold text-sys-400">$</span>}
                        />
                    </div>
                    <div className="col-span-1">
                        <PremiumInput 
                            label="Margen Ganancia" type="number" step="0.1" placeholder="30"
                            value={formData.markup} onChange={e => handlePriceCalculation('markup', e.target.value)}
                            rightIcon={<span className="text-xs font-bold text-sys-400">%</span>}
                        />
                    </div>
                    <div className="col-span-1">
                        <div className="group">
                            <label className="block text-[11px] font-bold text-brand uppercase tracking-wider mb-1.5 ml-1">Precio Venta</label>
                            <div className="relative">
                                <input 
                                    type="number" step="0.01"
                                    className="w-full bg-brand/5 border-2 border-brand/20 text-brand-hover rounded-xl py-3 pl-4 pr-10 text-lg font-bold outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all"
                                    value={formData.price} onChange={e => handlePriceCalculation('price', e.target.value)} placeholder="0.00"
                                />
                                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand font-bold">$</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-5 bg-sys-50 rounded-2xl border border-sys-200 flex justify-between items-center">
                    <span className="text-sm font-medium text-sys-500">Ganancia neta por unidad:</span>
                    <div className="text-right">
                        <span className="text-2xl font-black text-pos-success tracking-tight">
                            $ {((parseFloat(formData.price || 0) - parseFloat(formData.cost || 0))).toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                        </span>
                    </div>
                </div>
             </div>
          )}

          {/* TAB 3: AVANZADO */}
          {activeTab === 'avanzado' && (
             <div className="space-y-6 animate-in slide-in-from-right-8 duration-300 fade-in">
                <div className="grid grid-cols-2 gap-5">
                    <PremiumInput 
                        label="Stock Actual" type="number" icon={Package} placeholder="0"
                        value={formData.stock} onChange={e => setFormData({...formData, stock: e.target.value})}
                    />
                    <PremiumInput 
                        label="Stock Mínimo (Alerta)" type="number" icon={AlertTriangle} placeholder="5"
                        value={formData.minStock} onChange={e => setFormData({...formData, minStock: e.target.value})}
                        className="focus:border-orange-400 focus:ring-orange-400/10"
                    />
                    <div className="col-span-2 pt-2">
                        <PremiumSelect 
                            label="Proveedor Principal" icon={Truck} placeholder="Seleccionar Proveedor..."
                            options={lists.suppliers} value={formData.supplier}
                            onChange={(val) => setFormData({...formData, supplier: val})}
                        />
                    </div>
                </div>
             </div>
          )}

        </form>

        {/* Footer */}
        <div className="p-5 border-t border-sys-100 bg-sys-50/50 flex justify-end gap-3 backdrop-blur-sm">
            <Button variant="ghost" onClick={onClose} className="hover:bg-sys-200/50 text-sys-600" disabled={isSaving}>Cancelar</Button>
            <Button onClick={handleSubmit} className="px-8 shadow-xl shadow-brand/20 active:scale-95 transition-all" disabled={isSaving}>
                {isSaving ? <span className="animate-pulse">Guardando...</span> : <><Save size={18} className="mr-2" /> Guardar Producto</>}
            </Button>
        </div>

      </div>
    </div>
  );
};