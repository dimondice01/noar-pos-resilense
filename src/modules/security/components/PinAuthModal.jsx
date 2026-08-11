import React, { useState, useEffect, useRef } from 'react';
import { Lock } from 'lucide-react';
import { cn } from '../../../core/utils/cn';
import { Button } from '../../../core/ui/Button';
import { securityService } from '../services/securityService';

// Modal único de autorización por PIN de sucursal — reemplaza las 3 copias
// duplicadas que existían en Sidebar.jsx, InventoryPage.jsx y CashOperationsModal.jsx.
// Siempre valida contra securityService.verifyPin (Dexie, offline-first).
export const PinAuthModal = ({ isOpen, onClose, onSuccess, actionName }) => {
    const [pin, setPin] = useState('');
    const [error, setError] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            setPin('');
            setError(false);
            setVerifying(false);
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    const handleVerify = async (e) => {
        e.preventDefault();
        if (verifying) return;

        setVerifying(true);
        setError(false);

        try {
            const isValid = await securityService.verifyPin(pin);
            if (isValid) {
                onSuccess();
                onClose();
            } else {
                setError(true);
                setPin('');
                inputRef.current?.focus();
            }
        } catch (err) {
            console.error("Error validando PIN:", err);
            setError(true);
        } finally {
            setVerifying(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-sys-900/80 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center">
                <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-100">
                    <Lock size={32} />
                </div>
                <h3 className="text-xl font-black text-sys-900 mb-1">Autorización Requerida</h3>
                <p className="text-xs text-sys-500 font-bold mb-6 uppercase tracking-wider">
                    {actionName
                        ? <>Permiso necesario para: <span className="text-brand">{actionName}</span></>
                        : 'Esta sección requiere autorización de un Supervisor.'}
                </p>

                <form onSubmit={handleVerify} className="space-y-4">
                    <div>
                        <input
                            ref={inputRef}
                            type="password"
                            autoComplete="off"
                            maxLength={6}
                            placeholder="Ingrese PIN del Encargado"
                            className={cn(
                                "w-full text-center text-2xl tracking-[0.5em] font-black p-4 bg-sys-50 border-2 rounded-2xl outline-none transition-all",
                                error ? "border-red-500 text-red-500 bg-red-50 animate-shake" : "border-sys-200 focus:border-brand"
                            )}
                            value={pin}
                            onChange={(e) => {
                                setError(false);
                                setPin(e.target.value.replace(/\D/g, ''));
                            }}
                        />
                        {error && <p className="text-xs font-bold text-red-500 mt-2">PIN Incorrecto</p>}
                    </div>

                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={onClose} type="button" className="flex-1">Cancelar</Button>
                        <Button type="submit" disabled={pin.length < 4 || verifying} className="flex-1 bg-sys-900 hover:bg-black text-white shadow-xl">
                            {verifying ? 'Verificando...' : 'Autorizar'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};
