import React, { useState, useEffect } from 'react';
import { X, Calendar, DollarSign, FileText, Truck, AlertCircle } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { supplierRepository } from '../repositories/supplierRepository';
import { masterRepository } from '../../inventory/repositories/masterRepository';
import { cn } from '../../../core/utils/cn';

export const SupplierPurchaseModal = ({ isOpen, onClose, onSuccess }) => {
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(false);

    // Form State
    const [formData, setFormData] = useState({
        supplierId: '',
        date: new Date().toISOString().split('T')[0],
        invoiceNumber: '',
        description: '',
        totalAmount: '',
        paidAmount: ''
    });

    useEffect(() => {
        if (isOpen) {
            loadSuppliers();
            // Reset form
            setFormData({
                supplierId: '',
                date: new Date().toISOString().split('T')[0],
                invoiceNumber: '',
                description: '',
                totalAmount: '',
                paidAmount: ''
            });
        }
    }, [isOpen]);

    const loadSuppliers = async () => {
        // Usamos el masterRepository que ya sincroniza con Firebase
        const data = await masterRepository.getAll('suppliers');
        setSuppliers(data);
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    // Auto-fill pago total si el usuario no escribe nada (UX opcional, o dejar en 0)
    // Aquí dejamos que el usuario decida.

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        const total = parseFloat(formData.totalAmount) || 0;
        const paid = parseFloat(formData.paidAmount) || 0;

        if (!formData.supplierId) { alert("Seleccione un proveedor"); setLoading(false); return; }
        if (total <= 0) { alert("El monto total debe ser mayor a 0"); setLoading(false); return; }
        if (paid > total) { alert("El monto pagado no puede ser mayor al total"); setLoading(false); return; }

        try {
            await supplierRepository.registerPurchase({
                supplierId: formData.supplierId,
                date: formData.date,
                totalAmount: total,
                paidAmount: paid, // Si es 0, todo es deuda. Si es == total, no hay deuda.
                description: formData.description,
                invoiceNumber: formData.invoiceNumber
            });
            onSuccess?.();
            onClose();
        } catch (error) {
            console.error(error);
            alert("Error al registrar: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    // Cálculo visual de la deuda resultante
    const debtResult = (parseFloat(formData.totalAmount || 0) - parseFloat(formData.paidAmount || 0));

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
                
                <div className="flex justify-between items-center p-4 border-b border-sys-100 bg-sys-50">
                    <h3 className="font-bold text-lg text-sys-900 flex items-center gap-2">
                        <Truck className="text-brand" size={20}/> Registrar Compra / Gasto
                    </h3>
                    <button onClick={onClose}><X size={20} className="text-sys-400 hover:text-sys-700"/></button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    
                    {/* Proveedor y Fecha */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2 md:col-span-1">
                            <label className="block text-xs font-bold text-sys-700 mb-1">Proveedor</label>
                            <select 
                                name="supplierId" 
                                className="w-full p-2.5 bg-white border border-sys-200 rounded-lg text-sm focus:border-brand outline-none"
                                value={formData.supplierId}
                                onChange={handleChange}
                                required
                            >
                                <option value="">Seleccione...</option>
                                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>
                        <div className="col-span-2 md:col-span-1">
                            <label className="block text-xs font-bold text-sys-700 mb-1">Fecha</label>
                            <input 
                                type="date"
                                name="date"
                                className="w-full p-2.5 bg-white border border-sys-200 rounded-lg text-sm outline-none"
                                value={formData.date}
                                onChange={handleChange}
                            />
                        </div>
                    </div>

                    {/* Detalle Factura */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-1">
                            <label className="block text-xs font-bold text-sys-700 mb-1">N° Factura (Opcional)</label>
                            <div className="relative">
                                <FileText size={16} className="absolute left-3 top-2.5 text-sys-400"/>
                                <input 
                                    type="text" 
                                    name="invoiceNumber"
                                    placeholder="0001-00001234"
                                    className="w-full pl-9 p-2.5 border border-sys-200 rounded-lg text-sm outline-none focus:border-brand"
                                    value={formData.invoiceNumber}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>
                        <div className="col-span-1">
                            <label className="block text-xs font-bold text-sys-700 mb-1">Detalle / Notas</label>
                            <input 
                                type="text" 
                                name="description"
                                placeholder="Ej: Reposición Coca Cola"
                                className="w-full p-2.5 border border-sys-200 rounded-lg text-sm outline-none focus:border-brand"
                                value={formData.description}
                                onChange={handleChange}
                            />
                        </div>
                    </div>

                    <div className="h-px bg-sys-100 my-2"></div>

                    {/* MONTOS - EL CORAZÓN DE LA LÓGICA */}
                    <div className="grid grid-cols-2 gap-6 bg-sys-50 p-4 rounded-xl border border-sys-100">
                        <div>
                            <label className="block text-xs font-bold text-sys-800 mb-1 uppercase">Monto Total</label>
                            <div className="relative">
                                <DollarSign size={16} className="absolute left-3 top-3 text-sys-500"/>
                                <input 
                                    type="number" 
                                    name="totalAmount"
                                    placeholder="0.00"
                                    className="w-full pl-8 p-2.5 bg-white border border-sys-300 rounded-lg font-bold text-sys-900 outline-none focus:ring-2 focus:ring-brand/20"
                                    value={formData.totalAmount}
                                    onChange={handleChange}
                                    autoFocus
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-green-700 mb-1 uppercase">Monto a Pagar (Caja)</label>
                            <div className="relative">
                                <DollarSign size={16} className="absolute left-3 top-3 text-green-600"/>
                                <input 
                                    type="number" 
                                    name="paidAmount"
                                    placeholder="0.00"
                                    className="w-full pl-8 p-2.5 bg-white border border-green-200 rounded-lg font-bold text-green-700 outline-none focus:ring-2 focus:ring-green-500/20"
                                    value={formData.paidAmount}
                                    onChange={handleChange}
                                />
                            </div>
                            <p className="text-[10px] text-sys-400 mt-1">* Si es 0, queda todo en Cta. Cte.</p>
                        </div>
                    </div>

                    {/* RESUMEN DE LA OPERACIÓN */}
                    {formData.totalAmount > 0 && (
                        <div className={cn(
                            "p-3 rounded-lg flex justify-between items-center text-sm font-medium border",
                            debtResult > 0 ? "bg-red-50 border-red-100 text-red-800" : "bg-green-50 border-green-100 text-green-800"
                        )}>
                            <span className="flex items-center gap-2">
                                <AlertCircle size={16}/> 
                                {debtResult > 0 ? "Saldo Pendiente (Deuda)" : "Pago Completo"}
                            </span>
                            <span className="font-bold text-lg">
                                $ {debtResult.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                            </span>
                        </div>
                    )}

                    <Button type="submit" className="w-full h-12 text-base shadow-lg shadow-brand/20" disabled={loading}>
                        {loading ? "Registrando..." : "Confirmar Operación"}
                    </Button>

                </form>
            </div>
        </div>
    );
};