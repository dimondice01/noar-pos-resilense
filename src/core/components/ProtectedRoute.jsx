import React from 'react';
import { Navigate, Outlet, useParams } from 'react-router-dom'; // 1. IMPORTAR useParams
import { useAuthStore } from '../../modules/auth/store/useAuthStore';

export const ProtectedRoute = () => {
  const { user, isLoading } = useAuthStore();
  
  // 2. CAPTURAMOS LA URL ACTUAL (Si existe el parámetro)
  const { companySlug } = useParams(); 

  // Pantalla de Carga
  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-sys-50">
        <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-sys-200 border-t-brand"></div>
            <p className="text-sys-400 text-xs font-medium animate-pulse">Verificando acceso...</p>
        </div>
      </div>
    );
  }

  // 3. VALIDACIÓN DE AUTENTICACIÓN
  if (!user) {
    // Si no está logueado, lo mandamos al login.
    // (Podríamos mandarlo a /login/slug si supiéramos cual es, pero como no está logueado, no sabemos)
    return <Navigate to="/login" replace />;
  }

  // 4. 🛡️ EL ENFORCER (Validación de Aislamiento)
  
  // Obtenemos el ID real de la empresa del usuario logueado
  const userCompanyId = user.companyId;

  // CASO A: El usuario está logueado pero entró a la raíz "/" (sin slug)
  // Lo redirigimos a su dashboard: /kiosco-pepe
  if (!companySlug) {
      return <Navigate to={`/${userCompanyId}`} replace />;
  }

  // CASO B: El usuario intenta entrar a la empresa de OTRO (/kiosco-juan)
  // Lo redirigimos forzosamente a la suya (/kiosco-pepe)
  if (companySlug !== userCompanyId) {
      console.warn(`⛔ Acceso denegado a ${companySlug}. Redirigiendo a ${userCompanyId}`);
      return <Navigate to={`/${userCompanyId}`} replace />;
  }

  // 5. Si todo coincide (Usuario logueado + URL correcta), mostramos la App
  return <Outlet />;
};