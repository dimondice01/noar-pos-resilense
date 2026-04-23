import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    Truck, Search, FileText,
    ExternalLink, ShoppingBag, Plus, Loader2,
    ArrowRight, Phone, Mail, Building2, User
} from 'lucide-react';
import { masterRepository } from '../../inventory/repositories/masterRepository';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import { MastersModal } from '../../inventory/components/MastersModal';
import { getDB } from '../../../database/db';
import toast from 'react-hot-toast';

export const SuppliersPage = () => {
    const navigate = useNavigate();
    const { companySlug } = useParams();
    const { activeBranchName, user } = useAuthStore();
    
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isMastersModalOpen, setIsMastersModalOpen] = useState(false);

    const loadData = async () => {
        setLoading(true);
        try {
            // 🔥 RUTINA DE AUTO-SANACIÓN SILENCIOSA
            if (navigator.onLine && user?.companyId) {
                const dbLocal = await getDB();
                const pendingSuppliers = await dbLocal.suppliers.filter(s => s.syncStatus !== 'synced').toArray();
                
                if (pendingSuppliers.length > 0) {
                    console.log(`[Auto-Heal] Empujando ${pendingSuppliers.length} proveedores locales a Firebase...`);
                    const { doc, setDoc } = await import('firebase/firestore');
                    
                    const batchPromesas = pendingSuppliers.map(async (sup) => {
                        try {
                            const cloudId = String(sup.firestoreId || sup.id);
                            const { syncStatus, localId, id, ...cleanSup } = sup;
                            const docRef = doc(firestoreDB, `companies/${user.companyId}/suppliers`, cloudId);

                            await setDoc(docRef, {
                                ...cleanSup,
                                firestoreId: cloudId,
                                updatedAt: new Date().toISOString(),
                                syncStatus: 'synced'
                            }, { merge: true });

                            await dbLocal.suppliers.update(sup.id, { syncStatus: 'synced', firestoreId: cloudId });
                        } catch (err) { console.error("Auto-Heal Supplier Error:", err); }
                    });
                    Promise.all(batchPromesas); // Background push
                }
            }

            const data = await masterRepository.getAll('suppliers');
            const sortedData = data.sort((a, b) => {
                const idA = parseInt(a.sequentialId || 0, 10);
                const idB = parseInt(b.sequentialId || 0, 10);
                return idB - idA;
            });
            setSuppliers(sortedData);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();

        if (!user?.companyId) return;
        let unsub = null;

        const setupListener = async () => {
            const { collection, query, where, onSnapshot } = await import('firebase/firestore');
            const { db: firestoreDB } = await import('../../../database/firebase');
            const { getDB } = await import('../../../database/db');

            const liveStart = new Date(); liveStart.setHours(0, 0, 0, 0);
            const liveQ = query(
                collection(firestoreDB, `companies/${user.companyId}/suppliers`),
                where('updatedAt', '>=', liveStart.toISOString())
            );

            unsub = onSnapshot(liveQ, async (snap) => {
                if (snap.empty) return;
                const dbLocal = await getDB();
                const pendingSet = new Set(
                    (await dbLocal.suppliers.where('syncStatus').equals('pending').toArray())
                        .map(s => String(s.id))
                );
                const incoming = snap.docs
                    .filter(d => !pendingSet.has(d.id))
                    .map(d => ({ ...d.data(), id: d.id, firestoreId: d.id, syncStatus: 'synced' }));
                if (incoming.length > 0) {
                    await dbLocal.suppliers.bulkPut(incoming);
                    window.dispatchEvent(new CustomEvent('noar:suppliers-synced'));
                }
            }, (err) => console.warn('[Suppliers Listener]', err.code));
        };

        setupListener();
        return () => { if (unsub) unsub(); };
    }, [user?.companyId]);

    useEffect(() => {
        const handler = () => loadData();
        window.addEventListener('noar:suppliers-synced', handler);
        return () => window.removeEventListener('noar:suppliers-synced', handler);
    }, []);

    const filteredSuppliers = suppliers.filter(s => 
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        (s.sequentialId && s.sequentialId.includes(searchTerm)) ||
        (s.docNumber && s.docNumber.includes(searchTerm))
    );

    // 🔥 NAVEGACIÓN INTELIGENTE
    // Ahora hacer click en la fila te lleva al Dashboard del Proveedor
    const goToDashboard = (supplierId) => {
        navigate(`/${companySlug}/suppliers/dashboard/${supplierId}`);
    };

    const goToHistory = (supplier = null) => {
        const path = `/${companySlug}/suppliers/purchases`;
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
                        Directorio de Proveedores
                    </h1>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs font-bold text-sys-500 uppercase bg-sys-100 px-2 py-0.5 rounded">
                            {activeBranchName}
                        </span>
                        <span className="text-sys-400 text-xs">|</span>
                        <p className="text-sys-500 text-xs">Gestión de compras y cuentas corrientes</p>
                    </div>
                </div>
                
                <div className="flex flex-wrap gap-3">
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
                        placeholder="Buscar por ID, nombre o CUIT/DNI..." 
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

            {/* Tabla de Proveedores */}
            <Card className="p-0 overflow-hidden shadow-soft border-0 flex flex-col flex-1">
                <div className="overflow-x-auto flex-1">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-sys-50/80 text-sys-500 text-xs uppercase tracking-wider border-b border-sys-100 backdrop-blur-sm sticky top-0 z-10">
                                <th className="p-4 font-semibold whitespace-nowrap w-24 text-center">ID</th>
                                <th className="p-4 font-semibold whitespace-nowrap">Proveedor</th>
                                <th className="p-4 font-semibold whitespace-nowrap">Contacto</th>
                                <th className="p-4 font-semibold whitespace-nowrap text-right">Saldo (Cta Cte)</th>
                                <th className="p-4 font-semibold text-right whitespace-nowrap w-40">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-sys-100 bg-white">
                            {loading ? (
                                <tr>
                                    <td colSpan="5" className="p-10 text-center">
                                        <div className="flex flex-col items-center justify-center text-sys-400 font-bold animate-pulse">
                                            <Loader2 size={32} className="animate-spin mb-2 text-brand"/>
                                            CARGANDO DIRECTORIO...
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredSuppliers.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-12 text-center">
                                        <div className="flex flex-col items-center justify-center text-sys-300">
                                            <Truck size={48} className="mb-4 opacity-20"/>
                                            <p className="font-bold text-sys-500">No se encontraron proveedores</p>
                                            <Button variant="link" onClick={() => setIsMastersModalOpen(true)} className="text-brand mt-2">
                                                + Crear el primero
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredSuppliers.map(sup => (
                                    <tr key={sup.id} onClick={() => goToDashboard(sup.id)} className="group hover:bg-sys-50/40 transition-colors cursor-pointer">
                                        
                                        <td className="p-4 text-center align-middle">
                                            <span className="bg-sys-100 text-sys-600 font-mono font-black px-2 py-1 rounded-md text-xs border border-sys-200">
                                                {sup.sequentialId || '---'}
                                            </span>
                                        </td>
                                        
                                        <td className="p-4 align-middle">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-sys-50 flex items-center justify-center text-sys-500 font-black border border-sys-200 group-hover:bg-brand/10 group-hover:text-brand group-hover:border-brand/20 transition-colors">
                                                    {sup.name.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-black text-sys-900 text-sm uppercase group-hover:text-brand transition-colors">{sup.name}</span>
                                                    <span className="text-[10px] text-sys-400 font-mono mt-0.5 font-bold flex items-center gap-1">
                                                        <Building2 size={10}/> {sup.docNumber || 'S/CUIT'}
                                                    </span>
                                                </div>
                                            </div>
                                        </td>
                                        
                                        <td className="p-4 align-middle">
                                            <div className="flex flex-col gap-1 text-xs text-sys-500 font-medium">
                                                {sup.phone ? (
                                                    <span className="flex items-center gap-1.5"><Phone size={12}/> {sup.phone}</span>
                                                ) : (
                                                    <span className="text-[10px] italic text-sys-300">Sin teléfono</span>
                                                )}
                                                {sup.email && <span className="flex items-center gap-1.5"><Mail size={12}/> {sup.email}</span>}
                                            </div>
                                        </td>
                                        
                                        <td className="p-4 text-right align-middle">
                                            <span className={cn(
                                                "font-black text-sm",
                                                (parseFloat(sup.balance) || 0) > 0 ? "text-red-500" : "text-sys-400"
                                            )}>
                                                $ {(parseFloat(sup.balance) || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                            </span>
                                            {parseFloat(sup.balance) > 0 && (
                                                <span className="block text-[9px] font-bold text-red-400 uppercase mt-0.5">A pagar</span>
                                            )}
                                        </td>
                                        
                                        <td className="p-4 text-right align-middle">
                                            <div className="flex justify-end gap-2">
                                                <Button 
                                                    variant="secondary"
                                                    size="sm" 
                                                    className="bg-white border-sys-200 text-sys-600 hover:text-brand hover:border-brand shadow-none"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        goToHistory(sup);
                                                    }}
                                                >
                                                    <FileText size={14} className="mr-1.5"/> Historial
                                                </Button>
                                                <Button 
                                                    size="sm" 
                                                    className="bg-brand/10 text-brand border-none hover:bg-brand hover:text-white shadow-none"
                                                    onClick={(e) => {
                                                        e.stopPropagation(); 
                                                        goToNewPurchase(sup);
                                                    }}
                                                >
                                                    <ShoppingBag size={14}/>
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                
                <div className="p-3 border-t border-sys-100 bg-sys-50/50 flex justify-between items-center text-xs font-bold text-sys-400">
                    <span>Mostrando {filteredSuppliers.length} proveedores</span>
                </div>
            </Card>
            
            <MastersModal isOpen={isMastersModalOpen} onClose={() => { setIsMastersModalOpen(false); loadData(); }} />
        </div>
    );
};