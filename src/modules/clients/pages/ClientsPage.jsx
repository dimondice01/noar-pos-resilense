import React, { useEffect, useRef, useState } from 'react';
import { Plus, Search, Edit2, Trash2, Users, CreditCard, ChevronRight, AlertCircle, Phone, Mail, Loader2, ShieldCheck } from 'lucide-react';
import { clientRepository } from '../repositories/clientRepository';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { ClientModal } from '../components/ClientModal';
import { RecalculateBalancesModal } from '../components/RecalculateBalancesModal';
import { ClientDashboard } from './ClientDashboard';
import { cn } from '../../../core/utils/cn';
import { useAuthStore } from '../../auth/store/useAuthStore';
import toast from 'react-hot-toast';

export const ClientsPage = () => {
  const { user } = useAuthStore();
  const isSuperUser = user?.role === 'ADMIN' || user?.role === 'OWNER';
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Navigation State (Router interno)
  const [selectedClientId, setSelectedClientId] = useState(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [isRecalcOpen, setIsRecalcOpen] = useState(false);

  // 🔥 GUARD ANTI-CARRERA: loadClients() se dispara desde varios lugares
  // (montaje, listener de sync, búsqueda vacía) casi al mismo tiempo. Sin esto,
  // una llamada que arranca antes pero tarda más (por la auto-sanación, que
  // hace round-trips de red) puede resolver DESPUÉS de una más rápida y
  // pisarle el resultado con datos viejos — el síntoma era "solo veo 1 de 2
  // clientes" de forma intermitente. Solo se aplica el resultado de la
  // invocación más reciente; cualquier respuesta más vieja que llegue tarde
  // se descarta.
  const loadRequestId = useRef(0);

  // Carga Inicial & Auto-Sanación
  const loadClients = async () => {
    const requestId = ++loadRequestId.current;
    try {
      setLoading(true);
      const data = await clientRepository.getAll();

      // 🔥 RUTINA DE AUTO-SANACIÓN SILENCIOSA
      if (navigator.onLine && user?.companyId) {
          const pendingClients = data.filter(c => c.syncStatus === 'pending');
          if (pendingClients.length > 0) {
              console.log(`[Auto-Heal] Empujando ${pendingClients.length} clientes locales a Firebase...`);
              const { doc, setDoc } = await import('firebase/firestore');
              const { db: firestoreDB } = await import('../../../database/firebase');
              const { getDB } = await import('../../../database/db');
              const dbLocal = await getDB();

              const batchPromesas = pendingClients.map(async (client) => {
                  try {
                      const cloudId = String(client.firestoreId || client.id);
                      const { syncStatus, localId, id, ...cleanClient } = client;
                      const docRef = doc(firestoreDB, `companies/${user.companyId}/clients`, cloudId);

                      await setDoc(docRef, {
                          ...cleanClient,
                          firestoreId: cloudId,
                          updatedAt: new Date().toISOString(),
                          syncStatus: 'synced'
                      }, { merge: true });

                      await dbLocal.clients.update(client.id, { syncStatus: 'synced', firestoreId: cloudId });
                  } catch (err) { console.error("Auto-Heal Client Error:", err); }
              });
              Promise.all(batchPromesas); // Background push
          }
      }

      if (requestId === loadRequestId.current) setClients(data);
    } catch (error) {
      console.error("Error cargando clientes:", error);
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadClients();

    if (!user?.companyId) return;
    let unsub = null;

    const setupListener = async () => {
      const { collection, query, where, onSnapshot } = await import('firebase/firestore');
      const { db: firestoreDB } = await import('../../../database/firebase');
      const { getDB } = await import('../../../database/db');

      const liveStart = new Date(); liveStart.setHours(0, 0, 0, 0);
      const liveQ = query(
        collection(firestoreDB, `companies/${user.companyId}/clients`),
        where('updatedAt', '>=', liveStart.toISOString())
      );

      unsub = onSnapshot(liveQ, async (snap) => {
        if (snap.empty) return;
        const dbLocal = await getDB();
        const pendingSet = new Set(
          (await dbLocal.clients.where('syncStatus').equals('pending').toArray())
            .map(c => String(c.id))
        );
        const incoming = snap.docs
          .filter(d => !pendingSet.has(d.id))
          .map(d => ({ ...d.data(), id: d.id, firestoreId: d.id, syncStatus: 'synced' }));
        if (incoming.length > 0) {
          await dbLocal.clients.bulkPut(incoming);
          window.dispatchEvent(new CustomEvent('noar:clients-synced'));
        }
      }, (err) => console.warn('[Clients Listener]', err.code));
    };

    setupListener();
    return () => { if (unsub) unsub(); };
  }, [user?.companyId]);

  useEffect(() => {
    const handler = () => loadClients();
    window.addEventListener('noar:clients-synced', handler);
    return () => window.removeEventListener('noar:clients-synced', handler);
  }, []);

  // Búsqueda en tiempo real (Debounced)
  useEffect(() => {
    const timer = setTimeout(async () => {
        if (!searchTerm) {
            loadClients();
            return;
        }
        const results = await clientRepository.search(searchTerm);
        setClients(results);
    }, 300); 
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const handleSave = async (clientData) => {
    try {
        await clientRepository.save(clientData);
        loadClients();
        setIsModalOpen(false);
        toast.success("Cliente guardado correctamente");
    } catch (error) {
        toast.error(error.message);
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation(); 
    if (confirm("¿Estás seguro de eliminar este cliente? Se perderá su historial.")) {
        try {
            await clientRepository.delete(id);
            loadClients();
            toast.success("Cliente eliminado");
        } catch (error) {
            toast.error(error.message);
        }
    }
  };

  const handleEdit = (client, e) => {
    e.stopPropagation(); 
    setEditingClient(client);
    setIsModalOpen(true);
  };

  const getConditionBadge = (condition) => {
      const styles = {
          'RESPONSABLE_INSCRIPTO': 'bg-purple-100 text-purple-700 border-purple-200',
          'MONOTRIBUTO': 'bg-blue-100 text-blue-700 border-blue-200',
          'CONSUMIDOR_FINAL': 'bg-gray-100 text-gray-600 border-gray-200',
          'EXENTO': 'bg-orange-100 text-orange-700 border-orange-200'
      };
      return styles[condition] || styles['CONSUMIDOR_FINAL'];
  };

  // 🔄 RENDERIZADO CONDICIONAL: Si hay selección, mostramos el Dashboard
  if (selectedClientId) {
      return (
        <ClientDashboard 
            clientId={selectedClientId} 
            onBack={() => { setSelectedClientId(null); loadClients(); }} 
        />
      );
  }

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-300 max-w-[1600px] mx-auto p-4 md:p-6">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-sys-900 flex items-center gap-2">
              <Users className="text-brand" size={28}/> 
              Cartera de Clientes
          </h2>
          <p className="text-sys-500 text-sm mt-1">Gestión de contactos y cuentas corrientes</p>
        </div>
        
        <div className="flex items-center gap-3">
            {isSuperUser && (
                <Button
                    variant="outline"
                    onClick={() => setIsRecalcOpen(true)}
                    className="border-brand/30 text-brand bg-brand/5 hover:bg-brand hover:text-white transition-all"
                    title="Recalcular saldos de cuenta corriente desde el historial completo"
                >
                    <ShieldCheck size={18} className="mr-2" /> Actualizar Saldos
                </Button>
            )}
            <Button onClick={() => { setEditingClient(null); setIsModalOpen(true); }} className="shadow-lg shadow-brand/20">
                <Plus size={20} className="mr-2" /> Nuevo Cliente
            </Button>
        </div>
      </div>

      {/* Buscador */}
      <Card className="p-3 flex items-center gap-4 bg-white shadow-sm border border-sys-200 shrink-0">
         <Search className="text-sys-400 ml-2" size={20} />
         <input 
            type="text" 
            placeholder="Buscar por ID, Nombre, CUIT o DNI..." 
            className="flex-1 bg-transparent outline-none text-sys-800 placeholder:text-sys-400 font-bold py-1"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
         />
      </Card>

      {/* Tabla de Clientes */}
      <Card className="p-0 overflow-hidden shadow-soft border-0 flex flex-col flex-1">
        <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="bg-sys-50/80 text-sys-500 text-xs uppercase tracking-wider border-b border-sys-100 backdrop-blur-sm sticky top-0 z-10">
                        <th className="p-4 font-semibold whitespace-nowrap w-24 text-center">ID</th>
                        <th className="p-4 font-semibold whitespace-nowrap">Cliente / Razón Social</th>
                        <th className="p-4 font-semibold whitespace-nowrap">Contacto</th>
                        <th className="p-4 font-semibold whitespace-nowrap text-right">Saldo (Deuda)</th>
                        <th className="p-4 font-semibold text-right whitespace-nowrap w-32">Acciones</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-sys-100 bg-white">
                    {loading ? (
                        <tr>
                            <td colSpan="5" className="p-10 text-center">
                                <div className="flex flex-col items-center justify-center text-sys-400 font-bold animate-pulse">
                                    <Loader2 size={32} className="animate-spin mb-2 text-brand"/>
                                    CARGANDO CARTERA...
                                </div>
                            </td>
                        </tr>
                    ) : clients.length === 0 ? (
                        <tr>
                            <td colSpan="5" className="p-12 text-center">
                                <div className="flex flex-col items-center justify-center text-sys-300">
                                    <Users size={48} className="mb-4 opacity-20"/>
                                    <p className="font-bold text-sys-500">No se encontraron clientes.</p>
                                    <Button variant="link" onClick={() => { setEditingClient(null); setIsModalOpen(true); }} className="text-brand mt-2">
                                        + Crear el primero
                                    </Button>
                                </div>
                            </td>
                        </tr>
                    ) : (
                        clients.map(client => (
                            <tr 
                                key={client.localId || client.id} 
                                onClick={() => setSelectedClientId(client.id)} 
                                className="group hover:bg-sys-50/40 transition-colors cursor-pointer"
                            >
                                {/* ID SECUENCIAL */}
                                <td className="p-4 text-center align-middle">
                                    <span className="bg-sys-100 text-sys-600 font-mono font-black px-2 py-1 rounded-md text-xs border border-sys-200">
                                        {client.sequentialId || '---'}
                                    </span>
                                </td>
                                
                                {/* CLIENTE */}
                                <td className="p-4 align-middle">
                                    <div className="flex items-center gap-3">
                                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center text-white font-black border group-hover:scale-105 transition-transform shadow-sm", 
                                            client.docType === '80' ? "bg-brand border-brand-dark" : "bg-sys-400 border-sys-500"
                                        )}>
                                            {client.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="font-black text-sys-900 text-sm uppercase group-hover:text-brand transition-colors">{client.name}</span>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-[10px] text-sys-500 font-mono font-bold flex items-center gap-1">
                                                    <CreditCard size={10}/> {client.docNumber || 'S/DOC'}
                                                </span>
                                                <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-black uppercase border tracking-tight", getConditionBadge(client.fiscalCondition))}>
                                                    {client.fiscalCondition?.replace(/_/g, ' ') || 'CONSUMIDOR FINAL'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                
                                {/* CONTACTO */}
                                <td className="p-4 align-middle">
                                    <div className="flex flex-col gap-1 text-xs text-sys-500 font-medium">
                                        {client.phone ? (
                                            <span className="flex items-center gap-1.5"><Phone size={12}/> {client.phone}</span>
                                        ) : (
                                            <span className="text-[10px] italic text-sys-300">Sin teléfono</span>
                                        )}
                                        {client.email && <span className="flex items-center gap-1.5"><Mail size={12}/> {client.email}</span>}
                                    </div>
                                </td>
                                
                                {/* SALDO (DEUDA) */}
                                <td className="p-4 text-right align-middle">
                                    <span className={cn(
                                        "font-black text-sm",
                                        (parseFloat(client.balance) || 0) > 0 ? "text-red-500" : "text-sys-400"
                                    )}>
                                        $ {(parseFloat(client.balance) || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                    </span>
                                    {parseFloat(client.balance) > 0 && (
                                        <span className="block text-[9px] font-bold text-red-400 uppercase mt-0.5">A cobrar</span>
                                    )}
                                </td>
                                
                                {/* ACCIONES */}
                                <td className="p-4 text-right align-middle">
                                    <div className="flex justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                                        <Button 
                                            variant="secondary"
                                            size="sm" 
                                            className="bg-white border-sys-200 text-sys-600 hover:text-brand hover:border-brand shadow-none px-2"
                                            onClick={(e) => handleEdit(client, e)}
                                            title="Editar Cliente"
                                        >
                                            <Edit2 size={14}/>
                                        </Button>
                                        <Button 
                                            size="sm" 
                                            variant="ghost"
                                            className="text-red-400 hover:text-red-600 hover:bg-red-50 shadow-none px-2"
                                            onClick={(e) => handleDelete(client.id, e)}
                                            title="Eliminar Cliente"
                                        >
                                            <Trash2 size={14}/>
                                        </Button>
                                    </div>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
        
        {/* Footer Tabla */}
        <div className="p-3 border-t border-sys-100 bg-sys-50/50 flex justify-between items-center text-xs font-bold text-sys-400">
            <span>Mostrando {clients.length} clientes</span>
        </div>
      </Card>

      <ClientModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        clientToEdit={editingClient}
        onSave={handleSave}
      />

      <RecalculateBalancesModal
        isOpen={isRecalcOpen}
        onClose={() => setIsRecalcOpen(false)}
        onApplied={loadClients}
      />
    </div>
  );
};