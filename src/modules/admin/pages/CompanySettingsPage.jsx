import React, { useState, useEffect } from 'react';
import { Camera, Save, Store, FileText, MapPin, Hash, Calendar, AlertTriangle, Info, Banknote } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../../database/firebase'; 
import { getDB } from '../../../database/db'; // 🔥 IMPORTAMOS DEXIE
import { useAuthStore } from '../../auth/store/useAuthStore';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn'; // 🔥 AÑADIDA: Importación faltante
import toast from 'react-hot-toast';

export const CompanySettingsPage = () => {
    const { user, activeBranchId, activeBranchName } = useAuthStore();
    
    // Estado inicial completo para evitar uncontrolled inputs
    const [branchData, setBranchData] = useState({ 
        name: '',           // Nombre de Fantasía
        logoBase64: null,   // 🔥 Logo en memoria local
        razonSocial: '',    // Razón Social
        cuit: '',           // CUIT 
        iibb: '',           // IIBB
        inicioAct: '',      // Inicio Actividades
        address: '',        // Dirección 
        taxCondition: 'CONSUMIDOR FINAL',
        transferAlias: '',  // 🏦 Alias para transferencias
        transferAccountName: '' // 🏦 Titular de cuenta
    });
    
    const [loading, setLoading] = useState(false);
    const [loadingData, setLoadingData] = useState(true);

    // =================================================================
    // 🔥 HELPER: Convertir Imagen a Base64 (Local First)
    // =================================================================
    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Validación de tamaño (Max 1MB para no saturar Firestore/Dexie)
        if (file.size > 1024 * 1024) {
            toast.error("La imagen es muy grande. Máximo 1MB.");
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            // Guardamos el Base64 en el estado
            setBranchData(prev => ({ ...prev, logoBase64: reader.result }));
        };
        reader.readAsDataURL(file);
    };

    // =================================================================
    // 1. CARGAR DATOS (Estrategia: Dexie > Firebase > Company Fallback)
    // =================================================================
    const [noBranchSetup, setNoBranchSetup] = useState(false);

    useEffect(() => {
        if (!user?.companyId) return;
        
        const fetchConfig = async () => {
            setLoadingData(true);
            try {
                const dbLocal = await getDB();
                
                // 🔍 Verificamos si la empresa ya tiene sucursales
                const localBranches = await dbLocal.branches.where('companyId').equals(user.companyId).toArray();
                
                if (localBranches.length === 0 && (!activeBranchId || activeBranchId === 'ALL')) {
                    setNoBranchSetup(true);
                    setLoadingData(false);
                    return;
                }

                setNoBranchSetup(false);
                const currentBranchId = activeBranchId || (localBranches.length > 0 ? localBranches[0].id : null);
                
                if (!currentBranchId) {
                    setNoBranchSetup(true); // Fallback por si acaso
                    setLoadingData(false);
                    return;
                }

                const cacheKey = `SALVADOR_BRANCH_CONFIG_${currentBranchId}`;
                const cachedData = localStorage.getItem(cacheKey);
                if (cachedData) setBranchData(prev => ({ ...prev, ...JSON.parse(cachedData) }));

                // Leemos Firebase
                const companyRef = doc(db, 'companies', user.companyId);
                const companySnap = await getDoc(companyRef);
                const companyData = companySnap.exists() ? companySnap.data() : {};

                const branchRef = doc(db, 'companies', user.companyId, 'branches', currentBranchId);
                const branchSnap = await getDoc(branchRef);
                const bData = branchSnap.exists() ? branchSnap.data() : {};

                const payload = {
                    name: bData.name || (activeBranchId === 'ALL' ? 'Sucursal Principal' : activeBranchName),
                    logoBase64: bData.logoBase64 || bData.logoUrl || companyData.logoUrl || null,
                    razonSocial: companyData.razonSocial || '',
                    cuit: companyData.cuit || '',
                    taxCondition: companyData.taxCondition || 'CONSUMIDOR FINAL',
                    iibb: companyData.iibb || '',
                    inicioAct: companyData.inicioAct || '',
                    address: bData.address || companyData.address || '',
                    transferAlias: bData.transferAlias || '',
                    transferAccountName: bData.transferAccountName || ''
                };

                setBranchData(prev => ({ ...prev, ...payload }));
                localStorage.setItem(cacheKey, JSON.stringify(payload)); 
                
            } catch (error) {
                console.error("Error cargando configuración:", error);
            } finally {
                setLoadingData(false);
            }
        };
        
        fetchConfig();
    }, [user?.companyId, activeBranchId]);

    // =================================================================
    // 2. GUARDAR CONFIGURACIÓN 
    // =================================================================
    const handleSave = async (e) => {
        e.preventDefault();
        setLoading(true);
        const { switchBranch } = useAuthStore.getState();

        try {
            const localDb = await getDB();
            
            // 🔥 DETERMINAR ID DE SUCURSAL (Si no hay una activa, generamos la PRIMERA)
            let branchId = activeBranchId;
            if (!branchId || branchId === 'ALL') {
                const currentBranches = await localDb.branches.where('companyId').equals(user.companyId).toArray();
                if (currentBranches.length > 0) branchId = currentBranches[0].id;
                else branchId = `br_${Date.now()}`; // Generamos ID para la primera sucursal
            }

            const timestamp = new Date().toISOString();
            const payload = {
                ...branchData,
                updatedAt: timestamp
            };

            // A. Guardar en Firebase (Sucursal)
            const branchRef = doc(db, 'companies', user.companyId, 'branches', branchId);
            await setDoc(branchRef, {
                id: branchId,
                companyId: user.companyId,
                name: payload.name,
                address: payload.address,
                logoBase64: payload.logoBase64 || null,
                transferAlias: payload.transferAlias || '',
                transferAccountName: payload.transferAccountName || '',
                updatedAt: timestamp
            }, { merge: true });

            // B. Guardar en Firebase (Master de Empresa - Datos Fiscales)
            const companyRef = doc(db, 'companies', user.companyId);
            await setDoc(companyRef, {
                razonSocial: payload.razonSocial,
                cuit: payload.cuit,
                taxCondition: payload.taxCondition,
                iibb: payload.iibb,
                inicioAct: payload.inicioAct,
                logoUrl: payload.logoBase64 || null, // El logo de empresa por defecto es el de la sucursal 1
                updatedAt: timestamp
            }, { merge: true });

            // C. Guardar en Dexie (Sucursal)
            await localDb.branches.put({
                id: branchId,
                companyId: user.companyId,
                name: payload.name,
                address: payload.address,
                updatedAt: timestamp
            });

            // D. Info para el Sidebar
            await localDb.config.put({
                key: 'company_info',
                value: {
                    name: payload.name,
                    logoUrl: payload.logoBase64 || null,
                    updatedAt: timestamp
                }
            });

            // 🔥 E. PERSISTENCIA PARA MODAL DE PAGO (Transferencia/Ahorro) Y TICKETS
            await localDb.config.put({
                key: `branch_config_${branchId}`,
                value: {
                    name: payload.name,
                    address: payload.address,
                    logoBase64: payload.logoBase64 || null,
                    transferAlias: payload.transferAlias || '',
                    transferAccountName: payload.transferAccountName || '',
                    razonSocial: payload.razonSocial || '',
                    cuit: payload.cuit || '',
                    taxCondition: payload.taxCondition || '',
                    iibb: payload.iibb || '',
                    inicioAct: payload.inicioAct || '',
                    updatedAt: timestamp
                }
            });

            localStorage.setItem(`SALVADOR_BRANCH_CONFIG_${branchId}`, JSON.stringify(payload));
            
            toast.success(noBranchSetup ? "¡Sucursal creada correctamente!" : "Configuración guardada.");
            
            // E. Si era la primera sucursal, ACTIVARLA automáticamente
            if (noBranchSetup) {
                switchBranch(branchId, payload.name);
                setNoBranchSetup(false);
            }

        } catch (error) {
            console.error("Error al guardar:", error);
            toast.error('Error al guardar. Verifique su conexión.');
        } finally {
            setLoading(false);
        }
    };

    if (loadingData) {
        return <div className="p-10 text-center text-sys-400 animate-pulse font-bold">Iniciando Centro de Control...</div>;
    }

    return (
        <div className="p-6 max-w-4xl mx-auto pb-20 animate-in fade-in duration-500 bg-sys-50 rounded-3xl min-h-[80vh] border border-border-default shadow-sm">
            
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-black text-sys-900 flex items-center gap-3">
                        <div className={cn("p-2 rounded-lg shadow-lg", noBranchSetup ? "bg-green-600 shadow-green-900/20" : "bg-blue-600 shadow-blue-900/20")}>
                            {noBranchSetup ? <Store size={22} className="text-white animate-bounce" /> : <Store size={22} className="text-white" />}
                        </div>
                        {noBranchSetup ? 'Configura tu primera Sucursal' : 'Configuración de Sucursal'}
                    </h1>
                    <div className="flex items-center gap-2 mt-3">
                        <span className="text-sys-500 text-xs font-bold uppercase tracking-widest">
                            {noBranchSetup ? 'Paso Necesario' : 'Sucursal Activa:'}
                        </span>
                        <span className={cn("px-4 py-1.5 rounded-xl text-xs font-black border flex items-center gap-2 shadow-sm", 
                            noBranchSetup ? "bg-green-600/10 text-green-700 border-green-500/20" : "bg-blue-600/10 text-blue-700 border-blue-500/20"
                        )}>
                            <MapPin size={12} className={noBranchSetup ? "text-green-600" : "text-blue-600"}/> 
                            {noBranchSetup ? 'NUEVA CONFIGURACIÓN' : (activeBranchId === 'ALL' ? 'Sucursal Principal' : activeBranchName)}
                        </span>
                    </div>
                </div>
            </div>

            <form onSubmit={handleSave} className="space-y-6">
                
                {/* 1. IDENTIDAD VISUAL */}
                <Card className="bg-white border-border-default p-6 shadow-sm">
                    <h3 className="text-sys-700 font-bold mb-6 flex items-center gap-2 border-b border-border-subtle pb-2">
                        <Camera size={18} className="text-blue-600"/> Identidad Visual
                    </h3>
                    
                    <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
                        {/* Logo Upload (BASE64) */}
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-32 h-32 rounded-full bg-sys-50 overflow-hidden flex items-center justify-center border-4 border-border-subtle shadow-sm relative group transition-all hover:border-blue-500">
                                {branchData.logoBase64 ? (
                                    <img src={branchData.logoBase64} className="w-full h-full object-contain p-2" alt="Logo de la Empresa" />
                                ) : (
                                    <Camera size={40} className="text-sys-300 group-hover:text-blue-500 transition-colors" />
                                )}
                                
                                <label htmlFor="logo-upload" className="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center text-[10px] font-black text-white cursor-pointer transition-all uppercase tracking-wider text-center p-2">
                                    CAMBIAR LOGO
                                </label>
                                <input 
                                    type="file" 
                                    accept="image/jpeg, image/png"
                                    id="logo-upload"
                                    className="hidden"
                                    onChange={handleImageUpload}
                                />
                            </div>
                            <p className="text-[10px] text-sys-400 font-medium font-mono uppercase">JPG/PNG (Max 1MB)</p>
                            {branchData.logoBase64 && (
                                <button type="button" onClick={() => setBranchData({...branchData, logoBase64: null})} className="text-[10px] text-red-500 hover:text-red-600 font-bold uppercase tracking-widest mt-1">
                                    Eliminar Logo
                                </button>
                            )}
                        </div>

                        {/* Nombre */}
                        <div className="flex-1 w-full space-y-4">
                            <div>
                                <label className="block text-sys-500 text-xs font-bold mb-1.5 uppercase tracking-wide">Nombre de Fantasía</label>
                                <input 
                                    type="text" 
                                    className="w-full bg-sys-50 border border-border-default rounded-lg p-3 text-sys-900 focus:border-blue-500 focus:bg-white outline-none transition-all"
                                    placeholder={`Ej: ${activeBranchName}`}
                                    value={branchData.name || ''}
                                    onChange={(e) => setBranchData({...branchData, name: e.target.value})}
                                />
                                <p className="text-xs text-sys-500 mt-2 flex gap-1 items-center">
                                    <Info size={12}/> Este nombre aparecerá en el encabezado principal del ticket.
                                </p>
                            </div>
                        </div>
                    </div>
                </Card>

                {/* 2. DATOS FISCALES */}
                <Card className="bg-white border-border-default p-6 shadow-sm">
                    <h3 className="text-sys-700 font-bold mb-6 flex items-center gap-2 border-b border-border-subtle pb-2">
                        <FileText size={18} className="text-blue-600"/> Datos Fiscales del Local
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        
                        {/* Razón Social */}
                        <div className="md:col-span-2">
                            <label className="block text-sys-500 text-xs font-bold mb-1.5 uppercase">Razón Social</label>
                            <input 
                                type="text" 
                                className="w-full bg-sys-50 border border-border-default rounded-lg p-3 text-sys-900 focus:border-blue-500 focus:bg-white outline-none transition-all"
                                placeholder="Ej: Juan Pérez S.A."
                                value={branchData.razonSocial || ''}
                                onChange={(e) => setBranchData({...branchData, razonSocial: e.target.value})}
                            />
                        </div>

                        {/* CUIT */}
                        <div>
                            <label className="block text-sys-500 text-xs font-bold mb-1.5 uppercase">CUIT del Titular</label>
                            <div className="relative">
                                <input 
                                    type="text" 
                                    className="w-full bg-sys-50 border border-border-default rounded-lg p-3 pl-10 text-sys-900 font-mono focus:border-blue-500 focus:bg-white outline-none transition-all"
                                    placeholder="20-12345678-9"
                                    value={branchData.cuit || ''}
                                    onChange={(e) => setBranchData({...branchData, cuit: e.target.value})}
                                />
                                <Hash size={16} className="absolute left-3 top-3.5 text-sys-500"/>
                            </div>
                        </div>

                        {/* Condición IVA */}
                        <div>
                            <label className="block text-sys-500 text-xs font-bold mb-1.5 uppercase">Condición IVA</label>
                            <select 
                                className="w-full bg-sys-50 border border-border-default rounded-lg p-3 text-sys-900 focus:border-blue-500 focus:bg-white outline-none transition-all"
                                value={branchData.taxCondition || 'CONSUMIDOR FINAL'}
                                onChange={(e) => setBranchData({...branchData, taxCondition: e.target.value})}
                            >
                                <option value="CONSUMIDOR FINAL">Consumidor Final</option>
                                <option value="RESPONSABLE INSCRIPTO">Responsable Inscripto</option>
                                <option value="MONOTRIBUTO">Monotributo</option>
                                <option value="EXENTO">Exento</option>
                            </select>
                        </div>

                        {/* Dirección */}
                        <div className="md:col-span-2">
                            <label className="block text-sys-500 text-xs font-bold mb-1.5 uppercase flex justify-between">
                                Dirección del Local
                                <span className="text-[10px] text-orange-600 flex items-center gap-1"><AlertTriangle size={10}/> Importante para el ticket</span>
                            </label>
                            <div className="relative">
                                <input 
                                    type="text" 
                                    className="w-full bg-sys-50 border border-border-default rounded-lg p-3 pl-10 text-sys-900 focus:border-blue-500 focus:bg-white outline-none transition-all"
                                    placeholder="Calle 123, Localidad, Provincia"
                                    value={branchData.address || ''}
                                    onChange={(e) => setBranchData({...branchData, address: e.target.value})}
                                />
                                <MapPin size={16} className="absolute left-3 top-3.5 text-sys-500"/>
                            </div>
                        </div>

                        {/* IIBB */}
                        <div>
                            <label className="block text-sys-500 text-xs font-bold mb-1.5 uppercase">N° Ingresos Brutos</label>
                            <input 
                                type="text" 
                                className="w-full bg-sys-50 border border-border-default rounded-lg p-3 text-sys-900 font-mono focus:border-blue-500 focus:bg-white outline-none transition-all"
                                placeholder="Ej: 901-283921-1"
                                value={branchData.iibb || ''}
                                onChange={(e) => setBranchData({...branchData, iibb: e.target.value})}
                            />
                        </div>

                        {/* Inicio Actividad */}
                        <div>
                            <label className="block text-sys-500 text-xs font-bold mb-1.5 uppercase">Inicio de Actividades</label>
                            <div className="relative">
                                <input 
                                    type="date" 
                                    className="w-full bg-sys-50 border border-border-default rounded-lg p-3 pl-10 text-sys-900 font-mono focus:border-blue-500 focus:bg-white outline-none transition-all"
                                    value={branchData.inicioAct || ''}
                                    onChange={(e) => setBranchData({...branchData, inicioAct: e.target.value})}
                                />
                                <Calendar size={16} className="absolute left-3 top-3.5 text-sys-500"/>
                            </div>
                        </div>

                    </div>
                </Card>

                {/* 3. DATOS DE PAGO (NUEVO P/ TRANSFERENCIAS) */}
                <Card className="bg-white border-border-default p-6 shadow-sm">
                    <h3 className="text-sys-700 font-bold mb-6 flex items-center gap-2 border-b border-border-subtle pb-2">
                        <Banknote size={18} className="text-purple-600"/> Datos para Cobros por Transferencia
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        
                        {/* Alias */}
                        <div>
                            <label className="block text-sys-500 text-xs font-bold mb-1.5 uppercase tracking-wide">Alias Bancario / CVU</label>
                            <input 
                                type="text" 
                                className="w-full bg-sys-50 border border-border-default rounded-lg p-3 text-sys-900 focus:border-purple-500 focus:bg-white outline-none transition-all placeholder:text-sys-400"
                                placeholder="Ej: MI.NEGOCIO.MP"
                                value={branchData.transferAlias || ''}
                                onChange={(e) => setBranchData({...branchData, transferAlias: e.target.value})}
                            />
                            <p className="text-[10px] text-sys-500 mt-2">Este alias se mostrará automáticamente en el modal de cobro.</p>
                        </div>

                        {/* Titular */}
                        <div>
                            <label className="block text-sys-500 text-xs font-bold mb-1.5 uppercase tracking-wide">Titular de la Cuenta</label>
                            <input 
                                type="text" 
                                className="w-full bg-sys-50 border border-border-default rounded-lg p-3 text-sys-900 focus:border-purple-500 focus:bg-white outline-none transition-all placeholder:text-sys-400"
                                placeholder="Ej: Juan Pérez"
                                value={branchData.transferAccountName || ''}
                                onChange={(e) => setBranchData({...branchData, transferAccountName: e.target.value})}
                            />
                            <p className="text-[10px] text-sys-500 mt-2">Acompaña al alias para dar seguridad al cliente.</p>
                        </div>
                    </div>
                </Card>

                <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-4 font-bold text-lg rounded-xl shadow-lg shadow-blue-900/30 transition-all active:scale-[0.98] flex items-center justify-center gap-3">
                    {loading ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                            Guardando...
                        </>
                    ) : (
                        <>
                            <Save size={20}/> Guardar Cambios en {activeBranchName}
                        </>
                    )}
                </Button>

            </form>
        </div>
    );
};