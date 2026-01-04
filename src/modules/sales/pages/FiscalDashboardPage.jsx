import React, { useState, useEffect } from 'react';
import { 
    Shield, TrendingUp, AlertTriangle, Calendar, 
    FileText, DollarSign, Settings, CheckCircle2,
    ArrowDown, ArrowUp, Search, Receipt
} from 'lucide-react';
import { getDB } from '../../../database/db'; // Acceso directo a IndexedDB
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

// Helper de Moneda
const money = (val) => val ? val.toLocaleString('es-AR', {minimumFractionDigits: 2}) : '0.00';

export const FiscalDashboardPage = () => {
    const [loading, setLoading] = useState(true);
    const [sales, setSales] = useState([]);
    const [filteredSales, setFilteredSales] = useState([]);
    
    // Configuración
    const [timeframe, setTimeframe] = useState('month'); // 'day', 'week', 'month'
    const [monthlyLimit, setMonthlyLimit] = useState(0);
    const [isEditingLimit, setIsEditingLimit] = useState(false);
    
    // Métricas
    const [metrics, setMetrics] = useState({ total: 0, count: 0, average: 0 });

    // 1. Cargar Datos y Configuración
    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                // Cargar límite guardado (Persistencia Local)
                const savedLimit = localStorage.getItem('fiscal_limit_reference');
                if (savedLimit) setMonthlyLimit(parseFloat(savedLimit));

                // Cargar Ventas Locales
                const dbLocal = await getDB();
                const allSales = await dbLocal.getAll('sales');
                
                // Filtrar SOLO Fiscalizadas (Aprobadas por ARCA)
                const fiscalized = allSales.filter(s => s.afip?.status === 'APPROVED');
                
                // Ordenar por fecha descendente
                fiscalized.sort((a, b) => new Date(b.date) - new Date(a.date));
                
                setSales(fiscalized);
            } catch (error) {
                console.error("Error cargando fiscal data:", error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, []);

    // 2. Efecto de Filtrado Temporal
    useEffect(() => {
        const now = new Date();
        let start = new Date();
        let end = new Date(); // Ahora

        if (timeframe === 'day') {
            start.setHours(0,0,0,0);
        } else if (timeframe === 'week') {
            // Inicio de semana (Lunes)
            const day = now.getDay() || 7; 
            if (day !== 1) start.setHours(-24 * (day - 1)); 
            start.setHours(0,0,0,0);
        } else if (timeframe === 'month') {
            // Del 1 al último día
            start = new Date(now.getFullYear(), now.getMonth(), 1);
        }

        const filtered = sales.filter(s => {
            const date = new Date(s.date);
            return date >= start && date <= end;
        });

        setFilteredSales(filtered);

        // Calcular Métricas
        const total = filtered.reduce((acc, s) => acc + (parseFloat(s.total) || 0), 0);
        setMetrics({
            total,
            count: filtered.length,
            average: filtered.length ? total / filtered.length : 0
        });

    }, [sales, timeframe]);

    // 3. Guardar Límite
    const handleSaveLimit = (e) => {
        e.preventDefault();
        const form = e.target;
        const val = parseFloat(form.limitInput.value);
        if (!isNaN(val)) {
            setMonthlyLimit(val);
            localStorage.setItem('fiscal_limit_reference', val);
            setIsEditingLimit(false);
        }
    };

    // Cálculos de Progreso (Solo aplica si estamos viendo el MES)
    const progressPercent = monthlyLimit > 0 ? (metrics.total / monthlyLimit) * 100 : 0;
    const isOverLimit = progressPercent > 100;
    const isNearLimit = progressPercent > 80;

    if (loading) return <div className="p-10 text-center text-sys-500 font-medium animate-pulse">Analizando comprobantes...</div>;

    return (
        <div className="space-y-6 pb-20 p-4 md:p-6 max-w-7xl mx-auto">
            
            {/* HEADER */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-black text-sys-900 flex items-center gap-2">
                        <Shield className="text-brand" /> Gestión Fiscal ARCA
                    </h1>
                    <p className="text-sm text-sys-500">Monitor de facturación electrónica y límites.</p>
                </div>
                
                {/* Selector Temporal */}
                <div className="flex bg-white p-1 rounded-xl border border-sys-200 shadow-sm">
                    {[
                        { id: 'day', label: 'Hoy' },
                        { id: 'week', label: 'Esta Semana' },
                        { id: 'month', label: 'Este Mes' }
                    ].map(t => (
                        <button
                            key={t.id}
                            onClick={() => setTimeframe(t.id)}
                            className={cn(
                                "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                                timeframe === t.id 
                                    ? "bg-sys-900 text-white shadow-md" 
                                    : "text-sys-500 hover:bg-sys-50 hover:text-sys-900"
                            )}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* TERMÓMETRO FISCAL (SOLO MES) */}
            {timeframe === 'month' && (
                <Card className={cn("border-l-4 p-6 shadow-md transition-colors", 
                    isOverLimit ? "border-l-red-500 bg-red-50/50" : isNearLimit ? "border-l-orange-500 bg-orange-50/50" : "border-l-brand bg-white"
                )}>
                    <div className="flex justify-between items-end mb-4">
                        <div>
                            <p className="text-xs font-bold uppercase text-sys-500 mb-1 flex items-center gap-2">
                                <TrendingUp size={16}/> Facturación Mensual Acumulada
                            </p>
                            <div className="flex items-baseline gap-2">
                                <h2 className="text-3xl font-black text-sys-900">$ {money(metrics.total)}</h2>
                                {monthlyLimit > 0 && (
                                    <span className="text-sm font-medium text-sys-500">
                                        / $ {money(monthlyLimit)}
                                    </span>
                                )}
                            </div>
                        </div>
                        
                        <div className="text-right">
                            {!isEditingLimit ? (
                                <button 
                                    onClick={() => setIsEditingLimit(true)} 
                                    className="text-xs font-bold text-brand hover:underline flex items-center justify-end gap-1"
                                >
                                    <Settings size={12}/> {monthlyLimit > 0 ? "Editar Límite" : "Configurar Límite"}
                                </button>
                            ) : (
                                <form onSubmit={handleSaveLimit} className="flex gap-2 items-center">
                                    <input 
                                        name="limitInput" 
                                        type="number" 
                                        defaultValue={monthlyLimit} 
                                        className="w-32 p-1 text-sm border rounded outline-none focus:border-brand"
                                        autoFocus
                                    />
                                    <button type="submit" className="bg-brand text-white px-2 py-1 rounded text-xs">Guardar</button>
                                </form>
                            )}
                        </div>
                    </div>

                    {/* Barra de Progreso */}
                    {monthlyLimit > 0 ? (
                        <div className="space-y-2">
                            <div className="h-4 w-full bg-sys-200 rounded-full overflow-hidden shadow-inner">
                                <div 
                                    className={cn("h-full transition-all duration-1000 ease-out relative", 
                                        isOverLimit ? "bg-red-500" : isNearLimit ? "bg-orange-500" : "bg-brand"
                                    )}
                                    style={{ width: `${Math.min(progressPercent, 100)}%` }}
                                >
                                    {/* Brillo animado */}
                                    <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                                </div>
                            </div>
                            <div className="flex justify-between text-[10px] font-bold uppercase">
                                <span className="text-sys-400">0%</span>
                                <span className={cn(isOverLimit ? "text-red-600" : isNearLimit ? "text-orange-600" : "text-brand")}>
                                    {progressPercent.toFixed(1)}% Consumido
                                </span>
                                <span className="text-sys-400">100%</span>
                            </div>
                            {isNearLimit && !isOverLimit && (
                                <p className="text-xs text-orange-600 font-bold flex items-center gap-1 mt-2">
                                    <AlertTriangle size={14}/> Atención: Estás cerca del límite mensual establecido.
                                </p>
                            )}
                            {isOverLimit && (
                                <p className="text-xs text-red-600 font-bold flex items-center gap-1 mt-2">
                                    <AlertTriangle size={14}/> Alerta: Has superado tu límite de referencia.
                                </p>
                            )}
                        </div>
                    ) : (
                        <div className="bg-sys-100 p-3 rounded-lg text-xs text-sys-500 text-center">
                            Configura un límite de referencia (ej: Monotributo) para ver tu barra de progreso.
                        </div>
                    )}
                </Card>
            )}

            {/* KPI CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="p-4 border border-sys-200 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-blue-50 text-blue-600 rounded-xl"><FileText size={24}/></div>
                    <div>
                        <p className="text-xs text-sys-500 font-bold uppercase">Comprobantes</p>
                        <p className="text-2xl font-black text-sys-900">{metrics.count}</p>
                    </div>
                </Card>
                <Card className="p-4 border border-sys-200 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-green-50 text-green-600 rounded-xl"><DollarSign size={24}/></div>
                    <div>
                        <p className="text-xs text-sys-500 font-bold uppercase">Ticket Promedio</p>
                        <p className="text-2xl font-black text-sys-900">$ {money(metrics.average)}</p>
                    </div>
                </Card>
                <Card className="p-4 border border-sys-200 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-purple-50 text-purple-600 rounded-xl"><Calendar size={24}/></div>
                    <div>
                        <p className="text-xs text-sys-500 font-bold uppercase">Última Factura</p>
                        <p className="text-sm font-bold text-sys-900">
                            {filteredSales.length > 0 ? new Date(filteredSales[0].date).toLocaleString() : '-'}
                        </p>
                    </div>
                </Card>
            </div>

            {/* TABLA DE COMPROBANTES */}
            <Card className="overflow-hidden border border-sys-200 shadow-md">
                <div className="p-4 bg-sys-50 border-b border-sys-200 flex justify-between items-center">
                    <h3 className="font-bold text-sys-800 flex items-center gap-2">
                        <Receipt size={18}/> Detalle de Comprobantes ({filteredSales.length})
                    </h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-white text-sys-500 text-xs uppercase font-bold border-b border-sys-100">
                            <tr>
                                <th className="p-4">Fecha</th>
                                <th className="p-4">Tipo</th>
                                <th className="p-4">CAE</th>
                                <th className="p-4">Vencimiento</th>
                                <th className="p-4 text-right">Monto</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-sys-100">
                            {filteredSales.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-sys-400 italic">
                                        No hay facturas emitidas en este período.
                                    </td>
                                </tr>
                            ) : (
                                filteredSales.map((sale) => (
                                    <tr key={sale.id} className="hover:bg-sys-50 transition-colors">
                                        <td className="p-4 text-sys-600 font-mono">
                                            {new Date(sale.date).toLocaleString()}
                                        </td>
                                        <td className="p-4">
                                            <span className="bg-sys-100 text-sys-700 px-2 py-1 rounded text-xs font-bold border border-sys-200">
                                                Factura {sale.afip?.cbteLetra || 'B'}
                                            </span>
                                        </td>
                                        <td className="p-4 text-sys-500 font-mono text-xs">
                                            {sale.afip?.cae || '-'}
                                        </td>
                                        <td className="p-4 text-sys-500 font-mono text-xs">
                                            {sale.afip?.vtoCAE || '-'}
                                        </td>
                                        <td className="p-4 text-right font-bold text-sys-900">
                                            $ {money(sale.total)}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
};