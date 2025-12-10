import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Tag, Truck, Award } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { masterRepository } from '../repositories/masterRepository';
import { cn } from '../../../core/utils/cn';

export const MastersModal = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('categories'); // categories | brands | suppliers
  const [items, setItems] = useState([]);
  const [newItemValue, setNewItemValue] = useState('');

  // Configuración de UI según la pestaña
  const CONFIG = {
    categories: { title: "Categorías", icon: Tag, placeholder: "Nueva Categoría (Ej: Bebidas)" },
    brands: { title: "Marcas", icon: Award, placeholder: "Nueva Marca (Ej: Coca Cola)" },
    suppliers: { title: "Proveedores", icon: Truck, placeholder: "Nuevo Proveedor (Ej: Distribuidora Norte)" }
  };

  // Cargar datos al cambiar de pestaña
  useEffect(() => {
    if (isOpen) loadItems();
  }, [isOpen, activeTab]);

  const loadItems = async () => {
    const data = await masterRepository.getAll(activeTab);
    setItems(data);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newItemValue.trim()) return;

    await masterRepository.save(activeTab, { name: newItemValue });
    setNewItemValue('');
    loadItems();
  };

  const handleDelete = async (id) => {
    if (confirm("¿Eliminar este elemento?")) {
      await masterRepository.delete(activeTab, id);
      loadItems();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col h-[600px]">
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-sys-100 bg-sys-50">
          <h3 className="font-bold text-lg text-sys-900">Gestión de Maestros</h3>
          <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-500"><X size={20} /></button>
        </div>

        {/* Sidebar + Content Layout */}
        <div className="flex flex-1 overflow-hidden">
            
            {/* Sidebar Tabs */}
            <div className="w-1/3 bg-sys-50 border-r border-sys-100 p-2 space-y-1">
                {Object.keys(CONFIG).map((key) => {
                    const ItemIcon = CONFIG[key].icon;
                    return (
                        <button
                            key={key}
                            onClick={() => setActiveTab(key)}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all text-left",
                                activeTab === key 
                                    ? "bg-white shadow-sm text-brand ring-1 ring-sys-200" 
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
            <div className="flex-1 flex flex-col p-4 bg-white">
                <h4 className="font-bold text-sys-800 mb-4 flex items-center gap-2">
                    {React.createElement(CONFIG[activeTab].icon, {size: 20})}
                    {CONFIG[activeTab].title}
                </h4>

                {/* Formulario Agregar */}
                <form onSubmit={handleAdd} className="flex gap-2 mb-4">
                    <input 
                        autoFocus
                        type="text" 
                        className="flex-1 p-2 border border-sys-200 rounded-lg focus:border-brand outline-none text-sm"
                        placeholder={CONFIG[activeTab].placeholder}
                        value={newItemValue}
                        onChange={(e) => setNewItemValue(e.target.value)}
                    />
                    <Button type="submit" className="px-3 shadow-none h-10" disabled={!newItemValue.trim()}>
                        <Plus size={18} />
                    </Button>
                </form>

                {/* Lista */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    {items.length === 0 && (
                        <p className="text-center text-sys-400 text-xs mt-10">No hay elementos registrados.</p>
                    )}
                    {items.map((item) => (
                        <div key={item.id} className="flex justify-between items-center p-3 bg-sys-50 rounded-lg border border-transparent hover:border-sys-200 group transition-all">
                            <span className="text-sm text-sys-800 font-medium">{item.name}</span>
                            <button 
                                onClick={() => handleDelete(item.id)}
                                className="text-sys-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

 