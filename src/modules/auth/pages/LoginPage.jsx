import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useNavigate, useParams } from 'react-router-dom'; 
import { ArrowRight, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '../../../core/ui/Button';

// Firebase 
import { collection, query, where, getDocs } from 'firebase/firestore'; 
import { db } from '../../../database/firebase';

export const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const { companySlug } = useParams(); 
  
  const [branding, setBranding] = useState({
      name: 'NOAR',
      suffix: 'POS',
      logo: null, 
      isCustom: false 
  });

  const { login } = useAuthStore();
  const navigate = useNavigate();

  // 1. CARGAR BRANDING SI HAY SLUG EN LA URL
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
      // ---------------------------------------------------------
      // PASO 1: AUTENTICACIÓN (Store de Zustand + AuthService)
      // ---------------------------------------------------------
      // Esto hace el signInWithEmailAndPassword y resuelve el Bypass si aplica
      await login(email, password);
      
      // Esperamos a que onAuthStateChanged popule el store (race condition fix)
      const currentUser = await new Promise((resolve, reject) => {
        const immediate = useAuthStore.getState().user;
        if (immediate) return resolve(immediate);

        const timeout = setTimeout(() => reject(new Error("Tiempo de espera agotado al obtener sesión.")), 8000);
        const unsub = useAuthStore.subscribe(state => {
          if (state.user) {
            clearTimeout(timeout);
            unsub();
            resolve(state.user);
          }
        });
      });

      // ---------------------------------------------------------
      // PASO 2: REDIRECCIÓN "VIP" (SUPER ADMIN)
      // ---------------------------------------------------------
      // Comprobamos si es el SuperAdmin por su UID quemado o por el flag superAdmin
      if (currentUser.uid === 'master-admin-nexus' || currentUser.superAdmin || currentUser.companyId === 'master_admin') {
          console.log("👑 Super Admin detectado. Redirigiendo al Master Panel...");
          navigate('/master-admin');
          return; 
      }

      // ---------------------------------------------------------
      // PASO 3: REDIRECCIÓN USUARIOS NORMALES (Empresas)
      // ---------------------------------------------------------
      if (currentUser.companyId && currentUser.companyId !== 'master_admin') {
          console.log("✅ Acceso concedido a:", currentUser.companyId);

          // Si entró por link personalizado correcto, se queda ahí
          if (branding.isCustom && companySlug === currentUser.companyId) {
              navigate(`/${companySlug}`);
          } else {
              // Si no, lo mandamos a SU dashboard
              navigate(`/${currentUser.companyId}`);
          }
          return;
      }
      
      // Caso raro de error de base de datos
      console.warn("⚠️ Usuario sin empresa asignada detectado.");
      setError("Su cuenta no tiene un negocio asignado. Contacte a soporte.");
      setIsSubmitting(false);

    } catch (err) {
      console.error("Error en login:", err);
      // Personalizamos el error de offline si aplica
      if (err.message && err.message.includes('Offline')) {
          setError(err.message);
      } else {
          setError("Credenciales incorrectas o error de conexión.");
      }
      setIsSubmitting(false); // Desbloqueamos el botón
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
        © 2026 NoarPOS Resilience v2.1<br/>
        <span className="opacity-50">Secure Connection • {branding.isCustom ? 'Managed Hosting' : 'Public Access'}</span>
      </p>
    </div>
  );
};