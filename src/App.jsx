import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './layout/MainLayout';
import { Loader2 } from 'lucide-react'; 
import { Toaster } from 'react-hot-toast'; // 🔥 AÑADIDO: Importación del Toaster

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

// ✅ LANDING PAGE (Informativa en /info)
import { LandingPage } from './modules/landing/pages/LandingPage';

// Páginas del Sistema
import { DashboardPage } from './modules/dashboard/pages/DashboardPage';
import { FiscalDashboardPage } from './modules/sales/pages/FiscalDashboardPage'; 
import { PosPage } from './modules/pos/pages/PosPage';

// 🔥 REPORTES & BI
import { AnalyticsDashboard } from './modules/reports/pages/AnalyticsDashboard';

// 📦 INVENTARIO
import { InventoryPage } from './modules/inventory/pages/InventoryPage';
import { PrintLabelsPage } from './modules/inventory/pages/PrintLabelsPage';
import { MovementsPage } from './modules/inventory/pages/MovementsPage'; 

// 🚛 PROVEEDORES & COMPRAS
import { SuppliersPage } from './modules/suppliers/pages/SuppliersPage'; 
import { SupplierDashboard } from './modules/suppliers/pages/SupplierDashboard'; // 🔥 NUEVO: Importación del Dashboard
import { PurchaseHistoryPage } from './modules/suppliers/pages/PurchaseHistoryPage'; 
import { PurchasePage } from './modules/suppliers/pages/PurchasePage'; 

import { SalesPage } from './modules/sales/pages/SalesPage';
import { TeamPage } from './modules/settings/pages/TeamPage'; 
import { IntegrationsPage } from './modules/settings/pages/IntegrationsPage'; 
import { SuperAdminPage } from './modules/admin/pages/SuperAdminPage'; 
import { CashPage } from './modules/cash/pages/CashPage'; 
import { ClientsPage } from './modules/clients/pages/ClientsPage';
import { CompanySettingsPage } from './modules/admin/pages/CompanySettingsPage';
import { QATestPage } from './modules/qa/QATestPage'; // 🧪 QA TEMPORAL

function App() {
    const { user, initAuthListener, isLoading } = useAuthStore();

    useEffect(() => { initAuthListener(); }, []);

    useEffect(() => {
        if (user && user.companyId) {
            console.log(`🏢 [SaaS] Sync activo.`);
            syncService.startRealTimeListeners();
        } else {
            syncService.stopListeners();
        }
    }, [user]); 

    if (isLoading) {
        return (
            <div className="h-screen w-screen flex flex-col items-center justify-center bg-sys-50">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="animate-spin text-brand" size={48} />
                    <div className="flex flex-col items-center">
                        <p className="text-sys-900 font-black text-xl tracking-tighter">NOAR POS</p>
                        <p className="text-sys-400 text-xs font-bold uppercase tracking-widest">Nexus Core Engine</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <BrowserRouter>
            {/* 🔥 AÑADIDO: Configuración Global de Notificaciones (Toaster) */}
            <Toaster 
                position="top-center" 
                toastOptions={{
                    duration: 3000,
                    style: {
                        background: '#333',
                        color: '#fff',
                        fontSize: '14px',
                        borderRadius: '10px',
                        fontWeight: '500'
                    },
                    success: {
                        iconTheme: {
                            primary: '#10b981',
                            secondary: '#fff',
                        },
                    },
                    error: {
                        iconTheme: {
                            primary: '#ef4444',
                            secondary: '#fff',
                        },
                    },
                }}
            />

            <Routes>
                {/* === ZONA PÚBLICA === */}
                
                {/* 🔥 CAMBIO CLAVE: La raíz ahora es el LOGIN */}
                <Route path="/" element={<LoginPage />} />
                
                {/* Si quieres mantener la landing accesible, usa otra ruta */}
                <Route path="/info" element={<LandingPage />} />

                <Route path="/register" element={<RegisterPage />} /> 
                <Route path="/valeria" element={<ValeriaRegisterPage />} /> 
                
                {/* Rutas de login específicas (slug) */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/login/:companySlug" element={<LoginPage />} />
                
                <Route path="/plan-expired" element={<PaymentRequiredPage />} />
                <Route path="/qa-test" element={<QATestPage />} /> {/* 🧪 QA TEMPORAL */}

                {/* === ZONA PRIVADA === */}
                <Route element={<ProtectedRoute />}>
                    <Route path="/master-admin" element={<SuperAdminPage />} />

                    <Route path="/:companySlug" element={
                        <SubscriptionGuard> 
                            <MainLayout /> 
                        </SubscriptionGuard>
                    }>
                        <Route index element={<DashboardPage />} />
                        
                        {/* 🔥 NUEVA RUTA DE MÉTRICAS BI */}
                        <Route path="reports" element={<AnalyticsDashboard />} />
                        
                        <Route path="fiscal" element={<FiscalDashboardPage />} />
                        <Route path="pos" element={<PosPage />} />
                        <Route path="sales" element={<SalesPage />} />
                        <Route path="cash" element={<CashPage />} />
                        
                        {/* INVENTARIO */}
                        <Route path="inventory" element={<InventoryPage />} />
                        <Route path="inventory/print-labels" element={<PrintLabelsPage />} />
                        <Route path="inventory/movements" element={<MovementsPage />} /> 
                        
                        {/* 🚛 PROVEEDORES Y COMPRAS */}
                        <Route path="suppliers" element={<SuppliersPage />} />
                        {/* 🔥 NUEVA RUTA: Dashboard individual del proveedor */}
                        <Route path="suppliers/dashboard/:supplierId" element={<SupplierDashboard />} />
                        <Route path="suppliers/purchases" element={<PurchaseHistoryPage />} />
                        <Route path="suppliers/purchases/new" element={<PurchasePage />} />

                        <Route path="clients" element={<ClientsPage />} />
                        <Route path="settings" element={<TeamPage />} />
                        <Route path="settings/integrations" element={<IntegrationsPage />} />
                        <Route path="settings/company" element={<CompanySettingsPage />} />
                    </Route>
                </Route>
                
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;