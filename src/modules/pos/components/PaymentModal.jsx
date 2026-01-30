import React, { useState, useEffect, useRef } from 'react';
import { 
    X, Banknote, QrCode, Loader2, CheckCircle2, 
    AlertCircle, Wallet, ArrowRight, CreditCard, Landmark, 
    ShieldCheck, Calculator, ChevronLeft, Layers, Info
} from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { Button } from '../../../core/ui/Button';
import { Switch } from '../../../core/ui/Switch';
import { cn } from '../../../core/utils/cn';
import { paymentService } from '../../payments/services/paymentService';
import { useAuthStore } from '../../auth/store/useAuthStore'; 

const API_URL = import.meta.env.VITE_API_URL || "https://us-central1-salvadorpos1.cloudfunctions.net/api";

// 🔥 AÑADIDA PROP 'isProcessing' PARA CONTROLAR EL ESTADO DE CARGA EXTERNO
export const PaymentModal = ({ isOpen, onClose, total, client, onConfirm, disableAfip = false, isProcessing = false }) => {
    
    // ==========================================
    // ESTADOS Y REFS
    // ==========================================
    const [method, setMethod] = useState('cash'); 
    const [amountToPay, setAmountToPay] = useState(''); 
    const [reference, setReference] = useState(''); 
    
    // Hardware
    const [assignedHardware, setAssignedHardware] = useState({ qrId: null, pointId: null });
    const [loadingHardware, setLoadingHardware] = useState(false);

    // Surcharge Engine V2
    const [paymentMethods, setPaymentMethods] = useState([]); 
    const [selectedBrand, setSelectedBrand] = useState(null); 
    const [selectedRate, setSelectedRate] = useState(null);   
    const [loadingPlans, setLoadingPlans] = useState(false);

    // Digital Payments
    const [digitalState, setDigitalState] = useState('idle'); 
    const [paymentReference, setPaymentReference] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);
    
    // Refs
    const pollingRef = useRef(null);
    const cashInputRef = useRef(null);
    
    // 🔥 VITAL: Referencia para evitar cierres de estado (closures) en pagos digitales
    const withAfipRef = useRef(false);

    // Hooks
    const { user, activeBranchId, activeBranchName } = useAuthStore(); 

    // Estado AFIP
    const [withAfip, setWithAfip] = useState(false);

    const ACCOUNT_DATA = {
        alias: "MAXIKIOSCO.ESQUINA",
        bank: "MercadoPago / Naranja X"
    };

    // ==========================================
    // 🧮 CÁLCULOS
    // ==========================================
    const effectiveTotal = selectedRate 
        ? total * (1 + (selectedRate.interest || 0) / 100)
        : total;

    const payValue = parseFloat(amountToPay || 0); 
    const difference = effectiveTotal - payValue; 
    const debtValue = difference > 0.5 ? difference : 0; 
    const changeValue = difference < -0.5 ? Math.abs(difference) : 0; 
    const isPartialPayment = debtValue > 0;
    const isClientRegistered = client && client.id; 
    const hasError = isPartialPayment && !isClientRegistered; 
    
    // 🛡️ VALIDACIÓN BLINDADA: Si está procesando, NO se puede confirmar
    const canConfirm = !hasError && payValue >= 0 && amountToPay !== '' && !isProcessing; 

    // ==========================================
    // 🛡️ LÓGICA DE BLOQUEO FISCAL
    // ==========================================
    const isRI = client?.fiscalCondition === 'RESPONSABLE_INSCRIPTO';
    
    // Sincronizar State con Ref
    useEffect(() => {
        withAfipRef.current = withAfip;
    }, [withAfip]);

    // Lógica Fiscal Automática
    useEffect(() => {
        if (isOpen) {
            // Si el cliente es RI y no es un cobro de deuda (disableAfip), forzamos factura
            if (isRI && !disableAfip) {
                setWithAfip(true); 
            } else {
                setWithAfip(false);
            }
        }
    }, [isOpen, isRI, disableAfip]);

    // ==========================================
    // 🛡️ DATA FETCHING
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
        } catch (error) {
            setPaymentMethods([]);
        } finally {
            setLoadingPlans(false);
        }
    };

    const handleAfipChange = (checked) => {
        if (isRI && !checked && !disableAfip) {
            alert("⚠️ Atención: A un Responsable Inscripto se le debe emitir Factura A obligatoriamente.");
            return;
        }
        setWithAfip(checked);
    };

    // Reset Inicial
    useEffect(() => {
        if (isOpen) {
            fetchHardwareAssignments();
            fetchFinancialPlans(); 
            
            setMethod('cash');
            setAmountToPay(Math.round(total).toString());
            setReference('');
            setDigitalState('idle');
            setPaymentReference(null);
            setErrorMessage(null);
            setSelectedBrand(null);
            setSelectedRate(null);
            
            // NO TOCAR withAfip AQUÍ PARA NO PISAR LA LÓGICA FISCAL
            
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
    }, [isOpen, total]);

    // Actualizar monto al cambiar tasa
    useEffect(() => {
        if (selectedRate) {
            const newTotal = total * (1 + (selectedRate.interest || 0) / 100);
            setAmountToPay(newTotal.toFixed(2));
        } else if (method === 'manual_card') {
            setAmountToPay(total.toFixed(2));
        } else if (method === 'cash') {
            setAmountToPay(Math.round(total).toString());
        }
    }, [selectedRate, total, method]);


    // 🚀 LÓGICA DE COBRO DIGITAL
    useEffect(() => {
        if (isOpen && (method === 'mercadopago' || method === 'point')) {
            const startTransaction = async () => {
                setDigitalState('creating');
                setErrorMessage(null);
                try {
                    const targetDeviceId = method === 'point' ? assignedHardware.pointId : assignedHardware.qrId;
                    if (!targetDeviceId) throw new Error(`Falta configurar ${method === 'point' ? 'Terminal Point' : 'Caja QR'}.`);

                    const res = await paymentService.initTransaction(method, total, targetDeviceId, {
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
        else if (isOpen && method === 'clover') {
            const handleCloverPayment = async () => {
                setDigitalState('creating');
                setErrorMessage(null);
                try {
                    const response = await fetch(`${API_URL}/create-clover-order`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            total: total,
                            companyId: user.companyId,
                            branchId: activeBranchId,
                            operatorId: user.uid
                        })
                    });
                    const result = await response.json();
                    if (response.ok && result.success) {
                        setDigitalState('approved');
                        setTimeout(() => {
                            // 🔥 Usamos withAfipRef.current para captar el valor real en este instante
                            onConfirm({ 
                                method: 'card', 
                                totalSale: total, 
                                amountPaid: total, 
                                amountDebt: 0, 
                                withAfip: withAfipRef.current, 
                                reference: result.paymentId,
                                branchId: activeBranchId,
                                baseAmount: total,
                                surcharge: 0
                            });
                        }, 1500);
                    } else {
                        setDigitalState('error');
                        setErrorMessage(result.error || "Error en Clover");
                    }
                } catch (error) {
                    setDigitalState('error');
                    setErrorMessage("No se pudo conectar con Clover");
                }
            };
            handleCloverPayment();
        }
    }, [method, isOpen, assignedHardware, user.companyId, activeBranchId, total, user.uid, onConfirm]);

    // Polling de Estado
    useEffect(() => {
        if (digitalState === 'waiting' && paymentReference && (method === 'mercadopago' || method === 'point')) {
            const checkPayment = async () => {
                try {
                    const res = await paymentService.checkStatus(paymentReference, method);
                    if (res.status === 'approved') {
                        setDigitalState('approved');
                        clearInterval(pollingRef.current);
                        setTimeout(() => {
                            // 🔥 Usamos withAfipRef.current para captar el valor real
                            onConfirm({ 
                                method, 
                                totalSale: total, 
                                amountPaid: total, 
                                amountDebt: 0, 
                                withAfip: withAfipRef.current, 
                                branchId: activeBranchId,
                                baseAmount: total,
                                surcharge: 0
                            });
                        }, 1500);
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
    }, [digitalState, paymentReference, method, total, activeBranchId, onConfirm]);

    const handleCloseAttempt = () => {
        // Si está procesando la venta final (isProcessing), NO dejar cerrar
        if (isProcessing) return;

        if (digitalState === 'waiting' || digitalState === 'creating') {
            if (window.confirm("⚠️ ¿CANCELAR PAGO EN PROCESO?")) {
                if (pollingRef.current) clearInterval(pollingRef.current);
                setDigitalState('idle'); 
                setMethod('cash'); 
            }
        } else onClose();
    };

    // ==========================================
    // 🧠 CONFIRMACIÓN MANUAL (BLINDADA)
    // ==========================================
    const handleManualConfirm = () => {
        // 🔥 DOBLE CHECK: Si ya está procesando o no es válido, abortar
        if (!canConfirm || isProcessing) return;

        const finalTotalSale = selectedRate ? effectiveTotal : total;
        const baseAmount = total;
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
            baseAmount: baseAmount,
            surcharge: surchargeAmount, 
            withAfip: withAfip 
        });
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (canConfirm && !isProcessing) handleManualConfirm();
        }
        if (e.key === 'Escape' && !isProcessing) handleCloseAttempt(); 
    };

    if (!isOpen) return null;

    const PaymentOption = ({ id, label, icon: Icon, colorClass, shortcut }) => (
        <button 
            onClick={() => {
                setMethod(id);
                if (id !== 'manual_card') {
                    setSelectedBrand(null);
                    setSelectedRate(null);
                }
            }} 
            disabled={digitalState === 'creating' || digitalState === 'waiting' || digitalState === 'approved' || isProcessing} 
            className={cn(
                "flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all duration-200 h-24 relative overflow-hidden active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed group", 
                method === id ? `bg-sys-50 border-${colorClass} shadow-md` : "bg-white border-sys-100 hover:border-sys-300 text-sys-500"
            )}
        >
            <div className="absolute top-1 right-2 text-[9px] font-mono text-sys-400 opacity-50 group-hover:opacity-100 font-bold">{shortcut}</div>
            <Icon size={28} className={cn("mb-1 transition-colors", method === id ? `text-${colorClass}` : "text-sys-400")} />
            <span className={cn("font-semibold text-xs leading-tight", method === id ? "text-sys-900" : "")}>{label}</span>
            {method === id && <div className={`absolute top-2 right-2 w-2 h-2 rounded-full bg-${colorClass}`}></div>}
        </button>
    );

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col md:flex-row min-h-[550px]">
                
                {/* 🟢 IZQUIERDA: RESUMEN FINANCIERO */}
                <div className="w-full md:w-1/3 bg-sys-50 p-6 flex flex-col justify-between border-r border-sys-200">
                    <div className="space-y-4">
                        <div className="bg-white p-4 rounded-xl border border-sys-200 shadow-sm relative overflow-hidden transition-all duration-300">
                            {selectedRate && (
                                <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-bl-lg">
                                    CON RECARGO
                                </div>
                            )}
                            <p className="text-xs text-sys-500 uppercase font-bold">{disableAfip ? "Monto a Saldar" : "Total Final"}</p>
                            <p className="text-3xl font-black text-sys-900 tracking-tight">
                                $ {effectiveTotal.toLocaleString('es-AR', {minimumFractionDigits: 0, maximumFractionDigits: 2})}
                            </p>
                            
                            {selectedRate && (
                                <div className="mt-2 pt-2 border-t border-dashed border-sys-200 flex justify-between text-xs animate-in slide-in-from-left-2">
                                    <span className="text-sys-500">Base: ${total.toLocaleString('es-AR')}</span>
                                    <span className="text-indigo-600 font-bold">
                                        + ${(effectiveTotal - total).toLocaleString('es-AR', {maximumFractionDigits: 2})} ({selectedRate.interest}%)
                                    </span>
                                </div>
                            )}
                        </div>

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
                        </div>

                        {changeValue > 0 && (
                            <div className="p-4 rounded-xl bg-green-600 text-white shadow-lg shadow-green-200 animate-in zoom-in-95">
                                <p className="text-[10px] uppercase font-bold opacity-80">Su Vuelto</p>
                                <p className="text-2xl font-black">$ {changeValue.toLocaleString('es-AR', {maximumFractionDigits: 2})}</p>
                            </div>
                        )}
                        {debtValue > 0 && (
                            <div className="p-4 rounded-xl bg-red-50 border border-red-200 animate-in zoom-in-95">
                                <p className="text-[10px] text-red-600 uppercase font-bold">Saldo a Cta Cte</p>
                                <p className="text-xl font-black text-red-600">$ {debtValue.toLocaleString('es-AR', {maximumFractionDigits: 2})}</p>
                                {!isClientRegistered && (
                                    <div className="mt-2 text-[9px] text-red-700 font-bold flex items-center gap-1">
                                        <AlertCircle size={10} /> CLIENTE REQUERIDO
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="mt-4 text-center">
                        <p className="text-[9px] text-sys-300 font-mono">ID: {reference || '---'}</p>
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
                            <PaymentOption key={opt.id} {...opt} colorClass={opt.color} />
                        ))}
                    </div>

                    {/* ÁREA DINÁMICA DE CONTENIDO */}
                    <div className="flex-1 bg-sys-50 rounded-2xl border-2 border-dashed border-sys-200 p-4 flex flex-col items-center justify-center overflow-y-auto relative">
                        
                        {method === 'manual_card' && (
                            <div className="w-full h-full flex flex-col animate-in fade-in absolute inset-0 p-4 overflow-y-auto">
                                {loadingPlans ? (
                                    <div className="flex flex-col items-center justify-center h-full">
                                        <Loader2 size={32} className="animate-spin text-indigo-500 mb-2"/>
                                        <p className="text-xs text-indigo-500 font-bold">Cargando tasas...</p>
                                    </div>
                                ) : paymentMethods.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full text-sys-400">
                                        <Layers size={40} className="mb-2 opacity-30"/>
                                        <p className="font-bold text-sm">Sin tarjetas configuradas</p>
                                        <p className="text-[10px] mt-1">Configure las marcas en el panel de Equipo.</p>
                                    </div>
                                ) : !selectedBrand ? (
                                    <div className="grid grid-cols-2 gap-3 w-full content-start">
                                        {paymentMethods.map((method) => (
                                            <button key={method.brand} onClick={() => setSelectedBrand(method)} className="p-4 rounded-xl border border-sys-200 bg-white hover:border-indigo-400 hover:shadow-md transition-all flex flex-col items-center group">
                                                <div className="w-10 h-7 bg-sys-50 border border-sys-100 rounded mb-2 flex items-center justify-center">
                                                    <span className="text-[9px] font-black text-sys-500">{method.brand.substring(0,3)}</span>
                                                </div>
                                                <p className="font-bold text-sys-800 text-xs uppercase">{method.brand}</p>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="w-full h-full flex flex-col">
                                        <div className="flex items-center gap-2 mb-3 w-full sticky top-0 bg-sys-50 pb-2 z-10">
                                            <Button variant="ghost" size="sm" onClick={() => { setSelectedBrand(null); setSelectedRate(null); }} className="text-sys-500 hover:bg-sys-200 h-8 px-2">
                                                <ChevronLeft size={16} />
                                            </Button>
                                            <span className="font-bold text-indigo-900 bg-indigo-100 px-3 py-1.5 rounded-lg text-xs flex-1 text-center truncate">PLANES {selectedBrand.brand}</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 w-full pb-2">
                                            {selectedBrand.rates.map((rate) => (
                                                <button key={rate.qty} onClick={() => setSelectedRate(selectedRate?.qty === rate.qty ? null : rate)} className={cn("p-3 rounded-xl border text-left transition-all h-20", selectedRate?.qty === rate.qty ? "bg-indigo-600 text-white shadow-md ring-2 ring-indigo-300" : "bg-white border-sys-200 text-sys-700 hover:border-indigo-300")}>
                                                    <div className="flex justify-between items-start w-full">
                                                        <span className={cn("text-lg font-black leading-none", selectedRate?.qty === rate.qty ? "text-white" : "text-sys-900")}>{rate.qty}</span>
                                                        <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded", selectedRate?.qty === rate.qty ? "bg-white/20 text-white" : "bg-sys-100 text-sys-600")}>{rate.interest === 0 ? "S/INT" : `+${rate.interest}%`}</span>
                                                    </div>
                                                    <span className={cn("text-xs font-bold mt-auto", selectedRate?.qty === rate.qty ? "text-indigo-100" : "text-sys-500")}>${((total * (1 + rate.interest/100)) / rate.qty).toLocaleString('es-AR', {maximumFractionDigits:0})} <span className="text-[9px] font-normal">/mes</span></span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        {method === 'cash' && <div className="text-sys-300 flex flex-col items-center opacity-40"><Wallet size={48} /><p className="text-[10px] font-black uppercase mt-2 tracking-widest">Cobro Manual</p></div>}
                        {method === 'transfer' && (
                            <div className="w-full max-w-xs space-y-3 animate-in fade-in">
                                <div className="bg-purple-600 text-white p-4 rounded-xl text-center"><p className="font-black text-lg tracking-wide">{ACCOUNT_DATA.alias}</p></div>
                                <input type="text" className="w-full p-3 rounded-xl border-2 border-sys-200 text-center font-bold" placeholder="Nro de Operación" value={reference} onChange={e => setReference(e.target.value)} />
                            </div>
                        )}
                        {(method === 'mercadopago' || method === 'point' || method === 'clover') && (
                            <div className="flex flex-col items-center gap-3 animate-in fade-in">
                                {digitalState === 'waiting' ? <div className="w-16 h-16 rounded-full border-4 border-brand border-t-transparent animate-spin"/> : digitalState === 'approved' ? <div className="w-16 h-16 rounded-full bg-green-500 text-white flex items-center justify-center animate-in zoom-in"><CheckCircle2 size={32}/></div> : <Loader2 className="animate-spin text-sys-300" />}
                            </div>
                        )}
                    </div>

                    <div className="mt-6 pt-4 border-t border-sys-100">
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
                        
                        {/* 🚀 BOTÓN DE CONFIRMACIÓN PREMIUM */}
                        <Button 
                            onClick={handleManualConfirm} 
                            disabled={!canConfirm || isProcessing}
                            className={cn("w-full py-6 text-xl font-black uppercase shadow-xl transition-all duration-300 relative overflow-hidden", 
                                (!canConfirm || isProcessing) ? "bg-sys-200 text-sys-400 cursor-not-allowed shadow-none" : "bg-brand hover:bg-brand-dark hover:scale-[1.01] shadow-brand/30 active:scale-[0.98]"
                            )}
                        >
                            {isProcessing ? (
                                <div className="flex items-center justify-center gap-3 animate-pulse">
                                    <Loader2 className="animate-spin" size={24} />
                                    <span>Procesando Venta...</span>
                                </div>
                            ) : (
                                <div className="flex items-center justify-center gap-2">
                                    <span>{isPartialPayment ? "Confirmar Pago Parcial" : "Confirmar Cobro"}</span>
                                    <ArrowRight size={24} />
                                </div>
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};