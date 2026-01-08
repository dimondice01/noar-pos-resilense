import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Tag, Truck, Award, Loader2, Search } from 'lucide-react'; // Agregué Loader2 y Search
import { Button } from '../../../core/ui/Button';
import { masterRepository } from '../repositories/masterRepository';
import { cn } from '../../../core/utils/cn';

export const MastersModal = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('categories'); // categories | brands | suppliers
  const [items, setItems] = useState([]);
  const [newItemValue, setNewItemValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState(''); // Filtro local

  // Configuración de UI según la pestaña
  // Las keys (categories, brands, suppliers) coinciden con las colecciones de Firebase
  const CONFIG = {
    categories: { title: "Categorías", icon: Tag, placeholder: "Nueva Categoría (Ej: Bebidas)" },
    brands: { title: "Marcas", icon: Award, placeholder: "Nueva Marca (Ej: Coca Cola)" },
    suppliers: { title: "Proveedores", icon: Truck, placeholder: "Nuevo Proveedor (Ej: Distribuidora Norte)" }
  };

  // Cargar datos al abrir o cambiar pestaña
  useEffect(() => {
    if (isOpen) {
        loadItems();
        setFilter('');
        setNewItemValue('');
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

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newItemValue.trim()) return;

    try {
        setLoading(true); // Feedback visual rápido
        await masterRepository.save(activeTab, { name: newItemValue });
        setNewItemValue('');
        await loadItems(); // Recargar lista actualizada
    } catch (error) {
        alert("Error al guardar: " + error.message);
    } finally {
        setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("¿Seguro que deseas eliminar este elemento?")) return;
    
    try {
        // Optimistic UI: Lo sacamos visualmente antes de que termine el proceso
        setItems(prev => prev.filter(i => i.id !== id));
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

                {/* Formulario Agregar */}
                <form onSubmit={handleAdd} className="flex gap-2 mb-4">
                    <input 
                        autoFocus
                        type="text" 
                        className="flex-1 p-3 border border-sys-200 rounded-xl focus:border-brand focus:ring-4 focus:ring-brand/10 outline-none text-sm transition-all"
                        placeholder={CONFIG[activeTab].placeholder}
                        value={newItemValue}
                        onChange={(e) => setNewItemValue(e.target.value)}
                    />
                    <Button type="submit" className="px-4 shadow-lg shadow-brand/20 h-auto rounded-xl" disabled={!newItemValue.trim() || loading}>
                        {loading ? <Loader2 className="animate-spin" /> : <Plus size={20} />}
                    </Button>
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
                            <div key={item.id} className="flex justify-between items-center p-3 bg-white hover:bg-sys-50 rounded-xl border border-sys-100 hover:border-sys-200 group transition-all animate-in slide-in-from-bottom-1 duration-200">
                                <span className="text-sm text-sys-800 font-medium pl-1">{item.name}</span>
                                <button 
                                    onClick={() => handleDelete(item.id)}
                                    className="p-2 rounded-lg text-sys-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                                    title="Eliminar"
                                >
                                    <Trash2 size={16} />
                                </button>
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