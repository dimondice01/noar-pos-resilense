import React, { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle, X, CheckCircle2 } from 'lucide-react';
import { clientRepository } from '../repositories/clientRepository';
import { Button } from '../../../core/ui/Button';
import toast from 'react-hot-toast';

const formatMoney = (val) => `$ ${Number(val || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// =================================================================
// 🩹 RECALCULAR SALDOS — Autoservicio por empresa
// =================================================================
// Muestra la diferencia entre el balance guardado y el recalculado desde
// el ledger completo ANTES de escribir nada. Nada se corrige hasta que
// el administrador ve la lista completa y confirma explícitamente.
export const RecalculateBalancesModal = ({ isOpen, onClose, onApplied }) => {
    const [step, setStep] = useState('loading'); // loading | preview | empty | applying | done
    const [diffs, setDiffs] = useState([]);
    const [error, setError] = useState(null);
    const [appliedCount, setAppliedCount] = useState(0);

    useEffect(() => {
        if (!isOpen) return;
        setStep('loading');
        setError(null);
        clientRepository.previewBalanceRecalculation()
            .then(result => {
                setDiffs(result);
                setStep(result.length === 0 ? 'empty' : 'preview');
            })
            .catch(err => {
                console.error(err);
                setError(err.message);
                setStep('preview');
            });
    }, [isOpen]);

    const handleConfirm = async () => {
        setStep('applying');
        try {
            const { applied } = await clientRepository.applyBalanceRecalculation(diffs);
            setAppliedCount(applied);
            setStep('done');
            toast.success(`✅ ${applied} cliente(s) corregido(s) correctamente.`);
            if (onApplied) onApplied();
        } catch (err) {
            console.error(err);
            toast.error('Error al aplicar la corrección: ' + err.message);
            setStep('preview');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-sys-900/70 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
                <div className="p-5 border-b border-sys-100 bg-sys-50 flex justify-between items-center shrink-0">
                    <div>
                        <h3 className="font-bold text-xl text-sys-900 flex items-center gap-2">
                            <ShieldCheck size={22} className="text-brand" /> Actualizar Saldos
                        </h3>
                        <p className="text-xs text-sys-500 mt-1">Recalcula el saldo de cada cliente desde su historial completo de cuenta corriente.</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-400 transition-colors"><X /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {step === 'loading' && (
                        <div className="flex flex-col items-center justify-center gap-3 py-12 text-sys-500">
                            <RefreshCw size={32} className="animate-spin text-brand" />
                            <p className="font-bold uppercase text-xs tracking-widest">Revisando historial de cuentas corrientes...</p>
                        </div>
                    )}

                    {step === 'empty' && (
                        <div className="flex flex-col items-center justify-center gap-3 py-12 text-emerald-600">
                            <CheckCircle2 size={40} />
                            <p className="font-bold">Todo en orden — no hay nada para corregir.</p>
                        </div>
                    )}

                    {step === 'applying' && (
                        <div className="flex flex-col items-center justify-center gap-3 py-12 text-sys-500">
                            <RefreshCw size={32} className="animate-spin text-brand" />
                            <p className="font-bold uppercase text-xs tracking-widest">Aplicando correcciones...</p>
                        </div>
                    )}

                    {step === 'done' && (
                        <div className="flex flex-col items-center justify-center gap-3 py-12 text-emerald-600">
                            <CheckCircle2 size={40} />
                            <p className="font-bold">{appliedCount} cliente(s) corregido(s) correctamente.</p>
                        </div>
                    )}

                    {(step === 'preview') && (
                        <>
                            {error && (
                                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-4 flex gap-2 items-start">
                                    <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}
                                </div>
                            )}
                            {diffs.length > 0 && (
                                <>
                                    <div className="bg-orange-50 border border-orange-100 text-orange-800 text-xs rounded-xl p-3 mb-4 flex gap-2 items-start">
                                        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                                        <p>Se encontraron {diffs.length} cliente(s) con diferencia entre el saldo guardado y el calculado desde su historial real. No se modifica ningún movimiento histórico — solo el saldo total del cliente.</p>
                                    </div>
                                    <div className="border border-sys-200 rounded-xl overflow-hidden">
                                        <table className="w-full text-sm text-left">
                                            <thead className="bg-sys-50 text-[10px] uppercase font-black text-sys-400 border-b border-sys-100">
                                                <tr>
                                                    <th className="p-3">Cliente</th>
                                                    <th className="p-3 text-right">Saldo Actual</th>
                                                    <th className="p-3 text-right">Saldo Correcto</th>
                                                    <th className="p-3 text-right">Diferencia</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-sys-100">
                                                {diffs.map(d => (
                                                    <tr key={d.clientId}>
                                                        <td className="p-3 font-bold text-sys-800">{d.name}</td>
                                                        <td className="p-3 text-right font-mono text-sys-500">{formatMoney(d.oldBalance)}</td>
                                                        <td className="p-3 text-right font-mono font-black text-sys-900">{formatMoney(d.newBalance)}</td>
                                                        <td className={`p-3 text-right font-mono font-black ${d.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                            {d.delta > 0 ? '+' : ''}{formatMoney(d.delta)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>

                <div className="p-5 border-t border-sys-100 bg-sys-50 flex justify-end gap-3 shrink-0">
                    {step === 'done' ? (
                        <Button onClick={onClose} variant="secondary">Cerrar</Button>
                    ) : (
                        <>
                            <Button onClick={onClose} variant="secondary" disabled={step === 'applying'}>Cancelar</Button>
                            {step === 'preview' && diffs.length > 0 && (
                                <Button onClick={handleConfirm} className="bg-red-600 hover:bg-red-700 text-white font-black">
                                    Confirmar y Corregir {diffs.length} Cliente(s)
                                </Button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
