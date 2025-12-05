import React, { useState, useEffect, useRef } from 'react';
import { X, Banknote, QrCode, CreditCard, ArrowRight, CheckCircle2, AlertCircle, LayoutGrid, FileText, Wallet } from 'lucide-react';
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
  const [paymentStatus, setPaymentStatus] = useState('idle'); 
  
  // 🔥 REFERENCIA PARA EL INPUT (Focus Control)
  const cashInputRef = useRef(null);

  // Estado AFIP
  const [withAfip, setWithAfip] = useState(() => {
    if (disableAfip) return false;
    return localStorage.getItem('POS_PREF_AFIP') === 'true';
  });

  // ==========================================
  // CÁLCULOS (Elevados para usarlos en validación)
  // ==========================================
  const payValue = parseFloat(amountToPay || 0); 
  const difference = total - payValue; 
  const debtValue = difference > 0.5 ? difference : 0; 
  const changeValue = difference < 0 ? Math.abs(difference) : 0;
  const isPartialPayment = debtValue > 0;
  const isClientRegistered = client && client.id; 
  
  // Validaciones
  const hasError = isPartialPayment && !isClientRegistered;
  const canConfirm = !hasError && payValue >= 0 && amountToPay !== ''; // Debe haber algo escrito

  // ==========================================
  // HANDLERS & EFFECTS
  // ==========================================
  
  const handleAfipChange = (checked) => {
    setWithAfip(checked);
    if (!disableAfip) localStorage.setItem('POS_PREF_AFIP', checked);
  };

  // 1. Inicialización y FOCUS AUTOMÁTICO
  useEffect(() => {
    if (isOpen) {
      setMethod('cash');
      setAmountToPay(total.toString()); // Pre-llenamos con el total
      setPaymentStatus('idle');

      if (disableAfip) setWithAfip(false);
      else setWithAfip(localStorage.getItem('POS_PREF_AFIP') === 'true');

      // 🔥 FOCUS ULTRA-RÁPIDO
      // Pequeño timeout para asegurar que el modal se renderizó
      setTimeout(() => {
        if (cashInputRef.current) {
            cashInputRef.current.focus();
            cashInputRef.current.select(); // Seleccionar todo para sobrescribir fácil
        }
      }, 50);
    }
  }, [isOpen, total, disableAfip]);

  // 2. Manejo de Tecla ENTER
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
        e.preventDefault(); // Evitar comportamientos raros
        if (canConfirm) {
            handleConfirm();
        } else {
            // Feedback sonoro o visual de error (opcional)
            console.warn("Enter presionado pero validación falló");
        }
    }
    // Escape para cerrar (ya lo maneja el listener global de PosPage, pero por seguridad)
    if (e.key === 'Escape') onClose();
  };

  const handleConfirm = () => {
    if (!canConfirm) return;
    
    onConfirm({
      method,
      totalSale: total,
      amountPaid: payValue - changeValue, 
      amountDebt: debtValue, 
      withAfip: withAfip 
    });
  };

  // ... (Integración MP/Clover igual que antes) ...
  useEffect(() => {
    if (isOpen && (method === 'mercadopago' || method === 'clover')) {
      const initTransaction = async () => {
        setPaymentStatus('loading');
        try {
          const montoACobrar = parseFloat(amountToPay) || total;
          await paymentService.processPayment(method, montoACobrar);
          setPaymentStatus('ready');
        } catch (error) {
          console.error(`Error iniciando ${method}:`, error);
          setPaymentStatus('error');
        }
      };
      initTransaction();
    }
  }, [isOpen, method]);

  if (!isOpen) return null;

  const PaymentOption = ({ id, label, icon: Icon, colorClass }) => (
    <button onClick={() => setMethod(id)} className={cn("flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all duration-200 h-24 relative overflow-hidden active:scale-95", method === id ? `bg-sys-50 border-${colorClass} shadow-md` : "bg-white border-sys-100 hover:border-sys-300 text-sys-500")}>
      <Icon size={28} className={cn("mb-1 transition-colors", method === id ? `text-${colorClass}` : "text-sys-400")} />
      <span className={cn("font-semibold text-xs leading-tight", method === id ? "text-sys-900" : "")}>{label}</span>
      {method === id && <div className={`absolute top-2 right-2 w-2 h-2 rounded-full bg-${colorClass}`}></div>}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col md:flex-row min-h-[500px]">
        
        {/* COLUMNA IZQUIERDA */}
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

             {/* 🔥 INPUT DINÁMICO MEJORADO 🔥 */}
             <div className={cn("p-4 rounded-xl border transition-colors ring-offset-2", 
                // Color dinámico del borde según estado
                isPartialPayment ? "bg-orange-50 border-orange-300 ring-orange-100" : 
                changeValue > 0 ? "bg-green-50 border-green-300 ring-green-100" : "bg-white border-brand ring-brand/10"
             )}>
                <p className={cn("text-xs uppercase font-bold mb-1 flex justify-between", 
                    isPartialPayment ? "text-orange-700" : 
                    changeValue > 0 ? "text-green-700" : "text-brand"
                )}>
                    <span>{isPartialPayment ? "Entrega Parcial" : changeValue > 0 ? "Paga con" : "Monto Exacto"}</span>
                    <span className="text-[10px] bg-black/5 px-1.5 rounded">ENTER para confirmar</span>
                </p>
                <div className="relative">
                    <span className="absolute left-0 top-1 text-lg font-bold text-sys-400">$</span>
                    <input 
                        ref={cashInputRef} // 👈 REF CONECTADA
                        type="number" 
                        className="w-full bg-transparent text-3xl font-black outline-none border-b-2 border-sys-300 focus:border-brand p-0 pl-5 text-sys-900 placeholder-sys-300"
                        value={amountToPay}
                        onChange={e => setAmountToPay(e.target.value)}
                        onKeyDown={handleKeyDown} // 👈 LISTENER DE ENTER
                        placeholder={total.toString()}
                    />
                </div>
             </div>

             {/* Resultado: Deuda o Vuelto */}
             {isPartialPayment ? (
                 <div className="p-4 rounded-xl bg-red-50 border border-red-200 animate-in slide-in-from-top-2">
                    <p className="text-xs text-red-600 uppercase font-bold">
                        {disableAfip ? "Restará Abonar" : "Queda debiendo (Cta Cte)"}
                    </p>
                    <p className="text-2xl font-black text-red-600">$ {debtValue.toLocaleString('es-AR', {maximumFractionDigits: 2})}</p>
                    
                    {!isClientRegistered && (
                        <div className="mt-3 text-[10px] text-red-600 font-bold bg-white/60 p-2 rounded border border-red-100 flex gap-2 items-start leading-tight">
                            <AlertCircle size={14} className="shrink-0 mt-0.5" />
                            <span>ERROR: Consumidor Final no puede tener deuda. (F3 Cliente)</span>
                        </div>
                    )}
                 </div>
             ) : changeValue > 0 ? (
                 <div className="p-4 rounded-xl bg-green-100 border border-green-200 animate-in slide-in-from-top-2 shadow-sm">
                    <p className="text-xs text-green-800 uppercase font-bold">Su Vuelto</p>
                    <p className="text-3xl font-black text-green-800">$ {changeValue.toLocaleString('es-AR', {maximumFractionDigits: 2})}</p>
                 </div>
             ) : null}
          </div>
        </div>

        {/* COLUMNA DERECHA ... */}
        <div className="flex-1 p-8 flex flex-col bg-white">
          <div className="flex justify-between items-center mb-6">
            <div>
                <h3 className="font-bold text-xl text-sys-900">Método de Pago</h3>
                <p className="text-xs text-sys-500">
                    {isPartialPayment 
                        ? `Abonando $${payValue.toLocaleString()} de $${total.toLocaleString()}` 
                        : "Pago completo de la operación"
                    }
                </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-sys-100 rounded-full transition text-sys-500">
              <X size={24} />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-6">
            <PaymentOption id="cash" label="Efectivo" icon={Banknote} colorClass="brand" />
            <PaymentOption id="mercadopago" label="Mercado Pago" icon={QrCode} colorClass="blue-500" />
            <PaymentOption id="clover" label="Clover / Tarjeta" icon={LayoutGrid} colorClass="green-600" />
          </div>

          <div className="flex-1 flex flex-col justify-center items-center text-center min-h-[100px]">
             {(method === 'mercadopago' || method === 'clover') ? (
                 <>
                    {paymentStatus === 'loading' && <div className="flex flex-col items-center gap-2"><div className="animate-spin rounded-full h-8 w-8 border-4 border-t-brand border-sys-100"/><p className="text-xs font-medium text-sys-500">Conectando terminal...</p></div>}
                    {paymentStatus === 'ready' && <div className="text-green-600 font-bold flex flex-col items-center animate-in zoom-in"><CheckCircle2 size={40} className="mb-2"/><span>Pago Aprobado</span></div>}
                    {paymentStatus === 'error' && <div className="text-red-500 font-bold flex items-center gap-2"><AlertCircle/> Error de Conexión</div>}
                 </>
             ) : (
                 <div className="text-sys-300 flex flex-col items-center">
                    <Wallet size={40} className="mb-2 opacity-50"/>
                    <p className="text-sm font-medium">Pago en Efectivo</p>
                 </div>
             )}
          </div>

          <div className="mt-4 pt-4 border-t border-sys-100">
             {!disableAfip ? (
                 <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                       <div className={cn("p-2 rounded-lg transition-colors", withAfip ? "bg-blue-50 text-brand" : "bg-sys-50 text-sys-400")}>
                          <FileText size={20} />
                       </div>
                       <div>
                          <p className="text-sm font-bold text-sys-800">Facturación AFIP</p>
                          <p className="text-[10px] text-sys-500 leading-none">
                            {withAfip ? "Se solicitará CAE automáticamente" : "Se emitirá ticket no fiscal (X)"}
                          </p>
                       </div>
                    </div>
                    <Switch checked={withAfip} onCheckedChange={handleAfipChange} />
                 </div>
             ) : (
                 <div className="flex items-center gap-3 mb-4 bg-sys-50 p-3 rounded-xl border border-sys-100">
                    <div className="p-2 bg-white rounded-lg text-sys-400 shadow-sm border border-sys-100"><FileText size={20} /></div>
                    <div>
                        <p className="text-sm font-bold text-sys-800">Recibo de Cobranza X</p>
                        <p className="text-[10px] text-sys-500 leading-tight">Impacta Caja y Cta. Cte.</p>
                    </div>
                 </div>
             )}

             <Button 
                onClick={handleConfirm}
                disabled={!canConfirm}
                className={cn("w-full py-4 text-lg shadow-xl transition-all", !canConfirm ? "opacity-50 cursor-not-allowed bg-sys-400" : "shadow-brand/20")}
             >
                {isPartialPayment ? "Confirmar Pago Parcial" : "Confirmar Operación (Enter)"} <ArrowRight size={20} className="ml-2"/>
             </Button>
          </div>

        </div>
      </div>
    </div>
  );
};