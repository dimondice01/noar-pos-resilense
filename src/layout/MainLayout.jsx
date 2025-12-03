import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export const MainLayout = () => {
  return (
    <div className="min-h-screen bg-sys-50 flex">
      {/* Sidebar fijo a la izquierda */}
      <Sidebar />

      {/* Área de contenido principal */}
      <main className="flex-1 md:ml-64 p-4 md:p-8 transition-all duration-300">
        <div className="max-w-7xl mx-auto">
            {/* Outlet renderiza la ruta hija (Dashboard, POS, etc.) */}
            <Outlet />
        </div>
      </main>
    </div>
  );
};