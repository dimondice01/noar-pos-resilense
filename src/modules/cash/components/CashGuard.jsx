import React, { useEffect, useState } from 'react';
import { Lock, ArrowRight, Wallet, UserCircle, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { cashRepository } from '../repositories/cashRepository'; // 🔥 Usamos el repo unificado
import { securityService } from '../../security/services/securityService'; // Servicio de PIN
import { PinPad } from '../../security/components/PinPad';
import { Button } from '../../../core/ui/Button';
import { useShiftStore } from '../store/useShiftStore';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { cn } from '../../../core/utils/cn';

export const CashGuard = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(true);
  
  // Stores Globales
  const { currentShift, setSession } = useShiftStore(); 
  const { user } = useAuthStore();

  // Estados Locales
  const [step, setStep] = useState('CHECKING'); // CHECKING | LOGIN | AMOUNT
  const [pin, setPin] = useState('');
  const [tempUser, setTempUser] = useState(null); 
  const [initialAmount, setInitialAmount] = useState('');
  const [error, setError] = useState('');

  // 1. Verificación Inicial (Al montar)
  useEffect(() => {
    const initGuard = async () => {
      if (!user) return; // Esperar a que auth cargue
      
      try {
        setVerifying(true);
        // Intentar recuperar turno existente del usuario actual
        const shift = await cashRepository.getCurrentShift();
        
        if (shift) {
          // ✅ Si hay turno abierto, restauramos sesión y dejamos pasar directo
          console.log("🔓 Turno recuperado:", shift.id);
          setSession(user, shift); 
        } else {
          // 🔒 Si no hay turno, pedimos login/apertura
          console.log("🔒 Sin turno activo. Iniciando bloqueo.");
          setStep('LOGIN');
        }
      } catch (e) {
        console.error("Error verificando turno:", e);
        setError("Error de conexión con tesorería.");
      } finally {
        setVerifying(false);
        setLoading(false);
      }
    };
    
    initGuard();
  }, [user, setSession]);

  // 2. Manejo del PIN Pad
  const handlePinInput = (num) => {
    if (loading) return;
    const newPin = pin + num;
    setPin(newPin);
    setError('');
    if (newPin.length === 4) validateUser(newPin);
  };

  const validateUser = async (inputPin) => {
    setLoading(true);
    try {
      // Validamos contra el servicio de seguridad (o repo de usuarios)
      const validUser = await securityService.verifyPin(inputPin);
      
      if (!validUser) throw new Error("Credenciales inválidas");
      
      // Validación extra: ¿Es el mismo usuario que está logueado en Firebase?
      // O permitimos "cambio de cajero" sobre la marcha?
      // Por seguridad simple, asumimos que debe coincidir o ser un supervisor.
      
      setTempUser(validUser);
      setPin('');
      setStep('AMOUNT'); // Pasamos a pantalla de fondo inicial
    } catch (err) {
      setError('PIN Incorrecto');
      setPin('');
      if (navigator.vibrate) navigator.vibrate(200);
    } finally {
      setLoading(false);
    }
  };

  // 3. Apertura de Caja
  const handleOpenShift = async (e) => {
    e.preventDefault();
    if (!initialAmount) return;

    setLoading(true);
    try {
      // Abrimos caja real usando el repositorio robusto
      const newShift = await cashRepository.openShift(parseFloat(initialAmount), tempUser.name);
      
      // Guardamos en store global y desbloqueamos UI
      setSession(tempUser, newShift);
      // El componente se desmontará o hará render de children automáticamente al cambiar currentShift
    } catch (err) {
      console.error(err);
      setError(err.message || "No se pudo abrir la caja");
    } finally {
      setLoading(false);
    }
  };

  // --- RENDERIZADO ---

  // Si hay turno validado en el store, renderizamos la app
  if (currentShift) {
    return <>{children}</>;
  }

  // Loader inicial de verificación
  if (verifying) {
    return (
      <div className="h-screen w-full flex flex-col gap-4 items-center justify-center bg-sys-50 animate-in fade-in">
        <Loader2 className="animate-spin text-brand" size={48} />
        <p className="text-sys-500 font-bold uppercase tracking-widest text-xs animate-pulse">Verificando sesión de caja...</p>
      </div>
    );
  }

  // PANTALLA DE BLOQUEO (LOGIN / APERTURA)
  return (
    <div className="fixed inset-0 z-[100] bg-sys-100/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col relative animate-in zoom-in-95 duration-300 ring-1 ring-black/5">
        
        {/* Barra superior decorativa */}
        <div className="h-2 bg-gradient-to-r from-brand to-purple-600"></div>
        
        <div className="p-8 pb-4 text-center">
          <div className="w-20 h-20 bg-sys-50 rounded-full flex items-center justify-center mx-auto mb-4 text-brand border border-sys-100 shadow-inner">
            {step === 'LOGIN' ? <Lock size={36} strokeWidth={1.5} /> : <Wallet size={36} strokeWidth={1.5} />}
          </div>
          
          <h2 className="text-2xl font-black text-sys-900 tracking-tight">
            {step === 'LOGIN' ? 'Terminal Bloqueada' : `Hola, ${tempUser?.name?.split(' ')[0]}`}
          </h2>
          
          <p className="text-sys-500 text-sm mt-2 font-medium">
            {step === 'LOGIN' ? 'Ingrese su PIN de operador para acceder.' : 'Indique el fondo inicial para abrir caja.'}
          </p>
        </div>

        {error && (
          <div className="mx-8 p-3 bg-red-50 border border-red-100 text-red-600 text-xs font-bold text-center rounded-xl flex items-center justify-center gap-2 animate-in slide-in-from-top-2">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        <div className="p-8 pt-4">
          
          {/* PASO 1: LOGIN PIN */}
          {step === 'LOGIN' && (
            <PinPad 
              value={pin}
              onInput={handlePinInput}
              onClear={() => setPin(prev => prev.slice(0, -1))}
              disabled={loading}
            />
          )}

          {/* PASO 2: FONDO INICIAL */}
          {step === 'AMOUNT' && (
            <form onSubmit={handleOpenShift} className="space-y-6 animate-in slide-in-from-right-8 duration-300">
              
              {/* Tarjeta de Usuario */}
              <div className="bg-sys-50 p-4 rounded-xl border border-sys-200 flex items-center gap-4">
                <div className="bg-white p-2 rounded-full shadow-sm">
                    <UserCircle size={24} className="text-sys-400" />
                </div>
                <div className="flex-1">
                    <p className="text-[10px] text-sys-500 font-black uppercase tracking-wider">Operador</p>
                    <p className="text-sm font-bold text-sys-900">{tempUser?.name}</p>
                </div>
                <button 
                    type="button" 
                    onClick={() => { setStep('LOGIN'); setTempUser(null); setPin(''); }} 
                    className="text-xs text-brand font-bold hover:underline px-2 py-1 hover:bg-brand/5 rounded transition-colors"
                >
                    Cambiar
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold text-sys-500 uppercase mb-2 ml-1 tracking-wide">Fondo de Cambio</label>
                <div className="relative group">
                  <span className="absolute left-5 top-1/2 -translate-y-1/2 text-sys-400 text-xl font-bold group-focus-within:text-brand transition-colors">$</span>
                  <input 
                    type="number" 
                    autoFocus 
                    placeholder="0.00" 
                    className="w-full pl-12 pr-4 py-4 text-3xl font-black bg-white border-2 border-sys-200 rounded-2xl focus:border-brand focus:ring-4 focus:ring-brand/10 outline-none transition-all placeholder:text-sys-200 text-sys-900" 
                    value={initialAmount} 
                    onChange={(e) => setInitialAmount(e.target.value)} 
                  />
                </div>
              </div>

              <Button 
                type="submit" 
                className="w-full py-4 text-lg h-14 shadow-xl shadow-brand/20 rounded-xl bg-sys-900 hover:bg-black text-white" 
                disabled={!initialAmount || loading}
              >
                {loading ? <Loader2 className="animate-spin" /> : <ArrowRight className="ml-2" />} 
                {loading ? 'Iniciando...' : 'ABRIR TURNO'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};