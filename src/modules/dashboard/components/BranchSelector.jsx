import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { db as localDb } from '../../../database/db'; // Dexie
import { db as firestoreDb } from '../../../database/firebase'; // Firebase
import { collection, getDocs } from 'firebase/firestore';
import { Building2, Check, ChevronDown, Store, RefreshCw } from 'lucide-react';
import { Menu } from '@headlessui/react';

export const BranchSelector = () => {
    const { user, activeBranchId, switchBranch } = useAuthStore();
    const [branches, setBranches] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadBranches = async () => {
            if (!user?.companyId) return;
            
            try {
                // 1. Intentar cargar de local (Rápido)
                let all = await localDb.branches.toArray();
                
                // 2. Si está vacío (Primera carga), buscar en Nube (Lento pero seguro)
                if (all.length === 0) {
                    console.log("☁️ Bajando sucursales de la nube...");
                    const querySnapshot = await getDocs(collection(firestoreDb, 'companies', user.companyId, 'branches'));
                    all = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    
                    // Guardamos en local para la próxima
                    if (all.length > 0) {
                        await localDb.branches.bulkPut(all);
                    }
                }

                setBranches(all);
                
                // Auto-seleccionar la primera si no hay ninguna activa
                if (!activeBranchId && all.length > 0) {
                    switchBranch(all[0].id, all[0].name);
                }
            } catch (e) {
                console.error("Error cargando sucursales:", e);
            } finally {
                setLoading(false);
            }
        };
        loadBranches();
    }, [user, activeBranchId]);

    const currentBranch = branches.find(b => b.id === activeBranchId);

    return (
        <div className="relative z-50">
            <Menu as="div" className="relative inline-block text-left">
                <Menu.Button className="flex items-center gap-3 bg-white hover:bg-sys-50 border border-sys-200 shadow-sm px-4 py-2 rounded-xl transition-all w-64 justify-between group">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-8 h-8 rounded-lg bg-brand text-white flex items-center justify-center shrink-0 shadow-lg shadow-brand/20">
                            {loading ? <RefreshCw className="animate-spin" size={16}/> : <Building2 size={18} />}
                        </div>
                        <div className="text-left truncate">
                            <p className="text-[10px] uppercase font-bold text-sys-400 tracking-wider">Sucursal Activa</p>
                            <p className="text-sm font-bold text-sys-900 truncate">
                                {loading ? 'Cargando...' : (currentBranch?.name || 'Seleccionar...')}
                            </p>
                        </div>
                    </div>
                    <ChevronDown size={16} className="text-sys-400 group-hover:text-sys-600 transition-colors" />
                </Menu.Button>

                <Menu.Items className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-2xl border border-sys-100 p-2 focus:outline-none origin-top-right animate-in fade-in zoom-in-95 z-50">
                    <div className="px-3 py-2 text-xs font-bold text-sys-400 uppercase tracking-wider border-b border-sys-50 mb-1 flex justify-between">
                        <span>Disponibles ({branches.length})</span>
                    </div>
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar space-y-1">
                        {branches.map((branch) => (
                            <Menu.Item key={branch.id}>
                                {({ active }) => (
                                    <button
                                        onClick={() => switchBranch(branch.id, branch.name)}
                                        className={`w-full flex items-center justify-between p-3 rounded-xl text-sm font-medium transition-all ${
                                            activeBranchId === branch.id 
                                                ? 'bg-brand/5 text-brand border border-brand/10' 
                                                : active ? 'bg-sys-50 text-sys-900' : 'text-sys-600'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <Store size={18} className={activeBranchId === branch.id ? 'fill-brand/20' : ''}/>
                                            <span>{branch.name}</span>
                                        </div>
                                        {activeBranchId === branch.id && <Check size={16} />}
                                    </button>
                                )}
                            </Menu.Item>
                        ))}
                        {branches.length === 0 && !loading && (
                            <div className="p-4 text-center text-xs text-sys-400">
                                No se encontraron sucursales.
                            </div>
                        )}
                    </div>
                </Menu.Items>
            </Menu>
        </div>
    );
};