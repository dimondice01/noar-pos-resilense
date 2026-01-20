import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../database/firebase';
import { useAuthStore } from '../../modules/auth/store/useAuthStore';
import { Loader2 } from 'lucide-react';

export const SubscriptionGuard = ({ children }) => {
    const { user } = useAuthStore();
    const [status, setStatus] = useState('loading'); // loading | allowed | expired

    useEffect(() => {
        const checkSubscription = async () => {
            // Si no hay empresa asignada, dejamos que ProtectedRoute maneje la seguridad básica
            if (!user?.companyId) {
                setStatus('allowed'); 
                return;
            }

            try {
                // Consultamos la "Verdad" directamente en Firestore
                const companyRef = doc(db, 'companies', user.companyId);
                const snap = await getDoc(companyRef);
                
                if (snap.exists()) {
                    const data = snap.data();
                    const sub = data.subscription;

                    // =========================================================
                    // 🛡️ LÓGICA DE COMPATIBILIDAD (CLIENTES ANTIGUOS)
                    // =========================================================
                    // Si el campo 'subscription' NO existe, es un cliente viejo.
                    // Asumimos que ya pagó (Vitalicio) y lo dejamos pasar.
                    if (!sub) {
                        console.log("👑 Cliente Legacy detectado (Acceso Vitalicio)");
                        setStatus('allowed');
                        return;
                    }

                    // =========================================================
                    // 🛡️ LÓGICA PARA NUEVOS CLIENTES (SaaS)
                    // =========================================================
                    
                    // 1. Pase VIP: Si es vitalicio o ya pagó
                    if (sub.isLifetime === true || sub.status === 'paid' || sub.status === 'active_manual') {
                        setStatus('allowed');
                        return;
                    }

                    // 2. Verificación de Trial (Prueba Gratuita)
                    if (sub.plan === 'trial' && sub.trialEndDate) {
                        const now = new Date();
                        const endDate = new Date(sub.trialEndDate);

                        // Si la fecha actual es MAYOR a la fecha de fin -> SE ACABÓ LA FIESTA
                        if (now > endDate) {
                            console.warn("🚫 Periodo de prueba finalizado.");
                            setStatus('expired');
                        } else {
                            // Aún dentro del trial
                            setStatus('allowed');
                        }
                    } else {
                        // Si hay un objeto suscripción pero está en estado raro ('expired', 'past_due')
                        // o no tiene fechas válidas, bloqueamos por seguridad.
                        console.warn("🚫 Estado de suscripción no válido:", sub.status);
                        setStatus('expired');
                    }

                } else {
                    // Si el documento de la empresa no existe, algo está muy mal.
                    console.error("❌ Error Crítico: La empresa asignada al usuario no existe en DB.");
                    setStatus('expired');
                }
            } catch (error) {
                console.error("⚠️ Error verificando suscripción (Fallo de Red):", error);
                // ESTRATEGIA "FAIL OPEN": Si se cae internet o Firestore, 
                // dejamos pasar al usuario para no bloquear su negocio.
                setStatus('allowed'); 
            }
        };

        checkSubscription();
    }, [user]);

    // --- RENDERIZADO DE ESTADOS ---

    if (status === 'loading') {
        return (
            <div className="h-screen w-full flex flex-col items-center justify-center bg-gray-50 gap-4">
                <Loader2 className="animate-spin text-blue-600" size={48} />
                <div className="text-center">
                    <h3 className="text-lg font-bold text-gray-800">Verificando Licencia...</h3>
                    <p className="text-sm text-gray-500">Conectando con el servidor de licencias.</p>
                </div>
            </div>
        );
    }

    if (status === 'expired') {
        // Redirige a la pantalla de pago si el trial venció
        return <Navigate to="/plan-expired" replace />;
    }

    // Si todo está bien, mostramos la App
    return children;
};