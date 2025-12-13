import React, { useState, useEffect } from 'react';
import { X, Search, User, Check, Plus, ArrowLeft, FileText, UserPlus } from 'lucide-react';
import { clientRepository } from '../../clients/repositories/clientRepository'; 
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

export const ClientSelectionModal = ({ isOpen, onClose, onSelect }) => {
  // ==========================================
  // ESTADOS
  // ==========================================
  const [view, setView] = useState('search'); // 'search' | 'create'
  
  // Estados de Búsqueda
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  // Estados de Cliente Eventual (Manual)
  const [tempClient, setTempClient] = useState({
      docType: '80', // Por defecto CUIT
      docNumber: '',
      name: '',
      address: '-' // AFIP a veces pide dirección, ponemos guion por defecto para agilizar
  });

  // ==========================================
  // LÓGICA DE BÚSQUEDA (Existente)
  // ==========================================
  useEffect(() => {
    if (!isOpen) return;
    
    // Resetear al abrir
    if (view === 'create') setView('search');
    
    // Carga inicial (top 10)
    if (!searchTerm) {
        clientRepository.getAll().then(all => setResults(all.slice(0, 10)));
        return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await clientRepository.search(searchTerm);
        setResults(data.slice(0, 50)); 
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm, isOpen]);

  // ==========================================
  // HANDLERS
  // ==========================================
  const handleSelectTemp = () => {
      // Validaciones simples
      if (!tempClient.docNumber || tempClient.docNumber.length < 7) return alert("Ingrese un número de documento válido.");
      if (!tempClient.name || tempClient.name.length < 3) return alert("Ingrese el nombre o razón social.");

      // Creamos un objeto cliente "al vuelo"
      const casualClient = {
          id: `temp_${Date.now()}`, // ID temporal para que React no llore con las keys
          name: tempClient.name.toUpperCase(),
          docType: tempClient.docType,
          docNumber: tempClient.docNumber,
          address: tempClient.address,
          isGuest: true // Flag útil para saber que no está en la DB
      };

      onSelect(casualClient);
      onClose();
      
      // Limpiamos form
      setTempClient({ docType: '80', docNumber: '', name: '', address: '-' });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col h-[600px] max-h-[80vh]">
        
        {/* HEADER */}
        <div className="p-4 border-b border-sys-100 bg-sys-50 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
              {view === 'create' && (
                  <button onClick={() => setView('search')} className="p-1 hover:bg-sys-200 rounded-full mr-1 transition-colors">
                      <ArrowLeft size={20} className="text-sys-600"/>
                  </button>
              )}
              <h3 className="font-bold text-lg text-sys-900">
                  {view === 'search' ? 'Seleccionar Cliente' : 'Cliente Eventual'}
              </h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-500"><X size={20}/></button>
        </div>

        {/* ========================================== */}
        {/* VISTA 1: BUSCADOR (Default)                */}
        {/* ========================================== */}
        {view === 'search' && (
            <>
                <div className="p-4 border-b border-sys-100 bg-white shrink-0">
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

                <div className="p-4 border-t border-sys-100 bg-sys-50 shrink-0 space-y-2">
                    <Button 
                        onClick={() => setView('create')}
                        variant="outline"
                        className="w-full justify-center border-brand/30 text-brand hover:bg-brand-light/10"
                    >
                        <Plus size={16} className="mr-2"/> Nuevo Cliente Eventual
                    </Button>
                    <Button 
                        variant="secondary" 
                        className="w-full justify-center"
                        onClick={() => { onSelect(null); onClose(); }}
                    >
                        <User size={16} className="mr-2"/> Consumidor Final (Anónimo)
                    </Button>
                </div>
            </>
        )}

        {/* ========================================== */}
        {/* VISTA 2: FORMULARIO EVENTUAL (Manual)      */}
        {/* ========================================== */}
        {view === 'create' && (
            <div className="flex-1 flex flex-col p-6 animate-in slide-in-from-right-10 duration-200">
                <div className="flex-1 space-y-4">
                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 text-blue-800 text-xs mb-4">
                        <p className="font-bold flex items-center gap-2"><FileText size={14}/> Nota Técnica:</p>
                        Este cliente se usará solo para esta venta (AFIP). No se guardará en la agenda permanente.
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-1 space-y-1">
                            <label className="text-xs font-bold text-sys-700">Tipo</label>
                            <select 
                                className="w-full p-2.5 bg-sys-50 border border-sys-200 rounded-lg text-sm outline-none focus:border-brand"
                                value={tempClient.docType}
                                onChange={(e) => setTempClient({...tempClient, docType: e.target.value})}
                            >
                                <option value="80">CUIT</option>
                                <option value="96">DNI</option>
                            </select>
                        </div>
                        <div className="col-span-2 space-y-1">
                            <label className="text-xs font-bold text-sys-700">Número</label>
                            <input 
                                type="number" 
                                autoFocus
                                className="w-full p-2.5 bg-sys-50 border border-sys-200 rounded-lg text-sm outline-none focus:border-brand"
                                placeholder="Sin guiones"
                                value={tempClient.docNumber}
                                onChange={(e) => setTempClient({...tempClient, docNumber: e.target.value})}
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-sys-700">Nombre / Razón Social</label>
                        <input 
                            type="text" 
                            className="w-full p-2.5 bg-sys-50 border border-sys-200 rounded-lg text-sm outline-none focus:border-brand uppercase"
                            placeholder="Ej: JUAN PEREZ"
                            value={tempClient.name}
                            onChange={(e) => setTempClient({...tempClient, name: e.target.value})}
                        />
                    </div>
                </div>

                <div className="mt-auto pt-4">
                    <Button 
                        onClick={handleSelectTemp}
                        className="w-full py-3 justify-center text-base shadow-lg shadow-brand/20"
                        disabled={!tempClient.docNumber || !tempClient.name}
                    >
                        <Check size={18} className="mr-2"/> Usar para Facturar
                    </Button>
                </div>
            </div>
        )}

      </div>
    </div>
  );
};