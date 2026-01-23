import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './layout/MainLayout';
import { Loader2 } from 'lucide-react'; 

// ✅ Store de Autenticación
import { useAuthStore } from './modules/auth/store/useAuthStore'; 

// 🔥 SERVICIO DE SINCRONIZACIÓN
import { syncService } from './modules/sync/services/syncService';

// Componentes Auth
import { LoginPage } from './modules/auth/pages/LoginPage';
import { RegisterPage } from './modules/auth/pages/RegisterPage'; 
import { ValeriaRegisterPage } from './modules/auth/pages/ValeriaRegisterPage'; 

import { PaymentRequiredPage } from './modules/auth/pages/PaymentRequiredPage'; 
import { ProtectedRoute } from './core/components/ProtectedRoute';
import { SubscriptionGuard } from './core/guards/SubscriptionGuard'; 

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
    // 👇 CORRECCIÓN AQUÍ: Usamos 'isLoading' en lugar de 'loading'
    const { user, initAuthListener, isLoading } = useAuthStore();

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

    // 🛑 BLOQUEO GLOBAL DE CARGA
    // Ahora sí funcionará porque isLoading es true al inicio
    if (isLoading) {
        return (
            <div className="h-screen w-screen flex flex-col items-center justify-center bg-sys-50">
                <Loader2 className="animate-spin text-brand mb-4" size={48} />
                <div className="text-center">
                    <p className="text-sys-900 font-bold text-lg">Iniciando Noar POS</p>
                    <p className="text-sys-400 text-sm animate-pulse">Conectando con tu negocio...</p>
                </div>
            </div>
        );
    }

    return (
        <BrowserRouter>
            <Routes>
                {/* === ZONA PÚBLICA === */}
                
                {/* 🚀 LANDING PAGE */}
                <Route path="/" element={<LandingPage />} />
                
                {/* ✨ REGISTRO */}
                <Route path="/register" element={<RegisterPage />} /> 
                <Route path="/valeria" element={<ValeriaRegisterPage />} /> 

                {/* Login Genérico */}
                <Route path="/login" element={<LoginPage />} />
                
                {/* Login Personalizado */}
                <Route path="/login/:companySlug" element={<LoginPage />} />

                {/* 🔴 RUTA DE BLOQUEO POR PAGO */}
                <Route path="/plan-expired" element={<PaymentRequiredPage />} />

                {/* === ZONA PRIVADA (Protegida) === */}
                <Route element={<ProtectedRoute />}>
                    
                    {/* 👑 RUTA SUPER ADMIN */}
                    <Route path="/master-admin" element={<SuperAdminPage />} />

                    {/* 🔥 RUTAS DE EMPRESA */}
                    <Route path="/:companySlug" element={
                        <SubscriptionGuard> 
                            <MainLayout />
                        </SubscriptionGuard>
                    }>
                        
                        {/* Dashboard */}
                        <Route index element={<DashboardPage />} />
                        
                        {/* Módulos */}
                        <Route path="fiscal" element={<FiscalDashboardPage />} />
                        <Route path="pos" element={<PosPage />} />
                        <Route path="sales" element={<SalesPage />} />
                        <Route path="cash" element={<CashPage />} />
                        <Route path="inventory" element={<InventoryPage />} />
                        <Route path="inventory/print" element={<PrintLabelsPage />} />
                        <Route path="inventory/movements" element={<MovementsPage />} /> 
                        <Route path="clients" element={<ClientsPage />} />
                        <Route path="suppliers" element={<SuppliersPage />} />
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