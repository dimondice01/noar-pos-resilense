import React, { useState, useEffect } from 'react';
import { 
    X, Search, User, Check, Plus, ArrowLeft, 
    FileText, Loader2, Scale, ShieldAlert 
} from 'lucide-react';
import { clientRepository } from '../../clients/repositories/clientRepository'; 
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

// Constantes de AFIP para UI
const FISCAL_OPTIONS = [
    { id: 'CONSUMIDOR_FINAL', label: 'Consumidor Final' },
    { id: 'RESPONSABLE_INSCRIPTO', label: 'Resp. Inscripto (Factura A)' },
    { id: 'MONOTRIBUTO', label: 'Monotributista' },
    { id: 'EXENTO', label: 'Exento' }
];

export const ClientSelectionModal = ({ isOpen, onClose, onSelect }) => {
  const [view, setView] = useState('search'); // 'search' | 'create'
  
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  // Estado de Cliente Eventual
  const [tempClient, setTempClient] = useState({
      docType: '80', // Default CUIT
      docNumber: '',
      name: '',
      address: '-',
      fiscalCondition: 'CONSUMIDOR_FINAL'
  });

  // Reset al abrir
  useEffect(() => {
    if (!isOpen) return;
    if (view === 'create') setView('search');
    setSearchTerm('');
  }, [isOpen]);

  // Buscador en tiempo real
  useEffect(() => {
    if (!isOpen || view !== 'search') return;
    
    const fetchClients = async () => {
        setLoading(true);
        try {
            if (!searchTerm) {
                const all = await clientRepository.getAll();
                setResults(all.slice(0, 10));
            } else {
                const data = await clientRepository.search(searchTerm);
                setResults(data.slice(0, 50)); 
            }
        } catch (error) {
            console.error("Error buscando clientes:", error);
        } finally {
            setLoading(false);
        }
    };

    const timer = setTimeout(fetchClients, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, isOpen, view]);

  // ==========================================
  // HANDLERS
  // ==========================================
  const handleSelectTemp = () => {
      const cleanDoc = tempClient.docNumber.replace(/[^0-9]/g, '');
      
      // Validaciones básicas antes de cerrar
      if (tempClient.docType === '80' && cleanDoc.length !== 11) {
          return alert("El CUIT debe tener 11 dígitos.");
      }
      if (!tempClient.name || tempClient.name.trim().length < 3) {
          return alert("El nombre es muy corto.");
      }

      const casualClient = {
          id: `temp_${Date.now()}`, 
          name: tempClient.name.toUpperCase(),
          docType: tempClient.docType,
          docNumber: cleanDoc,
          address: tempClient.address,
          fiscalCondition: tempClient.fiscalCondition,
          isGuest: true 
      };

      onSelect(casualClient);
      onClose();
      // Reset
      setTempClient({ docType: '80', docNumber: '', name: '', address: '-', fiscalCondition: 'CONSUMIDOR_FINAL' });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col h-[650px] max-h-[90vh]">
        
        {/* HEADER (FIJO) */}
        <div className="p-5 border-b border-sys-100 bg-sys-50 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
              {view === 'create' && (
                  <button onClick={() => setView('search')} className="p-2 hover:bg-sys-200 rounded-full mr-1 transition-all">
                      <ArrowLeft size={20} className="text-sys-600"/>
                  </button>
              )}
              <h3 className="font-black text-xl text-sys-900 tracking-tight uppercase">
                  {view === 'search' ? 'Seleccionar Cliente' : 'Cliente Eventual'}
              </h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-500 transition-colors"><X size={24}/></button>
        </div>

        {/* ================================================= */}
        {/* VISTA 1: BUSCADOR */}
        {/* ================================================= */}
        {view === 'search' && (
            <>
                <div className="p-4 border-b border-sys-100 bg-white shrink-0">
                    <div className="relative group">
                        <Search className="absolute left-4 top-3.5 text-sys-400 group-focus-within:text-brand transition-colors" size={20} />
                        <input 
                            autoFocus
                            type="text" 
                            placeholder="Nombre, CUIT o DNI..." 
                            className="w-full pl-12 pr-4 py-3.5 bg-sys-50 border-2 border-transparent rounded-2xl focus:border-brand focus:bg-white outline-none transition-all text-sm font-bold uppercase"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                {/* LISTA CON SCROLL */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar bg-sys-50/20">
                    {loading ? (
                        <div className="py-20 flex flex-col items-center justify-center text-sys-400 gap-3">
                            <Loader2 className="animate-spin text-brand" size={32} />
                            <span className="text-[10px] font-black uppercase tracking-widest">Buscando...</span>
                        </div>
                    ) : results.length === 0 ? (
                        <div className="py-20 text-center text-sys-400">
                            <User size={48} className="mx-auto mb-4 opacity-20"/>
                            <p className="text-xs font-bold uppercase tracking-widest">No se encontraron resultados</p>
                        </div>
                    ) : (
                        results.map(client => (
                            <button 
                                key={client.id}
                                onClick={() => { onSelect(client); onClose(); }}
                                className="w-full text-left p-4 bg-white hover:bg-brand-light/5 rounded-2xl transition-all group border border-sys-100 hover:border-brand/30 flex justify-between items-center shadow-sm"
                            >
                                <div className="flex-1 min-w-0">
                                    <p className="font-black text-sys-900 text-sm truncate uppercase tracking-tight">{client.name}</p>
                                    <div className="flex items-center gap-3 mt-1.5">
                                        <span className="bg-sys-900 text-white text-[9px] px-2 py-0.5 rounded font-black tracking-tighter uppercase">
                                            {client.docType === '80' ? 'CUIT' : 'DNI'} {client.docNumber}
                                        </span>
                                        <span className={cn(
                                            "text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-tighter",
                                            client.fiscalCondition === 'RESPONSABLE_INSCRIPTO' ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"
                                        )}>
                                            {client.fiscalCondition?.replace(/_/g, ' ') || 'Consumidor Final'}
                                        </span>
                                    </div>
                                </div>
                                <div className="ml-4 opacity-0 group-hover:opacity-100 text-brand transition-all translate-x-2 group-hover:translate-x-0">
                                    <Check size={20} strokeWidth={3} />
                                </div>
                            </button>
                        ))
                    )}
                </div>

                {/* FOOTER ACCIONES */}
                <div className="p-5 border-t border-sys-100 bg-sys-50 shrink-0 space-y-3">
                    <Button 
                        onClick={() => setView('create')}
                        variant="outline"
                        className="w-full justify-center h-12 border-2 border-brand/20 text-brand font-black rounded-xl hover:bg-brand hover:text-white"
                    >
                        <Plus size={18} className="mr-2"/> CLIENTE EVENTUAL
                    </Button>
                    <Button 
                        variant="secondary" 
                        className="w-full justify-center h-12 bg-white border border-sys-200 text-sys-600 font-black rounded-xl hover:bg-sys-100"
                        onClick={() => { onSelect(null); onClose(); }}
                    >
                        <User size={18} className="mr-2"/> CONSUMIDOR FINAL (ANÓNIMO)
                    </Button>
                </div>
            </>
        )}

        {/* ================================================= */}
        {/* VISTA 2: FORMULARIO EVENTUAL */}
        {/* ================================================= */}
        {view === 'create' && (
            <>
                {/* ZONA SCROLLABLE (SOLO INPUTS) */}
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 text-blue-900 text-xs flex gap-3">
                        <FileText size={20} className="shrink-0 text-blue-600"/>
                        <p className="font-medium leading-relaxed">
                            <span className="font-black">MODO EVENTUAL:</span> Este cliente se usará solo para esta venta. No se guardará en la agenda.
                        </p>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-1 space-y-1.5">
                            <label className="text-[10px] font-black text-sys-500 uppercase tracking-widest ml-1">Tipo Doc</label>
                            <select 
                                className="w-full p-3 bg-sys-50 border-2 border-sys-100 rounded-xl text-sm font-bold outline-none focus:border-brand transition-all"
                                value={tempClient.docType}
                                onChange={(e) => setTempClient({...tempClient, docType: e.target.value})}
                            >
                                <option value="80">CUIT</option>
                                <option value="96">DNI</option>
                            </select>
                        </div>
                        <div className="col-span-2 space-y-1.5">
                            <label className="text-[10px] font-black text-sys-500 uppercase tracking-widest ml-1">Número</label>
                            <input 
                                type="text" 
                                inputMode="numeric"
                                pattern="[0-9]*"
                                autoFocus
                                className="w-full p-3 bg-sys-50 border-2 border-sys-100 rounded-xl text-sm font-black outline-none focus:border-brand transition-all shadow-inner"
                                placeholder="Solo números"
                                value={tempClient.docNumber}
                                onChange={(e) => {
                                    const val = e.target.value.replace(/[^0-9]/g, '');
                                    setTempClient({...tempClient, docNumber: val});
                                }}
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-sys-500 uppercase tracking-widest ml-1">Nombre / Razón Social</label>
                        <input 
                            type="text" 
                            className="w-full p-3 bg-sys-50 border-2 border-sys-100 rounded-xl text-sm font-black outline-none focus:border-brand transition-all uppercase shadow-inner"
                            placeholder="Ej: JUAN PEREZ"
                            value={tempClient.name}
                            onChange={(e) => setTempClient({...tempClient, name: e.target.value})}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-sys-500 uppercase tracking-widest ml-1">Condición Fiscal</label>
                        <div className="grid grid-cols-1 gap-2">
                            {FISCAL_OPTIONS.map(opt => (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => setTempClient({...tempClient, fiscalCondition: opt.id})}
                                    className={cn(
                                        "flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all text-xs font-black uppercase tracking-tight text-left",
                                        tempClient.fiscalCondition === opt.id 
                                            ? "bg-brand/10 border-brand text-brand shadow-sm" 
                                            : "bg-white border-sys-100 text-sys-500 hover:border-sys-200"
                                    )}
                                >
                                    {opt.label}
                                    {tempClient.fiscalCondition === opt.id && <Scale size={16} />}
                                </button>
                            ))}
                        </div>
                    </div>
                    
                    {/* Espaciador final para que no quede pegado */}
                    <div className="h-4"></div>
                </div>

                {/* ZONA FIJA DEL BOTÓN (FOOTER) */}
                <div className="p-5 border-t border-sys-100 bg-white shrink-0">
                    {tempClient.fiscalCondition === 'RESPONSABLE_INSCRIPTO' && (
                        <div className="mb-3 flex items-center gap-2 text-blue-600 bg-blue-50 p-2 rounded-lg border border-blue-200 justify-center">
                            <ShieldAlert size={16} />
                            <span className="text-[9px] font-black uppercase tracking-widest">Atención: Generará Factura A</span>
                        </div>
                    )}
                    
                    <Button 
                        onClick={handleSelectTemp}
                        disabled={!tempClient.docNumber || tempClient.name.length < 3}
                        className="w-full h-14 justify-center text-lg font-black uppercase tracking-widest shadow-xl shadow-brand/20 active:scale-95 transition-all bg-brand hover:bg-brand-dark text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Check size={24} className="mr-2" strokeWidth={3}/> USAR PARA FACTURAR
                    </Button>
                </div>
            </>
        )}

      </div>
      <style>{`
        input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
};