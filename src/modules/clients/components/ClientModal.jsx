import React, { useState, useEffect } from 'react';
import { X, User, FileText, MapPin, Mail, Save, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

// --- Helpers de UI (Locales para mantener modularidad por ahora) ---
const PremiumInput = ({ label, icon: Icon, error, className, ...props }) => (
  <div className="group">
    <label className="block text-[11px] font-bold text-sys-500 uppercase tracking-wider mb-1.5 ml-1 transition-colors group-focus-within:text-brand">
      {label}
    </label>
    <div className="relative">
      {Icon && (
        <div className={cn("absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors pointer-events-none z-10", error ? "text-red-400" : "text-sys-400 group-focus-within:text-brand")}>
          <Icon size={18} />
        </div>
      )}
      <input 
        className={cn(
          "w-full bg-sys-50 border text-sys-900 rounded-xl py-3 text-sm font-medium outline-none transition-all duration-200 placeholder:text-sys-400",
          Icon ? "pl-11 pr-4" : "px-4",
          error 
            ? "border-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-500/10" 
            : "border-sys-200 focus:bg-white focus:border-brand focus:ring-4 focus:ring-brand/10 focus:shadow-sm",
          className
        )}
        {...props}
      />
    </div>
    {error && <p className="text-[10px] text-red-500 font-medium mt-1 ml-1 flex items-center gap-1"><AlertCircle size={10}/> {error}</p>}
  </div>
);

// --- Algoritmo de Validación CUIT (Argentina) ---
const isValidCUIT = (cuit) => {
  if (!cuit || cuit.length !== 11) return false;
  const multipliers = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let total = 0;
  for (let i = 0; i < 10; i++) total += parseInt(cuit[i]) * multipliers[i];
  let mod = total % 11;
  let digit = mod === 0 ? 0 : mod === 1 ? 9 : 11 - mod;
  return digit === parseInt(cuit[10]);
};

export const ClientModal = ({ isOpen, onClose, clientToEdit, onSave }) => {
  const [formData, setFormData] = useState({
    name: '',
    docType: '80', // 80=CUIT, 96=DNI
    docNumber: '',
    fiscalCondition: 'MONOTRIBUTO',
    address: '',
    email: ''
  });
  
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (isOpen) {
      if (clientToEdit) {
        setFormData(clientToEdit);
      } else {
        setFormData({ name: '', docType: '80', docNumber: '', fiscalCondition: 'MONOTRIBUTO', address: '', email: '' });
      }
      setErrors({});
    }
  }, [isOpen, clientToEdit]);

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = "Requerido";
    
    // Validación Fiscal Estricta
    const cleanDoc = formData.docNumber.replace(/\D/g, '');
    if (!cleanDoc) newErrors.docNumber = "Requerido";
    else if (formData.docType === '80') { // Si es CUIT
        if (cleanDoc.length !== 11) newErrors.docNumber = "Debe tener 11 dígitos";
        else if (!isValidCUIT(cleanDoc)) newErrors.docNumber = "CUIT Inválido (Error de dígito verificador)";
    } else { // Si es DNI
        if (cleanDoc.length < 7 || cleanDoc.length > 8) newErrors.docNumber = "DNI Inválido";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    onSave({
        ...formData,
        docNumber: formData.docNumber.replace(/\D/g, '') // Guardamos limpio
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95 duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-5 border-b border-sys-100 bg-white">
          <div>
             <h3 className="font-bold text-xl text-sys-900 tracking-tight">
               {clientToEdit ? 'Editar Cliente' : 'Nuevo Cliente'}
             </h3>
             <p className="text-xs text-sys-500 font-medium">Datos para facturación AFIP</p>
          </div>
          <button onClick={onClose} className="p-2 bg-sys-50 hover:bg-sys-100 rounded-full text-sys-500 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
            
            {/* Razón Social */}
            <PremiumInput 
                label="Nombre / Razón Social" icon={User} autoFocus
                placeholder="Ej: Juan Pérez"
                value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                error={errors.name}
            />

            {/* Documento (Grid) */}
            <div className="grid grid-cols-3 gap-4">
                <div className="col-span-1">
                    <label className="block text-[11px] font-bold text-sys-500 uppercase tracking-wider mb-1.5 ml-1">Tipo Doc.</label>
                    <select 
                        className="w-full bg-sys-50 border border-sys-200 text-sys-900 rounded-xl py-3 px-3 text-sm font-medium outline-none focus:border-brand"
                        value={formData.docType}
                        onChange={e => setFormData({...formData, docType: e.target.value})}
                    >
                        <option value="80">CUIT (80)</option>
                        <option value="96">DNI (96)</option>
                    </select>
                </div>
                <div className="col-span-2">
                    <PremiumInput 
                        label="Número (Sin guiones)" icon={FileText}
                        placeholder={formData.docType === '80' ? "20123456789" : "12345678"}
                        value={formData.docNumber} 
                        onChange={e => setFormData({...formData, docNumber: e.target.value})}
                        error={errors.docNumber}
                        maxLength={11}
                    />
                </div>
            </div>

            {/* Condición Fiscal */}
            <div>
                <label className="block text-[11px] font-bold text-sys-500 uppercase tracking-wider mb-1.5 ml-1">Condición Fiscal</label>
                <select 
                    className="w-full bg-sys-50 border border-sys-200 text-sys-900 rounded-xl py-3 px-3 text-sm font-medium outline-none focus:border-brand"
                    value={formData.fiscalCondition}
                    onChange={e => setFormData({...formData, fiscalCondition: e.target.value})}
                >
                    <option value="CONSUMIDOR_FINAL">Consumidor Final</option>
                    <option value="MONOTRIBUTO">Responsable Monotributo</option>
                    <option value="RESPONSABLE_INSCRIPTO">Responsable Inscripto</option>
                    <option value="EXENTO">Exento</option>
                </select>
            </div>

            {/* Datos de Contacto */}
            <PremiumInput 
                label="Dirección (Opcional)" icon={MapPin} placeholder="Calle Falsa 123"
                value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})}
            />
            
            <PremiumInput 
                label="Email (Para envío de FC)" icon={Mail} placeholder="cliente@email.com"
                value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})}
            />

        </form>

        {/* Footer */}
        <div className="p-5 border-t border-sys-100 bg-sys-50/50 flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose} className="text-sys-600">Cancelar</Button>
            <Button onClick={handleSubmit} className="px-8 shadow-lg shadow-brand/20">
                <Save size={18} className="mr-2" /> Guardar Cliente
            </Button>
        </div>
      </div>
    </div>
  );
};