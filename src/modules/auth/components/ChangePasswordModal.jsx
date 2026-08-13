import React, { useState, useEffect, useRef } from 'react';
import { KeyRound, CheckCircle2 } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { authService } from '../services/authService';

const ERROR_MESSAGES = {
    'auth/wrong-password': 'La contraseña actual es incorrecta.',
    'auth/invalid-credential': 'La contraseña actual es incorrecta.',
    'auth/weak-password': 'La nueva contraseña debe tener al menos 6 caracteres.',
    'auth/too-many-requests': 'Demasiados intentos. Probá de nuevo en unos minutos.',
    'auth/requires-recent-login': 'Por seguridad, cerrá sesión, volvé a entrar e intentá de nuevo.',
    'auth/network-request-failed': 'Sin conexión. Este cambio requiere estar online.',
};

export const ChangePasswordModal = ({ isOpen, onClose }) => {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setError('');
            setSuccess(false);
            setSubmitting(false);
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (newPassword.length < 6) {
            setError('La nueva contraseña debe tener al menos 6 caracteres.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('Las contraseñas nuevas no coinciden.');
            return;
        }

        setSubmitting(true);
        try {
            await authService.changePassword(currentPassword, newPassword);
            setSuccess(true);
        } catch (err) {
            console.warn('Error cambiando contraseña:', err.code);
            setError(ERROR_MESSAGES[err.code] || 'No se pudo cambiar la contraseña. Intentá de nuevo.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-sys-900/80 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden p-6">
                <div className="w-16 h-16 bg-brand/10 text-brand rounded-full flex items-center justify-center mx-auto mb-4 border border-brand/20">
                    <KeyRound size={28} />
                </div>
                <h3 className="text-xl font-black text-sys-900 mb-1 text-center">Cambiar Contraseña</h3>
                <p className="text-xs text-sys-500 font-bold mb-6 uppercase tracking-wider text-center">
                    Ingresá tu contraseña actual y la nueva
                </p>

                {success ? (
                    <div className="text-center space-y-4">
                        <div className="flex items-center justify-center gap-2 text-emerald-600">
                            <CheckCircle2 size={18} />
                            <p className="text-sm font-bold">Contraseña actualizada correctamente.</p>
                        </div>
                        <Button onClick={onClose} className="w-full">Listo</Button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-3">
                        <div>
                            <label className="block text-xs font-bold text-sys-500 uppercase mb-1.5 ml-1">Contraseña actual</label>
                            <input
                                ref={inputRef}
                                type="password"
                                required
                                autoComplete="current-password"
                                className="w-full bg-sys-50 border border-sys-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all"
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-sys-500 uppercase mb-1.5 ml-1">Nueva contraseña</label>
                            <input
                                type="password"
                                required
                                autoComplete="new-password"
                                minLength={6}
                                className="w-full bg-sys-50 border border-sys-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-sys-500 uppercase mb-1.5 ml-1">Repetir nueva contraseña</label>
                            <input
                                type="password"
                                required
                                autoComplete="new-password"
                                className="w-full bg-sys-50 border border-sys-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                        </div>

                        {error && <p className="text-xs font-bold text-red-500 text-center">{error}</p>}

                        <div className="flex gap-2 pt-2">
                            <Button variant="secondary" onClick={onClose} type="button" className="flex-1">Cancelar</Button>
                            <Button type="submit" disabled={submitting} className="flex-1 bg-sys-900 hover:bg-black text-white shadow-xl">
                                {submitting ? 'Guardando...' : 'Cambiar'}
                            </Button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};
