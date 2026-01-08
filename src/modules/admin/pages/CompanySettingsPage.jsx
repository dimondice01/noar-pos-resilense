import React, { useState, useEffect } from 'react';
import { Camera, Save, Building, FileText, MapPin, CreditCard, AlertCircle } from 'lucide-react';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../../database/firebase'; 
import { useAuthStore } from '../../auth/store/useAuthStore';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';

export const CompanySettingsPage = () => {
    const { user } = useAuthStore();
    
    // Estado inicial con todos los campos necesarios para el ticket
    const [companyData, setCompanyData] = useState({ 
        name: '', 
        slug: '', 
        logoUrl: null,
        razonSocial: '',
        cuit: '',
        address: '',
        taxCondition: 'CONSUMIDOR FINAL'
    });
    
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState('');

    // 1. Cargar datos actuales
    useEffect(() => {
        if (!user?.companyId) return;
        const fetchConfig = async () => {
            const docRef = doc(db, 'companies', user.companyId);
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                // Fusionamos con defaults para evitar errores de "uncontrolled inputs"
                setCompanyData({
                    name: '', 
                    slug: '', 
                    logoUrl: null,
                    razonSocial: '',
                    cuit: '',
                    address: '',
                    taxCondition: 'CONSUMIDOR FINAL',
                    ...snap.data() // Sobrescribe con lo que venga de DB
                });
            }
        };
        fetchConfig();
    }, [user]);

    // 2. Manejar Guardado
    const handleSave = async (e) => {
        e.preventDefault();
        setLoading(true);
        setMsg('');

        try {
            let newLogoUrl = companyData.logoUrl;

            // A. Subir imagen si seleccionó una nueva
            if (file) {
                const storageRef = ref(storage, `logos/${user.companyId}/logo_${Date.now()}`);
                await uploadBytes(storageRef, file);
                newLogoUrl = await getDownloadURL(storageRef);
            }

            // B. Guardar en Firestore
            const companyRef = doc(db, 'companies', user.companyId);
            await updateDoc(companyRef, {
                name: companyData.name,
                logoUrl: newLogoUrl,
                // Datos Fiscales Nuevos
                razonSocial: companyData.razonSocial,
                cuit: companyData.cuit,
                address: companyData.address,
                taxCondition: companyData.taxCondition
                // 🚫 NO guardamos 'slug' aquí porque es fijo
            });

            setCompanyData(prev => ({ ...prev, logoUrl: newLogoUrl }));
            setMsg('✅ Datos del negocio actualizados.');

        } catch (error) {
            console.error(error);
            setMsg('❌ Error al guardar.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 max-w-4xl mx-auto pb-20">
            <h1 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                <Building className="text-blue-400" /> Configuración de Marca y Ticket
            </h1>

            <form onSubmit={handleSave} className="space-y-6">
                
                {/* 1. IDENTIDAD VISUAL (LOGO Y NOMBRE) */}
                <Card className="bg-slate-800 border-slate-700 p-6">
                    <h3 className="text-slate-300 font-bold mb-4 flex items-center gap-2">
                        <Camera size={18}/> Identidad Visual
                    </h3>
                    
                    <div className="flex flex-col md:flex-row gap-6 items-center md:items-start">
                        {/* Logo Upload */}
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-32 h-32 rounded-full bg-slate-700 overflow-hidden flex items-center justify-center border-4 border-slate-600 shadow-xl relative group">
                                {file ? (
                                    <img src={URL.createObjectURL(file)} className="w-full h-full object-cover" alt="Preview" />
                                ) : companyData.logoUrl ? (
                                    <img src={companyData.logoUrl} className="w-full h-full object-cover" alt="Logo" />
                                ) : (
                                    <Camera size={48} className="text-slate-500" />
                                )}
                                
                                <label htmlFor="logo-upload" className="absolute inset-0 bg-black/50 hidden group-hover:flex items-center justify-center text-xs text-white cursor-pointer transition-all">
                                    Cambiar Logo
                                </label>
                                <input 
                                    type="file" 
                                    accept="image/*"
                                    id="logo-upload"
                                    className="hidden"
                                    onChange={(e) => setFile(e.target.files[0])}
                                />
                            </div>
                            <p className="text-xs text-slate-500">Formato JPG/PNG</p>
                        </div>

                        {/* Nombre y Slug */}
                        <div className="flex-1 w-full space-y-4">
                            <div>
                                <label className="block text-slate-400 text-xs font-bold mb-1">NOMBRE DE FANTASÍA</label>
                                <input 
                                    type="text" 
                                    className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white focus:border-blue-500 outline-none"
                                    placeholder="Ej: Kiosco Pepe"
                                    value={companyData.name || ''}
                                    onChange={(e) => setCompanyData({...companyData, name: e.target.value})}
                                />
                            </div>

                            <div>
                                <label className="block text-slate-400 text-xs font-bold mb-1 flex justify-between">
                                    ENLACE DE ACCESO
                                    <span className="text-[10px] text-yellow-500 flex items-center gap-1"><AlertCircle size={10}/> NO MODIFICABLE</span>
                                </label>
                                <div className="flex items-center bg-slate-900/50 border border-slate-700 rounded text-slate-500 px-3 py-3">
                                    <span className="text-xs select-none">noarpos.com/login/</span>
                                    <span className="text-white font-mono ml-1">{companyData.slug || user?.companyId}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </Card>

                {/* 2. DATOS FISCALES (PARA EL TICKET) */}
                <Card className="bg-slate-800 border-slate-700 p-6">
                    <h3 className="text-slate-300 font-bold mb-4 flex items-center gap-2">
                        <FileText size={18}/> Datos para el Ticket
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        
                        {/* Razón Social */}
                        <div>
                            <label className="block text-slate-400 text-xs font-bold mb-1">RAZÓN SOCIAL</label>
                            <input 
                                type="text" 
                                className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white focus:border-blue-500 outline-none"
                                placeholder="Ej: Juan Pérez S.A."
                                value={companyData.razonSocial || ''}
                                onChange={(e) => setCompanyData({...companyData, razonSocial: e.target.value})}
                            />
                            <p className="text-[10px] text-slate-500 mt-1">Si se deja vacío, no aparece en el ticket.</p>
                        </div>

                        {/* CUIT */}
                        <div>
                            <label className="block text-slate-400 text-xs font-bold mb-1">CUIT / DNI</label>
                            <input 
                                type="text" 
                                className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white focus:border-blue-500 outline-none font-mono"
                                placeholder="20-12345678-9"
                                value={companyData.cuit || ''}
                                onChange={(e) => setCompanyData({...companyData, cuit: e.target.value})}
                            />
                        </div>

                        {/* Dirección */}
                        <div className="md:col-span-2">
                            <label className="block text-slate-400 text-xs font-bold mb-1 flex items-center gap-1"><MapPin size={12}/> DIRECCIÓN COMERCIAL</label>
                            <input 
                                type="text" 
                                className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white focus:border-blue-500 outline-none"
                                placeholder="Ej: Av. Siempreviva 742, Ciudad"
                                value={companyData.address || ''}
                                onChange={(e) => setCompanyData({...companyData, address: e.target.value})}
                            />
                        </div>

                        {/* Condición IVA */}
                        <div className="md:col-span-2">
                            <label className="block text-slate-400 text-xs font-bold mb-1 flex items-center gap-1"><CreditCard size={12}/> CONDICIÓN IVA</label>
                            <select 
                                className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white focus:border-blue-500 outline-none"
                                value={companyData.taxCondition || 'CONSUMIDOR FINAL'}
                                onChange={(e) => setCompanyData({...companyData, taxCondition: e.target.value})}
                            >
                                <option value="CONSUMIDOR FINAL">Consumidor Final (Ticket X)</option>
                                <option value="RESPONSABLE INSCRIPTO">Responsable Inscripto (Factura A/B)</option>
                                <option value="MONOTRIBUTO">Monotributo (Factura C)</option>
                                <option value="EXENTO">Exento</option>
                            </select>
                        </div>
                    </div>
                </Card>

                {/* MENSAJES Y BOTÓN */}
                {msg && (
                    <div className={`p-3 rounded text-center font-bold ${msg.includes('Error') ? 'bg-red-900/30 text-red-400 border border-red-800' : 'bg-green-900/30 text-green-400 border border-green-800'}`}>
                        {msg}
                    </div>
                )}

                <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-4 font-bold text-lg shadow-lg shadow-blue-900/50 rounded-xl transition-all active:scale-95">
                    {loading ? <span className="flex items-center justify-center gap-2"><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/> Guardando...</span> : '💾 Guardar Configuración'}
                </Button>

            </form>
        </div>
    );
};