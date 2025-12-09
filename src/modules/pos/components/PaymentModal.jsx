import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Banknote, QrCode, LayoutGrid, Loader2, CheckCircle2, 
  AlertCircle, FileText, Wallet, ArrowRight, CreditCard, Landmark 
} from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { Switch } from '../../../core/ui/Switch';
import { cn } from '../../../core/utils/cn';
import { paymentService } from '../../payments/services/paymentService';

// 🔥 CONFIG: disableAfip = true (Oculto por defecto para este cliente)
export const PaymentModal = ({ isOpen, onClose, total, client, onConfirm, disableAfip = true }) => {
  // ==========================================
  // ESTADOS Y REFS
  // ==========================================
  const [method, setMethod] = useState('cash'); 
  const [amountToPay, setAmountToPay] = useState(''); 
  const [reference, setReference] = useState(''); 
  
  // 🔥 ESTADOS PARA EL FLUJO DIGITAL (Polling) - (Inactivos en esta versión)
  const [digitalState, setDigitalState] = useState('idle'); 
  const [paymentReference, setPaymentReference] = useState(null);
  
  // Refs
  const pollingRef = useRef(null);
  const cashInputRef = useRef(null);
  const transferRef = useRef(null);

  // ID Terminal (Configuración futura)
  const POINT_DEVICE_ID = "PAX_00000000"; 

  // Estado AFIP
  const [withAfip, setWithAfip] = useState(false);

  // Datos Cuenta para Transferencia
  const ACCOUNT_DATA = {
      alias: "MAXIKIOSCO.ESQUINA",
      bank: "MercadoPago / Naranja X"
  };

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

  // 1. Inicialización
  useEffect(() => {
    if (isOpen) {
      setMethod('cash');
      // Redondeo explícito para UX limpia
      setAmountToPay(Math.round(total).toString());
      setReference('');
      setDigitalState('idle');
      setPaymentReference(null);
      setWithAfip(false);
      
      // Auto-focus
      setTimeout(() => {
        if (cashInputRef.current) {
            cashInputRef.current.focus();
            cashInputRef.current.select();
        }
      }, 50);
    } else {
        if (pollingRef.current) clearInterval(pollingRef.current);
    }
  }, [isOpen, total, disableAfip]);

  // 🔥 ATAJOS DE TECLADO (F1 / F2)
  useEffect(() => {
    const handleKeys = (e) => {
        if (!isOpen) return;
        
        if (e.key === 'F1') {
            e.preventDefault();
            setMethod('cash');
            if (!amountToPay || method !== 'cash') {
                 setAmountToPay(Math.round(total).toString());
            }
            setTimeout(() => {
                cashInputRef.current?.focus();
                cashInputRef.current?.select();
            }, 50);
        }
        
        if (e.key === 'F2') {
            e.preventDefault();
            setMethod('transfer');
            setAmountToPay(Math.round(total).toString()); 
            setTimeout(() => {
                transferRef.current?.focus();
            }, 50);
        }
    };
    
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [isOpen, total, amountToPay, method]);


  // 2. LÓGICA DIGITAL (Mantenida pero inactiva si no hay botones)
  useEffect(() => {
    if (isOpen && (method === 'mercadopago' || method === 'clover' || method === 'point')) {
      const startTransaction = async () => {
        setDigitalState('creating');
        try {
          const deviceId = method === 'point' ? POINT_DEVICE_ID : null;
          const res = await paymentService.initTransaction(method, total, deviceId);
          setPaymentReference(res.reference);
          setDigitalState('waiting'); 
        } catch (error) {
          console.error(`Error iniciando ${method}:`, error);
          setDigitalState('error');
        }
      };
      startTransaction();
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current);
      setDigitalState('idle');
    }
  }, [isOpen, method, total]);

  // 3. POLLING (Inactivo si no se entra en flujo digital)
  useEffect(() => {
    if (digitalState === 'waiting' && paymentReference) {
      const checkPayment = async () => {
        try {
            const res = await paymentService.checkStatus(paymentReference, method);
            if (res.status === 'approved') {
                setDigitalState('approved');
                clearInterval(pollingRef.current);
                setTimeout(() => {
                    onConfirm({ method, totalSale: total, amountPaid: total, amountDebt: 0, withAfip });
                }, 1500);
            } else if (res.status === 'error' || res.status === 'rejected' || res.status === 'canceled') {
                if (res.status !== 'error') { 
                    setDigitalState('error');
                    clearInterval(pollingRef.current);
                }
            }
        } catch (e) { console.error(e); }
      };
      pollingRef.current = setInterval(checkPayment, 3000);
      return () => clearInterval(pollingRef.current);
    }
  }, [digitalState, paymentReference, method, total, withAfip, onConfirm]);

  // 4. Confirmación Manual
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
    if (e.key === 'Escape') onClose();
  };

  if (!isOpen) return null;

  const PaymentOption = ({ id, label, icon: Icon, colorClass, shortcut }) => (
    <button 
        onClick={() => setMethod(id)} 
        disabled={digitalState !== 'idle' && digitalState !== 'error'} 
        className={cn(
            "flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all duration-200 h-28 relative overflow-hidden active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed group", 
            method === id ? `bg-sys-50 border-${colorClass} shadow-md` : "bg-white border-sys-100 hover:border-sys-300 text-sys-500"
        )}
    >
      <div className="absolute top-2 right-3 text-[10px] font-mono text-sys-400 opacity-50 group-hover:opacity-100 font-bold border border-sys-200 px-1.5 rounded">{shortcut}</div>
      <Icon size={32} className={cn("mb-2 transition-colors", method === id ? `text-${colorClass}` : "text-sys-400")} />
      <span className={cn("font-bold text-sm leading-tight", method === id ? "text-sys-900" : "")}>{label}</span>
      {method === id && <div className={`absolute top-3 left-3 w-2.5 h-2.5 rounded-full bg-${colorClass}`}></div>}
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

             {/* INPUT MONTO (Visible en Cash/Transfer) */}
             {(method === 'cash' || method === 'transfer') && (
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

        {/* COLUMNA DERECHA: MÉTODOS */}
        <div className="flex-1 p-8 flex flex-col bg-white">
          <div className="flex justify-between items-center mb-6">
            <div>
                <h3 className="font-bold text-xl text-sys-900">Método de Pago</h3>
                <p className="text-xs text-sys-500">
                    Seleccione la forma de cobro
                </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-sys-100 rounded-full transition text-sys-500">
              <X size={24} />
            </button>
          </div>

          {/* GRID DE BOTONES: Solo 2 Columnas (Efectivo y Transfer) */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <PaymentOption id="cash" label="Efectivo" icon={Banknote} colorClass="brand" shortcut="F1" />
            <PaymentOption id="transfer" label="Transferencia" icon={Landmark} colorClass="purple-600" shortcut="F2" />
            
            {/* 🔥 OPCIONES DIGITALES OCULTAS PARA ESTE CLIENTE
            <PaymentOption id="mercadopago" label="MP QR" icon={QrCode} colorClass="blue-500" />
            <PaymentOption id="point" label="Tarjeta" icon={CreditCard} colorClass="blue-600" />
            <PaymentOption id="clover" label="Clover" icon={LayoutGrid} colorClass="green-600" />
            */}
          </div>

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
                        placeholder="Nro. Comprobante / Referencia (Opcional)"
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        onKeyDown={handleKeyDown}
                      />
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
             
             {/* Switch AFIP (Solo si está habilitado) */}
             {!disableAfip && (
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
             )}

             {/* Botón Confirmar */}
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
          </div>

        </div>
      </div>
    </div>
  );
};