import React, { useEffect, useState } from 'react';
import { X, History, TrendingUp, TrendingDown, Package, Edit, DollarSign, Tag } from 'lucide-react';
import { productRepository } from '../repositories/productRepository';
import { cn } from '../../../core/utils/cn';

export const ProductHistoryModal = ({ isOpen, onClose, product }) => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  // Cargar historial al abrir
  useEffect(() => {
    if (isOpen && product) {
      setLoading(true);
      // Llamamos al nuevo método del repositorio
      productRepository.getHistory(product.id)
        .then(data => {
          // Ordenamos: más reciente arriba
          const sorted = data.sort((a, b) => new Date(b.date) - new Date(a.date));
          setHistory(sorted);
        })
        .catch(err => console.error(err))
        .finally(() => setLoading(false));
    }
  }, [isOpen, product]);

  if (!isOpen || !product) return null;

  // Helper para elegir icono y color según el tipo de movimiento
  const getIconData = (type) => {
    switch (type) {
        case 'PRICE_CHANGE': 
            return { icon: DollarSign, color: "text-blue-600", bg: "bg-blue-100", border: "border-blue-200" };
        case 'COST_CHANGE': 
            return { icon: Tag, color: "text-orange-600", bg: "bg-orange-100", border: "border-orange-200" };
        case 'STOCK_IN': 
        case 'STOCK_ADJUST_IN': 
            return { icon: TrendingUp, color: "text-green-600", bg: "bg-green-100", border: "border-green-200" };
        case 'STOCK_OUT': // Venta (Próximamente)
        case 'STOCK_ADJUST_OUT': 
            return { icon: TrendingDown, color: "text-red-600", bg: "bg-red-100", border: "border-red-200" };
        case 'CREATION': 
            return { icon: Package, color: "text-purple-600", bg: "bg-purple-100", border: "border-purple-200" };
        default: 
            return { icon: Edit, color: "text-sys-600", bg: "bg-sys-100", border: "border-sys-200" };
    }
  };

  const formatType = (type) => {
      const map = {
          'PRICE_CHANGE': 'Cambio de Precio',
          'COST_CHANGE': 'Cambio de Costo',
          'STOCK_IN': 'Ingreso Inicial',
          'STOCK_ADJUST_IN': 'Ajuste Stock (+)',
          'STOCK_ADJUST_OUT': 'Ajuste Stock (-)',
          'CREATION': 'Producto Creado'
      };
      return map[type] || type.replace(/_/g, ' ');
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95 duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh]">
        
        {/* Header */}
        <div className="p-5 border-b border-sys-100 bg-white z-10 flex justify-between items-center">
           <div>
              <h3 className="font-bold text-lg text-sys-900 flex items-center gap-2">
                 <History size={20} className="text-brand" /> Historial de Movimientos
              </h3>
              <p className="text-xs text-sys-500 font-medium mt-0.5 text-ellipsis overflow-hidden whitespace-nowrap max-w-[250px]">
                {product.name}
              </p>
           </div>
           <button onClick={onClose} className="p-2 hover:bg-sys-100 rounded-full text-sys-500 transition-colors">
             <X size={20} />
           </button>
        </div>

        {/* Timeline Scrollable */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-sys-50/50 p-6 relative">
            
            {loading ? (
                <div className="flex flex-col items-center justify-center h-40 text-sys-400">
                    <div className="animate-spin rounded-full h-8 w-8 border-4 border-sys-200 border-t-brand mb-3"></div>
                    <p className="text-xs">Consultando bitácora...</p>
                </div>
            ) : history.length === 0 ? (
                <div className="text-center py-10 text-sys-400">
                    <History size={48} className="mx-auto mb-3 opacity-20" />
                    <p className="text-sm">No hay movimientos registrados.</p>
                    <p className="text-xs mt-1 opacity-70">Los cambios futuros aparecerán aquí.</p>
                </div>
            ) : (
                <div className="relative pl-4">
                    {/* Línea vertical conectora (Eje de tiempo) */}
                    <div className="absolute left-[19px] top-2 bottom-4 w-[2px] bg-sys-200"></div>

                    {history.map((mov, idx) => {
                        const style = getIconData(mov.type);
                        const Icon = style.icon;
                        
                        return (
                            <div key={idx} className="relative flex items-start gap-4 mb-6 group last:mb-0">
                                {/* Icono Bubble */}
                                <div className={cn(
                                    "relative z-10 w-10 h-10 rounded-full flex items-center justify-center border-2 shrink-0 shadow-sm transition-transform group-hover:scale-110",
                                    style.bg, style.border, style.color
                                )}>
                                    <Icon size={18} />
                                </div>
                                
                                {/* Tarjeta de Detalle */}
                                <div className="flex-1 bg-white p-3 rounded-xl border border-sys-200 shadow-sm group-hover:shadow-md group-hover:border-sys-300 transition-all">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className={cn("text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-sys-100", style.color)}>
                                            {formatType(mov.type)}
                                        </span>
                                        <span className="text-[10px] text-sys-400 font-mono whitespace-nowrap ml-2">
                                            {new Date(mov.date).toLocaleDateString()} {new Date(mov.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                        </span>
                                    </div>
                                    
                                    <p className="text-sm text-sys-700 font-medium leading-relaxed">
                                        {mov.description}
                                    </p>
                                    
                                    <div className="mt-2 flex items-center justify-between pt-2 border-t border-sys-50">
                                        <span className="text-[10px] text-sys-400 flex items-center gap-1">
                                            User: <span className="font-bold text-sys-600">{mov.user || 'Sistema'}</span>
                                        </span>
                                        {mov.amount && (
                                            <span className={cn("text-xs font-bold", mov.amount > 0 ? "text-green-600" : "text-red-600")}>
                                                {mov.amount > 0 ? '+' : ''}{mov.amount}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
      </div>
    </div>
  );
};