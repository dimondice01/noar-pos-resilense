import React, { useState, useEffect } from 'react';
import { X, DollarSign, CreditCard, AlertCircle, ArrowRight, Wallet } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { supplierRepository } from '../repositories/supplierRepository';
import { cn } from '../../../core/utils/cn';

export const SupplierPaymentModal = ({ isOpen, onClose, total, supplierName, onConfirm }) => {
    
    // Estado
    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState('cash');
    const [loading, setLoading] = useState(false);

    // Reset al abrir
    useEffect(() => {
        if (isOpen) {
            setAmount(total ? total.toString() : '');
            setMethod('cash');
            setLoading(false);
        }
    }, [isOpen, total]);

    // Cálculos
    const payValue = parseFloat(amount) || 0;
    const debtValue = Math.max(0, total - payValue);
    const isFullPayment = payValue >= total - 0.01; // Tolerancia de centavos
    const isNoPayment = payValue <= 0;

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // Validación básica
        if (payValue < 0) return;
        if (payValue > total) {
            if (!confirm("⚠️ Estás pagando MÁS que el total. ¿Deseas continuar? (Quedará saldo a favor)")) return;
        }

        setLoading(true);
        
        try {
            // Construimos el objeto de pago para devolver a la PurchasePage
            const paymentData = {
                method: isNoPayment ? 'debt' : method, // Si es 0, es deuda pura
                amountPaid: payValue,
                amountDebt: debtValue,
                total: total,
                status: isFullPayment ? 'PAID' : (isNoPayment ? 'UNPAID' : 'PARTIAL')
            };

            // Ejecutamos el callback
            await onConfirm(paymentData);
            
        } catch (error) {
            console.error(error);
            alert("Error al procesar el pago: " + error.message);
            setLoading(false); // Solo bajamos el loading si hubo error, si no, se desmonta
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col">
                
                {/* Header */}
                <div className="p-6 bg-sys-50 border-b border-sys-100 flex justify-between items-start">
                    <div>
                        <p className="text-[10px] font-black uppercase text-sys-400 tracking-widest mb-1">Pago a Proveedor</p>
                        <h3 className="font-black text-xl text-sys-900 leading-none">{supplierName}</h3>
                    </div>
                    <button onClick={onClose} className="p-2 -mr-2 -mt-2 text-sys-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-5">
                    
                    {/* Resumen de Total */}
                    <div className="bg-white border-2 border-sys-100 rounded-2xl p-4 text-center">
                        <p className="text-xs font-bold text-sys-500 uppercase mb-1">Total Factura</p>
                        <p className="text-3xl font-black text-sys-900 tracking-tight">${total.toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                    </div>

                    {/* Input Monto */}
                    <div>
                        <div className="flex justify-between mb-1.5">
                            <label className="text-xs font-bold text-sys-700">Monto a Abonar</label>
                            {isNoPayment ? (
                                <span className="text-[10px] font-black text-red-500 bg-red-50 px-2 py-0.5 rounded border border-red-100 uppercase">Todo a Deuda</span>
                            ) : !isFullPayment ? (
                                <span className="text-[10px] font-black text-orange-500 bg-orange-50 px-2 py-0.5 rounded border border-orange-100 uppercase">Pago Parcial</span>
                            ) : (
                                <span className="text-[10px] font-black text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-100 uppercase">Pago Total</span>
                            )}
                        </div>
                        <div className="relative group">
                            <DollarSign size={18} className="absolute left-3.5 top-3.5 text-sys-400 group-focus-within:text-brand transition-colors"/>
                            <input 
                                type="number" 
                                className="w-full pl-10 p-3 bg-sys-50 border-2 border-sys-100 rounded-xl text-lg font-bold text-sys-900 outline-none focus:border-brand focus:bg-white transition-all placeholder:text-sys-300"
                                placeholder="0.00"
                                value={amount}
                                onChange={e => setAmount(e.target.value)}
                                autoFocus
                                min="0"
                                step="0.01"
                            />
                            {/* Botón rápido "Pagar Todo" */}
                            {!isFullPayment && (
                                <button 
                                    type="button"
                                    onClick={() => setAmount(total.toString())}
                                    className="absolute right-2 top-2 px-2 py-1 text-[10px] font-bold bg-white border border-sys-200 rounded text-sys-500 hover:text-brand hover:border-brand transition-all"
                                >
                                    MAX
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Selector Método (Solo si paga algo) */}
                    {!isNoPayment && (
                        <div className="animate-in fade-in slide-in-from-top-2">
                            <label className="block text-xs font-bold text-sys-700 mb-1.5">Medio de Pago</label>
                            <div className="relative">
                                <CreditCard size={18} className="absolute left-3.5 top-3.5 text-sys-400"/>
                                <select 
                                    className="w-full pl-10 p-3 bg-white border-2 border-sys-100 rounded-xl text-sm font-bold text-sys-700 outline-none focus:border-brand appearance-none"
                                    value={method}
                                    onChange={e => setMethod(e.target.value)}
                                >
                                    <option value="cash">Efectivo (Caja)</option>
                                    <option value="transfer">Transferencia Bancaria</option>
                                    <option value="check">Cheque Propio</option>
                                    <option value="card">Tarjeta Corporativa</option>
                                </select>
                            </div>
                        </div>
                    )}

                    {/* Información de Deuda */}
                    {!isFullPayment && (
                        <div className="p-3 bg-orange-50 border border-orange-100 rounded-xl flex items-center justify-between animate-in fade-in">
                            <div className="flex items-center gap-2">
                                <AlertCircle size={16} className="text-orange-500"/>
                                <span className="text-xs font-bold text-orange-700 uppercase">Saldo Pendiente</span>
                            </div>
                            <span className="text-sm font-black text-orange-700 font-mono">${debtValue.toLocaleString('es-AR')}</span>
                        </div>
                    )}

                    {/* Botón de Acción Dinámico */}
                    <Button 
                        type="submit" 
                        disabled={loading}
                        className={cn(
                            "w-full h-14 text-base shadow-xl transition-all active:scale-95",
                            isNoPayment 
                                ? "bg-sys-800 hover:bg-black text-white shadow-sys-900/20" 
                                : "bg-brand hover:bg-brand-dark text-white shadow-brand/20"
                        )}
                    >
                        {loading ? (
                            "Procesando..." 
                        ) : isNoPayment ? (
                            <div className="flex items-center justify-center gap-2">
                                <Wallet size={20}/> Registrar Deuda Total
                            </div>
                        ) : (
                            <div className="flex items-center justify-center gap-2">
                                <span>Confirmar {isFullPayment ? 'Pago' : 'Entrega'}</span>
                                <ArrowRight size={20}/>
                            </div>
                        )}
                    </Button>
                </form>
            </div>
        </div>
    );
};