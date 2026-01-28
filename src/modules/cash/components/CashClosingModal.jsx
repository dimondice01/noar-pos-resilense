import React, { useState } from 'react';
import { X, Lock, DollarSign, Calculator, AlertTriangle, ArrowRight, Wallet } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

// Helper de Moneda
const formatMoney = (val) => `$ ${Number(val).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

export const CashClosingModal = ({ isOpen, onClose, onConfirm, systemTotals }) => {
    // ESTADOS
    const [step, setStep] = useState(1); // 1: Conteo, 2: Distribución, 3: Confirmación
    
    // Paso 1: Cuánto hay en total en el cajón
    const [declaredCash, setDeclaredCash] = useState(''); 
    
    // Paso 2: Cuánto dejo para cambio
    const [leftInCash, setLeftInCash] = useState(''); 

    if (!isOpen) return null;

    // CÁLCULOS EN TIEMPO REAL
    const totalDeclared = parseFloat(declaredCash) || 0;
    const totalLeft = parseFloat(leftInCash) || 0;
    
    // Retiro = Total que tengo - Lo que dejo
    const totalWithdrawal = Math.max(0, totalDeclared - totalLeft);
    
    // Diferencia con sistema (Auditoría previa visual opcional, o ciega)
    // En cierre ciego NO mostramos esto al cajero, pero lo calculamos internamente si quisiéramos validar.

    const handleSubmit = () => {
        onConfirm({
            declaredCash: totalDeclared,
            leftInCash: totalLeft, // 🔥 NUEVO CAMPO CRÍTICO
            expectedCash: systemTotals.totalCash, 
            expectedDigital: systemTotals.totalDigital
        });
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-sys-900/80 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
                
                {/* Header */}
                <div className="bg-sys-50 p-6 border-b border-sys-100 flex justify-between items-center shrink-0">
                   <div>
                      <h3 className="text-xl font-bold text-sys-900 flex items-center gap-2">
                         <Lock className="text-brand" size={24} /> Cierre de Turno (Z)
                      </h3>
                      <p className="text-xs text-sys-500 mt-1 font-medium">
                          {step === 1 ? 'Paso 1: Arqueo Físico' : step === 2 ? 'Paso 2: Distribución' : 'Confirmación'}
                      </p>
                   </div>
                   <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-400 transition-colors"><X/></button>
                </div>

                <div className="p-8 overflow-y-auto">
                   
                   {/* ================================================= */}
                   {/* PASO 1: CONTEO TOTAL DE EFECTIVO                  */}
                   {/* ================================================= */}
                   {step === 1 && (
                     <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-blue-800 text-sm flex gap-3">
                           <Calculator className="shrink-0 mt-0.5" size={20}/>
                           <div>
                               <p className="font-bold">Modo Auditoría Ciega</p>
                               <p className="opacity-90 text-xs mt-1">Cuente TODO el dinero físico que hay en la caja (billetes + monedas) e ingrese el total.</p>
                           </div>
                        </div>

                        <div>
                           <label className="block text-xs font-bold text-sys-500 uppercase tracking-wider mb-2">Total Efectivo en Caja</label>
                           <div className="relative">
                              <DollarSign className="absolute left-4 top-4 text-sys-400" />
                              <input 
                                type="number" 
                                autoFocus
                                className="w-full pl-10 pr-4 py-4 text-3xl font-black text-sys-900 border-2 border-sys-200 rounded-xl focus:border-brand outline-none transition-all placeholder:text-sys-200"
                                placeholder="0.00"
                                value={declaredCash}
                                onChange={e => setDeclaredCash(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && declaredCash && setStep(2)}
                              />
                           </div>
                        </div>

                        <div className="pt-4">
                           <Button onClick={() => setStep(2)} className="w-full py-4 text-lg shadow-xl" disabled={!declaredCash}>
                              Siguiente <ArrowRight className="ml-2" size={20}/>
                           </Button>
                        </div>
                     </div>
                   )}

                   {/* ================================================= */}
                   {/* PASO 2: DISTRIBUCIÓN (FONDO PRÓXIMO TURNO)        */}
                   {/* ================================================= */}
                   {step === 2 && (
                     <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                        <div className="text-center pb-4 border-b border-sys-100">
                            <p className="text-xs text-sys-500 uppercase font-bold">Total Arqueado</p>
                            <p className="text-3xl font-black text-sys-900">{formatMoney(totalDeclared)}</p>
                        </div>

                        <div>
                           <label className="block text-xs font-bold text-sys-500 uppercase tracking-wider mb-2 flex justify-between">
                               <span>¿Cuánto deja en caja?</span>
                               <span className="text-brand text-[10px] bg-brand/10 px-2 py-0.5 rounded-full">Cambio Mañana</span>
                           </label>
                           <div className="relative">
                              <Wallet className="absolute left-4 top-4 text-sys-400" />
                              <input 
                                type="number" 
                                autoFocus
                                className="w-full pl-10 pr-4 py-4 text-2xl font-bold border-2 border-sys-200 rounded-xl focus:border-brand outline-none transition-all"
                                placeholder="0.00"
                                value={leftInCash}
                                onChange={e => setLeftInCash(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && setStep(3)}
                              />
                           </div>
                           <p className="text-xs text-sys-400 mt-2 text-right">
                               Se retirarán: <span className="font-bold text-sys-800">{formatMoney(totalWithdrawal)}</span>
                           </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3 pt-2">
                           <Button variant="ghost" onClick={() => setStep(1)}>Atrás</Button>
                           <Button onClick={() => setStep(3)} className="shadow-lg" disabled={totalLeft > totalDeclared}>
                              Revisar Cierre
                           </Button>
                        </div>
                     </div>
                   )}

                   {/* ================================================= */}
                   {/* PASO 3: CONFIRMACIÓN FINAL                        */}
                   {/* ================================================= */}
                   {step === 3 && (
                     <div className="text-center space-y-6 animate-in zoom-in-95 duration-300">
                        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto text-red-600 mb-2 border-4 border-red-100">
                           <Lock size={36} />
                        </div>
                        
                        <div>
                           <h4 className="text-2xl font-black text-sys-900 leading-none mb-4">¿Cerrar Turno?</h4>
                           
                           <div className="bg-sys-50 rounded-xl p-4 text-sm space-y-2 border border-sys-200">
                               <div className="flex justify-between">
                                   <span className="text-sys-500">Total en Caja:</span>
                                   <span className="font-bold">{formatMoney(totalDeclared)}</span>
                               </div>
                               <div className="flex justify-between text-brand">
                                   <span>Se deja (Cambio):</span>
                                   <span className="font-bold">-{formatMoney(totalLeft)}</span>
                               </div>
                               <div className="border-t border-sys-200 pt-2 flex justify-between text-lg font-black text-sys-800">
                                   <span>A RETIRAR:</span>
                                   <span>{formatMoney(totalWithdrawal)}</span>
                               </div>
                           </div>

                           <p className="text-xs text-red-500 mt-4 font-medium flex items-center justify-center gap-1">
                               <AlertTriangle size={14}/> Esta acción es irreversible.
                           </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                           <Button variant="ghost" onClick={() => setStep(2)} className="h-12">Corregir</Button>
                           <Button variant="danger" onClick={handleSubmit} className="h-12 shadow-xl shadow-red-500/20">
                               CONFIRMAR CIERRE Z
                           </Button>
                        </div>
                     </div>
                   )}

                </div>
            </div>
        </div>
    );
};