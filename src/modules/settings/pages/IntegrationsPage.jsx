import React, { useState, useEffect } from 'react';
import { 
    CreditCard, Save, HelpCircle, CheckCircle2, 
    AlertCircle, ExternalLink, Eye, EyeOff, Plug, FileText, ScrollText, Download, Key,
    Search, X, Loader2, Info, Link as LinkIcon, Terminal, Smartphone, MonitorSmartphone,
    HardDrive, Users, Building2, ShieldCheck, Keyboard, Scale, Calendar, MapPin
} from 'lucide-react';
import { doc, getDoc, setDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import forge from 'node-forge'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 

import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

const API_URL = import.meta.env.VITE_API_URL || "https://us-central1-salvadorpos1.cloudfunctions.net/api";

// ==================================================================================
// 🎓 MODAL TUTORIAL (CONTENIDO TÉCNICO DETALLADO)
// ==================================================================================
const TutorialModal = ({ isOpen, onClose, type }) => {
    if (!isOpen) return null;

    const stepsMP = [
        { 
            title: "1. Panel de Desarrolladores", 
            desc: "Ingresa a 'Tus Integraciones' en Mercado Pago Developers con la cuenta titular del negocio.",
            link: "https://www.mercadopago.com.ar/developers/panel",
            icon: ExternalLink
        },
        { 
            title: "2. Crear Aplicación", 
            desc: "Crea una nueva aplicación. Selecciona 'Pagos Presenciales' (QR/Point). Nombre sugerido: 'NOAR POS - [Sucursal]'.",
            icon: Plug
        },
        { 
            title: "3. Credenciales de Producción", 
            desc: "En el menú lateral, ve a 'Credenciales de Producción'. Copia el 'Access Token' (empieza con APP_USR-...).",
            icon: Key
        },
        { 
            title: "4. Vincular Sucursal", 
            desc: "Pega el Token en NOAR POS y presiona 'Detectar Hardware'. Asegúrate de haber creado las Cajas QR y Sucursales en tu cuenta de MP previamente.",
            icon: Search
        }
    ];

    const stepsAFIP = [
        {
            title: "1. Generar Pedido (CSR)", 
            desc: "En NOAR POS, completá CUIT y Razón Social. Presioná 'Generar Pedido .CSR'. Se descargará una llave privada única para esta sucursal. No la borres.",
            icon: Download
        },
        { 
            title: "2. Obtener Certificado (.CRT)", 
            desc: "Entrá a AFIP con Clave Fiscal -> 'Administración de Certificados Digitales'. Creá un Alias (ej: 'noar-sucursal-1'), subí el archivo .CSR que descargaste y descargá el Certificado (.crt).",
            link: "https://auth.afip.gob.ar/contribuyente_/login.xhtml",
            icon: ExternalLink
        },
        { 
            title: "3. Vincular el WebService (VITAL)", 
            desc: "En el portal de AFIP entrá a 'Administrador de Relaciones de Clave Fiscal' -> 'Nueva Relación' -> 'Buscar'. Seleccioná 'AFIP' -> 'WebServices' -> 'Facturación Electrónica'. En 'Representante', buscá el Alias que creaste en el paso anterior y confirmá.",
            icon: LinkIcon
        },
        { 
            title: "4. Punto de Venta Web", 
            desc: "En 'Reg. Tributario' -> 'Puntos de Venta', debés crear uno nuevo de tipo 'RECEPCIÓN POR WEBSERVICES' (Factura Electrónica). Usá ese número de punto de venta en la configuración de aquí abajo.",
            icon: MapPin
        },
        { 
            title: "5. Cargar en NOAR POS", 
            desc: "Abrí el archivo .crt descargado con el Bloc de Notas, copiá todo el texto y pegalo en el cuadro verde. ¡Dale a Guardar y ya podés facturar!",
            icon: ScrollText
        }
    ];

    const stepsClover = [
        {
            title: "1. Clover Dashboard",
            desc: "Inicia sesión en tu panel administrativo de Clover (Web).",
            link: "https://www.clover.com/dashboard/login",
            icon: ExternalLink
        },
        { 
            title: "2. Obtener Merchant ID", 
            desc: "El MID es el código alfanumérico de 13 caracteres que aparece en la URL o en 'Setup' > 'Merchants'.",
            icon: Search
        },
        { 
            title: "3. API Token", 
            desc: "Ve a 'Setup' > 'API Tokens'. Genera un nuevo token con permisos de Lectura/Escritura en Pagos y Ordenes.",
            icon: Key
        }
    ];

    const steps = type === 'MP' ? stepsMP : type === 'AFIP' ? stepsAFIP : stepsClover;
    const colorClass = type === 'MP' ? "bg-[#009EE3]" : type === 'CLOVER' ? "bg-[#28a745]" : "bg-[#2C3E50]";

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-lg rounded-[2rem] shadow-2xl overflow-hidden border border-sys-200">
                <div className={cn("p-6 text-white flex justify-between items-center shadow-lg", colorClass)}>
                    <div className="flex items-center gap-3">
                        <HelpCircle size={24}/>
                        <div>
                            <h3 className="font-bold text-lg uppercase tracking-tight">Guía de Configuración</h3>
                            <p className="text-white/80 text-[10px] font-bold uppercase tracking-widest">{type}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="hover:bg-white/20 p-1 rounded-full transition-all"><X size={20}/></button>
                </div>
                
                <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar bg-sys-50/30">
                    <div className="space-y-6 relative">
                        <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-sys-200 -z-10"></div>
                        {steps.map((step, i) => (
                            <div key={i} className="flex gap-4 group">
                                <div className="w-10 h-10 rounded-xl bg-white border-2 border-sys-200 flex items-center justify-center shrink-0 shadow-sm z-10">
                                    <step.icon size={18} className="text-sys-600"/>
                                </div>
                                <div className="bg-white p-5 rounded-2xl border border-sys-100 flex-1 shadow-sm group-hover:border-sys-300 transition-all">
                                    <h4 className="font-bold text-sm text-sys-900 mb-1 uppercase">{step.title}</h4>
                                    <p className="text-xs text-sys-500 leading-relaxed">{step.desc}</p>
                                    {step.link && (
                                        <a href={step.link} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-black text-blue-600 hover:text-blue-800 uppercase tracking-widest">
                                            Ir al sitio <ExternalLink size={12}/>
                                        </a>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="p-6 bg-white border-t border-sys-100">
                    <Button onClick={onClose} className="w-full bg-sys-900 text-white font-bold h-11 text-xs tracking-widest shadow-lg uppercase">Cerrar Guía</Button>
                </div>
            </div>
        </div>
    );
};

// ==================================================================================
// 🧩 COMPONENTES UI (SWITCH & INPUTS)
// ==================================================================================
const Switch = ({ active, onChange, color = "bg-brand" }) => (
    <button 
        type="button"
        onClick={() => onChange(!active)}
        className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
            active ? color : "bg-sys-200"
        )}
    >
        <span className={cn(
            "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
            active ? "translate-x-5" : "translate-x-0"
        )} />
    </button>
);

const SecretInput = ({ label, value, onChange, placeholder }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="mb-4">
      <label className="text-[10px] font-black text-sys-500 uppercase tracking-widest ml-1 mb-2 block">{label}</label>
      <div className="relative group">
        <input 
          type={show ? "text" : "password"} 
          className="w-full bg-sys-50 border border-sys-200 rounded-xl pl-3 pr-10 py-3 text-sm outline-none focus:border-brand focus:bg-white transition-all font-mono text-sys-800 shadow-inner"
          placeholder={placeholder}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-3 text-sys-400 hover:text-sys-900">
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
};

const MPIcon = () => (
    <svg viewBox="0 0 100 100" className="h-8 w-8">
        <circle cx="50" cy="50" r="50" fill="#009EE3"/>
        <path d="M75 35L45 65L25 50" stroke="white" strokeWidth="8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
);

// ==================================================================================
// 🚀 PÁGINA PRINCIPAL
// ==================================================================================
export const IntegrationsPage = () => {
    const { user, activeBranchId, activeBranchName } = useAuthStore();
    
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState('idle'); 
    const [tutorialOpen, setTutorialOpen] = useState(null);
    const [generatingCsr, setGeneratingCsr] = useState(false);

    const [companyUsers, setCompanyUsers] = useState([]);
    const [posList, setPosList] = useState([]);      
    const [pointList, setPointList] = useState([]);   
    
    const [mpConfig, setMpConfig] = useState({ accessToken: '', userId: '', isActive: false });
    
    // 🔥 ESTADO AFIP MEJORADO CON TAXCONDITION Y DATOS EXTRA
    const [afipConfig, setAfipConfig] = useState({ 
        cuit: '', 
        ptoVta: 1, 
        razonSocial: '', 
        cert: '', 
        key: '', 
        isActive: false,
        taxCondition: 'MONOTRIBUTO',
        iibb: '',       // Nuevo campo
        inicioAct: ''   // Nuevo campo
    });
    
    const [cloverConfig, setCloverConfig] = useState({ merchantId: '', apiToken: '', isActive: false });
    const [assignments, setAssignments] = useState({});

    useEffect(() => { if (user?.companyId && activeBranchId) loadBranchFullData(); }, [user?.companyId, activeBranchId]);

    const loadBranchFullData = async () => {
        setLoading(true);
        try {
            // 1. Cargar TODOS los usuarios de la compañía
            const usersSnap = await getDocs(query(collection(db, 'users'), where('companyId', '==', user.companyId)));
            const allUsers = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));

            // 2. 🔥 FILTRAR USUARIOS POR SUCURSAL ACTIVA
            // Mostramos solo:
            // a) Usuarios asignados explícitamente a esta sucursal (branchId === activeBranchId)
            // b) Dueños (role === 'owner') - para que no se queden fuera de la config
            // c) Admins globales (role === 'admin')
            const branchUsers = allUsers.filter(u => 
                u.branchId === activeBranchId || 
                u.role === 'owner' || 
                u.role === 'admin'
            );
            
            setCompanyUsers(branchUsers);

            // 3. Cargar configuraciones AISLADAS de la sucursal
            const branchRef = `companies/${user.companyId}/branches/${activeBranchId}/integrations`;
            const [mpDoc, afipDoc, cloverDoc, assignDoc] = await Promise.all([
                getDoc(doc(db, branchRef, 'mercadopago')),
                getDoc(doc(db, branchRef, 'afip')),
                getDoc(doc(db, branchRef, 'clover')),
                getDoc(doc(db, branchRef, 'assignments'))
            ]);

            if (mpDoc.exists()) {
                const d = mpDoc.data();
                setMpConfig(d);
                if (d.accessToken) fetchMPHardware(d.accessToken);
            } else setMpConfig({ accessToken: '', userId: '', isActive: false });

            if (afipDoc.exists()) {
                const data = afipDoc.data();
                setAfipConfig(prev => ({
                    ...prev,
                    ...data,
                    // Asegurar valores por defecto si no existen
                    taxCondition: data.taxCondition || 'MONOTRIBUTO',
                    iibb: data.iibb || '',
                    inicioAct: data.inicioAct || ''
                }));
            }

            if (cloverDoc.exists()) setCloverConfig(cloverDoc.data());
            else setCloverConfig({ merchantId: '', apiToken: '', isActive: false });

            if (assignDoc.exists()) setAssignments(assignDoc.data());
            else setAssignments({});

        } catch (error) { console.error(error); } finally { setLoading(false); }
    };

    const fetchMPHardware = async (token) => {
        try {
            const storesRes = await fetch(`${API_URL}/get-mp-stores`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accessToken: token, companyId: user.companyId })
            });
            const storesData = await storesRes.json();
            if (storesData.cajas) setPosList(storesData.cajas);

            const pointsRes = await fetch(`${API_URL}/get-mp-terminals`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accessToken: token })
            });
            const pointsData = await pointsRes.json();
            if (pointsData.devices) setPointList(pointsData.devices.filter(d => d.id && d.id !== 'undefined'));

        } catch (e) { console.warn("Hardware fetch failed", e); }
    };

    const handleDiscoveryMP = async () => {
        if (!mpConfig.accessToken) return alert("⚠️ Ingrese el Access Token de la sucursal primero.");
        setLoading(true);
        await fetchMPHardware(mpConfig.accessToken);
        setLoading(false);
        alert("✅ Hardware de Mercado Pago sincronizado.");
    };

    const updateAssignment = (uid, field, value) => {
        setAssignments(prev => ({ ...prev, [uid]: { ...prev[uid], [field]: value } }));
    };

    // Reemplaza esta función dentro de IntegrationsPage.jsx

const handleGenerateCSR = async () => {
    if (!afipConfig.cuit || !afipConfig.razonSocial) return alert("⚠️ CUIT y Razón Social requeridos.");
    setGeneratingCsr(true);
    try {
        // 1. Generar par de llaves RSA
        const keypair = await new Promise((resolve, reject) => {
            forge.pki.rsa.generateKeyPair({ bits: 2048, workers: 2 }, (err, k) => err ? reject(err) : resolve(k));
        });

        const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);
        
        // 2. Crear el pedido de certificación (CSR)
        const csr = forge.pki.createCertificationRequest();
        csr.publicKey = keypair.publicKey;
        csr.setSubject([
            { name: 'commonName', value: afipConfig.razonSocial }, 
            { name: 'serialNumber', value: `CUIT ${afipConfig.cuit}` }, 
            { name: 'countryName', value: 'AR' }, 
            { name: 'organizationName', value: 'SALVADOR POS' }
        ]);
        csr.sign(keypair.privateKey);
        const csrPem = forge.pki.certificationRequestToPem(csr);

        // 🔥 PASO CRÍTICO: Guardar la KEY inmediatamente en Firestore para no perderla
        const branchRef = `companies/${user.companyId}/branches/${activeBranchId}/integrations/afip`;
        await setDoc(doc(db, branchRef), { 
            ...afipConfig, 
            key: privateKeyPem,
            updatedAt: new Date().toISOString() 
        }, { merge: true });

        // Actualizar estado local
        setAfipConfig(prev => ({ ...prev, key: privateKeyPem }));
        
        // 3. Descargar el archivo .csr para el usuario
        const blob = new Blob([csrPem], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `afip_branch_${activeBranchId}.csr`;
        link.click();

        alert("✅ Llave privada generada y guardada. Ahora sube el archivo .csr a AFIP para obtener tu certificado.");
        
    } catch (e) { 
        console.error(e);
        alert("Error al generar los archivos de seguridad."); 
    } finally { 
        setGeneratingCsr(false); 
    }
};
    const handleSaveAll = async (e) => {
        if (e) e.preventDefault();
        
        // 🔒 VALIDACIONES DE SEGURIDAD (BLINDAJE)
        if (afipConfig.isActive) {
            // 1. CUIT Numérico y de 11 dígitos
            const cleanCuit = afipConfig.cuit.replace(/[^0-9]/g, '');
            if (cleanCuit.length !== 11) {
                alert("⚠️ Error: El CUIT debe contener exactamente 11 números.");
                return;
            }
            // 2. Punto de Venta válido
            if (!afipConfig.ptoVta || parseInt(afipConfig.ptoVta) < 1) {
                alert("⚠️ Error: El Punto de Venta debe ser mayor a 0.");
                return;
            }
        }

        setSaving(true);
        try {
            // 🔥 PERSISTENCIA AISLADA POR SUCURSAL
            const branchRef = `companies/${user.companyId}/branches/${activeBranchId}/integrations`;
            
            await Promise.all([
                setDoc(doc(db, branchRef, 'mercadopago'), { ...mpConfig, updatedAt: new Date().toISOString() }),
                setDoc(doc(db, branchRef, 'afip'), { ...afipConfig, updatedAt: new Date().toISOString() }),
                setDoc(doc(db, branchRef, 'clover'), { ...cloverConfig, updatedAt: new Date().toISOString() }),
                setDoc(doc(db, branchRef, 'assignments'), assignments)
            ]);
            
            setStatus('success');
            setTimeout(() => setStatus('idle'), 3000);
        } catch (error) { 
            alert("❌ Error al guardar."); 
            console.error(error);
        } finally { 
            setSaving(false); 
        }
    };

    if (loading) return (
        <div className="h-[70vh] flex flex-col items-center justify-center gap-4">
            <Loader2 className="animate-spin text-brand" size={48} />
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-sys-400">Cargando Sucursal...</p>
        </div>
    );

    return (
        <div className="max-w-6xl mx-auto space-y-8 pb-32 px-4 select-none animate-in fade-in duration-500">
            
            {/* HEADER DE SUCURSAL */}
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-sys-200 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none"><Building2 size={120}/></div>
                <div className="flex items-center gap-4 relative z-10">
                    <div className="w-14 h-14 bg-sys-900 rounded-2xl flex items-center justify-center text-white shadow-lg"><Building2 size={32} /></div>
                    <div>
                        <h2 className="text-3xl font-black text-sys-900 uppercase tracking-tighter leading-none">{activeBranchName}</h2>
                        <p className="text-sys-500 text-[10px] font-black uppercase tracking-[0.2em] mt-2 flex items-center gap-2"><ShieldCheck size={14} className="text-emerald-500"/> Configuración de sucursal aislada</p>
                    </div>
                </div>
                <div className="flex flex-col items-end relative z-10">
                    <span className="text-[9px] font-black text-sys-400 uppercase tracking-widest mb-1">Branch ID</span>
                    <span className="font-mono text-sys-900 text-xs font-bold bg-sys-50 px-2 py-1 rounded border border-sys-200">{activeBranchId}</span>
                </div>
            </header>

            <form onSubmit={handleSaveAll} className="space-y-8">
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* MERCADO PAGO */}
                    <Card className="border border-sys-200 shadow-none hover:border-[#009EE3] transition-all p-8 rounded-[2rem] bg-white">
                        <div className="flex justify-between items-start mb-8">
                            <div className="flex flex-col gap-1">
                                <MPIcon />
                                <h3 className="font-black text-xs text-sys-900 uppercase tracking-widest mt-2">Mercado Pago</h3>
                            </div>
                            <div className="flex flex-col items-end gap-3">
                                <Switch active={mpConfig.isActive} onChange={(val) => setMpConfig({...mpConfig, isActive: val})} color="bg-[#009EE3]" />
                                <button type="button" onClick={() => setTutorialOpen('MP')} className="text-[#009EE3] font-black text-[10px] uppercase tracking-widest hover:underline flex items-center gap-1"><HelpCircle size={10}/> Ver Guía</button>
                            </div>
                        </div>
                        <SecretInput label="Access Token Producion (Sucursal)" placeholder="APP_USR-..." value={mpConfig.accessToken} onChange={(val) => setMpConfig({...mpConfig, accessToken: val})} />
                        <Button type="button" onClick={handleDiscoveryMP} className="w-full bg-sys-900 text-white hover:bg-black h-12 text-[10px] font-black uppercase tracking-widest rounded-xl shadow-lg transition-all">
                            <Search size={16} className="mr-2"/> Detectar Hardware en Cuenta
                        </Button>
                    </Card>

                    {/* CLOVER */}
                    <Card className="border border-sys-200 shadow-none hover:border-[#28a745] transition-all p-8 rounded-[2rem] bg-white">
                        <div className="flex justify-between items-start mb-8">
                            <div className="flex items-center gap-3">
                                <Terminal size={32} className="text-sys-900"/>
                                <h3 className="font-black text-xs text-sys-900 uppercase tracking-widest">Clover Terminal</h3>
                            </div>
                            <div className="flex flex-col items-end gap-3">
                                <Switch active={cloverConfig.isActive} onChange={(val) => setCloverConfig({...cloverConfig, isActive: val})} color="bg-[#28a745]" />
                                <button type="button" onClick={() => setTutorialOpen('CLOVER')} className="text-[#28a745] font-black text-[10px] uppercase tracking-widest hover:underline flex items-center gap-1"><HelpCircle size={10}/> Ver Guía</button>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="text-[10px] font-black text-sys-500 uppercase tracking-widest mb-1.5 block">Merchant ID (MID)</label>
                                <input type="text" className="w-full bg-sys-50 border-2 border-sys-200 rounded-xl px-4 py-3 text-sm font-mono font-black focus:border-[#28a745] outline-none shadow-inner" placeholder="ABC123DEF456" value={cloverConfig.merchantId} onChange={(e) => setCloverConfig({...cloverConfig, merchantId: e.target.value})} />
                            </div>
                            <SecretInput label="Clover API Token" value={cloverConfig.apiToken} onChange={(val) => setCloverConfig({...cloverConfig, apiToken: val})} />
                        </div>
                    </Card>
                </div>

                {/* 👤 MAPEO DE HARDWARE */}
                <Card className="border-2 border-sys-900 shadow-2xl rounded-[2.5rem] overflow-hidden p-0 bg-white">
                    <div className="bg-sys-900 p-6 text-white flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="p-2 bg-white/10 rounded-xl border border-white/20"><MonitorSmartphone size={24}/></div>
                            <div><h3 className="font-black text-xl uppercase tracking-tighter leading-none">Mapeo de Terminales de Pago</h3><p className="text-[10px] font-bold uppercase opacity-50 tracking-[0.2em] mt-1">Designación exclusiva de hardware por operador</p></div>
                        </div>
                    </div>
                    <div className="p-4 overflow-x-auto">
                        <table className="w-full text-left border-separate border-spacing-y-3">
                            <thead><tr className="text-[10px] font-black text-sys-400 uppercase tracking-[0.2em]"><th className="px-6 py-2">Usuario / Cajero</th><th className="px-6 py-2">Caja QR (MP)</th><th className="px-6 py-2">Point Smart (MP)</th><th className="px-6 py-2 text-center">Estado</th></tr></thead>
                            <tbody>
                                {companyUsers.map(userItem => (
                                    <tr key={userItem.uid} className="group">
                                        <td className="px-6 py-4 bg-sys-50 rounded-l-2xl border-y border-l border-sys-200"><div className="flex items-center gap-4"><div className="w-10 h-10 bg-white rounded-full flex items-center justify-center border-2 border-sys-900 font-black text-sm text-sys-900 shadow-sm">{userItem.name?.charAt(0)}</div><div><p className="text-sm font-black text-sys-900 uppercase tracking-tighter leading-none">{userItem.name}</p><p className="text-[10px] font-bold text-sys-400 uppercase tracking-widest mt-1">{userItem.role}</p></div></div></td>
                                        <td className="px-6 py-4 bg-sys-50 border-y border-sys-200"><select className="w-full bg-white border-2 border-sys-200 rounded-xl px-4 py-2 text-[11px] font-black uppercase focus:border-[#009EE3] outline-none shadow-sm cursor-pointer" value={assignments[userItem.uid]?.qrId || ''} onChange={(e) => updateAssignment(userItem.uid, 'qrId', e.target.value)}><option value="">-- NO ASIGNADA --</option>{posList.map(pos => <option key={pos.id} value={pos.external_id}>{pos.name}</option>)}</select></td>
                                        <td className="px-6 py-4 bg-sys-50 border-y border-sys-200"><select className="w-full bg-white border-2 border-sys-200 rounded-xl px-4 py-2 text-[11px] font-black uppercase focus:border-[#009EE3] outline-none shadow-sm cursor-pointer" value={assignments[userItem.uid]?.pointId || ''} onChange={(e) => updateAssignment(userItem.uid, 'pointId', e.target.value)}><option value="">-- NO ASIGNADO --</option>{pointList.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id.slice(-4)})</option>)}</select></td>
                                        <td className="px-6 py-4 bg-sys-50 rounded-r-2xl border-y border-r border-sys-200 text-center">{(assignments[userItem.uid]?.qrId || assignments[userItem.uid]?.pointId) ? <span className="w-10 h-10 bg-emerald-500 text-white rounded-xl flex items-center justify-center mx-auto shadow-lg animate-in zoom-in"><CheckCircle2 size={20}/></span> : <span className="w-10 h-10 bg-sys-200 text-sys-400 rounded-xl flex items-center justify-center mx-auto opacity-30"><Smartphone size={20}/></span>}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>

                {/* AFIP: FORMULARIO BLINDADO CON SELECTOR DE IVA Y DATOS EXTRA */}
                <Card className="border border-sys-200 lg:col-span-2 relative overflow-hidden bg-white p-10 rounded-[2.5rem] shadow-xl">
                     <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none"><ScrollText size={150}/></div>
                     <div className="flex flex-col md:flex-row justify-between items-start mb-10 relative z-10 gap-6">
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 bg-sys-100 rounded-2xl flex items-center justify-center text-sys-900 border-2 border-sys-900 shadow-sm"><ScrollText size={32} /></div>
                            <div>
                                <h3 className="font-black text-2xl text-sys-900 uppercase tracking-tight">Facturación Electrónica AFIP</h3>
                                <p className="text-[10px] font-black text-sys-400 uppercase tracking-widest mt-1">Configuración fiscal exclusiva de la sucursal</p>
                            </div>
                        </div>
                        <div className="flex flex-col items-end gap-3">
                            <Switch active={afipConfig.isActive} onChange={(val) => setAfipConfig({...afipConfig, isActive: val})} color="bg-[#2C3E50]" />
                            <button type="button" onClick={() => setTutorialOpen('AFIP')} className="text-sys-900 font-black text-[10px] uppercase tracking-widest hover:underline flex items-center gap-1"><HelpCircle size={10}/> Ver Guía</button>
                        </div>
                     </div>

                     {afipConfig.isActive && (
                         <div className="grid grid-cols-1 md:grid-cols-12 gap-10 animate-in slide-in-from-top-6 duration-500 relative z-10">
                            <div className="md:col-span-4 space-y-6">
                                
                                {/* SELECTOR DE CONDICIÓN FISCAL */}
                                <div className="bg-sys-50 p-6 rounded-[2rem] border-2 border-sys-100 shadow-inner">
                                    <label className="text-[10px] font-black text-sys-500 uppercase tracking-widest mb-3 block">Condición Fiscal del Negocio</label>
                                    <div className="relative">
                                        <select 
                                            className="w-full bg-white border-2 border-sys-200 rounded-2xl px-5 py-4 font-black text-xs focus:border-sys-900 outline-none shadow-md uppercase text-sys-900 cursor-pointer appearance-none"
                                            value={afipConfig.taxCondition} 
                                            onChange={(e) => setAfipConfig({...afipConfig, taxCondition: e.target.value})}
                                        >
                                            <option value="MONOTRIBUTO">Monotributo / IVA Exento</option>
                                            <option value="RESPONSABLE_INSCRIPTO">Responsable Inscripto (IVA 21%)</option>
                                        </select>
                                        <div className="absolute right-4 top-4 pointer-events-none text-sys-400">▼</div>
                                    </div>
                                    
                                    {afipConfig.taxCondition === 'RESPONSABLE_INSCRIPTO' && (
                                        <div className="mt-4 p-4 bg-blue-50 border-l-4 border-blue-500 rounded-r-xl text-[10px] text-blue-800 leading-relaxed font-medium animate-in fade-in">
                                            <div className="flex items-center gap-2 mb-1 text-blue-900 font-black">
                                                <Scale size={14} /> MODO AUTOMÁTICO ACTIVO
                                            </div>
                                            El sistema <strong>desglosará automáticamente el IVA (21%)</strong> del precio final de venta. Se emitirán Facturas A o B según el cliente.
                                        </div>
                                    )}
                                </div>

                                <div className="bg-sys-50 p-6 rounded-[2rem] border-2 border-sys-100 shadow-inner"><label className="text-[10px] font-black text-sys-500 uppercase tracking-widest mb-3 block">CUIT Local (Sin guiones)</label><input type="text" className="w-full bg-white border-2 border-sys-200 rounded-2xl px-5 py-4 font-mono font-black text-xl focus:border-sys-900 outline-none shadow-md text-sys-900" placeholder="20112223339" value={afipConfig.cuit} onChange={(e) => setAfipConfig({...afipConfig, cuit: e.target.value})} maxLength={11} /></div>
                                <div className="bg-sys-50 p-6 rounded-[2rem] border-2 border-sys-100 shadow-inner"><label className="text-[10px] font-black text-sys-500 uppercase tracking-widest mb-3 block">Punto de Venta</label><input type="number" className="w-full bg-white border-2 border-sys-200 rounded-2xl px-5 py-4 font-black text-xl focus:border-sys-900 outline-none shadow-md text-sys-900" placeholder="0001" value={afipConfig.ptoVta} onChange={(e) => setAfipConfig({...afipConfig, ptoVta: parseInt(e.target.value)})} min={1} /></div>
                                <div className="bg-sys-50 p-6 rounded-[2rem] border-2 border-sys-100 shadow-inner"><label className="text-[10px] font-black text-sys-500 uppercase tracking-widest mb-3 block">Razón Social Local</label><input type="text" className="w-full bg-white border-2 border-sys-200 rounded-2xl px-5 py-4 font-black text-sm focus:border-sys-900 outline-none shadow-md uppercase text-sys-900" placeholder="NOMBRE SUCURSAL" value={afipConfig.razonSocial} onChange={(e) => setAfipConfig({...afipConfig, razonSocial: e.target.value})} /></div>
                                
                                {/* 🔥 NUEVOS CAMPOS IIBB E INICIO ACTIVIDAD */}
                                <div className="bg-sys-50 p-6 rounded-[2rem] border-2 border-sys-100 shadow-inner"><label className="text-[10px] font-black text-sys-500 uppercase tracking-widest mb-3 block">Nro. Ingresos Brutos</label><input type="text" className="w-full bg-white border-2 border-sys-200 rounded-2xl px-5 py-4 font-black text-sm focus:border-sys-900 outline-none shadow-md uppercase text-sys-900" placeholder="Ej: 20-12345678-9" value={afipConfig.iibb} onChange={(e) => setAfipConfig({...afipConfig, iibb: e.target.value})} /></div>
                                <div className="bg-sys-50 p-6 rounded-[2rem] border-2 border-sys-100 shadow-inner"><label className="text-[10px] font-black text-sys-500 uppercase tracking-widest mb-3 block">Inicio de Actividades</label><input type="date" className="w-full bg-white border-2 border-sys-200 rounded-2xl px-5 py-4 font-black text-sm focus:border-sys-900 outline-none shadow-md text-sys-900" value={afipConfig.inicioAct} onChange={(e) => setAfipConfig({...afipConfig, inicioAct: e.target.value})} /></div>

                                <Button type="button" onClick={handleGenerateCSR} disabled={generatingCsr || !afipConfig.cuit} className="w-full bg-brand text-white font-black h-16 rounded-2xl shadow-xl hover:scale-[1.02] active:scale-95 transition-all text-xs tracking-widest border-b-4 border-brand-dark">{generatingCsr ? <Loader2 className="animate-spin mr-3"/> : <Download className="mr-3" size={22}/>} GENERAR PEDIDO .CSR</Button>
                            </div>
                            <div className="md:col-span-8 flex flex-col">
                                <label className="text-[11px] font-black text-sys-900 uppercase tracking-widest mb-4 block underline decoration-brand decoration-4 underline-offset-8">Certificado AFIP (.crt) para {activeBranchName}</label>
                                <textarea className="flex-1 w-full bg-sys-900 border-none rounded-[2rem] px-8 py-8 text-[11px] font-mono text-emerald-400 min-h-[450px] shadow-2xl resize-none custom-scrollbar leading-relaxed" placeholder="-----BEGIN CERTIFICATE-----" value={afipConfig.cert} onChange={(e) => setAfipConfig({...afipConfig, cert: e.target.value})} />
                                <div className="mt-4 p-4 bg-emerald-50 rounded-2xl border-2 border-dashed border-emerald-200 flex items-center gap-3"><Info size={20} className="text-emerald-600"/><p className="text-[10px] font-black text-emerald-700 uppercase leading-relaxed tracking-widest">Copia el contenido del certificado .crt del portal AFIP y pégalo arriba.</p></div>
                            </div>
                         </div>
                     )}
                </Card>

                {/* 🔘 FAB: BARRA DE ATAJOS Y BOTÓN DE GUARDADO */}
                <div className="fixed bottom-10 right-10 z-[100] flex items-center gap-8">
                    <div className="hidden md:flex bg-sys-900/90 backdrop-blur-md px-10 py-5 rounded-full border-2 border-white/20 shadow-2xl items-center gap-10">
                        <div className="flex items-center gap-3 text-white">
                            <Keyboard size={24} className="text-brand"/> 
                            <span className="text-[12px] font-black uppercase tracking-[0.3em]">F2 GUARDAR</span>
                        </div>
                        <div className="w-px h-8 bg-white/20"></div>
                        <div className="flex items-center gap-3 text-white uppercase font-black text-[12px] tracking-widest">
                            <Building2 size={20} className="text-emerald-400"/>
                            <span>Sucursal: {activeBranchName}</span>
                        </div>
                    </div>

                    <Button 
                        type="submit" 
                        disabled={saving} 
                        className={cn(
                            "h-24 px-16 rounded-full shadow-[0_30px_70px_rgba(0,0,0,0.4)] transition-all font-black text-lg uppercase tracking-[0.3em] flex items-center gap-6 border-[6px]",
                            status === 'success' ? "bg-emerald-500 border-emerald-200 scale-110" : "bg-sys-900 border-sys-700 hover:bg-black hover:-translate-y-2"
                        )}
                    >
                        {saving ? <Loader2 className="animate-spin" size={36}/> : status === 'success' ? <CheckCircle2 size={36}/> : <Save size={36}/>}
                        <span className="text-white">{saving ? '...' : status === 'success' ? 'ÉXITO' : 'GUARDAR'}</span>
                    </Button>
                </div>

            </form>
            <TutorialModal isOpen={!!tutorialOpen} onClose={() => setTutorialOpen(null)} type={tutorialOpen} />
            <style>{`.custom-scrollbar::-webkit-scrollbar { width: 10px; } .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.02); border-radius: 20px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 20px; border: 3px solid transparent; background-clip: content-box; } .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.2); }`}</style>
        </div>
    );
};