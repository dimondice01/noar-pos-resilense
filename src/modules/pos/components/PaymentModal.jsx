import React, { useState, useEffect, useRef } from 'react';
import { X, Banknote, QrCode, LayoutGrid, Loader2, CheckCircle2, AlertCircle, FileText, Wallet, ArrowRight, CreditCard } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { Switch } from '../../../core/ui/Switch';
import { cn } from '../../../core/utils/cn';
import { paymentService } from '../../payments/services/paymentService';

export const PaymentModal = ({ isOpen, onClose, total, client, onConfirm, disableAfip = false }) => {
  // ==========================================
  // ESTADOS Y REFS
  // ==========================================
  const [method, setMethod] = useState('cash'); 
  const [amountToPay, setAmountToPay] = useState(''); 
  
  // 🔥 ESTADOS PARA EL FLUJO DIGITAL (Polling)
  const [digitalState, setDigitalState] = useState('idle'); // idle | creating | waiting | approved | error
  const [paymentReference, setPaymentReference] = useState(null);
  
  // Ref para controlar el intervalo de sondeo
  const pollingRef = useRef(null);
  const cashInputRef = useRef(null);

  // ID de la terminal física (En producción vendría de config)
  const POINT_DEVICE_ID = "PAX_00000000"; 

  // Estado AFIP
  const [withAfip, setWithAfip] = useState(() => {
    if (disableAfip) return false;
    return localStorage.getItem('POS_PREF_AFIP') === 'true';
  });

  // ==========================================
  // CÁLCULOS
  // ==========================================
  const payValue = parseFloat(amountToPay || 0); 
  const difference = total - payValue; 
  const debtValue = difference > 0.5 ? difference : 0; 
  const changeValue = difference < 0 ? Math.abs(difference) : 0;
  const isPartialPayment = debtValue > 0;
  const isClientRegistered = client && client.id; 
  
  // Validaciones
  const hasError = isPartialPayment && !isClientRegistered;
  const canConfirm = !hasError && payValue >= 0 && amountToPay !== ''; 

  // ==========================================
  // HANDLERS & EFFECTS
  // ==========================================
  
  const handleAfipChange = (checked) => {
    setWithAfip(checked);
    if (!disableAfip) localStorage.setItem('POS_PREF_AFIP', checked);
  };

  // 1. Inicialización y Limpieza
  useEffect(() => {
    if (isOpen) {
      setMethod('cash');
      setAmountToPay(total.toString());
      setDigitalState('idle');
      setPaymentReference(null);

      if (disableAfip) setWithAfip(false);
      else setWithAfip(localStorage.getItem('POS_PREF_AFIP') === 'true');

      // Focus rápido
      setTimeout(() => {
        if (cashInputRef.current) {
            cashInputRef.current.focus();
            cashInputRef.current.select();
        }
      }, 50);
    } else {
        // Limpiar intervalo al cerrar
        if (pollingRef.current) clearInterval(pollingRef.current);
    }
  }, [isOpen, total, disableAfip]);

  // 2. INICIO DE TRANSACCIÓN DIGITAL (Al cambiar método)
  useEffect(() => {
    if (isOpen && (method === 'mercadopago' || method === 'clover' || method === 'point')) {
      const startTransaction = async () => {
        setDigitalState('creating');
        try {
          // Si es Point, pasamos el Device ID
          const deviceId = method === 'point' ? POINT_DEVICE_ID : null;

          // Usamos initTransaction en lugar de processPayment directo
          const res = await paymentService.initTransaction(method, total, deviceId);
          setPaymentReference(res.reference);
          setDigitalState('waiting'); // Pasamos a esperar
        } catch (error) {
          console.error(`Error iniciando ${method}:`, error);
          setDigitalState('error');
        }
      };
      startTransaction();
    } else {
      // Si volvemos a efectivo, cancelamos el polling
      if (pollingRef.current) clearInterval(pollingRef.current);
      setDigitalState('idle');
    }
  }, [isOpen, method, total]);

  // 3. LOOP DE POLLING (Escucha activa)
  useEffect(() => {
    if (digitalState === 'waiting' && paymentReference) {
      
      const checkPayment = async () => {
        const res = await paymentService.checkStatus(paymentReference, method);
        console.log(`📡 Estado ${method}:`, res.status);
        
        if (res.status === 'approved') {
          setDigitalState('approved');
          clearInterval(pollingRef.current);
          
          // ✨ AUTO-FINALIZAR (Magia UX)
          setTimeout(() => {
             onConfirm({
                method,
                totalSale: total,
                amountPaid: total, // Digital siempre es total
                amountDebt: 0,
                withAfip
             });
          }, 1500);
        } else if (res.status === 'error' || res.status === 'rejected' || res.status === 'canceled') {
             // Si fue rechazado explícitamente o cancelado
             if (res.status !== 'error') { // 'error' es de red, seguimos intentando
                 setDigitalState('error');
                 clearInterval(pollingRef.current);
             }
        }
      };

      // Consultar cada 3 segundos
      pollingRef.current = setInterval(checkPayment, 3000);

      return () => clearInterval(pollingRef.current);
    }
  }, [digitalState, paymentReference, method, total, withAfip, onConfirm]);

  // 4. Manejo Manual (Efectivo)
  const handleManualConfirm = () => {
    if (!canConfirm) return;
    onConfirm({
      method,
      totalSale: total,
      amountPaid: payValue - changeValue, 
      amountDebt: debtValue, 
      withAfip
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (canConfirm) handleManualConfirm();
    }
    if (e.key === 'Escape') onClose();
  };

  if (!isOpen) return null;

  const PaymentOption = ({ id, label, icon: Icon, colorClass }) => (
    <button 
        onClick={() => setMethod(id)} 
        disabled={digitalState !== 'idle' && digitalState !== 'error'} // Bloquear cambios si está procesando
        className={cn(
            "flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all duration-200 h-24 relative overflow-hidden active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed", 
            method === id ? `bg-sys-50 border-${colorClass} shadow-md` : "bg-white border-sys-100 hover:border-sys-300 text-sys-500"
        )}
    >
      <Icon size={28} className={cn("mb-1 transition-colors", method === id ? `text-${colorClass}` : "text-sys-400")} />
      <span className={cn("font-semibold text-xs leading-tight", method === id ? "text-sys-900" : "")}>{label}</span>
      {method === id && <div className={`absolute top-2 right-2 w-2 h-2 rounded-full bg-${colorClass}`}></div>}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col md:flex-row min-h-[500px]">
        
        {/* COLUMNA IZQUIERDA: RESUMEN */}
        <div className="w-full md:w-1/3 bg-sys-50 p-6 flex flex-col justify-between border-r border-sys-200">
          <div>
            <h3 className="font-bold text-sys-800 text-lg mb-1">
                {disableAfip ? "Cobranza de Deuda" : "Total a Cobrar"}
            </h3>
            <p className="text-sys-500 text-sm">Resumen de la operación</p>
          </div>

          <div className="space-y-4 flex-1 mt-6">
             {/* Total */}
             <div className="bg-white p-4 rounded-xl border border-sys-200 shadow-sm">
                <p className="text-xs text-sys-500 uppercase font-bold">
                    {disableAfip ? "Monto a Saldar" : "Total Venta"}
                </p>
                <p className="text-3xl font-black text-sys-900 tracking-tight">$ {total.toLocaleString('es-AR', {minimumFractionDigits: 0})}</p>
             </div>

             {/* INPUT EFECTIVO (Solo visible si es Cash o Error Digital) */}
             {(method === 'cash' || digitalState === 'error') && (
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
                            placeholder={total.toString()}
                        />
                    </div>
                 </div>
             )}

             {/* Resultado: Deuda o Vuelto */}
             {method === 'cash' && (
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
                                    <span>ERROR: Consumidor Final no puede tener deuda.</span>
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

        {/* COLUMNA DERECHA: MÉTODOS Y ESTADO DIGITAL */}
        <div className="flex-1 p-8 flex flex-col bg-white">
          <div className="flex justify-between items-center mb-6">
            <div>
                <h3 className="font-bold text-xl text-sys-900">Método de Pago</h3>
                <p className="text-xs text-sys-500">
                    {method !== 'cash' ? "Procesamiento Digital Seguro" : "Cobro tradicional en efectivo"}
                </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-sys-100 rounded-full transition text-sys-500">
              <X size={24} />
            </button>
          </div>

          {/* GRID DE BOTONES - AHORA CON POINT */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            <PaymentOption id="cash" label="Efectivo" icon={Banknote} colorClass="brand" />
            <PaymentOption id="mercadopago" label="MP QR" icon={QrCode} colorClass="blue-500" />
            {/* 🔥 Opción Point */}
            <PaymentOption id="point" label="Tarjeta Point" icon={CreditCard} colorClass="blue-600" />
            <PaymentOption id="clover" label="Clover (Sim)" icon={LayoutGrid} colorClass="green-600" />
          </div>

          <div className="flex-1 flex flex-col justify-center items-center text-center min-h-[150px]">
             
             {/* --- ESTADOS DIGITALES --- */}
             {(method === 'mercadopago' || method === 'clover' || method === 'point') ? (
                 <div className="w-full max-w-xs animate-in fade-in">
                    
                    {digitalState === 'creating' && (
                        <>
                           <Loader2 size={48} className="animate-spin text-sys-300 mx-auto mb-4"/>
                           <p className="text-sys-500 font-medium">
                               {method === 'point' ? 'Conectando con Terminal...' : 'Iniciando transacción segura...'}
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
                                  method === 'mercadopago' ? <QrCode size={32} className="text-blue-500"/> : <LayoutGrid size={32} className="text-green-600"/>}
                              </div>
                           </div>
                           <h4 className="text-xl font-bold text-sys-900">Esperando Pago...</h4>
                           <p className="text-sm text-sys-500 mt-2 bg-sys-50 p-2 rounded-lg border border-sys-100">
                              {method === 'point' ? 'Inserte tarjeta en la terminal Point.' : 
                               method === 'mercadopago' ? 'Solicite al cliente escanear el QR.' : 'Opere en la terminal Clover.'}
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
                               {method === 'point' ? 'No se encontró terminal física o fue rechazada.' : 'No se pudo conectar con el proveedor.'}
                           </p>
                           <Button variant="ghost" size="sm" onClick={() => setMethod('cash')} className="bg-white border border-red-200 text-red-700 hover:bg-red-50">
                              Cambiar a Efectivo
                           </Button>
                        </div>
                    )}
                 </div>
             ) : (
                 /* --- ESTADO CASH --- */
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
             {!disableAfip && method === 'cash' ? (
                 <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                       <div className={cn("p-2 rounded-lg transition-colors", withAfip ? "bg-blue-50 text-brand" : "bg-sys-50 text-sys-400")}>
                          <FileText size={20} />
                       </div>
                       <div>
                          <p className="text-sm font-bold text-sys-800">Facturación AFIP</p>
                          <p className="text-[10px] text-sys-500 leading-none">
                            {withAfip ? "Se solicitará CAE automáticamente" : "Se emitirá ticket interno (X)"}
                          </p>
                       </div>
                    </div>
                    <Switch checked={withAfip} onCheckedChange={handleAfipChange} />
                 </div>
             ) : null}

             {/* Botón Confirmar SOLO para Efectivo (Digital es auto) */}
             {method === 'cash' && (
                <Button 
                   onClick={handleManualConfirm}
                   disabled={!canConfirm}
                   className={cn("w-full py-4 text-lg shadow-xl transition-all", !canConfirm ? "opacity-50 cursor-not-allowed bg-sys-400" : "shadow-brand/20")}
                >
                   {isPartialPayment ? "Confirmar Pago Parcial" : "Confirmar Operación (Enter)"} <ArrowRight size={20} className="ml-2"/>
                </Button>
             )}
          </div>

        </div>
      </div>
    </div>
  );
};