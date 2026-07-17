import React from 'react';
import { X, Search, Calendar, TrendingUp, FileSpreadsheet } from 'lucide-react';
import { cn } from '../../../core/utils/cn';
import { useTopProductsExplorer } from '../hooks/useTopProductsExplorer';
import { exportTopProductsToExcel } from '../../../core/utils/exportTopProductsToExcel';

const money = (val) => (val || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 });

const PERIODS = [
    { id: 'today', label: 'Hoy' },
    { id: 'yesterday', label: 'Ayer' },
    { id: 'week', label: 'Semana' },
    { id: 'month', label: 'Mes' },
    { id: 'custom', label: 'Custom', icon: Calendar }
];

export function TopProductsModal({ isOpen, onClose }) {
    const {
        items, loading,
        period, setPeriod,
        customStart, setCustomStart,
        customEnd, setCustomEnd,
        searchTerm, setSearchTerm
    } = useTopProductsExplorer(isOpen);

    if (!isOpen) return null;

    const handleExport = () => {
        const periodLabel = PERIODS.find(p => p.id === period)?.label || period;
        exportTopProductsToExcel(items, { periodLabel, search: searchTerm });
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
                <div className="p-5 bg-sys-900 text-white flex justify-between items-center shrink-0">
                    <h3 className="font-bold flex items-center gap-2 text-lg"><TrendingUp size={20} /> Productos Más Vendidos</h3>
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
                            placeholder="Buscar producto..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                    {loading ? (
                        <p className="text-center text-sys-400 text-sm py-10">Cargando...</p>
                    ) : items.length === 0 ? (
                        <p className="text-center text-sys-400 text-sm py-10 italic">Sin datos suficientes.</p>
                    ) : (
                        <div className="space-y-1.5">
                            {items.map((p, idx) => (
                                <div key={p.productId || p.name} className="flex items-center gap-3 bg-sys-50 border border-sys-200 rounded-xl px-3 py-2.5">
                                    <div className="w-6 h-6 bg-sys-900 text-white rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold">{idx + 1}</div>
                                    <span className="flex-1 text-sm font-bold text-sys-800 truncate" title={p.name}>{p.name}</span>
                                    <span className="text-xs font-black text-brand shrink-0">{p.quantity} un.</span>
                                    <span className="text-xs font-bold text-emerald-600 w-24 text-right shrink-0">$ {money(p.revenue)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
