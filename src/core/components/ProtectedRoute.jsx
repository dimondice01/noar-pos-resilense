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
  // 👑 PASE VIP: MASTER ADMIN (BYPASS TOTAL)
  // =================================================================
  // Si es el usuario forzado (admin@noar.com) o tiene el flag superAdmin
  if (user.uid === 'master-admin-nexus' || user.superAdmin === true) {
      return <Outlet />;
  }

  // =================================================================
  // 🛡️ USUARIOS NORMALES (Dueños de Local, Cajeros)
  // =================================================================
  
  // A. Seguridad básica: Si no tiene empresa asignada, no puede entrar al sistema
  if (!user.companyId) {
      console.error("⛔ Error Crítico: Usuario sin empresa asignada.");
      return <Navigate to="/login" replace />;
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
  // Si el usuario de la empresa "kiosco-A" intenta entrar manualmente a "/kiosco-B"
  // El companySlug debe coincidir estrictamente con su companyId de la base de datos
  if (companySlug && companySlug !== user.companyId) {
      console.warn(`⛔ Bloqueo de seguridad: Acceso cruzado denegado de ${user.companyId} hacia ${companySlug}`);
      return <Navigate to={`/${user.companyId}`} replace />;
  }

  // 5. Todo OK: Renderiza la ruta hija (MainLayout, Dashboard, POS, etc.)
  return <Outlet />;
};