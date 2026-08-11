import React, { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../../modules/auth/store/useAuthStore';
import { hasPermission } from '../../modules/settings/config/permissions';
import { PinAuthModal } from '../../modules/security/components/PinAuthModal';

// Guard de ruta por permiso granular. Roles elevados (OWNER/SUPER_ADMIN/ADMIN)
// y cajeros con el permiso requerido pasan directo, sin fricción.
// Un cajero sin el permiso ve el mismo PinAuthModal que ya conoce de Inventario;
// PIN correcto autoriza el acceso puntual (no persiste el permiso), cancelar
// devuelve al dashboard de la empresa.
export const ModuleAccessGuard = ({ requiredPermission, children, actionName }) => {
    const { user } = useAuthStore();
    const { companySlug } = useParams();
    const [authorized, setAuthorized] = useState(false);
    const [cancelled, setCancelled] = useState(false);

    if (hasPermission(user, requiredPermission)) {
        return children;
    }

    if (authorized) {
        return children;
    }

    if (cancelled) {
        return <Navigate to={`/${companySlug || user?.companyId}`} replace />;
    }

    return (
        <div className="h-screen w-full flex items-center justify-center bg-sys-50">
            <PinAuthModal
                isOpen={true}
                actionName={actionName}
                onClose={() => setCancelled(true)}
                onSuccess={() => setAuthorized(true)}
            />
        </div>
    );
};
