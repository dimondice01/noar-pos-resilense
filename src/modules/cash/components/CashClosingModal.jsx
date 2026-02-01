import React, { useState, useEffect } from 'react';
import { X, Lock, DollarSign, Calculator, AlertTriangle, ArrowRight, Wallet, CheckCircle } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

// Helper de Moneda
const formatMoney = (val) => `$ ${Number(val).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

export const CashClosingModal = ({ isOpen, onClose, onConfirm, systemTotals }) => {
    // ESTADOS
    const [step, setStep] = useState(1); // 1: Conteo, 2: Distribución, 3: Confirmación
    
    // Paso 1: Cuánto hay en total en el cajón (Físico)
    const [declaredCash, setDeclaredCash] = useState(''); 
    
    // Paso 2: Cuánto dejo para cambio (Remanente)
    const [leftInCash, setLeftInCash] = useState(''); 

    // Reset al abrir
    useEffect(() => {
        if (isOpen) {
            setStep(1);
            setDeclaredCash('');
            setLeftInCash('');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    // CÁLCULOS EN TIEMPO REAL
    const valDeclared = declaredCash === '' ? 0 : parseFloat(declaredCash);
    const valLeft = leftInCash === '' ? 0 : parseFloat(leftInCash);
    
    // Retiro = Total que tengo - Lo que dejo
    // Validamos que no sea negativo (no puedes dejar más de lo que tienes)
    const totalWithdrawal = Math.max(0, valDeclared - valLeft);
    
    const handleSubmit = () => {
        // 🔥 ALINEACIÓN DE DATOS CON EL REPOSITORIO
        onConfirm({
            declaredCash: valDeclared,  // Lo que contaste
            leftInCash: valLeft,        // Lo que dejas
            // Pasamos los esperados para referencia rápida, aunque el repo recalcula para seguridad
            expectedCash: systemTotals?.totalCash || 0, 
            expectedDigital: systemTotals?.totalDigital || 0
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
                          {step === 1 ? 'Paso 1: Arqueo Físico' : step === 2 ? 'Paso 2: Distribución' : 'Confirmación Final'}
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
                                onKeyDown={e => e.key === 'Enter' && valDeclared >= 0 && setStep(2)}
                              />
                           </div>
                        </div>

                        <div className="pt-4">
                           <Button onClick={() => setStep(2)} className="w-full py-4 text-lg shadow-xl bg-sys-900 hover:bg-black text-white" disabled={declaredCash === ''}>
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
                            <p className="text-3xl font-black text-sys-900">{formatMoney(valDeclared)}</p>
                        </div>

                        <div>
                           <label className="block text-xs font-bold text-sys-500 uppercase tracking-wider mb-2 flex justify-between">
                               <span>¿Cuánto deja en caja?</span>
                               <span className="text-brand text-[10px] bg-brand/10 px-2 py-0.5 rounded-full font-bold">Fondo Mañana</span>
                           </label>
                           <div className="relative">
                              <Wallet className="absolute left-4 top-4 text-sys-400" />
                              <input 
                                type="number" 
                                autoFocus
                                className={cn(
                                    "w-full pl-10 pr-4 py-4 text-2xl font-bold border-2 rounded-xl outline-none transition-all placeholder:text-sys-200",
                                    valLeft > valDeclared ? "border-red-300 focus:border-red-500 text-red-600" : "border-sys-200 focus:border-brand"
                                )}
                                placeholder="0.00"
                                value={leftInCash}
                                onChange={e => setLeftInCash(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && valLeft <= valDeclared && setStep(3)}
                              />
                           </div>
                           {valLeft > valDeclared ? (
                               <p className="text-xs text-red-500 mt-2 font-bold flex items-center gap-1">
                                   <AlertTriangle size={12}/> No puedes dejar más de lo que tienes.
                               </p>
                           ) : (
                               <p className="text-xs text-sys-400 mt-2 text-right">
                                   Se retirarán: <span className="font-bold text-sys-800">{formatMoney(totalWithdrawal)}</span>
                               </p>
                           )}
                        </div>

                        <div className="grid grid-cols-2 gap-3 pt-2">
                           <Button variant="ghost" onClick={() => setStep(1)} className="h-12 font-bold text-sys-500">Atrás</Button>
                           <Button onClick={() => setStep(3)} className="shadow-lg h-12 bg-sys-900 hover:bg-black text-white" disabled={valLeft > valDeclared}>
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
                        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto text-red-600 mb-2 border-4 border-red-100 animate-pulse">
                           <Lock size={36} />
                        </div>
                        
                        <div>
                           <h4 className="text-2xl font-black text-sys-900 leading-none mb-4">¿Cerrar Turno?</h4>
                           
                           <div className="bg-sys-50 rounded-xl p-4 text-sm space-y-3 border border-sys-200 text-left">
                               <div className="flex justify-between items-center border-b border-sys-200 pb-2">
                                   <span className="text-sys-500 font-medium">Total en Caja</span>
                                   <span className="font-bold text-lg">{formatMoney(valDeclared)}</span>
                               </div>
                               <div className="flex justify-between items-center text-emerald-600">
                                   <span className="font-medium flex items-center gap-1"><Wallet size={14}/> Se deja en Caja</span>
                                   <span className="font-bold">-{formatMoney(valLeft)}</span>
                               </div>
                               <div className="bg-white p-3 rounded-lg border border-sys-200 flex justify-between items-center">
                                   <span className="text-sys-900 font-black uppercase text-xs tracking-wider">A RETIRAR (SOBRE)</span>
                                   <span className="text-xl font-black text-sys-900">{formatMoney(totalWithdrawal)}</span>
                               </div>
                           </div>

                           <p className="text-[10px] text-red-500 mt-4 font-bold flex items-center justify-center gap-1 uppercase tracking-wider bg-red-50 py-2 rounded-lg">
                               <AlertTriangle size={12}/> Esta acción cerrará el turno y es irreversible.
                           </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                           <Button variant="ghost" onClick={() => setStep(2)} className="h-12 font-bold text-sys-500">Corregir</Button>
                           <Button variant="danger" onClick={handleSubmit} className="h-12 shadow-xl shadow-red-500/20 bg-red-600 hover:bg-red-700 text-white font-black tracking-wider text-xs">
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