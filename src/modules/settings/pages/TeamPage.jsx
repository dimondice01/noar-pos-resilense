import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Shield, ShieldCheck, Mail, Lock, Info, Building2, Store } from 'lucide-react';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { authService } from '../../auth/services/authService';
import { collection, getDocs, query, where, updateDoc } from 'firebase/firestore'; 
import { db } from '../../../database/firebase';
import { cn } from '../../../core/utils/cn';
import { useAuthStore } from '../../auth/store/useAuthStore'; 

export const TeamPage = () => {
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]); // Lista de sucursales
  const [loading, setLoading] = useState(true);
  
  const currentUser = useAuthStore(state => state.user);

  // Formulario Nuevo Usuario
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({ 
      name: '', 
      email: '', 
      password: '', 
      role: 'CAJERO',
      branchId: '' // Campo crítico para Multi-Branch
  });

  // Cargar Usuarios y Sucursales
  useEffect(() => {
    if (currentUser?.companyId) {
        loadData();
    }
  }, [currentUser]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // 1. Cargar Usuarios
      const usersQuery = query(
          collection(db, 'users'), 
          where('companyId', '==', currentUser.companyId)
      );
      
      // 2. Cargar Sucursales (Para el picker)
      const branchesQuery = query(
          collection(db, 'companies', currentUser.companyId, 'branches')
      );
      
      const [usersSnap, branchesSnap] = await Promise.all([
          getDocs(usersQuery),
          getDocs(branchesQuery)
      ]);

      setUsers(usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setBranches(branchesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

    } catch (error) {
      console.error("Error cargando equipo/sucursales:", error);
    } finally {
      setLoading(false);
    }
  };

  const getBranchName = (branchId) => {
      if (!branchId) return 'Global / Sin Asignar';
      const b = branches.find(br => br.id === branchId);
      return b ? b.name : 'Sucursal Desconocida';
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (formData.password.length < 6) return alert("La contraseña debe tener 6 caracteres mínimo.");
    if (!currentUser?.companyId) return alert("Error crítico: No tienes empresa asignada.");
    
    // Validación estricta para Cajeros
    if (formData.role === 'CAJERO' && !formData.branchId) {
        return alert("⚠️ Atención: Un CAJERO debe tener una sucursal asignada obligatoriamente.");
    }

    setIsCreating(true);
    try {
      const newEmployeeData = {
          ...formData,
          companyId: currentUser.companyId, 
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          // Si es Admin y no eligió sucursal, puede ser null (Acceso Global)
          branchId: formData.branchId || null 
      };

      // 1. Crear usuario (Auth + Doc base vía Backend)
      await authService.createUser(newEmployeeData);
      
      // 2. 🔥 FORCE UPDATE: Garantizar que el branchId se guarde
      // FIX DE SEGURIDAD: Debemos buscar por Email Y por CompanyId para satisfacer las reglas
      const q = query(
          collection(db, 'users'), 
          where('email', '==', formData.email),
          where('companyId', '==', currentUser.companyId) // 🔥 ESTO FALTABA
      );
      
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
          const userDoc = querySnapshot.docs[0];
          await updateDoc(userDoc.ref, {
              branchId: formData.branchId || null,
              role: formData.role
          });
          // console.log("✅ Branch ID inyectado correctamente:", formData.branchId);
      }

      alert(`✅ Usuario ${formData.name} creado exitosamente.`);
      setFormData({ name: '', email: '', password: '', role: 'CAJERO', branchId: '' }); 
      loadData(); 
    } catch (error) {
      console.error(error);
      alert(`❌ Error: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20 px-4">
      
      <header className="flex justify-between items-center">
        <div>
            <h2 className="text-2xl font-bold text-sys-900 flex items-center gap-2">
            <Users className="text-brand" /> Gestión de Equipo
            </h2>
            <p className="text-sys-500">Administra el acceso y asignación de sucursales.</p>
        </div>
        <div className="bg-sys-100 text-sys-600 px-3 py-1 rounded-full text-xs font-mono border border-sys-200 hidden md:block">
            Empresa ID: {currentUser?.companyId}
        </div>
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

              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1">Rol</label>
                    <div className="flex flex-col gap-2 mt-1">
                      {['CAJERO', 'ADMIN'].map((role) => (
                        <button
                          key={role}
                          type="button"
                          onClick={() => setFormData({...formData, role})}
                          className={cn(
                            "py-2 rounded-lg text-xs font-bold transition-all border flex items-center justify-center gap-2",
                            formData.role === role 
                              ? "bg-brand text-white border-brand shadow-md" 
                              : "bg-white text-sys-500 border-sys-200 hover:bg-sys-50"
                          )}
                        >
                          {role === 'ADMIN' ? <ShieldCheck size={14}/> : <UserPlus size={14}/>} {role}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-sys-500 uppercase tracking-wider ml-1">Sucursal</label>
                    <div className="relative mt-1">
                        <Store size={16} className="absolute left-3 top-3 text-sys-400 pointer-events-none" />
                        <select 
                            className={cn(
                                "w-full bg-sys-50 border border-sys-200 rounded-xl pl-9 pr-2 py-2.5 text-xs outline-none focus:border-brand transition-all appearance-none cursor-pointer font-medium text-sys-700",
                                !formData.branchId && formData.role === 'CAJERO' && "border-red-300 bg-red-50"
                            )}
                            value={formData.branchId}
                            onChange={(e) => setFormData({...formData, branchId: e.target.value})}
                            required={formData.role === 'CAJERO'}
                        >
                            <option value="">Seleccionar...</option>
                            {branches.map(b => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                        </select>
                        <div className="absolute right-3 top-3 pointer-events-none">
                            <svg className="w-4 h-4 text-sys-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                        </div>
                    </div>
                    {formData.role === 'CAJERO' && !formData.branchId && (
                        <p className="text-[10px] text-red-500 mt-1 font-bold">* Requerido para Cajero</p>
                    )}
                  </div>
              </div>

              <div className="bg-blue-50 p-3 rounded-lg flex gap-2 items-start mt-2">
                  <Info size={16} className="text-blue-600 mt-0.5 shrink-0"/>
                  <p className="text-[11px] text-blue-700 leading-tight">
                      {formData.role === 'ADMIN' && !formData.branchId 
                        ? "Admin Global: Tendrá acceso a todas las sucursales." 
                        : `Usuario asignado a: ${formData.branchId ? getBranchName(formData.branchId) : 'Sin asignar'}`}
                  </p>
              </div>

              <Button type="submit" className="w-full mt-4 h-12 shadow-md" disabled={isCreating}>
                {isCreating ? 'Procesando...' : 'Dar de Alta'}
              </Button>
            </form>
          </Card>
        </div>

        {/* COLUMNA DERECHA: Lista de Usuarios */}
        <div className="lg:col-span-2">
          <Card className="p-0 overflow-hidden">
            <div className="p-4 border-b border-sys-100 bg-sys-50/50 flex justify-between items-center">
              <h4 className="font-bold text-sys-700 text-sm">Personal Activo ({users.length})</h4>
              {branches.length === 0 && <span className="text-xs text-red-500 font-bold">⚠️ Crea sucursales primero</span>}
            </div>
            
            <div className="divide-y divide-sys-100">
              {loading ? (
                <div className="p-10 text-center flex flex-col items-center gap-2">
                    <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-xs text-sys-400">Cargando equipo...</span>
                </div>
              ) : users.length === 0 ? (
                <div className="p-8 text-center text-sys-400 italic">No hay usuarios registrados.</div>
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
                    
                    <div className="flex flex-col items-end gap-1">
                      <span className={cn(
                        "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border inline-flex items-center gap-1",
                        u.role === 'ADMIN' 
                          ? "bg-sys-100 text-sys-700 border-sys-200" 
                          : "bg-blue-50 text-blue-600 border-blue-100"
                      )}>
                        {u.role === 'ADMIN' ? <ShieldCheck size={12}/> : <Building2 size={12}/>}
                        {u.role}
                      </span>
                      
                      <span className="text-[10px] text-sys-400 font-medium flex items-center gap-1">
                          <Store size={10}/>
                          {getBranchName(u.branchId)}
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