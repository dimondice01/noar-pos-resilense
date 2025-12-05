import React, { useState, useEffect } from 'react';
import { X, Search, User, Check, Plus } from 'lucide-react';
import { clientRepository } from '../../clients/repositories/clientRepository'; // Importamos del módulo Clients
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

export const ClientSelectionModal = ({ isOpen, onClose, onSelect }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  // Búsqueda en tiempo real con debounce
  useEffect(() => {
    if (!isOpen) return;
    
    // Carga inicial (top 10)
    if (!searchTerm) {
        clientRepository.getAll().then(all => setResults(all.slice(0, 10)));
        return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await clientRepository.search(searchTerm);
        setResults(data.slice(0, 50)); // Limitamos para rendimiento visual
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh]">
        
        {/* Header */}
        <div className="p-4 border-b border-sys-100 bg-sys-50 flex justify-between items-center">
          <h3 className="font-bold text-lg text-sys-900">Seleccionar Cliente</h3>
          <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-500"><X size={20}/></button>
        </div>

        {/* Buscador */}
        <div className="p-4 border-b border-sys-100 bg-white">
            <div className="relative">
                <Search className="absolute left-3 top-2.5 text-sys-400" size={18} />
                <input 
                    autoFocus
                    type="text" 
                    placeholder="Buscar por Nombre, CUIT o DNI..." 
                    className="w-full pl-10 pr-4 py-2 bg-sys-50 border border-sys-200 rounded-xl focus:border-brand outline-none transition-all text-sm"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
        </div>

        {/* Lista de Resultados */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            {loading ? (
                <div className="py-10 text-center text-sys-400 text-xs">Buscando...</div>
            ) : results.length === 0 ? (
                <div className="py-10 text-center text-sys-400">
                    <User size={32} className="mx-auto mb-2 opacity-50"/>
                    <p className="text-xs">No se encontraron clientes.</p>
                </div>
            ) : (
                results.map(client => (
                    <button 
                        key={client.id}
                        onClick={() => { onSelect(client); onClose(); }}
                        className="w-full text-left p-3 hover:bg-brand-light/20 rounded-xl transition-colors group border border-transparent hover:border-brand/10 flex justify-between items-center"
                    >
                        <div>
                            <p className="font-bold text-sys-800 text-sm">{client.name}</p>
                            <div className="flex items-center gap-2 text-[10px] text-sys-500 font-mono mt-0.5">
                                <span className="bg-sys-100 px-1.5 rounded">{client.docType === '80' ? 'CUIT' : 'DNI'}</span>
                                <span>{client.docNumber}</span>
                            </div>
                        </div>
                        <div className="opacity-0 group-hover:opacity-100 text-brand transition-opacity">
                            <Check size={18} />
                        </div>
                    </button>
                ))
            )}
        </div>

        {/* Footer: Opción Consumidor Final */}
        <div className="p-4 border-t border-sys-100 bg-sys-50">
            <Button 
                variant="secondary" 
                className="w-full justify-center"
                onClick={() => { onSelect(null); onClose(); }}
            >
                <User size={16} className="mr-2"/> Consumidor Final (Anónimo)
            </Button>
        </div>
      </div>
    </div>
  );
};