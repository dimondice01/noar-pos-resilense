import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Tag, Truck, Award, Loader2, Search, Pencil, XCircle, Check } from 'lucide-react'; // Agregué Loader2 y Search
import { Button } from '../../../core/ui/Button';
import { masterRepository } from '../repositories/masterRepository';
import { cn } from '../../../core/utils/cn';

const EMPTY_SUPPLIER_FORM = { contactName: '', phone: '', email: '', docNumber: '', paymentTerms: 'Efectivo' };

export const MastersModal = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('categories'); // categories | brands | suppliers
  const [items, setItems] = useState([]);
  const [newItemValue, setNewItemValue] = useState('');
  const [supplierForm, setSupplierForm] = useState(EMPTY_SUPPLIER_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState(''); // Filtro local

  // Configuración de UI según la pestaña
  // Las keys (categories, brands, suppliers) coinciden con las colecciones de Firebase
  const CONFIG = {
    categories: { title: "Categorías", icon: Tag, placeholder: "Nueva Categoría (Ej: Bebidas)" },
    brands: { title: "Marcas", icon: Award, placeholder: "Nueva Marca (Ej: Coca Cola)" },
    suppliers: { title: "Proveedores", icon: Truck, placeholder: "Nombre del Proveedor (Ej: Distribuidora Norte)" }
  };

  const resetForm = () => {
    setNewItemValue('');
    setSupplierForm(EMPTY_SUPPLIER_FORM);
    setEditingId(null);
  };

  // Cargar datos al abrir o cambiar pestaña
  useEffect(() => {
    if (isOpen) {
        loadItems();
        setFilter('');
        resetForm();
    }
  }, [isOpen, activeTab]);

  const loadItems = async () => {
    setLoading(true);
    try {
        const data = await masterRepository.getAll(activeTab);
        setItems(data || []);
    } catch (error) {
        console.error("Error cargando maestros:", error);
    } finally {
        setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newItemValue.trim()) return;

    try {
        setLoading(true); // Feedback visual rápido
        // Al editar partimos del item original para no perder campos como balance/sequentialId
        const original = editingId ? items.find(i => i.id === editingId) : null;
        const payload = { ...(original || {}), name: newItemValue };
        if (activeTab === 'suppliers') Object.assign(payload, supplierForm);
        if (editingId) payload.id = editingId;

        await masterRepository.save(activeTab, payload);
        resetForm();
        await loadItems(); // Recargar lista actualizada
    } catch (error) {
        alert("Error al guardar: " + error.message);
    } finally {
        setLoading(false);
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setNewItemValue(item.name || '');
    if (activeTab === 'suppliers') {
        setSupplierForm({
            contactName: item.contactName || '',
            phone: item.phone || '',
            email: item.email || '',
            docNumber: item.docNumber || '',
            paymentTerms: item.paymentTerms || 'Efectivo'
        });
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("¿Seguro que deseas eliminar este elemento?")) return;

    try {
        // Optimistic UI: Lo sacamos visualmente antes de que termine el proceso
        setItems(prev => prev.filter(i => i.id !== id));
        if (editingId === id) resetForm();
        await masterRepository.delete(activeTab, id);
    } catch (error) {
        console.error(error);
        loadItems(); // Si falla, recargamos la lista real
    }
  };

  // Filtrado en memoria
  const filteredItems = items.filter(i => 
      i.name.toLowerCase().includes(filter.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col h-[600px] border border-sys-200">
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-sys-100 bg-sys-50">
          <h3 className="font-bold text-lg text-sys-900 flex items-center gap-2">
              <Tag size={20} className="text-brand"/> Gestión de Maestros
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-500 transition-colors"><X size={20} /></button>
        </div>

        {/* Sidebar + Content Layout */}
        <div className="flex flex-1 overflow-hidden">
            
            {/* Sidebar Tabs */}
            <div className="w-1/3 bg-sys-50 border-r border-sys-100 p-3 space-y-1 overflow-y-auto">
                <p className="text-[10px] font-bold text-sys-400 uppercase tracking-wider mb-2 px-2">Seleccione Tipo</p>
                {Object.keys(CONFIG).map((key) => {
                    const ItemIcon = CONFIG[key].icon;
                    return (
                        <button
                            key={key}
                            onClick={() => setActiveTab(key)}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all text-left",
                                activeTab === key 
                                    ? "bg-white shadow-sm text-brand ring-1 ring-sys-200 font-bold" 
                                    : "text-sys-500 hover:bg-sys-100 hover:text-sys-900"
                            )}
                        >
                            <ItemIcon size={18} />
                            {CONFIG[key].title}
                        </button>
                    );
                })}
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col p-5 bg-white min-w-0">
                <div className="flex items-center justify-between mb-4">
                    <h4 className="font-bold text-xl text-sys-900 flex items-center gap-2">
                        {React.createElement(CONFIG[activeTab].icon, {size: 24, className: "text-sys-400"})}
                        {CONFIG[activeTab].title}
                    </h4>
                    <div className="bg-sys-100 text-sys-600 px-2 py-1 rounded text-xs font-bold">
                        {items.length} elementos
                    </div>
                </div>

                {/* Formulario Agregar / Editar */}
                <form onSubmit={handleSubmit} className="mb-4">
                    {editingId && (
                        <div className="flex items-center justify-between mb-2 px-1">
                            <span className="text-[10px] font-bold text-brand uppercase">Editando elemento</span>
                            <button type="button" onClick={resetForm} className="text-[10px] font-bold text-sys-400 hover:text-red-500 flex items-center gap-1">
                                <XCircle size={12}/> Cancelar
                            </button>
                        </div>
                    )}
                    <div className="flex gap-2">
                        <input
                            autoFocus
                            type="text"
                            className="flex-1 p-3 border border-sys-200 rounded-xl focus:border-brand focus:ring-4 focus:ring-brand/10 outline-none text-sm transition-all"
                            placeholder={CONFIG[activeTab].placeholder}
                            value={newItemValue}
                            onChange={(e) => setNewItemValue(e.target.value)}
                        />
                        <Button type="submit" className="px-4 shadow-lg shadow-brand/20 h-auto rounded-xl" disabled={!newItemValue.trim() || loading}>
                            {loading ? <Loader2 className="animate-spin" /> : (editingId ? <Check size={20}/> : <Plus size={20} />)}
                        </Button>
                    </div>

                    {activeTab === 'suppliers' && (
                        <div className="grid grid-cols-2 gap-2 mt-2">
                            <input
                                type="text"
                                className="p-2.5 border border-sys-200 rounded-xl outline-none focus:border-brand text-xs"
                                placeholder="Persona de contacto"
                                value={supplierForm.contactName}
                                onChange={(e) => setSupplierForm(prev => ({ ...prev, contactName: e.target.value }))}
                            />
                            <input
                                type="text"
                                className="p-2.5 border border-sys-200 rounded-xl outline-none focus:border-brand text-xs"
                                placeholder="Teléfono"
                                value={supplierForm.phone}
                                onChange={(e) => setSupplierForm(prev => ({ ...prev, phone: e.target.value }))}
                            />
                            <input
                                type="email"
                                className="p-2.5 border border-sys-200 rounded-xl outline-none focus:border-brand text-xs"
                                placeholder="Email"
                                value={supplierForm.email}
                                onChange={(e) => setSupplierForm(prev => ({ ...prev, email: e.target.value }))}
                            />
                            <input
                                type="text"
                                className="p-2.5 border border-sys-200 rounded-xl outline-none focus:border-brand text-xs"
                                placeholder="CUIT / DNI"
                                value={supplierForm.docNumber}
                                onChange={(e) => setSupplierForm(prev => ({ ...prev, docNumber: e.target.value }))}
                            />
                        </div>
                    )}
                </form>

                {/* Barra de Búsqueda Interna */}
                <div className="relative mb-2">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400"/>
                    <input 
                        type="text" 
                        placeholder={`Buscar en ${CONFIG[activeTab].title}...`}
                        className="w-full pl-8 pr-3 py-2 bg-sys-50 rounded-lg text-xs outline-none focus:bg-white border border-transparent focus:border-sys-200 transition-all"
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                    />
                </div>

                {/* Lista */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                    {loading && items.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-sys-400 gap-2">
                            <Loader2 className="animate-spin" size={24}/>
                            <span className="text-xs">Cargando...</span>
                        </div>
                    ) : filteredItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-sys-300 border-2 border-dashed border-sys-100 rounded-xl">
                            <p className="text-sm font-medium">Lista vacía</p>
                            <p className="text-xs">Agregue un elemento arriba</p>
                        </div>
                    ) : (
                        filteredItems.map((item) => (
                            <div key={item.id} className={cn(
                                "flex justify-between items-center p-3 bg-white hover:bg-sys-50 rounded-xl border group transition-all animate-in slide-in-from-bottom-1 duration-200",
                                editingId === item.id ? "border-brand ring-2 ring-brand/10" : "border-sys-100 hover:border-sys-200"
                            )}>
                                <div className="flex flex-col pl-1 min-w-0">
                                    <span className="text-sm text-sys-800 font-medium truncate">{item.name}</span>
                                    {activeTab === 'suppliers' && item.phone && (
                                        <span className="text-[10px] text-sys-400 truncate">{item.phone}</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        onClick={() => startEdit(item)}
                                        className="p-2 rounded-lg text-sys-300 hover:text-brand hover:bg-brand/10 opacity-0 group-hover:opacity-100 transition-all"
                                        title="Editar"
                                    >
                                        <Pencil size={16} />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(item.id)}
                                        className="p-2 rounded-lg text-sys-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                                        title="Eliminar"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};