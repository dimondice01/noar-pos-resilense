import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    Store, Zap, ArrowRight, CheckCircle2, Loader2, Package, 
    ShoppingBag, Coffee, AlertCircle, Upload, Image as ImageIcon, ShieldCheck,
    PartyPopper, UserCheck
} from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, updateDoc } from 'firebase/firestore';
import { storage, db } from '../../../database/firebase'; 
import { useAuthStore } from '../store/useAuthStore';
import { useDbSeeder } from '../../../core/hooks/useDbSeeder';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import confetti from 'canvas-confetti'; 

// 🔥 URL DE TUS CLOUD FUNCTIONS
const API_URL = import.meta.env.VITE_API_URL || "https://us-central1-salvadorpos1.cloudfunctions.net/api";

const CATALOG_OPTIONS = [
    { id: 'kiosco', name: 'Maxikiosco', icon: Store, file: '/seeders/catalogo.csv', desc: 'Caramelos, Bebidas, Cigarrillos (~2500 prod)' },
    { id: 'almacen', name: 'Almacén / Despensa', icon: ShoppingBag, file: '/seeders/catalogo.csv', desc: 'Básicos, Limpieza, Comestibles' },
    { id: 'cafe', name: 'Cafetería / Bar', icon: Coffee, file: null, desc: 'Cafés, Medialunas (Carga manual)' },
    { id: 'otro', name: 'Otro / Vacío', icon: Package, file: null, desc: 'Empieza con el inventario en blanco' },
];

export const ValeriaRegisterPage = () => {
    const navigate = useNavigate();
    const { login } = useAuthStore();
    const { seedFromUrl, loadingMsg, isSeeding } = useDbSeeder();

    const [step, setStep] = useState(1);
    
    // Estados del Formulario
    const [formData, setFormData] = useState({
        businessName: '',
        email: '',
        password: '',
        confirmPassword: '',
        ownerName: '',
        captcha: '' 
    });

    const [logoFile, setLogoFile] = useState(null);
    const [logoPreview, setLogoPreview] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedOption, setSelectedOption] = useState(CATALOG_OPTIONS[0]);

    // Desafío matemático simple (Anti-Spam)
    const [mathChallenge] = useState({ 
        q: `${Math.floor(Math.random() * 5) + 1} + ${Math.floor(Math.random() * 5) + 1}`, 
        a: 0 
    });
    const realAnswer = eval(mathChallenge.q);

    // --- EFECTO DE CONFETI ---
    const triggerCelebration = () => {
        const duration = 3000;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };
        const randomInRange = (min, max) => Math.random() * (max - min) + min;

        const interval = setInterval(function() {
            const timeLeft = animationEnd - Date.now();
            if (timeLeft <= 0) return clearInterval(interval);
            const particleCount = 50 * (timeLeft / duration);
            confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
            confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
        }, 250);
    };

    // --- MANEJO DE IMAGEN ---
    const handleLogoChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 2 * 1024 * 1024) { 
                alert("El logo es muy pesado (Máx 2MB)");
                return;
            }
            setLogoFile(file);
            setLogoPreview(URL.createObjectURL(file));
        }
    };

    // --- PASO 1: CREAR CUENTA ---
    const handleRegister = async (e) => {
        e.preventDefault();
        setError('');

        // Validaciones
        if (formData.password !== formData.confirmPassword) return setError("Las contraseñas no coinciden.");
        if (formData.password.length < 6) return setError("La contraseña debe tener al menos 6 caracteres.");
        if (parseInt(formData.captcha) !== realAnswer) return setError("La verificación anti-robot es incorrecta.");

        setLoading(true);

        try {
            // 1. Crear Tenant (Inyectando metadata de vendedor)
            const res = await fetch(`${API_URL}/create-tenant`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    businessName: formData.businessName,
                    email: formData.email,
                    password: formData.password,
                    ownerName: formData.ownerName,
                    // 🔥 Metadata extra para tracking de comisión
                    metadata: {
                        source: 'presencial',
                        representative: 'Valeria Gaitan',
                        plan: 'FULL' // Asumimos full en venta directa
                    }
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Error al crear cuenta");

            const newCompanyId = data.companyId;

            // 2. Auto-Login
            await login(formData.email, formData.password);

            // 3. Subir Logo (Opcional)
            if (logoFile && newCompanyId) {
                try {
                    const storageRef = ref(storage, `companies/${newCompanyId}/logo/brand_logo`);
                    await uploadBytes(storageRef, logoFile);
                    const logoUrl = await getDownloadURL(storageRef);
                    await updateDoc(doc(db, 'companies', newCompanyId), { logoUrl });
                } catch (logoErr) { console.error("Error subiendo logo:", logoErr); }
            }

            setStep(2);

        } catch (err) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // --- PASO 2: CARGA DE DATOS ---
    const handleFinish = async () => {
        if (!selectedOption) return;
        
        try {
            if (selectedOption.file) {
                const currentUser = useAuthStore.getState().user;
                if (!currentUser?.companyId) throw new Error("Error de sesión. Recarga la página.");
                await seedFromUrl(currentUser.companyId, selectedOption.file);
            }
            
            // 🔥 ÉXITO: PASAMOS AL PASO 3 (CELEBRACIÓN)
            setStep(3);
            triggerCelebration(); 

        } catch (err) {
            setError("Error cargando productos: " + err.message);
        }
    };

    return (
        <div className="min-h-screen flex bg-sys-50">
            
            {/* IZQUIERDA: Branding Ejecutivo */}
            <div className="hidden lg:flex w-1/2 bg-slate-900 text-white flex-col justify-between p-12 relative overflow-hidden border-r border-slate-800">
                <div className="absolute top-0 right-0 w-96 h-96 bg-brand/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl translate-y-1/3 -translate-x-1/3"></div>
                
                <div className="z-10">
                    <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
                        <Zap className="text-brand fill-brand" /> NOAR POS
                    </h1>
                    <p className="mt-2 text-slate-400 text-sm font-mono uppercase tracking-widest">Enterprise Edition</p>
                </div>

                <div className="z-10 max-w-md">
                    <div className="mb-8 inline-flex items-center gap-3 bg-white/5 border border-white/10 px-4 py-2 rounded-full backdrop-blur-sm">
                        <UserCheck size={16} className="text-brand"/>
                        <span className="text-xs font-bold uppercase tracking-wide text-white/90">Representante Oficial: Valeria Gaitan</span>
                    </div>

                    <h2 className="text-4xl font-bold mb-6 leading-tight">
                        Alta de Cliente <span className="text-brand">Premium</span>.
                    </h2>
                    <div className="space-y-4 text-slate-300">
                        <div className="flex items-center gap-3">
                            <CheckCircle2 className="text-brand" /> <span>Configuración Prioritaria</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <CheckCircle2 className="text-brand" /> <span>Base de Datos Optimizada</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <CheckCircle2 className="text-brand" /> <span>Soporte Directo Dedicado</span>
                        </div>
                    </div>
                </div>

                <div className="text-xs text-slate-500 z-10 flex justify-between items-center border-t border-white/5 pt-4">
                    <span>© 2025 Noar Technology.</span>
                    <span className="font-mono text-white/20">ID: VG-REP-001</span>
                </div>
            </div>

            {/* DERECHA: Formulario */}
            <div className="w-full lg:w-1/2 flex items-center justify-center p-6 overflow-y-auto">
                <div className="w-full max-w-md space-y-6 py-8">
                    
                    {/* PASO 1: REGISTRO */}
                    {step === 1 && (
                        <div className="animate-in fade-in slide-in-from-right-8 duration-500">
                            <div className="text-center mb-6">
                                <h2 className="text-3xl font-bold text-sys-900">Alta de Nuevo Cliente</h2>
                                <p className="text-sys-500 mt-2 font-medium">Ingresa los datos del comercio.</p>
                            </div>

                            {error && (
                                <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm flex gap-2 items-start mb-6 animate-in shake">
                                    <AlertCircle size={18} className="shrink-0 mt-0.5"/>
                                    {error}
                                </div>
                            )}

                            <form onSubmit={handleRegister} className="space-y-4">
                                {/* LOGO UPLOAD */}
                                <div className="flex justify-center mb-6">
                                    <div className="relative group cursor-pointer">
                                        <div className={cn(
                                            "w-24 h-24 rounded-full border-2 border-dashed flex items-center justify-center overflow-hidden transition-all",
                                            logoPreview ? "border-brand bg-white" : "border-sys-300 bg-sys-50 hover:bg-sys-100"
                                        )}>
                                            {logoPreview ? (
                                                <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="text-center text-sys-400">
                                                    <ImageIcon className="mx-auto mb-1" size={20} />
                                                    <span className="text-[9px] font-bold uppercase">Logo</span>
                                                </div>
                                            )}
                                        </div>
                                        <input 
                                            type="file" 
                                            accept="image/*" 
                                            onChange={handleLogoChange}
                                            className="absolute inset-0 opacity-0 cursor-pointer"
                                        />
                                        <div className="absolute bottom-0 right-0 bg-sys-900 text-white p-1.5 rounded-full shadow-lg">
                                            <Upload size={12} />
                                        </div>
                                    </div>
                                </div>

                                {/* CAMPOS */}
                                <div>
                                    <label className="text-xs font-bold uppercase text-sys-500 ml-1">Nombre del Negocio</label>
                                    <input type="text" required className="w-full input-std" placeholder="Ej: Kiosco El Paso"
                                        value={formData.businessName} onChange={e => setFormData({...formData, businessName: e.target.value})} />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold uppercase text-sys-500 ml-1">Nombre Dueño</label>
                                        <input type="text" required className="w-full input-std" placeholder="Ej: Juan"
                                            value={formData.ownerName} onChange={e => setFormData({...formData, ownerName: e.target.value})} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold uppercase text-sys-500 ml-1">Email</label>
                                        <input type="email" required className="w-full input-std" placeholder="juan@email.com"
                                            value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold uppercase text-sys-500 ml-1">Contraseña</label>
                                        <input type="password" required className="w-full input-std" placeholder="******"
                                            value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold uppercase text-sys-500 ml-1">Repetir</label>
                                        <input type="password" required className="w-full input-std" placeholder="******"
                                            value={formData.confirmPassword} onChange={e => setFormData({...formData, confirmPassword: e.target.value})} />
                                    </div>
                                </div>

                                {/* ANTI-BOT SIMPLE */}
                                <div className="bg-sys-100 p-3 rounded-xl border border-sys-200 flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-sm text-sys-600">
                                        <ShieldCheck size={18} className="text-brand"/>
                                        <span>Confirmar: <strong>{mathChallenge.q}</strong> =</span>
                                    </div>
                                    <input type="number" required className="w-20 input-std text-center font-bold" placeholder="?"
                                        value={formData.captcha} onChange={e => setFormData({...formData, captcha: e.target.value})} />
                                </div>

                                <Button type="submit" disabled={loading} className="w-full py-4 text-base shadow-xl shadow-brand/20 bg-slate-900 hover:bg-black text-white transition-all hover:scale-[1.02]">
                                    {loading ? <Loader2 className="animate-spin"/> : <>Registrar Comercio <ArrowRight size={18} className="ml-2"/></>}
                                </Button>
                            </form>
                        </div>
                    )}

                    {/* PASO 2: SEEDER */}
                    {step === 2 && (
                        <div className="animate-in fade-in slide-in-from-right-8 duration-500">
                            <div className="text-center mb-8">
                                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600 border-4 border-white shadow-lg relative">
                                    <CheckCircle2 size={40} />
                                    {logoPreview && <img src={logoPreview} className="absolute inset-0 w-full h-full object-cover rounded-full opacity-50" alt="" />}
                                </div>
                                <h2 className="text-2xl font-bold text-sys-900">Cuenta Creada con Éxito</h2>
                                <p className="text-sys-500 mt-2">Selecciona la plantilla inicial para <b>{formData.businessName}</b>.</p>
                            </div>

                            {isSeeding ? (
                                <div className="text-center py-12 bg-white rounded-2xl border border-sys-200 shadow-lg px-6 relative overflow-hidden">
                                    <div className="absolute top-0 left-0 w-full h-1 bg-sys-100">
                                        <div className="h-full bg-brand animate-[loading_2s_ease-in-out_infinite]"></div>
                                    </div>
                                    <Loader2 className="animate-spin mx-auto text-brand mb-4" size={48} />
                                    <h3 className="text-lg font-bold text-sys-800">Inicializando Base de Datos...</h3>
                                    <p className="text-sm text-sys-500 mt-2 font-medium animate-pulse">{loadingMsg}</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {CATALOG_OPTIONS.map((rubro) => (
                                        <div 
                                            key={rubro.id}
                                            onClick={() => setSelectedOption(rubro)}
                                            className={cn(
                                                "flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all hover:shadow-md active:scale-95",
                                                selectedOption?.id === rubro.id ? "border-brand bg-brand/5 ring-1 ring-brand" : "border-sys-200 bg-white hover:border-brand/50"
                                            )}
                                        >
                                            <div className={cn("w-12 h-12 rounded-lg flex items-center justify-center shrink-0 transition-colors", selectedOption?.id === rubro.id ? "bg-brand text-white" : "bg-sys-100 text-sys-500")}>
                                                <rubro.icon size={24} />
                                            </div>
                                            <div className="flex-1">
                                                <h4 className="font-bold text-sys-900 text-sm">{rubro.name}</h4>
                                                <p className="text-xs text-sys-500 leading-tight mt-0.5">{rubro.desc}</p>
                                            </div>
                                            <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center", selectedOption?.id === rubro.id ? "border-brand" : "border-sys-300")}>
                                                {selectedOption?.id === rubro.id && <div className="w-2.5 h-2.5 rounded-full bg-brand" />}
                                            </div>
                                        </div>
                                    ))}

                                    <Button onClick={handleFinish} disabled={!selectedOption} className="w-full py-4 mt-6 text-base bg-brand hover:bg-brand-dark text-white shadow-xl shadow-brand/20 transition-all hover:-translate-y-1">
                                        {selectedOption?.file ? "Cargar Catálogo y Finalizar" : "Finalizar Configuración"} <ArrowRight size={18} className="ml-2"/>
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 🔥 PASO 3: BIENVENIDA (FIESTA) */}
                    {step === 3 && (
                        <div className="animate-in zoom-in duration-500 text-center py-10">
                            <div className="w-24 h-24 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-6 text-yellow-600 shadow-xl shadow-yellow-100/50 animate-bounce">
                                <PartyPopper size={48} />
                            </div>
                            
                            <h2 className="text-4xl font-black text-sys-900 mb-2">¡Activación Exitosa!</h2>
                            <p className="text-sys-500 text-lg mb-8 max-w-xs mx-auto">
                                La licencia para <strong>{formData.businessName}</strong> está activa.
                            </p>

                            <div className="bg-sys-50 p-6 rounded-2xl border border-sys-200 mb-8 text-left space-y-3">
                                <div className="flex gap-3 items-center text-sys-700">
                                    <CheckCircle2 size={18} className="text-green-500" /> <span>Usuario Admin Configurado</span>
                                </div>
                                <div className="flex gap-3 items-center text-sys-700">
                                    <CheckCircle2 size={18} className="text-green-500" /> <span>Base de Datos Lista</span>
                                </div>
                                {selectedOption?.file && (
                                    <div className="flex gap-3 items-center text-sys-700">
                                        <CheckCircle2 size={18} className="text-green-500" /> <span>Stock Inicial Cargado</span>
                                    </div>
                                )}
                            </div>

                            <Button 
                                onClick={() => navigate('/')} 
                                className="w-full h-16 text-xl bg-sys-900 hover:bg-black text-white shadow-2xl shadow-sys-900/30 transition-all hover:scale-105"
                            >
                                Acceder al Panel <ArrowRight size={24} className="ml-2"/>
                            </Button>
                        </div>
                    )}

                </div>
            </div>

            <style>{`
                .input-std { width: 100%; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 0.75rem; padding: 0.8rem 1rem; font-size: 0.95rem; outline: none; transition: all 0.2s; color: #1E293B; font-weight: 500; }
                .input-std:focus { border-color: #0F172A; box-shadow: 0 0 0 3px rgba(15,23,42,0.05); background: white; }
                @keyframes loading { 0% { width: 0%; margin-left: 0; } 50% { width: 100%; margin-left: 0; } 100% { width: 0%; margin-left: 100%; } }
            `}</style>
        </div>
    );
};