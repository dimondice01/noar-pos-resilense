import { useState, useMemo, useCallback } from 'react';
import { purchaseRepository } from '../repositories/purchaseRepository'; // 🔥 APUNTANDO AL NUEVO SÚPER MOTOR
import { useAuthStore } from '../../auth/store/useAuthStore';
import toast from 'react-hot-toast';

export const usePurchaseController = () => {
    // 🔥 CAPTURA DE CONTEXTO (CRÍTICO PARA TRAZABILIDAD MULTI-SUCURSAL)
    const { user, activeBranchId, activeBranchName } = useAuthStore();
    
    const [supplier, setSupplier] = useState(null);
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [items, setItems] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    
    // 🌍 VAT ENGINE: Estado global de IVA
    const [globalIncludesTax, setGlobalIncludesTax] = useState(true);

    // =================================================================
    // 🛠️ NEXUS MATH HELPERS
    // =================================================================
    
    const _smartRound = (value, step = 10) => {
        if (!value) return 0;
        return Math.ceil(value / step) * step;
    };

    const _getRealUnitCost = (inputCost, includesTax, taxRate = 21) => {
        const cost = parseFloat(inputCost) || 0;
        if (includesTax) return cost; // Ya tiene IVA
        return cost * (1 + (taxRate / 100)); // Sumamos IVA al neto
    };

    // =================================================================
    // 🧮 MOTOR DE CÁLCULO BIDIRECCIONAL (PRECIOS PRO)
    // =================================================================
    
    const calculateBidirectional = (field, value, currentItem) => {
        const taxRate = parseFloat(currentItem.product.taxRate) || 21;
        let updates = { [field]: value };

        // 1. Obtenemos el Costo Real (con IVA) para los cálculos de margen
        const costInput = field === 'costInput' ? parseFloat(value) : currentItem.costInput;
        const incTax = field === 'includesTax' ? value : currentItem.includesTax;
        const realUnitCost = _getRealUnitCost(costInput, incTax, taxRate);

        if (realUnitCost <= 0) return updates;

        // Caso A: Cambia el % de Margen -> Calculamos el Precio Final (con redondeo)
        if (field === 'markup') {
            const markupVal = parseFloat(value) || 0;
            const rawPrice = realUnitCost * (1 + (markupVal / 100));
            updates.newPrice = _smartRound(rawPrice, 10);
        }
        
        // Caso B: Cambia el Precio Final -> Calculamos el % de Margen Real (sin redondeo)
        else if (field === 'newPrice') {
            const priceVal = parseFloat(value) || 0;
            const markupCalc = ((priceVal / realUnitCost) - 1) * 100;
            updates.markup = parseFloat(markupCalc.toFixed(2));
        }

        // Caso C: Cambia el Costo o el Switch de IVA -> Recalculamos Precio basado en Margen actual
        else if (field === 'costInput' || field === 'includesTax') {
            const currentMarkup = currentItem.markup || 0;
            const rawPrice = realUnitCost * (1 + (currentMarkup / 100));
            updates.newPrice = _smartRound(rawPrice, 10);
        }

        return updates;
    };

    // =================================================================
    // 📦 GESTIÓN DE LISTADO ENRIQUECIDO
    // =================================================================

    const totals = useMemo(() => {
        return items.reduce((acc, item) => {
            const realUnitCost = _getRealUnitCost(item.costInput, item.includesTax, item.product.taxRate);
            return acc + (realUnitCost * (parseFloat(item.quantity) || 0));
        }, 0);
    }, [items]);

    const toggleGlobalVAT = useCallback((val) => {
        setGlobalIncludesTax(val);
        setItems(prev => prev.map(item => ({
            ...item,
            ...calculateBidirectional('includesTax', val, item)
        })));
    }, []);

    const addItem = useCallback((product) => {
        setItems(prevItems => {
            const exists = prevItems.find(i => i.product.id === product.id);
            if (exists) {
                return prevItems.map(i => i.product.id === product.id 
                    ? { ...i, quantity: (parseFloat(i.quantity) || 0) + 1 } 
                    : i
                );
            }

            // Calculamos el margen inicial basado en el precio actual del maestro
            const initialRealCost = _getRealUnitCost(product.cost || 0, true, product.taxRate);
            const initialMarkup = initialRealCost > 0 
                ? (((product.price / initialRealCost) - 1) * 100).toFixed(2) 
                : 40;

            return [{
                product,
                category: product.category || 'GENERAL', 
                quantity: 1,
                costInput: product.cost || 0,
                includesTax: globalIncludesTax,
                markup: parseFloat(initialMarkup),
                newPrice: product.price || 0,
                expiryDate: '' // 🔥 Preparado para SPRINT 3 (Vencimientos por Lote)
            }, ...prevItems];
        });
    }, [globalIncludesTax]);

    const updateItem = useCallback((productId, field, value) => {
        setItems(prev => prev.map(item => {
            if (item.product.id !== productId) return item;
            
            // Si es un campo directo que no requiere recálculo bidireccional (como quantity o expiryDate)
            if (field === 'quantity' || field === 'expiryDate') {
                return { ...item, [field]: value };
            }
            
            const updates = calculateBidirectional(field, value, item);
            return { ...item, ...updates };
        }));
    }, []);

    const removeItem = useCallback((productId) => {
        setItems(prev => prev.filter(i => i.product.id !== productId));
    }, []);

    // =================================================================
    // 💾 GUARDADO FINAL (TRAZABILIDAD TOTAL)
    // =================================================================

    const submitPurchase = async (paymentData) => {
        // 🔥 VALIDACIÓN DE SEGURIDAD MULTI-SUCURSAL
        if (!activeBranchId || activeBranchId === 'ALL') {
            toast.error("⚠️ DEBE SELECCIONAR UNA SUCURSAL ESPECÍFICA PARA INGRESAR STOCK.");
            return false;
        }

        if (!supplier) { toast.error("Seleccione un proveedor"); return false; }
        if (items.length === 0) { toast.error("La lista está vacía"); return false; }

        setIsSaving(true);
        const toastId = toast.loading("Impactando Stock y Finanzas...");

        try {
            // 1. Preparar Cabecera con METADATA DE CAJA
            const purchaseHeader = {
                // Datos básicos
                supplierId: supplier.id,
                supplierName: supplier.name,
                invoiceNumber: invoiceNumber ? invoiceNumber.toUpperCase() : 'S/N',
                date: new Date().toISOString(),
                total: totals,
                
                // Datos Financieros (Del Modal)
                initialPayment: paymentData ? paymentData.amountPaid : 0, 
                paymentMethod: paymentData ? paymentData.method : 'debt', 
                amountDebt: paymentData ? paymentData.amountDebt : totals,
                
                // 🔥 TRAZABILIDAD (Clave para Ticket Z y Auditoría)
                branchId: activeBranchId, 
                branchName: activeBranchName || 'Sucursal Principal',
                companyId: user.companyId,
                userId: user.uid,
                userName: user.name || user.email // "Quién hizo la compra"
            };

            // 2. Limpiar Items para el Repositorio (SOPORTE PROGRAMACIÓN PRECIOS)
            const cleanItems = items.map(item => ({
                id: item.product.id,
                code: item.product.code,
                name: item.product.name,
                
                // Costos calculados
                cost: parseFloat(item.costInput),
                price: parseFloat(item.newPrice),
                qty: parseFloat(item.quantity),
                
                // Datos fiscales
                tax: item.product.taxRate || 0,
                isTaxIncluded: item.includesTax,
                
                // 🔥 LOGICA DE FECHA DE IMPACTO
                // Si paymentData.effectiveDate existe, significa que el cambio de precio es futuro.
                // Si es null, el cambio es inmediato.
                activationDate: paymentData?.effectiveDate || null,
                
                // 🔥 SPRINT 3: SOPORTE DE VENCIMIENTO POR LOTES
                expiryDate: item.expiryDate || null 
            }));

            // 3. LLAMADA AL NUEVO REPO PESADO (PurchaseRepository)
            // Este repo leerá `branchId` y `userId` para crear el movimiento de caja correcto.
            await purchaseRepository.registerPurchase(purchaseHeader, cleanItems);
            
            toast.success("¡Compra Procesada Exitosamente!", { id: toastId });
            
            // Limpieza del estado
            setItems([]);
            setInvoiceNumber('');
            setSupplier(null);

            // 🔥 Retorno TRUE para activar el modal de etiquetas en la UI
            return true; 

        } catch (error) {
            console.error(error);
            toast.error("Error al guardar: " + error.message, { id: toastId });
            return false;
        } finally {
            setIsSaving(false);
        }
    };

    return {
        supplier, setSupplier,
        invoiceNumber, setInvoiceNumber,
        items, totals, isSaving,
        globalIncludesTax, toggleGlobalVAT,
        addItem, updateItem, removeItem, submitPurchase
    };
};