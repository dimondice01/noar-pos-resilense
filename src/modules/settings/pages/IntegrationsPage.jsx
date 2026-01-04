import React, { useState, useEffect } from 'react';
import { 
    CreditCard, Save, HelpCircle, CheckCircle2, 
    AlertCircle, ExternalLink, Eye, EyeOff, Plug, FileText, ScrollText, Download, Key,
    Search, X, Loader2, Info, Link as LinkIcon, Terminal // 🔥 Agregamos Terminal para icono Clover
} from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import forge from 'node-forge'; 
import { useAuthStore } from '../../auth/store/useAuthStore'; 

import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

// URL del Backend
const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_URL; 

// ==================================================================================
// 🎓 MODAL TUTORIAL (SÚPER EXPLICADO)
// ==================================================================================
const TutorialModal = ({ isOpen, onClose, type }) => {
    if (!isOpen) return null;

    const stepsMP = [
        { 
            title: "1. MercadoPago Developers", 
            desc: "Entra al panel de desarrolladores con la cuenta del negocio.",
            link: "https://www.mercadopago.com.ar/developers/panel",
            icon: ExternalLink
        },
        { 
            title: "2. Crear Aplicación", 
            desc: "Haz clic en '+ Crear Aplicación'. Elige 'Pagos Presenciales'. Ponle de nombre 'Sistema Noar'.",
            icon: Plug
        },
        { 
            title: "3. Copiar Access Token", 
            desc: "En el menú izquierdo ve a 'Credenciales de Producción'. Copia el 'Access Token' (empieza con APP_USR-...).",
            icon: Key
        },
        { 
            title: "4. Buscar Caja", 
            desc: "¡Listo! Pega ese Token en esta pantalla y usa el botón de la LUPA para encontrar tus cajas automáticamente.",
            icon: Search
        }
    ];

    const stepsAFIP = [
        {
            title: "1. Generar Pedido", 
            desc: "Completa CUIT y Razón Social abajo. Toca 'Generar Pedido .CSR' y guarda el archivo en tu PC.",
            icon: Download
        },
        { 
            title: "2. Crear Certificado en AFIP", 
            desc: "Entra a AFIP -> 'Admin. de Certificados Digitales'. Agrega un Alias (ej: 'punto_venta'), sube el archivo .CSR y descarga el certificado .crt.",
            link: "https://auth.afip.gob.ar/contribuyente_/login.xhtml",
            icon: ExternalLink
        },
        { 
            title: "3. ¡VINCULAR SERVICIO! (Crucial)", 
            desc: "Ve a 'Admin. de Relaciones'. Nueva Relación -> AFIP -> WebServices -> Facturación Electrónica. En 'Representante' busca el Alias (Computador) creado antes.",
            icon: LinkIcon
        },
        { 
            title: "4. Pegar Certificado", 
            desc: "Abre el archivo .crt con Bloc de Notas. Copia TODO el texto y pégalo en el campo 'Certificado' de esta pantalla.",
            icon: ScrollText
        }
    ];

    // 🔥 NUEVO: Tutorial Clover
    const stepsClover = [
        {
            title: "1. Clover Dashboard",
            desc: "Ingresa a tu panel de control de Clover (Web).",
            link: "https://www.clover.com/dashboard/login",
            icon: ExternalLink
        },
        {
            title: "2. Obtener Merchant ID",
            desc: "Tu Merchant ID (MID) está en la URL del navegador o en Configuración > Comerciante. Es un código tipo 'ABC123DEF456'.",
            icon: Search
        },
        {
            title: "3. Crear Token API",
            desc: "Ve a Configuración (Setup) > API Tokens. Crea uno nuevo con permisos de 'Merchant R/W' y 'Payments R/W'.",
            icon: Key
        },
        {
            title: "4. Remote App ID (Opcional)",
            desc: "Si desarrollaste una App específica en Clover, usa su ID. Si no, déjalo en blanco o usa el ID de nuestra App (consúltanos).",
            icon: Plug
        }
    ];

    const steps = type === 'MP' ? stepsMP : type === 'AFIP' ? stepsAFIP : stepsClover;
    const colorClass = type === 'MP' ? "bg-[#009EE3]" : type === 'CLOVER' ? "bg-[#28a745]" : "bg-[#2C3E50]"; // Verde Clover

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden relative border border-sys-200">
                <div className={cn("p-5 text-white flex justify-between items-center shadow-md", colorClass)}>
                    <h3 className="font-bold text-lg flex items-center gap-2">
                        <HelpCircle size={22}/> Guía Rápida: {type === 'MP' ? 'Mercado Pago' : type === 'CLOVER' ? 'Clover' : 'AFIP'}
                    </h3>
                    <button onClick={onClose} className="hover:bg-white/20 p-1.5 rounded-full transition-colors"><X size={20}/></button>
                </div>
                
                <div className="p-6 max-h-[65vh] overflow-y-auto custom-scrollbar bg-sys-50/50">
                    <div className="space-y-5 relative">
                        <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-sys-200 -z-10"></div>
                        {steps.map((step, i) => (
                            <div key={i} className="flex gap-4 group">
                                <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold shadow-sm transition-transform group-hover:scale-110 z-10", type === 'MP' ? "bg-blue-50 text-blue-600 border-2 border-blue-100" : type === 'CLOVER' ? "bg-green-50 text-green-600 border-2 border-green-100" : "bg-white text-sys-700 border-2 border-sys-200")}>
                                    <step.icon size={18}/>
                                </div>
                                <div className="bg-white p-4 rounded-xl border border-sys-100 shadow-sm flex-1 hover:border-sys-300 transition-colors group-hover:shadow-md">
                                    <h4 className="font-bold text-sm text-sys-800 mb-1.5">{step.title}</h4>
                                    <p className="text-xs text-sys-500 leading-relaxed">{step.desc}</p>
                                    {step.link && (
                                        <a href={step.link} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors">
                                            Ir al sitio web <ExternalLink size={12}/>
                                        </a>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                
                <div className="p-5 bg-white border-t border-sys-100 text-center">
                    <Button onClick={onClose} className="w-full bg-sys-900 text-white font-bold h-11 text-sm shadow-lg hover:bg-black transform active:scale-95 transition-all">
                        ¡Entendido!
                    </Button>
                </div>
            </div>
        </div>
    );
};

// ==================================================================================
// 🧩 COMPONENTES UI
// ==================================================================================
const SecretInput = ({ label, value, onChange, placeholder }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="mb-4">
      <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1 mb-1.5 block">{label}</label>
      <div className="relative group">
        <input 
          type={show ? "text" : "password"} 
          className="w-full bg-sys-50 border border-sys-200 rounded-xl pl-3 pr-10 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all font-mono text-sys-800 placeholder:text-sys-300"
          placeholder={placeholder}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-2.5 text-sys-400 hover:text-sys-600 transition-colors">
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
};

const CertInput = ({ label, value, onChange, placeholder }) => (
    <div className="mb-4">
        <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1 mb-1.5 block">{label}</label>
        <textarea 
            className="w-full bg-sys-50 border border-sys-200 rounded-xl px-3 py-2.5 text-[10px] outline-none focus:border-brand transition-all font-mono text-sys-600 h-28 resize-y leading-tight placeholder:text-sys-300"
            placeholder={placeholder}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
        />
    </div>
);

// ==================================================================================
// 🚀 PÁGINA PRINCIPAL
// ==================================================================================
export const IntegrationsPage = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('idle'); 
  const [tutorialOpen, setTutorialOpen] = useState(null);

  // Estados de Procesos
  const [generatingCsr, setGeneratingCsr] = useState(false);
  const [searchingPos, setSearchingPos] = useState(false);
  const [posList, setPosList] = useState([]); 

  // Configs
  const [mpConfig, setMpConfig] = useState({ accessToken: '', userId: '', externalPosId: '', isActive: false });
  const [afipConfig, setAfipConfig] = useState({ cuit: '', ptoVta: 1, razonSocial: '', cert: '', key: '', condicion: 'MONOTRIBUTO', isActive: false });
  // 🔥 Nuevo Estado: Clover
  const [cloverConfig, setCloverConfig] = useState({ merchantId: '', apiToken: '', remoteAppId: '', deviceId: '', isActive: false });

  // 🔑 HOOK SAAS
  const user = useAuthStore(state => state.user);

  useEffect(() => { 
      if (user?.companyId) {
          loadConfig(); 
      }
  }, [user]);

  const loadConfig = async () => {
    try {
      // Leemos directamente de la colección 'config' de la empresa
      const mpDoc = await getDoc(doc(db, 'companies', user.companyId, 'config', 'mercadopago')); 
      if (mpDoc.exists()) setMpConfig(mpDoc.data());

      const afipDoc = await getDoc(doc(db, 'companies', user.companyId, 'config', 'afip')); 
      if (afipDoc.exists()) setAfipConfig(prev => ({...prev, ...afipDoc.data()}));

      // 🔥 Cargamos Clover
      const cloverDoc = await getDoc(doc(db, 'companies', user.companyId, 'config', 'clover'));
      if (cloverDoc.exists()) setCloverConfig(cloverDoc.data());

    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  // --- 1. MP: BUSCAR CAJAS ---
  const handleSearchPos = async () => {
      if (!mpConfig.accessToken || mpConfig.accessToken.length < 20) {
          return alert("⚠️ Primero pega el 'Access Token' de MercadoPago.");
      }
      setSearchingPos(true);
      setPosList([]);
      try {
          const response = await fetch(`${API_URL}/get-mp-stores`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ accessToken: mpConfig.accessToken, companyId: user.companyId })
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Error al buscar cajas");

          if (data.userId) setMpConfig(prev => ({ ...prev, userId: data.userId.toString() }));

          if (data.cajas && data.cajas.length > 0) {
              setPosList(data.cajas);
              if (data.cajas.length === 1) {
                  setMpConfig(prev => ({ ...prev, externalPosId: data.cajas[0].external_id }));
                  alert(`✅ ¡Caja encontrada y seleccionada!\nNombre: ${data.cajas[0].name}`);
              } else {
                  alert(`✅ Encontramos ${data.cajas.length} cajas. Por favor selecciona una de la lista.`);
              }
          } else {
              alert("⚠️ Tu cuenta funciona, pero NO tiene Cajas (Sucursales) creadas.");
          }
      } catch (error) {
          console.error(error);
          alert("❌ Error buscando cajas: " + error.message);
      } finally {
          setSearchingPos(false);
      }
  };

  // --- 2. AFIP: GENERAR CLAVES ---
  const handleGenerateCSR = async () => {
    if (!afipConfig.cuit || !afipConfig.razonSocial) return alert("⚠️ Escribe tu CUIT y Nombre arriba primero.");
    setGeneratingCsr(true);
    try {
        const keypair = await new Promise((resolve, reject) => {
            forge.pki.rsa.generateKeyPair({ bits: 2048, workers: 2 }, (err, k) => err ? reject(err) : resolve(k));
        });
        const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);
        const csr = forge.pki.createCertificationRequest();
        csr.publicKey = keypair.publicKey;
        csr.setSubject([
            { name: 'commonName', value: afipConfig.razonSocial }, 
            { name: 'serialNumber', value: `CUIT ${afipConfig.cuit}` }, 
            { name: 'countryName', value: 'AR' }, 
            { name: 'organizationName', value: 'Noar POS' }
        ]);
        csr.sign(keypair.privateKey);
        const csrPem = forge.pki.certificationRequestToPem(csr);

        const newConfig = { ...afipConfig, key: privateKeyPem };
        setAfipConfig(newConfig);
        
        if (user?.companyId) {
            await setDoc(doc(db, 'companies', user.companyId, 'config', 'afip'), { ...newConfig, updatedAt: new Date().toISOString() }, { merge: true });
        }

        const blob = new Blob([csrPem], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `pedido_afip_${afipConfig.cuit}.csr`;
        link.click();

        alert("✅ ¡LISTO!\n\n1. La Clave Privada se guardó sola.\n2. Se descargó el archivo .CSR.\n3. Sube ese archivo a la web de AFIP para obtener tu certificado.\n4. ¡NO OLVIDES VINCULAR EL SERVICIO!");
    } catch (error) { 
        console.error(error);
        alert("Error generando claves: " + error.message); 
    } finally { 
        setGeneratingCsr(false); 
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (!user?.companyId) throw new Error("No tienes empresa asignada. Contacta soporte.");
      
      // Guardado seguro en RUTA PRIVADA DE LA EMPRESA
      await setDoc(doc(db, 'companies', user.companyId, 'config', 'mercadopago'), { ...mpConfig, updatedAt: new Date().toISOString() });
      await setDoc(doc(db, 'companies', user.companyId, 'config', 'afip'), { ...afipConfig, updatedAt: new Date().toISOString() }, { merge: true });
      
      // 🔥 Guardar Clover
      await setDoc(doc(db, 'companies', user.companyId, 'config', 'clover'), { ...cloverConfig, updatedAt: new Date().toISOString() }, { merge: true });

      setStatus('success');
      setTimeout(() => setStatus('idle'), 3000);
    } catch (error) { alert("❌ " + error.message); setStatus('error'); } finally { setSaving(false); }
  };

  if (loading) return <div className="p-10 text-center animate-pulse text-sys-400">Cargando...</div>;

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-24 px-4 md:px-0">
      
      {/* HEADER */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
            <h2 className="text-2xl font-bold text-sys-900 flex items-center gap-2"><Plug className="text-brand" /> Configuración de Pagos</h2>
            <p className="text-sys-500 text-sm">Empresa ID: <span className="font-mono bg-sys-100 px-2 py-0.5 rounded">{user?.companyId}</span></p>
        </div>
        <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 border border-blue-100 shadow-sm">
            <Info size={16}/> Tip: Abre las webs de los proveedores en otra pestaña.
        </div>
      </header>

      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* === MERCADO PAGO === */}
        <Card className={cn("border-t-4 border-t-[#009EE3] relative overflow-hidden transition-all duration-300", mpConfig.isActive ? "shadow-lg" : "opacity-80 grayscale-[0.5]")}>
             <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-[#009EE3]/10 rounded-xl flex items-center justify-center text-[#009EE3]"><CreditCard size={24} /></div>
                    <div><h3 className="font-bold text-lg text-sys-900">Mercado Pago</h3><p className="text-xs text-sys-500">Cobros QR y Point</p></div>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setTutorialOpen('MP')} className="text-[#009EE3] hover:bg-[#009EE3]/10 px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 transition-colors border border-transparent hover:border-[#009EE3]/20">
                        <HelpCircle size={14}/> Ayuda
                    </button>
                    <div className="flex bg-sys-100 p-1 rounded-lg">
                        <button type="button" onClick={() => setMpConfig({...mpConfig, isActive: false})} className={cn("px-3 py-1 rounded text-xs font-bold", !mpConfig.isActive ? "bg-white shadow text-sys-800" : "text-sys-400")}>OFF</button>
                        <button type="button" onClick={() => setMpConfig({...mpConfig, isActive: true})} className={cn("px-3 py-1 rounded text-xs font-bold", mpConfig.isActive ? "bg-[#009EE3] text-white shadow" : "text-sys-400")}>ON</button>
                    </div>
                </div>
             </div>

             {mpConfig.isActive && (
                 <div className="space-y-4 animate-in slide-in-from-top-2 fade-in duration-300">
                    <div className="flex gap-2 items-end">
                        <div className="flex-1">
                             <SecretInput label="1. Pega tu Access Token" placeholder="APP_USR-..." value={mpConfig.accessToken} onChange={(val) => setMpConfig({...mpConfig, accessToken: val})} />
                        </div>
                        <Button type="button" onClick={handleSearchPos} disabled={searchingPos} className="mb-4 h-[42px] bg-[#009EE3] hover:bg-[#007eb5] text-white px-3 shadow-md" title="Buscar Cajas Automáticamente">
                            {searchingPos ? <Loader2 className="animate-spin"/> : <Search size={20} />}
                        </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1 mb-1.5 block">User ID (Automático)</label>
                            <input type="text" className="input-std bg-sys-50" readOnly placeholder="..." value={mpConfig.userId || ''} />
                        </div>
                        <div>
                            <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1 mb-1.5 block">2. Elige tu Caja</label>
                            {posList.length > 0 ? (
                                <select 
                                    className="w-full p-2 bg-white border-2 border-[#009EE3] rounded-lg text-sm font-bold text-sys-800 outline-none h-[42px]"
                                    value={mpConfig.externalPosId}
                                    onChange={(e) => setMpConfig({...mpConfig, externalPosId: e.target.value})}
                                >
                                    <option value="">-- Seleccionar --</option>
                                    {posList.map(pos => (
                                        <option key={pos.id} value={pos.external_id}>{pos.name}</option>
                                    ))}
                                </select>
                            ) : (
                                <input 
                                    type="text" 
                                    className="input-std font-mono uppercase" 
                                    placeholder="SUC001 (O usa la lupa)" 
                                    value={mpConfig.externalPosId} 
                                    onChange={(e) => setMpConfig({...mpConfig, externalPosId: e.target.value})} 
                                />
                            )}
                        </div>
                    </div>
                 </div>
             )}
        </Card>

        {/* === CLOVER (FISERV) 🔥 NUEVO === */}
        <Card className={cn("border-t-4 border-t-[#28a745] relative overflow-hidden transition-all duration-300", cloverConfig.isActive ? "shadow-lg" : "opacity-80 grayscale-[0.5]")}>
             <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-[#28a745]/10 rounded-xl flex items-center justify-center text-[#28a745]"><Terminal size={24} /></div>
                    <div><h3 className="font-bold text-lg text-sys-900">Clover / Fiserv</h3><p className="text-xs text-sys-500">Terminales Inteligentes</p></div>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setTutorialOpen('CLOVER')} className="text-[#28a745] hover:bg-[#28a745]/10 px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 transition-colors border border-transparent hover:border-[#28a745]/20">
                        <HelpCircle size={14}/> Ayuda
                    </button>
                    <div className="flex bg-sys-100 p-1 rounded-lg">
                        <button type="button" onClick={() => setCloverConfig({...cloverConfig, isActive: false})} className={cn("px-3 py-1 rounded text-xs font-bold", !cloverConfig.isActive ? "bg-white shadow text-sys-800" : "text-sys-400")}>OFF</button>
                        <button type="button" onClick={() => setCloverConfig({...cloverConfig, isActive: true})} className={cn("px-3 py-1 rounded text-xs font-bold", cloverConfig.isActive ? "bg-[#28a745] text-white shadow" : "text-sys-400")}>ON</button>
                    </div>
                </div>
             </div>

             {cloverConfig.isActive && (
                 <div className="space-y-4 animate-in slide-in-from-top-2 fade-in duration-300">
                    <div>
                        <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1 mb-1.5 block">Merchant ID (MID)</label>
                        <input type="text" className="input-std font-mono" placeholder="ABC123DEF456" value={cloverConfig.merchantId} onChange={(e) => setCloverConfig({...cloverConfig, merchantId: e.target.value})} />
                    </div>
                    <div>
                        <SecretInput label="API Token" placeholder="Token de acceso (Access Token)..." value={cloverConfig.apiToken} onChange={(val) => setCloverConfig({...cloverConfig, apiToken: val})} />
                    </div>
                    <div>
                        <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1 mb-1.5 block">Remote App ID (Opcional)</label>
                        <input type="text" className="input-std" placeholder="ID de tu App Clover" value={cloverConfig.remoteAppId} onChange={(e) => setCloverConfig({...cloverConfig, remoteAppId: e.target.value})} />
                    </div>
                 </div>
             )}
        </Card>

        {/* === AFIP ARCA === */}
        <Card className={cn("border-t-4 border-t-[#2C3E50] relative overflow-hidden transition-all duration-300 lg:col-span-2", afipConfig.isActive ? "shadow-lg" : "opacity-80 grayscale-[0.5]")}>
             <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-[#2C3E50]/10 rounded-xl flex items-center justify-center text-[#2C3E50]"><ScrollText size={24} /></div>
                    <div><h3 className="font-bold text-lg text-sys-900">ARCA (AFIP)</h3><p className="text-xs text-sys-500">Facturación Electrónica</p></div>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setTutorialOpen('AFIP')} className="text-[#2C3E50] hover:bg-[#2C3E50]/10 px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 transition-colors border border-transparent hover:border-[#2C3E50]/20">
                        <HelpCircle size={14}/> Ayuda
                    </button>
                    <div className="flex bg-sys-100 p-1 rounded-lg">
                        <button type="button" onClick={() => setAfipConfig({...afipConfig, isActive: false})} className={cn("px-3 py-1 rounded text-xs font-bold", !afipConfig.isActive ? "bg-white shadow text-sys-800" : "text-sys-400")}>OFF</button>
                        <button type="button" onClick={() => setAfipConfig({...afipConfig, isActive: true})} className={cn("px-3 py-1 rounded text-xs font-bold", afipConfig.isActive ? "bg-[#2C3E50] text-white shadow" : "text-sys-400")}>ON</button>
                    </div>
                </div>
             </div>

             {afipConfig.isActive && (
                 <div className="space-y-6 animate-in slide-in-from-top-2 fade-in duration-300">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="col-span-1 md:col-span-2">
                            <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1 mb-1.5 block">Nombre del Titular</label>
                            <input type="text" className="input-std" placeholder="Ej: Juan Perez" value={afipConfig.razonSocial} onChange={(e) => setAfipConfig({...afipConfig, razonSocial: e.target.value})} />
                        </div>
                        <div>
                            <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1 mb-1.5 block">CUIT</label>
                            <input type="text" className="input-std" placeholder="20112223339" maxLength={11} value={afipConfig.cuit} onChange={(e) => setAfipConfig({...afipConfig, cuit: e.target.value})} />
                        </div>
                        <div>
                            <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1 mb-1.5 block">Pto. Venta</label>
                            <input type="number" className="input-std" placeholder="1" value={afipConfig.ptoVta} onChange={(e) => setAfipConfig({...afipConfig, ptoVta: parseInt(e.target.value)})} />
                        </div>
                    </div>

                    <div className="bg-sys-50 p-4 rounded-xl border border-sys-200">
                        <div className="flex items-center justify-between">
                             <div className="flex items-center gap-2">
                                 <div className={cn("w-3 h-3 rounded-full", afipConfig.key ? "bg-green-500" : "bg-red-400")}/>
                                 <span className="text-xs font-bold text-sys-600">{afipConfig.key ? "Claves Listas" : "Falta Clave"}</span>
                             </div>
                             <Button type="button" size="sm" onClick={handleGenerateCSR} disabled={generatingCsr || !afipConfig.cuit} className="h-8 text-xs bg-brand text-white">
                                 {generatingCsr ? "Procesando..." : "Generar Pedido .CSR"} <Download size={14} className="ml-2"/>
                             </Button>
                        </div>
                    </div>

                    <CertInput label="Pegar Certificado (.crt)" placeholder="Pega aquí el contenido del archivo .crt..." value={afipConfig.cert} onChange={(val) => setAfipConfig({...afipConfig, cert: val})} />
                 </div>
             )}
        </Card>

        {/* Footer */}
        <div className="lg:col-span-2 sticky bottom-6 z-20 flex justify-end">
            <Card className="p-2 pl-6 pr-2 flex items-center gap-6 shadow-2xl border-sys-900/10 bg-sys-900 text-white rounded-full">
                <span className="text-xs">{status === 'success' ? '✅ Guardado en tu Empresa' : 'No olvides guardar'}</span>
                <Button type="submit" disabled={saving} className="bg-white text-sys-900 hover:bg-sys-100 font-black shadow-none border-none rounded-full px-6 h-10">
                    {saving ? 'Guardando...' : 'Guardar'}
                </Button>
            </Card>
        </div>
      </form>
      <TutorialModal isOpen={!!tutorialOpen} onClose={() => setTutorialOpen(null)} type={tutorialOpen} />
      
      {/* Estilos locales */}
      <style>{`
        .input-std { width: 100%; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 0.75rem; padding: 0.6rem 0.9rem; font-size: 0.875rem; outline: none; transition: all 0.2s; color: #1E293B; font-weight: 500; }
        .input-std:focus { border-color: #0F172A; box-shadow: 0 0 0 3px rgba(15,23,42,0.05); background: white; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 10px; }
      `}</style>
    </div>
  );
};