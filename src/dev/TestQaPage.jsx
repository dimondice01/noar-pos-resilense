import React, { useEffect, useState, useCallback } from 'react';
import { getDB } from '../database/db';
import { useAuthStore } from '../modules/auth/store/useAuthStore';
import { cn } from '../core/utils/cn';
import {
    Package, Users, Truck, ShoppingCart, DollarSign,
    BarChart2, ArrowUpDown, BookOpen, RefreshCw,
    CheckCircle, AlertCircle, Clock, Database, Wifi, WifiOff, Loader2
} from 'lucide-react';

// ─── helpers ─────────────────────────────────────────────────
const fmt = (n) => n?.toLocaleString('es-AR') ?? '—';

async function getTableStats(db, tableName, opts = {}) {
    try {
        const { seedField = 'id', pkIsArray = false } = opts;
        const all = await db[tableName].toArray();
        const total = all.length;
        const seeded = all.filter(r => {
            const val = r[seedField] ?? r.id ?? '';
            return typeof val === 'string' && val.startsWith('SEED-');
        }).length;
        const pending = all.filter(r => r.syncStatus && r.syncStatus !== 'synced').length;
        const dates = all.map(r => r.updatedAt).filter(Boolean).sort().reverse();
        const lastUpdated = dates[0] ? new Date(dates[0]).toLocaleString('es-AR') : '—';
        return { total, seeded, pending, lastUpdated, ok: true };
    } catch {
        return { total: 0, seeded: 0, pending: 0, lastUpdated: '—', ok: false };
    }
}

// ─── tabla config ─────────────────────────────────────────────
const TABLES = [
    { key: 'products',         label: 'Productos',           icon: Package,    color: 'blue'    },
    { key: 'inventory',        label: 'Inventario',          icon: Database,   color: 'indigo'  },
    { key: 'categories',       label: 'Categorías',          icon: BarChart2,  color: 'purple'  },
    { key: 'brands',           label: 'Marcas',              icon: BarChart2,  color: 'purple'  },
    { key: 'clients',          label: 'Clientes',            icon: Users,      color: 'green'   },
    { key: 'suppliers',        label: 'Proveedores',         icon: Truck,      color: 'orange'  },
    { key: 'shifts',           label: 'Turnos',              icon: Clock,      color: 'yellow'  },
    { key: 'sales',            label: 'Ventas',              icon: ShoppingCart, color: 'emerald' },
    { key: 'purchases',        label: 'Compras',             icon: ArrowUpDown, color: 'cyan'   },
    { key: 'cash_movements',   label: 'Movimientos Caja',   icon: DollarSign, color: 'teal'    },
    { key: 'movements',        label: 'Kardex',              icon: ArrowUpDown, color: 'slate'  },
    { key: 'customer_ledger',  label: 'Cta. Cte. Clientes', icon: BookOpen,   color: 'rose'    },
    { key: 'supplier_ledger',  label: 'Cta. Cte. Proveed.', icon: BookOpen,   color: 'amber'   },
];

const COLOR_MAP = {
    blue:    'bg-blue-50 border-blue-200 text-blue-700',
    indigo:  'bg-indigo-50 border-indigo-200 text-indigo-700',
    purple:  'bg-purple-50 border-purple-200 text-purple-700',
    green:   'bg-green-50 border-green-200 text-green-700',
    orange:  'bg-orange-50 border-orange-200 text-orange-700',
    yellow:  'bg-yellow-50 border-yellow-200 text-yellow-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    cyan:    'bg-cyan-50 border-cyan-200 text-cyan-700',
    teal:    'bg-teal-50 border-teal-200 text-teal-700',
    slate:   'bg-slate-50 border-slate-200 text-slate-700',
    rose:    'bg-rose-50 border-rose-200 text-rose-700',
    amber:   'bg-amber-50 border-amber-200 text-amber-700',
};

// ─── Componente Tarjeta ───────────────────────────────────────
const TableCard = ({ table, stats, loading }) => {
    const Icon = table.icon;
    const colors = COLOR_MAP[table.color] || COLOR_MAP.slate;
    const hasSeed = stats?.seeded > 0;
    const hasPending = stats?.pending > 0;

    return (
        <div className={cn('rounded-2xl border p-4 flex flex-col gap-3 shadow-sm', colors)}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Icon size={16} />
                    <span className="text-xs font-black uppercase tracking-wider">{table.label}</span>
                </div>
                {loading ? (
                    <Loader2 size={14} className="animate-spin opacity-50" />
                ) : stats?.ok ? (
                    <CheckCircle size={14} className="text-current opacity-60" />
                ) : (
                    <AlertCircle size={14} className="text-red-500" />
                )}
            </div>

            {loading ? (
                <div className="h-8 rounded bg-current opacity-10 animate-pulse" />
            ) : (
                <div className="flex items-end justify-between">
                    <span className="text-3xl font-black leading-none">{fmt(stats?.total)}</span>
                    <div className="text-right space-y-0.5">
                        {hasSeed && (
                            <div className="text-[10px] font-bold opacity-70">
                                🌱 {stats.seeded} seed
                            </div>
                        )}
                        {hasPending && (
                            <div className="text-[10px] font-bold text-orange-600">
                                ⏳ {stats.pending} pendiente{stats.pending > 1 ? 's' : ''}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="text-[10px] opacity-60 font-mono truncate">
                {loading ? '...' : `Último: ${stats?.lastUpdated}`}
            </div>
        </div>
    );
};

// ─── Página principal ─────────────────────────────────────────
export const TestQaPage = () => {
    const { user } = useAuthStore();
    const [stats, setStats] = useState({});
    const [loading, setLoading] = useState(true);
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [refreshedAt, setRefreshedAt] = useState(null);
    const [totalSeed, setTotalSeed] = useState(0);

    const loadStats = useCallback(async () => {
        setLoading(true);
        try {
            const db = await getDB();
            const results = {};
            let seedTotal = 0;
            for (const t of TABLES) {
                results[t.key] = await getTableStats(db, t.key);
                seedTotal += results[t.key].seeded ?? 0;
            }
            setStats(results);
            setTotalSeed(seedTotal);
            setRefreshedAt(new Date().toLocaleTimeString('es-AR'));
        } catch (e) {
            console.error('QA load error:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadStats();
        const onOnline  = () => setIsOnline(true);
        const onOffline = () => setIsOnline(false);
        window.addEventListener('online',  onOnline);
        window.addEventListener('offline', onOffline);
        return () => {
            window.removeEventListener('online',  onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }, [loadStats]);

    const totalRecords = Object.values(stats).reduce((s, t) => s + (t.total ?? 0), 0);
    const totalPending = Object.values(stats).reduce((s, t) => s + (t.pending ?? 0), 0);
    const hasSeedData  = totalSeed > 0;

    return (
        <div className="min-h-screen bg-sys-50 p-6 md:p-10">
            {/* Header */}
            <div className="max-w-6xl mx-auto">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <Database size={20} className="text-brand" />
                            <h1 className="text-2xl font-black text-sys-900 tracking-tight">NOAR — Test QA</h1>
                        </div>
                        <p className="text-xs text-sys-500 font-mono">
                            {user?.email} · {user?.companyId}
                        </p>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        {/* Conexión */}
                        <div className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border',
                            isOnline
                                ? 'bg-green-50 border-green-200 text-green-700'
                                : 'bg-red-50 border-red-200 text-red-700'
                        )}>
                            {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
                            {isOnline ? 'Online' : 'Offline'}
                        </div>

                        {/* Seed badge */}
                        {hasSeedData && (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border bg-emerald-50 border-emerald-200 text-emerald-700">
                                🌱 Seed activo ({fmt(totalSeed)} registros)
                            </div>
                        )}

                        {/* Pendientes */}
                        {totalPending > 0 && (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border bg-orange-50 border-orange-200 text-orange-700">
                                ⏳ {fmt(totalPending)} pendiente{totalPending > 1 ? 's' : ''} de sync
                            </div>
                        )}

                        {/* Refresh */}
                        <button
                            onClick={loadStats}
                            disabled={loading}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border bg-white border-sys-200 text-sys-600 hover:bg-sys-50 transition-colors"
                        >
                            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                            Actualizar
                        </button>
                    </div>
                </div>

                {/* Resumen global */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    {[
                        { label: 'Total registros',    value: fmt(totalRecords), color: 'text-sys-900' },
                        { label: 'Tablas activas',     value: TABLES.length,    color: 'text-blue-600' },
                        { label: 'Registros seed',     value: fmt(totalSeed),   color: 'text-emerald-600' },
                        { label: 'Pendientes sync',    value: fmt(totalPending), color: totalPending > 0 ? 'text-orange-600' : 'text-sys-400' },
                    ].map(s => (
                        <div key={s.label} className="bg-white rounded-2xl border border-sys-200 p-4 shadow-sm">
                            <p className="text-[10px] font-semibold text-sys-500 uppercase tracking-wider mb-1">{s.label}</p>
                            <p className={cn('text-2xl font-black', s.color)}>{loading ? '...' : s.value}</p>
                        </div>
                    ))}
                </div>

                {/* Grid de tablas */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
                    {TABLES.map(t => (
                        <TableCard
                            key={t.key}
                            table={t}
                            stats={stats[t.key]}
                            loading={loading}
                        />
                    ))}
                </div>

                {/* Footer */}
                <div className="text-center text-[11px] text-sys-400 font-mono">
                    {refreshedAt ? `Actualizado a las ${refreshedAt}` : 'Cargando...'}
                    {' · '}
                    Consola: <code className="bg-sys-100 px-1 rounded">window.__noarSeed()</code>
                    {' / '}
                    <code className="bg-sys-100 px-1 rounded">window.__noarClear()</code>
                </div>
            </div>
        </div>
    );
};
