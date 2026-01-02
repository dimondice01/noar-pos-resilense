import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './layout/MainLayout';

// ✅ Store de Autenticación
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
import { CompanySettingsPage } from './modules/admin/pages/CompanySettingsPage';

function App() {
    const { user, initAuthListener } = useAuthStore();

    // 1. EFECTO DE ARRANQUE
    useEffect(() => {
        initAuthListener();
    }, []);

    // 2. EFECTO DE SINCRONIZACIÓN
    useEffect(() => {
        if (user && user.companyId) {
            console.log(`🏢 [SaaS] Empresa detectada: ${user.companyId}. Sync activo.`);
            syncService.startRealTimeListeners();
        } else {
            syncService.stopListeners();
        }
    }, [user]); 

    return (
        <BrowserRouter>
            <Routes>
                {/* === ZONA PÚBLICA === */}
                
                {/* Login Genérico */}
                <Route path="/login" element={<LoginPage />} />
                
                {/* Login Personalizado (ej: /login/kiosco-pepe) */}
                <Route path="/login/:companySlug" element={<LoginPage />} />

                {/* === ZONA PRIVADA (Protegida) === */}
                <Route element={<ProtectedRoute />}>
                    
                    {/* 🔥 CAMBIO MAESTRO: Todas las rutas cuelgan del ID de la empresa */}
                    <Route path="/:companySlug" element={<MainLayout />}>
                        
                        {/* Dashboard: /kiosco-pepe/ */}
                        <Route index element={<DashboardPage />} />
                        
                        {/* Módulos Operativos */}
                        <Route path="pos" element={<PosPage />} />
                        <Route path="sales" element={<SalesPage />} />
                        <Route path="cash" element={<CashPage />} />
                        
                        {/* Inventario */}
                        <Route path="inventory" element={<InventoryPage />} />
                        <Route path="inventory/print" element={<PrintLabelsPage />} />
                        <Route path="inventory/movements" element={<MovementsPage />} /> 

                        {/* Clientes */}
                        <Route path="clients" element={<ClientsPage />} />
                        
                        {/* Configuración */}
                        <Route path="settings" element={<TeamPage />} />
                        <Route path="settings/integrations" element={<IntegrationsPage />} />
                        <Route path="settings/company" element={<CompanySettingsPage />} />
                        
                        {/* Super Admin */}
                        <Route path="master-admin" element={<SuperAdminPage />} />
                    </Route>
                </Route>
                
                {/* Redirección por defecto: Al login genérico */}
                <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;