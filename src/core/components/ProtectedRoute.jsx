import React from 'react';
import { Navigate, Outlet, useParams, useLocation } from 'react-router-dom'; 
import { useAuthStore } from '../../modules/auth/store/useAuthStore';
import { Loader2 } from 'lucide-react';

export const ProtectedRoute = () => {
  // Ajustado a 'isLoading' que es como lo tienes en tu useAuthStore
  const { user, isLoading } = useAuthStore(); 
  const { companySlug } = useParams(); 
  const location = useLocation();

  // 1. PANTALLA DE CARGA (Vital para no rebotar al login mientras Firebase responde)
  if (isLoading) { 
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-sys-50">
        <div className="flex flex-col items-center gap-4">
            <Loader2 className="animate-spin text-brand" size={40} />
            <p className="text-sys-400 text-[10px] font-black uppercase tracking-widest animate-pulse">
                Verificando Credenciales...
            </p>
        </div>
      </div>
    );
  }

  // 2. VALIDACIÓN DE SESIÓN ACTIVA
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // =================================================================
  // 👑 PASE VIP: MASTER ADMIN REAL (BYPASS TOTAL)
  // =================================================================
  // Solo los administradores de la plataforma (admin@noar o admin@admin) tienen bypass
  if (user.uid === 'master-admin-nexus' || user.companyId === 'master_admin') {
      return <Outlet />;
  }

  // =================================================================
  // 🛡️ USUARIOS NORMALES (Dueños de Local, Cajeros)
  // =================================================================
  
  // A. Seguridad básica: Si no tiene empresa asignada, intentamos refrescar perfil antes de rebotar
  if (!user.companyId) {
      console.warn("⚠️ Usuario detectado sin empresa. Esperando resolución del perfil...");
      // 🛡️ NO reinicializar el listener acá (causaba listeners duplicados en cada
      // render y un crash de React "removeChild" al reconciliar árboles distintos).
      // El listener único de App.jsx ya está resolviendo companyId en segundo plano.
      return (
        <div className="h-screen w-screen flex items-center justify-center bg-sys-50">
            <Loader2 className="animate-spin text-brand" size={40} />
        </div>
      );
  }

  // B. Validación de acceso a la ruta Maestra
  // Si un usuario normal intenta escribir "/master-admin" en la URL, lo rebotamos
  if (location.pathname.startsWith('/master-admin')) {
      console.warn("⛔ Intento de acceso no autorizado al Panel SaaS");
      return <Navigate to={`/${user.companyId}`} replace />;
  }

  // C. Redirección automática a la Empresa
  // Si un usuario logueado entra a la raíz "/" sin slug, lo mandamos a SU empresa
  if (!companySlug && location.pathname === '/') {
      return <Navigate to={`/${user.companyId}`} replace />;
  }

  // D. Validación de Aislamiento (Anti-Hacking de URL)
  // Rutas internas reservadas que no usan companySlug como tenant
  const RESERVED_SLUGS = ['testqa'];
  if (companySlug && !RESERVED_SLUGS.includes(companySlug) && companySlug !== user.companyId) {
      console.warn(`⛔ Bloqueo de seguridad: Acceso cruzado denegado de ${user.companyId} hacia ${companySlug}`);
      return <Navigate to={`/${user.companyId}`} replace />;
  }

  // 5. Todo OK: Renderiza la ruta hija (MainLayout, Dashboard, POS, etc.)
  return <Outlet />;
};