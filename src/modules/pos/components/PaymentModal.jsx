import React, { useState, useEffect, useRef } from 'react';
import { 
    X, Banknote, QrCode, Loader2, CheckCircle2, 
    AlertCircle, FileText, Wallet, ArrowRight, CreditCard, Landmark, Terminal 
} from 'lucide-react';
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
    
    // Configuración Local de Terminales (QR / Point / Clover)
    const [localTerminal, setLocalTerminal] = useState({ qrId: null, pointId: null });

    // Estado del Flujo Digital
    const [digitalState, setDigitalState] = useState('idle'); // idle | creating | waiting | approved | error
    const [paymentReference, setPaymentReference] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);
    
    // Refs
    const pollingRef = useRef(null);
    const cashInputRef = useRef(null);
    const transferRef = useRef(null);

    // Hooks
    const { user } = useAuthStore(); 

    // Estado AFIP
    const [withAfip, setWithAfip] = useState(false);

    // Datos Cuenta para Transferencia (Hardcoded o desde Config Global)
    const ACCOUNT_DATA = {
        alias: "MAXIKIOSCO.ESQUINA",
        bank: "MercadoPago / Naranja X"
    };

    // ==========================================
    // CÁLCULOS FINANCIEROS
    // ==========================================
    const payValue = parseFloat(amountToPay || 0); 
    const difference = total - payValue; 
    
    // Si paga de menos, es deuda (cta cte). Si paga de más, es vuelto.
    const debtValue = difference > 0.5 ? difference : 0; 
    const changeValue = difference < -0.5 ? Math.abs(difference) : 0; // Tolerancia de 50 centavos
    
    const isPartialPayment = debtValue > 0;
    const isClientRegistered = client && client.id; 
    
    // Validaciones de Negocio
    const hasError = isPartialPayment && !isClientRegistered; // No se puede fiar a anónimos
    const canConfirm = !hasError && payValue >= 0 && amountToPay !== ''; 

    // ==========================================
    // EFECTOS Y LÓGICA
    // ==========================================
    
    const handleAfipChange = (checked) => {
        setWithAfip(checked);
    };

    // 1. Cargar Configuración Local al Abrir
    useEffect(() => {
        if (isOpen) {
            try {
                const savedConfig = localStorage.getItem('NOAR_TERMINAL_CONFIG');
                if (savedConfig) {
                    const parsed = JSON.parse(savedConfig);
                    if (parsed && typeof parsed === 'object') {
                        setLocalTerminal(parsed);
                    }
                } else {
                    console.warn("⚠️ No hay caja configurada en este navegador.");
                }
            } catch (e) {
                console.error("Error leyendo configuración de terminal:", e);
            }
        }
    }, [isOpen]);

    // 2. Reset de Estado al Abrir/Cerrar
    useEffect(() => {
        if (isOpen) {
            setMethod('cash');
            setAmountToPay(Math.round(total).toString());
            setReference('');
            
            // Reset Digital
            setDigitalState('idle');
            setPaymentReference(null);
            setErrorMessage(null);
            if (pollingRef.current) clearInterval(pollingRef.current);

            setWithAfip(false);
            
            // Auto-foco en efectivo
            setTimeout(() => {
                if (cashInputRef.current) {
                    cashInputRef.current.focus();
                    cashInputRef.current.select();
                }
            }, 100);
        } else {
            // Limpieza al cerrar
            if (pollingRef.current) clearInterval(pollingRef.current);
            setDigitalState('idle'); 
        }
    }, [isOpen, total]);

    // 3. Inicio de Transacción Digital (MP / Point / Clover)
    useEffect(() => {
        if (isOpen) {
            if (method === 'mercadopago' || method === 'point') {
                const startTransaction = async () => {
                    setDigitalState('creating');
                    setErrorMessage(null);
                    
                    try {
                        const targetDeviceId = method === 'point' 
                            ? localTerminal.pointId 
                            : localTerminal.qrId;

                        if (!targetDeviceId) {
                            throw new Error(method === 'point' 
                                ? "Falta configurar Terminal Point en este equipo." 
                                : "Falta configurar Caja QR en este equipo.");
                        }

                        const res = await paymentService.initTransaction(method, total, targetDeviceId);
                        
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
            else if (method === 'clover') {
                const handleCloverPayment = async () => {
                    setDigitalState('creating');
                    setErrorMessage(null);
                    
                    try {
                        const externalId = `pos-${Date.now()}`;
                        const response = await fetch(`${API_URL}/create-clover-order`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                total: total,
                                companyId: user.companyId,
                                externalId: externalId
                            })
                        });

                        const result = await response.json();

                        if (response.ok && result.success) {
                            setDigitalState('approved');
                            setTimeout(() => {
                                onConfirm({ 
                                    method: 'card', 
                                    totalSale: total, 
                                    amountPaid: total, 
                                    amountDebt: 0, 
                                    withAfip,
                                    reference: result.paymentId 
                                });
                            }, 1500);
                        } else {
                            console.error("Clover Error:", result);
                            setDigitalState('error');
                            setErrorMessage(result.error || "Clover rechazó la operación");
                        }
                    } catch (error) {
                        console.error("Error Conexión Clover:", error);
                        setDigitalState('error');
                        setErrorMessage("No se pudo conectar con Clover");
                    }
                };
                handleCloverPayment();
            } 
            else {
                // Si cambiamos a efectivo/transferencia, matamos el polling anterior
                if (pollingRef.current) clearInterval(pollingRef.current);
            }
        }
    }, [method, isOpen, total, user, localTerminal]); 

    // 4. Polling de Estado (Solo para MP/Point)
    useEffect(() => {
        if (digitalState === 'waiting' && paymentReference && (method === 'mercadopago' || method === 'point')) {
            const checkPayment = async () => {
                try {
                    const res = await paymentService.checkStatus(paymentReference, method);
                    
                    if (res.status === 'approved') {
                        setDigitalState('approved');
                        clearInterval(pollingRef.current);
                        
                        setTimeout(() => {
                            onConfirm({ 
                                method, 
                                totalSale: total, 
                                amountPaid: total, 
                                amountDebt: 0, 
                                withAfip 
                            });
                        }, 1500);
                    } else if (res.status === 'error' || res.status === 'rejected' || res.status === 'canceled') {
                        if (res.status !== 'error') { // Ignorar errores transitorios de red
                            setDigitalState('error');
                            setErrorMessage("Pago rechazado o cancelado");
                            clearInterval(pollingRef.current);
                        }
                    }
                } catch (e) { console.error("Polling error:", e); }
            };
            
            pollingRef.current = setInterval(checkPayment, 3000);
            return () => clearInterval(pollingRef.current);
        }
    }, [digitalState, paymentReference, method, total, withAfip, onConfirm]);

    // 5. Handlers de Cierre
    const handleCloseAttempt = () => {
        if (digitalState === 'waiting' || digitalState === 'creating') {
            const confirmCancel = window.confirm(
                "⚠️ ¿CANCELAR PAGO EN PROCESO?\n\n" +
                "Se está esperando respuesta de la terminal.\n" +
                "Asegúrese de que el cliente NO haya pagado antes de cancelar.\n\n" +
                "¿Desea abortar la operación?"
            );

            if (confirmCancel) {
                if (pollingRef.current) clearInterval(pollingRef.current);
                setDigitalState('idle'); 
                setMethod('cash'); 
                // No cerramos el modal, solo volvemos a efectivo para permitir reintentar
            }
        } else {
            onClose();
        }
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

    // Componente Botón Método
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
                        {/* Tarjeta de Total */}
                        <div className="bg-white p-4 rounded-xl border border-sys-200 shadow-sm">
                            <p className="text-xs text-sys-500 uppercase font-bold">
                                {disableAfip ? "Monto a Saldar" : "Total Venta"}
                            </p>
                            <p className="text-3xl font-black text-sys-900 tracking-tight">$ {total.toLocaleString('es-AR', {minimumFractionDigits: 0})}</p>
                        </div>

                        {/* Input de Efectivo / Transferencia */}
                        {(method === 'cash' || method === 'transfer' || digitalState === 'error') && (
                            <div className={cn("p-4 rounded-xl border transition-colors ring-offset-2 animate-in slide-in-from-bottom-2", 
                                isPartialPayment ? "bg-orange-50 border-orange-300 ring-orange-100" : 
                                changeValue > 0 ? "bg-green-50 border-green-300 ring-green-100" : "bg-white border-brand ring-brand/10"
                            )}>
                                <p className={cn("text-xs uppercase font-bold mb-1 flex justify-between", 
                                    isPartialPayment ? "text-orange-700" : 
                                    changeValue > 0 ? "text-green-700" : "text-brand"
                                )}>
                                    <span>{isPartialPayment ? "Entrega Parcial" : changeValue > 0 ? "Paga con" : "Monto Exacto"}</span>
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

                        {/* Resultado: Deuda o Vuelto */}
                        {(method === 'cash' || method === 'transfer') && (
                            <>
                                {isPartialPayment ? (
                                    <div className="p-4 rounded-xl bg-red-50 border border-red-200 animate-in zoom-in-95">
                                        <p className="text-xs text-red-600 uppercase font-bold">
                                            {disableAfip ? "Restará Abonar" : "Queda debiendo (Cta Cte)"}
                                        </p>
                                        <p className="text-2xl font-black text-red-600">$ {debtValue.toLocaleString('es-AR', {maximumFractionDigits: 2})}</p>
                                        
                                        {!isClientRegistered && (
                                            <div className="mt-3 text-[10px] text-red-600 font-bold bg-white/60 p-2 rounded border border-red-100 flex gap-2 items-start leading-tight">
                                                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                                                <span>ERROR: Consumidor Final no puede tener deuda. Seleccione un cliente.</span>
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
                            <h3 className="font-bold text-xl text-sys-900">Método de Pago</h3>
                            <p className="text-xs text-sys-500">
                                {method !== 'cash' && method !== 'transfer' ? "Procesamiento Digital Seguro" : "Cobro manual / local"}
                            </p>
                        </div>
                        
                        <button onClick={handleCloseAttempt} className="p-2 hover:bg-sys-100 rounded-full transition text-sys-500">
                            <X size={24} />
                        </button>
                    </div>

                    {/* GRID DE BOTONES */}
                    <div className="grid grid-cols-4 gap-3 mb-6">
                        <PaymentOption id="cash" label="Efectivo" icon={Banknote} colorClass="brand" shortcut="F1" />
                        <PaymentOption id="transfer" label="Transfer" icon={Landmark} colorClass="purple-600" shortcut="F2" />
                        
                        <PaymentOption id="mercadopago" label="MP QR" icon={QrCode} colorClass="blue-500" />
                        <PaymentOption id="point" label="MP Point" icon={CreditCard} colorClass="blue-600" />
                        
                        <PaymentOption id="clover" label="Clover" icon={Terminal} colorClass="green-600" /> 
                    </div>

                    {/* ÁREA DE CONTENIDO DINÁMICO */}
                    <div className="flex-1 flex flex-col justify-center items-center text-center min-h-[150px]">
                        
                        {/* --- MODO TRANSFERENCIA --- */}
                        {method === 'transfer' && (
                            <div className="w-full max-w-sm animate-in fade-in">
                                <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 mb-4 shadow-sm">
                                    <Landmark size={32} className="mx-auto text-purple-500 mb-2"/>
                                    <p className="text-sm font-bold text-purple-900">{ACCOUNT_DATA.alias}</p>
                                    <p className="text-xs text-purple-600">Verifique la recepción antes de confirmar.</p>
                                </div>
                                <input 
                                    ref={transferRef}
                                    type="text" 
                                    className="w-full bg-white border border-sys-300 rounded-xl px-4 py-3 text-sm outline-none focus:border-purple-500 focus:ring-4 focus:ring-purple-500/10 transition-all text-center"
                                    placeholder="Nro. Comprobante (Opcional)"
                                    value={reference}
                                    onChange={(e) => setReference(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                />
                            </div>
                        )}

                        {/* --- ESTADOS DIGITALES (LOADING / ERROR / SUCCESS) --- */}
                        {(method === 'mercadopago' || method === 'clover' || method === 'point') && (
                            <div className="w-full max-w-xs animate-in fade-in">
                                
                                {digitalState === 'creating' && (
                                    <>
                                        <Loader2 size={48} className="animate-spin text-sys-300 mx-auto mb-4"/>
                                        <p className="text-sys-500 font-medium">
                                            {method === 'point' ? 'Conectando con Terminal...' : 
                                             method === 'clover' ? 'Iniciando Clover...' : 'Iniciando transacción segura...'}
                                        </p>
                                        <p className="text-xs text-sys-400 mt-2">
                                            {(method === 'mercadopago' && !localTerminal.qrId) && "⚠️ No hay caja QR configurada"}
                                            {(method === 'point' && !localTerminal.pointId) && "⚠️ No hay terminal Point configurada"}
                                        </p>
                                    </>
                                )}

                                {digitalState === 'waiting' && (
                                    <>
                                        <div className="relative w-24 h-24 mx-auto mb-4">
                                            <div className="absolute inset-0 rounded-full border-4 border-sys-100"></div>
                                            <div className={cn("absolute inset-0 rounded-full border-4 border-t-transparent animate-spin", 
                                                (method === 'mercadopago' || method === 'point') ? "border-blue-500" : "border-green-500")}></div>
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                {method === 'point' ? <CreditCard size={32} className="text-blue-600"/> :
                                                 method === 'mercadopago' ? <QrCode size={32} className="text-blue-500"/> : 
                                                 <Terminal size={32} className="text-green-600"/>} 
                                            </div>
                                        </div>
                                        <h4 className="text-xl font-bold text-sys-900">Esperando Pago...</h4>
                                        <p className="text-sm text-sys-500 mt-2 bg-sys-50 p-2 rounded-lg border border-sys-100">
                                            {method === 'point' ? 'Inserte tarjeta en la terminal Point.' : 
                                             method === 'mercadopago' ? 'Solicite al cliente escanear el QR.' : 
                                             'Opere en la terminal Clover (Tarjeta/QR).'}
                                        </p>
                                    </>
                                )}

                                {digitalState === 'approved' && (
                                    <div className="animate-in zoom-in duration-300 transform scale-110">
                                        <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto text-green-600 mb-4 shadow-lg shadow-green-100">
                                            <CheckCircle2 size={56} />
                                        </div>
                                        <h4 className="text-2xl font-black text-green-600">¡PAGO APROBADO!</h4>
                                        <p className="text-sm text-green-700 font-medium mt-1">Generando ticket...</p>
                                    </div>
                                )}

                                {digitalState === 'error' && (
                                    <div className="text-red-500 bg-red-50 p-6 rounded-2xl border border-red-100">
                                        <AlertCircle size={48} className="mx-auto mb-2"/>
                                        <p className="font-bold text-lg">Error de Conexión</p>
                                        <p className="text-sm opacity-80 mb-4">
                                            {errorMessage || "No se pudo conectar con el proveedor."}
                                        </p>
                                        <Button variant="ghost" size="sm" onClick={() => setMethod('cash')} className="bg-white border border-red-200 text-red-700 hover:bg-red-50">
                                            Cambiar a Efectivo
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* --- MODO EFECTIVO --- */}
                        {method === 'cash' && (
                            <div className="text-sys-300 flex flex-col items-center">
                                <div className="w-24 h-24 rounded-full bg-sys-50 flex items-center justify-center mb-4">
                                    <Wallet size={48} className="opacity-50"/>
                                </div>
                                <p className="text-sm font-medium">Ingrese el monto recibido para calcular vuelto</p>
                            </div>
                        )}
                    </div>

                    {/* FOOTER ACCIONES */}
                    <div className="mt-4 pt-4 border-t border-sys-100">
                        
                        {!disableAfip && (
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <div className={cn("p-2 rounded-lg transition-colors", withAfip ? "bg-blue-50 text-brand" : "bg-sys-50 text-sys-400")}>
                                        <FileText size={20} />
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-sys-800">Facturación AFIP</p>
                                        <p className="text-10px text-sys-500 leading-none">
                                            {withAfip ? "Se solicitará CAE automáticamente" : "Se emitirá ticket interno (X)"}
                                        </p>
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
                                    "w-full py-4 text-lg shadow-xl transition-all", 
                                    !canConfirm ? "opacity-50 cursor-not-allowed bg-sys-400" : 
                                    method === 'transfer' ? "bg-purple-600 hover:bg-purple-700 shadow-purple-500/20" : "shadow-brand/20"
                                )}
                            >
                                {method === 'transfer' ? "Confirmar Transferencia (Enter)" : (isPartialPayment ? "Confirmar Pago Parcial" : "Confirmar Operación (Enter)")} 
                                <ArrowRight size={20} className="ml-2"/>
                            </Button>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
};