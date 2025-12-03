import React, { useEffect, useState } from 'react';
import { 
  TrendingUp, TrendingDown, DollarSign, Calendar, 
  User, AlertCircle, CheckCircle2, ChevronRight, Eye 
} from 'lucide-react';
import { shiftRepository } from '../repositories/shiftRepository';
import { Card } from '../../../core/ui/Card';
import { cn } from '../../../core/utils/cn';

export const CashPage = () => {
  const [shifts, setShifts] = useState([]);
  const [selectedShift, setSelectedShift] = useState(null); // Para ver detalle
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);

  // Carga Inicial
  useEffect(() => {
    loadShifts();
  }, []);

  // Carga Detalles al seleccionar
  useEffect(() => {
    if (selectedShift) {
      shiftRepository.getShiftMovements(selectedShift.id).then(setMovements);
    }
  }, [selectedShift]);

  const loadShifts = async () => {
    try {
      const data = await shiftRepository.getAllShifts();
      setShifts(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Helper de Formato
  const money = (val) => val ? `$ ${val.toLocaleString('es-AR', {minimumFractionDigits: 2})}` : '-';
  const time = (date) => new Date(date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  const date = (date) => new Date(date).toLocaleDateString();

  return (
    <div className="h-[calc(100vh-6rem)] flex gap-6">
      
      {/* COLUMNA IZQUIERDA: LISTADO HISTÓRICO */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="mb-6">
          <h2 className="text-2xl font-bold text-sys-900">Cierres de Caja</h2>
          <p className="text-sys-500 text-sm">Auditoría de turnos y flujo de efectivo</p>
        </header>

        {/* Tabla Visual */}
        <div className="flex-1 overflow-y-auto pr-2 no-scrollbar space-y-3 pb-20">
          {shifts.length === 0 && !loading && (
             <div className="p-8 text-center text-sys-400 bg-white rounded-2xl border border-dashed border-sys-200">
                No hay turnos registrados aún.
             </div>
          )}

          {shifts.map((shift) => {
            const isSelected = selectedShift?.id === shift.id;
            const diff = shift.difference || 0;
            const isPerfect = Math.abs(diff) < 10; // Tolerancia $10
            const isOpen = shift.status === 'OPEN';

            return (
              <div 
                key={shift.id}
                onClick={() => setSelectedShift(shift)}
                className={cn(
                  "group relative overflow-hidden bg-white border rounded-xl p-4 transition-all cursor-pointer hover:shadow-md",
                  isSelected ? "border-brand ring-1 ring-brand bg-brand-light/10" : "border-sys-200 hover:border-brand/50",
                  isOpen ? "border-l-4 border-l-blue-500" : (isPerfect ? "border-l-4 border-l-green-500" : "border-l-4 border-l-red-500")
                )}
              >
                <div className="flex justify-between items-start">
                  
                  {/* Info Principal */}
                  <div className="flex gap-4 items-center">
                    <div className={cn(
                      "w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shadow-sm shrink-0",
                      isOpen ? "bg-blue-100 text-blue-600" : "bg-sys-100 text-sys-600"
                    )}>
                      {isOpen ? 'AB' : 'Z'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sys-900 text-lg">
                          {isOpen ? 'Caja Abierta' : `Cierre #${shift.id.slice(-4)}`}
                        </h4>
                        {/* Badge de Estado */}
                        {isOpen ? (
                           <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200 uppercase tracking-wide">Operando</span>
                        ) : (
                           <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide flex items-center gap-1", isPerfect ? "bg-green-100 text-green-700 border border-green-200" : "bg-red-100 text-red-700 border border-red-200")}>
                              {isPerfect ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                              {isPerfect ? 'Cuadrada' : 'Diferencia'}
                           </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-sys-500 mt-1">
                        <span className="flex items-center gap-1"><Calendar size={12}/> {date(shift.openedAt)}</span>
                        <span className="flex items-center gap-1"><User size={12}/> {shift.userId === 'u_admin' ? 'Gerente' : 'Cajero'}</span>
                        <span>{time(shift.openedAt)} - {shift.closedAt ? time(shift.closedAt) : '...'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Totales */}
                  <div className="text-right">
                    <p className="text-xs text-sys-500 uppercase font-bold tracking-wider">Recaudado</p>
                    <p className="text-xl font-black text-sys-900">
                      {isOpen ? 'En curso' : money(shift.finalAmount)}
                    </p>
                    {!isOpen && diff !== 0 && (
                      <p className={cn("text-xs font-bold mt-1", diff > 0 ? "text-green-600" : "text-red-600")}>
                        {diff > 0 ? '+' : ''}{money(diff)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* COLUMNA DERECHA: DETALLE FORENSE (Sticky) */}
      <div className="w-[400px] bg-white rounded-2xl shadow-soft border border-sys-200 flex flex-col overflow-hidden shrink-0">
        {selectedShift ? (
          <>
            <div className="p-6 bg-sys-50 border-b border-sys-200">
               <h3 className="font-bold text-lg text-sys-900 flex items-center gap-2">
                 <Eye size={20} className="text-brand"/> Detalle del Turno
               </h3>
               <p className="text-xs text-sys-500 mt-1">ID: {selectedShift.id}</p>
               
               {/* Resumen Rápido */}
               <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="bg-white p-3 rounded-xl border border-sys-100 shadow-sm">
                     <p className="text-[10px] text-sys-400 font-bold uppercase">Fondo Inicial</p>
                     <p className="text-lg font-bold text-sys-900">{money(selectedShift.initialAmount)}</p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-sys-100 shadow-sm">
                     <p className="text-[10px] text-sys-400 font-bold uppercase">Ventas Sistema</p>
                     <p className="text-lg font-bold text-sys-900">
                        {/* Si tenemos stats, usamos eso, sino calculamos al vuelo o mostramos placeholder */}
                        {money(selectedShift.stats?.expectedTotal || 0)}
                     </p>
                  </div>
               </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-sys-50/30">
               <h4 className="text-xs font-bold text-sys-400 uppercase tracking-widest ml-1">Línea de Tiempo</h4>
               
               <div className="relative pl-4 space-y-6">
                  {/* Línea conectora */}
                  <div className="absolute left-[19px] top-2 bottom-2 w-0.5 bg-sys-200"></div>

                  {movements.map((mov) => {
                    // Estilos según tipo
                    let icon = DollarSign;
                    let color = "text-sys-600 bg-white border-sys-300";
                    
                    if (mov.type === 'OPENING') { color = "text-blue-600 bg-blue-50 border-blue-200"; }
                    if (mov.type === 'WITHDRAWAL') { icon = TrendingDown; color = "text-red-600 bg-red-50 border-red-200"; }
                    if (mov.type === 'DEPOSIT') { icon = TrendingUp; color = "text-green-600 bg-green-50 border-green-200"; }
                    if (mov.type === 'CLOSING') { color = "text-purple-600 bg-purple-50 border-purple-200"; }

                    return (
                      <div key={mov.id} className="relative flex gap-3">
                         <div className={cn("relative z-10 w-10 h-10 rounded-full border-2 flex items-center justify-center shadow-sm shrink-0", color)}>
                            {React.createElement(icon, {size: 16})}
                         </div>
                         <div className="flex-1 bg-white p-3 rounded-xl border border-sys-200 shadow-sm">
                            <div className="flex justify-between items-start">
                               <p className="text-xs font-bold text-sys-800">{mov.description || mov.type}</p>
                               <span className="text-[10px] text-sys-400 font-mono">{time(mov.date)}</span>
                            </div>
                            <div className="mt-1 flex justify-between items-end">
                               <p className="text-[10px] text-sys-500">Por: <span className="font-medium">{mov.userId === 'u_admin' ? 'Gerente' : 'Cajero'}</span></p>
                               {mov.amount && (
                                 <p className={cn("font-bold text-sm", mov.type === 'WITHDRAWAL' ? 'text-red-600' : 'text-green-600')}>
                                    {mov.type === 'WITHDRAWAL' ? '-' : '+'}{money(Math.abs(mov.amount))}
                                 </p>
                               )}
                            </div>
                         </div>
                      </div>
                    );
                  })}
               </div>
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-sys-400 p-8 text-center">
             <div className="w-20 h-20 bg-sys-50 rounded-full flex items-center justify-center mb-4">
                <TrendingUp size={32} className="opacity-20" />
             </div>
             <p className="font-medium">Selecciona un turno</p>
             <p className="text-sm opacity-60 mt-2">Verás el desglose completo de movimientos y auditoría.</p>
          </div>
        )}
      </div>
    </div>
  );
};