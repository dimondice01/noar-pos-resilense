import React, { useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useNavigate } from 'react-router-dom';
import { Lock, ArrowRight, AlertCircle } from 'lucide-react';
import { Button } from '../../../core/ui/Button';

export const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const login = useAuthStore(state => state.login);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      await login(email, password);
      navigate('/'); // Redirigir al Dashboard
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-sys-50 p-4">
      
      {/* Logo Brand */}
      <div className="mb-8 flex flex-col items-center gap-2">
         <div className="w-14 h-14 bg-sys-900 rounded-2xl flex items-center justify-center shadow-xl shadow-sys-200">
            <div className="w-7 h-7 border-l-4 border-r-4 border-white/90 skew-x-[-10deg] relative">
               <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-1 bg-brand rotate-[-45deg]"></div>
            </div>
         </div>
         <h1 className="font-sans font-black text-2xl tracking-tight text-sys-900 mt-2">
           NOAR<span className="text-brand">POS</span>
         </h1>
         <p className="text-xs font-medium text-sys-400 tracking-widest uppercase">Sistema de Acceso Seguro</p>
      </div>

      {/* Tarjeta Login */}
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl shadow-sys-200/50 border border-sys-100 p-8">
        <form onSubmit={handleSubmit} className="space-y-5">
          
          <div>
            <label className="block text-xs font-bold text-sys-500 uppercase mb-2 ml-1">Usuario</label>
            <input 
              type="email" 
              required
              className="w-full bg-sys-50 border border-sys-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all"
              placeholder="nombre@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-sys-500 uppercase mb-2 ml-1">Contraseña</label>
            <input 
              type="password" 
              required
              className="w-full bg-sys-50 border border-sys-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-xl text-xs font-medium border border-red-100 animate-in fade-in slide-in-from-top-2">
              <AlertCircle size={16} className="shrink-0" />
              {error}
            </div>
          )}

          <Button 
            className="w-full py-3.5 mt-2 shadow-xl shadow-brand/20" 
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Verificando...' : 'Iniciar Sesión'}
            {!isSubmitting && <ArrowRight size={18} className="ml-2 opacity-80" />}
          </Button>

        </form>
      </div>

      <p className="mt-8 text-xs text-sys-400">
        © 2025 NoarPOS Resilense Argentina. v1.01
      </p>
    </div>
  );
};