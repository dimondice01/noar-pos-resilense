// Fuente única de verdad para los permisos granulares de cajeros.
// Cualquier clave nueva se agrega solo acá — TeamPage, guards y consumidores la heredan automáticamente.

export const PERMISSION_KEYS = [
    'canApplyDiscount',
    'canVoidSales',
    'canWithdrawCash',
    'canSeeExpectedCash',
    'canAddStock',
    'canRemoveStock',
    'canChangePrices',
    'canExportScale',
];

export const PERMISSION_DEFINITIONS = {
    canApplyDiscount: {
        label: 'Aplicar Descuentos',
        description: 'Permite aplicar descuentos manuales en el punto de venta.',
        group: 'Caja y Ventas',
    },
    canVoidSales: {
        label: 'Anular Ventas',
        description: 'Permite anular ventas ya registradas.',
        group: 'Caja y Ventas',
    },
    canWithdrawCash: {
        label: 'Retirar Efectivo',
        description: 'Permite registrar retiros de efectivo de la caja.',
        group: 'Caja y Ventas',
    },
    canSeeExpectedCash: {
        label: 'Ver Cierre Z',
        description: 'Permite ver el monto esperado de caja en el cierre de turno.',
        group: 'Caja y Ventas',
    },
    canAddStock: {
        label: 'Cargar Stock',
        description: 'Permite cargar stock e ingresar compras al inventario.',
        group: 'Gestión de Inventario',
    },
    canRemoveStock: {
        label: 'Ajuste de Mermas',
        description: 'Permite registrar mermas/ajustes negativos de stock.',
        group: 'Gestión de Inventario',
    },
    canChangePrices: {
        label: 'Cambiar Precios',
        description: 'Permite modificar precios de productos.',
        group: 'Gestión de Inventario',
    },
    canExportScale: {
        label: 'Listados de Balanza',
        description: 'Permite exportar el listado de productos pesables a la balanza (KRETZ/SYSTEL).',
        group: 'Gestión de Inventario',
    },
};

export const DEFAULT_PERMISSIONS = PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = false;
    return acc;
}, {});

const ELEVATED_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN'];

export const isElevatedRole = (role) => ELEVATED_ROLES.includes(role);

// Devuelve el objeto completo de permisos para un usuario: roles elevados
// tienen bypass total (siempre true), el resto hereda DEFAULT_PERMISSIONS
// completado con lo que tenga guardado (claves ausentes -> false, igual que hoy).
export const getFullPermissions = (role, permissions) => {
    if (isElevatedRole(role)) {
        return PERMISSION_KEYS.reduce((acc, key) => {
            acc[key] = true;
            return acc;
        }, {});
    }
    return { ...DEFAULT_PERMISSIONS, ...(permissions || {}) };
};

export const hasPermission = (user, key) => {
    return getFullPermissions(user?.role, user?.permissions)[key] === true;
};
