import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    Store, Zap, ArrowRight, CheckCircle2, Loader2, Package, 
    ShoppingBag, AlertCircle, Upload, Image as ImageIcon, ShieldCheck,
    PartyPopper, UserCheck, LayoutGrid, MapPin
} from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, updateDoc } from 'firebase/firestore';
import { storage, db } from '../../../database/firebase'; 

// 🔥 SERVICIOS Y STORES
import { authService } from '../services/authService'; 
import { useAuthStore } from '../store/useAuthStore';
import { useDbSeeder } from '../../../core/hooks/useDbSeeder';

import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import confetti from 'canvas-confetti'; 

// 🏢 PLANES DE NEGOCIO
const PLAN_OPTIONS = [
    { id: 'single', name: 'Plan Comercio', icon: Store, desc: '1 Sucursal', max: 1 },
    { id: 'multi', name: 'Plan Enterprise', icon: LayoutGrid, desc: 'Multi-Sucursal (Hasta 10)', max: 10 },
];

// 📦 OPCIONES DE CATÁLOGO INICIAL
const CATALOG_OPTIONS = [
    { id: 'custom', name: 'Importar Excel Maestro', icon: Upload, file: null, desc: 'Subir archivo con precios y códigos propios' },
    { id: 'kiosco', name: 'Plantilla Maxikiosco', icon: ShoppingBag, file: '/seeders/catalogo.csv', desc: 'Cargar ~2500 productos base' },
    { id: 'otro', name: 'Empezar de Cero', icon: Package, file: null, desc: 'Sin productos iniciales' },
];

export const ValeriaRegisterPage = () => {
    const navigate = useNavigate();
    const { seedFromUrl, loadingMsg, isSeeding } = useDbSeeder();

    const [step, setStep] = useState(1); // 1: Datos, 2: Sucursales (Solo Enterprise), 3: Catálogo, 4: Éxito
    
    // Estados del Formulario
    const [formData, setFormData] = useState({
        businessName: '',
        email: '',
        password: '',
        confirmPassword: '',
        ownerName: '',
        planType: 'single', 
        branchesCount: 1,   
        captcha: '' 
    });

    // Nombres de Sucursales (Solo Enterprise)
    const [branchNames, setBranchNames] = useState(['Sucursal Central']);

    const [logoFile, setLogoFile] = useState(null);
    const [logoPreview, setLogoPreview] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedOption, setSelectedOption] = useState(CATALOG_OPTIONS[0]);

    // Desafío matemático
    const [mathChallenge] = useState({ 
        q: `${Math.floor(Math.random() * 5) + 1} + ${Math.floor(Math.random() * 5) + 1}`, 
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

    // --- MANEJO DE SELECCIÓN DE PLAN ---
    const handlePlanSelect = (plan) => {
        const count = plan.id === 'single' ? 1 : 2; // Mínimo 2 para enterprise
        setFormData({ ...formData, planType: plan.id, branchesCount: count });
        
        // Regenerar array de nombres
        const names = Array(count).fill('').map((_, i) => i === 0 ? 'Sucursal Central' : `Sucursal ${i + 1}`);
        setBranchNames(names);
    };

    const handleBranchCountChange = (count) => {
        setFormData({ ...formData, branchesCount: count });
        // Ajustar array de nombres manteniendo los que ya escribió
        const newNames = [...branchNames];
        if (count > newNames.length) {
            for (let i = newNames.length; i < count; i++) newNames.push(`Sucursal ${i + 1}`);
        } else {
            newNames.length = count;
        }
        setBranchNames(newNames);
    };

    const handleBranchNameChange = (index, value) => {
        const newNames = [...branchNames];
        newNames[index] = value;
        setBranchNames(newNames);
    };

    // --- PASO 1: VALIDACIÓN Y AVANCE ---
    const handleNextStep = (e) => {
        e.preventDefault();
        setError('');

        if (formData.password !== formData.confirmPassword) return setError("Las contraseñas no coinciden.");
        if (formData.password.length < 6) return setError("La contraseña debe tener al menos 6 caracteres.");
        if (parseInt(formData.captcha) !== realAnswer) return setError("La verificación anti-robot es incorrecta.");
        
        // Si es Enterprise, vamos al paso de configuración de sucursales
        if (formData.planType === 'multi') {
            setStep(2);
        } else {
            // Si es Single, registramos directo
            handleRegister();
        }
    };

    // --- REGISTRO FINAL (DESDE PASO 1 O 2) ---
    const handleRegister = async (e) => {
        if (e) e.preventDefault();
        setLoading(true);
        setError('');

        try {
            // Preparar payload de sucursales
            const finalBranches = formData.planType === 'single' 
                ? ['Sucursal Central'] 
                : branchNames;

            // 1. REGISTRO ATÓMICO EN FIREBASE
            // 🔥 AQUÍ ESTÁ EL CAMBIO: Forzamos el rol 'OWNER'
            await authService.register({
                email: formData.email,
                password: formData.password,
                name: formData.ownerName,
                companyName: formData.businessName,
                branchCount: formData.branchesCount,
                branchNames: finalBranches, 
                role: 'OWNER' // 👑 El creador de la cuenta ES el dueño
            });

            // 2. AUTO-LOGIN
            const userProfile = await authService.login(formData.email, formData.password);
            
            // 3. SUBIR LOGO
            if (userProfile && logoFile) {
                try {
                    const storageRef = ref(storage, `companies/${userProfile.companyId}/logo/brand_logo`);
                    await uploadBytes(storageRef, logoFile);
                    const logoUrl = await getDownloadURL(storageRef);
                    await updateDoc(doc(db, 'companies', userProfile.companyId), { logoUrl });
                } catch (logoErr) { console.error("Logo error:", logoErr); }
            }

            setStep(3); // Ir a Catálogo

        } catch (err) {
            console.error(err);
            if (err.code === 'auth/email-already-in-use') {
                setError("Este correo electrónico ya está registrado.");
            } else {
                setError("Error al crear la cuenta: " + err.message);
            }
            // Si falló en paso 2, volvemos para que corrija
            if (step === 2) setStep(2); 
            else setStep(1);
        } finally {
            setLoading(false);
        }
    };

    // --- PASO 3: CARGA DE MAESTROS ---
    const handleFinish = async () => {
        if (!selectedOption) return;
        
        try {
            if (selectedOption.file) {
                const currentUser = useAuthStore.getState().user;
                if (!currentUser?.companyId) throw new Error("Sesión no detectada.");
                await seedFromUrl(currentUser.companyId, selectedOption.file);
            }
            
            setStep(4);
            triggerCelebration(); 
        } catch (err) {
            setError("Error configurando catálogo: " + err.message);
        }
    };

    return (
        <div className="min-h-screen flex bg-sys-50 font-sans">
            
            {/* IZQUIERDA: Branding */}
            <div className="hidden lg:flex w-1/2 bg-slate-900 text-white flex-col justify-between p-12 relative overflow-hidden border-r border-slate-800">
                <div className="absolute top-0 right-0 w-96 h-96 bg-brand/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
                
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
                        <div className="flex items-center gap-3"><CheckCircle2 className="text-brand" /> <span>Multi-Sucursal Nativo</span></div>
                        <div className="flex items-center gap-3"><CheckCircle2 className="text-brand" /> <span>Inventario Distribuido</span></div>
                        <div className="flex items-center gap-3"><CheckCircle2 className="text-brand" /> <span>Auditoría en Tiempo Real</span></div>
                    </div>
                </div>

                <div className="text-xs text-slate-500 z-10 border-t border-white/5 pt-4">
                    <span>© 2026 Noar Technology. ID: VG-REP-001</span>
                </div>
            </div>

            {/* DERECHA: Formulario */}
            <div className="w-full lg:w-1/2 flex items-center justify-center p-6 overflow-y-auto bg-white">
                <div className="w-full max-w-md space-y-6 py-8">
                    
                    {/* PASO 1: DATOS BÁSICOS */}
                    {step === 1 && (
                        <div className="animate-in fade-in slide-in-from-right-8 duration-500">
                            <div className="text-center mb-6">
                                <h2 className="text-3xl font-bold text-sys-900">Configurar Licencia</h2>
                                <p className="text-sys-500 mt-2 font-medium">Define la estructura del comercio.</p>
                            </div>

                            {error && (
                                <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm flex gap-2 items-start mb-6 animate-in shake">
                                    <AlertCircle size={18} className="shrink-0 mt-0.5"/> {error}
                                </div>
                            )}

                            <form onSubmit={handleNextStep} className="space-y-4">
                                
                                {/* PLAN SELECTOR */}
                                <div className="grid grid-cols-2 gap-4">
                                    {PLAN_OPTIONS.map((plan) => (
                                        <div 
                                            key={plan.id}
                                            onClick={() => handlePlanSelect(plan)}
                                            className={cn(
                                                "p-4 rounded-xl border-2 cursor-pointer transition-all text-center flex flex-col items-center gap-2 hover:shadow-md",
                                                formData.planType === plan.id ? "border-brand bg-brand/5 ring-1 ring-brand" : "border-sys-200 bg-white"
                                            )}
                                        >
                                            <plan.icon size={24} className={formData.planType === plan.id ? "text-brand" : "text-sys-400"} />
                                            <div>
                                                <p className="text-xs font-bold uppercase">{plan.name}</p>
                                                <p className="text-[10px] text-sys-500">{plan.desc}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* LOGO UPLOAD */}
                                <div className="flex justify-center my-6">
                                    <div className="relative group cursor-pointer">
                                        <div className={cn(
                                            "w-20 h-20 rounded-full border-2 border-dashed flex items-center justify-center overflow-hidden transition-all",
                                            logoPreview ? "border-brand bg-white" : "border-sys-300 bg-sys-50 hover:bg-sys-100"
                                        )}>
                                            {logoPreview ? (
                                                <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="text-center text-sys-400">
                                                    <ImageIcon className="mx-auto mb-1" size={18} />
                                                    <span className="text-[8px] font-bold uppercase">Logo</span>
                                                </div>
                                            )}
                                        </div>
                                        <input type="file" accept="image/*" onChange={handleLogoChange} className="absolute inset-0 opacity-0 cursor-pointer" />
                                        <div className="absolute bottom-0 right-0 bg-sys-900 text-white p-1 rounded-full shadow-lg"><Upload size={10} /></div>
                                    </div>
                                </div>

                                {/* INPUTS */}
                                <div>
                                    <label className="text-xs font-bold uppercase text-sys-500 ml-1">Nombre del Negocio</label>
                                    <input type="text" required className="w-full input-std" placeholder="Ej: Supermercados del Sur"
                                        value={formData.businessName} onChange={e => setFormData({...formData, businessName: e.target.value})} />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold uppercase text-sys-500 ml-1">Dueño / Titular</label>
                                        <input type="text" required className="w-full input-std" placeholder="Nombre Completo"
                                            value={formData.ownerName} onChange={e => setFormData({...formData, ownerName: e.target.value})} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold uppercase text-sys-500 ml-1">Email Admin</label>
                                        <input type="email" required className="w-full input-std" placeholder="admin@empresa.com"
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

                                <div className="bg-sys-100 p-3 rounded-xl border border-sys-200 flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-sm text-sys-600">
                                        <ShieldCheck size={18} className="text-brand"/>
                                        <span>Confirmar: <strong>{mathChallenge.q}</strong> =</span>
                                    </div>
                                    <input type="number" required className="w-20 input-std text-center font-bold" placeholder="?"
                                        value={formData.captcha} onChange={e => setFormData({...formData, captcha: e.target.value})} />
                                </div>

                                <Button type="submit" className="w-full py-4 text-base shadow-xl shadow-brand/20 bg-slate-900 hover:bg-black text-white transition-all hover:scale-[1.02]">
                                    Continuar <ArrowRight size={18} className="ml-2"/>
                                </Button>
                            </form>
                        </div>
                    )}

                    {/* PASO 2: CONFIGURACIÓN SUCURSALES (Solo Enterprise) */}
                    {step === 2 && (
                        <div className="animate-in fade-in slide-in-from-right-8 duration-500">
                            <div className="text-center mb-6">
                                <h2 className="text-3xl font-bold text-sys-900">Estructura Enterprise</h2>
                                <p className="text-sys-500 mt-2 font-medium">Define tus sucursales.</p>
                            </div>

                            <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 mb-6">
                                <div className="flex justify-between items-center mb-4">
                                    <label className="text-sm font-bold uppercase text-blue-800">Cantidad de Sucursales</label>
                                    <span className="text-lg font-black bg-white text-blue-600 px-3 py-1 rounded-lg border border-blue-200 shadow-sm">
                                        {formData.branchesCount}
                                    </span>
                                </div>
                                <input 
                                    type="range" min="2" max="10" 
                                    value={formData.branchesCount}
                                    onChange={(e) => handleBranchCountChange(parseInt(e.target.value))}
                                    className="w-full accent-brand h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>

                            <div className="space-y-3 mb-8 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                                {branchNames.map((name, idx) => (
                                    <div key={idx} className="flex items-center gap-3">
                                        <div className="w-8 h-10 flex items-center justify-center bg-sys-100 rounded text-sys-500 font-bold text-xs border border-sys-200">
                                            S{idx + 1}
                                        </div>
                                        <div className="flex-1 relative">
                                            <MapPin size={14} className="absolute left-3 top-3 text-sys-400"/>
                                            <input 
                                                type="text" 
                                                className="w-full pl-9 pr-4 py-2.5 bg-white border border-sys-200 rounded-xl text-sm font-medium focus:border-brand outline-none"
                                                value={name}
                                                onChange={(e) => handleBranchNameChange(idx, e.target.value)}
                                                placeholder={`Nombre Sucursal ${idx + 1}`}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex gap-3">
                                <Button variant="ghost" onClick={() => setStep(1)} className="flex-1">Atrás</Button>
                                <Button onClick={handleRegister} disabled={loading} className="flex-[2] bg-brand hover:bg-brand-dark text-white shadow-lg">
                                    {loading ? <Loader2 className="animate-spin"/> : "Finalizar Registro"}
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* PASO 3: CATÁLOGO MAESTRO */}
                    {step === 3 && (
                        <div className="animate-in fade-in slide-in-from-right-8 duration-500">
                            <div className="text-center mb-8">
                                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600 border-4 border-white shadow-lg relative">
                                    <CheckCircle2 size={40} />
                                </div>
                                <h2 className="text-2xl font-bold text-sys-900">¡Cuenta Activa!</h2>
                                <p className="text-sys-500 mt-2">Ahora definamos el <b>Catálogo Maestro</b>.</p>
                            </div>

                            {isSeeding ? (
                                <div className="text-center py-12 bg-white rounded-2xl border border-sys-200 shadow-lg px-6 relative overflow-hidden">
                                    <div className="absolute top-0 left-0 w-full h-1 bg-sys-100">
                                        <div className="h-full bg-brand animate-[loading_2s_ease-in-out_infinite]"></div>
                                    </div>
                                    <Loader2 className="animate-spin mx-auto text-brand mb-4" size={48} />
                                    <h3 className="text-lg font-bold text-sys-800">Procesando Catálogo...</h3>
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
                                        {selectedOption?.file ? "Cargar y Continuar" : "Continuar al Dashboard"} <ArrowRight size={18} className="ml-2"/>
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* PASO 4: ÉXITO */}
                    {step === 4 && (
                        <div className="animate-in zoom-in duration-500 text-center py-10">
                            <div className="w-24 h-24 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-6 text-yellow-600 shadow-xl shadow-yellow-100/50 animate-bounce">
                                <PartyPopper size={48} />
                            </div>
                            
                            <h2 className="text-4xl font-black text-sys-900 mb-2">¡Todo Listo!</h2>
                            <p className="text-sys-500 text-lg mb-8 max-w-xs mx-auto">
                                Sistema <strong>{formData.planType === 'multi' ? 'Enterprise' : 'Comercio'}</strong> configurado.
                            </p>

                            <Button onClick={() => navigate('/')} className="w-full h-16 text-xl bg-sys-900 hover:bg-black text-white shadow-2xl shadow-sys-900/30 transition-all hover:scale-105">
                                Ingresar al Sistema <ArrowRight size={24} className="ml-2"/>
                            </Button>
                        </div>
                    )}

                </div>
            </div>

            <style>{`
                .input-std { width: 100%; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 0.75rem; padding: 0.8rem 1rem; font-size: 0.95rem; outline: none; transition: all 0.2s; color: #1E293B; font-weight: 500; }
                .input-std:focus { border-color: #0F172A; box-shadow: 0 0 0 3px rgba(15,23,42,0.05); background: white; }
                @keyframes loading { 0% { width: 0%; margin-left: 0; } 50% { width: 100%; margin-left: 0; } 100% { width: 0%; margin-left: 100%; } }
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 4px; }
            `}</style>
        </div>
    );
};