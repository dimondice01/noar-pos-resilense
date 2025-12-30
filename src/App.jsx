import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './layout/MainLayout';

// ✅ Store de Autenticación
import { useAuthStore } from './modules/auth/store/useAuthStore'; 

// 🔥 SERVICIO DE SINCRONIZACIÓN
// (Asegúrate que la ruta sea correcta, a veces está en inventory/services o sync/services)
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
    // 👇 Obtenemos el usuario y el inicializador
    const { user, initAuthListener } = useAuthStore();

    // 1. EFECTO DE ARRANQUE (Solo una vez)
    useEffect(() => {
        initAuthListener();
    }, []);

    // 2. EFECTO DE SINCRONIZACIÓN (Reactivo al Usuario)
    // 
    useEffect(() => {
        // Solo arrancamos el Sync si el usuario ya cargó Y tiene empresa asignada
        if (user && user.companyId) {
            console.log(`🏢 [SaaS] Empresa detectada: ${user.companyId}. Iniciando motores de sincronización...`);
            syncService.startRealTimeListeners();
        } else {
            // Si no hay usuario (logout) o no tiene empresa, apagamos listeners para no generar errores
            syncService.stopListeners();
        }
    }, [user]); // 👈 CLAVE: Este efecto se dispara cada vez que 'user' cambia

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
                        
                        {/* 🕵️‍♂️ RUTA SECRETA: Panel de Super Admin */}
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