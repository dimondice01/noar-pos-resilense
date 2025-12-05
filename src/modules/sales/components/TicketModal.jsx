import React from 'react';
import QRCode from "react-qr-code";
import { X, Printer } from 'lucide-react';

export const TicketModal = ({ isOpen, onClose, sale, receipt }) => {
  // Aceptamos 'sale' (Venta) o 'receipt' (Recibo de Cobranza)
  const data = sale || receipt;
  
  if (!isOpen || !data) return null;

  const isSale = !!sale;
  const isFiscal = isSale && sale.afip?.status === 'APPROVED';
  
  // ⚙️ CONFIGURACIÓN DE TU NEGOCIO
  const EMPRESA = {
    nombre: "NOAR POS ARGENTINA",
    razonSocial: "Noar SRL", 
    cuit: "27-27861293-2", 
    direccion: "Av. Tecnológica 123, La Rioja",
    condicionIva: "RESPONSABLE MONOTRIBUTO", 
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

  // 🔥 LÓGICA DE CLIENTE CORREGIDA Y UNIFICADA 🔥
  const clientData = data.client || { name: 'CONSUMIDOR FINAL', docNumber: '0', docType: '99' };
  
  const docLabel = clientData.docType === '80' ? 'CUIT' : clientData.docType === '96' ? 'DNI' : 'Doc';
  const docValue = (clientData.docNumber && clientData.docNumber !== '0') ? clientData.docNumber : '-';
  const condFiscal = clientData.fiscalCondition ? clientData.fiscalCondition.replace(/_/g, ' ') : 'CONSUMIDOR FINAL';

  // TIPO DE COMPROBANTE
  let tipoComprobante = "TIQUE NO FISCAL";
  let letra = "X";
  
  if (isSale && isFiscal) {
      tipoComprobante = "FACTURA";
      letra = sale.afip.cbteLetra;
  } else if (!isSale) {
      tipoComprobante = "RECIBO DE COBRO"; // Es un recibo de deuda
      letra = "X";
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/80 backdrop-blur-sm p-4 animate-in fade-in duration-200 print:p-0 print:bg-white print:static">
      
      {/* Contenedor */}
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
               <h1 className="font-sans font-black text-lg tracking-tight text-sys-900">NOAR<span className="text-brand">POS</span></h1>
            </div>

            {/* DATOS EMPRESA */}
            <div className="text-center w-full border-b border-dashed border-sys-300 pb-3 mb-3 space-y-0.5">
              <p className="font-bold text-sm uppercase">{EMPRESA.razonSocial}</p>
              <p>CUIT: {EMPRESA.cuit}</p>
              <p>{EMPRESA.direccion}</p>
              <p className="mt-2 font-bold uppercase">{EMPRESA.condicionIva}</p> 
            </div>

            {/* CABECERA COMPROBANTE */}
            <div className="w-full flex justify-between items-end border-b border-dashed border-sys-300 pb-3 mb-3">
              <div className="text-left">
                 <p className="font-bold text-base">{tipoComprobante} "{letra}"</p>
                 <p className="text-sys-500">N° {isFiscal ? String(sale.afip.cbteNumero).padStart(8, '0') : (data.localId?.slice(-8) || '---')}</p>
              </div>
              <div className="text-right">
                <p>{new Date(data.date).toLocaleDateString('es-AR')}</p>
                <p>{new Date(data.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
              </div>
            </div>

            {/* DATOS DEL CLIENTE */}
            <div className="w-full text-left mb-4 text-[10px] space-y-0.5 border-b border-dashed border-sys-300 pb-3">
               <div className="flex"><span className="font-bold w-12">Cliente:</span> <span className="uppercase flex-1">{clientData.name}</span></div>
               <div className="flex"><span className="font-bold w-12">{docLabel}:</span> <span>{docValue}</span></div>
               <div className="flex"><span className="font-bold w-12">Cond:</span> <span className="uppercase text-[9px]">{condFiscal}</span></div>
               {/* En recibos, mostramos el método de pago del recibo */}
               <div className="flex mt-1"><span className="font-bold w-12">Pago:</span> <span className="uppercase font-bold">{isSale ? (data.payment?.method || '-') : (data.method || 'EFECTIVO')}</span></div>
            </div>

            {/* CUERPO DEL TICKET */}
            <div className="w-full mb-4">
              
              {/* CASO A: VENTA (Lista de Productos) */}
              {isSale && (
                  <>
                    <div className="flex font-bold border-b border-sys-900 pb-1 mb-1">
                        <span className="w-8">CANT</span>
                        <span className="flex-1">DESCRIPCIÓN</span>
                        <span className="w-16 text-right">TOTAL</span>
                    </div>
                    <div className="space-y-1">
                        {data.items.map((item, idx) => (
                        <div key={idx} className="flex items-start">
                            <span className="w-8 font-bold">{item.isWeighable ? item.quantity.toFixed(3) : item.quantity}</span>
                            <span className="flex-1 uppercase leading-tight pr-2">{item.name}</span>
                            <span className="w-16 text-right">{item.subtotal.toFixed(2)}</span>
                        </div>
                        ))}
                    </div>
                  </>
              )}

              {/* CASO B: RECIBO DE COBRANZA (Concepto) */}
              {!isSale && (
                  <div className="space-y-4">
                      <div className="text-center py-2 border border-sys-200 bg-sys-50 rounded">
                          <p className="font-bold uppercase text-xs">Pago a Cuenta / Cobranza</p>
                          <p className="text-[10px] text-sys-500 italic">Movimiento en Cta. Cte.</p>
                      </div>
                      
                      <div className="flex justify-between text-sm px-2">
                          <span>Monto Abonado:</span>
                          <span className="font-bold text-lg">$ {data.amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                      </div>
                      
                      {/* Estado de Deuda Actualizado */}
                      {data.newBalance !== undefined && (
                          <div className="flex justify-between text-xs pt-2 border-t border-dashed border-sys-300 px-2">
                              <span>Nuevo Saldo Deudor:</span>
                              <span className="font-bold text-red-600">$ {data.newBalance.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                          </div>
                      )}
                  </div>
              )}

            </div>

            {/* TOTALES (Solo para Venta, Recibo ya mostró el monto) */}
            {isSale && (
                <div className="w-full border-t border-dashed border-sys-300 pt-3 space-y-1">
                    <div className="flex justify-between font-black text-xl mt-2 border-y border-sys-900 py-2 bg-sys-50 print:bg-transparent">
                        <span>TOTAL</span>
                        <span>$ {data.total.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                    </div>
                </div>
            )}

            {/* FOOTER (AFIP o Firma) */}
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
                 <div className="space-y-4">
                    {!isSale && (
                        <div className="flex flex-col items-center mt-8">
                            <div className="border-t border-sys-800 w-40 mb-1"></div>
                            <p className="text-[10px] font-bold text-sys-600">Firma Conforme Cliente</p>
                        </div>
                    )}
                    <p className="font-bold text-xs uppercase pt-4 text-sys-400">*** Documento No Válido como Factura ***</p>
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