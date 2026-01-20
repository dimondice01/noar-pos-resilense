import React, { useState } from 'react';
import { ShieldAlert, CheckCircle2, Copy, CreditCard, Landmark, Send, Loader2, ArrowRight, Crown, Calendar } from 'lucide-react';
import { doc, updateDoc, addDoc, collection } from 'firebase/firestore';
import { db } from '../../../database/firebase'; 
import { useAuthStore } from '../store/useAuthStore';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

// ⚙️ CONFIGURACIÓN DE TUS DATOS
const MY_DATA = {
    alias: "NOAR.SISTEMAS.MP",
    cbu: "000000310008473847382",
    holder: "Noar Tech SAS",
    bank: "Mercado Pago"
};

// 💰 TUS PRECIOS
const PLAN_MONTHLY = { id: 'monthly', price: "$40.000", label: "Mensual", icon: Calendar };
const PLAN_LIFETIME = { id: 'lifetime', price: "$300.000", label: "De por Vida", icon: Crown };

export const PaymentRequiredPage = () => {
    const { user, logout } = useAuthStore();
    const [selectedPlan, setSelectedPlan] = useState('monthly'); // monthly | lifetime
    const [step, setStep] = useState('selection'); // selection | reporting | success
    const [operationId, setOperationId] = useState('');
    const [loading, setLoading] = useState(false);

    const activePlan = selectedPlan === 'monthly' ? PLAN_MONTHLY : PLAN_LIFETIME;

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        alert("Copiado al portapapeles");
    };

    const handleReportPayment = async (e) => {
        e.preventDefault();
        if (operationId.length < 4) return alert("ID inválido");
        
        setLoading(true);
        try {
            // 1. Reportamos el pago para que el Admin (vos) lo vea
            await addDoc(collection(db, 'payment_reports'), {
                companyId: user.companyId,
                email: user.email,
                plan: selectedPlan, // 'monthly' o 'lifetime'
                amount: activePlan.price,
                operationId: operationId,
                status: 'pending',
                reportedAt: new Date().toISOString()
            });

            // 2. Marcamos la empresa como "Verificando" (opcional)
            await updateDoc(doc(db, 'companies', user.companyId), {
                'subscription.status': 'verifying'
            });

            setStep('success');
        } catch (error) {
            console.error(error);
            alert("Error al reportar. Intenta nuevamente.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-sys-50 flex items-center justify-center p-4 font-sans text-sys-900">
            <div className="w-full max-w-5xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row min-h-[600px]">
                
                {/* COLUMNA IZQUIERDA: MENSAJE Y PLAN */}
                <div className="md:w-1/2 bg-sys-900 text-white p-10 flex flex-col justify-between relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-brand/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                    
                    <div>
                        <div className="inline-flex items-center gap-2 bg-red-500/20 text-red-200 border border-red-500/30 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-6">
                            <ShieldAlert size={14} className="text-red-400" /> Servicio Suspendido
                        </div>
                        <h1 className="text-3xl md:text-4xl font-black mb-4 leading-tight">
                            Tu periodo de prueba finalizó.
                        </h1>
                        <p className="text-white/60 text-lg leading-relaxed">
                            No te preocupes, tus datos están seguros. Elegí un plan para reactivar tu sistema al instante.
                        </p>
                    </div>

                    {/* TARJETA DE RESUMEN DEL PLAN SELECCIONADO */}
                    <div className="mt-8 bg-white/5 border border-white/10 p-6 rounded-2xl backdrop-blur-sm transition-all animate-in fade-in slide-in-from-bottom-4">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <p className="text-xs text-white/50 uppercase font-bold mb-1">Plan Seleccionado</p>
                                <div className="flex items-center gap-2">
                                    <activePlan.icon className="text-brand" size={24}/>
                                    <span className="text-2xl font-bold">{activePlan.label}</span>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-3xl font-black text-brand">{activePlan.price}</p>
                                <p className="text-xs text-white/50">{selectedPlan === 'monthly' ? 'por mes' : 'pago único'}</p>
                            </div>
                        </div>
                        
                        <div className="space-y-2 border-t border-white/10 pt-4">
                            <div className="flex items-center gap-3 text-sm text-white/80">
                                <CheckCircle2 size={16} className="text-green-400"/> Acceso total al sistema
                            </div>
                            <div className="flex items-center gap-3 text-sm text-white/80">
                                <CheckCircle2 size={16} className="text-green-400"/> Soporte Técnico Prioritario
                            </div>
                            {selectedPlan === 'lifetime' && (
                                <div className="flex items-center gap-3 text-sm text-yellow-400 font-bold animate-pulse">
                                    <Crown size={16}/> ¡Sin mensualidades nunca más!
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* COLUMNA DERECHA: SELECCIÓN Y PAGO */}
                <div className="md:w-1/2 p-10 flex flex-col justify-center bg-white relative">
                    
                    {step === 'selection' && (
                        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                                1. Elegí tu modalidad
                            </h2>

                            {/* SELECTOR DE PLANES */}
                            <div className="grid grid-cols-2 gap-4 mb-8">
                                <button 
                                    onClick={() => setSelectedPlan('monthly')}
                                    className={cn(
                                        "p-4 rounded-xl border-2 text-left transition-all relative overflow-hidden",
                                        selectedPlan === 'monthly' 
                                            ? "border-brand bg-brand/5 ring-1 ring-brand" 
                                            : "border-sys-200 hover:border-sys-300"
                                    )}
                                >
                                    <Calendar className={cn("mb-3", selectedPlan === 'monthly' ? "text-brand" : "text-sys-400")} size={28}/>
                                    <p className="font-bold text-sys-900">Mensual</p>
                                    <p className="text-sm text-sys-500">$40.000</p>
                                </button>

                                <button 
                                    onClick={() => setSelectedPlan('lifetime')}
                                    className={cn(
                                        "p-4 rounded-xl border-2 text-left transition-all relative overflow-hidden",
                                        selectedPlan === 'lifetime' 
                                            ? "border-brand bg-brand/5 ring-1 ring-brand" 
                                            : "border-sys-200 hover:border-sys-300"
                                    )}
                                >
                                    <div className="absolute top-0 right-0 bg-yellow-400 text-yellow-900 text-[9px] font-bold px-2 py-0.5 rounded-bl">
                                        RECOMENDADO
                                    </div>
                                    <Crown className={cn("mb-3", selectedPlan === 'lifetime' ? "text-brand" : "text-sys-400")} size={28}/>
                                    <p className="font-bold text-sys-900">De por Vida</p>
                                    <p className="text-sm text-sys-500">$300.000</p>
                                </button>
                            </div>

                            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                                2. Transferí el monto
                            </h2>

                            <div className="bg-sys-50 border border-sys-200 rounded-xl p-5 mb-6 space-y-4">
                                <div className="flex justify-between items-center group cursor-pointer" onClick={() => copyToClipboard(MY_DATA.alias)}>
                                    <div>
                                        <p className="text-[10px] font-bold text-sys-400 uppercase">Alias</p>
                                        <p className="font-mono font-bold text-lg text-sys-900">{MY_DATA.alias}</p>
                                    </div>
                                    <Copy size={18} className="text-sys-400 group-hover:text-brand"/>
                                </div>
                                <div className="border-t border-sys-200 pt-3 flex justify-between items-center group cursor-pointer" onClick={() => copyToClipboard(MY_DATA.cbu)}>
                                    <div>
                                        <p className="text-[10px] font-bold text-sys-400 uppercase">CBU / CVU</p>
                                        <p className="font-mono text-sm text-sys-600">{MY_DATA.cbu}</p>
                                    </div>
                                    <Copy size={16} className="text-sys-400 group-hover:text-brand"/>
                                </div>
                                <p className="text-xs text-sys-500 pt-2">Titular: <strong>{MY_DATA.holder}</strong> ({MY_DATA.bank})</p>
                            </div>

                            <Button onClick={() => setStep('reporting')} className="w-full h-12 text-base shadow-xl">
                                Ya hice la transferencia <ArrowRight size={18} className="ml-2"/>
                            </Button>
                            
                            <button onClick={logout} className="w-full mt-4 text-xs text-sys-400 hover:text-sys-600 underline">
                                Cerrar Sesión
                            </button>
                        </div>
                    )}

                    {step === 'reporting' && (
                        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                            <button onClick={() => setStep('selection')} className="text-xs text-sys-500 hover:text-sys-800 mb-6 flex items-center gap-1">
                                ← Volver atrás
                            </button>
                            
                            <h2 className="text-xl font-bold text-sys-900 mb-2">Informar Pago</h2>
                            <p className="text-sm text-sys-500 mb-6">
                                Ingresa el ID de la operación para validar tu pago de <strong>{activePlan.price}</strong>.
                            </p>

                            <form onSubmit={handleReportPayment}>
                                <div className="mb-6">
                                    <label className="block text-xs font-bold text-sys-700 uppercase mb-2">
                                        Nro. de Operación / Comprobante
                                    </label>
                                    <input 
                                        type="text" 
                                        autoFocus
                                        className="w-full bg-sys-50 border border-sys-200 rounded-xl px-4 py-3 font-mono text-lg outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all"
                                        placeholder="Ej: 12345678"
                                        value={operationId}
                                        onChange={(e) => setOperationId(e.target.value)}
                                    />
                                </div>

                                <Button 
                                    type="submit" 
                                    disabled={loading || operationId.length < 4} 
                                    className="w-full h-12 text-base shadow-xl"
                                >
                                    {loading ? <Loader2 className="animate-spin"/> : <><Send size={18} className="mr-2"/> Enviar Comprobante</>}
                                </Button>
                            </form>
                        </div>
                    )}

                    {step === 'success' && (
                        <div className="text-center animate-in zoom-in duration-300 flex flex-col items-center justify-center h-full">
                            <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-6 text-green-600 shadow-xl shadow-green-100">
                                <CheckCircle2 size={48} />
                            </div>
                            <h2 className="text-3xl font-black text-sys-900 mb-4">¡Comprobante Recibido!</h2>
                            <p className="text-sys-500 mb-8 leading-relaxed max-w-xs mx-auto">
                                Estamos verificando tu pago de <strong>{activePlan.price}</strong>.
                                <br/>
                                Tu cuenta se activará en breve.
                            </p>
                            
                            <Button onClick={logout} variant="outline" className="w-full max-w-xs">
                                Volver al Inicio
                            </Button>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};