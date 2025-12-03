import React, { useEffect, useState } from 'react';
import { Lock, ArrowRight, Wallet, UserCircle } from 'lucide-react';
import { shiftRepository } from '../repositories/shiftRepository';
import { securityService } from '../../security/services/securityService';
import { PinPad } from '../../security/components/PinPad';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
// 👇 Importamos el store nuevo
import { useShiftStore } from '../store/useShiftStore';

export const CashGuard = ({ children }) => {
  const [loading, setLoading] = useState(true);
  
  // Usamos el store global en lugar de estado local para la sesión activa
  const { currentShift, setSession } = useShiftStore(); 

  // Formulario local
  const [step, setStep] = useState('LOGIN'); 
  const [pin, setPin] = useState('');
  const [tempUser, setTempUser] = useState(null); // Usuario temporal mientras se loguea
  const [initialAmount, setInitialAmount] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    checkShift();
  }, []);

  const checkShift = async () => {
    try {
      const shift = await shiftRepository.getCurrentShift();
      if (shift) {
        // 🔥 Si hay turno, recuperamos el usuario (MOCK por ahora)
        // En producción, buscaríamos el usuario en DB por shift.userId
        const user = shift.userId === 'u_admin' 
            ? { name: 'Gerente General', role: 'MANAGER' } 
            : { name: 'Cajero', role: 'CASHIER' };
            
        setSession(user, shift); // Guardamos en global
      }
    } catch (e) {
      console.error("Error verificando turno:", e);
    } finally {
      setLoading(false);
    }
  };

  const handlePinInput = (num) => {
    const newPin = pin + num;
    setPin(newPin);
    setError('');
    if (newPin.length === 4) validateUser(newPin);
  };

  const validateUser = async (inputPin) => {
    setLoading(true);
    try {
      const validUser = await securityService.login(inputPin);
      setTempUser(validUser); // Usuario validado pero aun no abre caja
      setPin('');
      setStep('AMOUNT');
    } catch (err) {
      setError('PIN Incorrecto');
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenShift = async (e) => {
    e.preventDefault();
    if (!initialAmount) return;

    setLoading(true);
    try {
      // Abrimos caja real
      const newShift = await shiftRepository.openShift(tempUser.id, parseFloat(initialAmount));
      // Guardamos sesión global y desbloqueamos
      setSession(tempUser, newShift);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ... (El resto del renderizado es IGUAL, solo cambia que usamos currentShift del store)
  
  if (loading && !tempUser && !currentShift) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-sys-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-sys-200 border-t-brand"></div>
      </div>
    );
  }

  if (currentShift) {
    return <>{children}</>;
  }

  // RENDER PANTALLA DE BLOQUEO (Igual que antes, usando tempUser en lugar de user)
  return (
    <div className="fixed inset-0 z-[100] bg-sys-100 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col relative animate-in zoom-in-95 duration-300">
        <div className="h-2 bg-gradient-to-r from-brand to-purple-500"></div>
        <div className="p-8 pb-6 text-center">
          <div className="w-16 h-16 bg-sys-50 rounded-full flex items-center justify-center mx-auto mb-4 text-brand border border-sys-100 shadow-sm">
            {step === 'LOGIN' ? <Lock size={32} /> : <Wallet size={32} />}
          </div>
          <h2 className="text-2xl font-bold text-sys-900">
            {step === 'LOGIN' ? 'Sistema Bloqueado' : `Hola, ${tempUser?.name}`}
          </h2>
          <p className="text-sys-500 text-sm mt-1">
            {step === 'LOGIN' ? 'Ingresa tu PIN de operador.' : 'Ingresa el fondo de caja inicial.'}
          </p>
        </div>

        {error && (
          <div className="mx-8 p-3 bg-red-50 border border-red-100 text-red-600 text-xs font-bold text-center rounded-xl animate-in slide-in-from-top-2">
            {error}
          </div>
        )}

        <div className="p-8 pt-2">
          {step === 'LOGIN' && (
            <PinPad 
              value={pin}
              onInput={handlePinInput}
              onClear={() => setPin(prev => prev.slice(0, -1))}
              loading={loading}
            />
          )}

          {step === 'AMOUNT' && (
            <form onSubmit={handleOpenShift} className="space-y-6 animate-in slide-in-from-right-8">
              <div className="bg-sys-50 p-4 rounded-xl border border-sys-200 flex items-center gap-3">
                <UserCircle size={24} className="text-sys-400" />
                <div className="flex-1">
                  <p className="text-xs text-sys-500 font-bold uppercase">Operador</p>
                  <p className="text-sm font-medium text-sys-900">{tempUser?.name}</p>
                </div>
                <button type="button" onClick={() => { setStep('LOGIN'); setTempUser(null); setPin(''); }} className="text-xs text-brand font-bold hover:underline">Cambiar</button>
              </div>
              <div>
                <label className="block text-xs font-bold text-sys-500 uppercase mb-2 ml-1">Fondo de Cambio ($)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sys-400 text-lg font-bold">$</span>
                  <input type="number" autoFocus placeholder="0.00" className="w-full pl-10 pr-4 py-4 text-2xl font-bold bg-white border-2 border-sys-200 rounded-xl focus:border-brand outline-none transition-all placeholder:text-sys-200" value={initialAmount} onChange={(e) => setInitialAmount(e.target.value)} />
                </div>
              </div>
              <Button type="submit" className="w-full py-4 text-lg shadow-xl shadow-brand/20" disabled={!initialAmount || loading}>
                {loading ? 'Abriendo...' : 'Abrir Caja'} <ArrowRight className="ml-2" />
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};