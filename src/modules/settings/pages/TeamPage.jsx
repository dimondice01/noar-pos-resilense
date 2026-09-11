import React, { useState, useEffect } from 'react';
import {
    Users, UserPlus, Shield, ShieldCheck, Mail, Lock, Info, Building2, Store,
    Trash2, CreditCard, Percent, PlusCircle, AlertTriangle, Layers, Tag, Save,
    ChevronDown, ChevronUp, CheckCircle2, MonitorSmartphone, Loader2, ArrowUpRight,
    Wallet, ReceiptText, ArrowRightCircle, X, ShieldAlert, Package, CloudDownload, Scale,
    Pencil, Eye, Calendar
} from 'lucide-react';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { Switch } from '../../../core/ui/Switch';
import { authService } from '../../auth/services/authService';
import { collection, getDocs, query, where, updateDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { db as firestoreDB } from '../../../database/firebase'; // 🔥 Renombrado para no chocar con Dexie
import { getDB } from '../../../database/db'; // 🔥 Traemos Dexie para persistencia
import { cn } from '../../../core/utils/cn';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { employeeLedgerRepository } from '../repositories/employeeLedgerRepository';
import { salesRepository } from '../../sales/repositories/salesRepository';
import toast from 'react-hot-toast';
import { PERMISSION_KEYS, PERMISSION_DEFINITIONS, DEFAULT_PERMISSIONS, getFullPermissions } from '../config/permissions';

const API_URL = import.meta.env.VITE_API_URL || "https://us-central1-salvadorpos1.cloudfunctions.net/api";

// =================================================================================
// 🧩 SWITCHES DE PERMISOS (compartido entre alta y edición de empleado)
// =================================================================================
const PERMISSION_GROUP_ICONS = {
    'Caja y Ventas': { Icon: MonitorSmartphone, color: 'text-blue-500' },
    'Gestión de Inventario': { Icon: Package, color: 'text-emerald-500' },
};

const PermissionsSwitchGroups = ({ permissions, togglePermission }) => {
    const groups = [...new Set(PERMISSION_KEYS.map(key => PERMISSION_DEFINITIONS[key].group))];
    return (
        <>
            {groups.map(group => {
                const keys = PERMISSION_KEYS.filter(key => PERMISSION_DEFINITIONS[key].group === group);
                const { Icon, color } = PERMISSION_GROUP_ICONS[group] || {};
                return (
                    <div key={group}>
                        <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1 flex items-center gap-1 mb-2">
                            {Icon && <Icon size={14} className={color} />} {group}
                        </label>
                        <div className="space-y-3 bg-sys-50 p-3 rounded-xl border border-sys-200">
                            {keys.map((key, idx) => (
                                <div key={key} className={cn("flex items-center justify-between", idx > 0 && "border-t border-sys-200 pt-3")}>
                                    <p className="text-xs font-bold text-sys-800">{PERMISSION_DEFINITIONS[key].label}</p>
                                    <Switch checked={permissions[key]} onCheckedChange={() => togglePermission(key)} />
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </>
    );
};

// =================================================================================
// 🧩 MODAL: LIQUIDACIÓN DE EMPLEADO (LEDGER) - MATEMÁTICA EN VIVO
// =================================================================================
const LiquidationModal = ({ isOpen, onClose, employee, onLiquidated }) => {
    const { user: currentUser, activeBranchId } = useAuthStore();
    const [history, setHistory] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLiquidating, setIsLiquidating] = useState(false);

    // 🔥 ESTADO PARA EL SALDO CALCULADO EN VIVO
    const [calculatedDebt, setCalculatedDebt] = useState(0);
    // 🔥 Monto a liquidar — precargado con el total, pero editable (liquidación parcial)
    const [liquidationAmount, setLiquidationAmount] = useState('');

    // 🔥 Ver ticket real de un consumo (POS_CONSUMPTION con refId)
    const [viewSale, setViewSale] = useState(null);
    const [loadingSaleId, setLoadingSaleId] = useState(null);

    useEffect(() => {
        const targetUserId = employee?.uid || employee?.id;

        if (isOpen && targetUserId && currentUser?.companyId) {
            const fetchHistory = async () => {
                setIsLoading(true);
                try {
                    const records = await employeeLedgerRepository.getEmployeeHistory(currentUser.companyId, targetUserId);

                    // Ordenamos para mostrar los más nuevos arriba (Opcional, asumiendo que el repo ya lo hace)
                    setHistory(records);

                    // 🔥 CÁLCULO DE LA VERDAD: Sumamos las deudas (+) y restamos los pagos/liquidaciones (-)
                    let totalDebt = 0;
                    records.forEach(record => {
                        const amount = parseFloat(record.amount) || 0;
                        if (record.type === 'LIQUIDATION' || record.type === 'PAYMENT') {
                            totalDebt -= amount; // Resta deuda
                        } else {
                            totalDebt += amount; // Suma deuda (Consumos, Adelantos)
                        }
                    });

                    // Evitamos saldos negativos por errores de carga
                    const safeDebt = Math.max(0, totalDebt);
                    setCalculatedDebt(safeDebt);
                    setLiquidationAmount(safeDebt > 0 ? String(safeDebt.toFixed(2)) : '');

                } catch (e) {
                    console.error("Error cargando historial", e);
                } finally {
                    setIsLoading(false);
                }
            };
            fetchHistory();
        } else if (isOpen) {
            setIsLoading(false);
        }
    }, [isOpen, employee, currentUser]);

    // 🛡️ Blindaje: nunca permitir vacío, negativo, ni un monto mayor a la deuda real.
    const parsedAmount = parseFloat(liquidationAmount);
    const isAmountValid = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount <= calculatedDebt + 0.01;

    const handleLiquidate = async () => {
        const targetUserId = employee?.uid || employee?.id;

        if (!employee || !targetUserId || !isAmountValid) return;

        const amountToLiquidate = Math.min(parsedAmount, calculatedDebt);
        const isPartial = amountToLiquidate < calculatedDebt - 0.01;

        // 🔥 Nunca adivinar con 'main': con más de una sucursal real ese id no
        // matchea ninguna y la liquidación queda huérfana.
        const branchId = employee.branchId || activeBranchId || currentUser?.branchId;
        if (!branchId) {
            toast.error('No se pudo determinar la sucursal del empleado. Revisá su ficha.');
            return;
        }

        if (!window.confirm(`¿Confirmas la liquidación de $${amountToLiquidate.toLocaleString('es-AR')} para ${employee.name}?${isPartial ? ` Queda un saldo pendiente de $${(calculatedDebt - amountToLiquidate).toLocaleString('es-AR')}.` : ' Esta acción dejará su deuda en 0.'}`)) return;

        setIsLiquidating(true);
        const toastId = toast.loading("Liquidando cuenta...");
        try {
            await employeeLedgerRepository.addTransaction({
                companyId: currentUser.companyId,
                branchId,
                userId: targetUserId,
                type: 'LIQUIDATION',
                amount: amountToLiquidate,
                description: isPartial ? 'Liquidación parcial de cuenta corriente.' : 'Liquidación de cierre de mes.',
                operatorName: currentUser.name || 'Admin'
            });

            toast.success(`Cuenta de ${employee.name} liquidada exitosamente.`, { id: toastId });
            onLiquidated();
            onClose();
        } catch (error) {
            console.error("Error al liquidar:", error);
            toast.error("Error al procesar la liquidación.", { id: toastId });
        } finally {
            setIsLiquidating(false);
        }
    };

    const handleViewSale = async (record) => {
        if (!record.refId) return;
        setLoadingSaleId(record.id);
        try {
            const sale = await salesRepository.getSaleById(record.refId);
            if (sale) setViewSale(sale);
            else toast.error('Venta no encontrada en este dispositivo.');
        } finally {
            setLoadingSaleId(null);
        }
    };

    if (!isOpen || !employee) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">

                {/* HEADER */}
                <div className="p-6 border-b border-sys-100 bg-sys-50 flex justify-between items-start">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <Wallet className="text-brand" size={24}/>
                            <h3 className="font-black text-xl text-sys-900 uppercase tracking-tight">Perfil de Cuenta Corriente</h3>
                        </div>
                        <p className="text-sm font-bold text-sys-600">{employee.name || employee.email}</p>
                    </div>
                    <button onClick={onClose} disabled={isLiquidating} className="p-2 hover:bg-sys-200 rounded-full transition-colors">
                        <X size={20} className="text-sys-400" />
                    </button>
                </div>

                {/* SALDO TOTAL (CALCULADO) + MONTO A LIQUIDAR */}
                <div className="p-6 bg-red-50 border-b border-red-100 space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs font-black text-red-800 uppercase tracking-wider mb-1">Deuda Acumulada</p>
                            {isLoading ? (
                                 <div className="h-10 flex items-center"><Loader2 className="animate-spin text-red-400" size={24}/></div>
                            ) : (
                                <p className="text-4xl font-black text-red-600 tracking-tighter tabular-nums">
                                    $ {calculatedDebt.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                                </p>
                            )}
                        </div>
                    </div>

                    {!isLoading && calculatedDebt > 0 && (
                        <div className="flex items-end gap-3">
                            <div className="flex-1">
                                <label className="text-[11px] font-black text-red-800 uppercase tracking-wider mb-1 block">
                                    Monto a liquidar (podés liquidar parcial)
                                </label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    max={calculatedDebt}
                                    value={liquidationAmount}
                                    onChange={e => setLiquidationAmount(e.target.value)}
                                    disabled={isLiquidating}
                                    className="w-full px-3 py-2.5 rounded-xl border border-red-200 bg-white font-black text-lg text-red-700 tabular-nums focus:outline-none focus:ring-2 focus:ring-red-300"
                                />
                            </div>
                            <Button
                                onClick={handleLiquidate}
                                disabled={isLiquidating || isLoading || !isAmountValid}
                                className="bg-red-600 hover:bg-red-700 text-white shadow-xl shadow-red-200 py-3 shrink-0"
                            >
                                {isLiquidating ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} className="mr-2"/>}
                                LIQUIDAR
                            </Button>
                        </div>
                    )}
                </div>

                {/* HISTORIAL */}
                <div className="flex-1 overflow-y-auto p-4 bg-sys-50/30 custom-scrollbar">
                    <h4 className="text-xs font-bold text-sys-400 uppercase tracking-wider mb-3 px-2 flex items-center gap-2">
                        <ReceiptText size={14}/> Últimos Movimientos
                    </h4>

                    {isLoading ? (
                        <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-brand" size={30}/></div>
                    ) : history.length === 0 ? (
                        <div className="text-center py-10 text-sys-400 text-sm font-medium opacity-60">Sin movimientos registrados.</div>
                    ) : (
                        <div className="space-y-2">
                            {history.map(record => {
                                const isPayment = record.type === 'LIQUIDATION' || record.type === 'PAYMENT';
                                const canViewTicket = record.type === 'POS_CONSUMPTION' && !!record.refId;
                                return (
                                    <div key={record.id} className={cn("p-3 rounded-xl border flex justify-between items-center text-sm shadow-sm", isPayment ? "bg-emerald-50 border-emerald-100" : "bg-white border-sys-200")}>
                                        <div className="flex items-center gap-2 min-w-0">
                                            {canViewTicket && (
                                                <button
                                                    onClick={() => handleViewSale(record)}
                                                    disabled={loadingSaleId === record.id}
                                                    title="Ver ticket"
                                                    className="shrink-0 p-1.5 rounded-lg bg-blue-50 text-blue-500 hover:bg-blue-100 border border-blue-200 transition-all"
                                                >
                                                    {loadingSaleId === record.id ? <Loader2 size={14} className="animate-spin"/> : <Eye size={14} />}
                                                </button>
                                            )}
                                            <div className="min-w-0">
                                                <p className={cn("font-bold", isPayment ? "text-emerald-800" : "text-sys-800")}>
                                                    {record.type === 'ADVANCE' ? 'Vales / Adelantos' : record.type === 'POS_CONSUMPTION' ? 'Consumo Local' : 'Liquidación'}
                                                </p>
                                                <p className="text-xs text-sys-500 mt-0.5">{new Date(record.date).toLocaleDateString('es-AR')} - {record.description}</p>
                                            </div>
                                        </div>
                                        <div className={cn("font-black text-right shrink-0 ml-2", isPayment ? "text-emerald-600" : "text-red-600")}>
                                            {isPayment ? '-' : '+'}$ {parseFloat(record.amount).toLocaleString('es-AR', {minimumFractionDigits: 0})}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

            </div>

            {/* DETALLE DE TICKET (mismo patrón que ClientDashboard.viewSale) */}
            {viewSale && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setViewSale(null)}>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-5 border-b border-sys-100">
                            <div>
                                <p className="text-xs font-black uppercase tracking-widest text-sys-400">Detalle de Venta</p>
                                <p className="text-lg font-black text-sys-900">Ticket #{viewSale.number || viewSale.ticketNumber || viewSale.localId?.slice(-6)}</p>
                            </div>
                            <button onClick={() => setViewSale(null)} className="p-2 hover:bg-sys-100 rounded-full transition-colors">
                                <X size={18} className="text-sys-400" />
                            </button>
                        </div>
                        <div className="px-5 py-3 bg-sys-50 border-b border-sys-100 flex items-center justify-between text-xs text-sys-500 font-bold">
                            <span><Calendar size={12} className="inline mr-1"/>{new Date(viewSale.date || viewSale.createdAt).toLocaleDateString('es-AR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
                        </div>
                        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                            {(viewSale.items || []).map((item, i) => (
                                <div key={i} className="flex items-center justify-between gap-3 py-2 border-b border-sys-50 last:border-0">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="shrink-0 w-7 h-7 rounded-lg bg-sys-100 flex items-center justify-center text-xs font-black text-sys-600">{item.quantity}</span>
                                        <span className="text-sm font-bold text-sys-800 truncate uppercase">{item.name}</span>
                                    </div>
                                    <span className="shrink-0 font-black font-mono text-sm text-sys-900">$ {(item.subtotal ?? item.price * item.quantity).toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                                </div>
                            ))}
                            {(!viewSale.items || viewSale.items.length === 0) && (
                                <p className="text-center text-sys-400 text-sm py-6">Sin detalle de items disponible</p>
                            )}
                        </div>
                        <div className="px-5 py-4 border-t border-sys-100 bg-sys-50/50">
                            <div className="flex justify-between font-black text-base text-sys-900">
                                <span>TOTAL</span><span>$ {(viewSale.total || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// =================================================================================
// 🧩 MODAL: EDITAR EMPLEADO (datos y permisos — nunca toca ledgerDebt)
// =================================================================================
const EditUserModal = ({ isOpen, onClose, employee, branches, onSaved }) => {
    const [name, setName] = useState('');
    const [role, setRole] = useState('CAJERO');
    const [branchId, setBranchId] = useState('');
    const [permissions, setPermissions] = useState(DEFAULT_PERMISSIONS);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (isOpen && employee) {
            setName(employee.name || '');
            setRole(employee.role || 'CAJERO');
            setBranchId(employee.branchId || '');
            setPermissions({ ...DEFAULT_PERMISSIONS, ...(employee.permissions || {}) });
        }
    }, [isOpen, employee]);

    const togglePermission = (key) => setPermissions(prev => ({ ...prev, [key]: !prev[key] }));

    if (!isOpen || !employee) return null;

    const handleSave = async () => {
        if (!name.trim()) return toast.error("El nombre no puede estar vacío.");
        if (role === 'CAJERO' && !branchId) {
            return toast.error("⚠️ Un CAJERO debe tener una sucursal asignada.");
        }

        const targetId = employee.uid || employee.id;
        const finalPermissions = getFullPermissions(role, permissions);

        // 🔥 Solo datos y permisos. NUNCA incluir ledgerDebt acá: la deuda se maneja
        // exclusivamente vía employeeLedgerRepository (ver LiquidationModal).
        const updates = { name: name.trim(), role, branchId: branchId || null, permissions: finalPermissions };

        setIsSaving(true);
        try {
            await updateDoc(doc(firestoreDB, 'users', targetId), updates);

            try {
                const dbLocal = await getDB();
                const existing = await dbLocal.users.get(targetId);
                await dbLocal.users.put({ ...(existing || {}), ...updates, uid: targetId, id: targetId });
            } catch (e) {
                console.warn("Fallo guardado local tras editar usuario", e);
            }

            toast.success("Usuario actualizado correctamente.");
            onSaved({ ...employee, ...updates });
            onClose();
        } catch (error) {
            console.error("Error editando usuario:", error);
            toast.error(`Error al guardar cambios: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">

                {/* HEADER */}
                <div className="p-6 border-b border-sys-100 bg-sys-50 flex justify-between items-start shrink-0">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <Pencil className="text-brand" size={22}/>
                            <h3 className="font-black text-xl text-sys-900 uppercase tracking-tight">Editar Empleado</h3>
                        </div>
                        <p className="text-sm font-bold text-sys-600">{employee.email}</p>
                    </div>
                    <button onClick={onClose} disabled={isSaving} className="p-2 hover:bg-sys-200 rounded-full transition-colors">
                        <X size={20} className="text-sys-400" />
                    </button>
                </div>

                {/* FORM */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                    <div>
                        <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1">Nombre</label>
                        <input
                            type="text"
                            className="w-full bg-sys-50 border border-sys-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-all"
                            value={name}
                            onChange={e => setName(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1">Rol</label>
                            <div className="flex flex-col gap-2 mt-1">
                                {['CAJERO', 'ADMIN'].map((r) => (
                                    <button
                                        key={r}
                                        type="button"
                                        onClick={() => setRole(r)}
                                        className={cn(
                                            "py-2 rounded-lg text-xs font-bold transition-all border flex items-center justify-center gap-2",
                                            role === r
                                                ? "bg-brand text-white border-brand shadow-md"
                                                : "bg-white text-sys-500 border-sys-200 hover:bg-sys-50"
                                        )}
                                    >
                                        {r === 'ADMIN' ? <ShieldCheck size={14}/> : <UserPlus size={14}/>} {r}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1">Sucursal</label>
                            <div className="relative mt-1">
                                <Store size={16} className="absolute left-3 top-3 text-sys-400 pointer-events-none" />
                                <select
                                    className={cn(
                                        "w-full bg-sys-50 border border-sys-200 rounded-xl pl-9 pr-2 py-2.5 text-xs outline-none focus:border-brand transition-all appearance-none cursor-pointer font-medium text-sys-700",
                                        !branchId && role === 'CAJERO' && "border-red-300 bg-red-50"
                                    )}
                                    value={branchId}
                                    onChange={(e) => setBranchId(e.target.value)}
                                >
                                    <option value="">Seleccionar...</option>
                                    {branches.map(b => (
                                        <option key={b.id} value={b.id}>{b.name}</option>
                                    ))}
                                </select>
                                <div className="absolute right-3 top-3 pointer-events-none">
                                    <ChevronDown size={14} className="text-sys-400" />
                                </div>
                            </div>
                        </div>
                    </div>

                    {role === 'CAJERO' && (
                        <div className="pt-2 border-t border-sys-200 mt-2 space-y-4">
                            <PermissionsSwitchGroups permissions={permissions} togglePermission={togglePermission} />
                        </div>
                    )}
                </div>

                {/* FOOTER */}
                <div className="p-6 bg-sys-50 border-t border-sys-200 flex gap-3 shrink-0">
                    <Button variant="ghost" onClick={onClose} disabled={isSaving} className="flex-1 rounded-2xl h-12 font-bold bg-white border border-sys-200 hover:bg-sys-100 text-sys-600">Cancelar</Button>
                    <Button onClick={handleSave} disabled={isSaving} className="flex-1 h-12 shadow-md">
                        {isSaving ? <Loader2 size={18} className="animate-spin" /> : 'Guardar Cambios'}
                    </Button>
                </div>
            </div>
        </div>
    );
};

// =================================================================================
// 👑 MAIN PAGE
// =================================================================================
export const TeamPage = () => {
  const [activeTab, setActiveTab] = useState('team'); 
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]); 
  const [loading, setLoading] = useState(true);
  
  // ESTADO FINANCIERO JERÁRQUICO
  const [paymentMethods, setPaymentMethods] = useState([]); 
  const [savingFinancials, setSavingFinancials] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [expandedBrand, setExpandedBrand] = useState(null); 
  const [newRate, setNewRate] = useState({ qty: '', interest: '' });

  // ESTADO CONFIGURACIÓN POS
  const [posConfig, setPosConfig] = useState({
      isWholesaleEnabled: false,
      wholesalePercentage: 10,
      paymentSurcharges: {
          cash: 0, transfer: 0, mp: 0, card: 0, current_account: 0
      },
      paymentDiscounts: {
          cash: 0, transfer: 0, mp: 0, card: 0, current_account: 0
      },
      // 🔥 Formato de código de barras de balanza por sucursal: { [branchId]: 'EAN13_GRAMS' }
      // Si una sucursal no tiene entrada, usa el formato legado (KRETZ/SYSTEL) sin cambios.
      scaleBarcodeFormats: {},
      // 🔥 Balanzas "soporte total" (Kretz) por sucursal: { [branchId]: [{ id, prefix, categoryName }] }
      scaleTotalProfiles: {},
      // 🔥 Si está activo, la Facturación Electrónica arranca tildada en cada venta (togglable para desactivarla puntualmente)
      afipAlwaysOn: false
  });
  const [savingPosConfig, setSavingPosConfig] = useState(false);
  const [newTotalProfile, setNewTotalProfile] = useState({ prefix: '', categoryName: '' });

  // ESTADO MODAL DE LIQUIDACIÓN
  const [selectedEmployeeForLedger, setSelectedEmployeeForLedger] = useState(null);

  // ESTADO MODAL DE EDICIÓN DE EMPLEADO
  const [editingUser, setEditingUser] = useState(null);

  const { user: currentUser, activeBranchId } = useAuthStore();

  const [isCreating, setIsCreating] = useState(false);
  
  // 🔥 ESTADO CON LA MATRIZ DE PERMISOS COMPLETADA
  const [formData, setFormData] = useState({ 
      name: '', 
      email: '', 
      password: '', 
      role: 'CAJERO',
      branchId: '',
      permissions: DEFAULT_PERMISSIONS
  });

  useEffect(() => {
    if (currentUser?.companyId) {
        loadData();
        loadFinancials();
        loadPosConfig();

        // 🔥 Reconciliar cajeros creados offline (uid temporal -> uid real de Firebase Auth)
        if (navigator.onLine) {
            authService.syncPendingOfflineUsers().then(({ synced }) => {
                if (synced > 0) loadData();
            });
        }
    }
  }, [currentUser, activeBranchId]);

  // =================================================================================
  // ⚡ DESCARGA FORZADA (CLOUD PULL) - EL BOTÓN DE RESCATE
  // =================================================================================
  const handleForceCloudSync = async () => {
      setLoading(true);
      const toastId = toast.loading("Sincronizando empleados...");
      try {
          if (!currentUser?.companyId) throw new Error("Falta companyId");

          const usersQuery = query(
              collection(firestoreDB, 'users'), 
              where('companyId', '==', currentUser.companyId)
          );
          
          const snapshot = await getDocs(usersQuery);
          const cloudUsers = snapshot.docs.map(doc => ({ 
              uid: doc.id, // Forzamos unificación de id
              id: doc.id,
              ...doc.data() 
          }));

          // 🔥 Almacenamos los usuarios localmente en Dexie para caché
          try {
              const dbLocal = await getDB();
              await dbLocal.users.bulkPut(cloudUsers);
          } catch (dexieErr) {
              console.warn("Fallo guardado de usuarios en Dexie", dexieErr);
          }

          setUsers(cloudUsers);
          toast.success("Empleados sincronizados.", { id: toastId });
      } catch (error) {
          console.error("Error forzando sync:", error);
          toast.error(`Error al bajar de la nube: ${error.message}`, { id: toastId });
      } finally {
          setLoading(false);
      }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      
      const dbLocal = await getDB();
      let usersToSet = [];
      let branchesToSet = [];

      // Intentamos cargar de Local primero
      try {
          usersToSet = await dbLocal.users.where('companyId').equals(currentUser.companyId).toArray();
          branchesToSet = await dbLocal.branches.where('companyId').equals(currentUser.companyId).toArray();
      } catch (e) { console.warn("Dexie error, falling back to cloud"); }

      // Si no hay datos locales, forzamos bajada de nube silenciosa
      if (usersToSet.length === 0 || branchesToSet.length === 0) {
          const usersQuery = query(
              collection(firestoreDB, 'users'), 
              where('companyId', '==', currentUser.companyId)
          );
          
          const branchesQuery = query(
              collection(firestoreDB, 'companies', currentUser.companyId, 'branches')
          );
          
          const [usersSnap, branchesSnap] = await Promise.all([
              getDocs(usersQuery),
              getDocs(branchesQuery)
          ]);

          usersToSet = usersSnap.docs.map(doc => ({ uid: doc.id, id: doc.id, ...doc.data() }));
          branchesToSet = branchesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

          // Guardar caché silencioso
          try {
              if (usersToSet.length > 0) await dbLocal.users.bulkPut(usersToSet);
              if (branchesToSet.length > 0) await dbLocal.branches.bulkPut(branchesToSet);
          } catch (e) { }
      }

      setUsers(usersToSet);
      setBranches(branchesToSet);

    } catch (error) {
      console.error("Error cargando equipo:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadFinancials = async () => {
      try {
          const docRef = doc(firestoreDB, `companies/${currentUser.companyId}/config/financials`);
          const snap = await getDoc(docRef);
          if (snap.exists() && snap.data().methods) {
              setPaymentMethods(snap.data().methods);
          } else {
              setPaymentMethods([]);
          }
      } catch (error) {
          console.error("Error cargando finanzas:", error);
      }
  };

  const loadPosConfig = async () => {
      try {
          const docRef = doc(firestoreDB, `companies/${currentUser.companyId}/config/pos_settings`);
          const snap = await getDoc(docRef);
          if (snap.exists()) {
              const data = snap.data();
              setPosConfig({
                  isWholesaleEnabled: data.isWholesaleEnabled || false,
                  wholesalePercentage: data.wholesalePercentage || 10,
                  paymentSurcharges: data.paymentSurcharges || {
                      cash: 0, transfer: 0, mp: 0, card: 0, current_account: 0
                  },
                  paymentDiscounts: data.paymentDiscounts || {
                      cash: 0, transfer: 0, mp: 0, card: 0, current_account: 0
                  },
                  scaleBarcodeFormats: data.scaleBarcodeFormats || {},
                  scaleTotalProfiles: data.scaleTotalProfiles || {},
                  afipAlwaysOn: data.afipAlwaysOn || false
              });
          }
      } catch (error) {
          console.error("Error cargando config de POS:", error);
      }
  };

  const handleToggleScaleFormat = (checked) => {
      if (!activeBranchId || activeBranchId === 'ALL') {
          toast.error("Elegí una sucursal específica para activar esta opción.");
          return;
      }
      setPosConfig(prev => {
          const scaleBarcodeFormats = { ...prev.scaleBarcodeFormats };
          if (checked) scaleBarcodeFormats[activeBranchId] = 'EAN13_GRAMS';
          else delete scaleBarcodeFormats[activeBranchId];
          return { ...prev, scaleBarcodeFormats };
      });
  };

  // 🔥 BALANZAS "SOPORTE TOTAL" (KRETZ) - CRUD por sucursal
  const handleAddTotalProfile = () => {
      if (!activeBranchId || activeBranchId === 'ALL') {
          toast.error("Elegí una sucursal específica para configurar esta opción.");
          return;
      }
      const prefix = newTotalProfile.prefix.trim();
      const categoryName = newTotalProfile.categoryName.trim();

      if (!/^\d{6}$/.test(prefix)) {
          toast.error("El prefijo debe tener exactamente 6 dígitos numéricos.");
          return;
      }
      if (!categoryName) {
          toast.error("Ingresá un nombre de categoría/venta para esta balanza.");
          return;
      }

      const currentProfiles = posConfig.scaleTotalProfiles?.[activeBranchId] || [];
      if (currentProfiles.some(p => p.prefix === prefix)) {
          toast.error("Ese prefijo ya está configurado para esta sucursal.");
          return;
      }

      const newProfile = { id: `stp_${Date.now()}`, prefix, categoryName: categoryName.toUpperCase() };
      setPosConfig(prev => ({
          ...prev,
          scaleTotalProfiles: {
              ...prev.scaleTotalProfiles,
              [activeBranchId]: [...currentProfiles, newProfile]
          }
      }));
      setNewTotalProfile({ prefix: '', categoryName: '' });
  };

  const handleDeleteTotalProfile = (profileId) => {
      if (!activeBranchId) return;
      const currentProfiles = posConfig.scaleTotalProfiles?.[activeBranchId] || [];
      setPosConfig(prev => ({
          ...prev,
          scaleTotalProfiles: {
              ...prev.scaleTotalProfiles,
              [activeBranchId]: currentProfiles.filter(p => p.id !== profileId)
          }
      }));
  };

  const getBranchName = (branchId) => {
      if (!branchId) return 'Global / Sin Asignar';
      const b = branches.find(br => br.id === branchId);
      return b ? b.name : 'Sucursal Desconocida';
  };

  const handleDeleteUser = async (userId, userEmail, userRole) => {
      if (userRole === 'ADMIN' && users.filter(u => u.role === 'ADMIN').length <= 1) {
          return toast.error("❌ No puedes borrar al último administrador.");
      }

      if (!window.confirm(`⚠️ ¿Estás seguro de eliminar a ${userEmail}?\nEsta acción borrará su acceso y datos permanentemente.`)) {
          return;
      }

      try {
          setLoading(true);

          // 🔥 FIX: el borrado real lo hace el backend (Admin SDK). Las reglas de
          // Firestore bloquean a propósito el deleteDoc() directo del cliente para
          // no-superadmins ("Borrar bloqueado (Solo backend...)"), así que intentarlo
          // acá primero solo tiraba permission-denied y nunca se llegaba al backend.
          const token = await authService.getToken();
          if (!token) throw new Error("No se pudo obtener el token de sesión.");

          const response = await fetch(`${API_URL}/delete-user`, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ uid: userId })
          });

          if (!response.ok) {
              const errData = await response.json().catch(() => ({}));
              throw new Error(errData.error || `Error ${response.status}`);
          }

          try {
              const dbLocal = await getDB();
              await dbLocal.users.delete(userId);
          } catch (e) {}

          toast.success("Usuario eliminado correctamente.");
          loadData();
      } catch (error) {
          console.error("Error eliminando usuario:", error);
          toast.error(`Error al eliminar usuario: ${error.code || error.message || 'desconocido'}`);
      } finally {
          setLoading(false);
      }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (formData.password.length < 6) return toast.error("La contraseña debe tener 6 caracteres mínimo.");
    if (!currentUser?.companyId) return toast.error("Error crítico: No tienes empresa asignada.");
    
    if (formData.role === 'CAJERO' && !formData.branchId) {
        return toast.error("⚠️ Atención: Un CAJERO debe tener una sucursal asignada obligatoriamente.");
    }

    // Roles elevados obtienen bypass total de permisos, igual que en EditUserModal
    const finalPermissions = getFullPermissions(formData.role, formData.permissions);

    setIsCreating(true);
    const toastId = toast.loading("Creando credenciales...");
    try {
      const newEmployeeData = {
          ...formData,
          permissions: finalPermissions,
          companyId: currentUser.companyId,
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          branchId: formData.branchId || null,
          ledgerDebt: 0
      };

      await authService.createUser(newEmployeeData);

      const q = query(
          collection(firestoreDB, 'users'),
          where('email', '==', formData.email),
          where('companyId', '==', currentUser.companyId)
      );

      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
          const userDoc = querySnapshot.docs[0];
          await updateDoc(userDoc.ref, {
              branchId: formData.branchId || null,
              role: formData.role,
              permissions: finalPermissions,
              ledgerDebt: 0
          });
      }

      toast.success(`Usuario ${formData.name} creado exitosamente.`, { id: toastId });
      setFormData({
          name: '', email: '', password: '', role: 'CAJERO', branchId: '',
          permissions: DEFAULT_PERMISSIONS
      });
      
      // Forzamos actualización visual rápida
      handleForceCloudSync();

    } catch (error) {
      console.error(error);
      toast.error(`Error: ${error.message}`, { id: toastId });
    } finally {
      setIsCreating(false);
    }
  };

  const togglePermission = (key) => {
      setFormData(prev => ({
          ...prev,
          permissions: {
              ...prev.permissions,
              [key]: !prev.permissions[key]
          }
      }));
  };

  const handleAddBrand = () => {
      const name = newBrandName.trim().toUpperCase();
      if (!name) return;
      if (paymentMethods.some(m => m.brand === name)) {
          toast.error("Esta marca ya existe.");
          return;
      }

      const newMethod = { brand: name, rates: [] };
      const updatedMethods = [...paymentMethods, newMethod];
      
      setPaymentMethods(updatedMethods);
      setNewBrandName('');
      setExpandedBrand(name); 
      saveFinancials(updatedMethods);
  };

  const handleDeleteBrand = (brandName) => {
      if(!window.confirm(`¿Borrar la tarjeta ${brandName} y todas sus reglas?`)) return;
      const updatedMethods = paymentMethods.filter(m => m.brand !== brandName);
      setPaymentMethods(updatedMethods);
      saveFinancials(updatedMethods);
  };

  const handleAddRate = (brandName) => {
      const qty = parseInt(newRate.qty);
      const interest = parseFloat(newRate.interest);

      if (!qty || isNaN(interest)) {
          toast.error("Datos inválidos");
          return;
      }

      const updatedMethods = paymentMethods.map(method => {
          if (method.brand === brandName) {
              const exists = method.rates.some(r => r.qty === qty);
              if (exists) {
                  toast.error(`Ya existe una regla para ${qty} cuotas en ${brandName}. Bórrala primero.`);
                  return method;
              }
              const newRates = [...method.rates, { qty, interest }].sort((a,b) => a.qty - b.qty);
              return { ...method, rates: newRates };
          }
          return method;
      });

      setPaymentMethods(updatedMethods);
      setNewRate({ qty: '', interest: '' });
      saveFinancials(updatedMethods);
  };

  const handleDeleteRate = (brandName, qtyToDelete) => {
      const updatedMethods = paymentMethods.map(method => {
          if (method.brand === brandName) {
              return { ...method, rates: method.rates.filter(r => r.qty !== qtyToDelete) };
          }
          return method;
      });
      setPaymentMethods(updatedMethods);
      saveFinancials(updatedMethods);
  };

  const saveFinancials = async (data) => {
      setSavingFinancials(true);
      try {
          const docRef = doc(firestoreDB, `companies/${currentUser.companyId}/config/financials`);
          await setDoc(docRef, { methods: data }, { merge: true });
      } catch (error) {
          console.error("Error guardando:", error);
          toast.error("Error de conexión al guardar configuración.");
      } finally {
          setSavingFinancials(false);
      }
  };

  const savePosConfig = async () => {
      setSavingPosConfig(true);
      try {
          const docRef = doc(firestoreDB, `companies/${currentUser.companyId}/config/pos_settings`);
          await setDoc(docRef, posConfig, { merge: true });
          
          try {
              const dbLocal = await getDB();
              await dbLocal.config.put({ key: 'pos_settings', value: posConfig, updatedAt: new Date().toISOString() });
          } catch(e){}

          toast.success("Configuración del Punto de Venta guardada correctamente.");
      } catch (error) {
          console.error("Error guardando config POS:", error);
          toast.error("Error al guardar la configuración.");
      } finally {
          setSavingPosConfig(false);
      }
  };

  const handleSurchargeChange = (method, value) => {
      const numValue = parseFloat(value) || 0;
      setPosConfig(prev => ({
          ...prev,
          paymentSurcharges: {
              ...prev.paymentSurcharges,
              [method]: numValue
          }
      }));
  };

  const handleDiscountChange = (method, value) => {
      const numValue = parseFloat(value) || 0;
      setPosConfig(prev => ({
          ...prev,
          paymentDiscounts: {
              ...prev.paymentDiscounts,
              [method]: numValue
          }
      }));
  };

  const filteredUsers = activeBranchId && activeBranchId !== 'ALL'
      ? users.filter(u => u.branchId === activeBranchId)
      : users;

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20 px-4">
      
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
            <h2 className="text-2xl font-bold text-sys-900 flex items-center gap-2">
            <Users className="text-brand" /> Configuración General
            </h2>
            <p className="text-sys-500">Administra usuarios, finanzas y parámetros del sistema.</p>
        </div>
        
        <div className="flex gap-4 items-center">
            {/* 🔥 BOTÓN PARA BAJAR LOS EMPLEADOS DE LA NUBE */}
            <Button 
                variant="outline" 
                onClick={handleForceCloudSync} 
                className="shadow-sm border-brand/30 text-brand bg-brand/5 hover:bg-brand hover:text-white transition-all h-10 px-3"
                title="Forzar actualización de empleados"
            >
                <CloudDownload size={16} className={loading ? "animate-bounce mr-2" : "mr-2"}/>
                <span className="hidden sm:inline">Sync Users</span>
            </Button>

            <div className="bg-sys-100 p-1 rounded-xl flex gap-1 overflow-x-auto h-10 items-center">
                <button 
                    onClick={() => setActiveTab('team')}
                    className={cn("px-4 py-1.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap", activeTab === 'team' ? "bg-white shadow text-sys-900" : "text-sys-500 hover:bg-sys-200")}
                >
                    Personal
                </button>
                <button 
                    onClick={() => setActiveTab('financials')}
                    className={cn("px-4 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap", activeTab === 'financials' ? "bg-white shadow text-indigo-600" : "text-sys-500 hover:bg-sys-200")}
                >
                    <CreditCard size={14}/> Planes
                </button>
                <button 
                    onClick={() => setActiveTab('pos')}
                    className={cn("px-4 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap", activeTab === 'pos' ? "bg-white shadow text-orange-600" : "text-sys-500 hover:bg-sys-200")}
                >
                    <MonitorSmartphone size={14}/> POS
                </button>
            </div>
        </div>
      </header>

      {/* =================================================================================
          VISTA: EQUIPO 
      ================================================================================= */}
      {activeTab === 'team' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in">
            {/* Formulario Alta */}
            <div className="lg:col-span-1">
              <Card className="sticky top-6 border-brand/10 shadow-lg shadow-brand/5">
                <h3 className="font-bold text-lg text-sys-800 mb-4 flex items-center gap-2">
                  <UserPlus size={20} /> Nuevo Miembro
                </h3>
                
                <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1">Nombre</label>
                    <input 
                      type="text" required 
                      className="w-full bg-sys-50 border border-sys-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-all"
                      placeholder="Ej: Juan Perez"
                      value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1">Email Acceso</label>
                    <div className="relative">
                      <Mail size={16} className="absolute left-3 top-3 text-sys-400" />
                      <input 
                        type="email" required 
                        className="w-full bg-sys-50 border border-sys-200 rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none focus:border-brand transition-all"
                        placeholder="cajero@noar.com"
                        value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1">Contraseña</label>
                    <div className="relative">
                      <Lock size={16} className="absolute left-3 top-3 text-sys-400" />
                      <input 
                        type="password" required 
                        className="w-full bg-sys-50 border border-sys-200 rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none focus:border-brand transition-all"
                        placeholder="••••••"
                        value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1">Rol</label>
                        <div className="flex flex-col gap-2 mt-1">
                          {['CAJERO', 'ADMIN'].map((role) => (
                            <button
                              key={role}
                              type="button"
                              onClick={() => setFormData({...formData, role})}
                              className={cn(
                                "py-2 rounded-lg text-xs font-bold transition-all border flex items-center justify-center gap-2",
                                formData.role === role 
                                  ? "bg-brand text-white border-brand shadow-md" 
                                  : "bg-white text-sys-500 border-sys-200 hover:bg-sys-50"
                              )}
                            >
                              {role === 'ADMIN' ? <ShieldCheck size={14}/> : <UserPlus size={14}/>} {role}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1">Sucursal</label>
                        <div className="relative mt-1">
                            <Store size={16} className="absolute left-3 top-3 text-sys-400 pointer-events-none" />
                            <select 
                                className={cn(
                                    "w-full bg-sys-50 border border-sys-200 rounded-xl pl-9 pr-2 py-2.5 text-xs outline-none focus:border-brand transition-all appearance-none cursor-pointer font-medium text-sys-700",
                                    !formData.branchId && formData.role === 'CAJERO' && "border-red-300 bg-red-50"
                                )}
                                value={formData.branchId}
                                onChange={(e) => setFormData({...formData, branchId: e.target.value})}
                                required={formData.role === 'CAJERO'}
                            >
                                <option value="">Seleccionar...</option>
                                {branches.map(b => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                            <div className="absolute right-3 top-3 pointer-events-none">
                                <ChevronDown size={14} className="text-sys-400" />
                            </div>
                        </div>
                      </div>
                  </div>

                  {/* 🔥 BLOQUE DE PERMISOS */}
                  {formData.role === 'CAJERO' && (
                      <div className="pt-2 border-t border-sys-200 mt-4 space-y-4">
                          <PermissionsSwitchGroups permissions={formData.permissions} togglePermission={togglePermission} />
                      </div>
                  )}

                  <Button type="submit" className="w-full mt-4 h-12 shadow-md" disabled={isCreating}>
                    {isCreating ? <Loader2 size={18} className="animate-spin" /> : 'Dar de Alta Empleado'}
                  </Button>
                </form>
              </Card>
            </div>

            {/* Lista */}
            <div className="lg:col-span-2">
              <Card className="p-0 overflow-hidden">
                <div className="p-4 border-b border-sys-100 bg-sys-50/50 flex justify-between items-center">
                  <div className="flex flex-col">
                      <h4 className="font-bold text-sys-700 text-sm">Personal Activo ({filteredUsers.length})</h4>
                      {activeBranchId && activeBranchId !== 'ALL' && <span className="text-[10px] text-brand font-bold uppercase tracking-wider">Filtrado por: {getBranchName(activeBranchId)}</span>}
                  </div>
                </div>
                
                <div className="divide-y divide-sys-100">
                  {loading ? (
                    <div className="p-10 text-center flex justify-center"><Loader2 className="animate-spin text-brand" size={24} /></div>
                  ) : filteredUsers.length === 0 ? (
                    <div className="p-8 text-center text-sys-400 italic">No hay usuarios en esta vista. Intenta clickear "Sync Users".</div>
                  ) : (
                    filteredUsers.map((u) => {
                        const debt = parseFloat(u.ledgerDebt || 0);
                        const hasDebt = debt > 0;
                        const perms = u.permissions || {};

                        return (
                          <div key={u.id || u.uid} className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between group hover:bg-sys-50 transition-colors gap-4">
                            <div className="flex items-center gap-4">
                              <div className={cn(
                                "w-10 h-10 rounded-full flex items-center justify-center text-white shadow-sm font-bold text-sm",
                                u.role === 'ADMIN' ? "bg-sys-800" : "bg-brand"
                              )}>
                                {u.name?.charAt(0).toUpperCase() || 'U'}
                              </div>
                              <div>
                                <p className="font-bold text-sys-900 text-sm flex items-center gap-2">
                                    {u.name}
                                    {u.role === 'ADMIN' && <span className="px-1.5 py-0.5 rounded text-[8px] bg-sys-200 text-sys-600 uppercase font-black tracking-widest"><ShieldCheck size={10} className="inline mr-0.5"/> ADMIN</span>}
                                </p>
                                <p className="text-xs text-sys-500 font-mono">{u.email}</p>
                                
                                {u.role === 'CAJERO' && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        <span className={cn("text-[9px] px-1.5 rounded-full border uppercase font-bold", perms.canApplyDiscount ? "bg-green-50 text-green-600 border-green-200" : "bg-sys-100 text-sys-400 border-sys-200")}>Desc</span>
                                        <span className={cn("text-[9px] px-1.5 rounded-full border uppercase font-bold", perms.canVoidSales ? "bg-green-50 text-green-600 border-green-200" : "bg-sys-100 text-sys-400 border-sys-200")}>Anular</span>
                                        <span className={cn("text-[9px] px-1.5 rounded-full border uppercase font-bold", perms.canWithdrawCash ? "bg-green-50 text-green-600 border-green-200" : "bg-sys-100 text-sys-400 border-sys-200")}>Retiros</span>
                                        <span className={cn("text-[9px] px-1.5 rounded-full border uppercase font-bold", perms.canSeeExpectedCash ? "bg-green-50 text-green-600 border-green-200" : "bg-red-50 text-red-500 border-red-200")}>Z</span>
                                        <span className={cn("text-[9px] px-1.5 rounded-full border uppercase font-bold ml-2", perms.canAddStock ? "bg-green-50 text-green-600 border-green-200" : "bg-sys-100 text-sys-400 border-sys-200")}>+Stock</span>
                                        <span className={cn("text-[9px] px-1.5 rounded-full border uppercase font-bold", perms.canRemoveStock ? "bg-green-50 text-green-600 border-green-200" : "bg-sys-100 text-sys-400 border-sys-200")}>Merma</span>
                                        <span className={cn("text-[9px] px-1.5 rounded-full border uppercase font-bold", perms.canChangePrices ? "bg-green-50 text-green-600 border-green-200" : "bg-sys-100 text-sys-400 border-sys-200")}>Precios</span>
                                    </div>
                                )}
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-4 self-end md:self-auto w-full md:w-auto justify-end">
                                <button 
                                    onClick={() => setSelectedEmployeeForLedger(u)}
                                    className={cn(
                                        "px-3 py-1.5 rounded-lg border transition-all text-xs font-bold flex items-center gap-2",
                                        hasDebt ? "bg-red-50 text-red-600 border-red-200 hover:bg-red-100 shadow-sm" : "bg-white text-sys-400 border-sys-200 hover:border-sys-300 hover:text-sys-600"
                                    )}
                                    title="Ver Cuenta Corriente"
                                >
                                    <Wallet size={14}/>
                                    {hasDebt ? `Debe $${debt.toLocaleString('es-AR')}` : "Al día"}
                                    <ArrowRightCircle size={14} className={cn("opacity-50", hasDebt && "text-red-500")}/>
                                </button>

                                <button
                                    onClick={() => setEditingUser(u)}
                                    className="p-2 text-sys-300 hover:text-brand hover:bg-brand/10 rounded-full transition-all"
                                    title="Editar Usuario"
                                >
                                    <Pencil size={18} />
                                </button>

                                <button
                                    onClick={() => handleDeleteUser(u.id || u.uid, u.email, u.role)}
                                    className="p-2 text-sys-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                                    title="Eliminar Usuario"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                          </div>
                        );
                    })
                  )}
                </div>
              </Card>
            </div>
          </div>
      )}

      {/* =================================================================================
          VISTA: CONFIGURACIÓN FINANCIERA (PLANES DE TARJETAS)
      ================================================================================= */}
      {activeTab === 'financials' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 animate-in fade-in">
              
              <div className="md:col-span-1 space-y-4">
                  <div className="bg-indigo-900 text-white p-6 rounded-2xl shadow-xl shadow-indigo-500/20">
                      <CreditCard size={32} className="mb-4 text-indigo-300"/>
                      <h3 className="text-xl font-bold mb-1">Tarjetas y Planes</h3>
                      <p className="text-xs text-indigo-200 opacity-80 mb-6">
                          Configure tasas específicas para cada tarjeta (Visa, Master, Naranja, etc.) para competir con precisión.
                      </p>
                      
                      <div className="bg-white/10 p-1 rounded-xl flex gap-2 border border-white/20">
                          <input 
                              type="text" 
                              className="w-full bg-transparent px-3 text-sm font-bold placeholder-indigo-300 text-white outline-none uppercase"
                              placeholder="NUEVA MARCA (EJ: VISA)"
                              value={newBrandName}
                              onChange={(e) => setNewBrandName(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleAddBrand()}
                          />
                          <button onClick={handleAddBrand} className="p-2 bg-white text-indigo-900 rounded-lg hover:bg-indigo-50 transition-colors">
                              <PlusCircle size={20} />
                          </button>
                      </div>
                  </div>

                  <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 flex gap-3">
                      <AlertTriangle size={20} className="text-orange-500 shrink-0" />
                      <div>
                          <p className="text-xs font-bold text-orange-800">Importante</p>
                          <p className="text-[10px] text-orange-700 mt-1 leading-relaxed">
                              Cada tarjeta tiene sus propias reglas. Si configuras "3 Cuotas 0%" en VISA, no afectará a Naranja.
                          </p>
                      </div>
                  </div>
              </div>

              <div className="md:col-span-2 space-y-4">
                  {savingFinancials && <p className="text-xs text-indigo-600 font-bold animate-pulse text-right">Guardando cambios...</p>}
                  
                  {paymentMethods.length === 0 ? (
                      <Card className="p-10 flex flex-col items-center justify-center text-sys-400 border-dashed">
                          <Layers size={48} className="mb-2 opacity-20"/>
                          <p>No hay tarjetas configuradas.</p>
                      </Card>
                  ) : (
                      paymentMethods.map((method) => (
                          <Card key={method.brand} className={cn("p-0 overflow-hidden transition-all duration-300", expandedBrand === method.brand ? "ring-2 ring-indigo-500 shadow-md" : "hover:border-indigo-200")}>
                              <div 
                                  className="p-4 flex items-center justify-between cursor-pointer bg-sys-50/50 hover:bg-sys-100 transition-colors"
                                  onClick={() => setExpandedBrand(expandedBrand === method.brand ? null : method.brand)}
                              >
                                  <div className="flex items-center gap-3">
                                      <div className="w-10 h-6 bg-white border border-sys-200 rounded flex items-center justify-center shadow-sm">
                                          <span className="text-[10px] font-black text-sys-700">{method.brand.substring(0,4)}</span>
                                      </div>
                                      <div>
                                          <h4 className="font-bold text-sys-800">{method.brand}</h4>
                                          <p className="text-[10px] text-sys-500 font-medium">
                                              {method.rates.length} Planes configurados
                                          </p>
                                      </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                      <button 
                                          onClick={(e) => { e.stopPropagation(); handleDeleteBrand(method.brand); }}
                                          className="p-2 text-sys-300 hover:text-red-500 hover:bg-red-50 rounded-full"
                                      >
                                          <Trash2 size={16}/>
                                      </button>
                                      {expandedBrand === method.brand ? <ChevronUp size={20} className="text-sys-400"/> : <ChevronDown size={20} className="text-sys-400"/>}
                                  </div>
                              </div>

                              {expandedBrand === method.brand && (
                                  <div className="p-4 bg-white border-t border-sys-100 animate-in slide-in-from-top-2">
                                      <div className="space-y-2 mb-4">
                                          {method.rates.length === 0 && <p className="text-xs text-sys-400 italic text-center">Sin tasas definidas para {method.brand}</p>}
                                          
                                          {method.rates.map(rate => (
                                              <div key={rate.qty} className="flex items-center justify-between p-2 rounded-lg border border-sys-100 hover:bg-sys-50">
                                                  <div className="flex items-center gap-3">
                                                      <span className="bg-sys-800 text-white text-[10px] font-bold px-2 py-1 rounded">
                                                          {rate.qty} x
                                                      </span>
                                                      <span className={cn("text-xs font-bold uppercase", rate.interest === 0 ? "text-green-600" : "text-sys-700")}>
                                                          {rate.interest === 0 ? "Sin Interés" : `+ ${rate.interest}% Interés`}
                                                      </span>
                                                  </div>
                                                  <button onClick={() => handleDeleteRate(method.brand, rate.qty)} className="text-sys-300 hover:text-red-500">
                                                      <Trash2 size={14}/>
                                                  </button>
                                              </div>
                                          ))}
                                      </div>

                                      <div className="bg-indigo-50 p-2 rounded-xl flex gap-2 items-center">
                                          <input 
                                              type="number" 
                                              className="w-16 bg-white border border-indigo-100 rounded-lg px-2 py-1.5 text-xs font-bold text-center outline-none focus:border-indigo-500 placeholder-indigo-300"
                                              placeholder="Cuotas"
                                              value={newRate.qty}
                                              onChange={(e) => setNewRate({...newRate, qty: e.target.value})}
                                          />
                                          <span className="text-indigo-300 text-xs font-bold">x</span>
                                          <div className="relative flex-1">
                                              <input 
                                                  type="number" 
                                                  className="w-full bg-white border border-indigo-100 rounded-lg pl-2 pr-6 py-1.5 text-xs font-bold outline-none focus:border-indigo-500 placeholder-indigo-300"
                                                  placeholder="% Interés"
                                                  value={newRate.interest}
                                                  onChange={(e) => setNewRate({...newRate, interest: e.target.value})}
                                              />
                                              <span className="absolute right-2 top-1.5 text-indigo-400 text-[10px]">%</span>
                                          </div>
                                          <Button size="xs" onClick={() => handleAddRate(method.brand)} className="bg-indigo-600 hover:bg-indigo-700">
                                              <PlusCircle size={14} className="mr-1"/> Agregar
                                          </Button>
                                      </div>
                                  </div>
                              )}
                          </Card>
                      ))
                  )}
              </div>
          </div>
      )}

      {/* =================================================================================
          VISTA: PUNTO DE VENTA (Configuraciones Especiales)
      ================================================================================= */}
      {activeTab === 'pos' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in">
              <div className="space-y-6">
                  
                  {/* BLOQUE: DESCUENTO F6 */}
                  <Card className="p-6 border-orange-100 shadow-lg shadow-orange-500/5 relative overflow-hidden">
                      <div className="absolute -right-4 -top-4 w-24 h-24 bg-orange-50 rounded-full opacity-50 pointer-events-none"></div>
                      
                      <div className="flex items-start justify-between mb-6 relative z-10">
                          <div>
                              <h3 className="font-bold text-lg text-sys-900 flex items-center gap-2">
                                  <Tag className="text-orange-500" size={20} /> Descuento Mayorista (F6)
                              </h3>
                              <p className="text-xs text-sys-500 mt-1 max-w-sm">
                                  Aplica un descuento rápido al último producto escaneado pulsando F6 en la caja.
                              </p>
                          </div>
                          
                          <Switch 
                              checked={posConfig.isWholesaleEnabled} 
                              onCheckedChange={(checked) => setPosConfig({...posConfig, isWholesaleEnabled: checked})} 
                          />
                      </div>

                      <div className={cn("transition-all duration-300", posConfig.isWholesaleEnabled ? "opacity-100" : "opacity-40 pointer-events-none")}>
                          <label className="text-[11px] font-bold text-sys-600 uppercase tracking-wider mb-2 block">
                              Porcentaje a descontar
                          </label>
                          <div className="relative max-w-xs">
                              <Percent size={18} className="absolute left-4 top-3 text-orange-400" />
                              <input 
                                  type="number"
                                  className="w-full bg-white border-2 border-orange-200 rounded-xl pl-11 pr-4 py-3 text-lg font-black text-orange-700 outline-none focus:border-orange-500 transition-all shadow-inner"
                                  placeholder="Ej: 10"
                                  value={posConfig.wholesalePercentage}
                                  onChange={(e) => setPosConfig({...posConfig, wholesalePercentage: parseFloat(e.target.value) || 0})}
                              />
                          </div>
                      </div>
                  </Card>

                  {/* BLOQUE: FACTURACIÓN ELECTRÓNICA SIEMPRE ACTIVA */}
                  <Card className="p-6 border-indigo-100 shadow-lg shadow-indigo-500/5 relative overflow-hidden">
                      <div className="absolute -right-4 -top-4 w-24 h-24 bg-indigo-50 rounded-full opacity-50 pointer-events-none"></div>

                      <div className="flex items-start justify-between relative z-10">
                          <div>
                              <h3 className="font-bold text-lg text-sys-900 flex items-center gap-2">
                                  <ShieldCheck className="text-indigo-500" size={20} /> Facturación Electrónica Siempre Activa
                              </h3>
                              <p className="text-xs text-sys-500 mt-1 max-w-sm">
                                  Al cobrar, la Facturación Electrónica arranca activada por defecto en cada venta (se puede desactivar puntualmente desde el cobro). Si está apagada, es al revés: hay que activarla venta por venta.
                              </p>
                          </div>

                          <Switch
                              checked={posConfig.afipAlwaysOn}
                              onCheckedChange={(checked) => setPosConfig({...posConfig, afipAlwaysOn: checked})}
                          />
                      </div>
                  </Card>

                  {/* BLOQUE: RECARGOS POR METODO DE PAGO */}
                  <Card className="p-6 border-blue-100 shadow-lg shadow-blue-500/5 relative overflow-hidden">
                      <div className="absolute -right-4 -top-4 w-24 h-24 bg-blue-50 rounded-full opacity-50 pointer-events-none"></div>

                      <div className="relative z-10 mb-6">
                          <h3 className="font-bold text-lg text-sys-900 flex items-center gap-2">
                              <ArrowUpRight className="text-blue-500" size={20} /> Recargos de Pago
                          </h3>
                          <p className="text-xs text-sys-500 mt-1 max-w-md">
                              Define un interés global para métodos de pago de una sola cuota (Ej: Transferencia, MercadoPago).
                          </p>
                      </div>

                      <div className="space-y-3 relative z-10">
                          {[
                              { id: 'cash', label: 'Efectivo', color: 'green' },
                              { id: 'transfer', label: 'Transferencia', color: 'blue' },
                              { id: 'mp', label: 'MercadoPago / QR', color: 'sky' },
                              { id: 'card', label: 'Débito / Tarjeta (1 Pago)', color: 'indigo' },
                              { id: 'current_account', label: 'Cuenta Corriente', color: 'orange' }
                          ].map(method => (
                              <div key={method.id} className="flex items-center justify-between p-3 rounded-xl border border-sys-100 bg-sys-50 hover:bg-sys-100 transition-colors">
                                  <span className="text-sm font-bold text-sys-700">{method.label}</span>
                                  <div className="relative w-24">
                                      <input
                                          type="number"
                                          className={cn(
                                              "w-full bg-white border border-sys-200 rounded-lg pl-3 pr-8 py-2 text-sm font-black outline-none text-right shadow-sm",
                                              posConfig.paymentSurcharges[method.id] > 0 ? `text-${method.color}-600 border-${method.color}-300 focus:border-${method.color}-500` : "text-sys-900 focus:border-brand"
                                          )}
                                          placeholder="0"
                                          value={posConfig.paymentSurcharges[method.id] || ''}
                                          onChange={(e) => handleSurchargeChange(method.id, e.target.value)}
                                      />
                                      <span className="absolute right-3 top-2.5 text-sys-400 text-xs font-bold">%</span>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </Card>

                  {/* BLOQUE: DESCUENTOS POR METODO DE PAGO */}
                  <Card className="p-6 border-green-100 shadow-lg shadow-green-500/5 relative overflow-hidden">
                      <div className="absolute -right-4 -top-4 w-24 h-24 bg-green-50 rounded-full opacity-50 pointer-events-none"></div>

                      <div className="relative z-10 mb-6">
                          <h3 className="font-bold text-lg text-sys-900 flex items-center gap-2">
                              <Tag className="text-green-500" size={20} /> Descuentos de Pago
                          </h3>
                          <p className="text-xs text-sys-500 mt-1 max-w-md">
                              Aplica un descuento automático según el medio de pago elegido (Ej: 5% off en efectivo).
                          </p>
                      </div>

                      <div className="space-y-3 relative z-10">
                          {[
                              { id: 'cash', label: 'Efectivo', color: 'green' },
                              { id: 'transfer', label: 'Transferencia', color: 'blue' },
                              { id: 'mp', label: 'MercadoPago / QR', color: 'sky' },
                              { id: 'card', label: 'Débito / Tarjeta (1 Pago)', color: 'indigo' },
                              { id: 'current_account', label: 'Cuenta Corriente', color: 'orange' }
                          ].map(method => (
                              <div key={method.id} className="flex items-center justify-between p-3 rounded-xl border border-sys-100 bg-sys-50 hover:bg-sys-100 transition-colors">
                                  <span className="text-sm font-bold text-sys-700">{method.label}</span>
                                  <div className="relative w-24">
                                      <input
                                          type="number"
                                          className={cn(
                                              "w-full bg-white border border-sys-200 rounded-lg pl-3 pr-8 py-2 text-sm font-black outline-none text-right shadow-sm",
                                              posConfig.paymentDiscounts[method.id] > 0 ? `text-${method.color}-600 border-${method.color}-300 focus:border-${method.color}-500` : "text-sys-900 focus:border-brand"
                                          )}
                                          placeholder="0"
                                          value={posConfig.paymentDiscounts[method.id] || ''}
                                          onChange={(e) => handleDiscountChange(method.id, e.target.value)}
                                      />
                                      <span className="absolute right-3 top-2.5 text-sys-400 text-xs font-bold">%</span>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </Card>

                  {/* BLOQUE: BALANZA */}
                  <Card className="p-6 border-purple-100 shadow-lg shadow-purple-500/5 relative overflow-hidden">
                      <div className="absolute -right-4 -top-4 w-24 h-24 bg-purple-50 rounded-full opacity-50 pointer-events-none"></div>

                      <div className="flex items-start justify-between gap-4 relative z-10">
                          <div>
                              <h3 className="font-bold text-lg text-sys-900 flex items-center gap-2">
                                  <Scale className="text-purple-500" size={20} /> Balanza
                              </h3>
                              <p className="text-xs text-sys-500 mt-1 max-w-sm">
                                  <strong>Activar EAN13 Gramos:</strong> usa el formato de código de barras estándar (peso en gramos embebido + dígito verificador) en vez del formato KRETZ/SYSTEL por defecto. Aplica únicamente a la sucursal <strong className="text-sys-700">{getBranchName(activeBranchId)}</strong>.
                              </p>
                          </div>
                          <Switch
                              checked={posConfig.scaleBarcodeFormats?.[activeBranchId] === 'EAN13_GRAMS'}
                              onCheckedChange={handleToggleScaleFormat}
                              disabled={!activeBranchId || activeBranchId === 'ALL'}
                          />
                      </div>

                      {(!activeBranchId || activeBranchId === 'ALL') && (
                          <p className="text-[11px] text-orange-500 font-bold mt-3 relative z-10 flex items-center gap-1">
                              <AlertTriangle size={12}/> Elegí una sucursal específica (arriba a la izquierda) para poder activar esta opción.
                          </p>
                      )}
                  </Card>

                  {/* BLOQUE: BALANZAS SOPORTE TOTAL (KRETZ) */}
                  <Card className="p-6 border-purple-100 shadow-lg shadow-purple-500/5 relative overflow-hidden">
                      <div className="absolute -right-4 -top-4 w-24 h-24 bg-purple-50 rounded-full opacity-50 pointer-events-none"></div>

                      <div className="relative z-10">
                          <h3 className="font-bold text-lg text-sys-900 flex items-center gap-2">
                              <Scale className="text-purple-500" size={20} /> Balanzas Soporte Total
                          </h3>
                          <p className="text-xs text-sys-500 mt-1 max-w-md">
                              Para balanzas Kretz que emiten el ticket con el <strong>total ya calculado</strong> (en vez de PLU + peso). Configurá el prefijo de 6 dígitos que identifica a esa balanza y el nombre de categoría con el que se va a mostrar en la venta (ej. "Verdulería"). Aplica únicamente a la sucursal <strong className="text-sys-700">{getBranchName(activeBranchId)}</strong>.
                          </p>

                          {(posConfig.scaleTotalProfiles?.[activeBranchId] || []).length > 0 && (
                              <div className="mt-4 space-y-2">
                                  {(posConfig.scaleTotalProfiles?.[activeBranchId] || []).map(profile => (
                                      <div key={profile.id} className="flex items-center justify-between bg-sys-50 border border-sys-200 rounded-xl px-4 py-2.5">
                                          <div className="flex items-center gap-3">
                                              <span className="font-mono text-xs font-bold text-purple-600 bg-purple-50 px-2 py-1 rounded">{profile.prefix}</span>
                                              <span className="text-sm font-bold text-sys-800">{profile.categoryName}</span>
                                          </div>
                                          <button
                                              type="button"
                                              onClick={() => handleDeleteTotalProfile(profile.id)}
                                              className="text-sys-400 hover:text-red-500 p-1"
                                          >
                                              <Trash2 size={16} />
                                          </button>
                                      </div>
                                  ))}
                              </div>
                          )}

                          <div className="flex flex-col sm:flex-row gap-2 mt-4">
                              <input
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={6}
                                  placeholder="Prefijo (6 dígitos, ej: 209999)"
                                  className="flex-1 text-sm p-2.5 bg-sys-50 border-2 border-sys-200 rounded-xl focus:border-brand outline-none font-mono"
                                  value={newTotalProfile.prefix}
                                  onChange={(e) => setNewTotalProfile(prev => ({ ...prev, prefix: e.target.value.replace(/\D/g, '') }))}
                                  disabled={!activeBranchId || activeBranchId === 'ALL'}
                              />
                              <input
                                  type="text"
                                  placeholder="Categoría (ej: Verdulería)"
                                  className="flex-1 text-sm p-2.5 bg-sys-50 border-2 border-sys-200 rounded-xl focus:border-brand outline-none"
                                  value={newTotalProfile.categoryName}
                                  onChange={(e) => setNewTotalProfile(prev => ({ ...prev, categoryName: e.target.value }))}
                                  disabled={!activeBranchId || activeBranchId === 'ALL'}
                              />
                              <Button
                                  type="button"
                                  onClick={handleAddTotalProfile}
                                  disabled={!activeBranchId || activeBranchId === 'ALL'}
                                  className="shrink-0"
                              >
                                  <PlusCircle size={16} className="mr-1.5" /> Agregar
                              </Button>
                          </div>
                      </div>

                      {(!activeBranchId || activeBranchId === 'ALL') && (
                          <p className="text-[11px] text-orange-500 font-bold mt-3 relative z-10 flex items-center gap-1">
                              <AlertTriangle size={12}/> Elegí una sucursal específica (arriba a la izquierda) para poder configurar esta opción.
                          </p>
                      )}
                  </Card>

                  <div className="flex justify-end pt-2">
                      <Button
                          onClick={savePosConfig}
                          disabled={savingPosConfig}
                          className="w-full sm:w-auto px-8 bg-brand hover:bg-brand-dark text-white shadow-xl shadow-brand/20 h-12 text-base font-bold"
                      >
                          {savingPosConfig ? <Loader2 className="animate-spin mr-2" size={18}/> : <Save className="mr-2" size={18}/>}
                          Guardar Reglas de Caja
                      </Button>
                  </div>
              </div>
              
              <div className="space-y-4">
                   <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6 sticky top-6">
                      <h4 className="font-bold text-blue-800 flex items-center gap-2 mb-2">
                          <Info size={18} /> Información Importante
                      </h4>
                      <p className="text-sm text-blue-700 leading-relaxed mb-4">
                          Estos parámetros se aplican instantáneamente en todas las cajas de la empresa al momento de cobrar.
                      </p>
                      <ul className="text-xs text-blue-600 space-y-3">
                          <li className="flex items-start gap-2">
                              <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> 
                              <strong>Descuento Mayorista:</strong> Es ideal para negocios híbridos donde el cajero decide a qué artículos aplicarle el precio por cantidad.
                          </li>
                          <li className="flex items-start gap-2">
                              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                              <span><strong>Recargos:</strong> Si configuras 10% en Transferencia, un ticket de $1.000 pasará a $1.100 automáticamente. El ticket aclarará <em>"RECARGO"</em>.</span>
                          </li>
                          <li className="flex items-start gap-2">
                              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                              <span><strong>Descuentos:</strong> Si configuras 5% en Efectivo, un ticket de $1.000 pasará a $950 automáticamente. El ticket aclarará <em>"DESCUENTO"</em>.</span>
                          </li>
                          <li className="flex items-start gap-2">
                              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                              <strong>Regla general:</strong> No configurar recargo Y descuento para el mismo medio de pago.
                          </li>
                      </ul>
                  </div>
              </div>
          </div>
      )}

      {/* MODAL DE LIQUIDACIÓN DE EMPLEADO */}
      <LiquidationModal
          isOpen={!!selectedEmployeeForLedger}
          employee={selectedEmployeeForLedger}
          onClose={() => setSelectedEmployeeForLedger(null)}
          onLiquidated={loadData}
      />

      {/* MODAL DE EDICIÓN DE EMPLEADO */}
      <EditUserModal
          isOpen={!!editingUser}
          employee={editingUser}
          branches={branches}
          onClose={() => setEditingUser(null)}
          onSaved={(updated) => {
              const targetId = updated.uid || updated.id;
              setUsers(prev => prev.map(u => (u.id || u.uid) === targetId ? { ...u, ...updated } : u));
          }}
      />
    </div>
  );
};