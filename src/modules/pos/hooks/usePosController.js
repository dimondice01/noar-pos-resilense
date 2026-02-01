import { useState, useEffect, useMemo, useCallback } from 'react';
import { productRepository } from '../../inventory/repositories/productRepository';
import { salesRepository } from '../../sales/repositories/salesRepository';
import { cashRepository } from '../../cash/repositories/cashRepository';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { paymentService } from '../../payments/services/paymentService'; 
import { toast } from 'react-hot-toast'; 
import { doc, getDoc, updateDoc, setDoc, increment } from 'firebase/firestore'; 
import { db } from '../../../database/firebase'; 

// =================================================================
// 🧠 NEXUS PRO MAX CORE DUO - POS CONTROLLER
// =================================================================

const NEW_TAB_TEMPLATE = {
    id: 1,
    name: 'Venta 1',
    items: [],
    client: null,
    discount: 0,
    paymentMethod: 'cash'
};

export const usePosController = () => {
    const { user, activeBranchId } = useAuthStore(); 
    const [tabs, setTabs] = useState([{ ...NEW_TAB_TEMPLATE, id: Date.now() }]);
    const [activeTabId, setActiveTabId] = useState(tabs[0].id);
    const [isProcessing, setIsProcessing] = useState(false);
    const [searchResults, setSearchResults] = useState([]);

    // =================================================================
    // 🧮 MOTOR DE PROMOCIONES COMPLEJAS (ALBA MEGA ENGINE)
    // =================================================================
    
    const _calculatePromo = (product, quantity) => {
        // Obtenemos promo del objeto, asegurando que existe
        const promo = product.promo;
        const price = parseFloat(product.price);
        const now = new Date();
        
        let result = {
            applied: false,
            totalLine: price * quantity,
            promoLabel: '',
            finalPrice: price // PPP (Precio Promedio Ponderado por unidad)
        };

        // 1. Verificación de existencia y vigencia
        if (!promo || !promo.type || !promo.startDate || !promo.endDate) return result;
        
        // Ajuste de fechas para comparación segura (ignorando horas si es necesario)
        const start = new Date(promo.startDate + 'T00:00:00');
        const end = new Date(promo.endDate + 'T23:59:59');
        
        if (now < start || now > end) return result;

        const val = parseFloat(promo.value) || 0;

        switch (promo.type) {
            case 'PERCENTAGE':
                // REGLA 1: Descuento % directo
                if (val > 0) {
                    result.applied = true;
                    result.finalPrice = price * (1 - val / 100);
                    result.totalLine = result.finalPrice * quantity;
                    result.promoLabel = `${val}% OFF`;
                }
                break;

            case 'BULK_THRESHOLD':
                // REGLA 2: Llevando X o más, descuento % en todas las unidades
                if (quantity >= val) {
                    const disc = parseFloat(promo.discountValue) || 0;
                    result.applied = true;
                    result.finalPrice = price * (1 - disc / 100);
                    result.totalLine = result.finalPrice * quantity;
                    result.promoLabel = `Llevando ${val}+: ${disc}% OFF`;
                }
                break;

            case 'QUANTITY_LIMIT':
                // REGLA 3: Primeras X con descuento, resto normal
                const limit = val;
                if (quantity > 0) {
                    result.applied = true;
                    const discLimit = parseFloat(promo.discountValue) || 0;
                    const discountedPrice = price * (1 - discLimit / 100);
                    
                    const discountedUnits = Math.min(quantity, limit);
                    const normalUnits = Math.max(0, quantity - limit);
                    
                    result.totalLine = (discountedUnits * discountedPrice) + (normalUnits * price);
                    result.finalPrice = result.totalLine / quantity; // Cálculo de PPP
                    result.promoLabel = `Límite ${limit} un. con ${discLimit}%`;
                }
                break;

            case 'BUNDLE_DEAL':
                // REGLA 4: N x M (Ej: 3 productos paga 2)
                const n = val; // Lleva N (Ej: 3)
                const m = parseFloat(promo.payValue) || 1; // Paga M (Ej: 2)
                
                if (n > 0 && quantity >= n) {
                    result.applied = true;
                    const bundleCount = Math.floor(quantity / n);
                    const remainingUnits = quantity % n;
                    
                    // Precio total = (Combos * Lo que paga * Precio) + (Sueltos * Precio)
                    result.totalLine = (bundleCount * m * price) + (remainingUnits * price);
                    result.finalPrice = result.totalLine / quantity; // Cálculo de PPP
                    result.promoLabel = `PROMO ${n}x${m}`;
                }
                break;

            default:
                break;
        }

        return result;
    };

    // =================================================================
    // 🕹️ GESTIÓN DE PESTAÑAS (TABS)
    // =================================================================
    
    const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId) || tabs[0], [tabs, activeTabId]);

    const updateActiveTab = (updaterFn) => {
        setTabs(prevTabs => prevTabs.map(tab => {
            if (tab.id === activeTabId) return updaterFn(tab);
            return tab;
        }));
    };

    const addTab = useCallback(() => {
        const newId = Date.now();
        setTabs(prev => [...prev, { ...NEW_TAB_TEMPLATE, id: newId, name: `Venta ${prev.length + 1}` }]);
        setActiveTabId(newId);
    }, []);

    const removeTab = useCallback((tabId) => {
        if (tabs.length === 1) return clearCart(tabId);
        const newTabs = tabs.filter(t => t.id !== tabId);
        setTabs(newTabs);
        if (activeTabId === tabId) setActiveTabId(newTabs[newTabs.length - 1].id);
    }, [tabs, activeTabId]);

    const switchTab = (tabId) => setActiveTabId(tabId);

    // =================================================================
    // 🛒 LÓGICA DEL CARRITO (Cart Engine con Alba Promo)
    // =================================================================

    const addToCart = useCallback((product, qty = 1) => {
        updateActiveTab(tab => {
            const existingIndex = tab.items.findIndex(i => i.id === product.id);
            let newItems = [...tab.items];

            if (existingIndex >= 0) {
                // Producto existe: Sumar cantidad y recalcular promo
                const currentItem = newItems[existingIndex];
                const newQty = currentItem.quantity + qty;
                
                // 🔥 LLAMADA AL MOTOR DE PROMOS
                const promoResult = _calculatePromo(product, newQty);

                newItems[existingIndex] = {
                    ...currentItem,
                    quantity: newQty,
                    finalPrice: promoResult.finalPrice, // Guardamos el PPP
                    subtotal: promoResult.totalLine,
                    promoLabel: promoResult.promoLabel,
                    appliedPromo: promoResult.applied
                };
            } else {
                // Producto nuevo: Calcular promo inicial
                // 🔥 LLAMADA AL MOTOR DE PROMOS
                const promoResult = _calculatePromo(product, qty);
                
                newItems.push({
                    ...product,
                    // Snapshot de datos originales
                    originalPrice: parseFloat(product.price), 
                    cost: parseFloat(product.cost) || 0,
                    
                    // Datos de venta calculados
                    quantity: qty,
                    finalPrice: promoResult.finalPrice,
                    subtotal: promoResult.totalLine,
                    promoLabel: promoResult.promoLabel,
                    appliedPromo: promoResult.applied
                });
            }
            return { ...tab, items: newItems };
        });
    }, [activeTabId]);

    const updateItemQuantity = (productId, newQty) => {
        if (newQty <= 0) return removeFromCart(productId);

        updateActiveTab(tab => {
            const newItems = tab.items.map(item => {
                if (item.id === productId) {
                    // Recalcular promo con nueva cantidad absoluta
                    const promoResult = _calculatePromo(item, newQty);
                    
                    return { 
                        ...item, 
                        quantity: newQty, 
                        finalPrice: promoResult.finalPrice, 
                        subtotal: promoResult.totalLine,
                        promoLabel: promoResult.promoLabel,
                        appliedPromo: promoResult.applied
                    };
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

    const clearCart = (targetTabId = activeTabId) => {
        setTabs(prev => prev.map(tab => {
            if (tab.id === targetTabId) return { ...NEW_TAB_TEMPLATE, id: targetTabId, name: tab.name };
            return tab;
        }));
    };

    const setClient = (client) => updateActiveTab(tab => ({ ...tab, client }));

    // =================================================================
    // 🧮 CALCULADORA DE TOTALES
    // =================================================================
    const totals = useMemo(() => {
        const subtotal = activeTab.items.reduce((acc, item) => acc + item.subtotal, 0);
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
    // 💳 PROCESO DE COBRO (SPLIT PAYMENT ENGINE) 🔥
    // =================================================================
    const processSale = async (paymentData) => {
        if (activeTab.items.length === 0) return toast.error("Carrito vacío");
        if (!activeBranchId) return toast.error("Sucursal no activa");

        setIsProcessing(true);
        let loadingToast = null;

        try {
            const currentShift = await cashRepository.getCurrentShift();
            if (!currentShift || currentShift.branchId !== activeBranchId) {
                throw new Error("⚠️ TURNO NO PERTENECE A ESTA SUCURSAL");
            }

            // 1. Lógica de Pagos Combinados (Split Payments)
            let finalPayments = [];
            let totalWithInterest = totals.total;

            if (Array.isArray(paymentData.payments)) {
                // Nuevo flujo: Array de pagos
                finalPayments = paymentData.payments;
                // El total real es la suma de lo que pagó el cliente (base + interés de cada tarjeta)
                totalWithInterest = finalPayments.reduce((acc, p) => acc + parseFloat(p.total || 0), 0);
            } else {
                // Flujo Legacy (Un solo medio de pago)
                finalPayments = [{
                    method: paymentData.method,
                    amount: parseFloat(paymentData.amountPaid),
                    surcharge: parseFloat(paymentData.surcharge || 0),
                    total: parseFloat(paymentData.totalSale || totals.total)
                }];
                totalWithInterest = parseFloat(paymentData.totalSale || totals.total);
            }

            // 2. Payload listo para persistencia
            const basePayload = {
                items: activeTab.items.map(i => ({
                    id: i.id, 
                    code: i.code, 
                    name: i.name, 
                    originalPrice: i.originalPrice, // Precio lista
                    price: i.finalPrice,            // PPP (Ingreso real unitario)
                    cost: i.cost,                   // Costo histórico al momento de venta
                    quantity: i.quantity, 
                    subtotal: i.subtotal,
                    promoLabel: i.promoLabel || '',
                    appliedPromo: i.appliedPromo || false,
                    taxRate: i.taxRate || 21
                })),
                client: activeTab.client, 
                
                // 🔥 TOTALES FINALES
                total: totalWithInterest, 
                subtotal: totals.subtotal,
                discount: totals.discountAmount,
                
                // 🔥 ESTRUCTURA DE PAGOS AVANZADA
                payments: finalPayments,
                
                // Compatibilidad Legacy
                payment: finalPayments[0], 
                method: finalPayments.length > 1 ? 'SPLIT' : finalPayments[0].method,

                branchId: activeBranchId, 
                shiftId: currentShift.id,
                companyId: user.companyId,
                operatorId: user.uid,
                operatorName: user.name,
                createdAt: new Date().toISOString(),
                status: 'COMPLETED'
            };

            let saleResult = null;

            if (paymentData.withAfip) {
                // RUTA FISCAL
                loadingToast = toast.loading("📡 Autorizando con AFIP...");
                const afipResult = await paymentService.createInvoice({
                    ...basePayload,
                    invoiceLetter: activeTab.client?.fiscalCondition === 'RESPONSABLE_INSCRIPTO' ? 'A' : 'B'
                });

                saleResult = await salesRepository.createSale({
                    ...basePayload,
                    afip: {
                        status: 'APPROVED',
                        cae: afipResult.cae,
                        vtoCAE: afipResult.vencimiento,
                        cbteNumero: afipResult.numero,
                        cbteTipo: afipResult.tipo,
                        cbteLetra: afipResult.letra,
                        qr_data: afipResult.qr_data,
                        ptoVta: afipResult.ptoVta || 1
                    },
                    number: `FC-${afipResult.letra}-${String(afipResult.ptoVta).padStart(4,'0')}-${String(afipResult.numero).padStart(8,'0')}`
                });
                toast.dismiss(loadingToast);
                toast.success(`Factura ${afipResult.letra} generada`);
            } else {
                // RUTA TICKET X
                const counterRef = doc(db, 'companies', user.companyId, 'branches', activeBranchId, 'counters', 'ticket_x');
                const snap = await getDoc(counterRef);
                const nextNumber = (snap.exists() ? snap.data().current : 0) + 1;
                
                // Actualizar contador en background
                updateDoc(counterRef, { current: increment(1) }).catch(() => setDoc(counterRef, { current: nextNumber }));

                saleResult = await salesRepository.createSale({
                    ...basePayload,
                    afip: { status: 'SKIPPED', cbteLetra: 'X' },
                    number: `TK-X-${activeBranchId.slice(0,4).toUpperCase()}-${String(nextNumber).padStart(8, '0')}`
                });
                toast.success(`Venta #${nextNumber} registrada`);
            }

            clearCart();
            return saleResult;

        } catch (error) {
            if (loadingToast) toast.dismiss(loadingToast);
            toast.error(error.message);
            return null;
        } finally {
            setIsProcessing(false);
        }
    };

    // =================================================================
    // 🔎 BUSCADOR & KEYBOARD
    // =================================================================
    const searchProduct = async (query) => {
        if (!query) return setSearchResults([]);
        const exactMatch = await productRepository.findByCode(query);
        if (exactMatch) {
            addToCart(exactMatch, 1);
            setSearchResults([]);
            return true;
        }
        if (query.length > 2) {
             const results = await productRepository.search(query); 
             setSearchResults(results.slice(0, 10));
             return false;
        }
    };

    useEffect(() => {
        let buffer = '';
        let lastKeyTime = Date.now();
        const handleKeyDown = (e) => {
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
            const currentTime = Date.now();
            if (currentTime - lastKeyTime > 100) buffer = '';
            lastKeyTime = currentTime;
            if (e.key === 'Enter') {
                if (buffer.length > 2) { searchProduct(buffer); buffer = ''; }
            } else if (e.key.length === 1) buffer += e.key;
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeTabId]);

    return { 
        tabs, activeTab, activeTabId, totals, searchResults, isProcessing, 
        addTab, removeTab, switchTab, addToCart, removeFromCart, 
        updateItemQuantity, setClient, clearCart, searchProduct, 
        setSearchResults, processSale 
    };
};