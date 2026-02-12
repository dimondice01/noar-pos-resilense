import React, { useState, useEffect } from 'react';
import { X, Lock, DollarSign, Calculator, AlertTriangle, ArrowRight, Wallet, Printer } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

// Helper de Moneda
const formatMoney = (val) => `$ ${Number(val).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

// Helper de Fecha
const formatDate = () => new Date().toLocaleString('es-AR');

export const CashClosingModal = ({ isOpen, onClose, onConfirm, systemTotals, userName, branchName, shiftId }) => {
    // ESTADOS
    const [step, setStep] = useState(1); // 1: Conteo, 2: Distribución, 3: Ticket Z (Declaración)
    
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
    const totalWithdrawal = Math.max(0, valDeclared - valLeft);
    
    // CÁLCULO DE DIFERENCIA (AUDITORÍA INTERNA - NO SE MUESTRA EN TICKET CAJERO)
    const expectedCash = systemTotals?.totalCash || 0; 
    const difference = valDeclared - expectedCash; 

    const handleSubmit = () => {
        onConfirm({
            declaredCash: valDeclared,  
            leftInCash: valLeft,        
            expectedCash: expectedCash, 
            expectedDigital: systemTotals?.totalDigital || 0,
            withdrawal: totalWithdrawal,
            difference: difference
        });
    };

    const handlePrint = () => {
        window.print(); 
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-sys-900/80 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95 print:p-0 print:bg-white print:static">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh] print:shadow-none print:max-w-none print:h-auto print:rounded-none">
                
                {/* Header (No imprimible) */}
                <div className="bg-sys-50 p-6 border-b border-sys-100 flex justify-between items-center shrink-0 print:hidden">
                   <div>
                      <h3 className="text-xl font-bold text-sys-900 flex items-center gap-2">
                         <Lock className="text-brand" size={24} /> Cierre de Turno
                      </h3>
                      <p className="text-xs text-sys-500 mt-1 font-medium">
                          {step === 1 ? 'Paso 1: Arqueo Físico' : step === 2 ? 'Paso 2: Distribución' : 'Comprobante de Cierre'}
                      </p>
                   </div>
                   <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-400 transition-colors"><X/></button>
                </div>

                <div className="p-8 overflow-y-auto print:p-0 print:overflow-visible">
                    
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
                              Generar Comprobante
                           </Button>
                        </div>
                      </div>
                    )}

                    {/* ================================================= */}
                    {/* PASO 3: COMPROBANTE DE DECLARACIÓN (LIMPIO)       */}
                    {/* ================================================= */}
                    {step === 3 && (
                      <div className="flex flex-col h-full animate-in zoom-in-95 duration-300">
                        
                        {/* 🎫 TICKET CAJERO (DECLARACIÓN JURADA) */}
                        <div className="bg-white border border-sys-200 p-6 rounded-none shadow-sm font-mono text-xs text-sys-800 mx-auto w-[300px] print:w-full print:border-none print:shadow-none mb-6">
                            <div className="text-center border-b border-dashed border-sys-300 pb-4 mb-4">
                                <h2 className="text-xl font-black uppercase">CIERRE DE TURNO</h2>
                                <p className="font-bold text-sys-500 mt-1">COMPROBANTE DE DECLARACIÓN</p>
                            </div>

                            <div className="space-y-1 mb-4">
                                <div className="flex justify-between"><span>SUCURSAL:</span><span className="font-bold uppercase">{branchName || 'CENTRAL'}</span></div>
                                <div className="flex justify-between"><span>CAJERO:</span><span className="font-bold uppercase">{userName || 'SISTEMA'}</span></div>
                                <div className="flex justify-between"><span>FECHA:</span><span>{formatDate()}</span></div>
                                <div className="flex justify-between"><span>ID TURNO:</span><span>#{shiftId ? shiftId.slice(0,6) : '????'}</span></div>
                            </div>

                            {/* SOLO MOSTRAMOS LO DECLARADO FÍSICAMENTE */}
                            <div className="border-t border-dashed border-sys-300 py-4">
                                <p className="font-bold mb-2 text-center bg-sys-100 uppercase py-1">DECLARACIÓN DE VALORES</p>
                                
                                <div className="flex justify-between text-sm font-bold mb-2">
                                    <span>TOTAL EN CAJA:</span>
                                    <span className="text-lg">{formatMoney(valDeclared)}</span>
                                </div>
                                
                                <div className="flex justify-between items-center text-sys-600 mb-2">
                                    <span>(-) DEJA FONDO:</span>
                                    <span>{formatMoney(valLeft)}</span>
                                </div>

                                <div className="flex justify-between font-black border-t-2 border-sys-800 mt-2 pt-2 text-xl">
                                    <span>A RENDIR (SOBRE):</span>
                                    <span>{formatMoney(totalWithdrawal)}</span>
                                </div>
                            </div>
                            
                            <div className="mt-12 text-center text-[10px] space-y-12">
                                <div className="border-t border-sys-400 w-3/4 mx-auto pt-1">
                                    <p className="font-bold uppercase">{userName}</p>
                                    <p>Firma Cajero</p>
                                </div>
                                <div className="border-t border-sys-400 w-3/4 mx-auto pt-1">
                                    <p>Firma Supervisor / Recibe</p>
                                </div>
                            </div>
                        </div>

                        {/* ACCIONES (NO IMPRIMIBLE) */}
                        <div className="grid grid-cols-2 gap-3 print:hidden">
                           <Button variant="secondary" onClick={handlePrint} className="h-12 font-bold text-sys-600 border border-sys-200">
                               <Printer size={18} className="mr-2"/> Imprimir
                           </Button>
                           <Button variant="danger" onClick={handleSubmit} className="h-12 shadow-xl shadow-red-500/20 bg-red-600 hover:bg-red-700 text-white font-black tracking-wider text-xs uppercase">
                               Confirmar y Cerrar
                           </Button>
                        </div>
                        <button onClick={() => setStep(2)} className="mt-4 text-xs text-sys-400 underline text-center print:hidden hover:text-sys-600">Volver a editar montos</button>
                      </div>
                    )}

                </div>
            </div>
        </div>
    );
};