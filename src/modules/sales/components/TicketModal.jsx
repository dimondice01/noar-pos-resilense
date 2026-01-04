import React from 'react';
import QRCode from "react-qr-code";
import { X, Printer, ImageOff } from 'lucide-react';
import { useAuthStore } from '../../auth/store/useAuthStore';
// Importa tu logo por defecto aquí
import defaultLogo from '../../../assets/logo.png'; 

export const TicketModal = ({ isOpen, onClose, sale, receipt, companyConfig }) => {
  const data = sale || receipt;
  // 🔥 LEEMOS LA EMPRESA DIRECTO DEL STORE GLOBAL
  const { company } = useAuthStore();
  
  const globalConfig = company || {}; 

  if (!isOpen || !data) return null;

  const isSale = !!sale;
  const isFiscal = isSale && sale.afip?.status === 'APPROVED';
  
  // ⚙️ DATOS POR DEFECTO (Si el usuario no cargó nada)
  const DEFAULT_EMPRESA = {
    nombre: "TU NEGOCIO",
    razonSocial: "", 
    cuit: "", 
    direccion: "", 
    condicionIva: "CONSUMIDOR FINAL", 
    logoUrl: null 
  };

  // Helper para normalizar nombres de campos (pueden venir en inglés o español según la BD)
  const normalize = (conf) => ({
      nombre: conf?.name || conf?.nombre || null,
      razonSocial: conf?.razonSocial || null,
      cuit: conf?.cuit || null,
      direccion: conf?.address || conf?.direccion || null,
      condicionIva: conf?.taxCondition || conf?.condicionIva || null,
      logoUrl: conf?.logoUrl || null
  });

  // FUSIÓN DE DATOS (Prioridad: Histórico Venta > Props Manuales > Config Global > Default)
  const EMPRESA = {
    ...DEFAULT_EMPRESA,
    ...normalize(globalConfig),
    ...normalize(companyConfig),
    ...normalize(sale?.companySnapshot)
  };

  const handlePrint = () => window.print();

  const formatAfipDate = (dateStr) => {
    if (!dateStr || dateStr.length !== 8) return dateStr;
    return `${dateStr.slice(6, 8)}/${dateStr.slice(4, 6)}/${dateStr.slice(0, 4)}`;
  };

  const clientData = data.client || { name: 'CONSUMIDOR FINAL', docNumber: '0', docType: '99' };
  const docLabel = clientData.docType === '80' ? 'CUIT' : clientData.docType === '96' ? 'DNI' : 'Doc';
  const docValue = (clientData.docNumber && clientData.docNumber !== '0') ? clientData.docNumber : '-';
  const condFiscal = clientData.fiscalCondition ? clientData.fiscalCondition.replace(/_/g, ' ') : 'CONSUMIDOR FINAL';

  let tipoComprobante = isSale && isFiscal ? "FACTURA" : (!isSale ? "RECIBO DE COBRO" : "TIQUE NO FISCAL");
  let letra = isSale && isFiscal ? sale.afip.cbteLetra : "X";

  // Lógica de Logo: Si hay URL válida úsala, sino defaultLogo.
  const logoSrc = (EMPRESA.logoUrl && EMPRESA.logoUrl.length > 10) ? EMPRESA.logoUrl : defaultLogo;
  const showRazonSocial = EMPRESA.razonSocial && EMPRESA.razonSocial !== EMPRESA.nombre;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/80 backdrop-blur-sm p-4 animate-in fade-in duration-200 print:p-0 print:bg-white print:static print:inset-0">
      
      {/* MODAL EN PANTALLA (Vista Previa) */}
      <div className="bg-sys-100 p-8 rounded-3xl shadow-2xl max-h-[90vh] overflow-y-auto w-full max-w-md print:hidden">
        <div className="flex justify-between items-center mb-6 print:hidden">
          <h3 className="font-bold text-sys-900 text-lg">Vista Previa</h3>
          <div className="flex gap-2">
            <button onClick={handlePrint} className="p-2 bg-brand text-white rounded-full hover:bg-brand-hover transition shadow-lg shadow-brand/20"><Printer size={20} /></button>
            <button onClick={onClose} className="p-2 bg-white text-sys-500 rounded-full hover:bg-sys-200 transition"><X size={20} /></button>
          </div>
        </div>
        <div className="bg-white mx-auto shadow-sm w-[300px] min-h-[400px] relative overflow-hidden border-t-4 border-sys-200">
             {/* Reutilizamos el componente de contenido */}
             <TicketContent {...{logoSrc, EMPRESA, showRazonSocial, tipoComprobante, letra, isFiscal, sale, data, clientData, docLabel, docValue, condFiscal, isSale, formatAfipDate}} />
             <div className="absolute bottom-0 left-0 right-0 h-2 bg-sys-900"/>
        </div>
      </div>

      {/* ÁREA DE IMPRESIÓN REAL (Oculta en pantalla) */}
      {/* 🔥 CLAVE: Usamos 'print-area' para identificar qué imprimir en el CSS */}
      <div className="hidden print:block print-area overflow-hidden">
          <TicketContent {...{logoSrc, EMPRESA, showRazonSocial, tipoComprobante, letra, isFiscal, sale, data, clientData, docLabel, docValue, condFiscal, isSale, formatAfipDate}} />
      </div>

      {/* 🔥 CSS FUERZA BRUTA PARA NEGRO PURO */}
      <style>{`
        @media print {
            @page { margin: 0; size: auto; }
            body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
            
            /* Oculta todo lo que no sea el área de impresión */
            body * { visibility: hidden; height: 0; }
            .print-area, .print-area * { visibility: visible; height: auto; }
            .print-area { position: absolute; left: 0; top: 0; width: 100%; /* 72mm o 80mm según driver */ }

            /* REGLAS DE ORO PARA TÉRMICAS */
            * {
                color: #000000 !important; /* Negro puro sin discusión */
                text-shadow: none !important;
                box-shadow: none !important;
            }
            /* Fuentes monoespaciadas y gruesas se imprimen mejor */
            .ticket-font { 
                font-family: 'Courier New', Courier, monospace !important; 
                font-weight: bold !important;
            }
            .ticket-font-black { 
                font-weight: 900 !important; /* Extra black */
            }
            /* Bordes sólidos negros */
            .ticket-border { border-color: #000 !important; border-style: solid !important; }

            /* Imágenes de alto contraste y pixeladas para nitidez */
            img, svg { 
                -webkit-print-color-adjust: exact !important; 
                print-color-adjust: exact !important;
                image-rendering: pixelated !important;
                filter: grayscale(100%) contrast(120%) !important; 
            }
        }
      `}</style>
    </div>
  );
};

// =========================================================
// SUB-COMPONENTE: CONTENIDO DEL TICKET (Limpio de estilos externos)
// =========================================================
const TicketContent = ({ logoSrc, EMPRESA, showRazonSocial, tipoComprobante, letra, isFiscal, sale, data, clientData, docLabel, docValue, condFiscal, isSale, formatAfipDate }) => (
    // Aplicamos clase base 'ticket-font' para el CSS de impresión
    <div className="bg-white p-2 ticket-font text-[11px] leading-tight text-black font-mono"> 
        
        {/* ENCABEZADO */}
        <div className="flex flex-col items-center mb-2 pt-1 text-center">
            {/* Logo con fallback y estilos de impresión */}
            <img 
                src={logoSrc} 
                alt="Logo"
                className="mb-2 object-contain grayscale contrast-125 mx-auto"
                style={{ maxWidth: '70%', maxHeight: '70px' }}
                onError={(e) => { 
                    if(e.target.src !== defaultLogo) e.target.src = defaultLogo; 
                    else e.target.style.display = 'none';
                }}
            />
            
            <div className="ticket-font-black text-sm uppercase">{EMPRESA.nombre}</div>
            {showRazonSocial && <p className="uppercase text-[9px] mt-1">{EMPRESA.razonSocial}</p>}
            {EMPRESA.cuit && <p>CUIT: {EMPRESA.cuit}</p>}
            {EMPRESA.direccion && <p className="px-4">{EMPRESA.direccion}</p>}
            <p className="ticket-font-black text-[9px] mt-1 uppercase">{EMPRESA.condicionIva}</p> 
        </div>

        <div className="border-b-2 border-dashed border-black ticket-border mb-2"></div>

        {/* DATOS COMPROBANTE */}
        <div className="flex justify-between items-end mb-2">
            <div>
                <p className="ticket-font-black text-sm">{tipoComprobante} "{letra}"</p>
                <p className="ticket-font-black">N° {isFiscal ? String(sale.afip.cbteNumero).padStart(8, '0') : (data.localId?.slice(-8) || '---')}</p>
            </div>
            <div className="text-right text-[10px]">
                <p>{new Date(data.date).toLocaleDateString('es-AR')}</p>
                <p>{new Date(data.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
            </div>
        </div>

        {/* CLIENTE */}
        <div className="mb-2 pb-2 border-b border-dashed border-black ticket-border">
            <div className="flex"><span className="ticket-font-black w-10">Clie:</span> <span className="uppercase flex-1 truncate">{clientData.name.substring(0, 25)}</span></div>
            <div className="flex"><span className="ticket-font-black w-10">{docLabel}:</span> <span>{docValue}</span></div>
            <div className="flex"><span className="ticket-font-black w-10">Cond:</span> <span className="uppercase text-[9px]">{condFiscal}</span></div>
        </div>

        {/* ITEMS */}
        {isSale && (
            <div className="mb-2">
                <div className="flex ticket-font-black pb-1 mb-1 border-b border-black ticket-border text-[9px]">
                    <span className="w-8">CANT</span>
                    <span className="flex-1">DESCRIPCION</span>
                    <span className="w-14 text-right">TOTAL</span>
                </div>
                <div className="space-y-1">
                    {data.items.map((item, idx) => (
                    <div key={idx} className="flex items-start text-[10px]">
                        <span className="w-8 font-bold text-center">{item.isWeighable ? item.quantity.toFixed(2) : item.quantity}</span>
                        <span className="flex-1 uppercase leading-tight pr-1">{item.name.slice(0,22)}</span>
                        <span className="w-14 text-right ticket-font-black">{item.subtotal.toFixed(2)}</span>
                    </div>
                    ))}
                </div>
            </div>
        )}

        {/* PAGOS A CUENTA */}
        {!isSale && (
            <div className="space-y-3 pt-2 text-center">
                <div className="py-1 border-2 border-black ticket-border">
                    <p className="ticket-font-black uppercase text-xs">PAGO A CUENTA</p>
                </div>
                <div className="flex justify-between text-sm px-2">
                    <span>Abonado:</span>
                    <span className="ticket-font-black text-base">$ {data.amount.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                </div>
                {data.newBalance !== undefined && (
                    <div className="flex justify-between text-xs pt-2 border-t border-dashed border-black ticket-border px-2">
                        <span>Saldo Restante:</span>
                        <span className="font-bold">$ {data.newBalance.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                    </div>
                )}
            </div>
        )}

        {/* TOTALES */}
        {isSale && (
            <div className="w-full border-t-2 border-dashed border-black ticket-border pt-2 mt-1 space-y-1">
                <div className="flex justify-between ticket-font-black text-xl mt-2 px-1">
                    <span>TOTAL</span>
                    <span>$ {data.total.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>
                </div>
                <div className="flex justify-between text-[10px] mt-1 uppercase px-1">
                     <span>Forma de Pago:</span>
                     <span className="ticket-font-black">{(isSale ? (data.payment?.method || data.paymentMethod) : data.method) || 'EFECTIVO'}</span>
                </div>
            </div>
        )}

        {/* PIE DE PÁGINA (AFIP o NO VÁLIDO) */}
        <div className="mt-6 text-center pb-4"> 
            {isFiscal ? (
                <div className="flex flex-col items-center gap-1">
                    {/* Contenedor QR con fondo blanco puro */}
                    <div className="bg-white p-1 inline-block">
                        {sale.afip.qr && <QRCode value={sale.afip.qr} size={110} style={{ height: "auto", maxWidth: "100%", width: "100%" }} viewBox={`0 0 256 256`} />}
                    </div>
                    <div className="flex items-center gap-1 justify-center w-full font-bold">
                        <span className="italic text-[10px]">AFIP</span>
                        <span className="text-[9px]">Comprobante Autorizado</span>
                    </div>
                    <div className="text-[10px] w-full flex justify-between px-1 ticket-font-black font-mono mt-1 uppercase">
                        <span>CAE: {sale.afip.cae}</span>
                        <span>VTO: {formatAfipDate(sale.afip.vtoCAE)}</span>
                    </div>
                </div>
            ) : (
                <div className="space-y-2">
                    {!isSale && (
                        <div className="flex flex-col items-center mt-4">
                            <div className="border-t border-black ticket-border w-32 mb-1"></div>
                            <p className="text-[10px]">Firma Conforme</p>
                        </div>
                    )}
                    <p className="ticket-font-black text-[10px] uppercase pt-2">*** NO VÁLIDO COMO FACTURA ***</p>
                </div>
            )}
            <p className="mt-4 text-[8px] font-bold uppercase">Powered by Noar POS</p>
        </div>
    </div>
);