import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
    Truck, Search, FileText, 
    ExternalLink, ShoppingBag, Plus, 
    ArrowRight, Phone, Mail
} from 'lucide-react';
import { masterRepository } from '../../inventory/repositories/masterRepository'; 
import { useAuthStore } from '../../auth/store/useAuthStore';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import { MastersModal } from '../../inventory/components/MastersModal'; 

export const SuppliersPage = () => {
    const navigate = useNavigate();
    const { companySlug } = useParams();
    const { activeBranchName } = useAuthStore();
    
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isMastersModalOpen, setIsMastersModalOpen] = useState(false);

    const loadData = async () => {
        setLoading(true);
        try {
            const data = await masterRepository.getAll('suppliers');
            setSuppliers(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadData(); }, []);

    const filteredSuppliers = suppliers.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()));

    // Navegación Inteligente
    const goToHistory = (supplier = null) => {
        const path = `/${companySlug}/suppliers/purchases`;
        // Si hay proveedor, pasamos el filtro por state o query param si implementaste eso en el historial
        // Por ahora, asumimos que el historial puede leer el state para pre-filtrar
        navigate(path, { state: { preFilterSupplierId: supplier?.id } });
    };

    const goToNewPurchase = (supplier = null) => {
        navigate(`/${companySlug}/suppliers/purchases/new`, { 
            state: { selectedSupplier: supplier } 
        });
    };

    return (
        <div className="p-6 max-w-[1600px] mx-auto space-y-6 pb-20 h-full flex flex-col animate-in fade-in">
            
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
                <div>
                    <h1 className="text-2xl font-black text-sys-900 flex items-center gap-2">
                        <Truck className="text-brand" size={28}/> 
                        Proveedores & Gastos
                    </h1>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs font-bold text-sys-500 uppercase bg-sys-100 px-2 py-0.5 rounded">
                            {activeBranchName}
                        </span>
                    </div>
                </div>
                
                <div className="flex gap-3">
                    <Button 
                        variant="ghost" 
                        onClick={() => goToHistory()} 
                        className="text-sys-600 hover:bg-sys-100 font-bold border border-sys-200"
                    >
                        <FileText size={18} className="mr-2"/> Historial Global
                    </Button>
                    <Button 
                        onClick={() => goToNewPurchase()} 
                        className="shadow-lg shadow-brand/20 bg-brand hover:bg-brand-dark"
                    >
                        <Plus size={18} className="mr-2"/> Nueva Compra
                    </Button>
                </div>
            </div>

            {/* Barra de Búsqueda y Herramientas */}
            <Card className="p-2 flex flex-col md:flex-row gap-2 bg-sys-50 border-sys-200 shrink-0">
                <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400"/>
                    <input 
                        type="text" 
                        placeholder="Buscar proveedor por nombre o CUIT..." 
                        className="w-full pl-9 pr-3 py-2.5 bg-white border border-sys-200 rounded-lg text-sm font-bold outline-none focus:border-brand transition-all" 
                        value={searchTerm} 
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setIsMastersModalOpen(true)} className="bg-white border-sys-200 text-sys-600 font-bold">
                        <ExternalLink size={16} className="mr-2"/> Gestionar Maestros
                    </Button>
                </div>
            </Card>

            {/* Grid de Proveedores */}
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-10">
                    {loading ? (
                        <div className="col-span-full py-20 text-center text-sys-400 font-bold animate-pulse">CARGANDO PROVEEDORES...</div>
                    ) : filteredSuppliers.length === 0 ? (
                        <div className="col-span-full py-20 text-center text-sys-300 flex flex-col items-center">
                            <Truck size={48} className="mb-4 opacity-20"/>
                            <p className="font-bold">No se encontraron proveedores</p>
                            <Button variant="link" onClick={() => setIsMastersModalOpen(true)} className="text-brand mt-2">
                                + Crear el primero
                            </Button>
                        </div>
                    ) : (
                        filteredSuppliers.map(sup => (
                            <Card 
                                key={sup.id} 
                                className="group relative overflow-hidden flex flex-col hover:shadow-xl hover:border-brand/30 transition-all cursor-pointer bg-white"
                                onClick={() => goToHistory(sup)} // Al hacer click en la tarjeta, vamos a SU historial
                            >
                                <div className="p-5 pb-0 flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-xl bg-sys-50 flex items-center justify-center text-sys-600 font-black text-xl border border-sys-200 group-hover:bg-brand group-hover:text-white transition-colors shadow-sm">
                                            {sup.name.charAt(0)}
                                        </div>
                                        <div>
                                            <h3 className="font-black text-sys-900 text-lg uppercase truncate max-w-[180px] leading-tight">{sup.name}</h3>
                                            <p className="text-[10px] text-sys-400 font-mono mt-1 font-bold">{sup.taxId || 'CONSUMIDOR FINAL'}</p>
                                        </div>
                                    </div>
                                    <div className="p-2 bg-sys-50 rounded-full group-hover:bg-sys-100 transition-colors">
                                        <ArrowRight size={16} className="text-sys-400 group-hover:text-brand"/>
                                    </div>
                                </div>
                                
                                <div className="px-5 mb-4">
                                    <div className="flex gap-4 text-xs text-sys-500 font-medium">
                                        {sup.phone && <div className="flex items-center gap-1.5"><Phone size={12}/> {sup.phone}</div>}
                                        {sup.email && <div className="flex items-center gap-1.5"><Mail size={12}/> {sup.email}</div>}
                                    </div>
                                </div>

                                <div className="mt-auto border-t border-sys-100 p-3 bg-sys-50/50 flex justify-between items-center group-hover:bg-brand/5 transition-colors">
                                    <span className="text-[10px] font-bold text-sys-400 uppercase tracking-wider pl-2">Ver Movimientos</span>
                                    <Button 
                                        size="sm" 
                                        className="bg-white border border-sys-200 text-brand font-black text-xs hover:bg-brand hover:text-white hover:border-brand shadow-sm transition-all"
                                        onClick={(e) => {
                                            e.stopPropagation(); 
                                            goToNewPurchase(sup);
                                        }}
                                    >
                                        <ShoppingBag size={14} className="mr-1.5"/> + COMPRA
                                    </Button>
                                </div>
                            </Card>
                        ))
                    )}
                </div>
            </div>
            
            <MastersModal isOpen={isMastersModalOpen} onClose={() => { setIsMastersModalOpen(false); loadData(); }} />
        </div>
    );
};