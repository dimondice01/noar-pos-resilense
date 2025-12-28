import React, { useState, useEffect } from 'react';
import { 
  CreditCard, Save, HelpCircle, CheckCircle2, 
  AlertCircle, ExternalLink, Eye, EyeOff, Plug, FileText, ScrollText, Download, Key 
} from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import forge from 'node-forge'; // ⚠️ Asegúrate de haber hecho: npm install node-forge

import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

// Input Secreto (Para Token MP)
const SecretInput = ({ label, value, onChange, placeholder, helpText }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1.5">
        <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1">
            {label}
        </label>
        {helpText && (
            <span className="text-[10px] text-blue-500 cursor-pointer hover:underline flex items-center gap-1">
                <HelpCircle size={10} /> ¿Dónde lo encuentro?
            </span>
        )}
      </div>
      <div className="relative group">
        <input 
          type={show ? "text" : "password"} 
          className="w-full bg-sys-50 border border-sys-200 rounded-xl pl-3 pr-10 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all font-mono text-sys-800"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button 
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-3 top-2.5 text-sys-400 hover:text-sys-600 transition-colors"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
};

// Textarea simple para Certificado
const CertInput = ({ label, value, onChange, placeholder }) => (
    <div className="mb-4">
        <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1 mb-1.5 block">
            {label}
        </label>
        <textarea 
            className="w-full bg-sys-50 border border-sys-200 rounded-xl px-3 py-2.5 text-[10px] outline-none focus:border-brand transition-all font-mono text-sys-600 h-24 resize-y leading-tight"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
        />
    </div>
);

export const IntegrationsPage = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingCsr, setGeneratingCsr] = useState(false);
  
  // MP State
  const [mpConfig, setMpConfig] = useState({
    accessToken: '',
    userId: '', 
    externalPosId: 'SUC001', 
    isActive: false
  });

  // AFIP State
  const [afipConfig, setAfipConfig] = useState({
    cuit: '',
    ptoVta: 1,
    razonSocial: '', 
    cert: '', 
    key: '', 
    condicion: 'MONOTRIBUTO', 
    isActive: false
  });

  const [status, setStatus] = useState('idle'); 

  useEffect(() => { loadConfig(); }, []);

  const loadConfig = async () => {
    try {
      // ✅ CORRECTO: Leemos de 'secrets'
      const mpDoc = await getDoc(doc(db, 'secrets', 'mercadopago'));
      if (mpDoc.exists()) setMpConfig(mpDoc.data());

      const afipDoc = await getDoc(doc(db, 'secrets', 'afip'));
      if (afipDoc.exists()) setAfipConfig(prev => ({...prev, ...afipDoc.data()}));

    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  // 🔥 MAGIA: GENERAR CSR Y CLAVE PRIVADA AUTOMÁTICAMENTE
  const handleGenerateCSR = async () => {
    if (!afipConfig.cuit || !afipConfig.razonSocial) {
        return alert("⚠️ Por favor completa el CUIT y la Razón Social (Nombre del dueño) primero.");
    }

    setGeneratingCsr(true);
    
    try {
        // 1. Crear par de claves RSA
        const keypair = await new Promise((resolve, reject) => {
            forge.pki.rsa.generateKeyPair({ bits: 2048, workers: 2 }, (err, keypair) => {
                if (err) reject(err); else resolve(keypair);
            });
        });

        // 2. Guardar la Clave Privada en el Estado
        const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);
        
        // 3. Crear el CSR
        const csr = forge.pki.createCertificationRequest();
        csr.publicKey = keypair.publicKey;
        csr.setSubject([{ name: 'commonName', value: afipConfig.razonSocial }, { name: 'serialNumber', value: `CUIT ${afipConfig.cuit}` }, { name: 'countryName', value: 'AR' }, { name: 'organizationName', value: 'Noar POS SaaS' }]);
        csr.sign(keypair.privateKey);
        const csrPem = forge.pki.certificationRequestToPem(csr);

        // 4. Actualizar estado y Guardar Clave Privada en DB Inmediatamente
        const newConfig = { ...afipConfig, key: privateKeyPem };
        setAfipConfig(newConfig);
        
        // 🛡️ CORREGIDO: Guardar en 'secrets' (plural)
        await setDoc(doc(db, 'secrets', 'afip'), { ...newConfig, updatedAt: new Date().toISOString() });

        // 5. Descargar el archivo .CSR
        const blob = new Blob([csrPem], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `pedido_afip_${afipConfig.cuit}.csr`;
        link.click();

        alert("✅ ¡Archivo de pedido generado!\n\n1. Se descargó un archivo .csr\n2. Súbelo a la web de AFIP.\n3. AFIP te dará un .crt (certificado).\n4. Pega el contenido del certificado aquí abajo.");

    } catch (error) {
        console.error("Error generando CSR:", error);
        alert("Error al generar claves: " + error.message);
    } finally {
        setGeneratingCsr(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setStatus('idle');

    try {
      // Validaciones MP
      if (mpConfig.isActive && !mpConfig.accessToken.startsWith('APP_USR-')) throw new Error("Token MP inválido.");

      // Validaciones AFIP
      if (afipConfig.isActive) {
          if (afipConfig.cuit.length !== 11) throw new Error("El CUIT debe tener 11 dígitos.");
          if (!afipConfig.key) throw new Error("Falta la Clave Privada. Usa el botón 'Generar Pedido'.");
          if (!afipConfig.cert.includes("BEGIN CERTIFICATE")) throw new Error("El Certificado es incorrecto o está vacío.");
      }

      // 🛡️ CORREGIDO: Guardar en 'secrets' (plural)
      await setDoc(doc(db, 'secrets', 'mercadopago'), { ...mpConfig, updatedAt: new Date().toISOString() });
      await setDoc(doc(db, 'secrets', 'afip'), { ...afipConfig, updatedAt: new Date().toISOString() });

      setStatus('success');
      setTimeout(() => setStatus('idle'), 3000);

    } catch (error) {
      alert("❌ " + error.message);
      setStatus('error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-10 text-center animate-pulse text-sys-400">Cargando ecosistema...</div>;

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-20">
      <header>
        <h2 className="text-2xl font-bold text-sys-900 flex items-center gap-2">
          <Plug className="text-brand" /> Integraciones & Ecosistema
        </h2>
        <p className="text-sys-500">Configura Mercado Pago y AFIP en pocos pasos.</p>
      </header>

      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* === MERCADO PAGO === */}
        <Card className="border-t-4 border-t-[#009EE3] relative overflow-hidden h-fit">
             <div className="absolute -right-4 -top-4 opacity-5 pointer-events-none"><CreditCard size={150} /></div>
             <div className="flex justify-between items-start mb-6 relative z-10">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-[#009EE3]/10 rounded-xl flex items-center justify-center text-[#009EE3]"><CreditCard size={24} /></div>
                    <div><h3 className="font-bold text-lg text-sys-900">Mercado Pago</h3><p className="text-xs text-sys-500">Cobros QR y Point</p></div>
                </div>
                <div className="flex items-center gap-2 bg-sys-50 p-1 rounded-lg border border-sys-200">
                    <button type="button" onClick={() => setMpConfig({...mpConfig, isActive: false})} className={cn("px-3 py-1 rounded text-xs font-bold transition-all", !mpConfig.isActive ? "bg-white shadow text-sys-700" : "text-sys-400 hover:text-sys-600")}>OFF</button>
                    <button type="button" onClick={() => setMpConfig({...mpConfig, isActive: true})} className={cn("px-3 py-1 rounded text-xs font-bold transition-all", mpConfig.isActive ? "bg-[#009EE3] text-white shadow" : "text-sys-400 hover:text-sys-600")}>ON</button>
                </div>
             </div>
             <div className={cn("space-y-4 transition-all", !mpConfig.isActive && "opacity-50 pointer-events-none grayscale")}>
                <SecretInput label="Access Token" placeholder="APP_USR-..." value={mpConfig.accessToken} onChange={(val) => setMpConfig({...mpConfig, accessToken: val})} helpText={true} />
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1 mb-1.5 block">User ID</label>
                        <input type="text" className="w-full bg-sys-50 border border-sys-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#009EE3]" placeholder="Ej: 12345678" value={mpConfig.userId} onChange={(e) => setMpConfig({...mpConfig, userId: e.target.value})} />
                    </div>
                    <div>
                        <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1 mb-1.5 block">External POS</label>
                        <input type="text" className="w-full bg-sys-50 border border-sys-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#009EE3] font-mono uppercase" placeholder="SUC001" value={mpConfig.externalPosId} onChange={(e) => setMpConfig({...mpConfig, externalPosId: e.target.value})} />
                    </div>
                </div>
             </div>
        </Card>

        {/* === AFIP ARCA === */}
        <Card className="border-t-4 border-t-[#2C3E50] relative overflow-hidden h-fit">
             <div className="absolute -right-4 -top-4 opacity-5 pointer-events-none"><FileText size={150} /></div>
             <div className="flex justify-between items-start mb-6 relative z-10">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-[#2C3E50]/10 rounded-xl flex items-center justify-center text-[#2C3E50]"><ScrollText size={24} /></div>
                    <div><h3 className="font-bold text-lg text-sys-900">ARCA (AFIP)</h3><p className="text-xs text-sys-500">Facturación Electrónica</p></div>
                </div>
                <div className="flex items-center gap-2 bg-sys-50 p-1 rounded-lg border border-sys-200">
                    <button type="button" onClick={() => setAfipConfig({...afipConfig, isActive: false})} className={cn("px-3 py-1 rounded text-xs font-bold transition-all", !afipConfig.isActive ? "bg-white shadow text-sys-700" : "text-sys-400 hover:text-sys-600")}>OFF</button>
                    <button type="button" onClick={() => setAfipConfig({...afipConfig, isActive: true})} className={cn("px-3 py-1 rounded text-xs font-bold transition-all", afipConfig.isActive ? "bg-[#2C3E50] text-white shadow" : "text-sys-400 hover:text-sys-600")}>ON</button>
                </div>
             </div>

             <div className={cn("space-y-4 transition-all", !afipConfig.isActive && "opacity-50 pointer-events-none grayscale")}>
                {/* Paso 1: Datos Base */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                        <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1 mb-1.5 block">Nombre / Razón Social</label>
                        <input type="text" className="w-full bg-sys-50 border border-sys-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#2C3E50]" placeholder="Ej: Juan Perez" value={afipConfig.razonSocial} onChange={(e) => setAfipConfig({...afipConfig, razonSocial: e.target.value})} />
                    </div>
                    <div>
                        <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1 mb-1.5 block">CUIT (Sin guiones)</label>
                        <input type="text" className="w-full bg-sys-50 border border-sys-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#2C3E50]" placeholder="20123456789" maxLength={11} value={afipConfig.cuit} onChange={(e) => setAfipConfig({...afipConfig, cuit: e.target.value})} />
                    </div>
                    <div>
                        <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1 mb-1.5 block">Punto de Venta</label>
                        <input type="number" className="w-full bg-sys-50 border border-sys-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#2C3E50]" placeholder="Ej: 5" value={afipConfig.ptoVta} onChange={(e) => setAfipConfig({...afipConfig, ptoVta: parseInt(e.target.value)})} />
                    </div>
                </div>

                {/* Paso 2: Generador de Keys */}
                <div className="bg-sys-50 p-4 rounded-xl border border-sys-200">
                    <h4 className="font-bold text-xs text-sys-700 mb-2">1. Generación de Claves</h4>
                    <p className="text-[10px] text-sys-500 mb-3">Esto generará tu Clave Privada (segura y oculta) y descargará el archivo de pedido (.csr) para subir a AFIP.</p>
                    
                    <div className="flex items-center justify-between">
                         <div className="flex items-center gap-2">
                             <div className={cn("w-2 h-2 rounded-full", afipConfig.key ? "bg-green-500" : "bg-red-400")}/>
                             <span className="text-xs font-bold text-sys-600">{afipConfig.key ? "Clave Privada Generada" : "Falta Clave Privada"}</span>
                         </div>
                         <Button type="button" size="sm" onClick={handleGenerateCSR} disabled={generatingCsr || !afipConfig.cuit} className={cn("h-8 text-xs", afipConfig.key ? "bg-sys-200 text-sys-700 hover:bg-sys-300" : "bg-brand text-white")}>
                             {generatingCsr ? "Generando..." : (afipConfig.key ? "Regenerar Pedido" : "Generar Pedido .CSR")} <Download size={14} className="ml-2"/>
                         </Button>
                    </div>
                </div>

                {/* Paso 3: Pegar Certificado */}
                <div>
                     <div className="flex justify-between items-end mb-1.5">
                        <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1 block">2. Certificado Digital (.crt)</label>
                        <a href="https://www.afip.gob.ar" target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 hover:underline flex items-center gap-1">Ir a AFIP <ExternalLink size={10}/></a>
                     </div>
                     <CertInput label="" placeholder="Abre el archivo .crt con el bloc de notas y pega el contenido aquí..." value={afipConfig.cert} onChange={(val) => setAfipConfig({...afipConfig, cert: val})} />
                </div>
             </div>
        </Card>

        {/* Footer flotante */}
        <div className="lg:col-span-2 sticky bottom-6 z-20">
            <Card className="p-4 flex items-center justify-between shadow-2xl border-sys-900/10 bg-sys-900 text-white">
                <div className="flex items-center gap-3">
                    {status === 'success' && <div className="text-green-400 font-bold flex items-center gap-2"><CheckCircle2/> Guardado OK</div>}
                    {status === 'idle' && <p className="text-xs text-sys-300">Guarda los cambios tras pegar el certificado.</p>}
                </div>
                <Button type="submit" disabled={saving} className="bg-white text-sys-900 hover:bg-sys-100 font-black shadow-none border-none">
                    {saving ? 'Guardando...' : 'Guardar Todo'} <Save size={18} className="ml-2"/>
                </Button>
            </Card>
        </div>
      </form>
    </div>
  );
};