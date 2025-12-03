import React from 'react';
import QRCode from "react-qr-code";
import { X, Printer } from 'lucide-react';

export const TicketModal = ({ isOpen, onClose, sale }) => {
  if (!isOpen || !sale) return null;

  const isFiscal = sale.afip?.status === 'APPROVED';
  
  // ⚙️ CONFIGURACIÓN DE TU NEGOCIO (Actualizado)
  const EMPRESA = {
    nombre: "NOAR POS ARGENTINA",
    razonSocial: "Noar SRL", // Ej: Juan Perez
    cuit: "27-27861293-2", // Tu CUIT real
    direccion: "Av. Tecnológica 123, La Rioja",
    condicionIva: "RESPONSABLE MONOTRIBUTO", // <--- CORREGIDO
    inicio: "01/01/2024"
  };

  const handlePrint = () => {
    window.print();
  };

  const formatAfipDate = (dateStr) => {
    if (!dateStr) return "-";
    if (typeof dateStr === 'string' && dateStr.length === 8) {
      const year = dateStr.slice(0, 4);
      const month = dateStr.slice(4, 6);
      const day = dateStr.slice(6, 8);
      return `${day}/${month}/${year}`;
    }
    try {
      return new Date(dateStr).toLocaleDateString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric'
      });
    } catch (e) { return dateStr; }
  };

  // Lógica para mostrar "-" si el doc es 0
  const docCliente = (!sale.docNro || sale.docNro === "0" || sale.docNro === "00000000") 
    ? "-" 
    : sale.docNro;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/80 backdrop-blur-sm p-4 animate-in fade-in duration-200 print:p-0 print:bg-white print:static">
      
      {/* Contenedor y Header (Igual que antes...) */}
      <div className="bg-sys-100 p-8 rounded-3xl shadow-2xl max-h-[90vh] overflow-y-auto w-full max-w-md print:shadow-none print:p-0 print:max-w-none print:max-h-none print:w-auto print:overflow-visible">
        <div className="flex justify-between items-center mb-6 print:hidden">
          <h3 className="font-bold text-sys-900 text-lg">Vista Previa</h3>
          <div className="flex gap-2">
            <button onClick={handlePrint} className="p-2 bg-brand text-white rounded-full hover:bg-brand-hover transition shadow-lg shadow-brand/20"><Printer size={20} /></button>
            <button onClick={onClose} className="p-2 bg-white text-sys-500 rounded-full hover:bg-sys-200 transition"><X size={20} /></button>
          </div>
        </div>

        {/* TICKET TÉRMICO */}
        <div className="bg-white mx-auto shadow-sm print:shadow-none w-[320px] min-h-[400px] text-sys-900 font-mono text-[11px] leading-tight relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sys-200 to-sys-50 bg-[length:10px_100%]"></div>

          <div className="p-6 pb-10 flex flex-col items-center">
            
            {/* LOGO */}
            <div className="mb-4 flex flex-col items-center gap-2">
               <div className="w-12 h-12 bg-sys-900 rounded-xl flex items-center justify-center relative shadow-lg">
                  <div className="w-6 h-6 border-l-4 border-r-4 border-white/90 skew-x-[-10deg] relative">
                     <div className="absolute top-0 left-0 w-full h-1 bg-white/90"></div>
                     <div className="absolute bottom-0 left-0 w-full h-1 bg-white/90"></div>
                     <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-1 bg-brand rotate-[-45deg]"></div>
                  </div>
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-pos-success rounded-full border-2 border-white"></div>
               </div>
               <h1 className="font-sans font-black text-lg tracking-tight text-sys-900">NOAR<span className="text-brand">POS</span></h1>
            </div>

            {/* DATOS EMPRESA (Dinámicos ahora) */}
            <div className="text-center w-full border-b border-dashed border-sys-300 pb-3 mb-3 space-y-0.5">
              <p className="font-bold text-sm uppercase">{EMPRESA.razonSocial}</p>
              <p>CUIT: {EMPRESA.cuit}</p>
              <p>{EMPRESA.direccion}</p>
              <p className="mt-2 font-bold uppercase">{EMPRESA.condicionIva}</p> 
            </div>

            {/* CABECERA COMPROBANTE */}
            <div className="w-full flex justify-between items-end border-b border-dashed border-sys-300 pb-3 mb-3">
              <div className="text-left">
                {isFiscal ? (
                   <>
                     <p className="font-bold text-base">FACTURA {sale.afip.cbteLetra}</p>
                     <p>N° {String(sale.afip.cbteNumero).padStart(8, '0')}</p>
                   </>
                ) : (
                   <>
                     <p className="font-bold text-base">TIQUE NO FISCAL</p>
                     <p className="text-sys-500 italic">Control Interno</p>
                     <p>ID: {sale.localId.slice(-6)}</p>
                   </>
                )}
              </div>
              <div className="text-right">
                <p>{new Date(sale.date).toLocaleDateString('es-AR')}</p>
                <p>{new Date(sale.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
              </div>
            </div>

            {/* CLIENTE (Limpio) */}
            <div className="w-full text-left mb-4 text-[10px]">
               <p><span className="font-bold">Cliente:</span> CONSUMIDOR FINAL</p>
               <p><span className="font-bold">Doc:</span> {docCliente}</p> 
               <p><span className="font-bold">Pago:</span> {sale.payment.method.toUpperCase()}</p>
            </div>

            {/* ITEMS */}
            <div className="w-full mb-4">
              <div className="flex font-bold border-b border-sys-900 pb-1 mb-1">
                <span className="w-8">CANT</span>
                <span className="flex-1">DESCRIPCIÓN</span>
                <span className="w-16 text-right">TOTAL</span>
              </div>
              <div className="space-y-1">
                {sale.items.map((item, idx) => (
                  <div key={idx} className="flex items-start">
                    <span className="w-8 font-bold">{item.isWeighable ? item.quantity.toFixed(3) : item.quantity}</span>
                    <span className="flex-1 uppercase leading-tight pr-2">{item.name}</span>
                    <span className="w-16 text-right">{item.subtotal.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* TOTALES */}
            <div className="w-full border-t border-dashed border-sys-300 pt-3 space-y-1">
               <div className="flex justify-between font-black text-xl mt-2 border-y border-sys-900 py-2 bg-sys-50 print:bg-transparent">
                 <span>TOTAL</span>
                 <span>$ {sale.total.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
               </div>
            </div>

            {/* FOOTER AFIP */}
            <div className="mt-6 w-full text-center">
               {isFiscal ? (
                 <div className="flex flex-col items-center gap-3">
                    <div className="w-32 h-32 bg-white p-1">
                        {sale.afip.qr && <QRCode value={sale.afip.qr} size={128} style={{ height: "auto", maxWidth: "100%", width: "100%" }} viewBox={`0 0 256 256`} />}
                    </div>
                    <div className="flex items-center gap-2 justify-center w-full">
                       <div className="flex font-sans font-black italic text-lg tracking-tighter text-sys-400"><span className="text-sys-800">A</span>FIP</div>
                       <div className="text-left text-[9px] leading-tight font-sans">
                          <p className="font-bold">Comprobante Autorizado</p>
                       </div>
                    </div>
                    <div className="border border-sys-300 rounded p-2 w-full flex justify-between text-xs font-bold font-sans mt-2">
                       <div className="text-left"><p className="text-[9px] text-sys-500">CAE N°</p><p>{sale.afip.cae}</p></div>
                       <div className="text-right"><p className="text-[9px] text-sys-500">VTO</p><p>{formatAfipDate(sale.afip.vtoCAE)}</p></div>
                    </div>
                 </div>
               ) : (
                 <div className="space-y-2">
                    <p className="font-bold text-xs uppercase">*** No válido como factura ***</p>
                    <p className="font-sans font-bold text-lg mt-2">NOAR<span className="text-brand">POS</span></p>
                 </div>
               )}
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-2 bg-sys-900"></div>
        </div>
        <style>{`@media print { body * { visibility: hidden; } .bg-white.mx-auto.shadow-sm, .bg-white.mx-auto.shadow-sm * { visibility: visible; } .fixed { position: absolute; inset: 0; background: white; } .bg-white.mx-auto.shadow-sm { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; box-shadow: none; } }`}</style>
      </div>
    </div>
  );
};