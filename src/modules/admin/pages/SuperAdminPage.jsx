import React, { useState } from 'react';
import { Shield, Briefcase, User, Mail, Lock, Server, CheckCircle, AlertTriangle, Database } from 'lucide-react';
import { useAuthStore } from '../../auth/store/useAuthStore'; // Asegúrate que esta ruta sea correcta según tu estructura
import { useDbSeeder } from '../../../core/hooks/useDbSeeder'; // Importamos el hook del Seeder
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { auth } from '../../../database/firebase'; 

// ⚠️ CAMBIA ESTO POR TU EMAIL REAL
const SUPER_ADMIN_EMAIL = "admin@admin.com"; 

// URL de tu Cloud Function
const API_URL = import.meta.env.VITE_API_URL || "https://us-central1-salvadorpos1.cloudfunctions.net/api";

export const SuperAdminPage = () => {
    const { user, isLoading } = useAuthStore();
    
    // Hook del Seeder (Renombramos loadingMsg a seedMsg para no confundir con el del form)
    const { uploadMasterCatalog, loadingMsg: seedMsg, isSeeding } = useDbSeeder();

    const [formData, setFormData] = useState({
        businessName: '',
        ownerName: '',
        email: '',
        password: ''
    });
    const [status, setStatus] = useState('idle'); // idle, loading, success, error
    const [msg, setMsg] = useState('');

    // 🛡️ SEGURIDAD FRONTEND: EL PORTERO
    if (isLoading) return <div className="p-10 text-center">Cargando privilegios...</div>;
    
    // Si no está logueado O el email no es el tuyo -> FUERA
    if (!user || user.email !== SUPER_ADMIN_EMAIL) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-red-50 text-red-800 p-4">
                <Shield size={64} className="mb-4" />
                <h1 className="text-3xl font-bold mb-2">ACCESO DENEGADO</h1>
                <p>Esta área es clasificada. Tu IP ha sido registrada.</p>
                <Button onClick={() => window.location.href = '/'} className="mt-6 bg-red-700 text-white">
                    Volver a zona segura
                </Button>
            </div>
        );
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        setStatus('loading');
        setMsg('🏗️ Construyendo base de datos y clonando productos...');

        try {
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

            if (!response.ok) throw new Error(data.error || 'Error desconocido');

            setStatus('success');
            setMsg(`✅ ¡ÉXITO! Cliente creado.\nID Empresa: ${data.companyId}\nProductos Clonados.`);
            setFormData({ businessName: '', ownerName: '', email: '', password: '' });

        } catch (error) {
            console.error(error);
            setStatus('error');
            setMsg(`❌ Error: ${error.message}`);
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 text-slate-200 p-4 md:p-8">
            <div className="max-w-2xl mx-auto">
                <header className="mb-8 flex items-center gap-3 border-b border-slate-700 pb-4">
                    <div className="bg-blue-600 p-2 rounded-lg text-white">
                        <Shield size={32} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white">Panel de Control Maestro</h1>
                        <p className="text-slate-400 text-sm">Alta de Clientes & Clonación de Catálogo</p>
                    </div>
                </header>

                {/* === SECCIÓN 1: CATÁLOGO MAESTRO === */}
                <Card className="bg-slate-800 border-slate-700 text-white shadow-2xl mb-8 p-6">
                    <h3 className="text-purple-400 font-bold uppercase text-xs tracking-wider flex items-center gap-2 mb-4">
                        <Database size={14}/> Mantenimiento del Sistema
                    </h3>
                    <div className="flex items-center justify-between bg-slate-900 p-4 rounded-lg border border-slate-700">
                        <div>
                            <h4 className="font-bold text-sm">Catálogo Maestro de Productos</h4>
                            <p className="text-xs text-slate-400">
                                Sube los productos del CSV a la colección 'master_products'.<br/>
                                Ejecutar SOLO si actualizaste el archivo Excel.
                            </p>
                            {seedMsg && <p className="text-xs text-yellow-400 mt-2 animate-pulse">{seedMsg}</p>}
                        </div>
                        <Button 
                            type="button" 
                            onClick={uploadMasterCatalog}
                            disabled={isSeeding}
                            className="bg-purple-700 hover:bg-purple-600 text-white font-bold px-4 py-2"
                        >
                            {isSeeding ? 'Subiendo...' : '⬆️ Cargar CSV Maestro'}
                        </Button>
                    </div>
                </Card>

                {/* === SECCIÓN 2: ALTA DE CLIENTES === */}
                <Card className="bg-slate-800 border-slate-700 text-white shadow-2xl">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        
                        <div className="space-y-4">
                            <h3 className="text-blue-400 font-bold uppercase text-xs tracking-wider flex items-center gap-2">
                                <Briefcase size={14}/> Datos del Nuevo Negocio
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs mb-1 text-slate-400">Nombre de Fantasía</label>
                                    <input 
                                        type="text" 
                                        className="w-full bg-slate-900 border border-slate-600 rounded p-2 focus:border-blue-500 outline-none transition-colors"
                                        placeholder="Ej: Kiosco El Pepe"
                                        value={formData.businessName}
                                        onChange={e => setFormData({...formData, businessName: e.target.value})}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs mb-1 text-slate-400">Nombre del Dueño</label>
                                    <input 
                                        type="text" 
                                        className="w-full bg-slate-900 border border-slate-600 rounded p-2 focus:border-blue-500 outline-none transition-colors"
                                        placeholder="Ej: José Perez"
                                        value={formData.ownerName}
                                        onChange={e => setFormData({...formData, ownerName: e.target.value})}
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4 pt-4 border-t border-slate-700">
                            <h3 className="text-green-400 font-bold uppercase text-xs tracking-wider flex items-center gap-2">
                                <Lock size={14}/> Credenciales de Acceso
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs mb-1 text-slate-400">Email (Usuario)</label>
                                    <input 
                                        type="email" 
                                        className="w-full bg-slate-900 border border-slate-600 rounded p-2 focus:border-green-500 outline-none transition-colors"
                                        placeholder="cliente@gmail.com"
                                        value={formData.email}
                                        onChange={e => setFormData({...formData, email: e.target.value})}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs mb-1 text-slate-400">Contraseña Provisoria</label>
                                    <input 
                                        type="text" 
                                        className="w-full bg-slate-900 border border-slate-600 rounded p-2 focus:border-green-500 outline-none transition-colors font-mono"
                                        placeholder="Ej: kiosco2024"
                                        value={formData.password}
                                        onChange={e => setFormData({...formData, password: e.target.value})}
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="pt-6 border-t border-slate-700">
                            {msg && (
                                <div className={`mb-4 p-4 rounded-lg text-sm whitespace-pre-line flex items-start gap-3 ${status === 'error' ? 'bg-red-900/50 text-red-200 border border-red-800' : 'bg-green-900/50 text-green-200 border border-green-800'}`}>
                                    {status === 'loading' && <Server className="animate-pulse shrink-0"/>}
                                    {status === 'success' && <CheckCircle className="shrink-0"/>}
                                    {status === 'error' && <AlertTriangle className="shrink-0"/>}
                                    <span>{msg}</span>
                                </div>
                            )}

                            <Button 
                                type="submit" 
                                disabled={status === 'loading'}
                                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 shadow-lg shadow-blue-900/50"
                            >
                                {status === 'loading' ? '🚀 CLONANDO ECOSISTEMA...' : '⚡ CREAR INQUILINO'}
                            </Button>
                        </div>
                    </form>
                </Card>

                <p className="text-center text-slate-500 text-xs mt-8">
                    Sistema Noar POS - Consola de Administración v1.0<br/>
                    Acceso restringido a: {user.email}
                </p>
            </div>
        </div>
    );
};