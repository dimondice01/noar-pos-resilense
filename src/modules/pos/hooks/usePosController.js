import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { productRepository } from '../../inventory/repositories/productRepository';
import { salesRepository } from '../../sales/repositories/salesRepository';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { useShiftStore } from '../../cash/store/useShiftStore'; 
import { cashRepository } from '../../cash/repositories/cashRepository'; 
import { paymentService } from '../../payments/services/paymentService'; 
import { employeeLedgerRepository } from '../../settings/repositories/employeeLedgerRepository'; 
import { clientRepository } from '../../clients/repositories/clientRepository'; 
import { toast } from 'react-hot-toast'; 
import { getDB } from '../../../database/db'; 

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

// 🔥 HELPER: VALIDADOR DE DÍGITO VERIFICADOR EAN-13 ESTÁNDAR
const isValidEAN13 = (code) => {
    let sum = 0;
    for (let i = 0; i < 12; i++) {
        const digit = code.charCodeAt(i) - 48;
        sum += (i % 2 === 0) ? digit : digit * 3;
    }
    const check = (10 - (sum % 10)) % 10;
    return check === (code.charCodeAt(12) - 48);
};

// 🔥 HELPER: PARSER DE CÓDIGOS DE BALANZA (KRETZ / SYSTEL / ETC)
// `format`: 'LEGACY' (default, KRETZ/SYSTEL - comportamiento histórico sin cambios) | 'EAN13_GRAMS'
const parseScaleBarcode = (code, format = 'LEGACY') => {
    if (code.length !== 13) return { isScale: false };

    // 🆕 FORMATO EAN13 GRAMOS (opt-in por sucursal desde Configuración > POS > Balanza)
    // Prefijo 1 dígito '2' + PLU 5 dígitos + peso 6 dígitos (gramos) + dígito verificador EAN-13 real.
    // Solo corre si la sucursal activa tiene el flag prendido, así los clientes con formato
    // KRETZ/SYSTEL actual nunca pasan por acá.
    if (format === 'EAN13_GRAMS' && code[0] === '2' && isValidEAN13(code)) {
        const pluCode = parseInt(code.substring(1, 6), 10).toString();
        const weightGrams = parseInt(code.substring(6, 12), 10);
        if (weightGrams > 0) {
            return {
                isScale: true,
                type: 'weight',
                pluCode,
                embeddedWeight: weightGrams / 1000
            };
        }
    }

    // CASO SYSTEL / KRETZ - Formato Híbrido Universal
    const prefix = code.substring(0, 2);
    
    if (['20', '27', '28', '02'].includes(prefix)) {
        try {
            // Intentamos siempre primero como PLU 5 dígitos + PESO (5 dígitos)
            const rawPlu5 = code.substring(2, 7);   
            const rawValue5 = code.substring(7, 12); 
            
            const plu5 = parseInt(rawPlu5, 10).toString(); 
            const value5 = parseFloat(rawValue5); 
            
            if (value5 > 0 && value5 < 50000) {
                 return { 
                    isScale: true, 
                    type: 'weight',
                    pluCode: plu5, 
                    embeddedWeight: value5 / 1000 
                };
            }

            // Fallback: Formato de Precio (PLU 4 dígitos)
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
    const processingRef = useRef(false); // 🛡️ Sincronización real contra llamadas concurrentes
    const [searchResults, setSearchResults] = useState([]);

    // 🔥 ESTADO DE CONFIGURACIÓN DEL POS (Integrando Surcharges & Discounts)
    const [posConfig, setPosConfig] = useState({
        isWholesaleEnabled: false,
        wholesalePercentage: null,
        paymentSurcharges: {
            cash: 0, transfer: 0, mp: 0, card: 0, current_account: 0
        },
        paymentDiscounts: {
            cash: 0, transfer: 0, mp: 0, card: 0, current_account: 0
        },
        scaleBarcodeFormats: {}
    });

    // 🔥 Formato de balanza resuelto para la sucursal activa (default = comportamiento legado)
    const activeScaleFormat = posConfig.scaleBarcodeFormats?.[activeBranchId] === 'EAN13_GRAMS'
        ? 'EAN13_GRAMS'
        : 'LEGACY';

    // =================================================================
    // ⚙️ CARGA DE CONFIGURACIÓN DINÁMICA
    // =================================================================
    useEffect(() => {
        const loadPosConfig = async () => {
            try {
                const localDb = await getDB();
                const configDoc = await localDb.config.get('pos_settings');
                
                if (configDoc && configDoc.value) {
                    setPosConfig({
                        isWholesaleEnabled: configDoc.value.isWholesaleEnabled || false,
                        wholesalePercentage: configDoc.value.wholesalePercentage || null,
                        paymentSurcharges: configDoc.value.paymentSurcharges || {
                            cash: 0, transfer: 0, mp: 0, card: 0, current_account: 0
                        },
                        paymentDiscounts: configDoc.value.paymentDiscounts || {
                            cash: 0, transfer: 0, mp: 0, card: 0, current_account: 0
                        },
                        scaleBarcodeFormats: configDoc.value.scaleBarcodeFormats || {}
                    });
                }
            } catch (error) {
                console.error("Error cargando configuración local del POS:", error);
            }
        };

        loadPosConfig();
    }, []);

    // 🔄 REACTIVO: Recargar config cuando syncService detecta cambio desde cloud
    useEffect(() => {
        const reloadConfig = async () => {
            try {
                const localDb = await getDB();
                const configDoc = await localDb.config.get('pos_settings');
                if (configDoc?.value) {
                    setPosConfig({
                        isWholesaleEnabled: configDoc.value.isWholesaleEnabled || false,
                        wholesalePercentage: configDoc.value.wholesalePercentage || null,
                        paymentSurcharges: configDoc.value.paymentSurcharges || {
                            cash: 0, transfer: 0, mp: 0, card: 0, current_account: 0
                        },
                        paymentDiscounts: configDoc.value.paymentDiscounts || {
                            cash: 0, transfer: 0, mp: 0, card: 0, current_account: 0
                        },
                        scaleBarcodeFormats: configDoc.value.scaleBarcodeFormats || {}
                    });
                }
            } catch (e) { console.error(e); }
        };
        window.addEventListener('noar:config-synced', reloadConfig);
        return () => window.removeEventListener('noar:config-synced', reloadConfig);
    }, []);

    // =================================================================
    // 🧮 MOTOR DE PROMOCIONES COMPLEJAS (🔥 BLINDADO POR MÉTODO DE PAGO)
    // =================================================================
    
    const _calculatePromo = (product, quantity, currentPaymentMethod = 'cash') => {
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

        // 🔥 FIX DEFINITIVO: Validación estricta del método de pago
        if (Array.isArray(promo.allowedMethods) && promo.allowedMethods.length > 0) {
            
            // 1. Si es modo "split" (pago combinado), las ofertas exclusivas se anulan instantáneamente.
            if (currentPaymentMethod === 'split') {
                return result; 
            }

            // 2. Si el método actual NO ESTÁ en el array de permitidos, anulamos.
            if (!promo.allowedMethods.includes(currentPaymentMethod)) {
                return result;
            }
        }

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

    // =================================================================
    // 🛒 LÓGICA DEL CARRITO (Movida arriba para evitar ReferenceError)
    // =================================================================
    
    // 1. Eliminar un item específico
    // 🔥 tierPlu distingue variantes "anexadas" (mismo product.id, precio/PLU propio)
    const removeFromCart = useCallback((productId, tierPlu = null) => {
        updateActiveTab(tab => ({
            ...tab,
            items: tab.items.filter(i => !(i.id === productId && (i.tierPlu || null) === (tierPlu || null)))
        }));
    }, [activeTabId]);

    // 2. Limpiar todo el carrito (Auditoría Nexus)
    const clearCart = useCallback((targetTabId = activeTabId, reason = 'clear_cart', skipAudit = false) => {
        const tabToClear = tabs.find(t => t.id === targetTabId);
        
        // 🔥 AUDITORÍA NEXUS: Solo registramos si no es una venta finalizada (skipAudit)
        if (!skipAudit && tabToClear && tabToClear.items.length > 0) {
            const subtotal = tabToClear.items.reduce((acc, item) => acc + item.subtotal, 0);
            salesRepository.registerAbandonedCart({
                items: tabToClear.items,
                total: subtotal,
                subtotal: subtotal,
                client: tabToClear.client,
                tabName: tabToClear.name || 'Caja'
            }, reason);
        }

        setTabs(prev => prev.map(tab => {
            if (tab.id === targetTabId) return { ...NEW_TAB_TEMPLATE, id: targetTabId, name: tab.name };
            return tab;
        }));
    }, [tabs, activeTabId]);

    // 3. Remover una pestaña (Auditada)
    const removeTab = useCallback((tabId, skipAudit = false) => {
        const tabToDelete = tabs.find(t => t.id === tabId);
        
        // 🔥 AUDITORÍA NEXUS: Solo registramos si no es una venta finalizada (skipAudit)
        if (!skipAudit && tabToDelete && tabToDelete.items.length > 0) {
            const subtotal = tabToDelete.items.reduce((acc, item) => acc + item.subtotal, 0);
            salesRepository.registerAbandonedCart({
                items: tabToDelete.items,
                total: subtotal,
                subtotal: subtotal,
                client: tabToDelete.client,
                tabName: tabToDelete.name || 'Caja'
            }, 'tab_removed');
        }

        if (tabs.length === 1) return clearCart(tabId, 'clear_cart', skipAudit);
        
        const newTabs = tabs.filter(t => t.id !== tabId);
        setTabs(newTabs);
        if (activeTabId === tabId) setActiveTabId(newTabs[newTabs.length - 1].id);
    }, [tabs, activeTabId, clearCart]);

    const switchTab = (tabId) => setActiveTabId(tabId);

    // 🔥 NUEVO: Función para que el PaymentModal informe el método y recalcule precios vivos
    const setTabPaymentMethod = useCallback((newMethod) => {
        updateActiveTab(tab => {
            if (tab.paymentMethod === newMethod) return tab; // Evitamos render innecesario
            
            const newItems = tab.items.map(item => {
                // Ignoramos re-cálculo si es manual o si forzó un descuento mayorista general
                if (item.appliedWholesale || item.code === 'MANUAL') return item;
                
                const promoResult = _calculatePromo(item, item.quantity, newMethod);
                return {
                    ...item,
                    finalPrice: promoResult.finalPrice,
                    subtotal: promoResult.totalLine,
                    promoLabel: promoResult.promoLabel,
                    appliedPromo: promoResult.applied
                };
            });
            
            return { ...tab, paymentMethod: newMethod, items: newItems };
        });
    }, [activeTabId]);

    // =================================================================
    // 🕒 WATCHDOG DE PRECIOS
    // =================================================================
    useEffect(() => {
        const checkPrices = async () => {
            // 🛡️ No correr si carrito vacío o en medio de processSale/addToCart
            if (!activeTab.items.length || processingRef.current || addingRef.current) return;

            // 🔥 Loop secuencial en lugar de Promise.all: evita saturar Dexie en PCs lentos
            let updatedCount = 0;
            const updatedItems = [...activeTab.items];
            for (let idx = 0; idx < updatedItems.length; idx++) {
                const item = updatedItems[idx];
                if (item.code === 'MANUAL') continue;

                const freshProduct = await productRepository.findByCode(item.code);

                if (freshProduct && Math.abs(freshProduct.price - item.originalPrice) > 0.01 && !item.appliedWholesale) {
                    updatedCount++;
                    const newItem = { ...item, ...freshProduct, originalPrice: parseFloat(freshProduct.price) };
                    const promoResult = _calculatePromo(newItem, item.quantity, activeTab.paymentMethod);
                    updatedItems[idx] = {
                        ...newItem,
                        finalPrice: promoResult.finalPrice,
                        subtotal: promoResult.totalLine,
                        promoLabel: promoResult.promoLabel,
                        appliedPromo: promoResult.applied
                    };
                }
            }

            if (updatedCount > 0) {
                updateActiveTab(tab => ({ ...tab, items: updatedItems }));
                toast("⚠️ Precios actualizados por vigencia temporal", { icon: '🕒' });
            }
        };

        const interval = setInterval(checkPrices, 60000); 
        return () => clearInterval(interval);
    }, [activeTab.items, activeTabId, activeTab.paymentMethod]);

    // =================================================================
    // 🛒 LÓGICA DEL CARRITO
    // =================================================================

    const addingRef = useRef(false); // 🛡️ Mutex anti-duplicados por scan rápido

    const addToCart = useCallback((product, qty = 1) => {
        if (!product || addingRef.current) return;
        addingRef.current = true;
        updateActiveTab(tab => {
            // 🔥 tierPlu distingue variantes "anexadas" (mismo product.id, precio/PLU propio)
            const existingIndex = tab.items.findIndex(i => i.id === product.id && (i.tierPlu || null) === (product.tierPlu || null));
            let newItems = [...tab.items];
            
            if (existingIndex >= 0) {
                const currentItem = newItems[existingIndex];
                const newQty = currentItem.quantity + qty;
                
                // Si ya tiene descuento mayorista, se lo mantenemos
                if (currentItem.appliedWholesale) {
                     newItems[existingIndex] = {
                        ...currentItem,
                        quantity: newQty,
                        subtotal: currentItem.finalPrice * newQty
                    };
                } else {
                    // 🔥 Le pasamos el método de pago actual
                    const promoResult = _calculatePromo(product, newQty, tab.paymentMethod);
                    newItems[existingIndex] = {
                        ...currentItem,
                        quantity: newQty,
                        finalPrice: promoResult.finalPrice,
                        subtotal: promoResult.totalLine,
                        promoLabel: promoResult.promoLabel,
                        appliedPromo: promoResult.applied
                    };
                }
            } else {
                // 🔥 Le pasamos el método de pago actual
                const promoResult = _calculatePromo(product, qty, tab.paymentMethod);
                newItems.push({
                    ...product,
                    originalPrice: parseFloat(product.price), 
                    cost: parseFloat(product.cost) || 0,
                    quantity: qty,
                    finalPrice: promoResult.finalPrice,
                    subtotal: promoResult.totalLine,
                    promoLabel: promoResult.promoLabel,
                    appliedPromo: promoResult.applied,
                    appliedWholesale: false
                });
            }
            return { ...tab, items: newItems };
        });
        Promise.resolve().then(() => { addingRef.current = false; });
    }, [activeTabId]);

    const updateItemQuantity = (productId, newQty, tierPlu = null) => {
        if (newQty <= 0) return removeFromCart(productId, tierPlu);
        updateActiveTab(tab => {
            const newItems = tab.items.map(item => {
                if (item.id === productId && (item.tierPlu || null) === (tierPlu || null)) {
                    if (item.appliedWholesale) {
                         return { 
                            ...item, 
                            quantity: newQty, 
                            subtotal: item.finalPrice * newQty 
                        };
                    }
                    // 🔥 Le pasamos el método de pago actual
                    const promoResult = _calculatePromo(item, newQty, tab.paymentMethod);
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

    // 🔥 APLICAR DESCUENTO MAYORISTA (ATAJO F6) CON LECTURA DE CONFIGURACIÓN
    const applyWholesaleToLastItem = useCallback(() => {
        if (!activeTab || activeTab.items.length === 0) {
            toast.error("El carrito está vacío");
            return;
        }

        // 🛡️ BARRERA DE SEGURIDAD BASADA EN DB LOCAL
        if (!posConfig.isWholesaleEnabled || !posConfig.wholesalePercentage) {
            toast.error("⚠️ Función no habilitada. Configure el % desde el Panel Admin.");
            return;
        }

        const newItems = [...activeTab.items];
        const lastIndex = newItems.length - 1;
        const lastItem = newItems[lastIndex];

        if (lastItem.appliedWholesale) {
            toast.error("El último artículo ya tiene descuento");
            return;
        }

        if (lastItem.code === 'MANUAL') {
            toast.error("No aplicable a artículos manuales");
            return;
        }

        // Aplicamos la lógica matemática
        const discountRatio = posConfig.wholesalePercentage / 100;
        const originalPrice = parseFloat(lastItem.originalPrice || lastItem.price);
        const newPrice = originalPrice - (originalPrice * discountRatio);

        newItems[lastIndex] = {
            ...lastItem,
            finalPrice: newPrice,
            price: newPrice,
            subtotal: newPrice * lastItem.quantity,
            appliedWholesale: true,
            appliedPromo: false, 
            promoLabel: `MAYORISTA -${posConfig.wholesalePercentage}%`
        };

        updateActiveTab(tab => ({ ...tab, items: newItems }));
        toast.success(`Descuento mayorista aplicado a ${lastItem.name}`);
        
    }, [activeTab, posConfig]);

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

    const processBudget = async () => {
        if (processingRef.current) return null; // 🛡️ BLINDAJE SÍNCRONO
        
        if (activeTab.items.length === 0) {
            toast.error("Carrito vacío");
            return null;
        }

        setIsProcessing(true);
        processingRef.current = true;
        const toastId = toast.loading("Generando presupuesto...");

        try {
            const activeCompanyId = user?.companyId || user?.tenantId;
            if (!activeCompanyId) throw new Error("⚠️ Sesión corrupta: Falta Company ID.");

            // 1. Construcción del Payload
            const basePayload = {
                items: activeTab.items.map(i => ({
                    id: i.id, code: i.code, name: i.name, 
                    originalPrice: i.originalPrice, price: i.finalPrice, cost: i.cost, 
                    quantity: i.quantity, subtotal: i.subtotal,
                    promoLabel: i.promoLabel || '',
                    appliedPromo: i.appliedPromo || false,
                    appliedWholesale: i.appliedWholesale || false,
                    taxRate: i.taxRate || 21
                })),
                client: activeTab.client || { name: 'Consumidor Final', fiscalCondition: 'CONSUMIDOR_FINAL' }, 
                total: totals.total, subtotal: totals.subtotal, discount: totals.discountAmount,
                surcharge: 0,
                payments: [{ method: 'budget', amount: 0, total: 0 }],
                payment: { method: 'budget', amount: 0 }, 
                method: 'BUDGET',
                
                branchId: activeBranchId, 
                companyId: activeCompanyId,
                operatorId: user.uid,
                operatorName: user.name,
                
                createdAt: new Date().toISOString(),
                status: 'BUDGET', 
                type: 'BUDGET'    
            };

            const localNumber = `PTO-${Date.now().toString().slice(-6)}`;
            
            const budgetResult = await salesRepository.createSale({
                ...basePayload,
                afip: { status: 'SKIPPED', cbteLetra: 'X' },
                number: localNumber,
                ticketNumber: localNumber, 
                invoiceNumber: localNumber
            });

            toast.success(`Presupuesto generado`, { id: toastId });
            clearCart(activeTabId, 'clear_cart', true);
            return budgetResult;

        } catch (error) {
            console.error("Error generando presupuesto:", error);
            toast.error(error.message || "Error al procesar", { id: toastId });
            return null;
        } finally {
            setIsProcessing(false);
            processingRef.current = false;
        }
    };

    const processSale = async (paymentData) => {
        if (processingRef.current) return null; // 🛡️ BLINDAJE SÍNCRONO
        
        if (activeTab.items.length === 0) {
            toast.error("Carrito vacío");
            return null;
        }
        if (!activeBranchId) {
            toast.error("Sucursal no activa");
            return null;
        }

        setIsProcessing(true);
        processingRef.current = true;
        let loadingToast = null;

        try {
            const currentShift = await _verifyShift();

            const shiftBranch = String(currentShift.branchId).trim();
            const activeBranch = String(activeBranchId).trim();
            if (shiftBranch !== activeBranch && user?.role !== 'OWNER') {
                throw new Error("⚠️ EL TURNO ABIERTO PERTENECE A OTRA SUCURSAL");
            }

            const activeCompanyId = user?.companyId || user?.tenantId;
            if (!activeCompanyId) throw new Error("⚠️ Sesión corrupta: Falta Company ID.");

            // 1. Preparación Inteligente de Pagos y Deudas
            let finalPayments = [];
            let totalWithInterest = totals.total;
            let totalDebtAmount = 0;
            let totalPaidInCash = 0;

            if (Array.isArray(paymentData.payments) && paymentData.payments.length > 0) {
                finalPayments = paymentData.payments;
                totalWithInterest = finalPayments.reduce((acc, p) => acc + parseFloat(p.total || 0), 0);
            } else {
                totalWithInterest = parseFloat(paymentData.totalSale || totals.total);
                const amountInput = parseFloat(paymentData.amountPaid || 0); 
                const expectedTotal = parseFloat(paymentData.baseAmount || totals.total); 

                let difference = expectedTotal - amountInput;
                if (amountInput === Math.trunc(expectedTotal) && expectedTotal % 1 !== 0) {
                    difference = 0; 
                }

                // 🔥 FIX CRÍTICO: LÓGICA DE PAGOS CORREGIDA PARA CTA CTE
                if (paymentData.method === 'account' || paymentData.method === 'debt') {
                   // Si el método es 'account', asumimos que el usuario pudo haber entregado un adelanto.
                   // La entrega (amountInput) es CASH, lo restante (difference) es DEUDA.
                   if (amountInput > 0) {
                       finalPayments = [
                           {
                               method: 'cash',
                               amount: amountInput,
                               surcharge: 0,
                               total: amountInput,
                               employeeId: null
                           },
                           {
                               method: 'account',
                               amount: difference > 0 ? difference : 0,
                               surcharge: 0,
                               total: difference > 0 ? difference : 0,
                               employeeId: null
                           }
                       ];
                   } else {
                       // Si la entrega es 0, es 100% deuda
                       finalPayments = [{
                           method: 'account',
                           amount: expectedTotal,
                           surcharge: parseFloat(paymentData.surcharge || 0),
                           total: totalWithInterest,
                           employeeId: paymentData.employeeId || null 
                       }];
                   }
                } else if (amountInput === 0) {
                    // 0 entregado con cliente = 100% Cta. Corriente
                    finalPayments = [{
                        method: 'account',
                        amount: expectedTotal,
                        surcharge: parseFloat(paymentData.surcharge || 0),
                        total: totalWithInterest,
                        employeeId: null
                    }];
                } else if (difference > 0.05) {
                     // Si el método NO ES cuenta corriente, pero pagó de menos (y no usó el slider split)
                     // asumimos que dejó un saldo deudor (Cta Cte).
                     finalPayments = [
                        {
                            method: paymentData.method,
                            amount: amountInput,
                            surcharge: parseFloat(paymentData.surcharge || 0),
                            total: amountInput + parseFloat(paymentData.surcharge || 0),
                            employeeId: paymentData.employeeId || null 
                        },
                        {
                            method: 'account',
                            amount: difference,
                            surcharge: 0,
                            total: difference,
                            employeeId: null
                        }
                    ];
                } else {
                    // Pago total simple
                    finalPayments = [{
                        method: paymentData.method,
                        amount: expectedTotal,
                        surcharge: parseFloat(paymentData.surcharge || 0),
                        total: totalWithInterest,
                        employeeId: paymentData.employeeId || null 
                    }];
                }
            }

            totalDebtAmount = finalPayments
                .filter(p => p.method === 'account' || p.method === 'debt')
                .reduce((acc, p) => acc + parseFloat(p.total || 0), 0);
                
            totalPaidInCash = finalPayments
                .filter(p => p.method !== 'account' && p.method !== 'debt')
                .reduce((acc, p) => acc + parseFloat(p.total || 0), 0);

            if (totalDebtAmount > 0 && !activeTab.client?.id) {
                throw new Error("⚠️ Queda un saldo adeudado. Debe seleccionar un Cliente (F3) para enviarlo a Cuenta Corriente.");
            }

            // 2. Construcción del Payload
            const computedMethod = paymentData.method === 'SPLIT' ? 'SPLIT' : (finalPayments.length > 1 ? 'SPLIT' : (finalPayments[0]?.method || 'cash'));
            console.log('🔍 [PAY DEBUG]', {
                'paymentData.method': paymentData.method,
                'paymentData.payments': paymentData.payments,
                'finalPayments.length': finalPayments.length,
                'computedMethod': computedMethod,
                'finalPayments[0].method': finalPayments[0]?.method
            });

            const basePayload = {
                items: activeTab.items.map(i => ({
                    id: i.id, code: i.code, name: i.name, 
                    originalPrice: i.originalPrice, price: i.finalPrice, cost: i.cost,
                    quantity: i.quantity, subtotal: i.subtotal,
                    promoLabel: i.promoLabel || '', appliedPromo: i.appliedPromo || false,
                    appliedWholesale: i.appliedWholesale || false, taxRate: i.taxRate || 21
                })),
                client: activeTab.client || { name: 'Consumidor Final', fiscalCondition: 'CONSUMIDOR_FINAL' }, 
                total: totalWithInterest, 
                subtotal: totals.subtotal,
                discount: totals.discountAmount + parseFloat(paymentData.paymentDiscount || 0),
                surcharge: parseFloat(paymentData.surcharge || 0),
                
                payments: finalPayments,
                payment: finalPayments[0], 
                method: computedMethod,
                
                // 🔥 CRÍTICO PARA EL HISTORIAL Y DASHBOARD
                amountPaid: totalPaidInCash, 
                amountDebt: totalDebtAmount, 
                
                branchId: activeBranchId, 
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
                        ptoVta: afipResult.ptoVta || 1,
                        impNeto: afipResult.impNeto, 
                        impIVA: afipResult.impIVA    
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

            if (totalDebtAmount > 0 && saleResult) {
                await clientRepository.registerMovement(
                    activeTab.client.id,
                    'SALE_DEBT', 
                    totalDebtAmount,
                    `Compra Fiada (Ticket: ${saleResult.number})`,
                    saleResult.id 
                );
            }

            try {
                for (const p of finalPayments) {
                    if (p.method === 'employee_account' && p.employeeId) {
                        await employeeLedgerRepository.addTransaction({
                            companyId: activeCompanyId,
                            branchId: activeBranchId,
                            userId: p.employeeId,
                            type: 'POS_CONSUMPTION',
                            amount: p.total,
                            description: `Consumo Caja (Ticket: ${saleResult?.number || 'interno'})`,
                            refId: saleResult?.id || null,
                            operatorName: user.name
                        });
                    }
                }
            } catch (ledgerError) {
                console.error("No se pudo registrar el consumo del empleado:", ledgerError);
            }

            clearCart(activeTabId, 'sale_completed', true);
            // 🔥 Notificar a SalesPage para que refresque sin importar si está montado
            window.dispatchEvent(new CustomEvent('noar:sale-created'));
            return saleResult;

        } catch (error) {
            if (loadingToast) toast.dismiss(loadingToast);
            console.error("Error procesando venta:", error);
            toast.error(error.message || "Error al procesar venta");
            return null;
        } finally {
            setIsProcessing(false);
            processingRef.current = false;
        }
    };

    const processInternalSale = async (reason = "Consumo Interno") => {
        if (processingRef.current) return false;
        if (activeTab.items.length === 0) return toast.error("Carrito vacío");
        setIsProcessing(true);
        processingRef.current = true;
        
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
            clearCart(activeTabId, 'internal_completed', true);
            return true;
        } catch (error) {
            toast.error(error.message);
            return false;
        } finally { 
            setIsProcessing(false); 
            processingRef.current = false;
        }
    };

    // =================================================================
    // 🔎 BUSCADOR & KEYBOARD 
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
                    
                    const scaleInfo = parseScaleBarcode(buffer, activeScaleFormat);

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

                    const exactProduct = await productRepository.findByCode(buffer);
                    if (exactProduct) {
                        addToCart(exactProduct, 1);
                        setSearchResults([]);
                    } else {
                        searchProduct(buffer); 
                    }
                    buffer = ''; 
                }
            } else if (e.key.length === 1) buffer += e.key;
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeTabId, addToCart, activeScaleFormat]);

    // 🔥 EXPORTAMOS LAS FUNCIONES Y EL ESTADO (Incluye setTabPaymentMethod)
    return { 
        tabs, activeTab, activeTabId, totals, searchResults, isProcessing, posConfig,
        addTab, removeTab, switchTab, addToCart, removeFromCart, updateCartItemQuantity: updateItemQuantity, setClient, clearCart, searchProduct, 
        setSearchResults, processSale, processInternalSale, applyWholesaleToLastItem, processBudget,
        setTabPaymentMethod // 🔥 EXPONEMOS LA FUNCIÓN DE RECÁLCULO PARA EL MODAL
    };
};