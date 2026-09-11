import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { db as localDb } from '../../../database/db'; 
import { db as firestoreDb } from '../../../database/firebase'; 
import { collection, getDocs } from 'firebase/firestore';
import { Building2, Check, ChevronDown, Store, RefreshCw, Lock } from 'lucide-react'; // Importamos Lock
import { Menu } from '@headlessui/react';
import { cn } from '../../../core/utils/cn';

export const BranchSelector = () => {
    const { user, activeBranchId, switchBranch } = useAuthStore();
    const [branches, setBranches] = useState([]);
    const [loading, setLoading] = useState(true);

    // Determinamos si el usuario está bloqueado en una sucursal.
    // 🔥 FIX: un OWNER nunca se bloquea, sin importar qué tenga en branchId —
    // puede venir de una cuenta migrada de ADMIN a OWNER a mano en Firebase (el
    // campo branchId queda con el valor viejo) o de la config inicial de registro.
    // El bloqueo es exclusivo de roles fijados a una sucursal (CAJERO/ADMIN).
    const isLocked = !!user?.branchId && user?.role !== 'OWNER';

    useEffect(() => {
        const loadBranches = async () => {
            if (!user?.companyId) return;
            
            try {
                let all = await localDb.branches.toArray();

                // 🔥 FIX: antes solo se refrescaba desde la nube cuando Dexie estaba
                // vacío — así, cualquier sucursal creada DESPUÉS del primer login de un
                // dispositivo quedaba invisible para siempre en ese dispositivo. La
                // colección de sucursales es chica (unas pocas por empresa), así que no
                // hay costo real en refrescarla siempre que haya internet.
                if (navigator.onLine) {
                    try {
                        const querySnapshot = await getDocs(collection(firestoreDb, 'companies', user.companyId, 'branches'));
                        const cloudBranches = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                        if (cloudBranches.length > 0) {
                            all = cloudBranches;
                            await localDb.branches.bulkPut(all);
                        }
                    } catch (e) {
                        console.warn("No se pudo refrescar sucursales desde la nube, uso el cache local:", e);
                    }
                }

                setBranches(all);
                
                // Lógica de Auto-Selección
                if (all.length > 0) {
                    // Si el usuario está bloqueado, forzamos su sucursal si aún no está en el estado activo
                    if (isLocked) {
                        if (activeBranchId !== user.branchId) {
                            const myBranch = all.find(b => b.id === user.branchId);
                            if (myBranch) switchBranch(myBranch.id, myBranch.name);
                        }
                    } 
                    // Si es Owner y no ha seleccionado nada
                    else if (!activeBranchId) {
                        switchBranch(all[0].id, all[0].name);
                    }
                }
            } catch (e) {
                console.error("Error cargando sucursales:", e);
            } finally {
                setLoading(false);
            }
        };
        loadBranches();
    }, [user?.companyId, isLocked, activeBranchId]); 

    const currentBranch = branches.find(b => b.id === activeBranchId);
    
    if (!user?.companyId) return null;

    // 🔒 VISTA BLOQUEADA PARA CAJEROS/ADMINS DE SUCURSAL
    if (isLocked) {
        return (
            <div className="flex items-center gap-3 bg-sys-50 border border-sys-200 px-4 py-2 rounded-xl w-64 shadow-sm opacity-90 cursor-not-allowed">
                 <div className="w-8 h-8 rounded-lg bg-sys-200 text-sys-500 flex items-center justify-center shrink-0">
                    <Lock size={16} />
                </div>
                <div className="text-left truncate flex-1">
                    <p className="text-[10px] uppercase font-bold text-sys-400 tracking-wider">Sucursal Asignada</p>
                    <p className="text-sm font-bold text-sys-800 truncate">
                        {loading ? 'Cargando...' : (currentBranch?.name || 'Mi Sucursal')}
                    </p>
                </div>
            </div>
        );
    }

    // 🔓 VISTA PICKER PARA OWNERS/GLOBAL ADMINS
    return (
        <div className="relative z-50">
            <Menu as="div" className="relative inline-block text-left">
                <Menu.Button className="flex items-center gap-3 bg-white hover:bg-sys-50 border border-sys-200 shadow-sm px-4 py-2 rounded-xl transition-all w-64 justify-between group focus:ring-2 focus:ring-brand/20 outline-none">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-lg transition-colors",
                            loading ? "bg-sys-200" : "bg-brand text-white shadow-brand/20"
                        )}>
                            {loading ? <RefreshCw className="animate-spin text-sys-500" size={16}/> : <Building2 size={18} />}
                        </div>
                        <div className="text-left truncate">
                            <p className="text-[10px] uppercase font-bold text-sys-400 tracking-wider">Sucursal Activa</p>
                            <p className="text-sm font-bold text-sys-900 truncate">
                                {loading ? 'Sincronizando...' : (currentBranch?.name || 'Seleccionar...')}
                            </p>
                        </div>
                    </div>
                    <ChevronDown size={16} className="text-sys-400 group-hover:text-sys-600 transition-colors" />
                </Menu.Button>

                <Menu.Items className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-2xl border border-sys-100 p-2 focus:outline-none origin-top-right animate-in fade-in zoom-in-95 z-[60]">
                    <div className="px-3 py-2 text-xs font-bold text-sys-400 uppercase tracking-wider border-b border-sys-50 mb-1 flex justify-between items-center">
                        <span>Disponibles ({branches.length})</span>
                        {!navigator.onLine && <span className="text-[9px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded border border-red-100">OFFLINE</span>}
                    </div>
                    
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar space-y-1">
                        {branches.map((branch) => (
                            <Menu.Item key={branch.id}>
                                {({ active }) => (
                                    <button
                                        onClick={() => switchBranch(branch.id, branch.name)}
                                        className={cn(
                                            "w-full flex items-center justify-between p-3 rounded-xl text-sm font-medium transition-all",
                                            activeBranchId === branch.id 
                                                ? "bg-brand/5 text-brand border border-brand/10 shadow-sm" 
                                                : active ? "bg-sys-50 text-sys-900" : "text-sys-600"
                                        )}
                                    >
                                        <div className="flex items-center gap-3">
                                            <Store size={18} className={activeBranchId === branch.id ? 'fill-brand/20 stroke-brand' : 'stroke-sys-400'}/>
                                            <span className="truncate">{branch.name}</span>
                                        </div>
                                        {activeBranchId === branch.id && <Check size={16} className="text-brand" />}
                                    </button>
                                )}
                            </Menu.Item>
                        ))}
                        
                        {branches.length === 0 && !loading && (
                            <div className="p-6 text-center text-sys-400 flex flex-col items-center gap-2">
                                <Building2 size={24} className="opacity-50" />
                                <span className="text-xs">No se encontraron sucursales.</span>
                            </div>
                        )}
                    </div>
                </Menu.Items>
            </Menu>
        </div>
    );
};