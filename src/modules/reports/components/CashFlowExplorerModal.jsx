import React, { useState, useEffect } from 'react';
import { X, Search, Calendar, HandCoins, Truck, FileSpreadsheet } from 'lucide-react';
import { cn } from '../../../core/utils/cn';
import { useCashFlowExplorer } from '../hooks/useCashFlowExplorer';
import { exportExpensesToExcel } from '../../../core/utils/exportExpensesToExcel';
import { exportSupplierPaymentsToExcel } from '../../../core/utils/exportSupplierPaymentsToExcel';

const money = (val) => (val || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 });

const PERIODS = [
    { id: 'today', label: 'Hoy' },
    { id: 'yesterday', label: 'Ayer' },
    { id: 'week', label: 'Semana' },
    { id: 'month', label: 'Mes' },
    { id: 'year', label: 'Año' },
    { id: 'custom', label: 'Custom', icon: Calendar }
];

const TYPE_LABELS = { EXPENSE: 'Gasto', OUT: 'Salida', WITHDRAWAL: 'Retiro' };

export function CashFlowExplorerModal({ isOpen, onClose, initialTab = 'expenses' }) {
    const [activeTab, setActiveTab] = useState(initialTab);

    // Cada vez que se reabre el modal, arranca en la pestaña que lo disparó (Gastos o Proveedores)
    useEffect(() => {
        if (isOpen) setActiveTab(initialTab);
    }, [isOpen, initialTab]);

    const {
        expenseItems, expenseTotal,
        supplierItems, supplierTotal,
        loading,
        period, setPeriod,
        customStart, setCustomStart,
        customEnd, setCustomEnd,
        searchTerm, setSearchTerm
    } = useCashFlowExplorer(isOpen);

    if (!isOpen) return null;

    const isExpenses = activeTab === 'expenses';
    const items = isExpenses ? expenseItems : supplierItems;
    const total = isExpenses ? expenseTotal : supplierTotal;

    const handleExport = () => {
        const periodLabel = PERIODS.find(p => p.id === period)?.label || period;
        if (isExpenses) exportExpensesToExcel(items, { periodLabel, search: searchTerm });
        else exportSupplierPaymentsToExcel(items, { periodLabel, search: searchTerm });
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
                <div className="p-5 bg-sys-900 text-white flex justify-between items-center shrink-0">
                    <h3 className="font-bold flex items-center gap-2 text-lg">
                        {isExpenses ? <HandCoins size={20} /> : <Truck size={20} />}
                        {isExpenses ? 'Detalle de Gastos' : 'Pagos a Proveedores'}
                    </h3>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleExport}
                            disabled={items.length === 0}
                            title="Exportar a Excel"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold transition-colors"
                        >
                            <FileSpreadsheet size={14} /> Exportar
                        </button>
                        <button onClick={onClose} className="hover:bg-white/20 p-1.5 rounded-full transition-colors"><X size={20} /></button>
                    </div>
                </div>

                {/* PESTAÑAS: cada una con su propio total */}
                <div className="flex border-b border-sys-200 shrink-0 bg-sys-50">
                    <button
                        onClick={() => setActiveTab('expenses')}
                        className={cn(
                            "flex-1 flex flex-col items-center gap-0.5 py-3 border-b-2 transition-colors",
                            isExpenses ? "border-brand bg-white" : "border-transparent text-sys-400 hover:text-sys-600"
                        )}
                    >
                        <span className={cn("flex items-center gap-1.5 text-xs font-black uppercase tracking-wide", isExpenses && "text-brand")}>
                            <HandCoins size={13} /> Gastos Fijos
                        </span>
                        <span className="text-sm font-mono font-bold text-sys-700">$ {money(expenseTotal)}</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('suppliers')}
                        className={cn(
                            "flex-1 flex flex-col items-center gap-0.5 py-3 border-b-2 transition-colors",
                            !isExpenses ? "border-brand bg-white" : "border-transparent text-sys-400 hover:text-sys-600"
                        )}
                    >
                        <span className={cn("flex items-center gap-1.5 text-xs font-black uppercase tracking-wide", !isExpenses && "text-brand")}>
                            <Truck size={13} /> Proveedores
                        </span>
                        <span className="text-sm font-mono font-bold text-sys-700">$ {money(supplierTotal)}</span>
                    </button>
                </div>

                <div className="p-4 border-b border-sys-200 shrink-0 space-y-3">
                    <div className="flex flex-col sm:flex-row gap-2">
                        <div className="flex bg-sys-50 rounded-lg border border-sys-200 p-1 overflow-x-auto no-scrollbar">
                            {PERIODS.map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => setPeriod(p.id)}
                                    className={cn(
                                        "px-3 py-1.5 rounded-md text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1",
                                        period === p.id ? "bg-sys-900 text-white shadow-md" : "text-sys-500 hover:bg-white hover:text-sys-900"
                                    )}
                                >
                                    {p.icon && <p.icon size={12} />} {p.label}
                                </button>
                            ))}
                        </div>

                        {period === 'custom' && (
                            <div className="flex items-center gap-2 bg-sys-50 px-2 py-1 rounded-lg border border-sys-200">
                                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="text-xs bg-transparent border-none outline-none font-medium text-sys-700" />
                                <span className="text-sys-300">-</span>
                                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="text-xs bg-transparent border-none outline-none font-medium text-sys-700" />
                            </div>
                        )}
                    </div>

                    <div className="relative">
                        <Search className="absolute left-3.5 top-3.5 text-sys-400" size={18} />
                        <input
                            type="text"
                            className="w-full pl-10 pr-4 py-2.5 bg-sys-50 border-2 border-transparent rounded-xl outline-none focus:border-brand focus:bg-white transition-all font-bold text-sm"
                            placeholder={isExpenses ? "Buscar por descripción o cajero..." : "Buscar por proveedor o descripción..."}
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                    {loading ? (
                        <p className="text-center text-sys-400 text-sm py-10">Cargando...</p>
                    ) : items.length === 0 ? (
                        <p className="text-center text-sys-400 text-sm py-10 italic">
                            {isExpenses ? 'Sin gastos registrados.' : 'Sin pagos a proveedores registrados.'}
                        </p>
                    ) : (
                        <div className="space-y-1.5">
                            {items.map((m, idx) => (
                                <div key={m.id || idx} className="flex items-center gap-3 bg-sys-50 border border-sys-200 rounded-xl px-3 py-2.5">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold text-sys-800 truncate" title={m.description}>
                                            {isExpenses ? (m.description || 'Gasto') : (m.supplierName || 'Proveedor')}
                                        </p>
                                        <p className="text-[10px] text-sys-400 font-mono mt-0.5 truncate">
                                            {new Date(m.date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                                            {isExpenses
                                                ? ` · ${m.user || 'Cajero'} · ${TYPE_LABELS[(m.type || '').toUpperCase()] || m.type}`
                                                : (m.description ? ` · ${m.description}` : '')}
                                        </p>
                                    </div>
                                    <span className="text-xs font-black text-rose-600 shrink-0">-$ {money(m.amount)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-sys-200 shrink-0 flex justify-between items-center bg-sys-50">
                    <span className="text-xs font-bold text-sys-500 uppercase tracking-wide">Total ({items.length})</span>
                    <span className="text-lg font-black text-rose-600">$ {money(total)}</span>
                </div>
            </div>
        </div>
    );
}
