import { useState, useEffect, useMemo, useCallback } from 'react';
import { productRepository } from '../../inventory/repositories/productRepository';
import { salesRepository } from '../../sales/repositories/salesRepository';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { useShiftStore } from '../../cash/store/useShiftStore'; 
import { cashRepository } from '../../cash/repositories/cashRepository'; 
import { paymentService } from '../../payments/services/paymentService'; 
import { toast } from 'react-hot-toast'; 

// =================================================================
// 🧠 NEXUS PRO MAX CORE - POS CONTROLLER (LOCAL-FIRST ENGINE)
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
    const { activeShift, setActiveShift } = useShiftStore(); 
    
    const [tabs, setTabs] = useState([{ ...NEW_TAB_TEMPLATE, id: Date.now() }]);
    const [activeTabId, setActiveTabId] = useState(tabs[0].id);
    const [isProcessing, setIsProcessing] = useState(false);
    const [searchResults, setSearchResults] = useState([]);

    // =================================================================
    // 🧮 MOTOR DE PROMOCIONES COMPLEJAS (ALBA MEGA ENGINE)
    // =================================================================
    
    const _calculatePromo = (product, quantity) => {
        if (!product) return { applied: false, totalLine: 0, finalPrice: 0 };
        const promo = product.promo;
        const price = parseFloat(product.price) || 0;
        
        let result = {
            applied: false,
            totalLine: price * quantity,
            promoLabel: '',
            finalPrice: price 
        };

        if (!promo || !promo.type || !promo.startDate || !promo.endDate) return result;
        
        const now = new Date();
        const start = new Date(promo.startDate + 'T00:00:00');
        const end = new Date(promo.endDate + 'T23:59:59');
        
        if (now < start || now > end) return result;

        const val = parseFloat(promo.value) || 0;

        switch (promo.type) {
            case 'PERCENTAGE':
                if (val > 0) {
                    result.applied = true;
                    result.finalPrice = price * (1 - val / 100);
                    result.totalLine = result.finalPrice * quantity;
                    result.promoLabel = `${val}% OFF`;
                }
                break;
            case 'BULK_THRESHOLD':
                if (quantity >= val) {
                    const disc = parseFloat(promo.discountValue) || 0;
                    result.applied = true;
                    result.finalPrice = price * (1 - disc / 100);
                    result.totalLine = result.finalPrice * quantity;
                    result.promoLabel = `Llevando ${val}+: ${disc}% OFF`;
                }
                break;
            case 'QUANTITY_LIMIT':
                const limit = val;
                if (quantity > 0) {
                    result.applied = true;
                    const discLimit = parseFloat(promo.discountValue) || 0;
                    const discountedPrice = price * (1 - discLimit / 100);
                    const discountedUnits = Math.min(quantity, limit);
                    const normalUnits = Math.max(0, quantity - limit);
                    result.totalLine = (discountedUnits * discountedPrice) + (normalUnits * price);
                    result.finalPrice = result.totalLine / quantity;
                    result.promoLabel = `Límite ${limit} un. con ${discLimit}%`;
                }
                break;
            case 'BUNDLE_DEAL':
                const n = val; 
                const m = parseFloat(promo.payValue) || 1; 
                if (n > 0 && quantity >= n) {
                    result.applied = true;
                    const bundleCount = Math.floor(quantity / n);
                    const remainingUnits = quantity % n;
                    result.totalLine = (bundleCount * m * price) + (remainingUnits * price);
                    result.finalPrice = result.totalLine / quantity;
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
    // 🕒 WATCHDOG DE PRECIOS (AUTO-UPDATE) 🔥
    // =================================================================
    useEffect(() => {
        const checkPrices = async () => {
            if (!activeTab.items.length) return;
            
            let updatedCount = 0;
            const updatedItems = await Promise.all(activeTab.items.map(async (item) => {
                const freshProduct = await productRepository.findByCode(item.code);
                
                if (freshProduct && Math.abs(freshProduct.price - item.originalPrice) > 0.01) {
                    updatedCount++;
                    const newItem = { ...item, ...freshProduct, originalPrice: parseFloat(freshProduct.price) };
                    const promoResult = _calculatePromo(newItem, item.quantity);
                    
                    return {
                        ...newItem,
                        finalPrice: promoResult.finalPrice,
                        subtotal: promoResult.totalLine,
                        promoLabel: promoResult.promoLabel,
                        appliedPromo: promoResult.applied
                    };
                }
                return item;
            }));

            if (updatedCount > 0) {
                updateActiveTab(tab => ({ ...tab, items: updatedItems }));
                toast("⚠️ Precios actualizados por vigencia temporal", { icon: '🕒' });
            }
        };

        const interval = setInterval(checkPrices, 60000); 
        return () => clearInterval(interval);
    }, [activeTab.items, activeTabId]);

    // =================================================================
    // 🛒 LÓGICA DEL CARRITO
    // =================================================================

    const addToCart = useCallback((product, qty = 1) => {
        if (!product) return;
        updateActiveTab(tab => {
            const existingIndex = tab.items.findIndex(i => i.id === product.id);
            let newItems = [...tab.items];
            if (existingIndex >= 0) {
                const currentItem = newItems[existingIndex];
                const newQty = currentItem.quantity + qty;
                const promoResult = _calculatePromo(product, newQty);
                newItems[existingIndex] = {
                    ...currentItem,
                    quantity: newQty,
                    finalPrice: promoResult.finalPrice,
                    subtotal: promoResult.totalLine,
                    promoLabel: promoResult.promoLabel,
                    appliedPromo: promoResult.applied
                };
            } else {
                const promoResult = _calculatePromo(product, qty);
                newItems.push({
                    ...product,
                    originalPrice: parseFloat(product.price), 
                    cost: parseFloat(product.cost) || 0,
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
    // 💳 PROCESO DE COBRO BLINDADO (RE-CHECK ENGINE) 🔥
    // =================================================================
    const processSale = async (paymentData) => {
        if (activeTab.items.length === 0) return toast.error("Carrito vacío");
        if (!activeBranchId) return toast.error("Sucursal no activa");

        setIsProcessing(true);
        let loadingToast = null;

        try {
            // 🔥 PASO CRÍTICO: RE-CHECK DE TURNO
            let currentShift = activeShift;
            
            if (!currentShift || currentShift.status !== 'OPEN') {
                console.log("🔍 [POS] Shift no en RAM o cerrado. Verificando base local...");
                currentShift = await cashRepository.getCurrentShift();
                
                if (currentShift && currentShift.status === 'OPEN') {
                    console.log("✅ [POS] Turno recuperado desde Dexie:", currentShift.id);
                    setActiveShift(currentShift); 
                } else {
                    throw new Error("⚠️ DEBE ABRIR CAJA ANTES DE VENDER");
                }
            }

            const shiftBranch = String(currentShift.branchId).trim();
            const activeBranch = String(activeBranchId).trim();

            if (shiftBranch !== activeBranch) {
                console.warn(`[POS] Sucursal desincronizada: Turno(${shiftBranch}) vs App(${activeBranch})`);
                if (user?.role !== 'OWNER') {
                    throw new Error("⚠️ EL TURNO ABIERTO PERTENECE A OTRA SUCURSAL");
                }
            }

            // 1. Preparación de Pagos
            let finalPayments = [];
            let totalWithInterest = totals.total;

            if (Array.isArray(paymentData.payments)) {
                finalPayments = paymentData.payments;
                totalWithInterest = finalPayments.reduce((acc, p) => acc + parseFloat(p.total || 0), 0);
            } else {
                finalPayments = [{
                    method: paymentData.method,
                    amount: parseFloat(paymentData.amountPaid),
                    surcharge: parseFloat(paymentData.surcharge || 0),
                    total: parseFloat(paymentData.totalSale || totals.total)
                }];
                totalWithInterest = parseFloat(paymentData.totalSale || totals.total);
            }

            // 2. Construcción del Payload
            const basePayload = {
                items: activeTab.items.map(i => ({
                    id: i.id, 
                    code: i.code, 
                    name: i.name, 
                    originalPrice: i.originalPrice,
                    price: i.finalPrice,
                    cost: i.cost,
                    quantity: i.quantity, 
                    subtotal: i.subtotal,
                    promoLabel: i.promoLabel || '',
                    appliedPromo: i.appliedPromo || false,
                    taxRate: i.taxRate || 21
                })),
                client: activeTab.client, 
                total: totalWithInterest, 
                subtotal: totals.subtotal,
                discount: totals.discountAmount,
                payments: finalPayments,
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
                loadingToast = toast.loading("📡 Autorizando con AFIP...");
                const afipResult = await paymentService.createInvoice({
                    ...basePayload,
                    invoiceLetter: activeTab.client?.fiscalCondition === 'RESPONSABLE_INSCRIPTO' ? 'A' : 'B'
                });

                const fiscalNumber = `FC-${afipResult.letra}-${String(afipResult.ptoVta).padStart(4,'0')}-${String(afipResult.numero).padStart(8,'0')}`;

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
                    number: fiscalNumber,
                    ticketNumber: fiscalNumber, 
                    invoiceNumber: fiscalNumber
                });
                toast.dismiss(loadingToast);
                toast.success(`Factura ${afipResult.letra} generada`);
            } else {
                const localNumber = `TK-${Date.now().toString().slice(-6)}`;
                
                saleResult = await salesRepository.createSale({
                    ...basePayload,
                    afip: { status: 'SKIPPED', cbteLetra: 'X' },
                    number: localNumber,
                    ticketNumber: localNumber, 
                    invoiceNumber: localNumber
                });
                toast.success(`Venta registrada`);
            }

            clearCart();
            return saleResult;

        } catch (error) {
            if (loadingToast) toast.dismiss(loadingToast);
            console.error("Error procesando venta:", error);
            toast.error(error.message || "Error al procesar venta");
            return null;
        } finally {
            setIsProcessing(false);
        }
    };

    // =================================================================
    // 🔎 BUSCADOR & KEYBOARD (CORREGIDO - SIN EFECTO SECUNDARIO)
    // =================================================================
    const searchProduct = async (query) => {
        if (!query) return setSearchResults([]);
        try {
            // 🔥 CORRECCIÓN: Buscamos exacto pero YA NO AGREGAMOS automáticamente
            // Solo devolvemos los resultados visuales.
            const exactMatch = await productRepository.findByCode(query);
            if (exactMatch) {
                // ANTES: addToCart(exactMatch, 1);  <-- ESTO CAUSABA EL DOBLE ADD
                // AHORA: Solo lo mostramos como resultado único
                setSearchResults([exactMatch]); 
                return true;
            }
            if (query.length > 2) {
                 const results = await productRepository.search(query); 
                 setSearchResults(results.slice(0, 10));
                 return false;
            }
        } catch (err) {
            console.error("Error buscando producto:", err);
            return false;
        }
    };

    // 🔥 GLOBAL KEYBOARD LISTENER (Cuando el input NO tiene foco)
    // Aquí sí debemos agregar explícitamente porque searchProduct ya no lo hace.
    useEffect(() => {
        let buffer = '';
        let lastKeyTime = Date.now();
        const handleKeyDown = async (e) => {
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
            
            const currentTime = Date.now();
            if (currentTime - lastKeyTime > 100) buffer = '';
            lastKeyTime = currentTime;
            
            if (e.key === 'Enter') {
                if (buffer.length > 2) { 
                    // INTENTO DE COMPRA DIRECTA (Scanner Global)
                    const exactProduct = await productRepository.findByCode(buffer);
                    if (exactProduct) {
                        addToCart(exactProduct, 1);
                        setSearchResults([]);
                    } else {
                        searchProduct(buffer); // Fallback visual
                    }
                    buffer = ''; 
                }
            } else if (e.key.length === 1) buffer += e.key;
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeTabId, addToCart]); // Agregué addToCart a dependencias

    return { 
        tabs, activeTab, activeTabId, totals, searchResults, isProcessing, 
        addTab, removeTab, switchTab, addToCart, removeFromCart, 
        updateItemQuantity, setClient, clearCart, searchProduct, 
        setSearchResults, processSale 
    };
};