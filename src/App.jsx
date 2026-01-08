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

// ✅ LANDING PAGE
import { LandingPage } from './modules/landing/pages/LandingPage';

// Páginas del Sistema
import { DashboardPage } from './modules/dashboard/pages/DashboardPage';
import { FiscalDashboardPage } from './modules/sales/pages/FiscalDashboardPage'; 
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
import { SuppliersPage } from './modules/suppliers/pages/SuppliersPage'; 
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
                
                {/* 🚀 LANDING PAGE: Lo primero que ven los clientes */}
                <Route path="/" element={<LandingPage />} />
                
                {/* Login Genérico (noarpos.com/login) */}
                <Route path="/login" element={<LoginPage />} />
                
                {/* Login Personalizado (ej: noarpos.com/login/kiosco-pepe) */}
                <Route path="/login/:companySlug" element={<LoginPage />} />

                {/* === ZONA PRIVADA (Protegida) === */}
                <Route element={<ProtectedRoute />}>
                    
                    {/* 👑 RUTA SUPER ADMIN (GLOBAL - SIN EMPRESA) */}
                    {/* Esta ruta va ANTES y FUERA del layout de empresa */}
                    <Route path="/master-admin" element={<SuperAdminPage />} />

                    {/* 🔥 RUTAS DE EMPRESA (Multi-Tenant) */}
                    {/* Todo lo que requiera un companySlug va aquí dentro */}
                    <Route path="/:companySlug" element={<MainLayout />}>
                        
                        {/* Dashboard: /kiosco-pepe/ */}
                        <Route index element={<DashboardPage />} />
                        
                        {/* 🔥 Módulo Fiscal */}
                        <Route path="fiscal" element={<FiscalDashboardPage />} />

                        {/* Módulos Operativos */}
                        <Route path="pos" element={<PosPage />} />
                        <Route path="sales" element={<SalesPage />} />
                        <Route path="cash" element={<CashPage />} />
                        
                        {/* Inventario */}
                        <Route path="inventory" element={<InventoryPage />} />
                        <Route path="inventory/print" element={<PrintLabelsPage />} />
                        <Route path="inventory/movements" element={<MovementsPage />} /> 

                        {/* Clientes y Proveedores */}
                        <Route path="clients" element={<ClientsPage />} />
                        <Route path="suppliers" element={<SuppliersPage />} /> {/* 🔥 RUTA NUEVA */}
                        
                        {/* Configuración */}
                        <Route path="settings" element={<TeamPage />} />
                        <Route path="settings/integrations" element={<IntegrationsPage />} />
                        <Route path="settings/company" element={<CompanySettingsPage />} />
                        
                    </Route>
                </Route>
                
                {/* Fallback Inteligente */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;