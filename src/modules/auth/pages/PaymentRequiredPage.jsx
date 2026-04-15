import React from 'react';
import { ShieldAlert, LogOut, MessageCircle } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { Button } from '../../../core/ui/Button';

export const PaymentRequiredPage = () => {
    const { logout } = useAuthStore();

    return (
        <div className="min-h-screen bg-sys-50 flex items-center justify-center p-4 font-sans text-sys-900 overflow-hidden relative">
            
            {/* Elementos decorativos de fondo */}
            <div className="absolute top-0 left-0 w-full h-2 bg-red-600"></div>
            <div className="absolute -top-24 -right-24 w-96 h-96 bg-red-500/5 rounded-full blur-3xl"></div>
            <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-brand/5 rounded-full blur-3xl"></div>

            <div className="w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl shadow-red-200/20 border border-sys-100 p-8 md:p-12 text-center relative z-10 animate-in zoom-in duration-500">
                
                <div className="w-24 h-24 bg-red-50 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-inner rotate-3">
                    <ShieldAlert className="text-red-500" size={48} />
                </div>

                <h1 className="text-3xl font-black text-sys-900 tracking-tighter mb-4 leading-none">
                    Acceso <span className="text-red-600">Restringido</span>
                </h1>

                <div className="bg-red-50/50 border border-red-100 rounded-2xl p-6 mb-8">
                    <p className="text-lg font-bold text-red-900 leading-snug">
                        Servicio Suspendido por falta de pago, contacte a su asesor.
                    </p>
                </div>

                <div className="space-y-3">
                    <Button 
                        onClick={() => window.open('https://wa.me/your-whatsapp-number', '_blank')}
                        className="w-full h-14 text-base font-black uppercase tracking-tight bg-sys-900 hover:bg-black shadow-xl shadow-sys-900/10 group"
                    >
                        <MessageCircle size={20} className="mr-2 group-hover:scale-110 transition-transform"/> 
                        Contactar Soporte
                    </Button>

                    <button 
                        onClick={logout}
                        className="w-full h-12 text-sm font-bold text-sys-400 hover:text-sys-900 flex items-center justify-center gap-2 transition-colors"
                    >
                        <LogOut size={16} /> Cerrar Sesión
                    </button>
                </div>

                <p className="mt-12 text-[10px] font-black text-sys-300 uppercase tracking-[0.2em]">
                    NoarPOS Resilience • v2.1
                </p>
            </div>
        </div>
    );
};