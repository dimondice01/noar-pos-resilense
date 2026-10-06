import React, { useMemo, useState } from 'react';
import { User, ChevronDown, ChevronRight, Eye, CloudDownload, Building2, TrendingDown, TrendingUp } from 'lucide-react';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

const formatCurrency = (amount) => `$ ${Number(amount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Mismo umbral que la tabla de Historial ("OK" si |desvío| < 50)
const TOLERANCE = 50;

const toInputDate = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const getRange = (period, customFrom, customTo) => {
    const now = new Date();
    if (period === 'week') {
        const from = new Date(now);
        const dow = (from.getDay() + 6) % 7; // lunes = 0
        from.setDate(from.getDate() - dow);
        from.setHours(0, 0, 0, 0);
        return { from, to: null };
    }
    if (period === 'month') {
        return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null };
    }
    const from = customFrom ? new Date(`${customFrom}T00:00:00`) : null;
    const to = customTo ? new Date(`${customTo}T23:59:59.999`) : null;
    return { from, to };
};

// ============================================================================
// 👤 PERFILES DE CAJEROS — 100% sobre turnos ya cargados (Dexie), 0 lecturas extra.
// La nube solo se consulta si el admin toca "Completar desde nube".
// ============================================================================
export const CashierProfilesPanel = ({ shifts, resolveCashierName, resolveBranchName, getDiff, onOpenShift, onCloudBackfill }) => {
    const [period, setPeriod] = useState('week');
    const [customFrom, setCustomFrom] = useState(toInputDate(new Date(Date.now() - 30 * 86400000)));
    const [customTo, setCustomTo] = useState(toInputDate(new Date()));
    const [expanded, setExpanded] = useState(null);
    const [backfilling, setBackfilling] = useState(false);

    const range = useMemo(() => getRange(period, customFrom, customTo), [period, customFrom, customTo]);

    const profiles = useMemo(() => {
        const map = new Map();
        for (const s of shifts) {
            if (s.status !== 'CLOSED' || !s.closedAt || s.mergedInto) continue; // fusionados: el arqueo vive en el principal
            const closed = new Date(s.closedAt);
            if (range.from && closed < range.from) continue;
            if (range.to && closed > range.to) continue;

            const { expected, declared, diff } = getDiff(s);
            const key = s.userId || s.userName || 'unknown';
            if (!map.has(key)) {
                map.set(key, { key, name: resolveCashierName(s.userId, s.userName), total: 0, shortage: 0, surplus: 0, withDiff: 0, closures: [] });
            }
            const p = map.get(key);
            p.total += diff;
            if (diff < 0) p.shortage += diff; else p.surplus += diff;
            if (Math.abs(diff) >= TOLERANCE) p.withDiff++;
            p.closures.push({ shift: s, expected, declared, diff });
        }
        const list = [...map.values()];
        list.forEach(p => p.closures.sort((a, b) => new Date(b.shift.closedAt) - new Date(a.shift.closedAt)));
        return list.sort((a, b) => a.total - b.total); // peores faltantes primero
    }, [shifts, range, getDiff, resolveCashierName]);

    const handleBackfill = async () => {
        const from = range.from || new Date(Date.now() - 90 * 86400000);
        setBackfilling(true);
        try { await onCloudBackfill(from.toISOString()); } finally { setBackfilling(false); }
    };

    const periodBtn = (id, label) => (
        <button onClick={() => setPeriod(id)} className={cn("px-4 py-1.5 text-[11px] font-black rounded-lg uppercase tracking-wider transition-all", period === id ? "bg-sys-900 text-white" : "text-sys-400 hover:bg-sys-50")}>
            {label}
        </button>
    );

    return (
        <Card className="p-0 overflow-hidden border-0 shadow-2xl rounded-3xl bg-white flex flex-col min-h-[500px]">
            <div className="p-4 border-b border-sys-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex bg-white p-1 rounded-xl border border-sys-100">
                        {periodBtn('week', 'Semana')}
                        {periodBtn('month', 'Mes')}
                        {periodBtn('custom', 'Custom')}
                    </div>
                    {period === 'custom' && (
                        <div className="flex items-center gap-2 text-xs">
                            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="border border-sys-200 rounded-lg px-2 py-1.5 outline-none focus:border-brand" />
                            <span className="text-sys-400 font-bold">a</span>
                            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="border border-sys-200 rounded-lg px-2 py-1.5 outline-none focus:border-brand" />
                        </div>
                    )}
                </div>
                {onCloudBackfill && (
                    <Button variant="outline" size="sm" onClick={handleBackfill} disabled={backfilling} title="Trae de la nube los turnos del período que falten en este dispositivo (máx. 300)">
                        <CloudDownload size={14} className={cn("mr-2", backfilling && "animate-bounce")} /> Completar desde nube
                    </Button>
                )}
            </div>

            <div className="overflow-x-auto flex-1">
                <table className="w-full text-left text-sm">
                    <thead className="bg-sys-900 text-white text-[10px] font-black uppercase tracking-widest">
                        <tr>
                            <th className="p-4">Cajero</th>
                            <th className="p-4 text-center">Cierres</th>
                            <th className="p-4 text-center">Con desvío</th>
                            <th className="p-4 text-right">Faltantes</th>
                            <th className="p-4 text-right">Sobrantes</th>
                            <th className="p-4 text-right">Diferencia neta</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-sys-50">
                        {profiles.length === 0 && (
                            <tr><td colSpan="6" className="p-20 text-center text-sys-400 italic uppercase font-black text-xs tracking-widest">Sin cierres en el período</td></tr>
                        )}
                        {profiles.map(p => {
                            const isOpen = expanded === p.key;
                            const netOk = Math.abs(p.total) < TOLERANCE;
                            return (
                                <React.Fragment key={p.key}>
                                    <tr onClick={() => setExpanded(isOpen ? null : p.key)} className="hover:bg-sys-50 transition-colors cursor-pointer">
                                        <td className="p-4 font-black text-sys-800 text-xs uppercase">
                                            <span className="flex items-center gap-2">
                                                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                <User size={14} className="text-sys-400" /> {p.name}
                                            </span>
                                        </td>
                                        <td className="p-4 text-center font-mono text-xs">{p.closures.length}</td>
                                        <td className="p-4 text-center font-mono text-xs">{p.withDiff}</td>
                                        <td className="p-4 text-right font-mono text-xs text-rose-600"><TrendingDown size={12} className="inline mr-1" />{formatCurrency(p.shortage)}</td>
                                        <td className="p-4 text-right font-mono text-xs text-emerald-600"><TrendingUp size={12} className="inline mr-1" />{formatCurrency(p.surplus)}</td>
                                        <td className="p-4 text-right">
                                            <span className={cn("px-2.5 py-1 rounded-lg text-[11px] font-black border font-mono", netOk ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-rose-50 text-rose-700 border-rose-100")}>
                                                {formatCurrency(p.total)}
                                            </span>
                                        </td>
                                    </tr>
                                    {isOpen && (
                                        <tr>
                                            <td colSpan="6" className="bg-sys-50/60 p-0">
                                                <table className="w-full text-xs">
                                                    <thead className="text-[9px] font-black uppercase text-sys-400 tracking-widest">
                                                        <tr>
                                                            <th className="p-3 pl-12 text-left">Cierre</th>
                                                            <th className="p-3 text-left">Sucursal</th>
                                                            <th className="p-3 text-right">Teórico</th>
                                                            <th className="p-3 text-right">Real</th>
                                                            <th className="p-3 text-center">Desvío</th>
                                                            <th className="p-3 text-right"></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-sys-100">
                                                        {p.closures.map(({ shift, expected, declared, diff }) => {
                                                            const ok = Math.abs(diff) < TOLERANCE;
                                                            return (
                                                                <tr key={shift.id}>
                                                                    <td className="p-3 pl-12 font-mono text-sys-600">
                                                                        {new Date(shift.closedAt).toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' })} {new Date(shift.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                    </td>
                                                                    <td className="p-3"><span className="text-[10px] font-black uppercase text-sys-500 flex items-center gap-1"><Building2 size={10} /> {resolveBranchName(shift.branchId)}</span></td>
                                                                    <td className="p-3 text-right font-mono text-sys-400">{formatCurrency(expected)}</td>
                                                                    <td className="p-3 text-right font-mono font-black text-sys-800">{formatCurrency(declared)}</td>
                                                                    <td className="p-3 text-center">
                                                                        <span className={cn("px-2 py-0.5 rounded text-[10px] font-black border", ok ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-rose-50 text-rose-700 border-rose-100")}>
                                                                            {ok ? 'OK' : formatCurrency(diff)}
                                                                        </span>
                                                                    </td>
                                                                    <td className="p-3 text-right">
                                                                        <button onClick={(e) => { e.stopPropagation(); onOpenShift(shift); }} className="p-2 bg-white border border-sys-200 text-sys-600 rounded-lg hover:bg-sys-100" title="Detalle del cierre"><Eye size={14} /></button>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </Card>
    );
};
