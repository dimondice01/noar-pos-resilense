import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
    Plus, Search, Edit2, Trash2, Package, AlertTriangle,
    ArrowUpRight, Filter, CheckSquare, Square, X, History,
    Printer, ArrowRightLeft, Calendar, ChevronLeft, ChevronRight, ChevronDown,
    Upload, MoreVertical, MapPin,
    Tag, Percent, Megaphone, MoreHorizontal, LayoutGrid, DollarSign,
    CalendarClock, Info, Scale, Save, Pencil, Loader2, ArrowDown, ArrowUp, Minus, ShieldAlert, Lock, FileSpreadsheet, ShoppingBag, Link
} from 'lucide-react';
import { exportInventoryToExcel, ALL_EXPORT_COLUMNS } from '../../../core/utils/exportInventoryToExcel';
import toast from 'react-hot-toast';

import { productRepository } from '../repositories/productRepository';
import { masterRepository } from '../repositories/masterRepository';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { syncService } from '../../sync/services/syncService';
import { scaleService } from '../services/scaleService';

import { ProductModal } from '../components/ProductModal';
import { ComboModal } from '../components/ComboModal';
import { AnexarModal } from '../components/AnexarModal';
import { MastersModal } from '../components/MastersModal';
import { ImportMapperModal } from '../components/ImportMapperModal';
import { BatchMermaModal } from '../components/BatchMermaModal';
import { cn } from '../../../core/utils/cn';
import { Button } from '../../../core/ui/Button';

import { collection, getDocs, query, where, documentId } from 'firebase/firestore';
import { securityService } from '../../security/services/securityService';
import { db } from '../../../database/firebase';
const firestoreDB = db;
import { getDB } from '../../../database/db';

// Collator reutilizable — instanciar una sola vez evita ~50k creaciones por sort
const nameCollator = new Intl.Collator('es', { sensitivity: 'base' });

// =================================================================
// 🧠 HELPER FUNCTIONS
// =================================================================

const formatMoney = (amount) => {
    return amount ? amount.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '0';
};

const formatStock = (stock) => {
    if (stock === undefined || stock === null) return '0';
    return Number(stock) % 1 === 0 ? Number(stock).toFixed(0) : Number(stock).toFixed(3);
};

const getActivePromo = (product, now) => {
    if (!product.promo) return null;
    const start = product.promo.startDate ? new Date(product.promo.startDate + 'T00:00:00') : null;
    const end = product.promo.endDate ? new Date(product.promo.endDate + 'T23:59:59') : null;

    if (start && end && now >= start && now <= end) {
        return product.promo;
    }
    return null;
};

const getLocalDate = () => {
    return new Date().toLocaleDateString('sv-SE');
};

// Sentinel para filtrar productos sin categoría/proveedor asignado
const UNASSIGNED = '__unassigned__';

// =================================================================
// 🔐 MODAL: AUTORIZACIÓN POR PIN (SUPERVISOR) 🔥
// =================================================================
const PinVerificationModal = ({ isOpen, onClose, onSuccess, actionName }) => {
    const [pin, setPin] = useState('');
    const [error, setError] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            setPin('');
            setError(false);
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    const handleVerify = async (e) => {
        e.preventDefault();
        const ok = await securityService.verifyPin(pin);
        if (ok) { onSuccess(); onClose(); }
        else { setError(true); setPin(''); inputRef.current?.focus(); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-sys-900/80 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center">
                <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-100">
                    <Lock size={32} />
                </div>
                <h3 className="text-xl font-black text-sys-900 mb-1">Autorización Requerida</h3>
                <p className="text-xs text-sys-500 font-bold mb-6 uppercase tracking-wider">
                    Permiso necesario para: <span className="text-brand">{actionName}</span>
                </p>

                <form onSubmit={handleVerify} className="space-y-4">
                    <div>
                        <input
                            ref={inputRef}
                            type="password"
                            maxLength={6}
                            placeholder="Ingrese PIN del Encargado"
                            className={cn(
                                "w-full text-center text-2xl tracking-[0.5em] font-black p-4 bg-sys-50 border-2 rounded-2xl outline-none transition-all",
                                error ? "border-red-500 text-red-500 bg-red-50 animate-shake" : "border-sys-200 focus:border-brand"
                            )}
                            value={pin}
                            onChange={(e) => {
                                setError(false);
                                setPin(e.target.value.replace(/\D/g, '')); // Solo números
                            }}
                        />
                        {error && <p className="text-xs font-bold text-red-500 mt-2">PIN Incorrecto</p>}
                    </div>

                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={onClose} type="button" className="flex-1">Cancelar</Button>
                        <Button type="submit" disabled={pin.length < 4} className="flex-1 bg-sys-900 hover:bg-black text-white shadow-xl">Autorizar</Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// =================================================================
// ⌨️ COMPONENTE CELDA EDITABLE (AUDITORÍA RÁPIDA)
// =================================================================
const EditableCell = React.memo(({
    value,
    id,
    field,
    productId,
    onSave,
    type = "text",
    prefix = "",
    disabled = false,
    nextRowId = null,
    prevRowId = null,
    className,
    onRequestAuth // 🔥 Callback si no tiene permisos
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [localValue, setLocalValue] = useState(value);
    const inputRef = useRef(null);

    useEffect(() => { setLocalValue(value); }, [value]);

    useEffect(() => {
        if (isEditing && !disabled && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing, disabled]);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            inputRef.current.blur();
        }
        if (e.key === 'ArrowDown' && nextRowId) {
            e.preventDefault();
            const nextEl = document.getElementById(`cell-${nextRowId}-${field}`);
            if (nextEl && !disabled) nextEl.click();
        }
        if (e.key === 'ArrowUp' && prevRowId) {
            e.preventDefault();
            const prevEl = document.getElementById(`cell-${prevRowId}-${field}`);
            if (prevEl && !disabled) prevEl.click();
        }
    };

    const handleBlur = () => {
        setIsEditing(false);
        if (!disabled && localValue != value) {
            onSave(productId, field, localValue);
        } else {
            setLocalValue(value); // Restaura si canceló
        }
    };

    const handleClick = () => {
        if (disabled) return;

        // Verificamos permisos antes de entrar a edición
        if (onRequestAuth) {
            const canEdit = onRequestAuth(productId, field, localValue);
            if (canEdit) setIsEditing(true);
        } else {
            setIsEditing(true);
        }
    };

    if (disabled || !isEditing) {
        return (
            <div
                id={`cell-${productId}-${field}`}
                onClick={handleClick}
                className={cn(
                    "p-2 rounded transition-colors text-right border border-transparent",
                    !disabled && "cursor-pointer hover:bg-sys-100 hover:border-sys-200",
                    disabled && "cursor-default text-sys-500",
                    className
                )}
            >
                <span className="font-mono text-xs font-bold">
                    {prefix}{type === 'number' ? (field === 'stock' ? formatStock(localValue) : formatMoney(localValue)) : localValue}
                </span>
            </div>
        );
    }

    return (
        <div className="p-1">
            <input
                ref={inputRef}
                type={type}
                className="w-full h-8 text-xs font-bold border-2 border-brand rounded px-1 outline-none text-right bg-white shadow-lg"
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
            />
        </div>
    );
});

// =================================================================
// 1. STOCK ENTRY MODAL
// =================================================================
const StockEntryModal = ({ isOpen, onClose, product, onConfirm }) => {
    if (!isOpen || !product) return null;

    const [qty, setQty] = useState('');
    const [reason, setReason] = useState('Ajuste de Conteo');
    const [moveType, setMoveType] = useState('STOCK_ADJUST_IN'); // Default: Ingreso Manual
    const inputRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            setQty('');
            setReason('Ajuste de Conteo');
            setMoveType('STOCK_ADJUST_IN');
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    const handleConfirm = () => {
        const val = parseFloat(qty);
        if (!val || val === 0) return toast.error("Ingrese una cantidad válida");

        let finalQty = val;
        if (['MERMA', 'STOCK_ADJUST_OUT'].includes(moveType) && finalQty > 0) {
            finalQty = -finalQty;
        } else if (moveType === 'STOCK_ADJUST_IN' && finalQty < 0) {
            finalQty = Math.abs(finalQty);
        }

        onConfirm(product.id, finalQty, reason, moveType);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
                <div className="p-5 bg-sys-900 text-white flex justify-between items-center">
                    <h3 className="font-bold flex items-center gap-2 text-lg"><Package size={20} /> Ajuste de Inventario</h3>
                    <button onClick={onClose} className="hover:bg-white/20 p-1.5 rounded-full transition-colors"><X size={20} /></button>
                </div>
                <div className="p-6 space-y-6">
                    <div className="bg-sys-50 p-4 rounded-xl border border-sys-200">
                        <p className="text-[10px] text-sys-500 uppercase font-black tracking-widest mb-1">Producto a modificar</p>
                        <p className="text-base font-black text-sys-900 leading-tight uppercase">{product.name}</p>
                        <p className="text-xs font-bold text-sys-500 mt-1">Stock Actual: <span className="font-mono text-brand">{product.stock || 0}</span></p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => { setMoveType('STOCK_ADJUST_IN'); setReason('Ingreso Manual'); }}
                            className={cn("p-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all", moveType === 'STOCK_ADJUST_IN' ? "border-green-500 bg-green-50 text-green-700" : "border-sys-200 text-sys-500 hover:border-sys-300")}
                        >
                            <Plus size={20} className={moveType === 'STOCK_ADJUST_IN' ? "text-green-500" : "text-sys-400"} />
                            <span className="text-xs font-bold uppercase tracking-wide">Ingreso (+)</span>
                        </button>
                        <button
                            onClick={() => { setMoveType('MERMA'); setReason('Merma / Rotura'); }}
                            className={cn("p-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all", moveType === 'MERMA' ? "border-red-500 bg-red-50 text-red-700" : "border-sys-200 text-sys-500 hover:border-sys-300")}
                        >
                            <ShieldAlert size={20} className={moveType === 'MERMA' ? "text-red-500" : "text-sys-400"} />
                            <span className="text-xs font-bold uppercase tracking-wide">Merma (-)</span>
                        </button>
                    </div>

                    <div>
                        <label className="text-[10px] text-sys-500 uppercase font-black tracking-widest mb-2 block">Cantidad a modificar</label>
                        <input
                            ref={inputRef}
                            type="number"
                            className={cn("w-full text-3xl font-black p-4 border-2 rounded-2xl outline-none text-center transition-colors",
                                moveType === 'MERMA' ? "bg-red-50 border-red-200 text-red-600 focus:border-red-500" : "bg-green-50 border-green-200 text-green-600 focus:border-green-500"
                            )}
                            placeholder="0"
                            value={qty}
                            onChange={e => setQty(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleConfirm()}
                        />
                    </div>

                    <div>
                        <label className="text-[10px] text-sys-500 uppercase font-black tracking-widest mb-2 block">Detalle / Motivo</label>
                        <input
                            type="text"
                            className="w-full text-sm font-bold p-3 bg-white border-2 border-sys-200 rounded-xl focus:border-sys-400 outline-none transition-colors"
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            placeholder="Ej: Se rompió, Vencido, Conteo a favor..."
                            onKeyDown={e => e.key === 'Enter' && handleConfirm()}
                        />
                    </div>

                    <Button
                        onClick={handleConfirm}
                        className={cn("w-full py-4 text-base font-black shadow-lg transition-all",
                            moveType === 'MERMA' ? "bg-red-600 hover:bg-red-700 shadow-red-200" : "bg-green-600 hover:bg-green-700 shadow-green-200"
                        )}
                    >
                        {moveType === 'MERMA' ? 'RESTAR STOCK' : 'SUMAR STOCK'}
                    </Button>
                </div>
            </div>
        </div>
    );
};

// =================================================================
// 2. SCALE EXPORT MODAL 
// =================================================================
const ScaleExportModal = ({ isOpen, onClose, onExport, onChangeLocation }) => {
    const [forceCategory, setForceCategory] = useState(false);
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
                <div className="p-6 border-b border-sys-100 bg-sys-50 flex justify-between items-center">
                    <div>
                        <h3 className="font-black text-xl text-sys-900 flex items-center gap-2">
                            <Scale className="text-brand" /> Exportar a Balanza
                        </h3>
                        <p className="text-xs text-sys-500 mt-1">Seleccione el modelo para generar el archivo</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full"><X size={20} className="text-sys-400" /></button>
                </div>
                <div className="px-6 pt-4">
                    <label className="flex items-start gap-2 p-3 bg-sys-50 border border-sys-200 rounded-xl cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={forceCategory}
                            onChange={e => setForceCategory(e.target.checked)}
                            className="w-4 h-4 mt-0.5 accent-brand rounded"
                        />
                        <span className="text-xs">
                            <span className="font-black text-sys-800 block">Forzar categoría</span>
                            <span className="text-sys-500">Todos los productos exportados adoptan la categoría del primer producto. Solo aplica al formato SYSTEL (KRETZ no usa categorías).</span>
                        </span>
                    </label>
                </div>
                <div className="p-6 grid grid-cols-2 gap-4">
                    <button
                        onClick={() => onExport('KRETZ', forceCategory)}
                        className="flex flex-col items-center justify-center gap-3 p-6 border-2 border-sys-200 rounded-2xl hover:border-brand hover:bg-brand/5 hover:scale-[1.02] transition-all group"
                    >
                        <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center group-hover:bg-brand group-hover:text-white transition-colors">
                            <Scale size={24} />
                        </div>
                        <span className="font-black text-sys-800">KRETZ</span>
                        <span className="text-[10px] text-sys-400 font-mono bg-sys-100 px-2 py-1 rounded">iTegra / Report</span>
                    </button>

                    <button
                        onClick={() => onExport('SYSTEL', forceCategory)}
                        className="flex flex-col items-center justify-center gap-3 p-6 border-2 border-sys-200 rounded-2xl hover:border-purple-500 hover:bg-purple-50 hover:scale-[1.02] transition-all group"
                    >
                        <div className="w-12 h-12 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center group-hover:bg-purple-600 group-hover:text-white transition-colors">
                            <Scale size={24} />
                        </div>
                        <span className="font-black text-sys-800">SYSTEL</span>
                        <span className="text-[10px] text-sys-400 font-mono bg-sys-100 px-2 py-1 rounded">Qendra / Cuora</span>
                    </button>
                </div>
                <div className="px-6 pb-6 text-center space-y-2">
                    <p className="text-[10px] text-sys-400 bg-yellow-50 text-yellow-700 p-2 rounded-lg border border-yellow-100">
                        ⚠️ Al descargar, guarde el archivo en la carpeta monitoreada por el software de la balanza.
                    </p>
                    <button
                        onClick={onChangeLocation}
                        className="text-xs font-bold text-sys-500 hover:text-brand underline"
                    >
                        Cambiar nombre/ubicación del archivo
                    </button>
                </div>
            </div>
        </div>
    );
};

// =================================================================
// 3. BULK UPDATE MODAL
// =================================================================
const BulkUpdateModal = ({ isOpen, onClose, onConfirm, allProducts, masters, manualSelectionIds }) => {
    if (!isOpen) return null;
    const [activeTab, setActiveTab] = useState('manual');
    const [targetId, setTargetId] = useState('');
    const [costPct, setCostPct] = useState(0);
    const [pricePct, setPricePct] = useState(0);
    const [targetList, setTargetList] = useState([]);

    const [activationDate, setActivationDate] = useState('');
    const [isScheduled, setIsScheduled] = useState(false);

    const [draftValues, setDraftValues] = useState({});

    useEffect(() => {
        let list = [];
        if (activeTab === 'manual') list = allProducts.filter(p => manualSelectionIds.has(p.id));
        else if (activeTab === 'brand' && targetId) list = allProducts.filter(p => p.brand === targetId);
        else if (activeTab === 'category' && targetId) list = allProducts.filter(p => p.category === targetId);

        setTargetList(list);

        setDraftValues(prev => {
            const next = { ...prev };
            list.forEach(p => {
                if (!next[p.id]) {
                    next[p.id] = { cost: p.cost || 0, price: p.price || 0 };
                }
            });
            return next;
        });
    }, [activeTab, targetId, manualSelectionIds, allProducts]);

    const handleCostPctChange = (val) => {
        const pct = parseFloat(val) || 0;
        setCostPct(pct);
        setDraftValues(prev => {
            const next = { ...prev };
            targetList.forEach(p => {
                const c = (p.cost || 0) * (1 + pct / 100);
                next[p.id] = { ...next[p.id], cost: parseFloat(c.toFixed(2)) };
            });
            return next;
        });
    };

    const handlePricePctChange = (val) => {
        const pct = parseFloat(val) || 0;
        setPricePct(pct);
        setDraftValues(prev => {
            const next = { ...prev };
            targetList.forEach(p => {
                const calculatedPrice = (p.price || 0) * (1 + pct / 100);
                const pr = pct === 0 ? p.price : Math.ceil(calculatedPrice / 10) * 10;
                next[p.id] = { ...next[p.id], price: pr };
            });
            return next;
        });
    };

    const handleManualChange = (id, field, val) => {
        setDraftValues(prev => ({
            ...prev,
            [id]: { ...prev[id], [field]: val }
        }));
    };

    const todayStr = getLocalDate();

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">

                <div className="p-5 border-b border-sys-100 bg-sys-50 flex justify-between items-center shrink-0">
                    <div>
                        <h3 className="font-black text-xl text-sys-900 flex items-center gap-2"><ArrowUpRight className="text-brand" /> Actualización de Precios</h3>
                        <p className="text-[10px] text-sys-500 font-bold uppercase tracking-wider">Ajuste manual o por porcentaje para {targetList.length} productos</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full transition-colors"><X size={20} className="text-sys-400" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-white">

                    <div className="flex bg-sys-100 p-1.5 rounded-2xl shrink-0">
                        {['manual', 'brand', 'category'].map(t => (
                            <button
                                key={t}
                                onClick={() => { setActiveTab(t); setTargetId(''); }}
                                className={cn("flex-1 py-2.5 text-xs font-black rounded-xl capitalize transition-all",
                                    activeTab === t ? "bg-white shadow-lg text-brand scale-[1.02]" : "text-sys-500 hover:text-sys-700")}
                            >
                                {t === 'manual' ? 'Seleccionados' : t === 'brand' ? 'Por Marca' : 'Por Categoría'}
                            </button>
                        ))}
                    </div>

                    <div className="shrink-0">
                        {activeTab === 'brand' && (
                            <select className="w-full p-3.5 border-2 border-sys-100 rounded-2xl text-sm font-bold bg-white outline-none focus:border-brand transition-all" onChange={(e) => setTargetId(e.target.value)}>
                                <option value="">Selecciona una Marca...</option>
                                {masters.brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                            </select>
                        )}
                        {activeTab === 'category' && (
                            <select className="w-full p-3.5 border-2 border-sys-100 rounded-2xl text-sm font-bold bg-white outline-none focus:border-brand transition-all" onChange={(e) => setTargetId(e.target.value)}>
                                <option value="">Selecciona una Categoría...</option>
                                {masters.categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                            </select>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-4 shrink-0 bg-brand/5 p-4 rounded-2xl border border-brand/10">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-sys-600 uppercase ml-1">Auto-completar Costo (+%)</label>
                            <div className="relative">
                                <Percent className="absolute left-3 top-3 text-sys-400" size={16} />
                                <input type="number" className="w-full p-3 pl-9 border-2 border-sys-200 rounded-2xl font-bold outline-none focus:border-sys-400 transition-all bg-white" placeholder="Ej: 10" value={costPct || ''} onChange={e => handleCostPctChange(e.target.value)} />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-brand uppercase ml-1">Auto-completar Precio (+%)</label>
                            <div className="relative">
                                <Percent className="absolute left-3 top-3 text-brand/40" size={16} />
                                <input type="number" className="w-full p-3 pl-9 border-2 border-brand/20 bg-white rounded-2xl font-black text-brand outline-none focus:border-brand transition-all shadow-sm" placeholder="Ej: 15" value={pricePct || ''} onChange={e => handlePricePctChange(e.target.value)} />
                            </div>
                        </div>
                    </div>

                    <div className={cn("p-4 rounded-2xl border-2 transition-all cursor-pointer select-none shrink-0", isScheduled ? "bg-orange-50 border-orange-300 ring-2 ring-orange-100" : "bg-white border-sys-200 hover:bg-sys-50")} onClick={() => setIsScheduled(!isScheduled)}>
                        <div className="flex items-center gap-3">
                            <div className={cn("w-6 h-6 rounded-md flex items-center justify-center border-2 transition-colors shrink-0", isScheduled ? "bg-orange-500 border-orange-500 text-white" : "bg-white border-sys-300 text-transparent")}>
                                <CheckSquare size={16} fill="currentColor" />
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <CalendarClock size={18} className={cn(isScheduled ? "text-orange-600" : "text-sys-400")} />
                                    <span className={cn("text-sm font-bold", isScheduled ? "text-orange-800" : "text-sys-600")}>
                                        Programar para fecha futura
                                    </span>
                                </div>
                            </div>
                        </div>

                        {isScheduled && (
                            <div className="mt-4 pt-3 border-t border-orange-200" onClick={(e) => e.stopPropagation()}>
                                <label className="text-[10px] font-bold text-orange-700 uppercase mb-1.5 block">Fecha de Aplicación</label>
                                <input
                                    type="date"
                                    className="w-full p-3 border-2 border-orange-300 rounded-xl font-bold text-sm outline-none focus:border-orange-500 bg-white text-orange-900 shadow-sm"
                                    min={todayStr}
                                    value={activationDate}
                                    onChange={e => setActivationDate(e.target.value)}
                                />
                                <div className="flex gap-2 mt-3 p-2 bg-white/60 rounded-lg border border-orange-100">
                                    <Info size={14} className="text-orange-500 shrink-0 mt-0.5" />
                                    <p className="text-[10px] text-orange-800 font-medium leading-tight">
                                        {activationDate === todayStr
                                            ? "⚠️ ATENCIÓN: Si eliges HOY, el precio cambiará AHORA MISMO."
                                            : "Los precios se actualizarán automáticamente al comenzar ese día."
                                        }
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="border-2 border-sys-200 rounded-2xl overflow-hidden shrink-0">
                        <div className="bg-sys-100 p-3 text-[10px] font-black text-sys-500 uppercase flex justify-between items-center border-b border-sys-200 shadow-sm">
                            <span className="flex-1">Listado de Productos ({targetList.length})</span>
                            <div className="flex items-center gap-2 text-right">
                                <span className="w-[80px]">N. Costo</span>
                                <span className="w-[90px] text-brand">N. Precio</span>
                            </div>
                        </div>
                        <div className="max-h-60 overflow-y-auto divide-y divide-sys-100 custom-scrollbar bg-white">
                            {targetList.length === 0 ? (
                                <div className="p-8 text-center text-sys-400 text-xs font-bold uppercase">Sin productos seleccionados</div>
                            ) : (
                                targetList.map(p => {
                                    const draft = draftValues[p.id] || { cost: p.cost, price: p.price };
                                    return (
                                        <div key={p.id} className="p-3 flex items-center justify-between hover:bg-sys-50 gap-4 transition-colors">
                                            <div className="truncate flex-1 min-w-[120px]">
                                                <p className="text-xs font-bold text-sys-900 truncate leading-tight uppercase">{p.name}</p>
                                                <p className="text-[9px] font-mono text-sys-400 mt-1">Act: ${p.cost || 0} / ${p.price || 0}</p>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <div className="relative w-[80px]">
                                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sys-400 text-xs font-bold">$</span>
                                                    <input
                                                        type="number"
                                                        className="w-full p-2 pl-5 text-xs font-bold border-2 border-sys-200 rounded-xl outline-none focus:border-sys-400 text-right bg-white"
                                                        value={draft.cost}
                                                        onChange={e => handleManualChange(p.id, 'cost', e.target.value)}
                                                    />
                                                </div>
                                                <div className="relative w-[90px]">
                                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-brand text-xs font-bold">$</span>
                                                    <input
                                                        type="number"
                                                        className="w-full p-2 pl-5 text-xs font-black text-brand border-2 border-brand/20 bg-brand/5 rounded-xl outline-none focus:border-brand text-right shadow-sm"
                                                        value={draft.price}
                                                        onChange={e => handleManualChange(p.id, 'price', e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    </div>

                </div>

                <div className="p-6 bg-sys-50 border-t border-sys-200 flex gap-3 shrink-0">
                    <Button variant="ghost" onClick={onClose} className="flex-1 rounded-2xl h-12 font-bold bg-white border border-sys-200 hover:bg-sys-100 text-sys-600">Cancelar</Button>
                    <Button
                        onClick={() => onConfirm(targetList, draftValues, isScheduled ? activationDate : null)}
                        className={cn(
                            "flex-1 shadow-xl rounded-2xl h-12 font-black transition-all",
                            isScheduled ? "bg-orange-600 hover:bg-orange-700 shadow-orange-200 text-white" : "bg-brand hover:bg-brand-dark shadow-brand/20 text-white"
                        )}
                        disabled={targetList.length === 0 || (isScheduled && !activationDate)}
                    >
                        {isScheduled && activationDate > todayStr ? 'PROGRAMAR CAMBIOS' : 'GUARDAR AHORA'}
                    </Button>
                </div>
            </div>
        </div>
    );
};

// =================================================================
// 🏭 MAIN PAGE: INVENTORY DASHBOARD
// =================================================================
export const InventoryPage = () => {
    const navigate = useNavigate();
    const { companySlug } = useParams();
    const location = useLocation();
    const { user, activeBranchId, activeBranchName } = useAuthStore();

    // 🔥 CONTROL ESTRICTO DE ROLES & PERMISOS
    const isSuperUser = user?.role === 'OWNER' || user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
    const canViewAllBranches = user?.role === 'OWNER' || user?.role === 'SUPER_ADMIN';
    const isAdmin = isSuperUser;

    const perms = user?.permissions || {};
    const canAddStock = isSuperUser || perms.canAddStock;
    const canRemoveStock = isSuperUser || perms.canRemoveStock;
    const canChangePrices = isSuperUser || perms.canChangePrices;

    // Data States
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMessage, setLoadingMessage] = useState('Iniciando...');
    const [masters, setMasters] = useState({ categories: [], brands: [], suppliers: [] });

    // Matrix Global State
    const [branches, setBranches] = useState([]);
    const [globalStock, setGlobalStock] = useState({});
    const [loadingStock, setLoadingStock] = useState(false);

    // Search, Filter & Sort
    const [inputValue, setInputValue] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ category: '', brand: '', supplier: '' });
    const [filterCritical, setFilterCritical] = useState(() =>
        new URLSearchParams(location.search).get('filter') === 'critical'
    );
    const [sortConfig, setSortConfig] = useState(() =>
        new URLSearchParams(location.search).get('filter') === 'critical'
            ? { key: 'stock', direction: 'asc' }
            : { key: 'name', direction: 'asc' }
    );
    const searchInputRef = useRef(null);

    // Selection & View State
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [currentPage, setCurrentPage] = useState(1);
    const [isEditMode, setIsEditMode] = useState(false);
    const ITEMS_PER_PAGE = 25;

    const [exporting, setExporting] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const [selectedExportCols, setSelectedExportCols] = useState(
        () => ['code', 'name', 'cost', 'price']
    );

    const toggleExportCol = (key) => {
        if (ALL_EXPORT_COLUMNS.find(c => c.key === key)?.required) return;
        setSelectedExportCols(prev =>
            prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
        );
    };

    const handleExportExcel = async () => {
        if (filteredProducts.length === 0) return toast.error("No hay productos para exportar.");
        setShowExportModal(false);
        setExporting(true);
        try {
            await exportInventoryToExcel(
                filteredProducts,
                { category: filters.category, brand: filters.brand, search: searchTerm },
                selectedExportCols
            );
            toast.success(`${filteredProducts.length} productos exportados.`);
        } catch (e) {
            toast.error("Error al generar el Excel.");
        } finally {
            setExporting(false);
        }
    };

    // Modals
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [isMastersModalOpen, setIsMastersModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [isBulkUpdateOpen, setIsBulkUpdateOpen] = useState(false);
    const [isScaleModalOpen, setIsScaleModalOpen] = useState(false);

    const [editingProduct, setEditingProduct] = useState(null);
    const [isComboModalOpen, setIsComboModalOpen] = useState(false);
    const [editingCombo, setEditingCombo] = useState(null);
    const [anexarProduct, setAnexarProduct] = useState(null);
    const [stockEntryProduct, setStockEntryProduct] = useState(null);
    const [isBatchMermaOpen, setIsBatchMermaOpen] = useState(false);

    // 🔥 ESTADOS PARA EL MODAL DE AUTORIZACIÓN POR PIN
    const [pinAuthData, setPinAuthData] = useState(null); // { isOpen, actionName, callback }

    const productsRef = useRef([]);
    useEffect(() => { productsRef.current = products; }, [products]);

    // =================================================================
    // 🔍 GLOBAL SCANNER LISTENER
    // =================================================================
    useEffect(() => {
        let buffer = '';
        let lastKeyTime = Date.now();

        const handleGlobalScan = (e) => {
            const active = document.activeElement;
            // 🔥 Dejamos pasar el buscador: sin esto, escanear con el buscador enfocado
            // no abría el modal de producto (nuevo/editar), y sin foco no se veía la búsqueda en vivo.
            const isSearchBox = active === searchInputRef.current;
            if (!isSearchBox && ['INPUT', 'TEXTAREA'].includes(active.tagName)) return;

            const now = Date.now();
            if (now - lastKeyTime > 200) buffer = '';
            lastKeyTime = now;

            if (e.key === 'Enter') {
                if (buffer.length > 2) {
                    handleScannerMatch(buffer);
                    buffer = '';
                }
            } else if (e.key.length === 1) {
                buffer += e.key;
            }
        };

        window.addEventListener('keydown', handleGlobalScan);
        return () => window.removeEventListener('keydown', handleGlobalScan);
    }, []);

    const handleScannerMatch = (code) => {
        const currentProducts = productsRef.current;
        const product = currentProducts.find(p => p.code === code || (Array.isArray(p.barcode) && p.barcode.includes(code)) || p.barcode === code);

        if (product) {
            setEditingProduct(product);
            setIsProductModalOpen(true);
            toast.success("Producto encontrado: " + product.name);
        } else {
            if (!canChangePrices) {
                toast.error("No tienes permisos para crear productos.");
                return;
            }
            setEditingProduct({ code: code, barcode: [code], isNew: true });
            setIsProductModalOpen(true);
            toast("Nuevo producto detectado", { icon: '✨' });
        }
    };

    // =================================================================
    // 🔄 DATA LOADING 
    // =================================================================

    // Lee solo desde Dexie, sin tocar Firestore. Usado por onProductsSynced y post-edición.
    const loadFromLocal = useCallback(async () => {
        console.log('[INV] loadFromLocal — solo Dexie, sin Firestore');
        try {
            const fetchProductsTask = (canViewAllBranches && (!activeBranchId || activeBranchId === 'ALL'))
                ? productRepository.getAll()
                : productRepository.getAllByBranch(activeBranchId);

            const [allProds, cats, brands, supps] = await Promise.all([
                fetchProductsTask,
                masterRepository.getAll('categories'),
                masterRepository.getAll('brands'),
                masterRepository.getAll('suppliers')
            ]);

            setProducts(allProds); // el memo filteredProducts ya ordena, sort aquí es redundante
            setMasters({ categories: cats || [], brands: brands || [], suppliers: supps || [] });

            if (canViewAllBranches) {
                setTimeout(loadGlobalStock, 0); // diferida: primero pinta la tabla, luego carga stock multi-sucursal
            }
        } catch (e) {
            console.error("Error loadFromLocal:", e);
        }
    }, [canViewAllBranches, activeBranchId, user]);

    const loadData = async (forceCloud = false, isSilent = false) => {
        if (!isSilent) setLoading(true);
        try {
            const dbLocal = await getDB();

            // ── Branches: lectura local con fallback a nube ──
            let branchesData = [];
            if (canViewAllBranches && user?.companyId) {
                branchesData = await dbLocal.branches.toArray();
                if (branchesData.length === 0 && navigator.onLine) {
                    const snap = await getDocs(collection(firestoreDB, 'companies', user.companyId, 'branches'));
                    branchesData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    await dbLocal.branches.bulkPut(branchesData);
                }
                setBranches(branchesData.sort((a, b) => (a.id === activeBranchId ? -1 : 1)));
            } else {
                branchesData = [{ id: activeBranchId, name: activeBranchName || 'Mi Sucursal' }];
                setBranches(branchesData);
            }

            const prodCount = await dbLocal.products.count();
            const isFirstTime = prodCount === 0 || forceCloud;

            // ── CAMINO A: sin datos locales → esperar sync (inevitable) ──
            if (isFirstTime) {
                if (!isSilent) setLoadingMessage('Descargando Catálogo...');
                await syncService.syncProducts(user.companyId);

                if (!isSilent) setLoadingMessage('Sincronizando Stock...');
                if (canViewAllBranches) {
                    await syncService.syncAllInventoryForOwner(user.companyId, branchesData);
                } else {
                    await syncService.syncInitialInventory(user.companyId, activeBranchId);
                }
                await loadFromLocal();

                // ── CAMINO B: datos en Dexie → mostrar ya, sync en background ──
            } else {
                await loadFromLocal();            // UI lista en <100ms
                if (!isSilent) setLoading(false); // liberar spinner antes del sync

                // Fire & forget: onProductsSynced dispara loadFromLocal() al terminar
                syncService.syncProducts(user.companyId).catch(console.error);
                if (canViewAllBranches) {
                    syncService.syncAllInventoryForOwner(user.companyId, branchesData).catch(console.error);
                } else {
                    syncService.syncInitialInventory(user.companyId, activeBranchId).catch(console.error);
                }
                return; // loading ya liberado arriba
            }

        } catch (error) {
            console.error(error);
            if (!isSilent) toast.error("Error al cargar inventario");
        } finally {
            if (!isSilent) setLoading(false);
        }
    };

    const loadGlobalStock = async () => {
        try {
            const dbLocal = await getDB();
            const allInventory = await dbLocal.inventory.toArray();

            const stockMatrix = {};
            allInventory.forEach(item => {
                if (!stockMatrix[item.productId]) stockMatrix[item.productId] = {};
                stockMatrix[item.productId][item.branchId] = parseFloat(item.stock) || 0;
            });

            setGlobalStock(stockMatrix);
        } catch (e) {
            console.error("Error loading global stock:", e);
        }
    };


    const handleScaleExport = async (brand, forceCategory) => {
        try {
            const weighableProducts = products.filter(p => p.isWeighable);

            if (weighableProducts.length === 0) {
                toast.error("No hay productos marcados como 'Pesable' en esta sucursal.");
                return;
            }

            const fileContent = scaleService.generateScaleFile(weighableProducts, brand, { forceCategory });
            const result = await scaleService.saveFile(fileContent, brand);

            if (result.mode === 'cancelled') return;

            const msg = result.mode === 'filesystem'
                ? `Actualizado en la carpeta de la balanza: ${weighableProducts.length} productos.`
                : `Exportado para ${brand}: ${weighableProducts.length} productos.`;
            toast.success(msg);
            setIsScaleModalOpen(false);
        } catch (e) {
            console.error(e);
            toast.error("Error exportando balanza: " + e.message);
        }
    };

    const handleChangeScaleLocation = async () => {
        await Promise.all([
            scaleService.forgetSavedLocation('KRETZ'),
            scaleService.forgetSavedLocation('SYSTEL'),
        ]);
        toast.info("Ubicación olvidada. Elija nombre/carpeta en la próxima exportación.", { icon: 'ℹ️' });
    };

    // 🔥 EL MANEJADOR INLINE AHORA ESTÁ BLINDADO
    const handleInlineSave = useCallback(async (productId, field, newValue) => {
        console.log(`[INV] handleInlineSave — campo=${field} valor=${newValue} producto=${productId}`);
        try {
            const product = productsRef.current.find(p => p.id === productId); // ref estable, evita dep en products
            if (!product) return;

            let updates = {};
            let numValue = parseFloat(newValue);

            if (field === 'stock') {
                const diff = numValue - (product.stock || 0);
                if (diff === 0) return;

                const moveType = diff < 0 ? 'STOCK_ADJUST_OUT' : 'STOCK_ADJUST_IN';
                await productRepository.addStock(productId, diff, "Ajuste Rápido Inline", user?.name || "Cajero", activeBranchId, moveType);
            } else {
                if (isNaN(numValue)) return;
                updates[field] = numValue;
                await productRepository.update(productId, updates);
            }

            setProducts(prev => prev.map(p => {
                if (p.id === productId) {
                    return { ...p, ...updates, ...(field === 'stock' ? { stock: numValue } : {}) };
                }
                return p;
            }));

            toast.success(`${field.toUpperCase()} actualizado`, { position: 'bottom-right', duration: 1000 });
            loadFromLocal();

        } catch (e) {
            console.error(e);
            toast.error("Error al guardar cambio");
            loadFromLocal();
        }
    }, [user, activeBranchId, loadFromLocal]);

    // 🔒 INTERCEPTOR DE EDICIÓN: Pide PIN si no hay permisos
    const handleRequestAuth = useCallback((productId, field, currentValue) => {
        let actionName = '';
        let hasPermission = false;

        if (field === 'stock') {
            actionName = 'Ajustar Stock';
            // Para el modo "Inline" que es un ajuste libre, requiere permiso de "Merma" porque puede restar
            hasPermission = canRemoveStock && canAddStock;
        } else if (field === 'price' || field === 'cost') {
            actionName = 'Cambiar Precio';
            hasPermission = canChangePrices;
        }

        if (hasPermission) {
            return true; // Señal a EditableCell para activar modo edición
        }

        // Si NO tiene permiso, lanzamos el Modal de PIN
        setPinAuthData({
            isOpen: true,
            actionName,
            callback: () => {
                // Si el PIN es correcto, le pedimos por un Promt Nativo el valor
                const newVal = prompt(`Ingrese el nuevo ${field.toUpperCase()}:`, currentValue);
                if (newVal !== null && newVal !== '') {
                    handleInlineSave(productId, field, newVal);
                }
            }
        });
    }, [canRemoveStock, canAddStock, canChangePrices, handleInlineSave]);

    useEffect(() => {
        loadData();

        // Re-carga solo desde Dexie cuando el sync trae datos nuevos, sin volver a llamar Firestore
        const handleSync = () => {
            console.log('[INV] onProductsSynced recibido → loadFromLocal');
            loadFromLocal();
        };
        window.addEventListener('onProductsSynced', handleSync);

        return () => {
            window.removeEventListener('onProductsSynced', handleSync);
        };
    }, [user, activeBranchId]);

    useEffect(() => {
        setSearchTerm(inputValue);
        setCurrentPage(1);
    }, [inputValue]);

    // =================================================================
    // 🔍 FILTERING, SORTING & PAGINATION
    // =================================================================

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const SortIcon = ({ columnKey }) => {
        if (sortConfig.key !== columnKey) return <Minus size={12} className="opacity-20 inline ml-1" />;
        return sortConfig.direction === 'asc'
            ? <ArrowUp size={12} className="inline ml-1 text-brand" />
            : <ArrowDown size={12} className="inline ml-1 text-brand" />;
    };

    const filteredProducts = useMemo(() => {
        const term = searchTerm.toLowerCase();
        let filtered = products.filter(p => {
            const name = (p.name || '').toLowerCase();
            const code = (p.code || '').toString().toLowerCase();
            const barcodeStr = Array.isArray(p.barcode) ? p.barcode.join(' ') : (p.barcode || '');
            const matchesSearch = name.includes(term) || code.includes(term) || barcodeStr.toLowerCase().includes(term);
            // 🔥 productRepository.save() defaultea category/brand a 'GENERAL'/'GENERICO' cuando no se asignan
            // (nunca quedan vacíos) — por eso "Sin asignar" también debe matchear ese valor por defecto.
            const matchesCat = filters.category
                ? (filters.category === UNASSIGNED ? (!p.category || p.category === 'GENERAL') : p.category === filters.category)
                : true;
            const matchesBrand = filters.brand
                ? (filters.brand === UNASSIGNED ? (!p.brand || p.brand === 'GENERICO') : p.brand === filters.brand)
                : true;
            const matchesSupplier = filters.supplier
                ? (filters.supplier === UNASSIGNED ? !p.supplier : p.supplier === filters.supplier)
                : true;
            return matchesSearch && matchesCat && matchesBrand && matchesSupplier;
        });

        if (filterCritical) {
            filtered = filtered.filter(p => (p.stock ?? 0) <= (p.minStock || 5));
        }

        filtered.sort((a, b) => {
            let aValue = a[sortConfig.key];
            let bValue = b[sortConfig.key];

            if (sortConfig.key === 'stock') {
                aValue = parseFloat(a.stock || 0);
                bValue = parseFloat(b.stock || 0);
            }

            if (aValue === undefined || aValue === null) aValue = '';
            if (bValue === undefined || bValue === null) bValue = '';

            if (typeof aValue === 'string') {
                // nameCollator reutiliza el Intl.Collator instanciado globalmente (más rápido)
                const cmp = nameCollator.compare(aValue, bValue);
                return sortConfig.direction === 'asc' ? cmp : -cmp;
            }

            aValue = Number(aValue);
            bValue = Number(bValue);

            if (aValue < bValue) {
                return sortConfig.direction === 'asc' ? -1 : 1;
            }
            if (aValue > bValue) {
                return sortConfig.direction === 'asc' ? 1 : -1;
            }
            return 0;
        });

        return filtered;
    }, [products, searchTerm, filters, sortConfig, filterCritical]);

    const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
    const currentProducts = useMemo(() => {
        return filteredProducts.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
    }, [filteredProducts, currentPage]);

    // Un solo new Date() por página renderizada en lugar de uno por cada fila
    const renderNow = useMemo(() => new Date(), [currentProducts]);

    const toggleSelection = (id) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
        setSelectedIds(newSet);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size >= filteredProducts.length && filteredProducts.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredProducts.map(p => p.id)));
            toast.success(`Seleccionados ${filteredProducts.length} productos`);
        }
    };

    // =================================================================
    // 🚀 HANDLERS MASIVOS Y KARDEX
    // =================================================================

    const handleSaveCombo = async (comboPayload) => {
        try {
            const saved = await productRepository.save(comboPayload);
            setProducts(prev => {
                const exists = prev.some(p => p.id === saved.id);
                return exists
                    ? prev.map(p => p.id === saved.id ? { ...p, ...saved } : p)
                    : [{ ...saved }, ...prev];
            });
            setIsComboModalOpen(false);
            toast.success('Combo guardado correctamente');
        } catch (e) {
            console.error(e);
            toast.error('Error al guardar el combo');
        }
    };

    const handleSaveProduct = async (masterPayload, promoPayload) => {
        try {
            const savedProduct = await productRepository.save(masterPayload);

            let updatedPromo = promoPayload;
            if (promoPayload !== undefined) {
                try {
                    await productRepository.setPromotion(savedProduct.id, promoPayload);
                } catch (promoError) {
                    // 🛡️ No abortar el guardado del producto si falla la promo (ej: vista "Todas las sucursales")
                    console.error(promoError);
                    updatedPromo = undefined; // no tocar el promo actual en el estado
                    toast.error(promoError.message || "No se pudo aplicar la promoción. Seleccioná una sucursal específica.");
                }
            }

            // ACTUALIZACIÓN ATÓMICA DEL ESTADO
            setProducts(prev => {
                const exists = prev.some(p => p.id === savedProduct.id);
                if (exists) {
                    return prev.map(p => p.id === savedProduct.id
                        ? { ...p, ...savedProduct, promo: updatedPromo === undefined ? p.promo : updatedPromo }
                        : p
                    );
                } else {
                    // Si es nuevo, lo añadimos al principio para feedback inmediato
                    return [{ ...savedProduct, promo: updatedPromo || null, stock: masterPayload.stock || 0 }, ...prev];
                }
            });

            setIsProductModalOpen(false);
            toast.success("Producto guardado correctamente");
        } catch (e) {
            console.error(e);
            toast.error("Error al guardar producto");
        }
    };

    const handleQuickStockEntry = async (productId, qty, reason, moveType) => {
        try {
            const userName = user?.name || user?.email || 'Sistema';
            const newStock = await productRepository.addStock(productId, qty, reason, userName, activeBranchId, moveType);

            // ACTUALIZACIÓN ATÓMICA
            setProducts(prev => prev.map(p => p.id === productId ? { ...p, stock: newStock } : p));

            toast.success("Ajuste registrado correctamente en Kardex");
        } catch (e) {
            console.error(e);
            toast.error("Error al ajustar stock");
        }
    };

    // 🔥 Mermas en lote: mismo motor (addStock) que el ajuste individual, uno por producto
    const handleBatchMerma = async (items, reason) => {
        const userName = user?.name || user?.email || 'Sistema';
        let okCount = 0;
        const failed = [];

        for (const item of items) {
            try {
                const newStock = await productRepository.addStock(item.productId, -Math.abs(item.qty), reason, userName, activeBranchId, 'MERMA');
                setProducts(prev => prev.map(p => p.id === item.productId ? { ...p, stock: newStock } : p));
                okCount++;
            } catch (e) {
                console.error(e);
                failed.push(item.productId);
            }
        }

        if (okCount > 0) toast.success(`Merma registrada: ${okCount} producto${okCount !== 1 ? 's' : ''}`);
        if (failed.length > 0) toast.error(`${failed.length} producto(s) no se pudieron registrar`);
    };

    const executeBulkUpdate = async (targetProducts, draftValues, activationDate = null) => {
        if (targetProducts.length === 0) return alert("No hay productos seleccionados.");
        const todayStr = getLocalDate();
        const isFutureScheduled = activationDate && activationDate > todayStr;
        const confirmMsg = isFutureScheduled
            ? `⚠️ ¿Programar ajuste para el ${activationDate}?\nAfectará a ${targetProducts.length} productos.`
            : `⚠️ ¿Aplicar ajuste INMEDIATO?\nAfectará a ${targetProducts.length} productos.`;

        if (!window.confirm(confirmMsg)) return;

        const toastId = toast.loading("Aplicando cambios masivos...");
        try {
            const updatedItemsMap = {};

            for (const p of targetProducts) {
                const draft = draftValues[p.id];
                if (!draft) continue;

                const newCost = Number(draft.cost) || 0;
                const newPrice = Number(draft.price) || 0;

                const productUpdate = { ...p };

                if (isFutureScheduled) {
                    productUpdate.nextPrice = newPrice;
                    productUpdate.nextCost = newCost;
                    productUpdate.priceActivationDate = activationDate;
                    productUpdate.syncStatus = 'pending';
                } else {
                    productUpdate.cost = newCost;
                    productUpdate.price = newPrice;
                    productUpdate.nextPrice = null;
                    productUpdate.nextCost = null;
                    productUpdate.priceActivationDate = null;
                    productUpdate.syncStatus = 'pending';
                }

                const saved = await productRepository.save(productUpdate);
                updatedItemsMap[saved.id] = saved;
            }

            // ACTUALIZACIÓN ATÓMICA MASIVA (Una sola operación de estado)
            setProducts(prev => prev.map(p => updatedItemsMap[p.id] ? { ...p, ...updatedItemsMap[p.id] } : p));

            toast.success(isFutureScheduled ? "Precios programados con éxito" : "Precios actualizados inmediatamente", { id: toastId });
            setSelectedIds(new Set());
            setIsBulkUpdateOpen(false);
        } catch (error) {
            console.error(error);
            toast.error("Error en proceso masivo", { id: toastId });
        }
    };

    const goToLabels = () => navigate(`/${companySlug}/inventory/print-labels`);
    const goToMovements = () => navigate(`/${companySlug}/inventory/movements`);

    return (
        <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-sys-50 relative">
            <div className="flex-1 flex flex-col w-full">

                {/* ACTIONS HEADER */}
                <div className="px-6 py-5 bg-white border-b border-sys-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0 shadow-sm z-20">
                    <div>
                        <h1 className="text-2xl font-black text-sys-900 tracking-tight flex items-center gap-2">
                            <LayoutGrid className="text-brand" size={28} /> Inventario Global
                        </h1>
                        <div className="flex items-center gap-3 text-[10px] font-bold text-sys-500 uppercase mt-1">
                            <span className="flex items-center gap-1 bg-sys-100 px-2 py-0.5 rounded text-sys-600 border border-sys-200">
                                <MapPin size={10} /> {canViewAllBranches && (!activeBranchId || activeBranchId === 'ALL') ? 'Todas las Sucursales' : activeBranchName || 'Mi Sucursal'}
                            </span>
                            <span className="text-sys-300">|</span>
                            <span>{filteredProducts.length} filtrados</span>
                            {selectedIds.size > 0 && (
                                <span className="text-brand font-black ml-2 animate-pulse">
                                    • {selectedIds.size} seleccionados
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">

                        <Button
                            variant="secondary"
                            onClick={() => {
                                if (!isEditMode && !canChangePrices && !canAddStock) {
                                    toast.error("⛔ No tienes permisos para entrar al Modo Edición.", { icon: '🔒' });
                                    return;
                                }
                                setIsEditMode(!isEditMode);
                            }}
                            className={cn(
                                "border transition-all",
                                isEditMode ? "bg-brand text-white border-brand shadow-lg" : "bg-white text-sys-500 border-sys-200 hover:border-sys-300"
                            )}
                        >
                            <Pencil size={18} className="mr-2" /> {isEditMode ? 'Terminar Edición' : 'Modo Edición'}
                        </Button>

                        <div className="w-px h-8 bg-sys-200 mx-2 hidden md:block"></div>

                        {isAdmin && (
                            <Button variant="secondary" className="border-green-200 text-green-700 bg-green-50 hover:bg-green-100" onClick={() => setIsScaleModalOpen(true)}>
                                <Scale size={18} className="mr-2" /> Balanzas
                            </Button>
                        )}

                        <Button variant="secondary" className="border-purple-200 text-purple-700 bg-purple-50" onClick={goToLabels}>
                            <Printer size={18} className="mr-2" /> Etiquetas
                        </Button>
                        <Button variant="secondary" className="border-blue-200 text-blue-700 bg-blue-50" onClick={goToMovements}>
                            <ArrowRightLeft size={18} className="mr-2" /> Kardex
                        </Button>

                        {(canAddStock || canRemoveStock) && (
                            <Button
                                variant="secondary"
                                className="border-red-200 text-red-700 bg-red-50 hover:bg-red-100"
                                onClick={() => setIsBatchMermaOpen(true)}
                            >
                                <ShieldAlert size={18} className="mr-2" /> Mermas en Lote
                            </Button>
                        )}

                        {isSuperUser && (
                            <>
                                <div className="w-px h-8 bg-sys-200 mx-2 hidden md:block"></div>
                                <Button variant="secondary" onClick={() => setIsImportModalOpen(true)}>
                                    <Upload size={18} className="mr-2" /> Importar
                                </Button>
                            </>
                        )}

                        {selectedIds.size > 0 && (
                            <Button variant="secondary" className="border-orange-200 text-orange-700 bg-orange-50 hover:bg-orange-100 animate-in zoom-in" onClick={() => setIsBulkUpdateOpen(true)}>
                                <ArrowUpRight size={18} className="mr-2" /> Actualización Múltiple
                            </Button>
                        )}

                        <Button
                            onClick={() => {
                                if (!canChangePrices) return toast.error("⛔ No tienes permisos para crear productos.", { icon: '🔒' });
                                setEditingCombo(null);
                                setIsComboModalOpen(true);
                            }}
                            variant="outline"
                            className="ml-2 border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-600 hover:text-white transition-all"
                        >
                            <ShoppingBag size={18} className="mr-2" /> Nuevo Combo
                        </Button>
                        <Button
                            onClick={() => {
                                if (!canChangePrices) return toast.error("⛔ No tienes permisos para crear productos.", { icon: '🔒' });
                                setEditingProduct(null);
                                setIsProductModalOpen(true);
                            }}
                            className="shadow-xl shadow-brand/20 ml-2"
                        >
                            <Plus size={20} className="mr-2" /> Nuevo Producto
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setShowExportModal(true)}
                            disabled={exporting || filteredProducts.length === 0}
                            className="border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-600 hover:text-white transition-all ml-2"
                            title="Exportar lista filtrada a Excel"
                        >
                            {exporting
                                ? <Loader2 size={18} className="animate-spin mr-2" />
                                : <FileSpreadsheet size={18} className="mr-2" />
                            }
                            Exportar listado Excel
                        </Button>
                    </div>
                </div>

                {/* FILTERS */}
                <div className="px-6 py-3 bg-white border-b border-sys-100 flex flex-wrap gap-2 items-center shrink-0">

                    {/* Búsqueda */}
                    <div className="relative group shrink-0">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400 group-focus-within:text-brand transition-colors pointer-events-none" size={15}/>
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="Nombre, código o barra..."
                            className="w-64 pl-9 pr-3 py-2 bg-sys-50 border border-sys-200 rounded-xl text-xs font-semibold outline-none focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/10 transition-all placeholder:text-sys-400 placeholder:font-normal"
                            value={inputValue}
                            onChange={e => setInputValue(e.target.value)}
                            onKeyDown={e => e.key === 'Escape' && setInputValue('')}
                        />
                    </div>

                    <div className="h-5 w-px bg-sys-200 shrink-0 hidden sm:block"/>

                    {/* Categoría */}
                    <div className="relative shrink-0">
                        <Tag className={cn("absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors", filters.category ? "text-brand" : "text-sys-400")} size={13}/>
                        <select
                            className={cn(
                                "appearance-none pl-8 pr-7 py-2 border rounded-xl text-xs font-bold outline-none cursor-pointer transition-all min-w-[140px]",
                                filters.category
                                    ? "border-brand/40 bg-brand/5 text-brand"
                                    : "border-sys-200 bg-sys-50 text-sys-600 hover:border-sys-300 focus:border-brand"
                            )}
                            value={filters.category}
                            onChange={e => setFilters({ ...filters, category: e.target.value })}
                        >
                            <option value="">Categorías</option>
                            <option value={UNASSIGNED}>Sin asignar</option>
                            {masters.categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-sys-400" size={12}/>
                    </div>

                    {/* Marca */}
                    <div className="relative shrink-0">
                        <Tag className={cn("absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors", filters.brand ? "text-brand" : "text-sys-400")} size={13}/>
                        <select
                            className={cn(
                                "appearance-none pl-8 pr-7 py-2 border rounded-xl text-xs font-bold outline-none cursor-pointer transition-all min-w-[140px]",
                                filters.brand
                                    ? "border-brand/40 bg-brand/5 text-brand"
                                    : "border-sys-200 bg-sys-50 text-sys-600 hover:border-sys-300 focus:border-brand"
                            )}
                            value={filters.brand}
                            onChange={e => setFilters({ ...filters, brand: e.target.value })}
                        >
                            <option value="">Marcas</option>
                            <option value={UNASSIGNED}>Sin asignar</option>
                            {masters.brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-sys-400" size={12}/>
                    </div>

                    {/* Proveedor */}
                    <div className="relative shrink-0">
                        <ShoppingBag className={cn("absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors", filters.supplier ? "text-brand" : "text-sys-400")} size={13}/>
                        <select
                            className={cn(
                                "appearance-none pl-8 pr-7 py-2 border rounded-xl text-xs font-bold outline-none cursor-pointer transition-all min-w-[140px]",
                                filters.supplier
                                    ? "border-brand/40 bg-brand/5 text-brand"
                                    : "border-sys-200 bg-sys-50 text-sys-600 hover:border-sys-300 focus:border-brand"
                            )}
                            value={filters.supplier}
                            onChange={e => setFilters({ ...filters, supplier: e.target.value })}
                        >
                            <option value="">Proveedores</option>
                            <option value={UNASSIGNED}>Sin asignar</option>
                            {masters.suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-sys-400" size={12}/>
                    </div>

                    {/* Pills de filtros activos */}
                    {filters.category && (
                        <button
                            onClick={() => setFilters({ ...filters, category: '' })}
                            className="flex items-center gap-1.5 bg-brand/10 text-brand text-[10px] font-black px-2.5 py-1.5 rounded-lg border border-brand/20 hover:bg-brand/20 transition-all shrink-0"
                        >
                            <Tag size={9}/> {filters.category === UNASSIGNED ? 'Sin categoría' : filters.category} <X size={9}/>
                        </button>
                    )}
                    {filters.brand && (
                        <button
                            onClick={() => setFilters({ ...filters, brand: '' })}
                            className="flex items-center gap-1.5 bg-brand/10 text-brand text-[10px] font-black px-2.5 py-1.5 rounded-lg border border-brand/20 hover:bg-brand/20 transition-all shrink-0"
                        >
                            <Tag size={9}/> {filters.brand === UNASSIGNED ? 'Sin marca' : filters.brand} <X size={9}/>
                        </button>
                    )}
                    {filters.supplier && (
                        <button
                            onClick={() => setFilters({ ...filters, supplier: '' })}
                            className="flex items-center gap-1.5 bg-brand/10 text-brand text-[10px] font-black px-2.5 py-1.5 rounded-lg border border-brand/20 hover:bg-brand/20 transition-all shrink-0"
                        >
                            <ShoppingBag size={9}/> {filters.supplier === UNASSIGNED ? 'Sin proveedor' : filters.supplier} <X size={9}/>
                        </button>
                    )}
                    {searchTerm && (
                        <button
                            onClick={() => setInputValue('')}
                            className="flex items-center gap-1.5 bg-sys-100 text-sys-700 text-[10px] font-black px-2.5 py-1.5 rounded-lg border border-sys-200 hover:bg-sys-200 transition-all shrink-0"
                        >
                            <Search size={9}/> "{searchTerm}" <X size={9}/>
                        </button>
                    )}

                    {(filters.category || filters.brand || filters.supplier || searchTerm || filterCritical) && (
                        <button
                            onClick={() => { setFilters({ category: '', brand: '', supplier: '' }); setInputValue(''); setFilterCritical(false); setSortConfig({ key: 'name', direction: 'asc' }); }}
                            className="flex items-center gap-1 ml-auto text-[10px] font-black text-red-400 hover:text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-xl border border-transparent hover:border-red-100 transition-all shrink-0"
                        >
                            <X size={11}/> Limpiar todo
                        </button>
                    )}
                </div>

                {filterCritical && (
                    <div className="px-6 py-2.5 bg-rose-50 border-b border-rose-200 flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-2">
                            <AlertTriangle size={14} className="text-rose-500" />
                            <span className="text-xs font-black text-rose-800 uppercase tracking-wide">Filtrando: Stock Crítico</span>
                            <span className="bg-rose-100 text-rose-700 text-[10px] font-black px-2 py-0.5 rounded-full border border-rose-200">
                                {filteredProducts.length} productos
                            </span>
                        </div>
                        <button
                            onClick={() => { setFilterCritical(false); setSortConfig({ key: 'name', direction: 'asc' }); }}
                            className="flex items-center gap-1 text-[10px] font-black text-rose-600 hover:text-rose-800 hover:bg-rose-100 px-2.5 py-1.5 rounded-lg transition-all border border-rose-200 hover:border-rose-300"
                        >
                            <X size={12} /> Quitar filtro
                        </button>
                    </div>
                )}

                {/* TABLE 🔥 CON ORDENAMIENTO EN ENCABEZADOS */}
                <div className="flex-1 overflow-auto bg-white relative">
                    {loading ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm z-50">
                            <div className="flex flex-col items-center gap-4 text-brand bg-white p-8 rounded-3xl shadow-2xl">
                                <Loader2 className="animate-spin" size={48} />
                                <span className="text-sm font-black uppercase tracking-widest text-sys-800">{loadingMessage}</span>
                                <div className="w-48 h-1.5 bg-sys-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-brand rounded-full animate-pulse" style={{ width: '66%' }} />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 bg-sys-50 z-10 shadow-sm">
                                <tr className="text-[10px] uppercase font-black text-sys-400 tracking-wider border-b border-sys-200">
                                    <th className="p-4 w-12 text-center">
                                        <button onClick={toggleSelectAll} className="hover:text-brand transition-colors">
                                            {selectedIds.size >= filteredProducts.length && filteredProducts.length > 0 ? <CheckSquare className="text-brand" size={18} /> : <Square size={18} />}
                                        </button>
                                    </th>
                                    <th
                                        className="p-4 font-bold cursor-pointer hover:bg-sys-100 transition-colors select-none"
                                        onClick={() => handleSort('name')}
                                    >
                                        Detalle Producto <SortIcon columnKey="name" />
                                    </th>
                                    {branches.map(b => (
                                        <th
                                            key={b.id}
                                            className={cn("p-4 text-center border-l border-sys-100 cursor-pointer hover:bg-brand/10 transition-colors select-none", b.id === activeBranchId ? "bg-brand/5 text-brand" : "")}
                                            onClick={() => handleSort('stock')}
                                        >
                                            {b.name} <SortIcon columnKey="stock" />
                                        </th>
                                    ))}
                                    <th
                                        className="p-4 text-right border-l border-sys-100 cursor-pointer hover:bg-sys-100 transition-colors select-none"
                                        onClick={() => handleSort('cost')}
                                    >
                                        Costo Final <SortIcon columnKey="cost" />
                                    </th>
                                    <th
                                        className="p-4 text-right cursor-pointer hover:bg-sys-100 transition-colors select-none"
                                        onClick={() => handleSort('price')}
                                    >
                                        Precio Público <SortIcon columnKey="price" />
                                    </th>
                                    <th className="p-4 text-center w-24">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-sys-100">
                                {currentProducts.map((p, index) => {
                                    const promo = getActivePromo(p, renderNow);
                                    const isSelected = selectedIds.has(p.id);
                                    const currentStock = p.stock;
                                    const hasPendingPrice = p.priceActivationDate && p.nextPrice !== undefined && p.nextPrice !== null;

                                    const prevRowId = index > 0 ? currentProducts[index - 1].id : null;
                                    const nextRowId = index < currentProducts.length - 1 ? currentProducts[index + 1].id : null;

                                    return (
                                        <tr
                                            key={p.id}
                                            onClick={() => {
                                                if (canChangePrices) {
                                                    setEditingProduct(p);
                                                    setIsProductModalOpen(true);
                                                } else {
                                                    toast.error("⛔ No tienes permisos para editar toda la ficha.", { icon: '🔒' });
                                                }
                                            }}
                                            className={cn("cursor-pointer transition-all h-[70px]", isSelected ? "bg-brand/5" : "hover:bg-sys-50")}
                                        >
                                            <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                                                <button onClick={() => toggleSelection(p.id)} className={cn("transition-colors", isSelected ? "text-brand" : "text-sys-300")}>
                                                    {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                                                </button>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-black text-sys-900 leading-tight uppercase">{p.name}</span>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className="text-[10px] font-mono font-bold text-sys-400 bg-sys-100 px-1.5 py-0.5 rounded border border-sys-200">{p.code || 'S/C'}</span>
                                                        <span className="text-[10px] font-black text-sys-400 uppercase tracking-tighter opacity-60">{p.brand}</span>
                                                        {p.isWeighable && <span className="text-[9px] font-black text-orange-600 bg-orange-100 px-1 rounded flex items-center gap-1"><Scale size={10} /> BALANZA</span>}
                                        {p.isCase === true && <span className="text-[9px] font-black text-amber-700 bg-amber-100 px-1 rounded flex items-center gap-1"><Package size={10} /> CAJA ×{p.unitsPerCase}</span>}
                                                    </div>
                                                </div>
                                            </td>

                                            {branches.map(b => {
                                                const isCurrentBranch = b.id === activeBranchId && activeBranchId !== 'ALL';
                                                let stockVal = isCurrentBranch ? currentStock : (globalStock[p.id]?.[b.id] || 0);

                                                return (
                                                    <td key={b.id} className={cn("p-2 text-center border-l border-sys-100", b.id === activeBranchId ? "bg-brand/5" : "")} onClick={e => e.stopPropagation()}>
                                                        {isCurrentBranch ? (
                                                            <EditableCell
                                                                value={stockVal}
                                                                id={p.id}
                                                                field="stock"
                                                                productId={p.id}
                                                                onSave={handleInlineSave}
                                                                type="number"
                                                                disabled={!isEditMode}
                                                                onRequestAuth={handleRequestAuth} // 🔥 Pide PIN si no tiene permiso y da click
                                                                nextRowId={nextRowId}
                                                                prevRowId={prevRowId}
                                                                className={cn("mx-auto w-20 text-center font-black rounded-lg",
                                                                    stockVal < 0 ? "text-red-600 bg-red-50" : stockVal <= (p.minStock || 5) ? "text-orange-600 bg-orange-50" : "text-sys-700"
                                                                )}
                                                            />
                                                        ) : (
                                                            <span className="text-xs text-sys-400 font-bold">{formatStock(stockVal)}</span>
                                                        )}
                                                    </td>
                                                );
                                            })}

                                            <td className="p-2 text-right border-l border-sys-100 font-mono text-xs font-bold text-sys-500" onClick={e => e.stopPropagation()}>
                                                <EditableCell
                                                    value={p.cost}
                                                    id={p.id}
                                                    field="cost"
                                                    productId={p.id}
                                                    onSave={handleInlineSave}
                                                    type="number"
                                                    prefix="$ "
                                                    disabled={!isEditMode}
                                                    onRequestAuth={handleRequestAuth} // 🔥 Pide PIN
                                                    nextRowId={nextRowId}
                                                    prevRowId={prevRowId}
                                                />
                                            </td>

                                            <td className="p-2 text-right" onClick={e => e.stopPropagation()}>
                                                <div className="flex flex-col items-end">
                                                    <div className="flex items-center justify-end w-full gap-1.5">
                                                        {hasPendingPrice && (
                                                            <div className="text-orange-500 animate-pulse cursor-help" title={`CAMBIO PROGRAMADO:\nNuevo Precio: $${p.nextPrice}\nFecha: ${p.priceActivationDate}`}>
                                                                <CalendarClock size={16} />
                                                            </div>
                                                        )}
                                                        <EditableCell
                                                            value={p.price}
                                                            id={p.id}
                                                            field="price"
                                                            productId={p.id}
                                                            onSave={handleInlineSave}
                                                            type="number"
                                                            prefix="$ "
                                                            disabled={!isEditMode}
                                                            onRequestAuth={handleRequestAuth} // 🔥 Pide PIN
                                                            nextRowId={nextRowId}
                                                            prevRowId={prevRowId}
                                                            className={cn("text-base font-black w-24", promo ? "text-purple-600" : "text-sys-900")}
                                                        />
                                                    </div>
                                                    {promo && <span className="text-[8px] font-black bg-purple-600 text-white px-1.5 rounded-full mt-1">{promo.name}</span>}
                                                </div>
                                            </td>

                                            <td className="p-4" onClick={(e) => e.stopPropagation()}>
                                                <div className="flex justify-center gap-1">
                                                    <button
                                                        onClick={() => {
                                                            if (canAddStock || canRemoveStock) {
                                                                setStockEntryProduct(p);
                                                            } else {
                                                                setPinAuthData({
                                                                    isOpen: true,
                                                                    actionName: 'Ajustar Kardex (Stock)',
                                                                    callback: () => setStockEntryProduct(p)
                                                                });
                                                            }
                                                        }}
                                                        className="p-2 rounded-xl text-green-600 hover:bg-green-50 transition-all border border-transparent hover:border-green-100"
                                                        title="Ajuste de Stock Kardex"
                                                    >
                                                        <Package size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            const openEdit = () => {
                                                                if (p.isCombo) {
                                                                    setEditingCombo(p);
                                                                    setIsComboModalOpen(true);
                                                                } else {
                                                                    setEditingProduct(p);
                                                                    setIsProductModalOpen(true);
                                                                }
                                                            };
                                                            if (canChangePrices) {
                                                                openEdit();
                                                            } else {
                                                                setPinAuthData({
                                                                    isOpen: true,
                                                                    actionName: 'Editar Producto',
                                                                    callback: openEdit
                                                                });
                                                            }
                                                        }}
                                                        className="p-2 rounded-xl text-brand hover:bg-brand/5 transition-all"
                                                        title={p.isCombo ? 'Editar Combo' : 'Editar Producto'}
                                                    >
                                                        <Edit2 size={18} />
                                                    </button>
                                                    {p.isWeighable && !p.isCombo && canChangePrices && (
                                                        <button
                                                            onClick={() => setAnexarProduct(p)}
                                                            className="p-2 rounded-xl text-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-all"
                                                            title="Anexar como variante de otro producto"
                                                        >
                                                            <Link size={18} />
                                                        </button>
                                                    )}
                                                    {isSuperUser && (
                                                        <button
                                                            onClick={() => {
                                                                if (window.confirm('¿Eliminar producto?')) {
                                                                    productRepository.delete(p.id).then(() => {
                                                                        setProducts(prev => prev.filter(prod => prod.id !== p.id));
                                                                        toast.success("Producto eliminado");
                                                                    });
                                                                }
                                                            }}
                                                            className="p-2 rounded-xl text-red-300 hover:text-red-600 hover:bg-red-50 transition-all"
                                                            title="Eliminar"
                                                        >
                                                            <Trash2 size={18} />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* PAGINATION */}
                <div className="p-4 bg-white border-t border-sys-200 flex justify-between items-center z-20">
                    <span className="text-xs font-bold text-sys-500 uppercase tracking-widest">
                        Página {currentPage} de {totalPages || 1} <span className="ml-2 opacity-30">|</span> Total {filteredProducts.length} items
                    </span>
                    <div className="flex gap-2">
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-2 rounded-xl border-2 border-sys-100 hover:bg-sys-50 disabled:opacity-30"><ChevronLeft size={20} /></button>
                        <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0} className="p-2 rounded-xl border-2 border-sys-100 hover:bg-sys-50 disabled:opacity-30"><ChevronRight size={20} /></button>
                    </div>
                </div>
            </div>

            {/* MODALES */}
            <PinVerificationModal
                isOpen={pinAuthData?.isOpen}
                actionName={pinAuthData?.actionName}
                onClose={() => setPinAuthData(null)}
                onSuccess={() => pinAuthData?.callback && pinAuthData.callback()}
            />

            <ProductModal
                isOpen={isProductModalOpen}
                onClose={() => setIsProductModalOpen(false)}
                productToEdit={editingProduct}
                onSave={handleSaveProduct}
                allProducts={products}
            />
            <ComboModal
                isOpen={isComboModalOpen}
                onClose={() => setIsComboModalOpen(false)}
                comboToEdit={editingCombo}
                onSave={handleSaveCombo}
            />
            <AnexarModal
                isOpen={!!anexarProduct}
                onClose={() => setAnexarProduct(null)}
                childProduct={anexarProduct}
                onSuccess={(childId, updatedParent) => {
                    setProducts(prev => prev
                        .filter(p => p.id !== childId)
                        .map(p => p.id === updatedParent.id ? { ...p, ...updatedParent } : p)
                    );
                }}
            />
            <StockEntryModal isOpen={!!stockEntryProduct} onClose={() => setStockEntryProduct(null)} product={stockEntryProduct} onConfirm={handleQuickStockEntry} />
            <BatchMermaModal isOpen={isBatchMermaOpen} onClose={() => setIsBatchMermaOpen(false)} onConfirm={handleBatchMerma} />
            <BulkUpdateModal
                isOpen={isBulkUpdateOpen}
                onClose={() => setIsBulkUpdateOpen(false)}
                onConfirm={executeBulkUpdate}
                allProducts={products}
                masters={masters}
                manualSelectionIds={selectedIds}
            />
            <ScaleExportModal
                isOpen={isScaleModalOpen}
                onClose={() => setIsScaleModalOpen(false)}
                onExport={handleScaleExport}
                onChangeLocation={handleChangeScaleLocation}
            />
            <MastersModal isOpen={isMastersModalOpen} onClose={() => setIsMastersModalOpen(false)} />
            <ImportMapperModal isOpen={isImportModalOpen} onClose={() => setIsImportModalOpen(false)} branchId={activeBranchId} onSuccess={loadData} />

            {/* MODAL EXPORTAR EXCEL */}
            {showExportModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col">
                        <div className="p-5 border-b flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <FileSpreadsheet size={20} className="text-emerald-600" />
                                <h3 className="font-black text-sys-900 text-lg">Exportar a Excel</h3>
                            </div>
                            <button onClick={() => setShowExportModal(false)} className="p-1.5 hover:bg-sys-100 rounded-full text-sys-400">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-5 space-y-1">
                            <p className="text-xs text-sys-500 mb-3 font-medium">
                                Seleccioná las columnas a incluir — <span className="text-brand font-bold">{filteredProducts.length} productos</span>
                            </p>
                            {ALL_EXPORT_COLUMNS.map(col => (
                                <label
                                    key={col.key}
                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${col.required ? 'opacity-60 cursor-not-allowed' : 'hover:bg-sys-50'
                                        }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedExportCols.includes(col.key)}
                                        disabled={col.required}
                                        onChange={() => toggleExportCol(col.key)}
                                        className="w-4 h-4 accent-brand rounded"
                                    />
                                    <span className="text-sm font-medium text-sys-700">{col.label}</span>
                                    {col.required && <span className="text-[10px] text-sys-400 ml-auto">requerido</span>}
                                </label>
                            ))}
                            <div className="pt-2 flex justify-end gap-1">
                                <button
                                    onClick={() => setSelectedExportCols(ALL_EXPORT_COLUMNS.map(c => c.key))}
                                    className="text-xs text-brand hover:underline px-2 py-1"
                                >Todas</button>
                                <button
                                    onClick={() => setSelectedExportCols(['code', 'name', 'cost', 'price'])}
                                    className="text-xs text-sys-400 hover:underline px-2 py-1"
                                >Mínimas</button>
                            </div>
                        </div>

                        <div className="p-5 pt-0 flex gap-3">
                            <button
                                onClick={() => setShowExportModal(false)}
                                className="flex-1 h-11 rounded-xl border border-sys-200 text-sys-600 font-bold text-sm hover:bg-sys-50 transition-colors"
                            >Cancelar</button>
                            <button
                                onClick={handleExportExcel}
                                disabled={selectedExportCols.length === 0}
                                className="flex-1 h-11 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                <FileSpreadsheet size={16} /> Exportar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
.no-scrollbar::-webkit-scrollbar { display: none; }
                .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-5px); }
                    50% { transform: translateX(5px); }
                    75% { transform: translateX(-5px); }
                }
                .animate-shake { animation: shake 0.3s ease-in-out; }
            `}</style>
        </div>
    );
};