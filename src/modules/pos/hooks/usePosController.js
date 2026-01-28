import { useState, useEffect, useMemo, useCallback } from 'react';
import { productRepository } from '../../inventory/repositories/productRepository';
import { salesRepository } from '../../sales/repositories/salesRepository';
import { cashRepository } from '../../cash/repositories/cashRepository';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { toast } from 'react-hot-toast'; // O tu librería de notificaciones preferida

// =================================================================
// 🧠 POS CONTROLLER (CEREBRO MULTI-SESIÓN)
// =================================================================
// Maneja múltiples carritos simultáneos, búsqueda, totales y cobro.
// =================================================================

const NEW_TAB_TEMPLATE = {
    id: 1, // Se sobrescribe al crear
    name: 'Venta 1',
    items: [],
    client: null, // Consumidor Final por defecto
    discount: 0,
    paymentMethod: 'cash'
};

export const usePosController = () => {
    // 1. ESTADO DE SESIONES (PESTAÑAS)
    const [tabs, setTabs] = useState([{ ...NEW_TAB_TEMPLATE, id: Date.now() }]);
    const [activeTabId, setActiveTabId] = useState(tabs[0].id);
    
    // Estado Global UI
    const [isProcessing, setIsProcessing] = useState(false);
    const [searchResults, setSearchResults] = useState([]);
    const [globalScanBuffer, setGlobalScanBuffer] = useState(''); // Para lector de código de barras físico

    // =================================================================
    // 🕹️ GESTIÓN DE PESTAÑAS (TABS)
    // =================================================================
    
    const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId) || tabs[0], [tabs, activeTabId]);

    const addTab = useCallback(() => {
        const newId = Date.now();
        const nextNumber = tabs.length + 1;
        const newTab = { 
            ...NEW_TAB_TEMPLATE, 
            id: newId, 
            name: `Venta ${nextNumber}` 
        };
        setTabs(prev => [...prev, newTab]);
        setActiveTabId(newId);
    }, [tabs.length]);

    const removeTab = useCallback((tabId) => {
        if (tabs.length === 1) {
            // Si es la última, solo la limpiamos, no la borramos
            clearCart(tabId);
            return;
        }
        
        const newTabs = tabs.filter(t => t.id !== tabId);
        setTabs(newTabs);
        
        // Si cerramos la activa, saltamos a la anterior
        if (activeTabId === tabId) {
            setActiveTabId(newTabs[newTabs.length - 1].id);
        }
    }, [tabs, activeTabId]);

    const switchTab = (tabId) => setActiveTabId(tabId);

    // Helper para modificar SOLO la pestaña activa de forma inmutable
    const updateActiveTab = (updaterFn) => {
        setTabs(prevTabs => prevTabs.map(tab => {
            if (tab.id === activeTabId) {
                return updaterFn(tab);
            }
            return tab;
        }));
    };

    // =================================================================
    // 🛒 LÓGICA DEL CARRITO (Cart Engine)
    // =================================================================

    const addToCart = useCallback((product, qty = 1) => {
        updateActiveTab(tab => {
            const existingIndex = tab.items.findIndex(i => i.id === product.id);
            let newItems = [...tab.items];

            if (existingIndex >= 0) {
                // Producto existe: Aumentar cantidad
                // Validar Stock (Opcional: permitir venta negativa según config)
                const currentQty = newItems[existingIndex].quantity;
                const newQty = currentQty + qty;

                // if (newQty > product.stock) { toast.error("Stock insuficiente"); return tab; }

                newItems[existingIndex] = {
                    ...newItems[existingIndex],
                    quantity: newQty,
                    subtotal: newQty * newItems[existingIndex].price
                };
            } else {
                // Producto nuevo
                newItems.push({
                    ...product, // Guardamos snapshot del producto (precio, costo) al momento de venta
                    quantity: qty,
                    subtotal: qty * product.price
                });
            }

            return { ...tab, items: newItems };
        });
        
        // Feedback sonoro o visual aquí
    }, [activeTabId]);

    const updateItemQuantity = (productId, newQty) => {
        if (newQty < 0) return; // O borrar si es 0
        if (newQty === 0) {
            removeFromCart(productId);
            return;
        }

        updateActiveTab(tab => {
            const newItems = tab.items.map(item => {
                if (item.id === productId) {
                    return { ...item, quantity: newQty, subtotal: newQty * item.price };
                }
                return item;
            });
            return { ...tab, items: newItems };
        });
    };

    const removeFromCart = (productId) => {
        updateActiveTab(tab => ({
            ...tab,
            items: tab.items.filter(i => i.id !== productId)
        }));
    };

    const setClient = (client) => {
        updateActiveTab(tab => ({ ...tab, client }));
    };

    const clearCart = (targetTabId = activeTabId) => {
        setTabs(prev => prev.map(tab => {
            if (tab.id === targetTabId) {
                return { ...NEW_TAB_TEMPLATE, id: targetTabId, name: tab.name }; // Reseteamos manteniendo ID y Nombre
            }
            return tab;
        }));
    };

    // =================================================================
    // 🧮 CALCULADORA DE TOTALES (En tiempo real)
    // =================================================================
    const totals = useMemo(() => {
        const subtotal = activeTab.items.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        // Si hay descuento global (porcentaje)
        const discountAmount = activeTab.discount > 0 ? (subtotal * (activeTab.discount / 100)) : 0;
        const total = subtotal - discountAmount;
        
        return {
            subtotal,
            discountAmount,
            total,
            itemCount: activeTab.items.reduce((acc, i) => acc + i.quantity, 0)
        };
    }, [activeTab.items, activeTab.discount]);

    // =================================================================
    // 🔎 BUSCADOR INTELIGENTE
    // =================================================================
    const searchProduct = async (query) => {
        if (!query) {
            setSearchResults([]);
            return;
        }

        // 1. Intento Exacto (Código de barras) - Rápido
        const exactMatch = await productRepository.findByCode(query);
        if (exactMatch) {
            // Si es escaneo exacto, agregar directo y limpiar búsqueda
            addToCart(exactMatch, 1);
            setSearchResults([]);
            return true; // Match encontrado
        }

        // 2. Búsqueda Difusa (Nombre) - Para UI
        // Solo si la query tiene más de 3 caracteres para no saturar
        if (query.length > 2) {
             const results = await productRepository.search(query); // Asumiendo que implementaste search en productRepo
             setSearchResults(results.slice(0, 10)); // Top 10
             return false;
        }
    };

    // =================================================================
    // 💳 PROCESO DE COBRO (CHECKOUT)
    // =================================================================
    const processSale = async (paymentData) => {
        if (activeTab.items.length === 0) {
            toast.error("El carrito está vacío");
            return;
        }

        setIsProcessing(true);
        try {
            // 1. Validar Caja Abierta
            const currentShift = await cashRepository.getCurrentShift();
            if (!currentShift) {
                throw new Error("⚠️ DEBES ABRIR CAJA ANTES DE VENDER");
            }

            // 2. Preparar Datos Venta
            const salePayload = {
                items: activeTab.items.map(i => ({
                    id: i.id,
                    code: i.code,
                    name: i.name,
                    price: i.price,
                    cost: i.cost, // Importante para reportes de ganancia
                    quantity: i.quantity,
                    isWeighable: i.isWeighable,
                    taxRate: i.taxRate || 21
                })),
                client: activeTab.client, // Si es null, salesRepo lo maneja como Consumidor Final
                total: totals.total,
                subtotal: totals.subtotal,
                discount: totals.discountAmount,
                payment: {
                    method: paymentData.method, // 'cash', 'card', 'qr', 'checking_account'
                    amountTendered: paymentData.amountTendered, // Con cuánto pagó
                    change: paymentData.change // Vuelto
                },
                branchId: currentShift.branchId, // Vinculamos a la sucursal del turno
                shiftId: currentShift.id // Vinculamos al turno actual
            };

            // 3. Impactar en Base de Datos (Atomic)
            const result = await salesRepository.createSale(salePayload);
            
            // 4. Éxito
            toast.success(`Venta ${result.number} registrada!`);
            
            // 5. Limpiar pestaña actual (o cerrarla si prefieres)
            clearCart();
            
            // Opcional: Retornar ticket para imprimir
            return result;

        } catch (error) {
            console.error("Error en cobro:", error);
            toast.error(error.message);
        } finally {
            setIsProcessing(false);
        }
    };

    // =================================================================
    // 🎹 ATAJOS DE TECLADO (Barcode Scanner Listener)
    // =================================================================
    // Detecta input rápido de lector de barras que actúa como teclado
    useEffect(() => {
        let buffer = '';
        let lastKeyTime = Date.now();

        const handleKeyDown = (e) => {
            const currentTime = Date.now();
            const char = e.key;

            // Si pasa mucho tiempo entre teclas, reseteamos (es tipeo humano)
            if (currentTime - lastKeyTime > 100) {
                buffer = '';
            }
            lastKeyTime = currentTime;

            if (char === 'Enter') {
                if (buffer.length > 3) { // Asumimos código de barras > 3 chars
                    searchProduct(buffer);
                    buffer = '';
                }
            } else if (char.length === 1) {
                buffer += char;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    return {
        // Estado
        tabs,
        activeTab,
        activeTabId,
        totals,
        searchResults,
        isProcessing,
        
        // Acciones Pestañas
        addTab,
        removeTab,
        switchTab,
        
        // Acciones Carrito
        addToCart,
        removeFromCart,
        updateItemQuantity,
        setClient,
        clearCart,
        
        // Acciones Negocio
        searchProduct,
        setSearchResults,
        processSale
    };
};