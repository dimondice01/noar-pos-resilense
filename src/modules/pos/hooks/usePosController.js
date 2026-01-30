import { useState, useEffect, useMemo, useCallback } from 'react';
import { productRepository } from '../../inventory/repositories/productRepository';
import { salesRepository } from '../../sales/repositories/salesRepository';
import { cashRepository } from '../../cash/repositories/cashRepository';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { paymentService } from '../../payments/services/paymentService'; // 🔥 IMPORT CRÍTICO
import { toast } from 'react-hot-toast'; 
import { doc, getDoc, updateDoc, setDoc, increment } from 'firebase/firestore'; // 🔥 Imports para contadores
import { db } from '../../../database/firebase'; // 🔥 Instancia DB

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
    const { user, activeBranchId } = useAuthStore(); // 🔑 Contexto de Sucursal Activa
    
    const [tabs, setTabs] = useState([{ ...NEW_TAB_TEMPLATE, id: Date.now() }]);
    const [activeTabId, setActiveTabId] = useState(tabs[0].id);
    
    // Estado Global UI
    const [isProcessing, setIsProcessing] = useState(false);
    const [searchResults, setSearchResults] = useState([]);
    
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
                const currentQty = newItems[existingIndex].quantity;
                const newQty = currentQty + qty;

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
        
    }, [activeTabId]);

    const updateItemQuantity = (productId, newQty) => {
        if (newQty < 0) return; 
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
            addToCart(exactMatch, 1);
            setSearchResults([]);
            return true; // Match encontrado
        }

        // 2. Búsqueda Difusa (Nombre) - Para UI
        if (query.length > 2) {
             const results = await productRepository.search(query); 
             setSearchResults(results.slice(0, 10)); // Top 10
             return false;
        }
    };

    // =================================================================
    // 💳 PROCESO DE COBRO (OPTIMIZADO MODO RIESGO/VELOCIDAD)
    // =================================================================
    const processSale = async (paymentData) => {
        if (activeTab.items.length === 0) {
            toast.error("El carrito está vacío");
            return;
        }

        // 🛡️ Validación de Seguridad: Sucursal Activa
        if (!activeBranchId) {
            toast.error("Error crítico: No hay sucursal activa seleccionada.");
            return;
        }

        setIsProcessing(true);
        let loadingToast = null;

        try {
            // 1. Validar Caja Abierta (Rápido, generalmente cacheado)
            const currentShift = await cashRepository.getCurrentShift();
            if (!currentShift) {
                throw new Error("⚠️ DEBES ABRIR CAJA ANTES DE VENDER");
            }

            // 🛡️ Validación de Seguridad: Coincidencia de Sucursal
            if (currentShift.branchId !== activeBranchId) {
                throw new Error("⚠️ EL TURNO ABIERTO NO PERTENECE A ESTA SUCURSAL. Por favor, cierre turno y vuelva a abrirlo en la sucursal correcta.");
            }

            // 2. Preparar Datos Base
            const finalTotal = paymentData.totalSale || totals.total;
            const finalBaseAmount = paymentData.baseAmount || totals.total;
            const finalSurcharge = paymentData.surcharge || 0;

            const basePayload = {
                items: activeTab.items.map(i => ({
                    id: i.id, code: i.code, name: i.name, price: i.price, cost: i.cost, quantity: i.quantity, isWeighable: i.isWeighable, taxRate: i.taxRate || 21, subtotal: i.subtotal
                })),
                client: activeTab.client, 
                total: finalTotal, 
                subtotal: totals.subtotal,
                discount: totals.discountAmount,
                baseAmount: finalBaseAmount,
                surcharge: finalSurcharge,
                payment: {
                    method: paymentData.method,
                    amountTendered: paymentData.amountTendered || finalTotal, 
                    change: paymentData.change || 0,
                    reference: paymentData.reference || '',
                    totalSale: finalTotal,
                    surcharge: finalSurcharge
                },
                branchId: activeBranchId, 
                shiftId: currentShift.id,
                companyId: user.companyId,
                operatorId: user.uid,
                operatorName: user.name,
                createdAt: new Date().toISOString(),
                status: 'COMPLETED'
            };

            let saleResult = null;

            // 🔥 3. BIFURCACIÓN FISCAL
            if (paymentData.withAfip) {
                // 🅰️ RUTA FISCAL (AFIP) - LENTA (Esperamos respuesta del servidor obligatoriamente)
                loadingToast = toast.loading("📡 Solicitando CAE a AFIP...");
                
                try {
                    // LLAMADA A CLOUD FUNCTION (Esto tarda 2-3 segs)
                    const afipResult = await paymentService.createInvoice({
                        ...basePayload,
                        // El backend determina letra A/B/C, pero podemos sugerir
                        invoiceLetter: activeTab.client?.fiscalCondition === 'RESPONSABLE_INSCRIPTO' ? 'A' : 'B'
                    });

                    // 🔥🔥 CORRECCIÓN DE MAPEO DE VARIABLES 🔥🔥
                    const ptoVta = afipResult.ptoVta || 1;
                    const cbteNumero = afipResult.numero || afipResult.cbteNumero; 
                    
                    const fiscalPayload = {
                        ...basePayload,
                        afip: {
                            status: 'APPROVED',
                            cae: afipResult.cae,
                            vtoCAE: afipResult.vencimiento || afipResult.caeFchVto, 
                            cbteNumero: cbteNumero,
                            cbteTipo: afipResult.tipo || afipResult.cbteTipo, 
                            cbteLetra: afipResult.letra, 
                            qr_data: afipResult.qr_data || afipResult.qrData,
                            ptoVta: ptoVta
                        },
                        // Forzamos el número de comprobante para que el repo local no genere uno X
                        number: `FC-${afipResult.letra}-${String(ptoVta).padStart(4,'0')}-${String(cbteNumero).padStart(8,'0')}`
                    };

                    // Guardamos en Local DB
                    saleResult = await salesRepository.createSale(fiscalPayload);
                    toast.dismiss(loadingToast);
                    toast.success(`✅ Factura ${fiscalPayload.afip.cbteLetra} autorizada!`);

                } catch (afipError) {
                    toast.dismiss(loadingToast);
                    throw new Error(`Error AFIP: ${afipError.message}`);
                }
            } else {
                // 🅱️ RUTA NO FISCAL (TICKET X) - MODO VELOCIDAD (OPTIMIZADO)
                
                // 1. Obtener referencia al contador
                const counterRef = doc(db, 'companies', user.companyId, 'branches', activeBranchId, 'counters', 'ticket_x');
                
                let nextNumber = 1;

                try {
                    // LECTURA (Espera brevemente para tener el número correcto)
                    const snap = await getDoc(counterRef);
                    
                    if (snap.exists()) {
                        nextNumber = snap.data().current + 1; // Calculamos el siguiente
                    }

                    // 🔥 ESCRITURA EN SEGUNDO PLANO (NO ESPERAMOS EL AWAIT)
                    // Esto es lo que da la velocidad "instantánea".
                    updateDoc(counterRef, { current: increment(1) }).catch(err => {
                        // Si falla porque no existe, lo creamos
                        if (err.code === 'not-found') setDoc(counterRef, { current: 1 });
                    });

                } catch (error) {
                    console.error("Error lectura contador, usando fallback fecha:", error);
                    // Fallback extremo si no hay internet: Usar timestamp corto
                    nextNumber = parseInt(Date.now().toString().slice(-6));
                }

                // 4. Construir ID Humano
                const branchCode = activeBranchId.slice(0, 4).toUpperCase();
                const ticketNumber = `TK-X-${branchCode}-${String(nextNumber).padStart(8, '0')}`;

                // 5. Guardar Venta
                saleResult = await salesRepository.createSale({
                    ...basePayload,
                    afip: { 
                        status: 'SKIPPED',
                        cbteLetra: 'X',
                        cbteTipo: 'NO FISCAL',
                        cbteNumero: nextNumber,
                        ptoVta: 0
                    },
                    number: ticketNumber
                });
                
                if (!paymentData.withAfip) {
                    toast.success(`Venta #${nextNumber} OK`);
                }
            }
            
            // 5. Limpieza
            clearCart();
            return saleResult;

        } catch (error) {
            console.error("Error en cobro:", error);
            if (loadingToast) toast.dismiss(loadingToast);
            toast.error(error.message || "Error al procesar la venta");
            return null;
        } finally {
            setIsProcessing(false);
        }
    };

    // =================================================================
    // 🎹 ATAJOS DE TECLADO (Barcode Scanner Listener)
    // =================================================================
    useEffect(() => {
        let buffer = '';
        let lastKeyTime = Date.now();
        const handleKeyDown = (e) => {
            if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
            const currentTime = Date.now();
            const char = e.key;
            if (currentTime - lastKeyTime > 100) buffer = '';
            lastKeyTime = currentTime;
            if (char === 'Enter') {
                if (buffer.length > 2) { searchProduct(buffer); buffer = ''; }
            } else if (char.length === 1) buffer += char;
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeTabId]);

    return { tabs, activeTab, activeTabId, totals, searchResults, isProcessing, addTab, removeTab, switchTab, addToCart, removeFromCart, updateItemQuantity, setClient, clearCart, searchProduct, setSearchResults, processSale };
};