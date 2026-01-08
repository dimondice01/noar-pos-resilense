import React, { useEffect, useState } from 'react';
import { Truck, Search, DollarSign, FileText, ExternalLink, ArrowLeft, CheckCircle } from 'lucide-react';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { supplierRepository } from '../repositories/supplierRepository';
import { SupplierPurchaseModal } from '../components/SupplierPurchaseModal';
import { SupplierPaymentModal } from '../components/SupplierPaymentModal'; 
import { MastersModal } from '../../inventory/components/MastersModal'; 
import { cn } from '../../../core/utils/cn';

// Componente Interno: Dashboard de Proveedor
const SupplierDetail = ({ supplier, onBack }) => {
    const [ledger, setLedger] = useState([]);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [invoiceToPay, setInvoiceToPay] = useState(null); 

    const loadLedger = async () => {
        const data = await supplierRepository.getLedger(supplier.id);
        setLedger(data);
    };

    useEffect(() => { loadLedger(); }, [supplier.id]);

    const handlePayInvoice = (mov) => {
        setInvoiceToPay(mov); 
        setIsPaymentModalOpen(true);
    };

    const handleGlobalPayment = () => {
        setInvoiceToPay(null); 
        setIsPaymentModalOpen(true);
    };

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            {/* Header Detalle */}
            <div className="flex items-center gap-4">
                <button onClick={onBack} className="p-2 hover:bg-sys-100 rounded-full transition-colors text-sys-500">
                    <ArrowLeft size={24} />
                </button>
                <div>
                    <h2 className="text-2xl font-bold text-sys-900">{supplier.name}</h2>
                    <p className="text-xs text-sys-500 font-mono">ID: {supplier.id}</p>
                </div>
            </div>

            {/* Tarjeta de Saldo */}
            <Card className={cn("border-l-4 p-6 flex flex-col sm:flex-row justify-between items-center gap-4", supplier.balance > 0 ? "border-l-red-500" : "border-l-green-500")}>
                <div>
                    <p className="text-sm font-bold text-sys-500 uppercase tracking-wider mb-1">Saldo Pendiente (Deuda)</p>
                    <p className={cn("text-3xl font-black", supplier.balance > 0 ? "text-red-600" : "text-green-600")}>
                        $ {supplier.balance.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                    </p>
                </div>
                {supplier.balance > 0 && (
                    <Button onClick={handleGlobalPayment} className="bg-green-600 hover:bg-green-700 border-green-600 text-white shadow-lg shadow-green-200">
                        <DollarSign size={18} className="mr-2"/> Registrar Pago Global
                    </Button>
                )}
            </Card>

            {/* Tabla de Movimientos */}
            <Card className="p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-sys-50 text-sys-500 text-xs uppercase font-semibold border-b border-sys-100">
                            <tr>
                                <th className="p-4">Fecha</th>
                                <th className="p-4">Descripción</th>
                                <th className="p-4 text-right">Total Orig.</th>
                                <th className="p-4 text-right">Deuda Pendiente</th>
                                <th className="p-4 text-center">Estado / Acción</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-sys-100">
                            {ledger.length === 0 ? (
                                <tr><td colSpan="5" className="p-8 text-center text-sys-400 italic">Sin movimientos</td></tr>
                            ) : (
                                ledger.map((mov, idx) => (
                                    <tr key={idx} className="hover:bg-sys-50/50 group">
                                        <td className="p-4 font-mono text-sys-600 whitespace-nowrap">
                                            {new Date(mov.date).toLocaleDateString()}
                                        </td>
                                        
                                        <td className="p-4">
                                            <div className="flex items-center gap-2">
                                                <div className={cn("w-2 h-2 rounded-full", mov.type === 'PURCHASE' ? "bg-red-500" : "bg-green-500")}></div>
                                                <span className="font-medium text-sys-800">
                                                    {mov.type === 'PURCHASE' ? 'Compra' : 'Pago'}
                                                </span>
                                            </div>
                                            <p className="text-xs text-sys-500 ml-4 truncate max-w-[250px]">{mov.description}</p>
                                            {mov.invoiceNumber && <p className="text-[10px] text-sys-400 ml-4 font-mono">Fac: {mov.invoiceNumber}</p>}
                                        </td>

                                        {/* COLUMNA: TOTAL ORIGINAL */}
                                        <td className="p-4 text-right font-medium text-sys-500">
                                            $ {mov.amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                        </td>

                                        {/* COLUMNA: DEUDA PENDIENTE (Solo para compras) */}
                                        <td className="p-4 text-right font-bold">
                                            {mov.type === 'PURCHASE' ? (
                                                <span className={mov.remainingBalance > 0 ? "text-red-600" : "text-green-600"}>
                                                    $ {(mov.remainingBalance || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                                </span>
                                            ) : (
                                                <span className="text-sys-300">-</span>
                                            )}
                                        </td>

                                        {/* COLUMNA: ACCIÓN */}
                                        <td className="p-4 text-center">
                                            {mov.type === 'PURCHASE' ? (
                                                (mov.remainingBalance || 0) > 0 ? (
                                                    <button 
                                                        onClick={() => handlePayInvoice(mov)}
                                                        className="text-green-600 hover:text-green-800 bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm border border-green-200"
                                                    >
                                                        Pagar Saldo
                                                    </button>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100">
                                                        <CheckCircle size={12}/> Pagado
                                                    </span>
                                                )
                                            ) : (
                                                <span className="text-[10px] text-sys-400 italic">Pago registrado</span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>

            <SupplierPaymentModal 
                isOpen={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                supplier={supplier}
                invoiceToPay={invoiceToPay}
                onSuccess={() => {
                    loadLedger(); 
                }}
            />
        </div>
    );
};

// ... (Resto de SuppliersPage igual: lista de tarjetas) ...
export const SuppliersPage = () => {
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSupplier, setSelectedSupplier] = useState(null);
    const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
    const [isMastersModalOpen, setIsMastersModalOpen] = useState(false);

    const loadData = async () => {
        setLoading(true);
        try {
            const data = await supplierRepository.getAllWithBalance();
            setSuppliers(data);
            if (selectedSupplier) {
                const updated = data.find(s => s.id === selectedSupplier.id);
                if (updated) setSelectedSupplier(updated);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadData(); }, []);

    if (selectedSupplier) {
        return (
            <div className="p-6 max-w-[1600px] mx-auto pb-20">
                <SupplierDetail 
                    supplier={selectedSupplier} 
                    onBack={() => { setSelectedSupplier(null); loadData(); }} 
                />
            </div>
        );
    }

    const filteredSuppliers = suppliers.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()));
    const totalDebt = suppliers.reduce((acc, s) => acc + (s.balance || 0), 0);

    return (
        <div className="p-6 max-w-[1600px] mx-auto space-y-6 pb-20">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-sys-900 flex items-center gap-2"><Truck className="text-brand"/> Proveedores & Gastos</h1>
                    <p className="text-sys-500 text-sm">Gestión de compras, gastos y cuentas corrientes.</p>
                </div>
                <Card className="px-6 py-3 bg-white border border-red-100 shadow-sm flex items-center gap-4 border-l-4 border-l-red-500">
                    <div>
                        <p className="text-[10px] text-sys-400 uppercase font-bold">Total a Pagar (Deuda)</p>
                        <p className="text-2xl font-black text-red-600">$ {totalDebt.toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                    </div>
                </Card>
            </div>

            <Card className="p-2 flex gap-2 bg-sys-50 border-sys-200">
                <div className="relative flex-1 max-w-md">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400"/>
                    <input type="text" placeholder="Buscar proveedor..." className="w-full pl-9 pr-3 py-2 bg-white border border-sys-200 rounded-lg text-sm outline-none focus:border-brand" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
                </div>
                <div className="flex-1"></div>
                <Button variant="secondary" onClick={() => setIsMastersModalOpen(true)}><ExternalLink size={16} className="mr-2"/> Gestionar Maestros</Button>
                <Button onClick={() => setIsPurchaseModalOpen(true)} className="shadow-lg shadow-brand/20"><DollarSign size={18} className="mr-1"/> Registrar Gasto / Compra</Button>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredSuppliers.map(sup => (
                    <Card key={sup.id} className="hover:border-brand/30 transition-all cursor-pointer group relative overflow-hidden" onClick={() => setSelectedSupplier(sup)}>
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-sys-100 flex items-center justify-center text-sys-600 font-bold text-lg">{sup.name.charAt(0)}</div>
                                <div><h3 className="font-bold text-sys-900">{sup.name}</h3><p className="text-xs text-sys-400 font-mono">ID: {sup.id.slice(-4)}</p></div>
                            </div>
                            {sup.balance > 0 && (<span className="bg-red-50 text-red-700 px-2 py-1 rounded text-xs font-bold border border-red-100">Deuda</span>)}
                        </div>
                        <div className="pt-4 border-t border-sys-100 flex justify-between items-end">
                            <div><p className="text-xs text-sys-400 font-medium uppercase mb-0.5">Saldo Pendiente</p><p className={cn("text-xl font-black", sup.balance > 0 ? "text-red-600" : "text-green-600")}>$ {sup.balance.toLocaleString('es-AR', {minimumFractionDigits: 2})}</p></div>
                            <Button variant="ghost" className="text-sys-400 hover:text-brand" size="sm"><FileText size={16} className="mr-1"/> Ver Historial</Button>
                        </div>
                    </Card>
                ))}
            </div>

            <SupplierPurchaseModal isOpen={isPurchaseModalOpen} onClose={() => setIsPurchaseModalOpen(false)} onSuccess={loadData} />
            <MastersModal isOpen={isMastersModalOpen} onClose={() => { setIsMastersModalOpen(false); loadData(); }} />
        </div>
    );
};