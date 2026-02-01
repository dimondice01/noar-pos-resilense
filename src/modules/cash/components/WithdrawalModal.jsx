import React, { useState, useRef, useEffect } from 'react';
import { X, Lock, ArrowRight, Banknote, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { securityService } from '../../security/services/securityService'; // 🔥 Integración de seguridad
import { cn } from '../../../core/utils/cn';

export const WithdrawalModal = ({ isOpen, onClose, onConfirm }) => {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setAmount('');
      setDescription('');
      setAdminPin('');
      setError('');
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const val = parseFloat(amount);
    
    // Validaciones básicas
    if (!val || val <= 0) {
        setError("El monto debe ser mayor a 0");
        return;
    }
    if (!adminPin || adminPin.length < 4) {
        setError("Ingrese un PIN válido");
        return;
    }

    setIsLoading(true);
    setError('');

    try {
        // 🔥 VALIDACIÓN REAL DE SEGURIDAD
        // Verificamos si el PIN pertenece a un ADMIN o OWNER
        const authorizedUser = await securityService.verifyPin(adminPin);
        
        if (!authorizedUser) {
            throw new Error("PIN Incorrecto o sin permisos");
        }

        // Si pasa, ejecutamos el retiro
      onConfirm({ amount: val, description, adminPin });
        
        onClose();
    } catch (err) {
        setError("Acceso Denegado: PIN inválido");
        setAdminPin(''); // Limpiamos PIN por seguridad
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden ring-1 ring-black/5">
        
        {/* Header - Estilo "Retiro Seguro" (Naranja/Alerta) */}
        <div className="bg-orange-50 p-5 border-b border-orange-100 flex justify-between items-center">
          <div>
            <h3 className="font-bold text-lg text-orange-800 leading-none flex items-center gap-2">
              <Banknote size={20} /> Retiro de Efectivo
            </h3>
            <p className="text-xs text-orange-600 mt-1 font-medium">Salida de dinero de caja</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-orange-100 text-orange-400 transition">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          
          {/* 1. Monto */}
          <div>
            <label className="block text-xs font-bold text-sys-500 uppercase tracking-wider mb-2">Monto a Retirar</label>
            <div className="relative group">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sys-400 text-xl font-medium group-focus-within:text-orange-500 transition-colors">$</span>
              <input
                ref={inputRef}
                type="number"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setError(''); }}
                className="w-full pl-10 pr-4 py-3 text-3xl font-black border-b-2 border-sys-200 focus:border-orange-500 outline-none bg-transparent text-sys-900 placeholder-sys-200 transition-colors"
                placeholder="0.00"
                disabled={isLoading}
              />
            </div>
          </div>

          {/* 2. Motivo */}
          <div>
            <label className="block text-xs font-bold text-sys-500 uppercase tracking-wider mb-2">Concepto / Motivo</label>
            <input 
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-sys-200 bg-sys-50 focus:bg-white focus:border-orange-500 outline-none text-sm font-medium transition-all"
              placeholder="Ej: Pago Proveedor Coca-Cola, Retiro Ganancias..."
              disabled={isLoading}
            />
          </div>

          {/* 3. PIN de Autorización (La clave de todo) */}
          <div className={cn("p-4 rounded-xl border transition-all", error ? "bg-red-50 border-red-200" : "bg-sys-50 border-sys-200")}>
            <label className={cn("block text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1", error ? "text-red-500" : "text-sys-500")}>
              <Lock size={12} /> {error ? error : "Autorización Requerida"}
            </label>
            
            <div className="flex gap-2">
                <input 
                  type="password"
                  value={adminPin}
                  onChange={(e) => { setAdminPin(e.target.value); setError(''); }}
                  className="flex-1 px-4 py-2 rounded-lg border border-sys-300 bg-white text-center font-mono text-lg tracking-widest focus:border-sys-900 outline-none focus:ring-2 focus:ring-sys-900/10 transition-all"
                  placeholder="PIN"
                  maxLength={6}
                  disabled={isLoading}
                  autoComplete="new-password"
                />
            </div>
            
            {!error && (
                <p className="text-[10px] text-sys-400 text-center mt-2 font-medium">
                  Ingrese su PIN de supervisor para confirmar la salida.
                </p>
            )}
          </div>

          <Button 
            type="submit" 
            className="w-full py-4 text-lg bg-orange-600 hover:bg-orange-700 text-white shadow-xl shadow-orange-500/20 h-14 rounded-xl"
            disabled={!amount || !adminPin || isLoading}
          >
            {isLoading ? <Loader2 className="animate-spin" /> : <span className="flex items-center">Autorizar Retiro <ArrowRight size={20} className="ml-2" /></span>}
          </Button>

        </form>
      </div>
    </div>
  );
};