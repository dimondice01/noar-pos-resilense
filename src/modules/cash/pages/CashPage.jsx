import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, TrendingUp, TrendingDown, RefreshCcw, Lock, Unlock, FileText, ArrowDownLeft, ArrowUpRight, DollarSign, CreditCard } from 'lucide-react';
import { cashRepository } from '../repositories/cashRepository';
import { useAuthStore } from '../../auth/store/useAuthStore'; // ✅ Auth
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import { CashClosingModal } from '../components/CashClosingModal';

export const CashPage = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  
  const [shift, setShift] = useState(null);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);

  // 🛡️ SEGURIDAD: Solo ADMIN
  useEffect(() => {
      if (user?.role !== 'ADMIN') {
          navigate('/'); 
      }
  }, [user, navigate]);

  const loadData = async () => {
    setLoading(true);
    try {
        const currentShift = await cashRepository.getCurrentShift();
        setShift(currentShift);
        
        if (currentShift) {
            const bal = await cashRepository.getShiftBalance(currentShift.id);
            setBalance(bal);
        } else {
            setBalance(null);
        }
    } catch (error) {
        console.error("Error cargando caja:", error);
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleOpenShift = async () => {
      const input = prompt("Monto inicial en caja (Fondo de Cambio):", "0");
      if (input === null) return;
      
      const amount = parseFloat(input);
      if (isNaN(amount) || amount < 0) return alert("Monto inválido");

      try {
          await cashRepository.openShift(amount, user?.name);
          await loadData();
      } catch (error) {
          alert("Error al abrir caja: " + error.message);
      }
  };

  const handleCloseConfirm = async (closingData) => {
      try {
          await cashRepository.closeShift(shift.id, {
              ...closingData,
              expectedCash: balance.totalCash,
              expectedDigital: balance.totalDigital
          });
          
          alert(`✅ CAJA CERRADA\n\nDiferencia: $${closingData.difference.toLocaleString()}\n(Visible solo para Admin)`);
          setIsClosingModalOpen(false);
          loadData(); 
      } catch (error) {
          alert("Error al cerrar: " + error.message);
      }
  };

  // Evitar renderizado si no es admin
  if (user?.role !== 'ADMIN') return null;

  if (loading) return <div className="p-10 text-center text-sys-500">Cargando tesorería...</div>;

  // MODO CAJA CERRADA
  if (!shift) {
      return (
          <div className="h-[80vh] flex flex-col items-center justify-center text-center space-y-6 animate-in fade-in">
              <div className="w-24 h-24 bg-sys-100 rounded-full flex items-center justify-center text-sys-400 shadow-inner">
                  <Lock size={48} />
              </div>
              <div>
                  <h2 className="text-2xl font-bold text-sys-900">Caja Cerrada</h2>
                  <p className="text-sys-500">Inicie un turno para comenzar a operar.</p>
              </div>
              <Button onClick={handleOpenShift} className="px-8 py-3 text-lg shadow-xl shadow-brand/20">
                  <Unlock size={20} className="mr-2"/> Abrir Caja
              </Button>
          </div>
      );
  }

  // MODO CAJA ABIERTA (Con seguridad null-check)
  if (!balance) return <div className="p-10 text-center">Calculando balance...</div>;

  return (
    <div className="space-y-6 pb-20 animate-in fade-in">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
             <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase border border-green-200 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span> Turno Activo
             </span>
             <span className="text-xs text-sys-400 font-mono">ID: {shift.id.slice(-6)}</span>
          </div>
          <h2 className="text-2xl font-bold text-sys-900">Control de Caja</h2>
          <p className="text-sys-500 text-sm">Responsable: {shift.userId}</p>
        </div>
        <Button 
            onClick={() => setIsClosingModalOpen(true)}
            className="bg-sys-900 hover:bg-black text-white shadow-lg border border-sys-700"
        >
            <Lock size={18} className="mr-2" /> Realizar Cierre Z
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          
          <Card className="bg-gradient-to-br from-sys-800 to-sys-900 text-white border-none shadow-lg">
              <div className="flex items-center gap-2 mb-1 opacity-80">
                  <DollarSign size={14}/>
                  <p className="text-xs uppercase font-bold">Efectivo Sistema</p>
              </div>
              <p className="text-3xl font-black tracking-tight">$ {balance.totalCash.toLocaleString()}</p>
              <p className="text-[10px] opacity-60 mt-1">Debería haber en cajón</p>
          </Card>
          
          <Card className="bg-white border border-sys-200">
              <div className="flex items-center gap-2 mb-1 text-sys-500">
                  <CreditCard size={14}/>
                  <p className="text-xs uppercase font-bold">Total Digital</p>
              </div>
              <p className="text-3xl font-black text-sys-900 tracking-tight">$ {balance.totalDigital.toLocaleString()}</p>
              <p className="text-[10px] text-sys-400 mt-1">MP + Tarjetas + Transf.</p>
          </Card>

          <Card className="bg-green-50 border-green-100">
              <p className="text-xs text-green-700 uppercase font-bold mb-2 flex items-center gap-1"><ArrowDownLeft size={14}/> Ingresos (Efectivo)</p>
              <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                      <span className="text-green-800">Ventas</span>
                      <span className="font-bold text-green-900">$ {balance.salesCash.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm border-t border-green-200 pt-1">
                      <span className="text-green-800">Cobranzas</span>
                      <span className="font-bold text-green-900">$ {balance.collections.toLocaleString()}</span>
                  </div>
              </div>
          </Card>

          <Card className="bg-red-50 border-red-100">
              <p className="text-xs text-red-700 uppercase font-bold mb-2 flex items-center gap-1"><ArrowUpRight size={14}/> Egresos (Caja)</p>
              <div className="flex justify-between items-end h-full pb-1">
                  <span className="text-sm text-red-800">Gastos / Retiros</span>
                  <span className="text-2xl font-bold text-red-900">$ {balance.withdrawals.toLocaleString()}</span>
              </div>
          </Card>
      </div>

      {/* Tabla de Movimientos */}
      <Card className="p-0 overflow-hidden border border-sys-200 shadow-sm">
          <div className="p-4 border-b border-sys-100 bg-sys-50 flex justify-between items-center">
              <h3 className="font-bold text-sys-800 flex items-center gap-2">
                  <FileText size={18} className="text-sys-400"/>
                  Auditoría de Movimientos
              </h3>
              <span className="text-xs text-sys-500 bg-white px-2 py-1 rounded border font-mono">
                  {balance.movements.length} regs
              </span>
          </div>
          <div className="overflow-x-auto max-h-[400px]">
              <table className="w-full text-left text-sm">
                  <thead className="bg-white text-sys-500 text-xs uppercase font-semibold sticky top-0 z-10 shadow-sm">
                      <tr>
                          <th className="p-3 pl-4">Hora</th>
                          <th className="p-3">Concepto</th>
                          <th className="p-3">Método</th>
                          <th className="p-3 text-right">Entrada</th>
                          <th className="p-3 text-right pr-4">Salida</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-sys-100">
                      {/* Fondo Inicial */}
                      <tr className="bg-sys-50/50">
                          <td className="p-3 pl-4 font-mono text-sys-400">{new Date(shift.openedAt).toLocaleTimeString()}</td>
                          <td className="p-3 font-bold text-sys-700">Fondo Inicial</td>
                          <td className="p-3 text-xs uppercase text-sys-500">Inicio</td>
                          <td className="p-3 text-right font-mono text-green-600 font-bold">$ {balance.initialAmount.toLocaleString()}</td>
                          <td className="p-3 text-right font-mono text-sys-300 pr-4">-</td>
                      </tr>

                      {/* Movimientos */}
                      {balance.movements.map(m => (
                          <tr key={m.id || Math.random()} className="hover:bg-sys-50 transition-colors">
                              <td className="p-3 pl-4 font-mono text-sys-600">{new Date(m.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
                              <td className="p-3">
                                  <p className="font-medium text-sys-800">{m.description}</p>
                                  {m.referenceId && <p className="text-[10px] text-sys-400 font-mono">Ref: {m.referenceId.slice(-6)}</p>}
                              </td>
                              <td className="p-3">
                                  <span className={cn("px-2 py-0.5 rounded text-[10px] uppercase font-bold border", 
                                      m.method === 'cash' ? "bg-green-50 text-green-700 border-green-100" : 
                                      "bg-blue-50 text-blue-700 border-blue-100")}>
                                      {m.method}
                                  </span>
                              </td>
                              <td className="p-3 text-right font-mono font-medium text-green-600">
                                  {m.type === 'DEPOSIT' ? `$ ${m.amount.toLocaleString()}` : '-'}
                              </td>
                              <td className="p-3 text-right font-mono font-medium text-red-600 pr-4">
                                  {m.type === 'WITHDRAWAL' ? `$ ${m.amount.toLocaleString()}` : '-'}
                              </td>
                          </tr>
                      ))}
                  </tbody>
              </table>
          </div>
      </Card>

      <CashClosingModal 
        isOpen={isClosingModalOpen}
        onClose={() => setIsClosingModalOpen(false)}
        systemTotals={{ 
            totalCash: balance.totalCash, 
            totalDigital: balance.totalDigital 
        }} 
        onConfirm={handleCloseConfirm}
      />

    </div>
  );
};