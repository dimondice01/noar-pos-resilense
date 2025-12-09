import React from 'react';
import QRCode from "react-qr-code";
import { X, Printer } from 'lucide-react';

// 👇 IMPORTAMOS EL LOGO
import logoEmpresa from '../../../assets/logo.png'; 

export const TicketModal = ({ isOpen, onClose, sale, receipt }) => {
  const data = sale || receipt;
  
  if (!isOpen || !data) return null;

  const isSale = !!sale;
  const isFiscal = isSale && sale.afip?.status === 'APPROVED';
  
  // ⚙️ CONFIGURACIÓN DE TU NEGOCIO
  const EMPRESA = {
    nombre: "MAXI KIOSCO LA ESQUINA",
    razonSocial: "Maxi Kiosco La Esquina", 
   // cuit: "20-00000000-0", // TODO: Completar con el CUIT real
    direccion: "Proyectada 2, Pio Cabral", // TODO: Completar
    //condicionIva: "RESPONSABLE MONOTRIBUTO", 
    //inicio: "01/01/2024"
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

  const clientData = data.client || { name: 'CONSUMIDOR FINAL', docNumber: '0', docType: '99' };
  
  const docLabel = clientData.docType === '80' ? 'CUIT' : clientData.docType === '96' ? 'DNI' : 'Doc';
  const docValue = (clientData.docNumber && clientData.docNumber !== '0') ? clientData.docNumber : '-';
  const condFiscal = clientData.fiscalCondition ? clientData.fiscalCondition.replace(/_/g, ' ') : 'CONSUMIDOR FINAL';

  let tipoComprobante = "TIQUE NO FISCAL";
  let letra = "X";
  
  if (isSale && isFiscal) {
      tipoComprobante = "FACTURA";
      letra = sale.afip.cbteLetra;
  } else if (!isSale) {
      tipoComprobante = "RECIBO DE COBRO"; 
      letra = "X";
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/80 backdrop-blur-sm p-4 animate-in fade-in duration-200 print:p-0 print:bg-white print:static print:inset-0">
      
      {/* Contenedor Modal (Pantalla) */}
      <div className="bg-sys-100 p-8 rounded-3xl shadow-2xl max-h-[90vh] overflow-y-auto w-full max-w-md print:hidden">
        <div className="flex justify-between items-center mb-6 print:hidden">
          <h3 className="font-bold text-sys-900 text-lg">Vista Previa</h3>
          <div className="flex gap-2">
            <button onClick={handlePrint} className="p-2 bg-brand text-white rounded-full hover:bg-brand-hover transition shadow-lg shadow-brand/20"><Printer size={20} /></button>
            <button onClick={onClose} className="p-2 bg-white text-sys-500 rounded-full hover:bg-sys-200 transition"><X size={20} /></button>
          </div>
        </div>

        {/* VISTA PREVIA EN PANTALLA */}
        <div className="bg-white mx-auto shadow-sm w-[300px] min-h-[400px] text-sys-900 font-mono text-[11px] leading-tight relative overflow-hidden pointer-events-none">
             <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sys-200 to-sys-50 bg-[length:10px_100%]"></div>
             <TicketContent 
                logo={logoEmpresa} // Pasamos el logo
                EMPRESA={EMPRESA} 
                tipoComprobante={tipoComprobante} 
                letra={letra} 
                isFiscal={isFiscal} 
                sale={sale} 
                data={data} 
                clientData={clientData} 
                docLabel={docLabel} 
                docValue={docValue} 
                condFiscal={condFiscal} 
                isSale={isSale} 
                formatAfipDate={formatAfipDate}
             />
             <div className="absolute bottom-0 left-0 right-0 h-2 bg-sys-900"></div>
        </div>
      </div>

      {/* ÁREA DE IMPRESIÓN REAL (Solo visible al imprimir) */}
      <div className="hidden print:block print:w-[80mm] print:overflow-hidden">
          <TicketContent 
                logo={logoEmpresa} // Pasamos el logo
                EMPRESA={EMPRESA} 
                tipoComprobante={tipoComprobante} 
                letra={letra} 
                isFiscal={isFiscal} 
                sale={sale} 
                data={data} 
                clientData={clientData} 
                docLabel={docLabel} 
                docValue={docValue} 
                condFiscal={condFiscal} 
                isSale={isSale} 
                formatAfipDate={formatAfipDate}
             />
      </div>

      {/* CSS MÁGICO PARA CORTE AUTOMÁTICO */}
      <style>{`
        @media print {
            @page { 
                margin: 0; 
                size: auto; 
            }
            body { 
                margin: 0; 
                padding: 0; 
                background: white; 
            }
            body * { 
                visibility: hidden; 
            }
            .print\\:block, .print\\:block * { 
                visibility: visible; 
            }
            .print\\:block { 
                position: absolute; 
                left: 0; 
                top: 0; 
                width: 100%; 
            }
            /* Asegura que la imagen se imprima con buen contraste */
            img {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
        }
      `}</style>
    </div>
  );
};

// =========================================================
// SUB-COMPONENTE: CONTENIDO DEL TICKET
// =========================================================
const TicketContent = ({ logo, EMPRESA, tipoComprobante, letra, isFiscal, sale, data, clientData, docLabel, docValue, condFiscal, isSale, formatAfipDate }) => (
    <div className="text-sys-900 font-mono text-[10px] leading-tight bg-white p-2"> 
        
        {/* LOGO / ENCABEZADO */}
        <div className="flex flex-col items-center mb-2 pt-2">
            {/* Si hay logo, mostramos imagen. Si falla, el nombre. */}
            <img 
                src={logo} 
                alt={EMPRESA.nombre} 
                className="w-32 h-auto object-contain mb-2"
                style={{ maxWidth: '100%', maxHeight: '80px' }}
                onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'block';
                }}
            />
            {/* Título Fallback (oculto si hay logo) */}
            <h1 className="font-sans font-black text-lg tracking-tight text-sys-900 uppercase hidden">
                {EMPRESA.nombre}
            </h1>

            <p className="font-bold uppercase text-[9px] mt-1">{EMPRESA.razonSocial}</p>
            <p className="text-[9px]"> {EMPRESA.cuit}</p>
            <p className="text-[9px] text-center">{EMPRESA.direccion}</p>
            <p className="font-bold text-[8px] mt-1">{EMPRESA.condicionIva}</p> 
        </div>

        <div className="border-b border-dashed border-black mb-2"></div>

        {/* DATOS COMPROBANTE */}
        <div className="flex justify-between items-end mb-2">
            <div>
                <p className="font-bold text-sm">{tipoComprobante} "{letra}"</p>
                <p>N° {isFiscal ? String(sale.afip.cbteNumero).padStart(8, '0') : (data.localId?.slice(-8) || '---')}</p>
            </div>
            <div className="text-right">
                <p>{new Date(data.date).toLocaleDateString('es-AR')}</p>
                <p>{new Date(data.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
            </div>
        </div>

        {/* CLIENTE */}
        <div className="mb-2 pb-2 border-b border-dashed border-black">
            <div className="flex"><span className="font-bold w-10">Clie:</span> <span className="uppercase flex-1 truncate">{clientData.name}</span></div>
            <div className="flex"><span className="font-bold w-10">{docLabel}:</span> <span>{docValue}</span></div>
            <div className="flex"><span className="font-bold w-10">Cond:</span> <span className="uppercase text-[9px]">{condFiscal}</span></div>
        </div>

        {/* ITEMS */}
        {isSale && (
            <div className="mb-2">
                <div className="flex font-bold pb-1 mb-1 border-b border-black text-[9px]">
                    <span className="w-6">CNT</span>
                    <span className="flex-1">DETALLE</span>
                    <span className="w-14 text-right">IMP.</span>
                </div>
                <div className="space-y-1">
                    {data.items.map((item, idx) => (
                    <div key={idx} className="flex items-start text-[10px]">
                        <span className="w-6 font-bold">{item.isWeighable ? item.quantity.toFixed(3) : item.quantity}</span>
                        <span className="flex-1 uppercase leading-tight pr-1">{item.name.slice(0,25)}</span>
                        <span className="w-14 text-right">{item.subtotal.toFixed(2)}</span>
                    </div>
                    ))}
                </div>
            </div>
        )}

        {/* CASO B: RECIBO DE COBRANZA */}
        {!isSale && (
            <div className="space-y-3 pt-2">
                <div className="text-center py-1 border border-black rounded">
                    <p className="font-bold uppercase text-xs">Pago a Cuenta</p>
                </div>
                
                <div className="flex justify-between text-sm px-1">
                    <span>Abonado:</span>
                    <span className="font-bold">$ {data.amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                </div>
                
                {data.newBalance !== undefined && (
                    <div className="flex justify-between text-xs pt-2 border-t border-dashed border-black px-1">
                        <span>Saldo Restante:</span>
                        <span className="font-bold">$ {data.newBalance.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                    </div>
                )}
            </div>
        )}

        {/* TOTALES */}
        {isSale && (
            <div className="w-full border-t border-dashed border-black pt-2 mt-1 space-y-1">
                <div className="flex justify-between font-black text-xl mt-1">
                    <span>TOTAL</span>
                    <span>$ {data.total.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                </div>
                <div className="flex justify-between text-[9px] mt-1">
                     <span>Pago:</span>
                     <span className="font-bold uppercase">{isSale ? (data.payment?.method || 'EFECTIVO') : (data.method || 'EFECTIVO')}</span>
                </div>
            </div>
        )}

        {/* PIE DE PÁGINA */}
        <div className="mt-6 text-center pb-4"> 
            {isFiscal ? (
                <div className="flex flex-col items-center gap-2">
                    <div className="w-24 h-24 bg-white p-0.5">
                        {sale.afip.qr && <QRCode value={sale.afip.qr} size={96} style={{ height: "auto", maxWidth: "100%", width: "100%" }} viewBox={`0 0 256 256`} />}
                    </div>
                    <div className="flex items-center gap-1 justify-center w-full mt-1">
                        <span className="font-black italic text-sys-400">AFIP</span>
                        <span className="text-[8px] font-bold">Comprobante Autorizado</span>
                    </div>
                    <div className="text-[9px] w-full flex justify-between px-2 font-bold font-mono mt-1">
                        <span>CAE: {sale.afip.cae}</span>
                        <span>VTO: {formatAfipDate(sale.afip.vtoCAE)}</span>
                    </div>
                </div>
            ) : (
                <div className="space-y-2">
                    {!isSale && (
                        <div className="flex flex-col items-center mt-6">
                            <div className="border-t border-black w-32 mb-1"></div>
                            <p className="text-[10px]">Firma Conforme</p>
                        </div>
                    )}
                    <p className="font-bold text-[9px] uppercase pt-2">*** NO VÁLIDO COMO FACTURA ***</p>
                </div>
            )}
            <p className="mt-4 text-[8px] text-sys-400">Software: Noar POS</p>
        </div>
    </div>
);