import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './layout/MainLayout';

// ✅ IMPORTANTE: Verifica que esta ruta coincida con tu carpeta real ('store' o 'hooks')
import { useAuthStore } from './modules/auth/store/useAuthStore'; 

// 🔥 SERVICIO DE SINCRONIZACIÓN
import { syncService } from './modules/sync/services/syncService';

// Componentes Auth
import { LoginPage } from './modules/auth/pages/LoginPage';
import { ProtectedRoute } from './core/components/ProtectedRoute';

// Páginas
import { DashboardPage } from './modules/dashboard/pages/DashboardPage';
import { PosPage } from './modules/pos/pages/PosPage';
import { InventoryPage } from './modules/inventory/pages/InventoryPage';
import { PrintLabelsPage } from './modules/inventory/pages/PrintLabelsPage';
import { MovementsPage } from './modules/inventory/pages/MovementsPage'; 
import { SalesPage } from './modules/sales/pages/SalesPage';
import { TeamPage } from './modules/settings/pages/TeamPage'; 
import { IntegrationsPage } from './modules/settings/pages/IntegrationsPage'; 
import { SuperAdminPage } from './modules/admin/pages/SuperAdminPage'; 
import { CashPage } from './modules/cash/pages/CashPage'; 
import { ClientsPage } from './modules/clients/pages/ClientsPage';

function App() {
    // 👇 Solo inicializamos el listener de Auth
    const initAuthListener = useAuthStore(state => state.initAuthListener);

    useEffect(() => {
        // 1. Iniciar escucha de usuario (Firebase Auth)
        initAuthListener();
        
        // 2. Iniciar sincronización en segundo plano (Stock, Config)
        syncService.startRealTimeListeners();
    }, []);

    // 🚀 SIN BLOQUEOS: Renderizamos directo el Router
    return (
        <BrowserRouter>
            <Routes>
                {/* Ruta Pública: Login */}
                <Route path="/login" element={<LoginPage />} />

                {/* Rutas Protegidas (Requieren Login) */}
                <Route element={<ProtectedRoute />}>
                    <Route path="/" element={<MainLayout />}>
                        {/* Dashboard Principal */}
                        <Route index element={<DashboardPage />} />
                        
                        {/* Punto de Venta */}
                        <Route path="pos" element={<PosPage />} />
                        <Route path="sales" element={<SalesPage />} />
                        <Route path="cash" element={<CashPage />} />
                        
                        {/* Inventario */}
                        <Route path="inventory" element={<InventoryPage />} />
                        <Route path="inventory/print" element={<PrintLabelsPage />} />
                        <Route path="inventory/movements" element={<MovementsPage />} /> 

                        {/* Gestión de Clientes */}
                        <Route path="clients" element={<ClientsPage />} />
                        
                        {/* Configuración */}
                        <Route path="settings" element={<TeamPage />} />
                        <Route path="settings/integrations" element={<IntegrationsPage />} />
                        
                        {/* 🕵️‍♂️ RUTA SECRETA: Panel de Super Admin (Crear Empresas / Cargar Catálogo) */}
                        <Route path="/master-admin" element={<SuperAdminPage />} />
                    </Route>
                </Route>
                
                {/* Cualquier ruta desconocida redirige al inicio */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;