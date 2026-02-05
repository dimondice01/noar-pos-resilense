import React, { useState, useEffect, useRef } from 'react';
import { 
    X, Banknote, QrCode, Loader2, CheckCircle2, 
    AlertCircle, Wallet, ArrowRight, CreditCard, Landmark, 
    ShieldCheck, Calculator, ChevronLeft, Layers, Info, Megaphone, Trash2, Plus, Split,
    Tag
} from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { Button } from '../../../core/ui/Button';
import { Switch } from '../../../core/ui/Switch';
import { cn } from '../../../core/utils/cn';
import { paymentService } from '../../payments/services/paymentService';
import { useAuthStore } from '../../auth/store/useAuthStore'; 

const API_URL = import.meta.env.VITE_API_URL || "https://us-central1-salvadorpos1.cloudfunctions.net/api";

export const PaymentModal = ({ isOpen, onClose, total, subtotal, discount, client, onConfirm, disableAfip = false, isProcessing = false }) => {
    
    // ==========================================
    // 1. ESTADOS Y CONFIGURACIÓN
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
    const [loadingHardware, setLoadingHardware] = useState(false);
    const [paymentMethods, setPaymentMethods] = useState([]); 
    const [selectedBrand, setSelectedBrand] = useState(null); 
    const [selectedRate, setSelectedRate] = useState(null);   
    const [loadingPlans, setLoadingPlans] = useState(false);

    // Estado Pagos Digitales
    const [digitalState, setDigitalState] = useState('idle'); 
    const [paymentReference, setPaymentReference] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);
    
    // Refs
    const pollingRef = useRef(null);
    const cashInputRef = useRef(null);
    const withAfipRef = useRef(false);

    // Hooks
    const { user, activeBranchId, activeBranchName } = useAuthStore(); 
    const [withAfip, setWithAfip] = useState(false);

    const ACCOUNT_DATA = {
        alias: "MAXIKIOSCO.ESQUINA",
        bank: "MercadoPago / Naranja X"
    };

    // ==========================================
    // 2. CÁLCULOS MATEMÁTICOS (HÍBRIDOS)
    // ==========================================
    
    // -- Lógica General --
    const currentInterestRate = selectedRate ? selectedRate.interest : 0;
    
    const effectiveTotal = selectedRate 
        ? total * (1 + (currentInterestRate / 100))
        : total;

    // -- Lógica Split --
    const totalPaidSoFar = payments.reduce((acc, p) => acc + p.amount, 0); // Suma de bases
    const remainingBase = Math.max(0, total - totalPaidSoFar);
    const isFullyPaid = remainingBase < 0.5; // Tolerancia por redondeo

    // -- Variables de Visualización --
    const payValue = parseFloat(amountToPay || 0);
    
    // Cálculo de cambio/deuda
    const difference = (isSplitMode ? remainingBase : effectiveTotal) - payValue;
    const debtValue = (!isSplitMode && difference > 0.5) ? difference : 0;
    const changeValue = difference < -0.5 ? Math.abs(difference) : 0;

    // Lógica de Pago Parcial
    const isPartialPayment = debtValue > 0;

    // Validaciones
    const isClientRegistered = client && client.id; 
    const hasError = !isSplitMode && isPartialPayment && !isClientRegistered; 
    
    const canConfirmSimple = !hasError && payValue >= 0 && amountToPay !== '' && !isProcessing;

    // Estado AFIP
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
            setErrorMessage(null);
            setSelectedBrand(null);
            setSelectedRate(null);
            
            fetchHardwareAssignments();
            fetchFinancialPlans();

            if (pollingRef.current) clearInterval(pollingRef.current);
            
            setTimeout(() => {
                if (cashInputRef.current) {
                    cashInputRef.current.focus();
                    cashInputRef.current.select();
                }
            }, 100);
        } else {
            if (pollingRef.current) clearInterval(pollingRef.current);
        }
    }, [isOpen, total, isRI, disableAfip]);

    // Auto-actualizar monto a pagar cuando cambia el interés en Modo Simple
    useEffect(() => {
        if (!isSplitMode) {
            if (selectedRate) {
                // Si seleccionamos un plan, el monto a pagar debe igualar al total con interés automáticamente
                setAmountToPay(effectiveTotal.toFixed(2));
            } else {
                // Si deseleccionamos el plan, volvemos al total original (redondeado por UX)
                setAmountToPay(Math.round(total).toString());
            }
        }
    }, [selectedRate, effectiveTotal, isSplitMode, total]);

    // Auto-rellenar monto restante en modo Split
    useEffect(() => {
        if (isSplitMode && !selectedRate && !isFullyPaid) {
            setAmountToPay(remainingBase.toFixed(2));
        }
    }, [remainingBase, isSplitMode, selectedRate, isFullyPaid]);

    // ==========================================
    // 4. DATA FETCHING
    // ==========================================
    const fetchHardwareAssignments = async () => {
        if (!user?.uid || !activeBranchId) return;
        setLoadingHardware(true);
        try {
            const branchRef = `companies/${user.companyId}/branches/${activeBranchId}/integrations`;
            const assignDoc = await getDoc(doc(db, branchRef, 'assignments'));
            if (assignDoc.exists()) {
                const allAssignments = assignDoc.data();
                setAssignedHardware(allAssignments[user.uid] || { qrId: null, pointId: null });
            }
        } catch (e) { console.error(e); } finally { setLoadingHardware(false); }
    };

    const fetchFinancialPlans = async () => {
        if (!user?.companyId) return;
        setLoadingPlans(true);
        try {
            const configRef = doc(db, `companies/${user.companyId}/config/financials`);
            const snap = await getDoc(configRef);
            if (snap.exists() && snap.data().methods) {
                setPaymentMethods(snap.data().methods);
            } else {
                setPaymentMethods([]);
            }
        } catch (error) { setPaymentMethods([]); } finally { setLoadingPlans(false); }
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

    // --- A. AGREGAR PAGO (MODO SPLIT) ---
    const handleAddSplitPayment = () => {
        const amount = parseFloat(amountToPay);
        if (isNaN(amount) || amount <= 0) return;
        
        if (amount > remainingBase + 1) return alert("El monto excede el saldo restante.");

        const interestAmount = selectedRate ? (amount * (selectedRate.interest / 100)) : 0;
        
        const paymentObj = {
            id: Date.now(),
            method: (method === 'manual_card' || method === 'point' || method === 'clover') ? 'card' : method,
            amount: amount, // Lo que descuenta de la deuda
            surcharge: interestAmount,
            total: amount + interestAmount, // Lo que paga realmente el cliente
            reference: reference || (selectedRate ? `${selectedBrand?.brand} ${selectedRate.qty} ctes` : ''),
            brand: selectedBrand?.brand
        };

        setPayments([...payments, paymentObj]);
        
        // Reset para el siguiente
        setMethod('cash');
        setReference('');
        setSelectedBrand(null);
        setSelectedRate(null);
        setDigitalState('idle');
    };

    // --- B. ELIMINAR PAGO (MODO SPLIT) ---
    const handleRemovePayment = (id) => {
        setPayments(payments.filter(p => p.id !== id));
    };

    // --- C. FINALIZAR VENTA (MODO SPLIT) ---
    const handleFinalizeSplit = () => {
        if (!isFullyPaid) return;
        
        const totalSaleReal = payments.reduce((acc, p) => acc + p.total, 0);

        onConfirm({
            payments: payments, 
            totalSale: totalSaleReal,
            subtotal: subtotal,
            discount: discount,
            amountPaid: totalPaidSoFar,
            change: changeValue,
            withAfip: withAfip,
            branchId: activeBranchId
        });
    };

    // --- D. FINALIZAR VENTA (MODO SIMPLE - LEGACY) ---
    const handleManualConfirm = () => {
        if (!canConfirmSimple || isProcessing) return;

        const finalTotalSale = selectedRate ? effectiveTotal : total;
        const surchargeAmount = selectedRate ? (effectiveTotal - total) : 0;

        let finalReference = method === 'transfer' ? reference : null;
        if (selectedRate && selectedBrand) {
            finalReference = `${selectedBrand.brand} ${selectedRate.qty} ctes (${selectedRate.interest}%)`;
        } else if (method === 'manual_card') {
            finalReference = "Tarjeta (Manual sin plan)";
        }

        onConfirm({
            method: (method === 'manual_card' || method === 'point' || method === 'clover') ? 'card' : method,
            reference: finalReference,
            branchId: activeBranchId, 
            totalSale: finalTotalSale,
            amountPaid: payValue - changeValue, 
            amountDebt: debtValue, 
            baseAmount: total,
            surcharge: surchargeAmount, 
            discount: discount || 0,
            withAfip: withAfip 
        });
    };

    // --- E. PROCESAR (ROUTER DE ACCIÓN) ---
    const handleMainAction = () => {
        if (isSplitMode) {
            if (!isFullyPaid) handleAddSplitPayment();
            else handleFinalizeSplit();
        } else {
            handleManualConfirm();
        }
    };

    // --- F. LÓGICA DIGITAL (MP/POINT) ---
    useEffect(() => {
        if (isOpen && (method === 'mercadopago' || method === 'point')) {
            const startTransaction = async () => {
                setDigitalState('creating');
                setErrorMessage(null);
                try {
                    const targetDeviceId = method === 'point' ? assignedHardware.pointId : assignedHardware.qrId;
                    if (!targetDeviceId) throw new Error(`Falta configurar ${method === 'point' ? 'Terminal Point' : 'Caja QR'}.`);

                    const res = await paymentService.initTransaction(method, parseFloat(amountToPay), targetDeviceId, {
                        companyId: user.companyId,
                        branchId: activeBranchId
                    });
                    
                    setPaymentReference(res.reference);
                    setDigitalState('waiting'); 
                } catch (error) {
                    setDigitalState('error');
                    setErrorMessage(error.message || "Error de conexión");
                }
            };
            startTransaction();
        } 
    }, [method, isOpen, assignedHardware, user.companyId, activeBranchId, amountToPay]);

    // Polling Digital
    useEffect(() => {
        if (digitalState === 'waiting' && paymentReference && (method === 'mercadopago' || method === 'point')) {
            const checkPayment = async () => {
                try {
                    const res = await paymentService.checkStatus(paymentReference, method);
                    if (res.status === 'approved') {
                        setDigitalState('approved');
                        clearInterval(pollingRef.current);
                        setTimeout(() => {
                            if (isSplitMode) handleAddSplitPayment();
                            else handleManualConfirm();
                        }, 1000);
                    } else if (['rejected', 'canceled'].includes(res.status)) {
                        setDigitalState('error');
                        setErrorMessage("Pago rechazado o cancelado");
                        clearInterval(pollingRef.current);
                    }
                } catch (e) { console.error("Polling error:", e); }
            };
            pollingRef.current = setInterval(checkPayment, 3000);
            return () => clearInterval(pollingRef.current);
        }
    }, [digitalState, paymentReference, method, isSplitMode]);

    const handleCloseAttempt = () => {
        if (isProcessing) return;
        if (digitalState === 'waiting' || digitalState === 'creating') {
            if (window.confirm("⚠️ ¿CANCELAR PAGO EN PROCESO?")) {
                if (pollingRef.current) clearInterval(pollingRef.current);
                setDigitalState('idle'); 
                setMethod('cash'); 
            }
        } else onClose();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleMainAction();
        }
        if (e.key === 'Escape' && !isProcessing) handleCloseAttempt(); 
    };

    if (!isOpen) return null;

    return (
        /* 🔥 FIX VISUAL: Aumentamos min-h para que el modal no quede corto con listas largas */
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col md:flex-row min-h-[600px] md:h-[650px]">
                
                {/* 🟢 IZQUIERDA: RESUMEN FINANCIERO (CON TOGGLE SPLIT) */}
                <div className="w-full md:w-1/3 bg-sys-50 p-6 flex flex-col justify-between border-r border-sys-200 relative">
                    
                    <div className="space-y-4">
                        {/* TOGGLE PAGO COMBINADO */}
                        <div className="flex items-center justify-between bg-white p-2 rounded-lg border border-sys-200 shadow-sm mb-4">
                            <span className="text-[10px] font-bold uppercase text-sys-500 flex items-center gap-2">
                                <Split size={14} className={isSplitMode ? "text-brand" : "text-sys-300"}/> 
                                Pago Combinado
                            </span>
                            <Switch checked={isSplitMode} onCheckedChange={setIsSplitMode} size="sm" />
                        </div>

                        {/* TARJETA TOTAL */}
                        <div className="bg-white p-4 rounded-xl border border-sys-200 shadow-sm relative overflow-hidden transition-all duration-300">
                            {selectedRate && (
                                <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-bl-lg">
                                    CON RECARGO
                                </div>
                            )}
                            
                            {/* 🔥 VISUALIZACIÓN CLARA DE PROMO LOCAL */}
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
                                <p className="text-xs text-sys-500 uppercase font-bold">{disableAfip ? "Monto a Saldar" : "Total Final"}</p>
                                {discount > 0 && <span className="text-[10px] text-sys-400 line-through decoration-red-400">${subtotal.toLocaleString('es-AR')}</span>}
                            </div>
                            
                            {/* SI ES SPLIT, MOSTRAMOS EL RESTANTE AQUÍ PARA CLARIDAD */}
                            <p className="text-3xl font-black text-sys-900 tracking-tight">
                                $ {isSplitMode ? remainingBase.toLocaleString('es-AR', {minimumFractionDigits: 0, maximumFractionDigits: 2}) : effectiveTotal.toLocaleString('es-AR', {minimumFractionDigits: 0, maximumFractionDigits: 2})}
                            </p>
                            
                            {isSplitMode && <p className="text-[10px] text-sys-400 font-bold mt-1">RESTANTE A PAGAR</p>}

                            {!isSplitMode && selectedRate && (
                                <div className="mt-2 pt-2 border-t border-dashed border-sys-200 flex justify-between text-xs animate-in slide-in-from-left-2">
                                    <span className="text-sys-500">Base: ${total.toLocaleString('es-AR')}</span>
                                    <span className="text-indigo-600 font-bold">
                                        + ${(effectiveTotal - total).toLocaleString('es-AR', {maximumFractionDigits: 2})} ({selectedRate.interest}%)
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* MODO SPLIT: LISTA DE PAGOS */}
                        {isSplitMode && (
                            <div className="flex-1 overflow-y-auto max-h-[180px] custom-scrollbar space-y-2 border-t border-b border-sys-200 py-2">
                                {payments.length === 0 && <div className="text-center text-xs text-sys-400 italic py-2">Agregue pagos para cubrir el total.</div>}
                                {payments.map(p => (
                                    <div key={p.id} className="bg-white p-2 rounded border flex justify-between items-center text-xs shadow-sm animate-in slide-in-from-left-2">
                                        <div>
                                            <span className="font-bold uppercase block text-sys-700">{p.method === 'manual_card' ? 'Tarjeta' : p.method}</span>
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

                        {/* RESUMEN SALDOS */}
                        {isSplitMode ? (
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
                        ) : (
                            /* MODO SIMPLE: CAMBIO Y DEUDA */
                            <div className={cn("p-4 rounded-xl border-2 transition-all duration-300", 
                                isPartialPayment ? "bg-orange-50 border-orange-200" : 
                                changeValue > 0 ? "bg-green-50 border-green-200" : "bg-white border-sys-200",
                                selectedRate && "opacity-90 grayscale-[0.5]"
                            )}>
                                <p className={cn("text-[10px] uppercase font-bold mb-1 flex justify-between", isPartialPayment ? "text-orange-700" : "text-sys-500")}>
                                    <span>Monto que entrega</span>
                                    {selectedRate && <span className="text-[9px] bg-sys-200 px-1 rounded text-sys-600">AUTO</span>}
                                </p>
                                <div className="flex items-center relative">
                                    <span className="text-lg font-bold text-sys-400 mr-1">$</span>
                                    <input 
                                        ref={cashInputRef}
                                        type="number" 
                                        className={cn(
                                            "w-full bg-transparent text-2xl font-black outline-none text-sys-900 placeholder-sys-300 transition-colors",
                                            selectedRate && "cursor-not-allowed text-sys-600"
                                        )}
                                        value={amountToPay} 
                                        onChange={e => !selectedRate && setAmountToPay(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        readOnly={!!selectedRate || isProcessing}
                                        disabled={isProcessing}
                                        placeholder={Math.round(total).toString()}
                                    />
                                </div>
                                {changeValue > 0 && <p className="text-right text-xs font-bold text-green-600 mt-1">Vuelto: $ {changeValue.toLocaleString('es-AR')}</p>}
                                {debtValue > 0 && <p className="text-right text-xs font-bold text-orange-600 mt-1">Deuda Cta Cte: $ {debtValue.toLocaleString('es-AR')}</p>}
                            </div>
                        )}
                        
                        <div className="mt-2 text-center">
                            <p className="text-[9px] text-sys-300 font-mono">REF: {reference || '---'}</p>
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

                    <div className="grid grid-cols-5 gap-2 mb-6">
                        {[
                            {id:'cash', icon: Banknote, label:'Efectivo', color:'brand'},
                            {id:'transfer', icon: Landmark, label:'Transf.', color:'purple-600'},
                            {id:'mercadopago', icon: QrCode, label:'QR MP', color:'blue-500'},
                            {id:'point', icon: CreditCard, label:'Point', color:'blue-600'},
                            {id:'manual_card', icon: Calculator, label:'Tarjeta', color:'indigo-600'}
                        ].map(opt => (
                            <button 
                                key={opt.id}
                                onClick={() => {
                                    setMethod(opt.id);
                                    if (opt.id !== 'manual_card') { setSelectedBrand(null); setSelectedRate(null); }
                                }} 
                                disabled={digitalState === 'creating' || digitalState === 'waiting' || digitalState === 'approved' || isProcessing || (isSplitMode && isFullyPaid)} 
                                className={cn(
                                    "flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all duration-200 h-24 relative overflow-hidden active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed group", 
                                    method === opt.id ? `bg-sys-50 border-${opt.color} shadow-md` : "bg-white border-sys-100 hover:border-sys-300 text-sys-500"
                                )}
                            >
                                <opt.icon size={28} className={cn("mb-1 transition-colors", method === opt.id ? `text-${opt.color}` : "text-sys-400")} />
                                <span className={cn("font-semibold text-xs leading-tight", method === opt.id ? "text-sys-900" : "")}>{opt.label}</span>
                                {method === opt.id && <div className={`absolute top-2 right-2 w-2 h-2 rounded-full bg-${opt.color}`}></div>}
                            </button>
                        ))}
                    </div>

                    {/* ÁREA DINÁMICA DE CONTENIDO */}
                    <div className="flex-1 bg-sys-50 rounded-2xl border-2 border-dashed border-sys-200 p-4 flex flex-col items-center justify-center overflow-hidden relative">
                        
                        {method === 'manual_card' && (
                            /* 🔥 FIX: Eliminado absolute inset-0. Usamos flex full natural para respetar el padding */
                            <div className="w-full h-full flex flex-col">
                                {loadingPlans ? (
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
                                    /* 🔥 FIX: VISTA LISTA DE MARCAS - SCROLLABLE INDEPENDIENTE */
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
                                    /* 🔥 FIX: VISTA PLANES DE CUOTAS - HEADER FIJO + SCROLL */
                                    <div className="flex flex-col w-full h-full">
                                        {/* HEADER FIJO */}
                                        <div className="flex items-center gap-2 mb-3 w-full flex-none z-10">
                                            <Button variant="ghost" size="sm" onClick={() => { setSelectedBrand(null); setSelectedRate(null); }} className="text-sys-500 hover:bg-sys-200 h-8 px-2">
                                                <ChevronLeft size={16} />
                                            </Button>
                                            <span className="font-bold text-indigo-900 bg-indigo-100 px-3 py-1.5 rounded-lg text-xs flex-1 text-center truncate">{selectedBrand.brand}</span>
                                        </div>
                                        
                                        {/* LISTA SCROLLABLE */}
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
                                /* INPUT EN MODO SPLIT */
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
                                /* MODO SIMPLE: ICONO GIGANTE (Ya que el input está a la izquierda) */
                                <div className="text-sys-300 flex flex-col items-center opacity-40">
                                    <Wallet size={48} />
                                    <p className="text-[10px] font-black uppercase mt-2 tracking-widest">Cobro en Efectivo</p>
                                </div>
                            )
                        )}
                        
                        {method === 'transfer' && (
                            <div className="w-full max-w-xs space-y-3 animate-in fade-in">
                                <div className="bg-purple-600 text-white p-4 rounded-xl text-center"><p className="font-black text-lg tracking-wide">{ACCOUNT_DATA.alias}</p></div>
                                <input type="text" className="w-full p-3 rounded-xl border-2 border-sys-200 text-center font-bold" placeholder="Nro de Operación" value={reference} onChange={e => setReference(e.target.value)} />
                            </div>
                        )}
                        
                        {(method === 'mercadopago' || method === 'point' || method === 'clover') && (
                            /* 🔥 FIX: MANEJO VISUAL DE ERROR EN HARDWARE */
                            <div className="flex flex-col items-center gap-3 animate-in fade-in">
                                {digitalState === 'error' ? (
                                    <div className="flex flex-col items-center text-center animate-in zoom-in">
                                        <AlertCircle size={48} className="text-red-500 mb-2"/>
                                        <p className="font-bold text-red-600 mb-1">Error de Operación</p>
                                        <p className="text-xs text-sys-500 max-w-[250px]">{errorMessage}</p>
                                        <Button variant="ghost" size="sm" onClick={() => { setMethod('cash'); setDigitalState('idle'); }} className="mt-4 text-sys-400 hover:text-sys-700">
                                            Cancelar / Volver
                                        </Button>
                                    </div>
                                ) : (
                                    <>
                                        {digitalState === 'waiting' ? <div className="w-16 h-16 rounded-full border-4 border-brand border-t-transparent animate-spin"/> : digitalState === 'approved' ? <div className="w-16 h-16 rounded-full bg-green-500 text-white flex items-center justify-center animate-in zoom-in"><CheckCircle2 size={32}/></div> : <Loader2 className="animate-spin text-sys-300" />}
                                        {(digitalState === 'creating' || digitalState === 'waiting') && method === 'mercadopago' && <p className="text-xs font-bold text-sys-500 mt-2">Escanee el QR en el visor</p>}
                                        {(digitalState === 'creating' || digitalState === 'waiting') && method === 'point' && <p className="text-xs font-bold text-sys-500 mt-2">Acerque tarjeta al lector</p>}
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="mt-6 pt-4 border-t border-sys-100">
                        {isSplitMode && !isFullyPaid ? (
                            /* BOTÓN MODO SPLIT: AGREGAR PAGO */
                            <Button 
                                onClick={handleMainAction} 
                                className="w-full py-6 text-xl font-black uppercase shadow-xl bg-sys-800 hover:bg-sys-900 text-white rounded-2xl flex items-center justify-center gap-2"
                            >
                                <Plus size={24}/> AGREGAR PAGO
                            </Button>
                        ) : (
                            /* BOTÓN MODO SIMPLE O FINALIZAR SPLIT */
                            <>
                                {!disableAfip && (
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
                                            <Switch checked={withAfip} onCheckedChange={handleAfipChange} disabled={isRI || isProcessing} />
                                    </div>
                                )}
                                
                                <Button 
                                    onClick={handleMainAction} 
                                    disabled={(!canConfirmSimple && !isSplitMode) || isProcessing}
                                    className={cn("w-full py-6 text-xl font-black uppercase shadow-xl transition-all duration-300 relative overflow-hidden", 
                                        ((!canConfirmSimple && !isSplitMode) || isProcessing) ? "bg-sys-200 text-sys-400 cursor-not-allowed shadow-none" : "bg-brand hover:bg-brand-dark hover:scale-[1.01] shadow-brand/30 active:scale-[0.98]"
                                    )}
                                >
                                    {isProcessing ? (
                                        <div className="flex items-center justify-center gap-3 animate-pulse"><Loader2 className="animate-spin" size={24} /><span>Procesando...</span></div>
                                    ) : (
                                        <div className="flex items-center justify-center gap-2">
                                            <span>{isSplitMode ? "FINALIZAR VENTA" : (isPartialPayment ? "Confirmar Pago Parcial" : "Confirmar Cobro")}</span>
                                            <ArrowRight size={24} />
                                        </div>
                                    )}
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};