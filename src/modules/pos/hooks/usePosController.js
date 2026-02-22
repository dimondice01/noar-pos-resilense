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

// 🔥 HELPER: PARSER DE CÓDIGOS DE BALANZA (KRETZ / SYSTEL / ETC)
const parseScaleBarcode = (code) => {
    if (code.length !== 13) return { isScale: false };

    // CASO SYSTEL / KRETZ - Formato Híbrido Universal
    // Tu ejemplo: 20 00755 00355 2
    // Dígitos:   01 23456 78901 2
    // Prefijo (2): 20, 27, 28, 02
    // PLU (5): 00755
    // Peso/Precio (5): 00355
    
    const prefix = code.substring(0, 2);
    
    if (['20', '27', '28', '02'].includes(prefix)) {
        try {
            // Intentamos siempre primero como PLU 5 dígitos + PESO (5 dígitos)
            const rawPlu5 = code.substring(2, 7);   // ej: '00755'
            const rawValue5 = code.substring(7, 12); // ej: '00355'
            
            const plu5 = parseInt(rawPlu5, 10).toString(); // '755'
            const value5 = parseFloat(rawValue5); // 355
            
            // Asumimos que si el valor es razonable para un peso (ej. menos de 50.000g / 50kg)
            // es un código de peso. 
            // Esto cubre perfecto tu caso: 00355 gramos -> 0.355 kg
            if (value5 > 0 && value5 < 50000) {
                 return { 
                    isScale: true, 
                    type: 'weight',
                    pluCode: plu5, 
                    embeddedWeight: value5 / 1000 // Convertimos gramos a KILOS (ej: 0.355)
                };
            }

            // Fallback: Si el valor era muy grande, tal vez era el viejo formato de Precio (PLU 4 dígitos)
            if (prefix === '20') {
                const rawPlu4 = code.substring(2, 6);
                const rawPrice6 = code.substring(6, 12);
                return { 
                    isScale: true, 
                    type: 'price',
                    pluCode: parseInt(rawPlu4, 10).toString(), 
                    embeddedTotal: parseFloat(rawPrice6) / 100 
                };
            }

        } catch (e) { return { isScale: false }; }
    }

    return { isScale: false };
};

export const usePosController = () => {
    const { user, activeBranchId } = useAuthStore(); 
    const { activeShift, setActiveShift } = useShiftStore(); 
    
    const [tabs, setTabs] = useState([{ ...NEW_TAB_TEMPLATE, id: Date.now() }]);
    const [activeTabId, setActiveTabId] = useState(tabs[0].id);
    const [isProcessing, setIsProcessing] = useState(false);
    const [searchResults, setSearchResults] = useState([]);

    // =================================================================
    // 🧮 MOTOR DE PROMOCIONES COMPLEJAS
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
    // 🕒 WATCHDOG DE PRECIOS
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
    // 💳 PROCESO DE COBRO BLINDADO 🔥
    // =================================================================
    
    const _verifyShift = async () => {
        let currentShift = activeShift;
        if (!currentShift || currentShift.status !== 'OPEN') {
            console.log("🔍 [POS] Shift no en RAM o cerrado. Verificando base local...");
            currentShift = await cashRepository.getCurrentShift();
            if (currentShift && currentShift.status === 'OPEN') {
                setActiveShift(currentShift); 
            } else {
                throw new Error("⚠️ DEBE ABRIR CAJA ANTES DE VENDER");
            }
        }
        return currentShift;
    };

    const processSale = async (paymentData) => {
        if (activeTab.items.length === 0) return toast.error("Carrito vacío");
        if (!activeBranchId) return toast.error("Sucursal no activa");

        setIsProcessing(true);
        let loadingToast = null;

        try {
            const currentShift = await _verifyShift();

            const shiftBranch = String(currentShift.branchId).trim();
            const activeBranch = String(activeBranchId).trim();
            if (shiftBranch !== activeBranch && user?.role !== 'OWNER') {
                throw new Error("⚠️ EL TURNO ABIERTO PERTENECE A OTRA SUCURSAL");
            }

            // 🛡️ BLINDAJE DE IDENTIFICADORES SAAS
            const activeCompanyId = user?.companyId || user?.tenantId;
            if (!activeCompanyId) throw new Error("⚠️ Sesión corrupta: Falta Company ID.");

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
                client: activeTab.client || { name: 'Consumidor Final', fiscalCondition: 'CONSUMIDOR_FINAL' }, 
                total: totalWithInterest, 
                subtotal: totals.subtotal,
                discount: totals.discountAmount,
                payments: finalPayments,
                payment: finalPayments[0], 
                method: finalPayments.length > 1 ? 'SPLIT' : finalPayments[0].method,
                
                // 🔥 INYECCIÓN OBLIGATORIA
                branchId: activeBranch, 
                shiftId: currentShift.id, 
                companyId: activeCompanyId,
                operatorId: user.uid,
                operatorName: user.name,
                
                createdAt: new Date().toISOString(),
                status: 'COMPLETED',
                type: 'SALE' 
            };

            let saleResult = null;

            if (paymentData.withAfip) {
                loadingToast = toast.loading("📡 Autorizando con AFIP...");
                const afipResult = await paymentService.createInvoice({
                    ...basePayload,
                    invoiceLetter: basePayload.client?.fiscalCondition === 'RESPONSABLE_INSCRIPTO' ? 'A' : 'B'
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

    const processInternalSale = async (reason = "Consumo Interno") => {
        if (activeTab.items.length === 0) return toast.error("Carrito vacío");
        setIsProcessing(true);
        
        try {
            const currentShift = await _verifyShift();
            const activeCompanyId = user?.companyId || user?.tenantId;

            const payload = {
                items: activeTab.items.map(i => ({
                    id: i.id, code: i.code, name: i.name, 
                    price: 0, originalPrice: i.price, cost: i.cost, 
                    quantity: i.quantity, subtotal: 0
                })),
                client: { name: 'CONSUMO INTERNO', fiscalCondition: 'CONSUMIDOR FINAL' },
                total: 0, subtotal: 0, discount: 100,
                payments: [{ method: 'internal', amount: 0, total: 0 }],
                payment: { method: 'internal', amount: 0 }, 
                method: 'INTERNAL',
                branchId: activeBranchId, 
                shiftId: currentShift.id, 
                companyId: activeCompanyId,
                operatorId: user.uid, operatorName: user.name,
                createdAt: new Date().toISOString(), status: 'COMPLETED', type: 'INTERNAL', notes: reason
            };

            const localNumber = `INT-${Date.now().toString().slice(-6)}`;
            
            await salesRepository.createSale({
                ...payload,
                afip: { status: 'SKIPPED', cbteLetra: 'I' }, 
                number: localNumber, ticketNumber: localNumber
            });

            toast.success("Consumo interno registrado");
            clearCart();
            return true;
        } catch (error) {
            toast.error(error.message);
            return false;
        } finally { setIsProcessing(false); }
    };

    // =================================================================
    // 🔎 BUSCADOR & KEYBOARD (CON SOPORTE DE BALANZAS MEJORADO)
    // =================================================================
    const searchProduct = async (query) => {
        if (!query) return setSearchResults([]);
        try {
            const exactMatch = await productRepository.findByCode(query);
            if (exactMatch) {
                setSearchResults([exactMatch]); 
                return true;
            }
            if (query.length > 2) {
                 const results = await productRepository.search(query); 
                 setSearchResults(results.slice(0, 10));
                 return false;
            }
        } catch (err) { return false; }
    };

    // 🔥 GLOBAL KEYBOARD LISTENER
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
                    
                    // 1. INTENTO: CÓDIGO DE BALANZA
                    const scaleInfo = parseScaleBarcode(buffer);
                    
                    if (scaleInfo.isScale) {
                        const product = await productRepository.findByCode(scaleInfo.pluCode);
                        if (product) {
                            let calculatedQty = 0;

                            if (scaleInfo.type === 'price') {
                                const unitPrice = parseFloat(product.price);
                                if (unitPrice > 0) calculatedQty = scaleInfo.embeddedTotal / unitPrice;
                            } else {
                                calculatedQty = scaleInfo.embeddedWeight;
                            }

                            if (calculatedQty > 0) {
                                // Redondeo seguro a 3 decimales
                                calculatedQty = Math.round(calculatedQty * 1000) / 1000;
                                addToCart(product, calculatedQty);
                                toast.success(`⚖️ Balanza: ${product.name} (${calculatedQty}kg)`);
                            } else {
                                toast.error("Error: Producto de balanza sin precio/peso válido");
                            }
                            buffer = '';
                            return;
                        }
                    }

                    // 2. INTENTO: CÓDIGO NORMAL
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
    }, [activeTabId, addToCart]); 

    return { 
        tabs, activeTab, activeTabId, totals, searchResults, isProcessing, 
        addTab, removeTab, switchTab, addToCart, removeFromCart, 
        updateItemQuantity, setClient, clearCart, searchProduct, 
        setSearchResults, processSale, processInternalSale 
    };
};