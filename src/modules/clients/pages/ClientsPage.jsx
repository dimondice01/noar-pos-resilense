import React, { useEffect, useState } from 'react';
import { Plus, Search, Edit2, Trash2, Users, CreditCard, Building2, User, ChevronRight } from 'lucide-react';
import { clientRepository } from '../repositories/clientRepository';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { ClientModal } from '../components/ClientModal';
import { ClientDashboard } from './ClientDashboard'; // ✅ Importamos el Dashboard
import { cn } from '../../../core/utils/cn';

export const ClientsPage = () => {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Navigation State (Router interno)
  const [selectedClientId, setSelectedClientId] = useState(null); 

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);

  // Carga Inicial
  const loadClients = async () => {
    try {
      const data = await clientRepository.getAll();
      setClients(data);
    } catch (error) {
      console.error("Error cargando clientes:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadClients(); }, []);

  // Búsqueda en tiempo real
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
    await clientRepository.save(clientData);
    loadClients();
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation(); // Evitar abrir el dashboard
    if (confirm("¿Estás seguro de eliminar este cliente?")) {
        await clientRepository.delete(id);
        loadClients();
    }
  };

  const handleEdit = (client, e) => {
    e.stopPropagation(); // Evitar abrir el dashboard
    setEditingClient(client);
    setIsModalOpen(true);
  };

  const getConditionBadge = (condition) => {
      const styles = {
          'RESPONSABLE_INSCRIPTO': 'bg-purple-100 text-purple-700 border-purple-200',
          'MONOTRIBUTO': 'bg-blue-100 text-brand border-blue-200',
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
    <div className="space-y-6 pb-20 animate-in fade-in duration-300">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold text-sys-900">Cartera de Clientes</h2>
          <p className="text-sys-500">Gestión de contactos y cuentas corrientes</p>
        </div>
        <Button onClick={() => { setEditingClient(null); setIsModalOpen(true); }} className="shadow-lg shadow-brand/20">
            <Plus size={20} className="mr-2" /> Nuevo Cliente
        </Button>
      </div>

      {/* Buscador */}
      <Card className="p-4 flex items-center gap-4 bg-white shadow-sm border border-sys-100">
         <Search className="text-sys-400" size={20} />
         <input 
            type="text" 
            placeholder="Buscar por Nombre, CUIT o DNI..." 
            className="flex-1 bg-transparent outline-none text-sys-800 placeholder:text-sys-400"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
         />
      </Card>

      {/* Lista de Clientes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
            <p className="text-sys-500 col-span-full text-center py-10">Cargando cartera...</p>
        ) : clients.length === 0 ? (
            <div className="col-span-full text-center py-12 text-sys-400 bg-sys-50/50 rounded-2xl border-2 border-dashed border-sys-200">
                <Users size={48} className="mx-auto mb-3 opacity-50" />
                <p>No se encontraron clientes.</p>
            </div>
        ) : (
            clients.map(client => (
                <Card 
                    key={client.id} 
                    className="p-0 overflow-hidden hover:shadow-float transition-all duration-300 group border border-sys-200 cursor-pointer relative"
                    onClick={() => setSelectedClientId(client.id)}
                >
                    <div className="p-5">
                        <div className="flex justify-between items-start mb-3">
                            <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-sm transition-transform group-hover:scale-110", 
                                client.docType === '80' ? "bg-brand" : "bg-sys-400"
                            )}>
                                {client.name.charAt(0)}
                            </div>
                            <span className={cn("px-2 py-1 rounded text-[10px] font-bold uppercase border", getConditionBadge(client.fiscalCondition))}>
                                {client.fiscalCondition.replace('_', ' ')}
                            </span>
                        </div>
                        
                        <h3 className="font-bold text-sys-900 truncate pr-6" title={client.name}>{client.name}</h3>
                        
                        <div className="mt-3 space-y-1.5">
                            <div className="flex items-center gap-2 text-xs text-sys-600">
                                <CreditCard size={14} className="text-sys-400" />
                                <span className="font-mono tracking-wide">{client.docNumber}</span>
                            </div>
                            {client.address && (
                                <div className="flex items-center gap-2 text-xs text-sys-500 truncate">
                                    <Building2 size={14} className="text-sys-400" />
                                    {client.address}
                                </div>
                            )}
                        </div>

                        {/* Indicador de Deuda (Si existe) */}
                        {(client.balance && client.balance > 0) ? (
                            <div className="mt-4 pt-3 border-t border-sys-100 flex justify-between items-center">
                                <span className="text-[10px] font-bold text-red-500 uppercase tracking-wider">Deuda Pendiente</span>
                                <span className="text-sm font-black text-red-600">$ {client.balance.toLocaleString()}</span>
                            </div>
                        ) : (
                            <div className="mt-4 pt-3 border-t border-sys-100 flex justify-end">
                                <span className="text-[10px] font-bold text-green-600 uppercase tracking-wider flex items-center gap-1">
                                    Al Día <ChevronRight size={12}/>
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Acciones Rápidas (Hover) */}
                    <div className="absolute top-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 backdrop-blur-sm rounded-lg p-1 shadow-sm border border-sys-100">
                        <button onClick={(e) => handleEdit(client, e)} className="p-1.5 hover:bg-sys-100 rounded text-sys-600 transition-colors" title="Editar">
                            <Edit2 size={14} />
                        </button>
                        <button onClick={(e) => handleDelete(client.id, e)} className="p-1.5 hover:bg-red-50 rounded text-red-500 transition-colors" title="Eliminar">
                            <Trash2 size={14} />
                        </button>
                    </div>
                </Card>
            ))
        )}
      </div>

      <ClientModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        clientToEdit={editingClient}
        onSave={handleSave}
      />
    </div>
  );
};