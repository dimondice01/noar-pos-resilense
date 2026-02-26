import React, { useState, useEffect } from 'react';
import { X, ArrowDownCircle, ArrowUpCircle, Banknote, User, FileText, Loader2, Save } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { useShiftStore } from '../../cash/store/useShiftStore';
import { cashRepository } from '../../cash/repositories/cashRepository';
import { employeeLedgerRepository } from '../../settings/repositories/employeeLedgerRepository'; // Ajusta la ruta si es necesario
import toast from 'react-hot-toast';

export const CashOperationsModal = ({ isOpen, onClose }) => {
    const { user, activeBranchId } = useAuthStore();
    const { activeShift } = useShiftStore();

    const [type, setType] = useState('OUT'); // 'IN' (Ingreso) | 'OUT' (Egreso)
    const [amount, setAmount] = useState('');
    const [concept, setConcept] = useState('Gastos Generales');
    const [customConcept, setCustomConcept] = useState('');
    const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
    
    const [employees, setEmployees] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);

    // Cargar empleados de la sucursal activa cuando el modal se abre
    useEffect(() => {
        if (isOpen && user?.companyId && activeBranchId) {
            const fetchEmployees = async () => {
                try {
                    const q = query(
                        collection(db, 'users'),
                        where('companyId', '==', user.companyId)
                    );
                    const snap = await getDocs(q);
                    // 🔥 AISLAMIENTO POR SUCURSAL: Solo empleados de esta caja
                    const branchEmployees = snap.docs
                        .map(doc => ({ uid: doc.id, ...doc.data() }))
                        .filter(u => String(u.branchId) === String(activeBranchId));
                    
                    setEmployees(branchEmployees);
                } catch (error) {
                    console.error("Error cargando empleados:", error);
                }
            };
            fetchEmployees();
        }
    }, [isOpen, user?.companyId, activeBranchId]);

    // Resetear form al abrir
    useEffect(() => {
        if (isOpen) {
            setType('OUT');
            setAmount('');
            setConcept('Gastos Generales');
            setCustomConcept('');
            setSelectedEmployeeId('');
        }
    }, [isOpen]);

    const isAdvance = concept === 'Adelanto a Personal';

    const handleSubmit = async (e) => {
        e.preventDefault();
        const value = parseFloat(amount);
        if (isNaN(value) || value <= 0) return toast.error("Ingrese un monto válido.");
        if (!activeShift?.id) return toast.error("No hay un turno de caja activo.");
        if (isAdvance && !selectedEmployeeId) return toast.error("Debe seleccionar un empleado.");

        const finalDescription = customConcept.trim() ? customConcept.trim() : concept;

        setIsProcessing(true);
        const toastId = toast.loading("Registrando movimiento...");

        try {
            // 1. Crear el movimiento en la caja (Impacta el arqueo físico)
            await cashRepository.addMovement(
                activeShift.id,
                type,
                value,
                finalDescription,
                'cash', // Siempre impacta el efectivo físico
                user.uid,
                user.name,
                activeBranchId
            );

            // 2. Si es Adelanto, lo registramos en el Libro Mayor (Ledger) del Empleado
            if (type === 'OUT' && isAdvance) {
                await employeeLedgerRepository.addTransaction({
                    companyId: user.companyId,
                    branchId: activeBranchId,
                    userId: selectedEmployeeId,
                    type: 'ADVANCE',
                    amount: value,
                    description: `Adelanto de Efectivo (Caja: ${activeShift.id.slice(-4)})`,
                    operatorName: user.name
                });
            }

            toast.success(type === 'IN' ? 'Ingreso registrado' : 'Egreso de caja registrado', { id: toastId });
            onClose();
        } catch (error) {
            console.error("Error en operación de caja:", error);
            toast.error(error.message || "Error al procesar la operación", { id: toastId });
        } finally {
            setIsProcessing(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
                
                <div className="p-6 border-b border-sys-100 flex justify-between items-center bg-sys-50/50">
                    <div>
                        <h3 className="font-black text-xl text-sys-900 uppercase tracking-tight flex items-center gap-2">
                            <Banknote className="text-brand" /> Operaciones de Caja
                        </h3>
                        <p className="text-xs text-sys-500 font-medium mt-1">Registra movimientos manuales de efectivo.</p>
                    </div>
                    <button onClick={onClose} disabled={isProcessing} className="p-2 hover:bg-sys-200 rounded-full transition-colors disabled:opacity-50">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    
                    {/* TIPO DE MOVIMIENTO */}
                    <div className="flex bg-sys-100 p-1 rounded-xl">
                        <button 
                            type="button" 
                            onClick={() => { setType('OUT'); setConcept('Gastos Generales'); }}
                            className={cn("flex-1 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all", type === 'OUT' ? "bg-white shadow-sm text-red-600" : "text-sys-500 hover:bg-sys-200")}
                        >
                            <ArrowUpCircle size={18} /> RETIRO (EGRESO)
                        </button>
                        <button 
                            type="button" 
                            onClick={() => { setType('IN'); setConcept('Cambio / Sencillo'); }}
                            className={cn("flex-1 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all", type === 'IN' ? "bg-white shadow-sm text-emerald-600" : "text-sys-500 hover:bg-sys-200")}
                        >
                            <ArrowDownCircle size={18} /> INGRESO
                        </button>
                    </div>

                    {/* MONTO */}
                    <div>
                        <label className="text-[11px] font-black text-sys-500 uppercase tracking-wider mb-2 block">Monto en Efectivo</label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-black text-sys-400">$</span>
                            <input 
                                type="number" 
                                className={cn("w-full pl-10 pr-4 py-3 text-2xl font-black rounded-xl border-2 outline-none transition-colors", type === 'OUT' ? "bg-red-50 border-red-200 text-red-700 focus:border-red-500" : "bg-emerald-50 border-emerald-200 text-emerald-700 focus:border-emerald-500")}
                                placeholder="0.00"
                                value={amount}
                                onChange={e => setAmount(e.target.value)}
                                autoFocus
                            />
                        </div>
                    </div>

                    {/* CONCEPTO */}
                    <div>
                        <label className="text-[11px] font-black text-sys-500 uppercase tracking-wider mb-2 block">Concepto / Motivo</label>
                        <select 
                            className="w-full bg-sys-50 border border-sys-200 rounded-xl px-4 py-3 text-sm font-bold text-sys-800 outline-none focus:border-brand appearance-none"
                            value={concept}
                            onChange={(e) => setConcept(e.target.value)}
                        >
                            {type === 'OUT' ? (
                                <>
                                    <option value="Gastos Generales">Gastos Generales (Insumos, Limpieza)</option>
                                    <option value="Pago a Proveedores">Pago a Proveedores</option>
                                    <option value="Adelanto a Personal">Adelanto a Personal (Vale)</option>
                                    <option value="Retiro del Dueño">Retiro del Dueño</option>
                                    <option value="Otro">Otro Motivo...</option>
                                </>
                            ) : (
                                <>
                                    <option value="Cambio / Sencillo">Ingreso de Cambio / Sencillo</option>
                                    <option value="Aporte de Capital">Aporte de Capital</option>
                                    <option value="Otro">Otro Motivo...</option>
                                </>
                            )}
                        </select>
                    </div>

                    {/* BLOQUE DINÁMICO: EMPLEADO (SI ES ADELANTO) */}
                    {type === 'OUT' && isAdvance && (
                        <div className="animate-in slide-in-from-top-2">
                            <label className="text-[11px] font-black text-sys-500 uppercase tracking-wider mb-2 block text-orange-600">Seleccionar Empleado</label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-400" size={18} />
                                <select 
                                    className="w-full bg-orange-50 border border-orange-200 rounded-xl pl-10 pr-4 py-3 text-sm font-bold text-orange-800 outline-none focus:border-orange-500 appearance-none"
                                    value={selectedEmployeeId}
                                    onChange={(e) => setSelectedEmployeeId(e.target.value)}
                                >
                                    <option value="">-- Seleccione a quién recibe --</option>
                                    {employees.map(emp => (
                                        <option key={emp.uid} value={emp.uid}>{emp.name || emp.email}</option>
                                    ))}
                                </select>
                            </div>
                            <p className="text-[10px] font-bold text-orange-600 mt-2 flex items-center gap-1">
                                <FileText size={12}/> Este retiro generará deuda en el saldo del empleado.
                            </p>
                        </div>
                    )}

                    {/* BLOQUE DINÁMICO: OTRO CONCEPTO */}
                    {concept === 'Otro' && (
                        <div className="animate-in slide-in-from-top-2">
                            <label className="text-[11px] font-black text-sys-500 uppercase tracking-wider mb-2 block">Describa el motivo</label>
                            <input 
                                type="text" 
                                className="w-full bg-white border border-sys-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand"
                                placeholder="Ej: Pago de internet, Arreglo de luz..."
                                value={customConcept}
                                onChange={e => setCustomConcept(e.target.value)}
                            />
                        </div>
                    )}

                    <div className="pt-2">
                        <Button 
                            type="submit" 
                            disabled={isProcessing} 
                            className={cn("w-full py-4 text-base font-black uppercase shadow-lg", type === 'OUT' ? "bg-red-600 hover:bg-red-700 shadow-red-200" : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200")}
                        >
                            {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                            {type === 'OUT' ? "REGISTRAR SALIDA" : "REGISTRAR INGRESO"}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};