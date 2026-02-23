import React, { useState, useEffect } from 'react';
import { Camera, Save, Store, FileText, MapPin, Hash, Calendar, AlertTriangle, Info } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../../database/firebase'; 
import { useAuthStore } from '../../auth/store/useAuthStore';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { toast } from 'react-hot-toast';

export const CompanySettingsPage = () => {
    const { user, activeBranchId, activeBranchName } = useAuthStore();
    
    // Estado inicial completo para evitar uncontrolled inputs
    const [branchData, setBranchData] = useState({ 
        name: '',           // Nombre de Fantasía
        logoUrl: null,      // Logo específico de la sucursal
        razonSocial: '',    // Razón Social
        cuit: '',           // CUIT 
        iibb: '',           // IIBB
        inicioAct: '',      // Inicio Actividades
        address: '',        // Dirección 
        taxCondition: 'CONSUMIDOR FINAL'
    });
    
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadingData, setLoadingData] = useState(true);

    // =================================================================
    // 1. CARGAR DATOS (Estrategia: Branch > Company Fallback)
    // =================================================================
    useEffect(() => {
        if (!user?.companyId || !activeBranchId) return;
        
        const fetchConfig = async () => {
            setLoadingData(true);
            try {
                // A. Buscamos config específica de la sucursal
                const branchRef = doc(db, 'companies', user.companyId, 'branches', activeBranchId);
                const branchSnap = await getDoc(branchRef);
                
                // B. Buscamos config general de la empresa (para rellenar huecos)
                const companyRef = doc(db, 'companies', user.companyId);
                const companySnap = await getDoc(companyRef);
                const companyData = companySnap.exists() ? companySnap.data() : {};

                if (branchSnap.exists()) {
                    const data = branchSnap.data();
                    // Prioridad: Lo que tenga la sucursal. Si falta, usamos lo de la empresa.
                    setBranchData(prev => ({
                        ...prev,
                        ...data,
                        name: data.name || activeBranchName,
                        razonSocial: data.razonSocial || companyData.razonSocial || '',
                        cuit: data.cuit || companyData.cuit || '',
                        taxCondition: data.taxCondition || companyData.taxCondition || 'CONSUMIDOR FINAL',
                        iibb: data.iibb || companyData.iibb || '',
                        inicioAct: data.inicioAct || companyData.inicioAct || '',
                        address: data.address || ''
                    }));
                } else {
                    // Si la sucursal no tiene config, pre-cargamos con datos de empresa
                    setBranchData(prev => ({ 
                        ...prev, 
                        ...companyData, 
                        name: activeBranchName, 
                        razonSocial: companyData.razonSocial || '',
                        address: '' 
                    }));
                }
            } catch (error) {
                console.error("Error cargando configuración:", error);
                toast.error("No se pudieron cargar los datos de la sucursal.");
            } finally {
                setLoadingData(false);
            }
        };
        
        fetchConfig();
    }, [user?.companyId, activeBranchId, activeBranchName]);

    // =================================================================
    // 2. GUARDAR CONFIGURACIÓN 
    // =================================================================
    const handleSave = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            let newLogoUrl = branchData.logoUrl;

            // A. Subir Logo 
            if (file) {
                const storageRef = ref(storage, `logos/${user.companyId}/${activeBranchId}/logo_${Date.now()}`);
                await uploadBytes(storageRef, file);
                newLogoUrl = await getDownloadURL(storageRef);
            }

            // B. Guardar en Firestore (merge: true no borra certificados AFIP)
            const branchRef = doc(db, 'companies', user.companyId, 'branches', activeBranchId);
            
            const payload = {
                ...branchData,
                logoUrl: newLogoUrl,
                updatedAt: new Date().toISOString()
            };

            await setDoc(branchRef, payload, { merge: true });

            // C. Actualizar estado local
            setBranchData(prev => ({ ...prev, logoUrl: newLogoUrl }));
            setFile(null); // Limpiamos el archivo subido
            
            // D. Actualizar Cache Local (PARA QUE TICKET MODAL LO VEA INSTANTÁNEAMENTE)
            const cacheKey = `SALVADOR_BRANCH_CONFIG_${activeBranchId}`;
            localStorage.setItem(cacheKey, JSON.stringify(payload));

            toast.success(`Datos de "${activeBranchName}" guardados correctamente.`);

        } catch (error) {
            console.error("Error al guardar:", error);
            toast.error('Error al guardar. Verifique su conexión.');
        } finally {
            setLoading(false);
        }
    };

    if (loadingData) {
        return <div className="p-10 text-center text-white">Cargando configuración de la sucursal...</div>;
    }

    return (
        <div className="p-6 max-w-4xl mx-auto pb-20 animate-in fade-in duration-500">
            
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Store className="text-blue-400" /> Configuración de Sucursal
                    </h1>
                    <div className="flex items-center gap-2 mt-2">
                        <span className="text-slate-400 text-sm">Estás editando:</span>
                        <span className="bg-blue-600/20 text-blue-300 px-3 py-1 rounded-full text-xs font-bold border border-blue-500/30 flex items-center gap-1">
                            <MapPin size={12}/> {activeBranchName}
                        </span>
                    </div>
                </div>
            </div>

            <form onSubmit={handleSave} className="space-y-6">
                
                {/* 1. IDENTIDAD VISUAL */}
                <Card className="bg-slate-800 border-slate-700 p-6 shadow-xl">
                    <h3 className="text-slate-300 font-bold mb-6 flex items-center gap-2 border-b border-slate-700 pb-2">
                        <Camera size={18} className="text-blue-400"/> Identidad Visual
                    </h3>
                    
                    <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
                        {/* Logo Upload */}
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-32 h-32 rounded-full bg-slate-900 overflow-hidden flex items-center justify-center border-4 border-slate-600 shadow-xl relative group transition-all hover:border-blue-500">
                                {file ? (
                                    <img src={URL.createObjectURL(file)} className="w-full h-full object-cover" alt="Preview" />
                                ) : branchData.logoUrl ? (
                                    <img src={branchData.logoUrl} className="w-full h-full object-contain p-2 bg-white" alt="Logo" />
                                ) : (
                                    <Camera size={40} className="text-slate-600 group-hover:text-blue-500 transition-colors" />
                                )}
                                
                                <label htmlFor="logo-upload" className="absolute inset-0 bg-black/60 hidden group-hover:flex items-center justify-center text-xs font-bold text-white cursor-pointer transition-all uppercase tracking-wider text-center p-2">
                                    CAMBIAR
                                </label>
                                <input 
                                    type="file" 
                                    accept="image/*"
                                    id="logo-upload"
                                    className="hidden"
                                    onChange={(e) => setFile(e.target.files[0])}
                                />
                            </div>
                            <p className="text-[10px] text-slate-500 font-mono">JPG/PNG (Max 2MB)</p>
                        </div>

                        {/* Nombre */}
                        <div className="flex-1 w-full space-y-4">
                            <div>
                                <label className="block text-slate-400 text-xs font-bold mb-1.5 uppercase tracking-wide">Nombre de Fantasía</label>
                                <input 
                                    type="text" 
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:border-blue-500 outline-none transition-all"
                                    placeholder={`Ej: ${activeBranchName}`}
                                    value={branchData.name || ''}
                                    onChange={(e) => setBranchData({...branchData, name: e.target.value})}
                                />
                                <p className="text-xs text-slate-500 mt-2 flex gap-1 items-center">
                                    <Info size={12}/> Este nombre aparecerá en el encabezado principal del ticket.
                                </p>
                            </div>
                        </div>
                    </div>
                </Card>

                {/* 2. DATOS FISCALES */}
                <Card className="bg-slate-800 border-slate-700 p-6 shadow-xl">
                    <h3 className="text-slate-300 font-bold mb-6 flex items-center gap-2 border-b border-slate-700 pb-2">
                        <FileText size={18} className="text-blue-400"/> Datos Fiscales del Local
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        
                        {/* Razón Social */}
                        <div className="md:col-span-2">
                            <label className="block text-slate-400 text-xs font-bold mb-1.5 uppercase">Razón Social</label>
                            <input 
                                type="text" 
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:border-blue-500 outline-none"
                                placeholder="Ej: Juan Pérez S.A."
                                value={branchData.razonSocial || ''}
                                onChange={(e) => setBranchData({...branchData, razonSocial: e.target.value})}
                            />
                        </div>

                        {/* CUIT */}
                        <div>
                            <label className="block text-slate-400 text-xs font-bold mb-1.5 uppercase">CUIT del Titular</label>
                            <div className="relative">
                                <input 
                                    type="text" 
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 pl-10 text-white font-mono focus:border-blue-500 outline-none"
                                    placeholder="20-12345678-9"
                                    value={branchData.cuit || ''}
                                    onChange={(e) => setBranchData({...branchData, cuit: e.target.value})}
                                />
                                <Hash size={16} className="absolute left-3 top-3.5 text-slate-500"/>
                            </div>
                        </div>

                        {/* Condición IVA */}
                        <div>
                            <label className="block text-slate-400 text-xs font-bold mb-1.5 uppercase">Condición IVA</label>
                            <select 
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:border-blue-500 outline-none"
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
                            <label className="block text-slate-400 text-xs font-bold mb-1.5 uppercase flex justify-between">
                                Dirección del Local
                                <span className="text-[10px] text-yellow-500 flex items-center gap-1"><AlertTriangle size={10}/> Importante para el ticket</span>
                            </label>
                            <div className="relative">
                                <input 
                                    type="text" 
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 pl-10 text-white focus:border-blue-500 outline-none"
                                    placeholder="Calle 123, Localidad, Provincia"
                                    value={branchData.address || ''}
                                    onChange={(e) => setBranchData({...branchData, address: e.target.value})}
                                />
                                <MapPin size={16} className="absolute left-3 top-3.5 text-slate-500"/>
                            </div>
                        </div>

                        {/* IIBB */}
                        <div>
                            <label className="block text-slate-400 text-xs font-bold mb-1.5 uppercase">N° Ingresos Brutos</label>
                            <input 
                                type="text" 
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white font-mono focus:border-blue-500 outline-none"
                                placeholder="Ej: 901-283921-1"
                                value={branchData.iibb || ''}
                                onChange={(e) => setBranchData({...branchData, iibb: e.target.value})}
                            />
                        </div>

                        {/* Inicio Actividad */}
                        <div>
                            <label className="block text-slate-400 text-xs font-bold mb-1.5 uppercase">Inicio de Actividades</label>
                            <div className="relative">
                                <input 
                                    type="date" 
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 pl-10 text-white font-mono focus:border-blue-500 outline-none"
                                    value={branchData.inicioAct || ''}
                                    onChange={(e) => setBranchData({...branchData, inicioAct: e.target.value})}
                                />
                                <Calendar size={16} className="absolute left-3 top-3.5 text-slate-500"/>
                            </div>
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