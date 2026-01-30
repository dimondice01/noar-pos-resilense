import React, { useState, useEffect, useRef, forwardRef } from 'react';
import QRCode from "react-qr-code";
import { X, Printer, CheckCircle } from 'lucide-react';
import { useReactToPrint } from 'react-to-print';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { doc, getDoc } from 'firebase/firestore'; 
import { db } from '../../../database/firebase'; 

// 🔥 COMPONENTES UI Y ASSETS
import { Button } from '../../../core/ui/Button'; // <-- ¡CORREGIDO: Aquí estaba el error!
import defaultLogo from '../../../assets/logo.png'; 

// =========================================================
// HELPER SEGURO DE MONEDA (Walmart Style: Sin decimales si no son necesarios)
// =========================================================
const formatCurrency = (amount) => {
    const val = parseFloat(amount);
    if (isNaN(val)) return '0.00';
    return Math.round(val).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

// =========================================================
// CONTENIDO DEL TICKET (Diseñado para Papel Térmico)
// =========================================================
const TicketContent = forwardRef(({ 
    logoSrc, EMPRESA, tipoComprobante, letra, isFiscal, sale, data, 
    clientData, docLabel, docValue, condFiscal, isSale, formatAfipDate 
}, ref) => {
    
    const items = Array.isArray(data.items) ? data.items : [];
    const total = parseFloat(data.total) || 0;
    const discount = parseFloat(data.discount) || 0;
    const subtotal = parseFloat(data.subtotal) || total;

    return (
        <div ref={ref} className="ticket-print-container">
            <div className="ticket-body"> 
                
                {/* ENCABEZADO: Branding Puro */}
                <div className="flex flex-col items-center text-center mb-2 px-0">
                    {logoSrc && (
                        <img 
                            src={logoSrc} 
                            alt="Logo"
                            className="mb-1 object-contain grayscale contrast-200"
                            style={{ maxHeight: '14mm', maxWidth: '75%' }} 
                        />
                    )}
                    <span className="t-title leading-tight mb-1 uppercase font-black">{EMPRESA.nombre}</span>
                    {EMPRESA.direccion && <span className="t-small leading-tight uppercase">{EMPRESA.direccion}</span>}
                    <span className="t-small mt-0.5 uppercase">{EMPRESA.condicionIva}</span>
                    {EMPRESA.cuit && <span className="t-small">CUIT: {EMPRESA.cuit}</span>}
                </div>

                <div className="border-dash"></div>

                {/* INFO TÉCNICA DEL COMPROBANTE */}
                <div className="flex justify-between items-end mb-1 px-0">
                    <div className="flex flex-col">
                        <span className="t-header-text font-black">{tipoComprobante} "{letra}"</span>
                        <span className="t-normal font-black">N° {isFiscal ? String(sale.afip.cbteNumero).padStart(8, '0') : (data.number || '00000000')}</span>
                    </div>
                    <div className="flex flex-col text-right">
                        <span className="t-small font-bold">{new Date(data.date).toLocaleDateString('es-AR')}</span>
                        <span className="t-small font-bold">{new Date(data.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}hs</span>
                    </div>
                </div>

                <div className="border-dash"></div>

                {/* DATOS DEL CLIENTE */}
                <div className="mb-2 info-section">
                    <div className="row-flex t-small"><span className="font-bold">CLIENTE:</span> <span className="truncate uppercase font-black">{clientData.name}</span></div>
                    {(docValue !== '-' && docValue !== '0') && (
                        <div className="row-flex t-small"><span className="font-bold">{docLabel}:</span> <span className="font-black">{docValue}</span></div>
                    )}
                    <div className="row-flex t-small"><span className="font-bold">IVA:</span> <span className="truncate uppercase font-black">{condFiscal}</span></div>
                </div>

                <div className="border-solid"></div>

                {/* CUERPO: LISTADO DE PRODUCTOS (Walmart Style) */}
                {isSale && (
                    <div className="mb-2">
                        <div className="row-flex t-small font-black border-b-2 border-black mb-1 pb-0.5">
                            <div className="col-qty">CNT</div>
                            <div className="col-desc">DESCRIPCIÓN</div>
                            <div className="col-total">TOTAL</div>
                        </div>
                        
                        <div className="flex flex-col gap-1"> 
                            {items.map((item, idx) => (
                                <div key={idx} className="row-flex t-normal items-start">
                                    <div className="col-qty font-mono font-black">
                                        {item.isWeighable ? parseFloat(item.quantity).toFixed(3) : Math.round(item.quantity)}
                                    </div>
                                    <div className="col-desc uppercase leading-none font-bold">
                                        {item.name}
                                    </div>
                                    <div className="col-total font-mono font-black">
                                        {formatCurrency(item.subtotal || (item.price * item.quantity))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* RECIBOS DE PAGO (Si no es venta directa) */}
                {!isSale && (
                    <div className="text-center py-4">
                        <div className="border-2 border-black py-1 mb-2 font-black"><span className="t-title">PAGO A CUENTA</span></div>
                        <p className="t-normal font-bold">MONTO ABONADO:</p>
                        <p className="t-big mt-1 font-black">$ {formatCurrency(data.amount)}</p>
                    </div>
                )}

                <div className="border-solid"></div>

                {/* TOTALES: Impacto Visual Máximo */}
                {isSale && (
                    <div className="mt-2 px-0 space-y-1">
                        {discount > 0 && (
                            <div className="row-flex t-normal">
                                <span className="font-black">SUBTOTAL:</span>
                                <span className="font-mono font-black">$ {formatCurrency(subtotal)}</span>
                            </div>
                        )}
                        {discount > 0 && (
                            <div className="row-flex t-normal">
                                <span className="font-black">DESC. REC:</span>
                                <span className="font-mono font-black">-$ {formatCurrency(discount)}</span>
                            </div>
                        )}
                        
                        <div className="row-flex items-center pt-1">
                            <span className="t-title font-black" style={{fontSize: '20px'}}>TOTAL</span>
                            <span className="t-big font-black font-mono" style={{fontSize: '22px'}}>$ {formatCurrency(total)}</span>
                        </div>

                        <div className="row-flex t-small pt-3 justify-end uppercase">
                             <span className="mr-2 font-bold opacity-70">MEDIO DE PAGO:</span>
                             <span className="font-black">{(isSale ? (data.payment?.method || data.paymentMethod) : data.method) || 'EFECTIVO'}</span>
                        </div>
                    </div>
                )}

                <div className="border-dash mt-4"></div>

                {/* BLOQUE FISCAL AFIP (QR & CAE) */}
                <div className="mt-4 text-center"> 
                    {isFiscal ? (
                        <div className="flex flex-col items-center w-full">
                            <div className="bg-white p-1 mb-2 border-2 border-black" style={{ width: '38mm' }}>
                                {sale.afip.qr && <QRCode value={sale.afip.qr} size={140} style={{ height: "auto", maxWidth: "100%", width: "100%" }} viewBox={`0 0 256 256`} />}
                            </div>
                            <div className="flex items-center justify-center gap-1 w-full mb-1">
                                <span className="italic font-black t-small">AFIP</span>
                                <span className="t-small font-black">Comprobante Autorizado</span>
                            </div>
                            <div className="flex flex-col w-full t-small font-mono mt-1 border-2 border-black p-1 space-y-0.5 bg-black text-white">
                                <div className="flex justify-between px-1"><span>CAE:</span> <span className="font-black">{sale.afip.cae}</span></div>
                                <div className="flex justify-between px-1"><span>VTO:</span> <span className="font-black">{formatAfipDate(sale.afip.vtoCAE)}</span></div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {!isSale && (
                                <div className="flex flex-col items-center mt-6">
                                    <div className="border-t-2 border-black w-32 mb-1"></div>
                                    <span className="t-small font-black">FIRMA DEL CLIENTE</span>
                                </div>
                            )}
                            <div className="border-2 border-black py-1 bg-black text-white">
                                <p className="t-small font-black tracking-widest">*** NO VÁLIDO COMO FACTURA ***</p>
                            </div>
                        </div>
                    )}
                    
                    <p className="mt-6 t-small font-black uppercase tracking-widest">¡Gracias por su visita!</p>
                    <p className="mt-1 text-[9px] font-black opacity-50 italic">SALVADOR POS - v2.1</p>
                    <p className="text-[8px] font-mono opacity-40 break-all pt-2">TXID: {data.id || data.localId}</p>
                </div>
            </div>
        </div>
    );
});

// =========================================================
// MODAL PRINCIPAL: GESTIÓN DE INTERFAZ
// =========================================================
export const TicketModal = ({ isOpen, onClose, sale, receipt, companyConfig }) => {
  const data = sale || receipt;
  const { user } = useAuthStore(); 
  const componentRef = useRef(null);
  
  const [dbConfig, setDbConfig] = useState(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  // 🔥 CONFIGURACIÓN DE IMPRESIÓN REACT-TO-PRINT
  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: `Ticket-${data?.number || 'pos'}`,
    onAfterPrint: () => console.log("✅ Impresión finalizada"),
  });

  useEffect(() => {
    if (isOpen && user?.companyId) {
        const fetchCompanyData = async () => {
            try {
                const cachedConfig = localStorage.getItem(`SALVADOR_COMPANY_CONFIG_${user.companyId}`);
                if (cachedConfig) {
                    setDbConfig(JSON.parse(cachedConfig));
                    setLoadingConfig(false);
                }

                if (navigator.onLine) {
                    const docRef = doc(db, 'companies', user.companyId);
                    const snap = await getDoc(docRef);
                    if (snap.exists()) {
                        const freshData = snap.data();
                        setDbConfig(freshData);
                        localStorage.setItem(`SALVADOR_COMPANY_CONFIG_${user.companyId}`, JSON.stringify(freshData));
                    }
                }
            } catch (error) {
                console.error("Error cargando configuración de empresa:", error);
            } finally {
                setLoadingConfig(false);
            }
        };
        fetchCompanyData();
    }
  }, [isOpen, user?.companyId]);

  if (!isOpen || !data) return null;

  const isSale = !!sale;
  const isFiscal = isSale && sale.afip?.status === 'APPROVED';
  
  const EMPRESA = {
    nombre: dbConfig?.name || "MI NEGOCIO",
    cuit: dbConfig?.cuit || "",
    direccion: dbConfig?.address || "",
    condicionIva: dbConfig?.taxCondition || "Cons. Final",
    logoUrl: dbConfig?.logoUrl || null,
    ...companyConfig, 
    ...sale?.companySnapshot 
  };

  const formatAfipDate = (dateStr) => {
    if (!dateStr || dateStr.length !== 8) return dateStr;
    return `${dateStr.slice(6, 8)}/${dateStr.slice(4, 6)}/${dateStr.slice(0, 4)}`;
  };

  const clientData = data.client || { name: 'CONSUMIDOR FINAL', docNumber: '0', docType: '99' };
  const docLabel = clientData.docType === '80' ? 'CUIT' : clientData.docType === '96' ? 'DNI' : 'Doc';
  const docValue = (clientData.docNumber && clientData.docNumber !== '0') ? clientData.docNumber : '-';
  const condFiscal = clientData.fiscalCondition ? clientData.fiscalCondition.replace(/_/g, ' ') : 'Cons. Final';

  let tipoComprobante = isSale && isFiscal ? "FACTURA" : (!isSale ? "RECIBO" : "TIQUE X");
  let letra = isSale && isFiscal ? sale.afip.cbteLetra : "X";

  const logoSrc = (EMPRESA.logoUrl && EMPRESA.logoUrl.length > 5) ? EMPRESA.logoUrl : defaultLogo;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/80 backdrop-blur-sm p-4 animate-in fade-in duration-300">
      
      {/* VISTA PREVIA (Solo UI Pantalla) */}
      <div className="bg-sys-100 p-6 rounded-3xl shadow-2xl max-h-[95vh] overflow-y-auto w-full max-w-sm print:hidden flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-full text-green-600 shadow-inner"><CheckCircle size={22} /></div>
              <h3 className="font-black text-sys-900 text-xl tracking-tighter uppercase">¡Venta Lista!</h3>
          </div>
          <button onClick={onClose} className="p-2 bg-white text-sys-500 rounded-full hover:bg-sys-200 transition-colors shadow-sm"><X size={20} /></button>
        </div>
        
        {/* El "Papel" Visual */}
        <div className="bg-white mx-auto shadow-2xl w-full max-w-[75mm] border-t-[12px] border-sys-900 overflow-hidden relative mb-4">
             <div className="p-5">
                <TicketContent 
                    logoSrc={logoSrc} EMPRESA={EMPRESA} tipoComprobante={tipoComprobante} letra={letra} 
                    isFiscal={isFiscal} sale={sale} data={data} clientData={clientData} 
                    docLabel={docLabel} docValue={docValue} condFiscal={condFiscal} 
                    isSale={isSale} formatAfipDate={formatAfipDate} 
                />
             </div>
             {/* Efecto de corte de papel al final */}
             <div className="absolute bottom-0 left-0 w-full h-4 bg-gradient-to-t from-sys-100/50 to-transparent"></div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
            <Button 
                onClick={handlePrint} 
                className="w-full py-5 bg-brand text-white font-black rounded-2xl shadow-xl shadow-brand/30 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 text-lg"
            >
                <Printer size={24} /> IMPRIMIR TICKET
            </Button>
            <button 
                onClick={onClose} 
                className="w-full py-3 bg-white text-sys-500 font-bold rounded-2xl border-2 border-sys-200 hover:bg-sys-50 transition-colors uppercase text-xs tracking-widest"
            >
                Volver al POS
            </button>
        </div>
      </div>

      {/* --- MOTOR DE IMPRESIÓN OCULTO (Blindado) --- */}
      <div style={{ display: 'none' }}>
            <TicketContent 
                ref={componentRef}
                logoSrc={logoSrc} EMPRESA={EMPRESA} tipoComprobante={tipoComprobante} letra={letra} 
                isFiscal={isFiscal} sale={sale} data={data} clientData={clientData} 
                docLabel={docLabel} docValue={docValue} condFiscal={condFiscal} 
                isSale={isSale} formatAfipDate={formatAfipDate} 
            />
      </div>

      {/* ESTILOS CSS INYECTADOS ESPECÍFICOS PARA TÉRMICAS */}
      <style>{`
        .ticket-body {
            width: 100%;
            background: white;
            color: #000;
            font-family: 'Courier New', Courier, monospace;
            text-transform: uppercase;
            padding: 0;
            margin: 0;
        }

        .t-title { font-size: 17px; font-weight: 900; }
        .t-header-text { font-size: 14px; font-weight: 900; }
        .t-big { font-size: 19px; font-weight: 900; }
        .t-normal { font-size: 12px; font-weight: 800; }
        .t-small { font-size: 10.5px; font-weight: 700; }
        
        .row-flex { display: flex; justify-content: space-between; width: 100%; }
        .border-dash { border-bottom: 2px dashed #000; margin: 6px 0; width: 100%; }
        .border-solid { border-bottom: 2px solid #000; margin: 6px 0; width: 100%; }

        .col-qty { width: 18%; text-align: left; }
        .col-desc { width: 57%; text-align: left; padding-right: 4px; }
        .col-total { width: 25%; text-align: right; }

        @media print {
            @page { 
                size: 80mm auto; 
                margin: 0; 
            }
            body { 
                margin: 0; 
                padding: 0; 
                background: white !important;
                -webkit-print-color-adjust: exact;
            }
            .ticket-print-container {
                display: block !important;
                width: 100% !important;
                padding: 0 !important;
                margin: 0 !important;
            }
            .ticket-body {
                width: 72mm; /* Ancho real de impresión seguro */
                margin: 0 auto;
                padding: 5mm 3mm;
            }
            /* Forzamos que todo sea negro para térmicas */
            * { color: #000 !important; border-color: #000 !important; }
        }
      `}</style>
    </div>
  );
};