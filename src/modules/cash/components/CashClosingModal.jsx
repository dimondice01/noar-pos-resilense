import React, { useState, useEffect, useRef } from 'react';
import { X, Lock, DollarSign, Calculator, AlertTriangle, ArrowRight, Wallet, Printer, Eye, EyeOff } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import { useReactToPrint } from 'react-to-print';
import { useAuthStore } from '../../auth/store/useAuthStore'; // 🔥 IMPORTAMOS PARA VER LOS PERMISOS

// Helper de Moneda
const formatMoney = (val) => `$ ${Number(val).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Helper de Fecha
const formatDate = () => {
    const d = new Date();
    return `${d.toLocaleDateString('es-AR')} ${d.toLocaleTimeString('es-AR', {hour: '2-digit', minute:'2-digit'})}`;
};

export const CashClosingModal = ({ isOpen, onClose, onConfirm, systemTotals, userName, branchName, shiftId }) => {
    // 🔥 PERMISOS DEL USUARIO ACTUAL
    const { user } = useAuthStore();
    const isSuperUser = user?.role === 'ADMIN' || user?.role === 'OWNER';
    const canSeeExpected = isSuperUser || user?.permissions?.canSeeExpectedCash === true;

    // ESTADOS
    const [step, setStep] = useState(1); // 1: Conteo, 2: Distribución, 3: Ticket Declaración
    
    // Paso 1: Cuánto hay en total en el cajón (Físico)
    const [declaredCash, setDeclaredCash] = useState(''); 
    
    // Paso 2: Cuánto dejo para cambio (Remanente)
    const [leftInCash, setLeftInCash] = useState(''); 

    const ticketRef = useRef(null);

    // Reset al abrir
    useEffect(() => {
        if (isOpen) {
            setStep(1);
            setDeclaredCash('');
            setLeftInCash('');
        }
    }, [isOpen]);

    // HOOK DE IMPRESIÓN (TICKET 58mm)
    const handlePrintTicket = useReactToPrint({
        contentRef: ticketRef,
        documentTitle: `Declaracion-Caja-${shiftId?.slice(0,6) || 'C'}`,
    });

    if (!isOpen) return null;

    // CÁLCULOS EN TIEMPO REAL
    const valDeclared = declaredCash === '' ? 0 : parseFloat(declaredCash);
    const valLeft = leftInCash === '' ? 0 : parseFloat(leftInCash);
    const totalWithdrawal = Math.max(0, valDeclared - valLeft);
    
    // VARIABLES DEL SISTEMA 
    const expectedCash = systemTotals?.totalCash || 0; 
    const expectedDigital = systemTotals?.totalDigital || 0;
    const difference = valDeclared - expectedCash; 

    const handleSubmit = () => {
        onConfirm({
            declaredCash: valDeclared,  
            leftInCash: valLeft,        
            expectedCash: expectedCash, 
            expectedDigital: expectedDigital,
            withdrawal: totalWithdrawal,
            difference: difference
        });
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-sys-900/80 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95 print:p-0 print:bg-white print:static">
            <div className={cn("bg-white rounded-3xl shadow-2xl w-full overflow-hidden flex flex-col max-h-[95vh] print:shadow-none print:max-w-none print:h-auto print:rounded-none", step === 3 ? "max-w-3xl" : "max-w-md")}>
                
                {/* Header (No imprimible) */}
                <div className="bg-sys-50 p-6 border-b border-sys-100 flex justify-between items-center shrink-0 print:hidden">
                   <div>
                      <h3 className="text-xl font-bold text-sys-900 flex items-center gap-2">
                         <Lock className="text-brand" size={24} /> Cierre de Turno
                      </h3>
                      <p className="text-xs text-sys-500 mt-1 font-medium">
                          {step === 1 ? 'Paso 1: Arqueo Físico' : step === 2 ? 'Paso 2: Distribución' : 'Paso 3: Comprobante'}
                      </p>
                   </div>
                   <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full text-sys-400 transition-colors"><X/></button>
                </div>

                <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar print:p-0 print:overflow-visible flex-1 bg-white">
                    
                    {/* ================================================= */}
                    {/* PASO 1: CONTEO TOTAL DE EFECTIVO                  */}
                    {/* ================================================= */}
                    {step === 1 && (
                      <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 max-w-sm mx-auto">
                        
                        {/* 🔥 PANEL INTELIGENTE BASADO EN PERMISOS */}
                        {canSeeExpected ? (
                            <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 text-emerald-800 text-sm flex gap-3">
                               <Eye className="shrink-0 mt-0.5 text-emerald-600" size={20}/>
                               <div>
                                   <p className="font-black text-emerald-900">Modo Transparente</p>
                                   <p className="opacity-90 text-xs mt-1 leading-relaxed">Según el sistema, debes tener <strong>{formatMoney(expectedCash)}</strong> en tu cajón.</p>
                               </div>
                            </div>
                        ) : (
                            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-blue-800 text-sm flex gap-3">
                               <EyeOff className="shrink-0 mt-0.5 text-blue-600" size={20}/>
                               <div>
                                   <p className="font-black text-blue-900">Auditoría Ciega</p>
                                   <p className="opacity-90 text-xs mt-1 leading-relaxed">Cuente TODO el dinero físico que hay en la caja (billetes + monedas) e ingrese el total real.</p>
                               </div>
                            </div>
                        )}

                        <div>
                           <label className="block text-xs font-bold text-sys-500 uppercase tracking-wider mb-2">Total Efectivo Físico en Caja</label>
                           <div className="relative">
                              <DollarSign className="absolute left-4 top-4 text-sys-400" />
                              <input 
                                type="number" 
                                autoFocus
                                className={cn(
                                    "w-full pl-10 pr-4 py-4 text-3xl font-black border-2 rounded-xl outline-none transition-all placeholder:text-sys-200",
                                    canSeeExpected && declaredCash !== '' && valDeclared !== expectedCash ? "border-orange-300 focus:border-orange-500 text-orange-600 bg-orange-50" : "border-sys-200 focus:border-brand text-sys-900 bg-white"
                                )}
                                placeholder="0.00"
                                value={declaredCash}
                                onChange={e => setDeclaredCash(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && valDeclared >= 0 && setStep(2)}
                              />
                           </div>
                           
                           {/* Ayuda visual si tiene permisos y hay diferencia */}
                           {canSeeExpected && declaredCash !== '' && valDeclared !== expectedCash && (
                               <p className={cn("text-[10px] font-bold mt-2 text-right", difference > 0 ? "text-emerald-600" : "text-rose-600")}>
                                   Diferencia: {difference > 0 ? '+' : ''}{formatMoney(difference)}
                               </p>
                           )}
                        </div>

                        <div className="pt-4">
                           <Button onClick={() => setStep(2)} className="w-full py-4 text-lg shadow-xl bg-sys-900 hover:bg-black text-white" disabled={declaredCash === '' || valDeclared < 0}>
                              Siguiente <ArrowRight className="ml-2" size={20}/>
                           </Button>
                        </div>
                      </div>
                    )}

                    {/* ================================================= */}
                    {/* PASO 2: DISTRIBUCIÓN (FONDO PRÓXIMO TURNO)        */}
                    {/* ================================================= */}
                    {step === 2 && (
                      <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 max-w-sm mx-auto">
                        <div className="text-center pb-4 border-b border-sys-100">
                            <p className="text-xs text-sys-500 uppercase font-bold">Total Arqueado Físicamente</p>
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
                                    valLeft > valDeclared ? "border-red-300 focus:border-red-500 text-red-600 bg-red-50" : "border-sys-200 focus:border-brand bg-white"
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
                                   Se retirarán (Sobre): <span className="font-bold text-sys-800">{formatMoney(totalWithdrawal)}</span>
                               </p>
                           )}
                        </div>

                        <div className="grid grid-cols-2 gap-3 pt-2">
                           <Button variant="ghost" onClick={() => setStep(1)} className="h-12 font-bold text-sys-500">Atrás</Button>
                           <Button onClick={() => setStep(3)} className="shadow-lg h-12 bg-sys-900 hover:bg-black text-white" disabled={valLeft > valDeclared || leftInCash === ''}>
                              Generar Comprobante
                           </Button>
                        </div>
                      </div>
                    )}

                    {/* ================================================= */}
                    {/* PASO 3: TICKET DECLARACIÓN (VISTA PREVIA)         */}
                    {/* ================================================= */}
                    {step === 3 && (
                      <div className="flex flex-col md:flex-row gap-6 animate-in zoom-in-95 duration-300 h-full items-start justify-center">
                        
                        {/* 🎫 VISTA PREVIA DEL TICKET (58mm RETAIL) */}
                        <div className="bg-sys-50 p-4 rounded-2xl border border-sys-200 shadow-inner flex justify-center w-full md:w-auto overflow-y-auto max-h-[60vh] custom-scrollbar shrink-0 print:hidden">
                            <div className="bg-white shadow-md border border-gray-200 w-[240px] shrink-0 origin-top">
                                
                                {/* CONTENIDO PARA IMPRESIÓN REACT-TO-PRINT */}
                                <div ref={ticketRef} className="w-full bg-white text-black font-mono text-[10px] uppercase leading-[1.2] p-2">
                                    <style>{`
                                        @media print {
                                            @page { size: auto; margin: 0; }
                                            body { margin: 0; padding: 0; background: white; -webkit-print-color-adjust: exact; color: black; }
                                        }
                                    `}</style>
                                    
                                    {/* CABECERA TICKET */}
                                    <div className="text-center border-b border-black border-dashed pb-2 mb-2">
                                        <h2 className="text-sm font-black tracking-widest">{branchName || 'SUCURSAL PRINCIPAL'}</h2>
                                        <p className="font-bold">DECLARACIÓN DE CIERRE</p>
                                        <p className="mt-1">FECHA: {formatDate()}</p>
                                        <p>TURNO: #{shiftId ? shiftId.slice(-6).toUpperCase() : '000000'}</p>
                                        <p>CAJERO: {userName || 'SISTEMA'}</p>
                                    </div>

                                    {/* DECLARACIÓN DEL CAJERO (ARQUEO) */}
                                    <div className="border-b-2 border-black pb-2 mb-4 mt-4">
                                        <p className="font-black text-center mb-2 bg-gray-200 py-1">VALORES DECLARADOS</p>
                                        
                                        <div className="flex justify-between font-bold mb-1">
                                            <span>EFECTIVO ARQUEADO:</span>
                                            <span className="text-sm">{formatMoney(valDeclared)}</span>
                                        </div>
                                        
                                        <div className="flex justify-between text-sys-600 mb-1">
                                            <span>(-) DEJA FONDO (MAÑANA):</span>
                                            <span>{formatMoney(valLeft)}</span>
                                        </div>
                                        
                                        <div className="flex justify-between font-black mt-2 pt-2 border-t border-black text-lg">
                                            <span>A RENDIR (SOBRE):</span>
                                            <span>{formatMoney(totalWithdrawal)}</span>
                                        </div>
                                    </div>

                                    {/* FIRMAS */}
                                    <div className="mt-12 text-center space-y-12">
                                        <div className="border-t border-black w-4/5 mx-auto pt-1">
                                            <p className="font-bold">{userName}</p>
                                            <p>FIRMA CAJERO</p>
                                        </div>
                                        <div className="border-t border-black w-4/5 mx-auto pt-1 pb-4">
                                            <p>FIRMA SUPERVISOR / RECIBE</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* PANEL DE ACCIONES PARA PANTALLA */}
                        <div className="flex-1 flex flex-col gap-4 print:hidden w-full max-w-sm">
                            <div className="bg-orange-50 border border-orange-100 p-4 rounded-xl text-orange-800 text-xs">
                                <div className="flex gap-2 items-start">
                                    <AlertTriangle size={16} className="shrink-0 mt-0.5"/>
                                    <p>Verifique que los montos en el ticket coincidan con el dinero en su poder. Una vez confirmado el cierre, el turno no podrá reabrirse.</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 mt-auto">
                               <Button variant="secondary" onClick={handlePrintTicket} className="h-12 font-bold text-sys-600 border border-sys-200">
                                   <Printer size={18} className="mr-2"/> Imprimir
                               </Button>
                               <Button variant="danger" onClick={handleSubmit} className="h-12 shadow-xl shadow-red-500/20 bg-red-600 hover:bg-red-700 text-white font-black tracking-wider text-xs uppercase">
                                   Confirmar Cierre
                               </Button>
                            </div>
                            <button onClick={() => setStep(2)} className="mt-2 text-xs text-sys-400 underline text-center hover:text-sys-600">Volver a editar montos</button>
                        </div>
                      </div>
                    )}

                </div>
            </div>
        </div>
    );
};