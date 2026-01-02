import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useNavigate, useParams } from 'react-router-dom'; 
import { Lock, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '../../../core/ui/Button';

// IMPORTS DE FIREBASE PARA BRANDING
import { collection, query, where, getDocs } from 'firebase/firestore'; 
import { db } from '../../../database/firebase';

export const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Capturamos el slug de la URL
  const { companySlug } = useParams(); 

  // Estado para el Branding
  const [branding, setBranding] = useState({
      name: 'NOAR',
      suffix: 'POS',
      logo: null, 
      isCustom: false 
  });

  const login = useAuthStore(state => state.login);
  const navigate = useNavigate();

  // EFECTO: BUSCAR BRANDING
  useEffect(() => {
      if (companySlug) {
          const fetchBranding = async () => {
              try {
                  const q = query(collection(db, 'companies'), where('slug', '==', companySlug));
                  const snapshot = await getDocs(q);
                  
                  if (!snapshot.empty) {
                      const data = snapshot.docs[0].data();
                      setBranding({
                          name: data.name || 'Mi Negocio',
                          suffix: '', 
                          logo: data.logoUrl,
                          isCustom: true
                      });
                  }
              } catch (e) {
                  console.error("Error cargando branding:", e);
              }
          };
          fetchBranding();
      }
  }, [companySlug]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      // 1. Ejecutar Login en Firebase
      await login(email, password);
      
      // 2. 🚀 REDIRECCIÓN INTELIGENTE POST-LOGIN
      if (branding.isCustom && companySlug) {
          // A. Si entró por link personalizado (ej: /login/pepe), lo mandamos ahí directo
          navigate(`/${companySlug}`);
      } else {
          // B. Si entró por login genérico, lo mandamos a la raíz.
          // El componente <ProtectedRoute /> en App.jsx detectará su ID de empresa
          // y lo redirigirá automáticamente a /su-empresa
          navigate('/'); 
      }

    } catch (err) {
      console.error(err);
      setError("Credenciales incorrectas o error de conexión.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-sys-50 p-4 relative overflow-hidden">
      
      {/* Decoración de fondo */}
      {branding.isCustom && (
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"></div>
      )}

      {/* Branding Section */}
      <div className="mb-8 flex flex-col items-center gap-2 animate-in fade-in zoom-in duration-500">
         
         <div className="w-20 h-20 bg-sys-900 rounded-2xl flex items-center justify-center shadow-xl shadow-sys-200 overflow-hidden relative">
            {branding.logo ? (
                <img 
                    src={branding.logo} 
                    alt="Logo Empresa" 
                    className="w-full h-full object-contain p-2 bg-white"
                />
            ) : (
                <div className="w-10 h-10 border-l-4 border-r-4 border-white/90 skew-x-[-10deg] relative">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-1.5 bg-brand rotate-[-45deg]"></div>
                </div>
            )}
         </div>

         <h1 className="font-sans font-black text-2xl tracking-tight text-sys-900 mt-4 text-center">
           {branding.name}<span className="text-brand">{branding.suffix}</span>
         </h1>
         
         <p className="text-xs font-medium text-sys-400 tracking-widest uppercase">
             {branding.isCustom ? 'Portal Exclusivo' : 'Sistema de Acceso Seguro'}
         </p>
      </div>

      {/* Login Card */}
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl shadow-sys-200/50 border border-sys-100 p-8 relative">
        
        {branding.isCustom && (
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-100 text-blue-700 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wide border border-blue-200">
                Acceso Privado
            </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          
          <div>
            <label className="block text-xs font-bold text-sys-500 uppercase mb-2 ml-1">Usuario</label>
            <input 
              type="email" 
              required
              className="w-full bg-sys-50 border border-sys-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all"
              placeholder="nombre@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-sys-500 uppercase mb-2 ml-1">Contraseña</label>
            <input 
              type="password" 
              required
              className="w-full bg-sys-50 border border-sys-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-xl text-xs font-medium border border-red-100 animate-in fade-in slide-in-from-top-2">
              <AlertCircle size={16} className="shrink-0" />
              {error}
            </div>
          )}

          <Button 
            className="w-full py-3.5 mt-2 shadow-xl shadow-brand/20 group relative overflow-hidden" 
            disabled={isSubmitting}
          >
            <div className="relative z-10 flex items-center justify-center gap-2">
                {isSubmitting ? (
                    <>Verificando <Loader2 className="animate-spin" size={18}/></>
                ) : (
                    <>Iniciar Sesión <ArrowRight size={18} className="opacity-80 group-hover:translate-x-1 transition-transform" /></>
                )}
            </div>
          </Button>

        </form>
      </div>

      <p className="mt-8 text-xs text-sys-400 text-center">
        © 2025 NoarPOS Resilience v2.1<br/>
        <span className="opacity-50">Secure Connection • {branding.isCustom ? 'Managed Hosting' : 'Public Access'}</span>
      </p>
    </div>
  );
};