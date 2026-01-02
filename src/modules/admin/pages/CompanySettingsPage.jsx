import React, { useState, useEffect } from 'react';
import { Camera, Save, Building } from 'lucide-react';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../../database/firebase'; 
import { useAuthStore } from '../../auth/store/useAuthStore';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';

export const CompanySettingsPage = () => {
    const { user } = useAuthStore();
    const [companyData, setCompanyData] = useState({ name: '', slug: '', logoUrl: null });
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
                setCompanyData(snap.data());
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

            // B. Guardar en Firestore (Solo nombre y logo, el slug es inmutable)
            const companyRef = doc(db, 'companies', user.companyId);
            await updateDoc(companyRef, {
                name: companyData.name,
                logoUrl: newLogoUrl
                // 🚫 NO guardamos 'slug' aquí porque es fijo desde la creación
            });

            setCompanyData(prev => ({ ...prev, logoUrl: newLogoUrl }));
            setMsg('✅ Configuración actualizada con éxito.');

        } catch (error) {
            console.error(error);
            setMsg('❌ Error al guardar.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                <Building /> Configuración de Marca
            </h1>

            <Card className="bg-slate-800 border-slate-700 p-6">
                <form onSubmit={handleSave} className="space-y-6">
                    
                    {/* LOGO UPLOAD */}
                    <div className="flex flex-col items-center gap-4 p-6 border-2 border-dashed border-slate-600 rounded-xl bg-slate-900/50">
                        <div className="w-32 h-32 rounded-full bg-slate-700 overflow-hidden flex items-center justify-center border-4 border-slate-600 shadow-xl relative group">
                            {file ? (
                                <img src={URL.createObjectURL(file)} className="w-full h-full object-cover" />
                            ) : companyData.logoUrl ? (
                                <img src={companyData.logoUrl} className="w-full h-full object-cover" />
                            ) : (
                                <Camera size={48} className="text-slate-500" />
                            )}
                            
                            <div className="absolute inset-0 bg-black/50 hidden group-hover:flex items-center justify-center text-xs text-white">
                                Cambiar
                            </div>
                        </div>
                        
                        <input 
                            type="file" 
                            accept="image/*"
                            id="logo-upload"
                            className="hidden"
                            onChange={(e) => setFile(e.target.files[0])}
                        />
                        <label htmlFor="logo-upload" className="cursor-pointer bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded text-sm transition-colors">
                            Seleccionar Logo
                        </label>
                    </div>

                    {/* DATOS */}
                    <div className="grid gap-4">
                        <div>
                            <label className="block text-slate-400 text-xs font-bold mb-2">NOMBRE DEL NEGOCIO</label>
                            <input 
                                type="text" 
                                className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white focus:border-blue-500 outline-none"
                                value={companyData.name || ''}
                                onChange={(e) => setCompanyData({...companyData, name: e.target.value})}
                            />
                        </div>

                        <div>
                            <label className="block text-slate-400 text-xs font-bold mb-2 flex justify-between items-center">
                                ENLACE PERMANENTE (Slug)
                                <span className="text-[10px] text-yellow-500 bg-yellow-900/30 px-2 py-0.5 rounded border border-yellow-800">🔒 INAMOVIBLE</span>
                            </label>
                            <div className="flex items-center bg-slate-900 border border-slate-700 rounded text-slate-500 cursor-not-allowed opacity-75">
                                <span className="pl-3 pr-1 text-xs select-none">noarpos.com/login/</span>
                                <input 
                                    type="text" 
                                    disabled 
                                    className="w-full bg-transparent p-3 text-slate-300 font-mono focus:outline-none cursor-not-allowed"
                                    // 🔥 Usamos el ID real del usuario o el slug guardado
                                    value={companyData.slug || user?.companyId || ''}
                                />
                            </div>
                            <p className="text-[10px] text-slate-600 mt-1">
                                Este enlace es único para tu negocio. Compártelo con tus empleados para que vean tu logo al ingresar.
                            </p>
                        </div>
                    </div>

                    {msg && <p className={`text-center text-sm ${msg.includes('Error') ? 'text-red-400' : 'text-green-400'}`}>{msg}</p>}

                    <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 font-bold shadow-lg shadow-blue-900/50">
                        {loading ? 'Guardando...' : '💾 Guardar Cambios'}
                    </Button>
                </form>
            </Card>
        </div>
    );
};