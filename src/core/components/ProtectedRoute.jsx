import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../modules/auth/store/useAuthStore';

export const ProtectedRoute = () => {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-sys-50">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-sys-200 border-t-brand"></div>
      </div>
    );
  }

  // Si no está autenticado, redirigir a Login
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
};