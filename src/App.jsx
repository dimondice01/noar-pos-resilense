// src/App.jsx

import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './layout/MainLayout';
import { useDbSeeder } from './core/hooks/useDbSeeder';
import { useAuthStore } from './modules/auth/store/useAuthStore';

// Componentes Auth
import { LoginPage } from './modules/auth/pages/LoginPage';
import { ProtectedRoute } from './core/components/ProtectedRoute';

// Páginas
import { DashboardPage } from './modules/dashboard/pages/DashboardPage';
import { PosPage } from './modules/pos/pages/PosPage';
import { InventoryPage } from './modules/inventory/pages/InventoryPage';
import { PrintLabelsPage } from './modules/inventory/pages/PrintLabelsPage'; // 👈 IMPORT NUEVO
import { SalesPage } from './modules/sales/pages/SalesPage';
import { TeamPage } from './modules/settings/pages/TeamPage'; 
import { CashPage } from './modules/cash/pages/CashPage'; 
import { ClientsPage } from './modules/clients/pages/ClientsPage';

function App() {
    const isDbReady = useDbSeeder();
    const initAuthListener = useAuthStore(state => state.initAuthListener);

    useEffect(() => {
        initAuthListener();
    }, []);

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
                {/* Ruta Pública: Login */}
                <Route path="/login" element={<LoginPage />} />

                {/* Rutas Protegidas */}
                <Route element={<ProtectedRoute />}>
                    <Route path="/" element={<MainLayout />}>
                        <Route index element={<DashboardPage />} />
                        <Route path="pos" element={<PosPage />} />
                        <Route path="sales" element={<SalesPage />} />
                        
                        {/* Rutas de Inventario */}
                        <Route path="inventory" element={<InventoryPage />} />
                        <Route path="inventory/print" element={<PrintLabelsPage />} /> {/* 👈 RUTA NUEVA */}

                        <Route path="cash" element={<CashPage />} />
                        <Route path="settings" element={<TeamPage />} />
                        <Route path="clients" element={<ClientsPage />} />
                    </Route>
                </Route>
                
                {/* Catch all */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;