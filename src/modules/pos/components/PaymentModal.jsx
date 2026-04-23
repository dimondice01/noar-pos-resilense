import React, { useState, useEffect, useRef } from 'react';
import { 
    X, Banknote, QrCode, Loader2, CheckCircle2, 
    AlertCircle, Wallet, ArrowRight, CreditCard, Landmark, 
    ShieldCheck, Calculator, ChevronLeft, Layers, Info, Trash2, Plus, 
    Split, Tag, User, FileText, Send, FileArchive, Users
} from 'lucide-react';

// 🔥 IMPORTANTE: Aquí están las funciones que faltaban
import { 
    doc, 
    getDoc, 
    collection, 
    query, 
    where, 
    getDocs 
} from 'firebase/firestore';

import { db } from '../../../database/firebase';
import { Button } from '../../../core/ui/Button';
import { Switch } from '../../../core/ui/Switch';
import { cn } from '../../../core/utils/cn';
import { paymentService } from '../../payments/services/paymentService';
import { useAuthStore } from '../../auth/store/useAuthStore'; 
import { getDB } from '../../../database/db'; 
import toast from 'react-hot-toast';

const API_URL = import.meta.env.VITE_API_URL || "https://us-central1-salvadorpos1.cloudfunctions.net/api";

// 🛡️ Cache local con TTL para evitar Firestore calls en cada apertura del modal
const _getCached = (key, ttlMs = 10 * 60 * 1000) => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > ttlMs) return null;
        return data;
    } catch { return null; }
};
const _setCache = (key, data) => {
    try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
};

export const PaymentModal = ({ 
    isOpen, 
    onClose, 
    total, 
    subtotal, 
    discount, 
    client, 
    onConfirm, 
    disableAfip = false, 
    isProcessing = false,
    posConfig,
    processBudget,
    setTabPaymentMethod 
}) => {
    
    // ==========================================
    // 1. ESTADOS Y CONFIGURACIÓN
    // ==========================================
    const { user, activeBranchId, activeBranchName } = useAuthStore(); 
    const [withAfip, setWithAfip] = useState(false);

    // ==========================================
    
    // Modo Split (Combinado)
    const [isSplitMode, setIsSplitMode] = useState(false);
    const [payments, setPayments] = useState([]); 

    // Estado Operativo
    const [method, setMethod] = useState('cash'); 
    const [amountToPay, setAmountToPay] = useState(''); 
    const [reference, setReference] = useState(''); 
    
    // Hardware & Configuración
    const [assignedHardware, setAssignedHardware] = useState({ qrId: null, pointId: null });
    const [loadingConfig, setLoadingConfig] = useState(false);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [selectedBrand, setSelectedBrand] = useState(null);
    const [selectedRate, setSelectedRate] = useState(null);

    // Estado Pagos Digitales (Mercado Pago Point / QR)
    const [digitalState, setDigitalState] = useState('idle'); // idle, creating, waiting, approved, error
    const [paymentReference, setPaymentReference] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);

    // Cuenta de Personal (Ledger)
    const [employees, setEmployees] = useState([]);
    const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
    
    // Refs
    const pollingRef = useRef(null);
    const hasTriggeredRef = useRef(false); // 🛡️ BLINDAJE: Evita disparos duplicados del polling
    const cashInputRef = useRef(null);
    const withAfipRef = useRef(false);

    // Hooks

    // Cuenta de Transferencia Dinámica
    const [branchConfig, setBranchConfig] = useState(null);
    
    // 🔥 LECTURA DE CONFIGURACIÓN DE SUCURSAL (Local-First)
    useEffect(() => {
        if (!activeBranchId) return;
        const loadConfig = async () => {
            try {
                const dbLocal = await getDB();
                const configEntry = await dbLocal.config.get(`branch_config_${activeBranchId}`);
                if (configEntry && configEntry.value) {
                    setBranchConfig(configEntry.value);
                }
            } catch (e) { console.warn("Error cargando config de sucursal:", e); }
        };
        loadConfig();
    }, [activeBranchId]);

    const ACCOUNT_DATA = {
        alias: branchConfig?.transferAlias || "NO DEFINIDO",
        bank: branchConfig?.transferAccountName || "---"
    };

    // ==========================================
    // 2. CÁLCULOS MATEMÁTICOS (HÍBRIDOS & RECARGOS)
    // ==========================================
    const methodsData = {
        cash: { icon: Banknote, label: 'Efectivo', color: 'brand' },
        transfer: { icon: Landmark, label: 'Transf.', color: 'purple-600' },
        mercadopago: { icon: QrCode, label: 'QR MP', color: 'blue-500' },
        point: { icon: CreditCard, label: 'Point', color: 'blue-600' },
        manual_card: { icon: Calculator, label: 'Tarjeta', color: 'indigo-600' },
        employee_account: { icon: User, label: 'Personal', color: 'orange-500' },
        account: { icon: Users, label: 'Cta. Cte.', color: 'red-500' }, 
        budget: { icon: FileArchive, label: 'Presup.', color: 'sys-600' }
    };

    const currentMethodInfo = methodsData[method] || methodsData.cash;
    const CurrentIcon = currentMethodInfo.icon;
    
    const methodSurchargePercentage = posConfig?.paymentSurcharges?.[method] || 0;
    
    const currentInterestRate = selectedRate 
        ? selectedRate.interest 
        : methodSurchargePercentage;
    
    const effectiveTotal = total * (1 + (currentInterestRate / 100));
    const surchargeAmountUI = effectiveTotal - total;

    // -- Lógica Split --
    const totalPaidSoFar = payments.reduce((acc, p) => acc + p.amount, 0); 
    const remainingBase = Math.max(0, total - totalPaidSoFar);
    const isFullyPaid = remainingBase < 0.5; 

    // -- Variables de Visualización --
    const payValue = parseFloat(amountToPay || 0);
    
    // Cálculo de cambio/deuda
    let difference = (isSplitMode ? remainingBase : effectiveTotal) - payValue;
    
    // Validar si el cliente paga la parte entera exacta y el total tiene centavos, no registrar deuda
    if (!isSplitMode && payValue === Math.trunc(effectiveTotal)) {
        difference = 0;
    }
    
    const debtValue = (!isSplitMode && difference > 0.5) ? difference : 0;
    const changeValue = difference < -0.5 ? Math.abs(difference) : 0;

    // Lógica de Pago Parcial
    const isPartialPayment = debtValue > 0;

    // Validaciones Generales
    const isClientRegistered = client && client.id; 
    const isEmployeePaymentInvalid = method === 'employee_account' && !selectedEmployeeId;
    
    // FIX PRESUPUESTOS Y CUENTA CORRIENTE
    const isBudgetMode = method === 'budget';
    const isAccountMode = method === 'account';

    const hasError = !isBudgetMode && ((!isSplitMode && isPartialPayment && !isClientRegistered) || isEmployeePaymentInvalid || (isAccountMode && !isClientRegistered)); 
    
    const canConfirmSimple = isBudgetMode || (!hasError && amountToPay !== '' && !isProcessing && (payValue > 0 || isClientRegistered));

    const isRI = client?.fiscalCondition === 'RESPONSABLE_INSCRIPTO';
    
    useEffect(() => { withAfipRef.current = withAfip; }, [withAfip]);

    // ==========================================
    // 3. EFECTOS DE INICIALIZACIÓN
    // ==========================================
    useEffect(() => {
        if (isOpen) {
            if (isRI && !disableAfip) setWithAfip(true); 
            else setWithAfip(false);
            
            // Reset Completo
            setPayments([]);
            setIsSplitMode(false);
            setMethod('cash');
            setAmountToPay(Math.round(total).toString());
            setReference('');
            setDigitalState('idle');
            hasTriggeredRef.current = false; // Reset de blindaje
            setErrorMessage(null);
            setSelectedBrand(null);
            setSelectedRate(null);
            setSelectedEmployeeId('');
            
            // 🔥 Aseguramos que la promo base se respete al abrir
            if (setTabPaymentMethod) setTabPaymentMethod('cash');

            loadConfig();

            if (pollingRef.current) clearInterval(pollingRef.current);
            
            setTimeout(() => {
                if (cashInputRef.current && !isBudgetMode) {
                    cashInputRef.current.focus();
                    cashInputRef.current.select();
                }
            }, 100);
        } else {
            if (pollingRef.current) clearInterval(pollingRef.current);
            hasTriggeredRef.current = false;
            setDigitalState('idle');
        }
        // 🔥 FIX CRÍTICO: Se quitó 'total' y 'isRI' de las dependencias.
        // Esto evita el "Flicker Loop" que reseteaba el modal a 'cash' cuando el total cambiaba por un descuento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]); 

    // Permite que el input se adapte a los recálculos en vivo sin reiniciar todo el modal
    useEffect(() => {
        if (!isOpen) return; // Solo ejecutar si está abierto
        
        if (!isSplitMode && !isBudgetMode) {
            if (currentInterestRate > 0) {
                setAmountToPay(effectiveTotal.toFixed(2));
            } else {
                setAmountToPay(Math.round(total).toString());
            }
        } else if (isBudgetMode) {
             setAmountToPay(Math.round(total).toString());
        }
    }, [currentInterestRate, effectiveTotal, isSplitMode, total, isBudgetMode, isOpen]);

    useEffect(() => {
        if (isSplitMode && !selectedRate && !isFullyPaid && !isBudgetMode) {
            setAmountToPay(remainingBase.toFixed(2));
        }
    }, [remainingBase, isSplitMode, selectedRate, isFullyPaid, isBudgetMode, method]);

    // ==========================================
    // 4. DATA FETCHING
    // ==========================================
    const fetchHardwareAssignments = async () => {
        if (!user?.uid || !activeBranchId) return;
        const cacheKey = `pos_hw_${user.uid}`;
        const cached = _getCached(cacheKey);
        if (cached) setAssignedHardware(cached);
        if (!navigator.onLine) return;
        try {
            const branchRef = `companies/${user.companyId}/branches/${activeBranchId}/integrations`;
            const assignDoc = await getDoc(doc(db, branchRef, 'assignments'));
            if (assignDoc.exists()) {
                const hw = assignDoc.data()[user.uid] || { qrId: null, pointId: null };
                setAssignedHardware(hw);
                _setCache(cacheKey, hw);
            }
        } catch (e) { console.error(e); }
    };

    const fetchFinancialPlans = async () => {
        if (!user?.companyId) return;
        const cacheKey = `pos_plans_${user.companyId}`;
        const cached = _getCached(cacheKey);
        if (cached) setPaymentMethods(cached);
        if (!navigator.onLine) return;
        try {
            const configRef = doc(db, `companies/${user.companyId}/config/financials`);
            const snap = await getDoc(configRef);
            const methods = (snap.exists() && snap.data().methods) ? snap.data().methods : [];
            setPaymentMethods(methods);
            _setCache(cacheKey, methods);
        } catch (error) { setPaymentMethods([]); }
    };

    const fetchEmployees = async () => {
        if (!user?.companyId || !activeBranchId) return;
        const cacheKey = `pos_employees_${activeBranchId}`;
        const cached = _getCached(cacheKey);
        if (cached) setEmployees(cached);
        if (!navigator.onLine) return;
        try {
            const q = query(collection(db, 'users'), where('companyId', '==', user.companyId));
            const snap = await getDocs(q);
            const branchEmployees = snap.docs
                .map(doc => ({ uid: doc.id, ...doc.data() }))
                .filter(u => String(u.branchId) === String(activeBranchId));
            setEmployees(branchEmployees);
            _setCache(cacheKey, branchEmployees);
        } catch (error) { console.error("Error cargando empleados:", error); }
    };

    const loadConfig = async () => {
        setLoadingConfig(true);
        await Promise.allSettled([
            fetchHardwareAssignments(),
            fetchFinancialPlans(),
            fetchEmployees()
        ]);
        setLoadingConfig(false);
    };

    const handleAfipChange = (checked) => {
        if (isRI && !checked && !disableAfip) {
            alert("⚠️ Atención: A un Responsable Inscripto se le debe emitir Factura A obligatoriamente.");
            return;
        }
        setWithAfip(checked);
    };

    // ==========================================
    // 5. LÓGICA DE NEGOCIO (ACCIONES)
    // ==========================================

    const handleAddSplitPayment = () => {
        const amount = parseFloat(amountToPay);
        if (isNaN(amount) || amount <= 0) return;
        if (amount > remainingBase + 1) return alert("El monto excede el saldo restante.");

        const splitInterestRate = selectedRate ? selectedRate.interest : (posConfig?.paymentSurcharges?.[method] || 0);
        const interestAmount = amount * (splitInterestRate / 100);
        
        let paymentMethodName = method;
        if (['manual_card', 'point', 'clover'].includes(method)) paymentMethodName = 'card';
        if (method === 'employee_account') paymentMethodName = 'employee_account';
        if (method === 'account') paymentMethodName = 'account';

        const paymentObj = {
            id: Date.now(),
            method: paymentMethodName,
            amount: amount, 
            surcharge: interestAmount, 
            total: amount + interestAmount, 
            reference: method === 'employee_account' ? `A cuenta: ${employees.find(e => e.uid === selectedEmployeeId)?.name}` : (reference || (selectedRate ? `${selectedBrand?.brand} ${selectedRate.qty} ctes` : '')),
            brand: selectedBrand?.brand || null,
            employeeId: method === 'employee_account' ? (selectedEmployeeId || null) : null
        };

        setPayments([...payments, paymentObj]);
        
        setMethod('cash');
        setReference('');
        setSelectedBrand(null);
        setSelectedRate(null);
        setSelectedEmployeeId('');
        setDigitalState('idle');
    };

    const handleRemovePayment = (id) => {
        setPayments(payments.filter(p => p.id !== id));
    };

    const handleFinalizeSplit = () => {
        if (!isFullyPaid) return;
        const totalSaleReal = payments.reduce((acc, p) => acc + p.total, 0);
        const totalSurcharge = payments.reduce((acc, p) => acc + (p.surcharge || 0), 0);

        onConfirm({
            payments: payments, 
            method: 'SPLIT',
            totalSale: totalSaleReal,
            subtotal: subtotal,
            discount: discount,
            surcharge: totalSurcharge, 
            amountPaid: totalPaidSoFar,
            change: changeValue,
            withAfip: withAfip,
            branchId: activeBranchId
        });
    };

    const handleManualConfirm = async () => {
        if (isBudgetMode) {
            const success = await processBudget();
            if (success) onClose();
            return;
        }

        let finalReference = method === 'transfer' ? reference : null;
        if (selectedRate && selectedBrand) {
            finalReference = `${selectedBrand.brand} ${selectedRate.qty} ctes (${selectedRate.interest}%)`;
        } else if (method === 'manual_card') {
            finalReference = "Tarjeta (Manual sin plan)";
        } else if (method === 'employee_account') {
            finalReference = `A cuenta: ${employees.find(e => e.uid === selectedEmployeeId)?.name}`;
        } else if (method === 'account') {
            finalReference = `Fiado en Cta. Corriente`; 
        }

        let finalMethod = method;
        if (['manual_card', 'point', 'clover'].includes(method)) finalMethod = 'card';
        if (method === 'mp') finalMethod = 'mercadopago';

        onConfirm({
            method: finalMethod,
            reference: finalReference,
            employeeId: method === 'employee_account' ? selectedEmployeeId : null,
            branchId: activeBranchId, 
            totalSale: effectiveTotal,
            amountPaid: method === 'account' ? 0 : (payValue - changeValue), 
            amountDebt: method === 'account' ? payValue : debtValue, 
            baseAmount: total,
            surcharge: surchargeAmountUI, 
            discount: discount || 0,
            withAfip: method === 'employee_account' || method === 'account' ? false : withAfip 
        });
    };

    const triggerPointTransaction = async () => {
        if (!navigator.onLine) {
            setDigitalState('error');
            setErrorMessage('Sin conexión. Los pagos con terminal requieren internet.');
            return;
        }
        setDigitalState('creating');
        setErrorMessage(null);
        try {
            const targetDeviceId = assignedHardware.pointId;
            if (!targetDeviceId) throw new Error("Falta configurar la Terminal Point en esta caja.");

            const res = await paymentService.initTransaction('point', parseFloat(amountToPay), targetDeviceId, {
                companyId: user.companyId,
                branchId: activeBranchId
            });
            
            setPaymentReference(res.reference); 
            setDigitalState('waiting'); 
            
        } catch (error) {
            setDigitalState('error');
            setErrorMessage(error.message || "Error de conexión con Mercado Pago.");
        }
    };

    const triggerQrTransaction = async () => {
        if (!navigator.onLine) {
            setDigitalState('error');
            setErrorMessage('Sin conexión. Los pagos con QR requieren internet.');
            return;
        }
        setDigitalState('creating');
        setErrorMessage(null);
        try {
            const targetDeviceId = assignedHardware.qrId;
            if (!targetDeviceId) throw new Error("Falta configurar la Caja QR.");

            const res = await paymentService.initTransaction('mercadopago', parseFloat(amountToPay), targetDeviceId, {
                companyId: user.companyId,
                branchId: activeBranchId
            });
            
            setPaymentReference(res.reference);
            setDigitalState('waiting');
            
        } catch (error) {
            setDigitalState('error');
            setErrorMessage(error.message || "Error de conexión con QR.");
        }
    };

    const handleMainAction = () => {
        if (isProcessing) return;

        if (isSplitMode) {
            if (isFullyPaid) {
                // Todos los pagos están cubiertos → finalizar la venta
                handleFinalizeSplit();
            } else if (method === 'point' && digitalState === 'idle') {
                // 🔥 EN SPLIT: Point también necesita trigger de terminal PRIMERO
                triggerPointTransaction();
            } else if (method === 'mercadopago' && digitalState === 'idle') {
                // 🔥 EN SPLIT: QR también necesita trigger de terminal PRIMERO  
                triggerQrTransaction();
            } else if (['idle', 'approved'].includes(digitalState) || !['point', 'mercadopago'].includes(method)) {
                // Efectivo, transferencia, tarjeta manual, etc. → agregar directo
                handleAddSplitPayment();
            }
        } else {
            if (method === 'point' && digitalState === 'idle') {
                triggerPointTransaction();
            } else if (method === 'mercadopago' && digitalState === 'idle') {
                triggerQrTransaction();
            } else {
                handleManualConfirm();
            }
        }
    };

    useEffect(() => {
        if (digitalState === 'waiting' && paymentReference && (method === 'mercadopago' || method === 'point')) {
            const checkPayment = async () => {
                try {
                    const res = await paymentService.checkStatus(paymentReference, method);
                    
                    if (res.status === 'approved') {
                        if (hasTriggeredRef.current) return; // 🛡️ Ya se está procesando
                        hasTriggeredRef.current = true;
                        
                        setDigitalState('approved');
                        if (pollingRef.current) clearInterval(pollingRef.current);
                        
                        // 🚀 PROCESAMIENTO INSTANTÁNEO (SIN DELAYS ARTIFICIALES)
                        if (isSplitMode) handleAddSplitPayment();
                        else handleManualConfirm();

                    } else if (['rejected', 'canceled'].includes(res.status)) {
                        setDigitalState('error');
                        setErrorMessage("El pago fue rechazado o cancelado en la terminal.");
                        clearInterval(pollingRef.current);
                    }
                } catch (e) { 
                    console.error("Polling error:", e); 
                }
            };

            pollingRef.current = setInterval(checkPayment, 3000);
            return () => clearInterval(pollingRef.current);
        }
    }, [digitalState, paymentReference, method, isSplitMode]);

    const handleCloseAttempt = () => {
        if (isProcessing) return;
        if (digitalState === 'waiting' || digitalState === 'creating') {
            if (window.confirm("⚠️ ¿CANCELAR PAGO EN PROCESO?\nEsto interrumpirá la conexión con la terminal.")) {
                if (pollingRef.current) clearInterval(pollingRef.current);
                setDigitalState('idle'); 
                setMethod('cash'); 
                if (setTabPaymentMethod) setTabPaymentMethod('cash'); 
            }
        } else {
            if (setTabPaymentMethod) setTabPaymentMethod('cash'); 
            onClose();
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if ((canConfirmSimple || isSplitMode) && digitalState === 'idle') {
                handleMainAction();
            }
        }
        if (e.key === 'Escape' && !isProcessing) handleCloseAttempt(); 
    };

    if (!isOpen) return null;

    const renderActionButton = () => {
        if (isProcessing) {
            return (
                <Button disabled className="w-full py-6 text-xl font-black shadow-none bg-sys-200 text-sys-500 cursor-not-allowed">
                    <div className="flex items-center justify-center gap-3 animate-pulse">
                        <Loader2 className="animate-spin" size={24} /><span>Procesando...</span>
                    </div>
                </Button>
            );
        }

        if (isSplitMode && !isFullyPaid) {
            return (
                <Button onClick={handleMainAction} className="w-full py-6 text-xl font-black uppercase shadow-xl bg-sys-800 hover:bg-sys-900 text-white rounded-2xl flex items-center justify-center gap-2">
                    <Plus size={24}/> AGREGAR PAGO
                </Button>
            );
        }

        if (isBudgetMode) {
            return (
                <Button onClick={handleMainAction} className="w-full py-6 text-xl font-black uppercase shadow-xl bg-sys-800 hover:bg-black text-white rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-[0.98]">
                    <FileArchive size={24}/> GENERAR PRESUPUESTO
                </Button>
            );
        }

        if (isAccountMode) {
            return (
                <Button onClick={handleMainAction} className="w-full py-6 text-xl font-black uppercase shadow-xl bg-sys-800 hover:bg-black text-white rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-[0.98]">
                    <Users size={24}/> ENVIAR A CTA. CORRIENTE
                </Button>
            );
        }

        if (method === 'point' && digitalState === 'idle') {
            return (
                <Button onClick={handleMainAction} className="w-full py-6 text-xl font-black uppercase shadow-xl bg-blue-600 hover:bg-blue-700 text-white rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-[0.98]">
                    <Send size={24}/> ENVIAR A TERMINAL POINT
                </Button>
            );
        }

        if (method === 'mercadopago' && digitalState === 'idle') {
            return (
                <Button onClick={handleMainAction} className="w-full py-6 text-xl font-black uppercase shadow-xl bg-blue-500 hover:bg-blue-600 text-white rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-[0.98]">
                    <QrCode size={24}/> GENERAR CÓDIGO QR
                </Button>
            );
        }

        if (digitalState === 'waiting' || digitalState === 'creating') {
            return (
                <Button disabled className="w-full py-6 text-xl font-black uppercase shadow-none bg-blue-100 text-blue-500 cursor-wait">
                    <div className="flex items-center justify-center gap-2">
                        <Loader2 className="animate-spin" size={24} /> ESPERANDO APROBACIÓN...
                    </div>
                </Button>
            );
        }

        if (digitalState === 'approved') {
            return (
                <Button disabled className="w-full py-6 text-xl font-black uppercase shadow-none bg-emerald-100 text-emerald-600 cursor-wait">
                    <div className="flex items-center justify-center gap-2">
                        <CheckCircle2 className="animate-bounce" size={24} /> PAGO APROBADO - REGISTRANDO...
                    </div>
                </Button>
            );
        }

        if (digitalState === 'error') {
            return (
                <Button onClick={() => setDigitalState('idle')} className="w-full py-6 text-xl font-black uppercase shadow-none bg-red-100 hover:bg-red-200 text-red-600">
                    REINTENTAR / CAMBIAR MEDIO
                </Button>
            );
        }

        const disabledState = !canConfirmSimple && !isSplitMode;
        return (
            <Button 
                onClick={handleMainAction} 
                disabled={disabledState}
                className={cn("w-full py-6 text-xl font-black uppercase shadow-xl transition-all duration-300 relative overflow-hidden", 
                    disabledState ? "bg-sys-200 text-sys-400 cursor-not-allowed shadow-none" : "bg-brand hover:bg-brand-dark hover:scale-[1.01] shadow-brand/30 active:scale-[0.98]"
                )}
            >
                <div className="flex items-center justify-center gap-2">
                    <span>{isSplitMode ? "FINALIZAR VENTA" : (isPartialPayment ? "Confirmar Pago Parcial" : "Confirmar Cobro")}</span>
                    <ArrowRight size={24} />
                </div>
            </Button>
        );
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-sys-900/60 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col md:flex-row min-h-[600px] md:h-[650px]">
                
                {/* 🟢 IZQUIERDA: RESUMEN FINANCIERO */}
                <div className="w-full md:w-1/3 bg-sys-50 p-6 flex flex-col justify-between border-r border-sys-200 relative">
                    
                    <div className="space-y-4">
                        <div className="flex items-center justify-between bg-white p-2 rounded-lg border border-sys-200 shadow-sm mb-4">
                            <span className="text-[10px] font-bold uppercase text-sys-500 flex items-center gap-2">
                                <Split size={14} className={isSplitMode ? "text-brand" : "text-sys-300"}/> 
                                Pago Combinado
                            </span>
                            <Switch checked={isSplitMode} onCheckedChange={(val) => {
                                setIsSplitMode(val);
                                // 🔥 LÓGICA DE ACTUALIZACIÓN DE PROMOS PARA SPLIT
                                if (val && isBudgetMode) {
                                    setMethod('cash');
                                    if (setTabPaymentMethod) setTabPaymentMethod('cash');
                                } else if (val) {
                                    // 🔥 ANTI-TRAMPAS: Modo Split borra promos exclusivas
                                    if (setTabPaymentMethod) setTabPaymentMethod('split'); 
                                } else {
                                    // 🔥 Restaura la promo del método actual si sale de Split
                                    let mappedMethod = method;
                                    if (['manual_card', 'point', 'clover'].includes(method)) mappedMethod = 'card';
                                    if (setTabPaymentMethod) setTabPaymentMethod(mappedMethod); 
                                }
                            }} size="sm" disabled={isBudgetMode} />
                        </div>

                        <div className={cn("bg-white p-4 rounded-xl border shadow-sm relative overflow-hidden transition-all duration-300", isBudgetMode ? "border-sys-400 bg-sys-100" : isAccountMode ? "border-red-400 bg-red-50" : "border-sys-200")}>
                            {currentInterestRate > 0 && !isBudgetMode && !isAccountMode && (
                                <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-bl-lg">
                                    CON RECARGO
                                </div>
                            )}
                            {isBudgetMode && (
                                <div className="absolute top-0 right-0 bg-sys-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-bl-lg">
                                    MODO PRESUPUESTO
                                </div>
                            )}
                            {isAccountMode && (
                                <div className="absolute top-0 right-0 bg-red-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-bl-lg">
                                    DEUDA CTA. CTE.
                                </div>
                            )}
                            
                            {discount > 0 && (
                                <div className="mb-3 bg-green-50 border border-green-200 p-3 rounded-xl flex items-start gap-3 animate-in slide-in-from-top-2">
                                    <div className="bg-green-100 p-2 rounded-lg text-green-700 mt-0.5">
                                        <Tag size={18} />
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-[10px] font-black text-green-800 uppercase tracking-wide leading-tight">PROMOCIÓN SUCURSAL</p>
                                        <div className="flex justify-between items-baseline mt-1">
                                            <p className="text-xs font-medium text-green-700">Ahorro total:</p>
                                            <p className="text-sm font-black text-green-700">-${discount.toLocaleString('es-AR')}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-between items-end mb-1">
                                <p className="text-xs text-sys-500 uppercase font-bold">{disableAfip || isBudgetMode || isAccountMode ? "Monto Final" : "Total Final"}</p>
                                {discount > 0 && <span className="text-[10px] text-sys-400 line-through decoration-red-400">${subtotal.toLocaleString('es-AR')}</span>}
                            </div>
                            
                            <p className={cn("text-3xl font-black tracking-tight", isAccountMode ? "text-red-700" : "text-sys-900")}>
                                $ {isSplitMode ? remainingBase.toLocaleString('es-AR', {minimumFractionDigits: 0, maximumFractionDigits: 2}) : effectiveTotal.toLocaleString('es-AR', {minimumFractionDigits: 0, maximumFractionDigits: 2})}
                            </p>
                            
                            {isSplitMode && <p className="text-[10px] text-sys-400 font-bold mt-1">RESTANTE A PAGAR</p>}

                            {!isSplitMode && currentInterestRate > 0 && !isBudgetMode && !isAccountMode && (
                                <div className="mt-2 pt-2 border-t border-dashed border-sys-200 flex justify-between text-xs animate-in slide-in-from-left-2">
                                    <span className="text-sys-500">Base: ${total.toLocaleString('es-AR')}</span>
                                    <span className="text-indigo-600 font-bold">
                                        + ${surchargeAmountUI.toLocaleString('es-AR', {maximumFractionDigits: 2})} ({currentInterestRate}%)
                                    </span>
                                </div>
                            )}
                        </div>

                        {isSplitMode && (
                            <div className="flex-1 overflow-y-auto max-h-[180px] custom-scrollbar space-y-2 border-t border-b border-sys-200 py-2">
                                {payments.length === 0 && <div className="text-center text-xs text-sys-400 italic py-2">Agregue pagos para cubrir el total.</div>}
                                {payments.map(p => (
                                    <div key={p.id} className="bg-white p-2 rounded border flex justify-between items-center text-xs shadow-sm animate-in slide-in-from-left-2">
                                        <div>
                                            <span className="font-bold uppercase block text-sys-700">{p.method === 'manual_card' ? 'Tarjeta' : p.method === 'employee_account' ? 'Cta. Empleado' : p.method === 'account' ? 'Fiado (Cta Cte)' : p.method}</span>
                                            {p.surcharge > 0 && <span className="text-[9px] text-indigo-600">+ Rec. ${p.surcharge.toLocaleString()}</span>}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono font-bold">$ {p.amount.toLocaleString()}</span>
                                            <button onClick={() => handleRemovePayment(p.id)} className="text-red-400 hover:text-red-600"><Trash2 size={14}/></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {isSplitMode && (
                            <div className="bg-white p-3 rounded-xl border border-sys-200">
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-sys-500 font-bold">PAGADO:</span>
                                    <span className="font-mono font-bold text-green-600">$ {totalPaidSoFar.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between text-lg font-black border-t border-sys-100 pt-1">
                                    <span>RESTANTE:</span>
                                    <span className={remainingBase > 0 ? "text-orange-600" : "text-sys-400"}>$ {Math.max(0, remainingBase).toLocaleString()}</span>
                                </div>
                            </div>
                        )}

                        <div className={cn("p-4 rounded-xl border-2 transition-all duration-300", 
                            isBudgetMode ? "bg-sys-100 border-sys-300 opacity-50 pointer-events-none" :
                            isPartialPayment && !isSplitMode ? "bg-orange-50 border-orange-200" : 
                            changeValue > 0 && !isSplitMode ? "bg-green-50 border-green-200" : "bg-white border-sys-200",
                            ((currentInterestRate > 0 && !isSplitMode) || method === 'employee_account' || (digitalState === 'waiting' && !isSplitMode)) && !isBudgetMode && "opacity-90 grayscale-[0.5]"
                        )}>
                            <p className={cn("text-[10px] uppercase font-bold mb-1 flex justify-between items-center", isPartialPayment && !isSplitMode ? "text-orange-700" : "text-sys-500")}>
                                <span className="flex items-center gap-1.5">
                                    {isSplitMode && <CurrentIcon size={12} className={cn(`text-${currentMethodInfo.color}`)}/>}
                                    {isSplitMode ? `Monto para ${currentMethodInfo.label.toUpperCase()}` : "Monto que entrega / fía"}
                                </span>
                                {((currentInterestRate > 0 && !isSplitMode) || method === 'employee_account' || (method === 'point' && !isSplitMode)) && !isBudgetMode && !isAccountMode && <span className="text-[9px] bg-sys-200 px-1 rounded text-sys-600 uppercase font-black">Input Auto</span>}
                            </p>
                            <div className="flex items-center relative">
                                <span className="text-lg font-bold text-sys-400 mr-1">$</span>
                                <input 
                                    ref={cashInputRef}
                                    type="number" 
                                    className={cn(
                                        "w-full bg-transparent text-2xl font-black outline-none text-sys-900 placeholder-sys-300 transition-colors",
                                        ((currentInterestRate > 0 && !isSplitMode) || method === 'employee_account' || (method === 'point' && !isSplitMode) || isBudgetMode) && "cursor-not-allowed text-sys-600"
                                    )}
                                    value={amountToPay} 
                                    onChange={e => (currentInterestRate === 0 || isSplitMode) && !isBudgetMode && setAmountToPay(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    readOnly={((currentInterestRate > 0 && !isSplitMode) || method === 'employee_account' || isProcessing || (method === 'point' && !isSplitMode) || isBudgetMode)}
                                    disabled={isProcessing || isBudgetMode}
                                    placeholder={isSplitMode ? remainingBase.toFixed(0) : Math.round(total).toString()}
                                />
                            </div>
                            {changeValue > 0 && !isBudgetMode && !isAccountMode && !isSplitMode && <p className="text-right text-xs font-bold text-green-600 mt-1">Vuelto: $ {changeValue.toLocaleString('es-AR')}</p>}
                            {debtValue > 0 && !isBudgetMode && !isAccountMode && !isSplitMode && <p className="text-right text-xs font-bold text-orange-600 mt-1">Falta: $ {debtValue.toLocaleString('es-AR')}</p>}
                        </div>
                        
                        <div className="mt-2 text-center">
                            <p className="text-[9px] text-sys-300 font-mono">REF: {reference || paymentReference || '---'}</p>
                        </div>
                    </div>
                </div>

                {/* 🔵 DERECHA: SELECCIÓN DE MÉTODO */}
                <div className="flex-1 p-8 flex flex-col bg-white">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h3 className="font-bold text-xl text-sys-900 uppercase tracking-tight">Medio de Pago</h3>
                            <p className="text-xs text-sys-500 uppercase font-bold opacity-60">Sucursal: {activeBranchName || user?.activeBranchName || "General"}</p>
                        </div>
                        <button onClick={handleCloseAttempt} disabled={isProcessing} className="p-2 hover:bg-sys-100 rounded-full text-sys-400 transition-colors disabled:opacity-30">
                            <X size={24} />
                        </button>
                    </div>

                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-6">
                        {Object.entries(methodsData).map(([id, opt]) => (
                            <button 
                                key={id}
                                onClick={() => {
                                    if (id === 'account' && !isClientRegistered) {
                                        toast.error("Debe asignar un Cliente (F3) antes de enviarlo a Cta Cte.");
                                        return;
                                    }

                                    setMethod(id);
                                    if (id === 'budget') setIsSplitMode(false); 
                                    if (id !== 'manual_card') { setSelectedBrand(null); setSelectedRate(null); }
                                    if (id !== 'employee_account') setSelectedEmployeeId('');
                                    setDigitalState('idle'); 
                                    
                                    // 🔥 MAGIA AQUÍ: Recalcula promos al vuelo y mapea las tarjetas al estándar 'card'
                                    if (setTabPaymentMethod && !isSplitMode) {
                                        let mappedMethod = id;
                                        if (['manual_card', 'point', 'clover'].includes(id)) mappedMethod = 'card';
                                        setTabPaymentMethod(mappedMethod);
                                    }
                                }} 
                                disabled={
                                    digitalState === 'creating' || 
                                    digitalState === 'waiting' || 
                                    digitalState === 'approved' || 
                                    isProcessing || 
                                    (isSplitMode && (isFullyPaid || id === 'budget')) ||
                                    (id === 'account' && !isClientRegistered) 
                                } 
                                className={cn(
                                    "flex flex-col items-center justify-center p-2 rounded-xl border-2 transition-all duration-200 h-24 relative overflow-hidden active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed group", 
                                    method === id ? `bg-sys-50 border-${opt.color} shadow-md` : "bg-white border-sys-100 hover:border-sys-300 text-sys-500"
                                )}
                            >
                                <opt.icon size={26} className={cn("mb-1 transition-colors", method === id ? `text-${opt.color}` : "text-sys-400")} />
                                <span className={cn("font-semibold text-[10px] leading-tight text-center", method === id ? "text-sys-900" : "")}>{opt.label}</span>
                                {method === id && <div className={`absolute top-2 right-2 w-2 h-2 rounded-full bg-${opt.color}`}></div>}
                                
                                {posConfig?.paymentSurcharges?.[id] > 0 && !['manual_card', 'employee_account', 'budget', 'account'].includes(id) && (
                                    <div className="absolute bottom-0 left-0 right-0 bg-orange-100 text-orange-700 text-[8px] font-black text-center py-0.5">
                                        +{posConfig.paymentSurcharges[id]}%
                                    </div>
                                )}
                            </button>
                        ))}
                    </div>

                    {/* ÁREA DINÁMICA DE CONTENIDO */}
                    <div className="flex-1 bg-sys-50 rounded-2xl border-2 border-dashed border-sys-200 p-4 flex flex-col items-center justify-center overflow-hidden relative">
                        
                        {isBudgetMode && (
                            <div className="text-center animate-in fade-in zoom-in-95">
                                <div className="w-16 h-16 bg-sys-200 rounded-full flex items-center justify-center mx-auto mb-3 text-sys-600">
                                    <FileArchive size={32}/>
                                </div>
                                <h4 className="font-black text-xl text-sys-900 uppercase">Modo Presupuesto</h4>
                                <p className="text-sm text-sys-500 mt-2 max-w-[280px] mx-auto">
                                    Se generará un ticket informativo con los precios actuales. <strong>No descuenta stock ni ingresa dinero a la caja.</strong>
                                </p>
                            </div>
                        )}

                        {isAccountMode && !isSplitMode && (
                            <div className="text-center animate-in fade-in zoom-in-95">
                                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3 text-red-600">
                                    <Users size={32}/>
                                </div>
                                <h4 className="font-black text-xl text-sys-900 uppercase tracking-tight">Cuenta Corriente</h4>
                                <p className="text-sm font-bold text-red-600 mt-1 uppercase">{client?.name}</p>
                                <p className="text-xs text-sys-500 mt-2 max-w-[300px] mx-auto">
                                    Si utiliza el <strong>Pago Combinado (Split)</strong> podrá mezclar efectivo con deuda. De lo contrario, todo el monto ingresado será deuda nueva.
                                </p>
                            </div>
                        )}

                        {method === 'employee_account' && (
                            <div className="w-full max-w-sm space-y-4 animate-in fade-in zoom-in-95">
                                <div className="text-center mb-4">
                                    <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-2">
                                        <FileText className="text-orange-500" size={24}/>
                                    </div>
                                    <h4 className="font-black text-sys-900">Consumo Interno</h4>
                                    <p className="text-xs text-sys-500">Se registrará como deuda en su Libro Mayor</p>
                                </div>
                                
                                <div>
                                    <label className="text-[11px] font-black text-sys-500 uppercase tracking-wider mb-2 block">¿Quién realiza el consumo?</label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400" size={18} />
                                        <select 
                                            className="w-full bg-white border-2 border-orange-200 rounded-xl pl-10 pr-4 py-3 text-sm font-bold text-orange-800 outline-none focus:border-orange-500 appearance-none shadow-sm"
                                            value={selectedEmployeeId}
                                            onChange={(e) => setSelectedEmployeeId(e.target.value)}
                                        >
                                            <option value="">-- Seleccione al Empleado --</option>
                                            {employees.map(emp => (
                                                <option key={emp.uid} value={emp.uid}>{emp.name || emp.email}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        )}

                        {method === 'manual_card' && (
                            <div className="w-full h-full flex flex-col">
                                {loadingConfig ? (
                                    <div className="flex flex-col items-center justify-center h-full">
                                        <Loader2 size={32} className="animate-spin text-indigo-500 mb-2"/>
                                        <p className="text-xs text-indigo-500 font-bold">Cargando tasas...</p>
                                    </div>
                                ) : paymentMethods.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full text-sys-400">
                                        <Layers size={40} className="mb-2 opacity-30"/>
                                        <p className="font-bold text-sm">Sin tarjetas configuradas</p>
                                    </div>
                                ) : !selectedBrand ? (
                                    <div className="flex-1 w-full overflow-y-auto custom-scrollbar p-1">
                                        <div className="flex flex-col gap-2">
                                            {paymentMethods.map((m) => (
                                                <button key={m.brand} onClick={() => setSelectedBrand(m)} className="p-3 rounded-xl border border-sys-200 bg-white hover:border-indigo-400 hover:shadow-md transition-all flex items-center justify-between group w-full">
                                                    <div className="flex items-center gap-3">
                                                        <CreditCard className="text-sys-400 group-hover:text-indigo-500" size={20} />
                                                        <span className="font-black text-sm uppercase text-sys-700 group-hover:text-indigo-600">{m.brand}</span>
                                                    </div>
                                                    <span className="text-[10px] bg-sys-100 px-2 py-1 rounded text-sys-500 group-hover:bg-indigo-50 group-hover:text-indigo-600 font-bold">
                                                        {m.rates?.length || 0} Planes
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col w-full h-full">
                                        <div className="flex items-center gap-2 mb-3 w-full flex-none z-10">
                                            <Button variant="ghost" size="sm" onClick={() => { setSelectedBrand(null); setSelectedRate(null); }} className="text-sys-500 hover:bg-sys-200 h-8 px-2">
                                                <ChevronLeft size={16} />
                                            </Button>
                                            <span className="font-bold text-indigo-900 bg-indigo-100 px-3 py-1.5 rounded-lg text-xs flex-1 text-center truncate">{selectedBrand.brand}</span>
                                        </div>
                                        
                                        <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
                                            <div className="flex flex-col gap-2 pb-2">
                                                {selectedBrand.rates.map((rate) => (
                                                    <button key={rate.qty} onClick={() => setSelectedRate(selectedRate?.qty === rate.qty ? null : rate)} className={cn("w-full p-3 rounded-xl border text-left transition-all", selectedRate?.qty === rate.qty ? "bg-indigo-600 text-white shadow-md ring-2 ring-indigo-300" : "bg-white border-sys-200 text-sys-700 hover:border-indigo-300")}>
                                                        <div className="flex justify-between items-start w-full">
                                                            <span className={cn("text-lg font-black leading-none", selectedRate?.qty === rate.qty ? "text-white" : "text-sys-900")}>{rate.qty}</span>
                                                            <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded", selectedRate?.qty === rate.qty ? "bg-white/20 text-white" : "bg-sys-100 text-sys-600")}>{rate.interest === 0 ? "S/INT" : `+${rate.interest}%`}</span>
                                                        </div>
                                                        <span className={cn("text-xs font-bold mt-2 block", selectedRate?.qty === rate.qty ? "text-indigo-100" : "text-sys-500")}>${((parseFloat(amountToPay || 0) * (1 + rate.interest/100)) / rate.qty).toLocaleString('es-AR', {maximumFractionDigits:0})} <span className="text-[9px] font-normal">/mes</span></span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {method === 'cash' && (
                            isSplitMode ? (
                                <div className="flex flex-col items-center">
                                    <label className="text-xs font-bold text-sys-400 uppercase mb-2">Monto a agregar</label>
                                    <div className="flex items-center text-5xl font-black text-sys-900">
                                        <span className="text-sys-300 mr-2 text-3xl">$</span>
                                        <input 
                                            ref={cashInputRef}
                                            type="number" 
                                            className="bg-transparent w-56 text-center outline-none" 
                                            value={amountToPay} 
                                            onChange={e => setAmountToPay(e.target.value)}
                                            onKeyDown={handleKeyDown}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="text-sys-300 flex flex-col items-center opacity-40">
                                    <Wallet size={48} />
                                    <p className="text-[10px] font-black uppercase mt-2 tracking-widest">Cobro en Efectivo</p>
                                </div>
                            )
                        )}
                        
                        {method === 'transfer' && (
                            <div className="w-full max-w-xs space-y-4 animate-in fade-in text-center">
                                <div className="bg-purple-50 border-2 border-purple-100 p-6 rounded-3xl shadow-sm relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 p-2 opacity-5 text-purple-900"><Landmark size={64}/></div>
                                    <p className="text-[10px] font-black text-purple-600 uppercase tracking-widest mb-1 relative z-10">Alias para Transferir</p>
                                    <p className="font-black text-2xl text-purple-900 tracking-tighter leading-tight relative z-10 break-all">{ACCOUNT_DATA.alias}</p>
                                    <div className="h-px bg-purple-200 my-4 w-1/3 mx-auto relative z-10"></div>
                                    <p className="text-[11px] font-bold text-sys-500 uppercase tracking-wide relative z-10 truncate" title={ACCOUNT_DATA.bank}>{ACCOUNT_DATA.bank}</p>
                                </div>
                                <div className="relative group">
                                    <FileText className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400 group-focus-within:text-purple-500 transition-colors" size={18} />
                                    <input 
                                        type="text" 
                                        className="w-full pl-10 pr-4 py-3.5 bg-white border-2 border-sys-200 rounded-2xl font-bold text-sys-800 outline-none focus:border-purple-500 transition-all placeholder:text-sys-300 shadow-sm" 
                                        placeholder="Comprobante (Opcional)" 
                                        value={reference} 
                                        onChange={e => setReference(e.target.value)} 
                                    />
                                </div>
                                <p className="text-[9px] text-sys-400 font-bold uppercase tracking-widest">Verifica la acreditación antes de entregar</p>
                            </div>
                        )}
                        
                        {(method === 'mercadopago' || method === 'point') && (
                            <div className="flex flex-col items-center gap-3 animate-in fade-in text-center">
                                {digitalState === 'idle' && (
                                    <>
                                        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 mb-2">
                                            {method === 'point' ? <CreditCard size={32}/> : <QrCode size={32}/>}
                                        </div>
                                        <p className="font-bold text-sys-800">
                                            {method === 'point' ? "Pago con Tarjeta / Smart POS" : "Cobro QR Dinámico"}
                                        </p>
                                        <p className="text-xs text-sys-500 max-w-[250px]">
                                            Presione el botón enviar para despertar la terminal vinculada a esta sucursal.
                                        </p>
                                    </>
                                )}

                                {digitalState === 'error' && (
                                    <div className="flex flex-col items-center text-center animate-in zoom-in">
                                        <AlertCircle size={48} className="text-red-500 mb-2"/>
                                        <p className="font-bold text-red-600 mb-1">Error de Operación</p>
                                        <p className="text-xs text-sys-500 max-w-[250px]">{errorMessage}</p>
                                    </div>
                                )}

                                {(digitalState === 'creating' || digitalState === 'waiting' || digitalState === 'approved') && (
                                    <>
                                        {digitalState === 'waiting' ? <div className="w-16 h-16 rounded-full border-4 border-blue-500 border-t-transparent animate-spin"/> : digitalState === 'approved' ? <div className="w-16 h-16 rounded-full bg-green-500 text-white flex items-center justify-center animate-in zoom-in"><CheckCircle2 size={32}/></div> : <Loader2 className="animate-spin text-sys-300" />}
                                        
                                        {digitalState === 'waiting' && method === 'mercadopago' && <p className="text-xs font-bold text-sys-500 mt-2">Escanee el QR en el visor de Mercado Pago</p>}
                                        {digitalState === 'waiting' && method === 'point' && <p className="text-xs font-bold text-sys-500 mt-2">Pase la tarjeta por la terminal Point...</p>}
                                        {digitalState === 'approved' && <p className="text-sm font-black text-green-600 mt-2 uppercase">¡PAGO APROBADO!</p>}
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="mt-6 pt-4 border-t border-sys-100">
                        {!disableAfip && method !== 'employee_account' && !isSplitMode && !isBudgetMode && !isAccountMode && (
                            <div className={cn("flex items-center justify-between mb-4 p-3 rounded-xl border transition-all", isRI ? "bg-indigo-50 border-indigo-200" : "bg-sys-50 border-sys-100")}>
                                <div className="flex items-center gap-2">
                                    <ShieldCheck className={cn(withAfip ? "text-brand" : "text-sys-300")} size={20}/>
                                    <div>
                                        <span className="text-xs font-bold text-sys-700 uppercase block">Facturación Electrónica</span>
                                        <span className="text-[9px] text-sys-400 block flex items-center gap-1">
                                            {isRI ? <span className="text-indigo-600 font-bold flex items-center gap-1"><Info size={10}/> CLIENTE RI: FACTURA A</span> : withAfip ? "Se emitirá ticket fiscal (CAE)" : "Solo ticket interno"}
                                        </span>
                                    </div>
                                </div>
                                <Switch checked={withAfip} onCheckedChange={handleAfipChange} disabled={isRI || isProcessing || digitalState === 'waiting'} />
                            </div>
                        )}
                        
                        {renderActionButton()}
                    </div>
                </div>
            </div>
        </div>
    );
};