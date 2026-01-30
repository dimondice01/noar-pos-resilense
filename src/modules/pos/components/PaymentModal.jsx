import React, { useState, useEffect, useRef } from 'react';
import { 
    X, Banknote, QrCode, Loader2, CheckCircle2, 
    AlertCircle, FileText, Wallet, ArrowRight, CreditCard, Landmark, Terminal,
    ShieldCheck
} from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { Button } from '../../../core/ui/Button';
import { Switch } from '../../../core/ui/Switch';
import { cn } from '../../../core/utils/cn';
import { paymentService } from '../../payments/services/paymentService';
import { useAuthStore } from '../../auth/store/useAuthStore'; 

// URL del Backend (Cloud Functions)
const API_URL = import.meta.env.VITE_API_URL || "https://us-central1-salvadorpos1.cloudfunctions.net/api";

export const PaymentModal = ({ isOpen, onClose, total, client, onConfirm, disableAfip = false }) => {
    // ==========================================
    // ESTADOS Y REFS
    // ==========================================
    const [method, setMethod] = useState('cash'); 
    const [amountToPay, setAmountToPay] = useState(''); 
    const [reference, setReference] = useState(''); 
    
    // Configuración de Terminales (Ahora desde la Nube por Sucursal/Usuario)
    const [assignedHardware, setAssignedHardware] = useState({ qrId: null, pointId: null });
    const [loadingHardware, setLoadingHardware] = useState(false);

    // Estado del Flujo Digital
    const [digitalState, setDigitalState] = useState('idle'); 
    const [paymentReference, setPaymentReference] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);
    
    // Refs
    const pollingRef = useRef(null);
    const cashInputRef = useRef(null);
    const transferRef = useRef(null);

    // Hooks
    const { user, activeBranchId } = useAuthStore(); 

    // Estado AFIP
    const [withAfip, setWithAfip] = useState(false);

    // Datos Cuenta para Transferencia
    const ACCOUNT_DATA = {
        alias: "MAXIKIOSCO.ESQUINA",
        bank: "MercadoPago / Naranja X"
    };

    // ==========================================
    // CÁLCULOS FINANCIEROS
    // ==========================================
    const payValue = parseFloat(amountToPay || 0); 
    const difference = total - payValue; 
    const debtValue = difference > 0.5 ? difference : 0; 
    const changeValue = difference < -0.5 ? Math.abs(difference) : 0; 
    
    const isPartialPayment = debtValue > 0;
    const isClientRegistered = client && client.id; 
    
    const hasError = isPartialPayment && !isClientRegistered; 
    const canConfirm = !hasError && payValue >= 0 && amountToPay !== ''; 

    // ==========================================
    // 🛡️ LÓGICA DE ASIGNACIÓN CLOUD
    // ==========================================
    const fetchHardwareAssignments = async () => {
        if (!user?.uid || !activeBranchId) return;
        setLoadingHardware(true);
        try {
            const branchRef = `companies/${user.companyId}/branches/${activeBranchId}/integrations`;
            const assignDoc = await getDoc(doc(db, branchRef, 'assignments'));
            
            if (assignDoc.exists()) {
                const allAssignments = assignDoc.data();
                const myHardware = allAssignments[user.uid] || { qrId: null, pointId: null };
                setAssignedHardware(myHardware);
            }
        } catch (e) {
            console.error("Error recuperando asignaciones cloud:", e);
        } finally {
            setLoadingHardware(false);
        }
    };

    const handleAfipChange = (checked) => {
        setWithAfip(checked);
    };

    // Reset de Estado
    useEffect(() => {
        if (isOpen) {
            fetchHardwareAssignments();
            setMethod('cash');
            setAmountToPay(Math.round(total).toString());
            setReference('');
            setDigitalState('idle');
            setPaymentReference(null);
            setErrorMessage(null);
            if (pollingRef.current) clearInterval(pollingRef.current);
            setWithAfip(false);
            
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

    // 🚀 LÓGICA DE COBRO DIGITAL (MP / POINT / CLOVER)
    useEffect(() => {
        if (isOpen && (method === 'mercadopago' || method === 'point')) {
            const startTransaction = async () => {
                setDigitalState('creating');
                setErrorMessage(null);
                
                try {
                    const targetDeviceId = method === 'point' ? assignedHardware.pointId : assignedHardware.qrId;

                    if (!targetDeviceId) {
                        throw new Error(`Falta configurar ${method === 'point' ? 'Terminal Point' : 'Caja QR'} para este usuario en la sucursal activa.`);
                    }

                    // 🔥 CAMBIO CRUCIAL: Enviamos branchId para que la Cloud Function sepa de dónde sacar el token
                    const res = await paymentService.initTransaction(method, total, targetDeviceId, {
                        companyId: user.companyId,
                        branchId: activeBranchId
                    });
                    
                    setPaymentReference(res.reference);
                    setDigitalState('waiting'); 

                } catch (error) {
                    console.error(`Error iniciando ${method}:`, error);
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
                            onConfirm({ method: 'card', totalSale: total, amountPaid: total, amountDebt: 0, withAfip, reference: result.paymentId });
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
    }, [method, isOpen, assignedHardware]); 

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
                            onConfirm({ method, totalSale: total, amountPaid: total, amountDebt: 0, withAfip });
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
    }, [digitalState, paymentReference]);

    const handleCloseAttempt = () => {
        if (digitalState === 'waiting' || digitalState === 'creating') {
            if (window.confirm("⚠️ ¿CANCELAR PAGO EN PROCESO?")) {
                if (pollingRef.current) clearInterval(pollingRef.current);
                setDigitalState('idle'); 
                setMethod('cash'); 
            }
        } else onClose();
    };

    const handleManualConfirm = () => {
        if (!canConfirm) return;
        onConfirm({
            method,
            totalSale: total,
            amountPaid: payValue - changeValue, 
            amountDebt: debtValue, 
            withAfip, 
            reference: method === 'transfer' ? reference : null 
        });
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (canConfirm) handleManualConfirm();
        }
        if (e.key === 'Escape') handleCloseAttempt(); 
    };

    if (!isOpen) return null;

    const PaymentOption = ({ id, label, icon: Icon, colorClass, shortcut }) => (
        <button 
            onClick={() => setMethod(id)} 
            disabled={digitalState === 'creating' || digitalState === 'waiting' || digitalState === 'approved'} 
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
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col md:flex-row min-h-[500px]">
                
                {/* 🟢 COLUMNA IZQUIERDA: RESUMEN FINANCIERO */}
                <div className="w-full md:w-1/3 bg-sys-50 p-6 flex flex-col justify-between border-r border-sys-200">
                    <div>
                        <h3 className="font-bold text-sys-800 text-lg mb-1">
                            {disableAfip ? "Cobranza de Deuda" : "Total a Cobrar"}
                        </h3>
                        <p className="text-sys-500 text-sm">Resumen de la operación</p>
                    </div>

                    <div className="space-y-4 flex-1 mt-6">
                        <div className="bg-white p-4 rounded-xl border border-sys-200 shadow-sm">
                            <p className="text-xs text-sys-500 uppercase font-bold">{disableAfip ? "Monto a Saldar" : "Total Venta"}</p>
                            <p className="text-3xl font-black text-sys-900 tracking-tight">$ {total.toLocaleString('es-AR', {minimumFractionDigits: 0})}</p>
                        </div>

                        {(method === 'cash' || method === 'transfer' || digitalState === 'error') && (
                            <div className={cn("p-4 rounded-xl border transition-colors ring-offset-2 animate-in slide-in-from-bottom-2", 
                                isPartialPayment ? "bg-orange-50 border-orange-300 ring-orange-100" : 
                                changeValue > 0 ? "bg-green-50 border-green-300 ring-green-100" : "bg-white border-brand ring-brand/10"
                            )}>
                                <p className={cn("text-xs uppercase font-bold mb-1 flex justify-between", 
                                    isPartialPayment ? "text-orange-700" : changeValue > 0 ? "text-green-700" : "text-brand"
                                )}>
                                    <span>{isPartialPayment ? "Pago Parcial" : changeValue > 0 ? "Paga con" : "Monto Exacto"}</span>
                                    <span className="text-[10px] bg-black/5 px-1.5 rounded">ENTER</span>
                                </p>
                                <div className="relative">
                                    <span className="absolute left-0 top-1 text-lg font-bold text-sys-400">$</span>
                                    <input 
                                        ref={cashInputRef}
                                        type="number" 
                                        className="w-full bg-transparent text-3xl font-black outline-none border-b-2 border-sys-300 focus:border-brand p-0 pl-5 text-sys-900 placeholder-sys-300"
                                        value={amountToPay}
                                        onChange={e => setAmountToPay(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        placeholder={Math.round(total).toString()}
                                    />
                                </div>
                            </div>
                        )}

                        {(method === 'cash' || method === 'transfer') && (
                            <>
                                {isPartialPayment ? (
                                    <div className="p-4 rounded-xl bg-red-50 border border-red-200 animate-in zoom-in-95">
                                        <p className="text-xs text-red-600 uppercase font-bold">Saldo Deudor (Cta Cte)</p>
                                        <p className="text-2xl font-black text-red-600">$ {debtValue.toLocaleString('es-AR', {maximumFractionDigits: 2})}</p>
                                        {!isClientRegistered && (
                                            <div className="mt-3 text-[10px] text-red-600 font-bold bg-white/60 p-2 rounded border border-red-100 flex gap-2 items-start leading-tight">
                                                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                                                <span>ERROR: REQUIERE CLIENTE REGISTRADO</span>
                                            </div>
                                        )}
                                    </div>
                                ) : changeValue > 0 ? (
                                    <div className="p-4 rounded-xl bg-green-100 border border-green-200 animate-in zoom-in-95 shadow-sm">
                                        <p className="text-xs text-green-800 uppercase font-bold">Su Vuelto</p>
                                        <p className="text-3xl font-black text-green-800">$ {changeValue.toLocaleString('es-AR', {maximumFractionDigits: 2})}</p>
                                    </div>
                                ) : null}
                            </>
                        )}
                    </div>
                </div>

                {/* 🔵 COLUMNA DERECHA: SELECCIÓN DE MÉTODO */}
                <div className="flex-1 p-8 flex flex-col bg-white">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h3 className="font-bold text-xl text-sys-900 uppercase">Medio de Pago</h3>
                            <p className="text-xs text-sys-500 uppercase font-bold opacity-60">Sucursal: {user?.activeBranchName}</p>
                        </div>
                        <button onClick={handleCloseAttempt} className="p-2 hover:bg-sys-100 rounded-full transition text-sys-500">
                            <X size={24} />
                        </button>
                    </div>

                    <div className="grid grid-cols-4 gap-3 mb-6">
                        <PaymentOption id="cash" label="Efectivo" icon={Banknote} colorClass="brand" shortcut="F1" />
                        <PaymentOption id="transfer" label="Transfer" icon={Landmark} colorClass="purple-600" shortcut="F2" />
                        <PaymentOption id="mercadopago" label="MP QR" icon={QrCode} colorClass="blue-500" />
                        <PaymentOption id="point" label="MP Point" icon={CreditCard} colorClass="blue-600" />
                        <PaymentOption id="clover" label="Clover" icon={Terminal} colorClass="green-600" /> 
                    </div>

                    <div className="flex-1 flex flex-col justify-center items-center text-center min-h-[150px] bg-sys-50 rounded-2xl border-2 border-dashed border-sys-200 p-6">
                        {method === 'transfer' && (
                            <div className="w-full max-w-sm animate-in fade-in">
                                <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 mb-4 shadow-sm">
                                    <Landmark size={32} className="mx-auto text-purple-500 mb-2"/>
                                    <p className="text-sm font-bold text-purple-900">{ACCOUNT_DATA.alias}</p>
                                    <p className="text-xs text-purple-600">{ACCOUNT_DATA.bank}</p>
                                </div>
                                <input ref={transferRef} type="text" className="w-full bg-white border border-sys-300 rounded-xl px-4 py-3 text-sm outline-none focus:border-purple-500 text-center font-bold uppercase" placeholder="Nro de Comprobante" value={reference} onChange={(e) => setReference(e.target.value)} onKeyDown={handleKeyDown} />
                            </div>
                        )}

                        {(method === 'mercadopago' || method === 'point' || method === 'clover') && (
                            <div className="w-full max-w-xs animate-in fade-in">
                                {digitalState === 'creating' && <><Loader2 size={48} className="animate-spin text-sys-300 mx-auto mb-4"/><p className="text-sys-500 font-bold uppercase text-xs">Iniciando Terminal...</p></>}
                                {digitalState === 'waiting' && (
                                    <>
                                        <div className="w-20 h-20 bg-brand/10 rounded-full flex items-center justify-center mx-auto text-brand mb-4 animate-pulse">
                                            {method === 'point' ? <CreditCard size={40}/> : <QrCode size={40}/>}
                                        </div>
                                        <h4 className="text-lg font-black text-sys-900 uppercase">Esperando Pago...</h4>
                                        <p className="text-[10px] text-sys-500 mt-2 bg-white px-3 py-1 rounded-full border border-sys-100 uppercase font-black">
                                            ID: {method === 'point' ? assignedHardware.pointId : assignedHardware.qrId}
                                        </p>
                                    </>
                                )}
                                {digitalState === 'approved' && (
                                    <div className="animate-in zoom-in duration-300"><div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto text-green-600 mb-4"><CheckCircle2 size={48} /></div><h4 className="text-xl font-black text-green-600 uppercase">¡PAGO APROBADO!</h4></div>
                                )}
                                {digitalState === 'error' && (
                                    <div className="text-red-500 bg-red-50 p-5 rounded-2xl border border-red-100">
                                        <AlertCircle size={40} className="mx-auto mb-2"/><p className="font-bold text-sm uppercase mb-3">{errorMessage}</p>
                                        <Button variant="ghost" size="sm" onClick={() => setMethod('cash')} className="bg-white border border-red-200 text-red-700 hover:bg-red-50 text-[10px] font-black uppercase">Cambiar a Efectivo</Button>
                                    </div>
                                )}
                            </div>
                        )}

                        {method === 'cash' && (
                            <div className="text-sys-300 flex flex-col items-center opacity-40">
                                <Wallet size={60} strokeWidth={1}/><p className="text-xs font-black uppercase tracking-[0.2em] mt-2">Operación en Efectivo</p>
                            </div>
                        )}
                    </div>

                    <div className="mt-4 pt-4 border-t border-sys-100">
                        {!disableAfip && (
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <div className={cn("p-2 rounded-lg transition-colors", withAfip ? "bg-blue-50 text-brand" : "bg-sys-50 text-sys-400")}>
                                        <ShieldCheck size={20} />
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-sys-800 uppercase">Facturación AFIP</p>
                                        <p className="text-[10px] text-sys-500 leading-none">{withAfip ? "Solicitar CAE" : "Ticket interno (X)"}</p>
                                    </div>
                                </div>
                                <Switch checked={withAfip} onCheckedChange={handleAfipChange} />
                            </div>
                        )}

                        {(method === 'cash' || method === 'transfer') && (
                            <Button 
                                onClick={handleManualConfirm}
                                disabled={!canConfirm}
                                className={cn(
                                    "w-full py-4 text-lg font-black uppercase transition-all shadow-xl", 
                                    !canConfirm ? "opacity-50 cursor-not-allowed bg-sys-400" : 
                                    method === 'transfer' ? "bg-purple-600 hover:bg-purple-700 shadow-purple-500/20" : "shadow-brand/20"
                                )}
                            >
                                {isPartialPayment ? "Confirmar Pago Parcial" : "Finalizar Venta (Enter)"} 
                                <ArrowRight size={20} className="ml-2"/>
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};