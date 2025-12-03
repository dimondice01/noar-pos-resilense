import React, { useState, useEffect } from 'react';
import { X, Banknote, QrCode, CreditCard, ArrowRight, CheckCircle2, AlertCircle, LayoutGrid, FileText } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { Switch } from '../../../core/ui/Switch'; // Asegúrate de tener este componente
import { cn } from '../../../core/utils/cn';
import { paymentService } from '../../payments/services/paymentService';

export const PaymentModal = ({ isOpen, onClose, total, onConfirm }) => {
  // ==========================================
  // ESTADOS
  // ==========================================
  const [method, setMethod] = useState('cash'); // 'cash' | 'mercadopago' | 'clover' | 'card'
  const [cashAmount, setCashAmount] = useState('');
  
  // Estado para pagos digitales (MP / Clover)
  const [paymentStatus, setPaymentStatus] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'error'

  // 🔥 ESTADO AFIP (Recupera la preferencia del usuario)
  const [withAfip, setWithAfip] = useState(() => {
    return localStorage.getItem('POS_PREF_AFIP') === 'true';
  });

  // ==========================================
  // HANDLERS
  // ==========================================
  
  // Guardar preferencia de AFIP
  const handleAfipChange = (checked) => {
    setWithAfip(checked);
    localStorage.setItem('POS_PREF_AFIP', checked);
  };

  // Reiniciar estados al abrir
  useEffect(() => {
    if (isOpen) {
      setMethod('cash');
      setCashAmount('');
      setPaymentStatus('idle');
      // No reseteamos withAfip para mantener la preferencia
    }
  }, [isOpen]);

  // Disparar cobro automático para MP y Clover
  useEffect(() => {
    if (isOpen && (method === 'mercadopago' || method === 'clover')) {
      const initTransaction = async () => {
        setPaymentStatus('loading');
        try {
          // Llamada al servicio unificado
          await paymentService.processPayment(method, total);
          setPaymentStatus('ready');
        } catch (error) {
          console.error(`Error iniciando ${method}:`, error);
          setPaymentStatus('error');
        }
      };
      initTransaction();
    }
  }, [isOpen, method, total]);

  if (!isOpen) return null;

  // Cálculos
  const receivedVal = parseFloat(cashAmount || 0);
  const change = method === 'cash' ? (receivedVal - total) : 0;
  const isSufficient = method !== 'cash' || (receivedVal >= total);

  // CONFIRMACIÓN FINAL
  const handleConfirm = () => {
    if (!isSufficient) return;
    
    onConfirm({
      method,
      amount: total,
      received: method === 'cash' ? receivedVal : total,
      change: change > 0 ? change : 0,
      withAfip: withAfip // 🔥 Enviamos la decisión de AFIP
    });
  };

  const PaymentOption = ({ id, label, icon: Icon, colorClass }) => (
    <button
      onClick={() => setMethod(id)}
      className={cn(
        "flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all duration-200 h-28 relative overflow-hidden active:scale-95",
        method === id 
          ? `bg-sys-50 border-${colorClass} shadow-md` 
          : "bg-white border-sys-100 hover:border-sys-300 hover:bg-sys-50 text-sys-500"
      )}
    >
      <Icon size={32} className={cn("mb-2 transition-colors", method === id ? `text-${colorClass}` : "text-sys-400")} />
      <span className={cn("font-semibold text-sm leading-tight", method === id ? "text-sys-900" : "")}>
        {label}
      </span>
      {method === id && (
        <div className={`absolute top-2 right-2 w-3 h-3 rounded-full bg-${colorClass}`}></div>
      )}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col md:flex-row min-h-[500px]">
        
        {/* COLUMNA IZQUIERDA: Resumen */}
        <div className="w-full md:w-1/3 bg-sys-50 p-6 flex flex-col justify-between border-r border-sys-200">
          <div>
            <h3 className="font-bold text-sys-800 text-lg mb-1">Total a Cobrar</h3>
            <p className="text-sys-500 text-sm">Resumen de la operación</p>
          </div>

          <div className="text-center my-8">
            <span className="text-4xl font-bold text-sys-900 tracking-tight">
              $ {total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            </span>
          </div>

          <div className="space-y-4">
             {method === 'cash' && (
               <div className={cn(
                 "p-4 rounded-xl text-center transition-all duration-300", 
                 change >= 0 
                    ? "bg-green-100 text-green-800 border border-green-200 shadow-sm" 
                    : "bg-red-50 text-red-600 border border-red-100"
               )}>
                  <p className="text-xs font-bold uppercase tracking-wider mb-1 opacity-70">
                    {change >= 0 ? 'Vuelto a entregar' : 'Falta Abonar'}
                  </p>
                  <p className="text-2xl font-bold">
                    $ {Math.abs(change).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </p>
               </div>
             )}
          </div>
        </div>

        {/* COLUMNA DERECHA: Selección */}
        <div className="flex-1 p-8 flex flex-col bg-white">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-xl text-sys-900">Método de Pago</h3>
            <button onClick={onClose} className="p-2 hover:bg-sys-100 rounded-full transition text-sys-500">
              <X size={24} />
            </button>
          </div>

          {/* Grid de Métodos */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <PaymentOption id="cash" label="Efectivo" icon={Banknote} colorClass="brand" />
            <PaymentOption id="mercadopago" label="MercadoPago" icon={QrCode} colorClass="blue-500" />
            <PaymentOption id="clover" label="Clover POS" icon={LayoutGrid} colorClass="green-600" />
          </div>

          {/* Área Dinámica */}
          <div className="flex-1 relative min-h-[140px]">
            
            {/* INPUT EFECTIVO */}
            {method === 'cash' && (
              <div className="animate-in slide-in-from-bottom-2 fade-in duration-300 absolute inset-0">
                <label className="block text-sm font-medium text-sys-600 mb-2">Dinero Recibido</label>
                <div className="relative group">
                  <span className="absolute left-4 top-4 text-sys-400 text-xl font-medium">$</span>
                  <input 
                    type="number" 
                    autoFocus
                    value={cashAmount}
                    onChange={(e) => setCashAmount(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 text-2xl font-bold border-b-2 border-sys-200 focus:border-brand outline-none bg-transparent transition-colors text-sys-900 placeholder-sys-200"
                    placeholder={total.toFixed(0)}
                  />
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                    {[500, 1000, 2000, 5000, 10000].map(m => (
                        <button key={m} onClick={() => setCashAmount(m.toString())} className="px-3 py-1.5 bg-sys-100 rounded-lg text-xs font-semibold text-sys-600 hover:bg-sys-200 transition border border-transparent hover:border-sys-300">
                            ${m}
                        </button>
                    ))}
                    <button onClick={() => setCashAmount(total.toString())} className="px-3 py-1.5 bg-brand/10 rounded-lg text-xs font-bold text-brand hover:bg-brand/20 transition border border-transparent">
                        Exacto
                    </button>
                </div>
              </div>
            )}

            {/* STATUS DIGITAL (MP / CLOVER) */}
            {(method === 'mercadopago' || method === 'clover') && (
                <div className="flex flex-col items-center justify-center text-center h-full animate-in fade-in">
                    {paymentStatus === 'loading' && (
                        <>
                            <div className={cn("animate-spin rounded-full h-12 w-12 border-4 border-sys-100 mb-4", method === 'clover' ? 'border-t-green-500' : 'border-t-blue-500')}></div>
                            <p className="font-medium text-sys-800">
                                {method === 'mercadopago' ? 'Generando QR...' : 'Iniciando Terminal Clover...'}
                            </p>
                        </>
                    )}
                    {paymentStatus === 'ready' && (
                        <>
                            <div className={cn("w-16 h-16 rounded-full flex items-center justify-center mb-4 animate-in zoom-in duration-300", method === 'clover' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600')}>
                                <CheckCircle2 size={36} />
                            </div>
                            <p className="font-bold text-sys-800 text-lg">
                                {method === 'mercadopago' ? '¡QR Listo!' : '¡Clover Listo!'}
                            </p>
                            <p className="text-sys-500 text-sm mt-2 max-w-[240px]">
                                {method === 'mercadopago' ? 'El cliente puede escanear.' : 'Deslice tarjeta en terminal.'}
                            </p>
                            <Button variant="secondary" className="mt-6 text-xs" onClick={handleConfirm}>[DEV] Simular Pago Aprobado</Button>
                        </>
                    )}
                    {paymentStatus === 'error' && (
                        <>
                            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4 text-red-500"><AlertCircle size={36} /></div>
                            <p className="text-sys-800 font-bold">Error de Conexión</p>
                        </>
                    )}
                </div>
            )}
          </div>

          {/* 🔥 SECCIÓN INFERIOR: SWITCH AFIP */}
          <div className="mt-4 pt-4 border-t border-sys-100">
             <div className="flex items-center justify-between">
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
                {/* INTERRUPTOR */}
                <Switch 
                   checked={withAfip} 
                   onCheckedChange={handleAfipChange} 
                />
             </div>
          </div>

          {/* BOTONES FINALES */}
          {(method !== 'mercadopago' && method !== 'clover') && (
            <Button 
                onClick={handleConfirm}
                disabled={!isSufficient}
                className={cn("w-full py-4 text-lg mt-6 shadow-xl", isSufficient ? "shadow-brand/20" : "opacity-50")}
            >
                Confirmar Cobro <ArrowRight size={20} className="ml-2"/>
            </Button>
          )}

          {(method === 'mercadopago' || method === 'clover') && paymentStatus === 'ready' && (
             <Button onClick={handleConfirm} className="w-full py-4 text-lg mt-6 shadow-brand/20">
                Finalizar Venta <ArrowRight size={20} className="ml-2"/>
             </Button>
          )}

        </div>
      </div>
    </div>
  );
};