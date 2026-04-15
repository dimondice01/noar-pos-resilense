import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../database/firebase';
import { useAuthStore } from '../../modules/auth/store/useAuthStore';
import { Loader2 } from 'lucide-react';

export const SubscriptionGuard = ({ children }) => {
    const { user, updateUser } = useAuthStore();
    const [status, setStatus] = useState('loading'); // loading | allowed | expired

    useEffect(() => {
        // 🛡️ PASE VIP: Únicamente para el Master Admin Real
        if (user?.companyId === 'master_admin' || user?.uid === 'master-admin-nexus' || !user?.companyId) {
            console.log("👑 Bypass Master Admin activado.");
            setStatus('allowed');
            return;
        }

        const compId = user.companyId;
        console.log(`📡 MONITOR ACTIVADO -> Empresa: ${compId}`);
        const companyRef = doc(db, 'companies', compId);

        // 🔥 ESCUCHA EN TIEMPO REAL (REFORZADA)
        const unsubscribe = onSnapshot(companyRef, { includeMetadataChanges: true }, (snap) => {
            if (!snap.exists()) {
                console.error(`❌ EMPRESA NO ENCONTRADA EN DB (ID: ${compId})`);
                setStatus('allowed'); // Fail-open: No bloqueamos por error de ID
                return;
            }

            const data = snap.data();
            const currentStatus = data.subscriptionStatus || 'TRIAL';

            // 🔄 ACTUALIZACIÓN SILENCIOSA DEL STORE (Solo si cambió)
            // Esto permite que el MainLayout vea el cambio sin reiniciar el monitor
            if (data.subscriptionStatus && data.subscriptionStatus !== user.subscriptionStatus) {
                updateUser({ subscriptionStatus: data.subscriptionStatus });
            }

            // =========================================================
            // 🚨 BLOQUEO EXPLÍCITO: SOLO SI ES "EXPIRED"
            // =========================================================
            if (currentStatus === 'EXPIRED' || data.isActive === false) {
                setStatus('expired');
                
                // Redirección forzada e irreversible
                if (window.location.pathname !== '/plan-expired') {
                    window.location.replace('/plan-expired');
                }
                return;
            }

            // Para cualquier otro caso (ACTIVE, PAST_DUE, TRIAL), permitimos entrada
            setStatus('allowed');
            
        }, (error) => {
            console.error("⚠️ Error en el monitor de licencias:", error);
            setStatus('allowed'); 
        });

        return () => unsubscribe();
    }, [user?.uid, user?.companyId]); // Solo reiniciamos si cambia el usuario o su empresa

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