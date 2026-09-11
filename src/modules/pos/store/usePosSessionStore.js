import { create } from 'zustand';

// =================================================================
// 🧠 STORE DE SESIÓN POS (Pestañas/Carritos en RAM)
// =================================================================
// Antes este estado vivía en useState() dentro de usePosController — se
// perdía cada vez que el componente se desmontaba (ej: navegar a Inventario
// y volver a POS). Sacarlo a un store de Zustand (singleton fuera del árbol
// de React) hace que sobreviva a la navegación entre rutas de la SPA.
//
// 🔒 A PROPÓSITO SIN `persist`: este mismo dispositivo puede ser usado por
// varios cajeros en el día (ver el bug de useShiftStore — un turno cacheado
// de otro cajero). Si esto persistiera en localStorage, un cajero nuevo
// heredaría el carrito del anterior. Por eso vive solo en RAM (sobrevive a
// cambiar de ruta) y se limpia explícitamente al cerrar sesión — ver
// resetSession() y su uso en useAuthStore.logout().

const NEW_TAB_TEMPLATE = {
    id: 1,
    name: 'Venta 1',
    items: [],
    client: null,
    discount: 0,
    paymentMethod: 'cash'
};

const initialTabId = Date.now();

export const usePosSessionStore = create((set) => ({
    tabs: [{ ...NEW_TAB_TEMPLATE, id: initialTabId }],
    activeTabId: initialTabId,

    setTabs: (updater) => set((state) => ({
        tabs: typeof updater === 'function' ? updater(state.tabs) : updater
    })),

    setActiveTabId: (updater) => set((state) => ({
        activeTabId: typeof updater === 'function' ? updater(state.activeTabId) : updater
    })),

    // 🔒 Se llama desde useAuthStore.logout() — nunca dejar el carrito de un
    // cajero visible para el próximo que loguee en esta misma compu.
    resetSession: () => {
        const freshId = Date.now();
        set({ tabs: [{ ...NEW_TAB_TEMPLATE, id: freshId }], activeTabId: freshId });
    }
}));
