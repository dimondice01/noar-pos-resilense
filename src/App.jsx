import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './layout/MainLayout';
// Importa el hook de base de datos
import { useDbSeeder } from './core/hooks/useDbSeeder';

// Imports de páginas
import { DashboardPage } from './modules/dashboard/pages/DashboardPage';
import { PosPage } from './modules/pos/pages/PosPage';
import { InventoryPage } from './modules/inventory/pages/InventoryPage';
import { SalesPage } from './modules/sales/pages/SalesPage'; // ✅ Nueva importación

function App() {
  // 🔥 Inicializamos la DB al arrancar
  const isDbReady = useDbSeeder();

  if (!isDbReady) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-sys-50">
        <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto mb-4"></div>
            <p className="text-sys-500 font-medium">Iniciando sistema local...</p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="pos" element={<PosPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          
          {/* 👇 Ruta Conectada: Ventas & Facturación AFIP */}
          <Route path="sales" element={<SalesPage />} />
          
          <Route path="settings" element={<div className="p-10">Configuración (En construcción)</div>} />
        </Route>
        
        {/* Catch all - Redirigir a Home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;