import React, { useState, useEffect, useRef } from 'react';
import { 
    X, Save, ScanLine, Scale, Package, DollarSign, Tag, Truck, 
    AlertTriangle, Award, ChevronDown, Check, Calendar, Plus, 
    Trash2, Megaphone, Clock, Barcode, Edit2, Percent, Layers, ShoppingBag, MapPin, Loader2, Info, Banknote, CreditCard, QrCode
} from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { Switch } from '../../../core/ui/Switch';
import { cn } from '../../../core/utils/cn';
import { masterRepository } from '../repositories/masterRepository';
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import toast from 'react-hot-toast';

// ==========================================
// 🎨 UI COMPONENTS (Internal Helpers)
// ==========================================

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

  const selectedOption = options.find(opt => opt.value === value || opt.name === value);

  return (
    <div className="group relative" ref={containerRef}>
      <label className="block text-[10px] font-bold text-sys-500 uppercase tracking-wider mb-1.5 ml-1 transition-colors group-focus-within:text-brand">
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
          {selectedOption ? (selectedOption.label || selectedOption.name) : placeholder}
        </span>

        <div className="absolute right-3 text-sys-400">
          <ChevronDown size={16} className={cn("transition-transform duration-200", isOpen && "rotate-180 text-brand")} />
        </div>
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 w-full mt-2 bg-white rounded-xl shadow-xl border border-sys-100 overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100 origin-top max-h-60 overflow-y-auto custom-scrollbar p-1">
            {options.length === 0 ? (
              <div className="px-4 py-3 text-xs text-sys-400 text-center italic">No hay opciones</div>
            ) : (
              options.map((opt, idx) => (
                <div
                  key={opt.id || idx}
                  onClick={() => { onChange(opt.value || opt.name); setIsOpen(false); }}
                  className={cn(
                    "px-3 py-2.5 rounded-lg text-sm cursor-pointer transition-colors flex items-center justify-between",
                    (value === opt.value || value === opt.name) ? "bg-brand-light/20 text-brand font-semibold" : "text-sys-700 hover:bg-sys-50"
                  )}
                >
                  <span>{opt.label || opt.name}</span>
                  {(value === opt.value || value === opt.name) && <Check size={14} className="text-brand" />}
                </div>
              ))
            )}
        </div>
      )}
    </div>
  );
};

const PremiumInput = ({ label, icon: Icon, rightIcon, className, readOnly, ...props }) => (
    <div className={cn("group", readOnly && "opacity-60")}>
      <label className="block text-[10px] font-bold text-sys-500 uppercase tracking-wider mb-1.5 ml-1 transition-colors group-focus-within:text-brand flex justify-between items-center">
        <span>{label}</span>
      </label>
      <div className="relative transition-all duration-200">
        {Icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sys-400 group-focus-within:text-brand transition-colors pointer-events-none z-10">
            <Icon size={18} />
          </div>
        )}
        <input 
          readOnly={readOnly}
          className={cn(
            "w-full bg-sys-50 border border-sys-200 text-sys-900 rounded-xl py-3 text-sm font-medium outline-none transition-all duration-200 placeholder:text-sys-400",
            !readOnly && "focus:bg-white focus:border-brand focus:ring-4 focus:ring-brand/10 focus:shadow-sm",
            readOnly && "bg-sys-100 text-sys-500 cursor-not-allowed",
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

// ==========================================
// 🏭 PRODUCT MODAL (NEXUS CORE PRO MAX)
// ==========================================

export const ProductModal = ({ isOpen, onClose, productToEdit, onSave }) => {
  const { user, activeBranchName } = useAuthStore();
  const [activeTab, setActiveTab] = useState('general'); 
  const [lists, setLists] = useState({ categories: [], brands: [], suppliers: [] });
  const [isSaving, setIsSaving] = useState(false);
  const [tempBarcode, setTempBarcode] = useState('');

  // 1. ESTADO DEL FORMULARIO
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    barcodes: [],
    category: '',
    brand: '',
    supplier: '',
    
    costNeto: '', 
    cost: '',     
    markup: '40', 
    price: '',    
    taxRate: '21',
    
    stock: '', 
    minStock: '5',
    isWeighable: false,
    
    // PROMO ENGINE
    promoActive: false,
    promoType: 'PERCENTAGE', 
    promoValue: '',          
    promoDiscount: '',       
    promoPayValue: '',       
    promoStartDate: '',
    promoEndDate: '',
    // 🔥 SPRINT 1: Control de Medios de Pago Permitidos (Si está vacío, aplica a todos)
    promoAllowedMethods: [] 
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
            } catch (error) { console.error("Error loading masters:", error); }
        };
        loadMasters();
    }
  }, [isOpen]);

  // Cargar Datos
  useEffect(() => {
    if (isOpen) {
      if (productToEdit) {
        let calculatedMarkup = productToEdit.markup;
        let cNeto = '';
        let cFinal = productToEdit.cost || '';
        let tax = productToEdit.taxRate || '21';
        
        if (cFinal) {
            const taxMult = 1 + (parseFloat(tax) / 100);
            cNeto = (parseFloat(cFinal) / taxMult).toFixed(2);
        }

        if (!calculatedMarkup && cFinal && productToEdit.price) {
           const c = parseFloat(cFinal);
           const p = parseFloat(productToEdit.price);
           if (c > 0) calculatedMarkup = ((p - c) / c * 100).toFixed(2);
        }

        const loadedBarcodes = Array.isArray(productToEdit.barcode) 
          ? productToEdit.barcode 
          : (productToEdit.barcode ? [productToEdit.barcode] : []);

        const promo = productToEdit.promo || {};
        const hasPromo = !!productToEdit.promo;

        setFormData({
            ...productToEdit,
            name: productToEdit.name || '', 
            code: productToEdit.code || '',
            barcodes: loadedBarcodes,
            category: productToEdit.category || '',
            brand: productToEdit.brand || '',
            supplier: productToEdit.supplier || '',
            minStock: productToEdit.minStock || '5',
            stock: productToEdit.stock || '', 
            isWeighable: productToEdit.isWeighable === true,
            
            taxRate: String(tax),
            costNeto: cNeto,
            cost: String(cFinal),
            markup: String(calculatedMarkup || '40'),
            price: String(productToEdit.price || ''),
            
            promoActive: hasPromo,
            promoType: hasPromo ? (promo.type || 'PERCENTAGE') : 'PERCENTAGE',
            promoValue: hasPromo ? String(promo.value || '') : '', 
            promoDiscount: hasPromo ? String(promo.discountValue || '') : '',
            promoPayValue: hasPromo ? String(promo.payValue || '') : '',
            promoStartDate: hasPromo ? (promo.startDate || '') : new Date().toISOString().split('T')[0],
            promoEndDate: hasPromo ? (promo.endDate || '') : '',
            promoAllowedMethods: hasPromo ? (promo.allowedMethods || []) : [] // Array de strings ['cash', 'card']
        });
      } else {
        setFormData({ 
            name: '', code: '', barcodes: [], category: '', brand: '',
            costNeto: '', cost: '', markup: '40', price: '', taxRate: '21',
            stock: '', minStock: '5', supplier: '', 
            isWeighable: false,
            promoActive: false, promoType: 'PERCENTAGE', promoValue: '', promoDiscount: '', promoPayValue: '', 
            promoStartDate: new Date().toISOString().split('T')[0], 
            promoEndDate: '',
            promoAllowedMethods: []
        });
      }
      setActiveTab('general');
      setTempBarcode('');
      setIsSaving(false);
    }
  }, [isOpen, productToEdit]);

  // CALCULADORA DE PRECIOS BIDIRECCIONAL
  const handlePriceCalculation = (field, value) => {
    let newData = { ...formData, [field]: value };
    
    const taxMult = 1 + (parseFloat(newData.taxRate) / 100);
    
    if (field === 'taxRate') {
        if (newData.costNeto) {
            const newCost = parseFloat(newData.costNeto) * taxMult;
            newData.cost = newCost.toFixed(2);
            if (newData.markup) {
                const newPrice = newCost * (1 + parseFloat(newData.markup) / 100);
                newData.price = (Math.ceil(newPrice / 10) * 10).toFixed(2);
            }
        }
    }

    if (field === 'costNeto') {
        const cNeto = parseFloat(value) || 0;
        if (cNeto > 0) {
            const cFinal = cNeto * taxMult;
            newData.cost = cFinal.toFixed(2);
            
            const markup = parseFloat(newData.markup) || 0;
            const newPrice = cFinal * (1 + markup / 100);
            newData.price = (Math.ceil(newPrice / 10) * 10).toFixed(2);
        } else {
            newData.cost = '';
            newData.price = '';
        }
    }
    
    else if (field === 'cost') {
        const cFinal = parseFloat(value) || 0;
        if (cFinal > 0) {
            const cNeto = cFinal / taxMult;
            newData.costNeto = cNeto.toFixed(2);
            
            const markup = parseFloat(newData.markup) || 0;
            const newPrice = cFinal * (1 + markup / 100);
            newData.price = (Math.ceil(newPrice / 10) * 10).toFixed(2);
        } else {
            newData.costNeto = '';
            newData.price = '';
        }
    }
    
    else if (field === 'markup') {
        const cFinal = parseFloat(newData.cost) || 0;
        const markup = parseFloat(value) || 0;
        if (cFinal > 0) {
            const newPrice = cFinal * (1 + markup / 100);
            newData.price = (Math.ceil(newPrice / 10) * 10).toFixed(2);
        }
    }
    
    else if (field === 'price') {
        const cFinal = parseFloat(newData.cost) || 0;
        const price = parseFloat(value) || 0;
        if (cFinal > 0 && price > 0) {
            const newMarkup = ((price - cFinal) / cFinal) * 100;
            newData.markup = newMarkup.toFixed(2);
        }
    }

    setFormData(newData);
  };

  const addBarcode = () => {
      if (tempBarcode.trim().length > 2 && !formData.barcodes.includes(tempBarcode)) {
          setFormData(prev => ({ ...prev, barcodes: [...prev.barcodes, tempBarcode] }));
          setTempBarcode('');
      }
  };

  const removeBarcode = (code) => {
      setFormData(prev => ({ ...prev, barcodes: prev.barcodes.filter(b => b !== code) }));
  };

  // 🔥 SPRINT 1: Función para alternar métodos de pago permitidos en la oferta
  const togglePromoMethod = (methodId) => {
      setFormData(prev => {
          let currentMethods = [...prev.promoAllowedMethods];
          if (currentMethods.includes(methodId)) {
              currentMethods = currentMethods.filter(m => m !== methodId);
          } else {
              currentMethods.push(methodId);
          }
          return { ...prev, promoAllowedMethods: currentMethods };
      });
  };

  // 💾 GUARDADO MAESTRO CON FEEDBACK INSTANTÁNEO
  const handleSubmit = async (e) => { 
    if (e) e.preventDefault(); 
    
    if (!formData.name.trim()) {
        setActiveTab('general');
        return toast.error("⚠️ El nombre del producto es obligatorio");
    }

    if (!formData.isWeighable && (!formData.code.trim() && formData.barcodes.length === 0)) {
        setActiveTab('general');
        return toast.error("⚠️ CRÍTICO: Debe asignar al menos un Código o escanear un Código de Barras para vender este producto.");
    }

    if (!formData.price || parseFloat(String(formData.price).replace(',', '.')) <= 0) {
        setActiveTab('precios');
        return toast.error("⚠️ Debes ingresar un precio final válido");
    }
    
    if (formData.promoActive) {
        if (!formData.promoValue) {
            setActiveTab('promociones');
            return toast.error("⚠️ Falta el valor de la promoción");
        }
        if (!formData.promoEndDate) {
            setActiveTab('promociones');
            return toast.error("⚠️ Falta la fecha de fin de la promoción");
        }
    }

    setIsSaving(true); 
    const loadingToastId = toast.loading('Guardando producto...');

    try {
        const masterPayload = {
            ...formData, 
            name: formData.name.trim(),
            code: formData.code.trim() || formData.barcodes[0] || `SKU-${Date.now().toString().slice(-6)}`, 
            barcode: formData.barcodes, 
            category: formData.category,
            brand: formData.brand,
            supplier: formData.supplier,
            price: parseFloat(String(formData.price).replace(',', '.')) || 0,
            cost: parseFloat(String(formData.cost).replace(',', '.')) || 0,
            markup: parseFloat(String(formData.markup).replace(',', '.')) || 0,
            minStock: parseFloat(String(formData.minStock).replace(',', '.')) || 0,
            taxRate: parseFloat(String(formData.taxRate).replace(',', '.')) || 21,
            isWeighable: Boolean(formData.isWeighable),
            user: user?.name || 'Sistema'
        };

        masterPayload.stock = parseFloat(String(formData.stock).replace(',', '.')) || 0;

        if (productToEdit && productToEdit.id) {
            delete masterPayload.stock; 
        }

        delete masterPayload.promoActive;
        delete masterPayload.promoType;
        delete masterPayload.promoValue;
        delete masterPayload.promoDiscount;
        delete masterPayload.promoPayValue;
        delete masterPayload.promoStartDate;
        delete masterPayload.promoEndDate;
        delete masterPayload.promoAllowedMethods;
        delete masterPayload.promo; 
        delete masterPayload.costNeto; 

        let promoPayload = null;
        if (formData.promoActive) {
            promoPayload = {
                type: formData.promoType,
                value: parseFloat(String(formData.promoValue).replace(',', '.')) || 0,
                discountValue: parseFloat(String(formData.promoDiscount).replace(',', '.')) || 0,
                payValue: parseFloat(String(formData.promoPayValue).replace(',', '.')) || 0,
                startDate: formData.promoStartDate,
                endDate: formData.promoEndDate,
                allowedMethods: formData.promoAllowedMethods || [], // 🔥 Guardamos los métodos permitidos
                name: 
                    formData.promoType === 'PERCENTAGE' ? `${formData.promoValue}% OFF` :
                    formData.promoType === 'BULK_THRESHOLD' ? `Llevando ${formData.promoValue}+: ${formData.promoDiscount}% OFF` :
                    formData.promoType === 'QUANTITY_LIMIT' ? `Primeras ${formData.promoValue} un. al ${formData.promoDiscount}%` :
                    formData.promoType === 'BUNDLE_DEAL' ? `${formData.promoValue}x${formData.promoPayValue}` : 'Oferta'
            };
        }

        await onSave(masterPayload, promoPayload);
        
        toast.success('¡Producto guardado!', { id: loadingToastId });
        onClose();

    } catch (error) {
        console.error("Error guardando producto:", error);
        toast.error("Error al guardar: " + (error.message || "Intente nuevamente"), { id: loadingToastId });
    } finally {
        setIsSaving(false);
    }
  };

  const promoOptions = [
      { value: 'PERCENTAGE', label: 'Descuento Directo (%)', icon: Percent },
      { value: 'BULK_THRESHOLD', label: 'Descuento por Volumen', icon: Layers },
      { value: 'QUANTITY_LIMIT', label: 'Limite de Cantidad', icon: AlertTriangle },
      { value: 'BUNDLE_DEAL', label: 'Combo (Ej: 3x2)', icon: ShoppingBag }
  ];

  // 🔥 Opciones de métodos de pago para filtrar la oferta
  const paymentMethodOptions = [
      { id: 'cash', label: 'Efectivo', icon: Banknote, color: 'emerald' },
      { id: 'transfer', label: 'Transferencia', icon: CreditCard, color: 'indigo' },
      { id: 'mercadopago', label: 'MercadoPago QR', icon: QrCode, color: 'blue' },
      { id: 'card', label: 'Tarjetas (Todas)', icon: CreditCard, color: 'purple' }
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-sys-900/40 backdrop-blur-md p-4 animate-in fade-in zoom-in-95 duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-5 border-b border-sys-100 bg-white">
          <div>
              <h3 className="font-bold text-xl text-sys-900 tracking-tight flex items-center gap-2">
                {productToEdit ? <Edit2 className="text-brand"/> : <Plus className="text-brand"/>}
                {productToEdit && productToEdit.id ? 'Editar Maestro' : 'Nuevo Producto'}
              </h3>
              <p className="text-xs text-sys-500 font-medium">Configuración global del catálogo</p>
          </div>
          <button onClick={onClose} type="button" className="p-2 bg-sys-50 hover:bg-sys-100 rounded-full text-sys-500 transition-colors" disabled={isSaving}>
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-4 pb-2 bg-white">
            <div className="flex p-1 bg-sys-100 rounded-xl">
                {['general', 'precios', 'promociones'].map((tab) => (
                    <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        disabled={isSaving}
                        className={cn(
                            "flex-1 py-2 text-xs font-bold rounded-lg transition-all duration-200 capitalize",
                            activeTab === tab 
                                ? "bg-white text-sys-900 shadow-sm" 
                                : "text-sys-500 hover:text-sys-700 hover:bg-sys-200/50",
                            isSaving && "opacity-50 cursor-not-allowed"
                        )}
                    >
                        {tab === 'promociones' && formData.promoActive ? '🔥 Promociones' : tab}
                    </button>
                ))}
            </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-white">
          
          {/* --- TAB GENERAL --- */}
          {activeTab === 'general' && (
             <div className="space-y-6 animate-in slide-in-from-right-8 duration-300 fade-in">
                <PremiumInput 
                    label="Nombre del Producto *"
                    autoFocus
                    placeholder="Ej: Coca Cola 2.25L Sabor Original"
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value.toUpperCase()})}
                    disabled={isSaving}
                />
                
                <div className="grid grid-cols-2 gap-5">
                    <PremiumInput 
                        label={<span className="flex items-center gap-1">Código Interno (SKU) {!formData.isWeighable && <span className="text-red-500">*</span>}</span>}
                        icon={ScanLine}
                        placeholder={formData.isWeighable ? "Opcional si es balanza" : "Obligatorio (o escanee abajo)"}
                        value={formData.code}
                        onChange={e => setFormData({...formData, code: e.target.value})}
                        disabled={isSaving}
                    />
                    <PremiumInput 
                        label="Stock Mínimo (Alerta)"
                        icon={AlertTriangle}
                        type="number"
                        placeholder="5"
                        value={formData.minStock}
                        onChange={e => setFormData({...formData, minStock: e.target.value})}
                        disabled={isSaving}
                    />
                </div>

                <div className="bg-sys-50 p-4 rounded-xl border border-sys-200">
                    <label className="text-[10px] font-bold text-sys-500 uppercase block mb-2">Códigos de Barras Adicionales</label>
                    <div className="flex gap-2 mb-3">
                        <input 
                            type="text" 
                            className="flex-1 px-3 py-2 rounded-lg border border-sys-200 text-sm outline-none focus:border-brand disabled:opacity-50"
                            placeholder="Escanear código..."
                            value={tempBarcode}
                            onChange={e => setTempBarcode(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addBarcode())}
                            disabled={isSaving}
                        />
                        <button type="button" onClick={addBarcode} disabled={isSaving} className="bg-brand text-white px-3 rounded-lg hover:bg-brand-hover disabled:opacity-50"><Plus size={18}/></button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {formData.barcodes.length === 0 && <span className="text-xs text-sys-400 italic">Sin códigos asignados</span>}
                        {formData.barcodes.map((code, idx) => (
                            <span key={idx} className="bg-white border border-sys-200 px-2 py-1 rounded-md text-xs font-mono flex items-center gap-2">
                                <Barcode size={12}/> {code}
                                <button type="button" onClick={() => removeBarcode(code)} disabled={isSaving} className="text-red-400 hover:text-red-600 disabled:opacity-50"><X size={12}/></button>
                            </span>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-5">
                    <PremiumSelect 
                        label="Categoría"
                        icon={Tag}
                        options={lists.categories}
                        value={formData.category}
                        onChange={(val) => setFormData({...formData, category: val})}
                    />
                    <PremiumSelect 
                        label="Marca"
                        icon={Award}
                        options={lists.brands}
                        value={formData.brand}
                        onChange={(val) => setFormData({...formData, brand: val})}
                    />
                </div>

                <div className="bg-sys-50 p-3 rounded-xl border border-sys-200 flex items-center justify-between">
                    <div className="flex items-center gap-3 text-sys-700 pl-2">
                        <div className={cn("p-2 rounded-lg", formData.isWeighable ? "bg-orange-100 text-orange-600" : "bg-blue-100 text-blue-600")}>
                            {formData.isWeighable ? <Scale size={20}/> : <Package size={20}/>}
                        </div>
                        <div>
                            <p className="text-sm font-bold">{formData.isWeighable ? 'Producto Pesable' : 'Producto Unitario'}</p>
                            <p className="text-[10px] text-sys-500 font-medium">
                                {formData.isWeighable ? 'Venta por KG (Requiere Balanza)' : 'Venta por Unidad (Bulto cerrado)'}
                            </p>
                        </div>
                    </div>
                    <Switch checked={!!formData.isWeighable} onCheckedChange={(c) => setFormData({...formData, isWeighable: c})} disabled={isSaving} />
                </div>

                {productToEdit && productToEdit.id ? (
                    <div className="bg-orange-50 border border-orange-100 p-3 rounded-xl text-xs text-orange-700 flex items-center gap-2">
                        <Package size={16}/>
                        <span>Para modificar el stock, utilice la opción <b>"Ajuste"</b> en el listado principal.</span>
                    </div>
                ) : (
                    <PremiumInput 
                        label="Stock Inicial (Solo Creación)"
                        icon={Package}
                        type="number"
                        placeholder="0"
                        value={formData.stock}
                        onChange={e => setFormData({...formData, stock: e.target.value})}
                        className="bg-emerald-50 border-emerald-100 focus:border-emerald-400"
                        disabled={isSaving}
                    />
                )}
             </div>
          )}

          {/* --- TAB PRECIOS --- */}
          {activeTab === 'precios' && (
             <div className="space-y-6 animate-in slide-in-from-right-8 duration-300 fade-in">
                
                <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl flex items-center justify-between">
                    <div>
                        <p className="text-sm font-bold text-indigo-900">Impuesto AFIP (IVA)</p>
                        <p className="text-[10px] text-indigo-600 font-medium">Requerido para generar la Factura A/B correcta.</p>
                    </div>
                    <div className="flex bg-white rounded-lg border border-indigo-200 p-1">
                        <button type="button" onClick={() => handlePriceCalculation('taxRate', '10.5')} className={cn("px-4 py-1.5 rounded-md text-xs font-bold transition-colors", formData.taxRate === '10.5' ? "bg-indigo-600 text-white" : "text-sys-500 hover:bg-sys-100")}>10.5%</button>
                        <button type="button" onClick={() => handlePriceCalculation('taxRate', '21')} className={cn("px-4 py-1.5 rounded-md text-xs font-bold transition-colors", formData.taxRate === '21' || !formData.taxRate ? "bg-indigo-600 text-white" : "text-sys-500 hover:bg-sys-100")}>21%</button>
                        <button type="button" onClick={() => handlePriceCalculation('taxRate', '0')} className={cn("px-4 py-1.5 rounded-md text-xs font-bold transition-colors", formData.taxRate === '0' ? "bg-indigo-600 text-white" : "text-sys-500 hover:bg-sys-100")}>Exento</button>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-5 items-start">
                    <PremiumInput 
                        label="Costo Neto (Sin IVA)" type="number" step="0.01" placeholder="0.00"
                        value={formData.costNeto} onChange={e => handlePriceCalculation('costNeto', e.target.value)}
                        rightIcon={<span className="text-xs font-bold text-sys-400">$</span>}
                        disabled={isSaving}
                    />
                    <PremiumInput 
                        label="Costo Final (Con IVA)" type="number" step="0.01" placeholder="0.00"
                        className="font-bold text-indigo-900 bg-indigo-50 border-indigo-200"
                        value={formData.cost} onChange={e => handlePriceCalculation('cost', e.target.value)}
                        rightIcon={<span className="text-xs font-bold text-indigo-400">$</span>}
                        disabled={isSaving}
                    />
                </div>
                
                <div className="flex justify-center my-2 text-sys-300">
                    <ChevronDown size={20} />
                </div>

                <div className="grid grid-cols-2 gap-5 items-end">
                    <PremiumInput 
                        label="Margen de Ganancia (%)" type="number" step="0.1" placeholder="30"
                        value={formData.markup} onChange={e => handlePriceCalculation('markup', e.target.value)}
                        rightIcon={<span className="text-xs font-bold text-sys-400">%</span>}
                        disabled={isSaving}
                    />
                    <PremiumInput 
                        label="Precio de Venta Público *" type="number" step="0.01"
                        className="bg-brand/5 border-2 border-brand/20 text-brand-hover text-2xl font-black h-14"
                        value={formData.price} onChange={e => handlePriceCalculation('price', e.target.value)} placeholder="0.00"
                        rightIcon={<span className="text-brand font-bold">$</span>}
                        disabled={isSaving}
                    />
                </div>

                {parseFloat(formData.cost) > parseFloat(formData.price) && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-3 text-red-700 animate-pulse">
                        <AlertTriangle size={20}/>
                        <p className="text-xs font-bold">¡ALERTA! Estás vendiendo por debajo del costo.</p>
                    </div>
                )}

                <div className="p-5 bg-sys-50 rounded-2xl border border-sys-200 flex justify-between items-center">
                    <span className="text-sm font-medium text-sys-500">Ganancia Neta (Aprox):</span>
                    <span className="text-2xl font-black text-emerald-600 tracking-tight">
                        $ {((parseFloat(formData.price || 0) - parseFloat(formData.cost || 0))).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                    </span>
                </div>

                <div className="pt-4 border-t border-sys-100">
                    <PremiumSelect 
                        label="Proveedor Principal" 
                        icon={Truck}
                        options={lists.suppliers} value={formData.supplier}
                        onChange={(val) => setFormData({...formData, supplier: val})}
                    />
                </div>
             </div>
          )}

          {/* --- TAB PROMOCIONES --- */}
          {activeTab === 'promociones' && (
             <div className="space-y-6 animate-in slide-in-from-right-8 duration-300 fade-in">
                
                <div className="bg-brand/5 border border-brand/20 p-3 rounded-xl flex items-center gap-3">
                    <MapPin className="text-brand" size={20} />
                    <div>
                        <p className="text-xs font-bold text-brand-dark">Promoción Localizada</p>
                        <p className="text-[10px] text-sys-600">
                            Esta configuración afectará únicamente a la sucursal: 
                            <span className="font-black text-sys-800 ml-1 uppercase">{activeBranchName || 'Actual'}</span>
                        </p>
                    </div>
                </div>

                <div className="flex items-center justify-between bg-purple-50 p-4 rounded-xl border border-purple-100">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-100 text-purple-600 rounded-lg"><Megaphone size={20}/></div>
                        <div>
                            <p className="text-sm font-bold text-purple-900">Activar Promoción</p>
                            <p className="text-[10px] text-purple-600">Configura reglas avanzadas de descuento</p>
                        </div>
                    </div>
                    <Switch checked={formData.promoActive} onCheckedChange={(c) => setFormData({...formData, promoActive: c})} disabled={isSaving} />
                </div>

                {formData.promoActive && (
                    <div className="p-4 border border-purple-100 rounded-xl bg-white shadow-sm space-y-4">
                        
                        <PremiumSelect 
                            label="Tipo de Regla"
                            icon={Layers}
                            options={promoOptions}
                            value={formData.promoType}
                            onChange={(val) => setFormData({...formData, promoType: val})}
                        />

                        <div className="grid grid-cols-2 gap-4">
                            {formData.promoType === 'PERCENTAGE' && (
                                <div className="col-span-2">
                                    <PremiumInput 
                                        label="Porcentaje de Descuento *" type="number"
                                        className="text-purple-700 font-bold"
                                        value={formData.promoValue}
                                        onChange={e => setFormData({...formData, promoValue: e.target.value})}
                                        rightIcon={<span className="text-purple-400 font-bold">% OFF</span>}
                                        disabled={isSaving}
                                    />
                                </div>
                            )}

                            {formData.promoType === 'BULK_THRESHOLD' && (
                                <>
                                    <PremiumInput 
                                        label="Cantidad Mínima (Unidades) *" type="number"
                                        placeholder="Ej: 6"
                                        value={formData.promoValue}
                                        onChange={e => setFormData({...formData, promoValue: e.target.value})}
                                        disabled={isSaving}
                                    />
                                    <PremiumInput 
                                        label="Descuento a aplicar (%) *" type="number"
                                        placeholder="Ej: 10"
                                        value={formData.promoDiscount}
                                        onChange={e => setFormData({...formData, promoDiscount: e.target.value})}
                                        rightIcon={<span className="text-xs text-purple-400">%</span>}
                                        disabled={isSaving}
                                    />
                                </>
                            )}

                            {formData.promoType === 'QUANTITY_LIMIT' && (
                                <>
                                    <PremiumInput 
                                        label="Límite de Unidades *" type="number"
                                        placeholder="Ej: 3"
                                        value={formData.promoValue}
                                        onChange={e => setFormData({...formData, promoValue: e.target.value})}
                                        disabled={isSaving}
                                    />
                                    <PremiumInput 
                                        label="Descuento en esas unidades (%) *" type="number"
                                        placeholder="Ej: 50"
                                        value={formData.promoDiscount}
                                        onChange={e => setFormData({...formData, promoDiscount: e.target.value})}
                                        rightIcon={<span className="text-xs text-purple-400">%</span>}
                                        disabled={isSaving}
                                    />
                                </>
                            )}

                            {formData.promoType === 'BUNDLE_DEAL' && (
                                <>
                                    <PremiumInput 
                                        label="Lleva (Cantidad) *" type="number"
                                        placeholder="Ej: 3"
                                        value={formData.promoValue}
                                        onChange={e => setFormData({...formData, promoValue: e.target.value})}
                                        disabled={isSaving}
                                    />
                                    <PremiumInput 
                                        label="Paga (Cantidad) *" type="number"
                                        placeholder="Ej: 2"
                                        value={formData.promoPayValue}
                                        onChange={e => setFormData({...formData, promoPayValue: e.target.value})}
                                        disabled={isSaving}
                                    />
                                </>
                            )}
                        </div>

                        {/* 🔥 SPRINT 1: SELECTOR DE MÉTODOS DE PAGO PERMITIDOS */}
                        <div className="pt-4 border-t border-dashed border-sys-200">
                            <label className="text-[10px] font-bold text-sys-500 uppercase block mb-2 flex items-center justify-between">
                                <span>Restricción por Medio de Pago</span>
                                {formData.promoAllowedMethods.length === 0 && <span className="text-brand bg-brand/10 px-2 py-0.5 rounded">Aplica a Todos</span>}
                            </label>
                            
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {paymentMethodOptions.map((method) => {
                                    const isSelected = formData.promoAllowedMethods.includes(method.id);
                                    return (
                                        <button
                                            key={method.id}
                                            type="button"
                                            onClick={() => togglePromoMethod(method.id)}
                                            className={cn(
                                                "p-2 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all text-center h-16",
                                                isSelected 
                                                    ? `bg-${method.color}-50 border-${method.color}-300 text-${method.color}-700 shadow-sm ring-2 ring-${method.color}-100` 
                                                    : "bg-white border-sys-200 text-sys-400 hover:border-sys-300"
                                            )}
                                        >
                                            <method.icon size={16} />
                                            <span className="text-[9px] font-bold leading-tight">{method.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-[9px] text-sys-400 mt-2 italic">Si no seleccionas ninguno, la oferta aplicará automáticamente a cualquier método de pago. (Las ofertas nunca aplican a "Pago Combinado" por seguridad).</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-dashed border-sys-200">
                            <div>
                                <label className="text-[10px] font-bold text-sys-500 uppercase block mb-1">Inicio Vigencia</label>
                                <input 
                                    type="date" 
                                    className="w-full p-2 border border-sys-200 rounded-lg text-sm bg-sys-50 focus:bg-white focus:border-purple-300 outline-none transition-colors disabled:opacity-50"
                                    value={formData.promoStartDate}
                                    onChange={e => setFormData({...formData, promoStartDate: e.target.value})}
                                    disabled={isSaving}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-sys-500 uppercase block mb-1">Fin Vigencia *</label>
                                <input 
                                    type="date" 
                                    className="w-full p-2 border border-sys-200 rounded-lg text-sm bg-sys-50 focus:bg-white focus:border-purple-300 outline-none transition-colors disabled:opacity-50"
                                    value={formData.promoEndDate}
                                    onChange={e => setFormData({...formData, promoEndDate: e.target.value})}
                                    disabled={isSaving}
                                />
                            </div>
                        </div>
                    </div>
                )}
             </div>
          )}
          
          <button type="submit" className="hidden" />
        </form>

        <div className="p-5 border-t border-sys-100 bg-sys-50/50 flex justify-end gap-3 backdrop-blur-sm">
            <Button variant="ghost" onClick={onClose} type="button" className="hover:bg-sys-200/50 text-sys-600" disabled={isSaving}>Cancelar</Button>
            
            <Button onClick={handleSubmit} type="button" className="px-8 shadow-xl shadow-brand/20 active:scale-95 transition-all" disabled={isSaving}>
                {isSaving ? (
                    <span className="flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin" /> Guardando...
                    </span>
                ) : (
                    <><Save size={18} className="mr-2" /> Guardar Producto</>
                )}
            </Button>
        </div>

      </div>
    </div>
  );
};