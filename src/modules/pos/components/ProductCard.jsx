import React from 'react';
import { Card } from '../../../core/ui/Card';
import { cn } from '../../../core/utils/cn';
import { Scale, Image as ImageIcon } from 'lucide-react';

export const ProductCard = ({ product, onClick }) => {
  
  // 🔥 Helper de formateo (Igual que en PosPage)
  const formatPrice = (price) => {
    return price.toLocaleString('es-AR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
  };

  return (
    <Card 
      onClick={() => onClick(product)}
      className={cn(
        "cursor-pointer group relative overflow-hidden p-0 border-0 shadow-sm hover:shadow-float hover:-translate-y-1 transition-all duration-300 h-48 flex flex-col"
      )}
    >
      {/* 1. Área de Imagen (Simulada) - Parte Superior */}
      <div className="h-28 bg-sys-50 flex items-center justify-center relative group-hover:bg-sys-100 transition-colors">
        {/* Icono Central */}
        <div className="text-sys-300 group-hover:text-brand/60 transition-colors">
            {product.isWeighable ? <Scale size={40} strokeWidth={1.5} /> : <ImageIcon size={40} strokeWidth={1.5} />}
        </div>
        
        {/* Badge de Tipo (Flotante) */}
        <div className="absolute top-2 right-2">
           <span className={cn(
             "text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider border",
             product.isWeighable 
               ? "bg-orange-50 text-orange-600 border-orange-100" 
               : "bg-blue-50 text-brand border-blue-100"
           )}>
             {product.isWeighable ? 'Balanza' : 'Unidad'}
           </span>
        </div>
      </div>

      {/* 2. Información - Parte Inferior */}
      <div className="p-3 flex-1 flex flex-col justify-between bg-white">
        <div>
          <h3 className="font-semibold text-sys-800 text-sm leading-tight line-clamp-2 group-hover:text-brand transition-colors">
            {product.name}
          </h3>
          <p className="text-[10px] text-sys-400 mt-1 font-mono tracking-wide">
            #{product.code}
          </p>
        </div>

        <div className="mt-2 flex items-baseline justify-between">
            {/* 🔥 PRECIO FORMATEADO SIN DECIMALES EXTRA */}
            <span className="text-lg font-bold text-sys-900">
                $ {formatPrice(product.price)}
            </span>
            <span className="text-xs text-sys-400">
                {product.isWeighable ? '/kg' : ' un'}
            </span>
        </div>
      </div>
    </Card>
  );
};