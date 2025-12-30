import React, { useState } from 'react';
import { Shield, Briefcase, Mail, Lock, CheckCircle, AlertTriangle, Database, UploadCloud, FileText } from 'lucide-react'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import { useDbSeeder } from '../../../core/hooks/useDbSeeder'; 
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { auth } from '../../../database/firebase'; 

const SUPER_ADMIN_EMAIL = "admin@admin.com"; 

// ✅ URL DE TU CLOUD FUNCTION GEN 2 (Asegúrate de que sea la correcta que te dio la terminal)
const API_URL = import.meta.env.VITE_API_URL || "https://api-ps25yq7qaq-uc.a.run.app";

export const SuperAdminPage = () => {
    const { user, isLoading } = useAuthStore();
    
    // Hook del Seeder
    const { uploadCatalog, loadingMsg: seedMsg, isSeeding } = useDbSeeder();

    const [formData, setFormData] = useState({
        businessName: '',
        ownerName: '',
        email: '',
        password: ''
    });

    // 📂 ESTADO PARA EL ARCHIVO CSV
    const [selectedFile, setSelectedFile] = useState(null);
    
    const [processStatus, setProcessStatus] = useState('idle'); 
    const [msg, setMsg] = useState('');

    // 🛡️ SEGURIDAD
    if (isLoading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-200">Verificando...</div>;
    
    if (!user || user.email !== SUPER_ADMIN_EMAIL) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-slate-950 text-red-500 p-4 font-mono">
                <Shield size={64} className="mb-4 animate-bounce" />
                <h1 className="text-3xl font-bold mb-2">ACCESO DENEGADO</h1>
                <Button onClick={() => window.location.href = '/'} className="mt-6 bg-red-900 text-white">Volver</Button>
            </div>
        );
    }

    // 🚀 PROCESO DE CREACIÓN
    const handleSubmit = async (e) => {
        e.preventDefault();

        // 1. VALIDAR QUE HAYA ARCHIVO SELECCIONADO
        if (!selectedFile) {
            setProcessStatus('error');
            setMsg("⚠️ Por favor selecciona el archivo 'catalogo.csv' antes de continuar.");
            return;
        }

        setProcessStatus('creating_tenant');
        setMsg('🏗️ Contactando Backend para crear empresa...');

        try {
            // 2. LLAMADA AL BACKEND (Crea usuario y doc vacío)
            const token = await auth.currentUser?.getIdToken();
            const response = await fetch(`${API_URL}/create-tenant`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (!response.ok) throw new Error(data.error || 'Error creando inquilino');

            // 3. INYECCIÓN MANUAL DESDE EL NAVEGADOR
            if (data.companyId) {
                setProcessStatus('seeding_db');
                setMsg(`✅ Estructura creada. Inyectando catálogo...`);
                
                // 🔥 AQUÍ PASAMOS EL ID DE LA EMPRESA Y EL ARCHIVO
                await uploadCatalog(data.companyId, selectedFile);
                
                setProcessStatus('success');
                setMsg(`✅ ¡ÉXITO TOTAL!\nEmpresa: ${data.companyId}\nCatálogo cargado correctamente.`);
                
                // Limpiar formulario
                setFormData({ businessName: '', ownerName: '', email: '', password: '' });
                setSelectedFile(null); 
                // Resetear el input file visualmente es difícil en React sin refs, pero esto limpia el estado.
            } else {
                throw new Error("El backend no devolvió el ID de la empresa.");
            }

        } catch (error) {
            console.error(error);
            setProcessStatus('error');
            setMsg(`❌ Error: ${error.message}`);
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 text-slate-200 p-4 md:p-8 font-sans">
            
            {/* OVERLAY DE CARGA */}
            {(isSeeding || processStatus === 'creating_tenant') && (
                <div className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-slate-800 p-8 rounded-2xl border border-slate-600 shadow-2xl max-w-md w-full text-center">
                        <UploadCloud className="mx-auto text-blue-400 mb-4 animate-bounce" size={48} />
                        <h2 className="text-2xl font-bold text-white mb-2">Procesando...</h2>
                        <p className="text-slate-400 text-sm mb-6 font-mono">{seedMsg || msg}</p>
                        <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden relative">
                            <div className="bg-blue-600 h-2.5 rounded-full w-full absolute animate-progress-indeterminate"></div>
                        </div>
                        <p className="text-xs text-slate-500 mt-4">No cierres esta ventana.</p>
                    </div>
                </div>
            )}

            <div className="max-w-2xl mx-auto relative z-10">
                <header className="mb-8 flex items-center gap-3 border-b border-slate-700 pb-4">
                    <div className="bg-blue-600 p-2 rounded-lg text-white shadow-lg">
                        <Shield size={32} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white">Panel Maestro</h1>
                        <p className="text-slate-400 text-sm">Alta de Clientes</p>
                    </div>
                </header>

                <Card className="bg-slate-800 border-slate-700 text-white shadow-2xl">
                    <form onSubmit={handleSubmit} className="space-y-6 p-4">
                        
                        {/* 📂 SELECCIÓN DE ARCHIVO (NUEVO) */}
                        <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-600 border-dashed hover:border-blue-500 transition-colors">
                            <label className="block text-sm font-bold text-blue-400 mb-2 flex items-center gap-2">
                                <FileText size={16}/> 1. Seleccionar Catálogo Maestro (CSV)
                            </label>
                            <input 
                                type="file" 
                                accept=".csv"
                                onChange={(e) => setSelectedFile(e.target.files[0])}
                                className="block w-full text-sm text-slate-400
                                  file:mr-4 file:py-2 file:px-4
                                  file:rounded-full file:border-0
                                  file:text-sm file:font-semibold
                                  file:bg-blue-600 file:text-white
                                  hover:file:bg-blue-700 cursor-pointer"
                            />
                            {selectedFile && (
                                <p className="text-xs text-green-400 mt-2 font-mono">
                                    ✅ Archivo listo: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                                </p>
                            )}
                        </div>

                        {/* DATOS DE LA EMPRESA */}
                        <div className="space-y-4">
                            <h3 className="text-slate-400 font-bold uppercase text-xs tracking-wider flex items-center gap-2">
                                <Briefcase size={14}/> 2. Datos del Negocio
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs mb-1 text-slate-500">Nombre de Fantasía</label>
                                    <input 
                                        type="text" 
                                        className="w-full bg-slate-900 border border-slate-600 rounded p-2 focus:border-blue-500 outline-none text-sm"
                                        placeholder="Ej: Kiosco El Pepe"
                                        value={formData.businessName}
                                        onChange={e => setFormData({...formData, businessName: e.target.value})}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs mb-1 text-slate-500">Nombre del Dueño</label>
                                    <input 
                                        type="text" 
                                        className="w-full bg-slate-900 border border-slate-600 rounded p-2 focus:border-blue-500 outline-none text-sm"
                                        placeholder="Ej: José Perez"
                                        value={formData.ownerName}
                                        onChange={e => setFormData({...formData, ownerName: e.target.value})}
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        {/* CREDENCIALES */}
                        <div className="space-y-4 pt-4 border-t border-slate-700">
                            <h3 className="text-slate-400 font-bold uppercase text-xs tracking-wider flex items-center gap-2">
                                <Lock size={14}/> 3. Credenciales
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs mb-1 text-slate-500">Email</label>
                                    <input 
                                        type="email" 
                                        className="w-full bg-slate-900 border border-slate-600 rounded p-2 focus:border-green-500 outline-none text-sm"
                                        placeholder="cliente@gmail.com"
                                        value={formData.email}
                                        onChange={e => setFormData({...formData, email: e.target.value})}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs mb-1 text-slate-500">Contraseña</label>
                                    <input 
                                        type="text" 
                                        className="w-full bg-slate-900 border border-slate-600 rounded p-2 focus:border-green-500 outline-none text-sm font-mono"
                                        placeholder="Ej: pass123"
                                        value={formData.password}
                                        onChange={e => setFormData({...formData, password: e.target.value})}
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="pt-6 border-t border-slate-700">
                            {msg && processStatus !== 'seeding_db' && processStatus !== 'creating_tenant' && (
                                <div className={`mb-4 p-4 rounded-lg text-sm whitespace-pre-line flex items-start gap-3 ${processStatus === 'error' ? 'bg-red-900/30 text-red-200 border border-red-800' : 'bg-green-900/30 text-green-200 border border-green-800'}`}>
                                    {processStatus === 'success' && <CheckCircle className="shrink-0 size-5"/>}
                                    {processStatus === 'error' && <AlertTriangle className="shrink-0 size-5"/>}
                                    <span className="font-mono text-xs md:text-sm">{msg}</span>
                                </div>
                            )}

                            <Button 
                                type="submit" 
                                disabled={processStatus === 'creating_tenant' || isSeeding}
                                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 shadow-lg shadow-blue-900/50"
                            >
                                {processStatus === 'creating_tenant' ? '🚀 PROCESANDO...' : '⚡ EJECUTAR ALTA'}
                            </Button>
                        </div>
                    </form>
                </Card>
            </div>
        </div>
    );
};