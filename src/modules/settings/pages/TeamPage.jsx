import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Shield, ShieldCheck, Mail, Lock } from 'lucide-react';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { authService } from '../../auth/services/authService';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { cn } from '../../../core/utils/cn';

export const TeamPage = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Formulario Nuevo Usuario
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', password: '', role: 'CAJERO' });

  // Cargar Usuarios
  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'users'));
      const usersList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setUsers(usersList);
    } catch (error) {
      console.error("Error cargando equipo:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (formData.password.length < 6) return alert("La contraseña debe tener 6 caracteres mínimo.");
    
    setIsCreating(true);
    try {
      await authService.createUser(formData);
      alert("✅ Usuario creado exitosamente");
      setFormData({ name: '', email: '', password: '', role: 'CAJERO' }); // Reset
      loadUsers(); // Recargar lista
    } catch (error) {
      alert(`❌ Error: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      
      <header>
        <h2 className="text-2xl font-bold text-sys-900 flex items-center gap-2">
          <Users className="text-brand" /> Gestión de Equipo
        </h2>
        <p className="text-sys-500">Administra el acceso y roles de tus colaboradores.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* COLUMNA IZQUIERDA: Formulario de Alta */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6 border-brand/10 shadow-lg shadow-brand/5">
            <h3 className="font-bold text-lg text-sys-800 mb-4 flex items-center gap-2">
              <UserPlus size={20} /> Nuevo Miembro
            </h3>
            
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1">Nombre</label>
                <input 
                  type="text" required 
                  className="w-full bg-sys-50 border border-sys-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-all"
                  placeholder="Ej: Juan Perez"
                  value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1">Email Acceso</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-3 text-sys-400" />
                  <input 
                    type="email" required 
                    className="w-full bg-sys-50 border border-sys-200 rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none focus:border-brand transition-all"
                    placeholder="cajero@noar.com"
                    value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})}
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1">Contraseña</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-3 text-sys-400" />
                  <input 
                    type="password" required 
                    className="w-full bg-sys-50 border border-sys-200 rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none focus:border-brand transition-all"
                    placeholder="••••••"
                    value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})}
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1">Rol</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {['CAJERO', 'ADMIN'].map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setFormData({...formData, role})}
                      className={cn(
                        "py-2 rounded-lg text-xs font-bold transition-all border",
                        formData.role === role 
                          ? "bg-brand text-white border-brand shadow-md" 
                          : "bg-white text-sys-500 border-sys-200 hover:bg-sys-50"
                      )}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>

              <Button type="submit" className="w-full mt-2" disabled={isCreating}>
                {isCreating ? 'Creando...' : 'Dar de Alta'}
              </Button>
            </form>
          </Card>
        </div>

        {/* COLUMNA DERECHA: Lista de Usuarios */}
        <div className="lg:col-span-2">
          <Card className="p-0 overflow-hidden">
            <div className="p-4 border-b border-sys-100 bg-sys-50/50">
              <h4 className="font-bold text-sys-700 text-sm">Personal Activo ({users.length})</h4>
            </div>
            
            <div className="divide-y divide-sys-100">
              {loading ? (
                <div className="p-8 text-center text-sys-400">Cargando equipo...</div>
              ) : users.length === 0 ? (
                <div className="p-8 text-center text-sys-400">No hay usuarios registrados en la base de datos.</div>
              ) : (
                users.map((u) => (
                  <div key={u.id} className="p-4 flex items-center justify-between group hover:bg-sys-50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center text-white shadow-sm font-bold text-sm",
                        u.role === 'ADMIN' ? "bg-sys-800" : "bg-brand"
                      )}>
                        {u.name?.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-sys-900 text-sm">{u.name}</p>
                        <p className="text-xs text-sys-500 font-mono">{u.email}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <span className={cn(
                        "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border",
                        u.role === 'ADMIN' 
                          ? "bg-sys-100 text-sys-700 border-sys-200" 
                          : "bg-blue-50 text-blue-600 border-blue-100"
                      )}>
                        {u.role === 'ADMIN' ? <span className="flex items-center gap-1"><ShieldCheck size={12}/> Admin</span> : 'Cajero'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

      </div>
    </div>
  );
};