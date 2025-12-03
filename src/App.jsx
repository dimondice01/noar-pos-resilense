import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './layout/MainLayout';
// Importa el hook de base de datos
import { useDbSeeder } from './core/hooks/useDbSeeder';

// Imports de páginas
import { DashboardPage } from './modules/dashboard/pages/DashboardPage';
import { PosPage } from './modules/pos/pages/PosPage';
import { InventoryPage } from './modules/inventory/pages/InventoryPage';
import { SalesPage } from './modules/sales/pages/SalesPage';
import { MovementsPage } from './modules/inventory/pages/MovementsPage';
// 👇 Importamos la nueva página de Control de Caja (Auditoría)
import { CashPage } from './modules/cash/pages/CashPage';

// 👇 Importamos el Guardián de Caja
import { CashGuard } from './modules/cash/components/CashGuard';

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
        {/* Envolvemos la ruta principal con el CashGuard para bloquear si no hay caja abierta */}
        <Route path="/" element={
          <CashGuard>
            <MainLayout />
          </CashGuard>
        }>
          <Route index element={<DashboardPage />} />
          <Route path="pos" element={<PosPage />} />
          
          {/* Módulo de Inventario */}
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="inventory/movements" element={<MovementsPage />} />
          
          {/* Módulo de Ventas & Facturación AFIP */}
          <Route path="sales" element={<SalesPage />} />
          
          {/* 👇 Módulo de Caja (Auditoría y Cierres) */}
          <Route path="cash" element={<CashPage />} />
          
          <Route path="settings" element={<div className="p-10">Configuración (En construcción)</div>} />
        </Route>
        
        {/* Catch all - Redirigir a Home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;