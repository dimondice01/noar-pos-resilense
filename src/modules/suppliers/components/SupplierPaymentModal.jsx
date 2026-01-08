import React, { useState, useEffect } from 'react';
import { X, DollarSign, CreditCard } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { supplierRepository } from '../repositories/supplierRepository';

export const SupplierPaymentModal = ({ isOpen, onClose, supplier, invoiceToPay, onSuccess }) => {
    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState('cash');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            // 🔥 CAMBIO: Si hay factura, sugerimos lo que FALTA pagar, no el total
            if (invoiceToPay) {
                // Si existe remainingBalance lo usamos, si no, usamos amount (legacy)
                const pending = invoiceToPay.remainingBalance !== undefined 
                    ? invoiceToPay.remainingBalance 
                    : invoiceToPay.amount;
                
                // Redondeo para evitar decimales locos
                setAmount(Math.max(0, pending).toString());
            } else {
                setAmount('');
            }
            setLoading(false);
        }
    }, [isOpen, invoiceToPay]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!amount || parseFloat(amount) <= 0) return;
        
        setLoading(true);
        try {
            const desc = invoiceToPay 
                ? `Pago Fac #${invoiceToPay.invoiceNumber || 'S/N'}` 
                : 'Pago a Cuenta (Global)';

            await supplierRepository.registerPayment({
                supplierId: supplier.id,
                amount: parseFloat(amount),
                method: method,
                description: desc,
                refId: invoiceToPay?.id 
            });

            alert("Pago registrado correctamente");
            onSuccess?.();
            onClose();
        } catch (error) {
            console.error(error);
            alert("Error: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="flex justify-between items-center p-4 border-b border-sys-100 bg-sys-50">
                    <h3 className="font-bold text-lg text-sys-900">Registrar Pago</h3>
                    <button onClick={onClose}><X size={20} className="text-sys-400 hover:text-sys-700"/></button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {invoiceToPay && (
                        <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 text-sm text-blue-800 mb-2">
                            <p className="font-bold">Abonando a Factura:</p>
                            <p>{invoiceToPay.description}</p>
                            <div className="flex justify-between mt-1 font-mono text-xs">
                                <span>Total Orig: ${invoiceToPay.amount}</span>
                                <span className="font-bold text-red-600">Falta: ${invoiceToPay.remainingBalance?.toLocaleString()}</span>
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-sys-700 mb-1">Monto a Pagar</label>
                        <div className="relative">
                            <DollarSign size={16} className="absolute left-3 top-3 text-green-600"/>
                            <input 
                                type="number" 
                                className="w-full pl-9 p-2.5 border border-sys-300 rounded-lg text-lg font-bold text-sys-900 outline-none focus:border-brand"
                                placeholder="0.00"
                                value={amount}
                                onChange={e => setAmount(e.target.value)}
                                autoFocus
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-sys-700 mb-1">Medio de Pago</label>
                        <div className="relative">
                            <CreditCard size={16} className="absolute left-3 top-3 text-sys-400"/>
                            <select 
                                className="w-full pl-9 p-2.5 bg-white border border-sys-200 rounded-lg text-sm outline-none focus:border-brand"
                                value={method}
                                onChange={e => setMethod(e.target.value)}
                            >
                                <option value="cash">Efectivo (Caja)</option>
                                <option value="transfer">Transferencia</option>
                                <option value="check">Cheque</option>
                            </select>
                        </div>
                    </div>

                    <Button type="submit" className="w-full h-12 text-base shadow-lg shadow-green-500/20 bg-green-600 hover:bg-green-700 border-green-600" disabled={loading}>
                        {loading ? "Registrando..." : "Confirmar Pago"}
                    </Button>
                </form>
            </div>
        </div>
    );
};