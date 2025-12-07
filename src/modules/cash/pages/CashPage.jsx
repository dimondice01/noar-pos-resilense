// src/modules/cash/pages/CashPage.jsx

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    Wallet, TrendingUp, TrendingDown, Clock, Lock, Unlock, 
    FileText, AlertTriangle, CheckCircle, Search, Eye, 
    ArrowRight, ShieldCheck, User, Calendar, MinusCircle, PlusCircle,
    DollarSign, RefreshCw 
} from 'lucide-react';
import { cashRepository } from '../repositories/cashRepository';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
// Asumimos que CashClosingModal está en su lugar
import { CashClosingModal } from '../components/CashClosingModal'; 

const formatCurrency = (amount) => `$ ${Number(amount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

// Función de ayuda para la visualización de movimientos
const getMovementProps = (mov) => {
    const isIncome = mov.type === 'SALE' || mov.type === 'DEPOSIT';
    const isCash = mov.method === 'cash' || mov.type === 'WITHDRAWAL'; 

    let sign = isIncome ? '+' : '-';
    let color = isIncome ? 'text-green-600' : 'text-red-600';
    let typeLabel = mov.type === 'SALE' ? 'VENTA' : mov.type === 'DEPOSIT' ? 'FONDO IN' : 'RETIRO/GTO';
    
    // 🔥 FIX CRÍTICO: Protección contra mov.method undefined
    let methodTag = (mov.method || 'desconocido'); 
    
    if (methodTag === 'cash') {
        methodTag = 'Efectivo';
    } else {
        methodTag = methodTag.toUpperCase();
    }

    // Si es un ingreso digital, es un tipo de ingreso diferente al efectivo esperado en caja
    if (mov.type === 'SALE' && !isCash) {
        color = 'text-blue-600';
        sign = '+';
    }
    
    // El depósito inicial es un caso especial
    if (mov.description === 'Fondo Inicial de Caja') {
        color = 'text-brand';
        sign = '+';
        typeLabel = 'INICIAL';
    }

    // Los retiros siempre restan efectivo
    if (mov.type === 'WITHDRAWAL') {
        color = 'text-red-600';
        sign = '-';
    }

    return { sign, color, typeLabel, methodTag };
};


// ============================================================================
// SUB-COMPONENTE: DETALLE DE AUDITORÍA (MODAL MEJORADO)
// ============================================================================
const AuditDetailModal = ({ shift, onClose }) => {
    const [details, setDetails] = useState(null);
    const [loadingDetails, setLoadingDetails] = useState(true);

    useEffect(() => {
        if (shift) {
            setLoadingDetails(true);
            cashRepository.getShiftBalance(shift.id).then(bal => {
                setDetails(bal);
            }).catch(err => {
                console.error("Error al cargar detalles de balance:", err);
            }).finally(() => {
                setLoadingDetails(false);
            });
        }
    }, [shift]);

    if (!shift) return null;

    if (loadingDetails) {
        return (
             <div className="fixed inset-0 z-[80] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in">
                 <Card className="p-8 text-center"><RefreshCw size={24} className="animate-spin text-brand" /></Card>
            </div>
        );
    }
    
    if (!details) return null; 

    // ✅ FIX CRÍTICO: Usamos Number() en todos los valores guardados
    const expectedRecalculated = Number(details.totalCash) || 0; 
    const declaredFinal = Number(shift.finalCash) || 0; 
    const initial = Number(shift.initialAmount) || 0;

    const diff = declaredFinal - expectedRecalculated; 
    const isPerfect = Math.abs(diff) < 0.01; 

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
                
                {/* Header del Modal */}
                <div className="p-5 border-b border-sys-100 bg-sys-50 flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-xl text-sys-900 flex items-center gap-2">
                            <ShieldCheck size={24} className="text-brand" /> Auditoría Detallada de Turno: <span className="font-black">{shift.userId}</span>
                        </h3>
                        <p className="text-xs text-sys-500 font-mono">
                            Apertura: {new Date(shift.openedAt).toLocaleString()}
                            {shift.closedAt && ` | Cierre: ${new Date(shift.closedAt).toLocaleString()}`}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-500"><div className="text-xl">×</div></button>
                </div>

                {/* Cuerpo del Reporte */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    
                    {/* 1. Resumen de Cierre Z */}
                    <div className="grid grid-cols-4 gap-4">
                        <div className="p-4 bg-sys-50 rounded-xl border border-sys-200 text-center">
                            <p className="text-xs uppercase font-bold text-sys-500 mb-1">Sistema (Esperado)</p>
                            {/* 🎯 Muestra el valor recalculado de los movimientos */}
                            <p className="text-xl font-bold text-sys-800">{formatCurrency(expectedRecalculated)}</p>
                            <p className="text-xs text-sys-400 mt-1">Fondo Inicial: {formatCurrency(initial)}</p>
                        </div>
                        <div className="p-4 bg-sys-50 rounded-xl border border-sys-200 text-center">
                            <p className="text-xs uppercase font-bold text-sys-500 mb-1">Cajero (Declarado)</p>
                             {/* 🎯 Muestra el valor declarado guardado en el shift */}
                            <p className="text-xl font-bold text-sys-900">{formatCurrency(declaredFinal)}</p>
                            <p className="text-xs text-sys-400 mt-1">Ventas Digitales: {formatCurrency(details.totalDigital)}</p>
                        </div>
                        <div className={cn("p-4 rounded-xl border text-center flex flex-col justify-center", 
                            isPerfect ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
                        )}>
                            <p className={cn("text-xs uppercase font-bold mb-1", isPerfect ? "text-green-600" : "text-red-600")}>
                                {isPerfect ? 'Caja Perfecta' : diff >= 0 ? 'Sobrante' : 'Faltante'}
                            </p>
                            <p className={cn("text-xl font-black", isPerfect ? "text-green-700" : "text-red-700")}>
                                {diff > 0 ? '+' : ''} {formatCurrency(diff)}
                            </p>
                        </div>
                        <div className={cn("p-4 rounded-xl border text-center flex flex-col justify-center", 
                            shift.audited ? "bg-blue-50 border-blue-200" : "bg-orange-50 border-orange-200"
                        )}>
                            <p className="text-xs uppercase font-bold text-sys-500 mb-1">Estado de Auditoría</p>
                            <p className={cn("text-lg font-black", shift.audited ? "text-blue-700" : "text-orange-700")}>
                                {shift.audited ? 'AUDITADO' : 'PENDIENTE'}
                            </p>
                        </div>
                    </div>

                    {/* 2. TABLA DE MOVIMIENTOS DETALLADOS */}
                    <div>
                        <h4 className="font-bold text-sys-800 mb-3 flex items-center gap-2">
                            <FileText size={16} /> Detalle de Movimientos de Tesorería ({details.movements.length})
                        </h4>
                        <div className="border border-sys-200 rounded-xl overflow-hidden">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-sys-50 text-xs uppercase font-semibold text-sys-500">
                                    <tr>
                                        <th className="p-3 w-1/12">Signo</th>
                                        <th className="p-3 w-2/12">Hora</th>
                                        <th className="p-3 w-2/12">Tipo</th>
                                        <th className="p-3 w-3/12">Concepto</th>
                                        <th className="p-3 w-2/12">Método</th>
                                        <th className="p-3 w-2/12 text-right">Monto</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-sys-100">
                                    {details.movements.map(m => {
                                        const { sign, color, typeLabel, methodTag } = getMovementProps(m);
                                        return (
                                            <tr key={m.id} className="hover:bg-sys-50">
                                                <td className="p-3 text-center">
                                                    {sign === '+' ? <PlusCircle size={14} className="text-green-600 mx-auto" /> : <MinusCircle size={14} className="text-red-600 mx-auto" />}
                                                </td>
                                                <td className="p-3 font-mono text-sys-500">{new Date(m.date).toLocaleTimeString()}</td>
                                                <td className="p-3">
                                                    <span className={cn("text-[10px] font-bold uppercase", color)}>
                                                        {typeLabel}
                                                    </span>
                                                </td>
                                                <td className="p-3">{m.description}</td>
                                                <td className="p-3 text-sys-500">{methodTag}</td>
                                                <td className={cn("p-3 text-right font-black", color)}>
                                                    {formatCurrency(m.amount)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {details.movements.length === 0 && (
                                         <tr><td colSpan="6" className="p-4 text-center text-sys-400">No hay movimientos registrados para este turno.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div className="p-5 border-t border-sys-100 bg-sys-50 flex justify-end">
                    <Button onClick={onClose} variant="secondary">Cerrar Detalle</Button>
                </div>
            </div>
        </div>
    );
};

// ============================================================================
// PÁGINA PRINCIPAL: TESORERÍA (USO DE ARCHIVO ORIGINAL CON ROL ÚNICO)
// ============================================================================
export const CashPage = () => {
    const navigate = useNavigate();
    const { user } = useAuthStore();
    
    const [activeTab, setActiveTab] = useState('active'); // 'active' | 'history'
    const [allShifts, setAllShifts] = useState([]);
    const [loading, setLoading] = useState(true);
    
    // Modales
    const [selectedShiftForAudit, setSelectedShiftForAudit] = useState(null);
    const [shiftToClose, setShiftToClose] = useState(null);

    // 🛡️ SEGURIDAD: Solo ADMIN
    useEffect(() => {
        if (user?.role?.toUpperCase() !== 'ADMIN') {
             console.warn("Acceso a /cash denegado. Redirigiendo a Dashboard.");
             navigate('/');
        }
    }, [user, navigate]);

    const loadData = async () => {
        setLoading(true);
        try {
            const shifts = await cashRepository.getAllShifts(); 
            setAllShifts(shifts.sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt)));
        } catch (error) {
            console.error("Error cargando historial:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadData(); }, []);

    const handleCloseShift = async (closingData) => {
        if (!shiftToClose) return;
        try {
            const balance = await cashRepository.getShiftBalance(shiftToClose.id);
            
            await cashRepository.closeShift(shiftToClose.id, {
                ...closingData,
                expectedCash: balance.totalCash, // Usamos el totalCash del balance
            });
            
            alert("✅ Turno cerrado correctamente.");
            setShiftToClose(null);
            loadData();
        } catch (error) {
            alert("Error: " + error.message);
        }
    };

    if (loading || user?.role?.toUpperCase() !== 'ADMIN') return <div className="p-10 text-center text-sys-500 animate-pulse">Cargando tesorería...</div>;

    const activeShifts = allShifts.filter(s => s.status === 'OPEN');
    const closedShifts = allShifts.filter(s => s.status === 'CLOSED');

    return (
        <div className="space-y-6 pb-20 animate-in fade-in">
            
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-sys-900 flex items-center gap-2">
                        <Wallet className="text-brand" /> Tesorería & Control
                    </h2>
                    <p className="text-sys-500 text-sm">Supervisión de cajas y auditoría de cierres.</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b border-sys-200">
                <button 
                    onClick={() => setActiveTab('active')}
                    className={cn("px-4 py-2 text-sm font-medium border-b-2 transition-colors", 
                        activeTab === 'active' ? "border-brand text-brand" : "border-transparent text-sys-500 hover:text-sys-800"
                    )}
                >
                    Cajas Activas ({activeShifts.length})
                </button>
                <button 
                    onClick={() => setActiveTab('history')}
                    className={cn("px-4 py-2 text-sm font-medium border-b-2 transition-colors", 
                        activeTab === 'history' ? "border-brand text-brand" : "border-transparent text-sys-500 hover:text-sys-800"
                    )}
                >
                    Historial de Cierres
                </button>
            </div>

            {/* VISTA 1: CAJAS ACTIVAS */}
            {activeTab === 'active' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in slide-in-from-left-4 duration-300">
                    {activeShifts.length === 0 ? (
                        <div className="col-span-full py-12 text-center text-sys-400 bg-sys-50 rounded-2xl border border-dashed border-sys-200">
                            <Lock size={48} className="mx-auto mb-3 opacity-20" />
                            <p>No hay cajas abiertas en este momento.</p>
                        </div>
                    ) : (
                        activeShifts.map(shift => (
                            <Card key={shift.id} className="relative overflow-hidden group border-l-4 border-l-green-500">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">Abierta</span>
                                            <span className="text-xs text-sys-400 font-mono">#{shift.id.slice(-4)}</span>
                                        </div>
                                        <h3 className="font-bold text-sys-900 text-lg flex items-center gap-2">
                                            <User size={18} className="text-sys-400" /> {shift.userId || 'Cajero'}
                                        </h3>
                                    </div>
                                    <div className="p-2 bg-green-50 text-green-600 rounded-lg">
                                        <Unlock size={24} />
                                    </div>
                                </div>
                                
                                <div className="space-y-2 mb-6">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-sys-500">Apertura</span>
                                        <span className="font-mono text-sys-700">{new Date(shift.openedAt).toLocaleTimeString()}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-sys-500">Fondo Inicial</span>
                                        <span className="font-mono font-bold text-sys-900">{formatCurrency(shift.initialAmount)}</span>
                                    </div>
                                </div>

                                <Button 
                                    onClick={() => setShiftToClose(shift)}
                                    variant="secondary" 
                                    className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                                >
                                    Forzar Cierre Z
                                </Button>
                            </Card>
                        ))
                    )}
                </div>
            )}

            {/* VISTA 2: HISTORIAL Y AUDITORÍA */}
            {activeTab === 'history' && (
                <Card className="p-0 overflow-hidden animate-in slide-in-from-right-4 duration-300">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-sys-50 text-sys-500 text-xs uppercase font-semibold border-b border-sys-100">
                                <tr>
                                    <th className="p-4">Fecha/Hora</th>
                                    <th className="p-4">Cajero</th>
                                    <th className="p-4 text-right">Sistema (Teórico)</th>
                                    <th className="p-4 text-right">Real (Ciego)</th>
                                    <th className="p-4 text-center">Desvío</th>
                                    <th className="p-4 text-center">Estado Z</th>
                                    <th className="p-4 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-sys-100">
                                {closedShifts.map(shift => {
                                    const expected = shift.expectedCash || 0;
                                    const final = shift.finalCash || 0;
                                    const diff = final - expected; 
                                    const isPerfect = Math.abs(diff) < 0.01; 

                                    return (
                                        <tr key={shift.id} className="hover:bg-sys-50 transition-colors group">
                                            <td className="p-4">
                                                <div className="font-bold text-sys-800">{new Date(shift.closedAt).toLocaleDateString()}</div>
                                                <div className="text-xs text-sys-400 font-mono">{new Date(shift.closedAt).toLocaleTimeString()}</div>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-brand/10 text-brand flex items-center justify-center text-xs font-bold">
                                                        {shift.userId?.charAt(0).toUpperCase()}
                                                    </div>
                                                    <span className="text-sys-700 font-medium">{shift.userId}</span>
                                                </div>
                                            </td>
                                            <td className="p-4 text-right font-mono text-sys-600">
                                                {formatCurrency(expected)}
                                            </td>
                                            <td className="p-4 text-right font-mono font-bold text-sys-900">
                                                {formatCurrency(final)}
                                            </td>
                                            <td className="p-4 text-center">
                                                <span className={cn(
                                                    "px-2 py-1 rounded text-xs font-bold border",
                                                    isPerfect 
                                                        ? "bg-green-50 text-green-700 border-green-200" 
                                                        : "bg-red-50 text-red-700 border-red-200"
                                                )}>
                                                    {isPerfect ? 'OK' : `${diff > 0 ? '+' : ''}${formatCurrency(diff)}`}
                                                </span>
                                            </td>
                                            <td className="p-4 text-center">
                                                <span className={cn(
                                                    "px-2 py-1 rounded text-xs font-bold border",
                                                    shift.audited
                                                        ? "bg-blue-50 text-blue-700 border-blue-200"
                                                        : "bg-orange-50 text-orange-700 border-orange-200"
                                                )}>
                                                    {shift.audited ? 'FINAL' : 'PENDIENTE'}
                                                </span>
                                            </td>
                                            <td className="p-4 text-right">
                                                <button 
                                                    onClick={() => setSelectedShiftForAudit(shift)}
                                                    className="p-2 hover:bg-sys-200 rounded-lg text-sys-400 hover:text-brand transition-colors"
                                                    title="Ver Movimientos Detallados"
                                                >
                                                    <Eye size={18} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {/* Modales */}
            
            {/* 1. Detalle de Auditoría (Mejorado) */}
            <AuditDetailModal 
                shift={selectedShiftForAudit} 
                onClose={() => setSelectedShiftForAudit(null)} 
            />

            {/* 2. Cierre de Turno (Reutilizamos componente) */}
            {shiftToClose && (
                <CashClosingModalWrapper 
                    isOpen={true}
                    shift={shiftToClose}
                    onClose={() => setShiftToClose(null)}
                    onConfirm={handleCloseShift}
                />
            )}

        </div>
    );
};

// Wrapper auxiliar para obtener el balance antes de renderizar el modal de cierre
const CashClosingModalWrapper = ({ isOpen, shift, onClose, onConfirm }) => {
    const [totals, setTotals] = useState(null);

    useEffect(() => {
        // Obtenemos el balance justo antes de mostrar el modal
        cashRepository.getShiftBalance(shift.id).then(bal => {
            setTotals({ totalCash: bal.totalCash, totalDigital: bal.totalDigital });
        });
    }, [shift]);

    if (!totals) return null;

    return (
        <CashClosingModal 
            isOpen={isOpen}
            onClose={onClose}
            systemTotals={totals} 
            onConfirm={onConfirm}
        />
    );
};