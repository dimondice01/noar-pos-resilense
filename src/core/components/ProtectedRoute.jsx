import React from 'react';
import { Navigate, Outlet, useParams, useLocation } from 'react-router-dom'; 
import { useAuthStore } from '../../modules/auth/store/useAuthStore';
import { Loader2 } from 'lucide-react'; // Icono de carga más bonito

export const ProtectedRoute = () => {
  const { user, loading } = useAuthStore(); // Asegúrate que tu store devuelva 'loading' o 'isLoading' (ajusta según tu store real)
  const { companySlug } = useParams(); 
  const location = useLocation();

  // 1. PANTALLA DE CARGA
  // Usamos 'loading' (o isLoading según como lo tengas en tu store)
  if (loading) { 
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-sys-50">
        <div className="flex flex-col items-center gap-4">
            <Loader2 className="animate-spin text-brand" size={40} />
            <p className="text-sys-400 text-xs font-medium animate-pulse">Verificando acceso...</p>
        </div>
      </div>
    );
  }

  // 2. VALIDACIÓN DE AUTENTICACIÓN
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // =================================================================
  // 👑 PASE VIP: SUPER ADMIN (SOLUCIÓN AL ERROR)
  // =================================================================
  // Si es el admin maestro, NO aplicamos lógica de empresa. 
  // Lo dejamos pasar a donde quiera ir (generalmente /master-admin)
  if (user.email === 'admin@admin.com' || user.role === 'SUPER_ADMIN') {
      return <Outlet />;
  }

  // =================================================================
  // 🛡️ USUARIOS NORMALES (Cajeros, Dueños de Local)
  // =================================================================
  
  // A. Si un usuario normal no tiene empresa, es un error de datos. Al login.
  if (!user.companyId) {
      console.error("⛔ Usuario sin empresa asignada.");
      return <Navigate to="/login" replace />;
  }

  // B. Validación de URL Raíz
  // Si entró a "/" (sin slug), lo mandamos a SU dashboard (/kiosco-pepe)
  // OJO: Verificamos que NO esté intentando ir a master-admin por error
  if (!companySlug) {
      // Si la ruta es exactamente la raiz "/" o no tiene params
      return <Navigate to={`/${user.companyId}`} replace />;
  }

  // C. Validación de Aislamiento (Cross-Tenant)
  // Si intenta entrar a /kiosco-juan pero es de /kiosco-pepe
  if (companySlug !== user.companyId) {
      console.warn(`⛔ Acceso cruzado bloqueado. Usuario de ${user.companyId} intentó entrar a ${companySlug}`);
      return <Navigate to={`/${user.companyId}`} replace />;
  }

  // 5. Todo OK
  return <Outlet />;
};