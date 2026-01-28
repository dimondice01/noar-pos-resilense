import React, { useState, useEffect } from 'react';
import QRCode from "react-qr-code";
import { X, Printer, CheckCircle } from 'lucide-react';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { doc, getDoc } from 'firebase/firestore'; 
import { db } from '../../../database/firebase'; 
import defaultLogo from '../../../assets/logo.png'; 

// =========================================================
// HELPER SEGURO DE MONEDA
// =========================================================
const formatCurrency = (amount) => {
    const val = parseFloat(amount);
    if (isNaN(val)) return '0.00';
    return Math.round(val).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

// =========================================================
// CONTENIDO DEL TICKET (Componente Puro)
// =========================================================
const TicketContent = ({ logoSrc, EMPRESA, tipoComprobante, letra, isFiscal, sale, data, clientData, docLabel, docValue, condFiscal, isSale, formatAfipDate }) => {
    
    // 🔥 SAFE GUARD: Asegurar que items es un array
    const items = Array.isArray(data.items) ? data.items : [];
    
    // 🔥 SAFE GUARD: Asegurar totales numéricos
    const total = parseFloat(data.total) || 0;
    const discount = parseFloat(data.discount) || 0;
    const subtotal = parseFloat(data.subtotal) || total;

    return (
        <div className="w-full bg-white text-black font-bold pb-10 ticket-container"> 
            
            {/* ENCABEZADO */}
            <div className="flex flex-col items-center text-center mb-2 px-0">
                {logoSrc && (
                    <img 
                        src={logoSrc} 
                        alt="Logo"
                        className="mb-1 object-contain grayscale contrast-125"
                        style={{ maxHeight: '15mm', maxWidth: '80%' }} 
                    />
                )}
                <span className="t-title leading-tight mb-1 uppercase">{EMPRESA.nombre?.substring(0,30)}</span>
                {EMPRESA.direccion && <span className="t-small leading-tight uppercase">{EMPRESA.direccion.substring(0,40)}</span>}
                <span className="t-small mt-0.5 uppercase">{EMPRESA.condicionIva?.substring(0,25)}</span>
                {EMPRESA.cuit && <span className="t-small">CUIT: {EMPRESA.cuit}</span>}
            </div>

            <div className="border-dash"></div>

            {/* INFO */}
            <div className="flex justify-between items-end mb-1 px-0">
                <div className="flex flex-col">
                    <span className="t-normal">{tipoComprobante} "{letra}"</span>
                    <span className="t-small">N° {isFiscal ? String(sale.afip.cbteNumero).padStart(8, '0') : (data.number || data.localId?.slice(-8) || '0000')}</span>
                </div>
                <div className="flex flex-col text-right">
                    <span className="t-small">{new Date(data.date).toLocaleDateString('es-AR')}</span>
                    <span className="t-small">{new Date(data.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
            </div>

            {/* CLIENTE */}
            <div className="mb-2">
                <div className="flex t-small"><span className="w-8">CLI:</span> <span className="flex-1 truncate uppercase">{clientData.name.substring(0, 25)}</span></div>
                {(docValue !== '-' && docValue !== '0') && (
                    <div className="flex t-small"><span className="w-8">{docLabel}:</span> <span>{docValue}</span></div>
                )}
                <div className="flex t-small"><span className="w-8">IVA:</span> <span className="flex-1 truncate uppercase">{condFiscal.substring(0,20)}</span></div>
            </div>

            <div className="border-solid"></div>

            {/* ITEMS */}
            {isSale && (
                <div className="mb-2">
                    <div className="row-flex t-small pb-1 border-b border-black/10 mb-1">
                        <div className="col-qty">CNT</div>
                        <div className="col-desc">DESC</div>
                        <div className="col-total">TOTAL</div>
                    </div>
                    
                    <div className="flex flex-col gap-1"> 
                        {items.map((item, idx) => {
                            const qty = parseFloat(item.quantity) || 0;
                            const sub = parseFloat(item.subtotal) || 0;
                            return (
                                <div key={idx} className="row-flex t-normal items-start">
                                    <div className="col-qty">
                                        {item.isWeighable ? qty.toFixed(3) : Math.round(qty)}
                                    </div>
                                    <div className="col-desc uppercase">
                                        {item.name}
                                    </div>
                                    <div className="col-total">
                                        {Math.round(sub)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* MOVIMIENTOS CAJA (RECIBOS) */}
            {!isSale && (
                <div className="text-center py-4">
                    <div className="border-2 border-black py-1 mb-2"><span className="t-title">PAGO A CUENTA</span></div>
                    <p className="t-normal">MONTO ABONADO:</p>
                    <p className="t-big mt-1">$ {formatCurrency(data.amount)}</p>
                </div>
            )}

            <div className="border-solid"></div>

            {/* TOTALES */}
            {isSale && (
                <div className="mt-2 px-0">
                    {discount > 0 && (
                        <div className="row-flex t-small justify-end mb-1">
                            <span className="mr-2">SUBTOTAL:</span>
                            <span>$ {formatCurrency(subtotal)}</span>
                        </div>
                    )}
                    {discount > 0 && (
                        <div className="row-flex t-small justify-end mb-1">
                            <span className="mr-2">DESCUENTO:</span>
                            <span>-$ {formatCurrency(discount)}</span>
                        </div>
                    )}
                    
                    <div className="row-flex items-center justify-between mt-2">
                        <span className="t-title">TOTAL</span>
                        <span className="t-big">$ {formatCurrency(total)}</span>
                    </div>
                    <div className="row-flex t-small mt-2 justify-end uppercase">
                         <span className="mr-2 font-bold">FORMA PAGO:</span>
                         <span>{(isSale ? (data.payment?.method || data.paymentMethod) : data.method) || 'EFECTIVO'}</span>
                    </div>
                </div>
            )}

            <div className="border-dash"></div>

            {/* FOOTER */}
            <div className="mt-4 text-center"> 
                {isFiscal ? (
                    <div className="flex flex-col items-center w-full">
                        <div className="bg-white p-1 mb-2" style={{ width: '32mm' }}>
                            {sale.afip.qr && <QRCode value={sale.afip.qr} size={100} style={{ height: "auto", maxWidth: "100%", width: "100%" }} viewBox={`0 0 256 256`} />}
                        </div>
                        <div className="flex items-center justify-center gap-1 w-full mb-1">
                            <span className="italic font-bold t-small">AFIP</span>
                            <span className="t-small">Autorizado</span>
                        </div>
                        <div className="flex justify-between w-full t-small font-mono mt-1 px-2 border border-black/20 p-1">
                            <span>CAE: {sale.afip.cae}</span>
                            <span>VTO: {formatAfipDate(sale.afip.vtoCAE)}</span>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-2 mt-2">
                        {!isSale && (
                            <div className="flex flex-col items-center mt-6">
                                <div className="border-t-2 border-black w-32 mb-1"></div>
                                <span className="t-small">FIRMA</span>
                            </div>
                        )}
                        <p className="t-small pt-2 font-normal">*** NO VÁLIDO COMO FACTURA ***</p>
                    </div>
                )}
                <p className="mt-4 text-[9px] font-mono">SISTEMA: NOAR POS</p>
            </div>
        </div>
    );
};

export const TicketModal = ({ isOpen, onClose, sale, receipt, companyConfig }) => {
  const data = sale || receipt;
  const { user } = useAuthStore(); 
  
  const [dbConfig, setDbConfig] = useState(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  // 🟢 LOGICA OFFLINE: Intentar LocalStorage primero, luego Firestore
  useEffect(() => {
    if (isOpen && user?.companyId) {
        const fetchCompanyData = async () => {
            try {
                // 1. Intentar caché local primero (más rápido y funciona offline)
                const cachedConfig = localStorage.getItem(`NOAR_COMPANY_CONFIG_${user.companyId}`);
                if (cachedConfig) {
                    setDbConfig(JSON.parse(cachedConfig));
                    setLoadingConfig(false);
                    
                    // Si estamos online, revalidar en segundo plano
                    if (navigator.onLine) {
                        try {
                            const docRef = doc(db, 'companies', user.companyId);
                            const snap = await getDoc(docRef);
                            if (snap.exists()) {
                                const freshData = snap.data();
                                setDbConfig(freshData);
                                localStorage.setItem(`NOAR_COMPANY_CONFIG_${user.companyId}`, JSON.stringify(freshData));
                            }
                        } catch(e) { console.warn("Background sync failed"); }
                    }
                    return;
                }

                // 2. Si no hay caché y estamos online, ir a Firestore
                if (navigator.onLine) {
                    const docRef = doc(db, 'companies', user.companyId);
                    const snap = await getDoc(docRef);
                    if (snap.exists()) {
                        const freshData = snap.data();
                        setDbConfig(freshData);
                        localStorage.setItem(`NOAR_COMPANY_CONFIG_${user.companyId}`, JSON.stringify(freshData));
                    }
                }
            } catch (error) {
                console.error("Error cargando datos empresa:", error);
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
    nombre: dbConfig?.name || "TU NEGOCIO",
    razonSocial: dbConfig?.razonSocial || dbConfig?.name || "",
    cuit: dbConfig?.cuit || "",
    direccion: dbConfig?.address || "",
    condicionIva: dbConfig?.taxCondition || "Cons. Final",
    logoUrl: dbConfig?.logoUrl || null,
    ...companyConfig, 
    ...sale?.companySnapshot 
  };

  const handlePrint = () => window.print();

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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-sys-900/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      
      {/* --- VISTA PREVIA (Pantalla) --- */}
      <div className="bg-sys-100 p-6 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto w-full max-w-sm print:hidden flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
              <CheckCircle size={24} className="text-green-500" />
              <h3 className="font-bold text-sys-900 text-lg">Venta Exitosa</h3>
          </div>
          <button onClick={onClose} className="p-2 bg-white text-sys-500 rounded-full hover:bg-sys-200 transition-colors"><X size={20} /></button>
        </div>
        
        {/* Simulador visual */}
        <div className="bg-white mx-auto shadow-lg w-[70mm] min-h-[400px] border-t-8 border-sys-800 p-4 overflow-hidden relative">
             <div className="absolute top-0 right-0 w-8 h-8 bg-sys-800 transform rotate-45 translate-x-4 -translate-y-4"></div>
             {!loadingConfig && (
                 <TicketContent 
                    logoSrc={logoSrc} EMPRESA={EMPRESA} tipoComprobante={tipoComprobante} letra={letra} 
                    isFiscal={isFiscal} sale={sale} data={data} clientData={clientData} 
                    docLabel={docLabel} docValue={docValue} condFiscal={condFiscal} 
                    isSale={isSale} formatAfipDate={formatAfipDate} 
                 />
             )}
        </div>

        <div className="mt-6 flex gap-3">
            <button onClick={onClose} className="flex-1 py-3 bg-white text-sys-600 font-bold rounded-xl border border-sys-200 hover:bg-sys-50 transition-colors">
                Cerrar
            </button>
            <button onClick={handlePrint} className="flex-1 py-3 bg-brand text-white font-bold rounded-xl shadow-lg shadow-brand/20 hover:bg-brand-hover transition-transform active:scale-95 flex items-center justify-center gap-2">
                <Printer size={20} /> Imprimir
            </button>
        </div>
      </div>

      {/* --- ÁREA DE IMPRESIÓN REAL (Invisible en pantalla) --- */}
      <div className="hidden print:block print-area">
          {!loadingConfig && (
              <TicketContent 
                    logoSrc={logoSrc} EMPRESA={EMPRESA} tipoComprobante={tipoComprobante} letra={letra} 
                    isFiscal={isFiscal} sale={sale} data={data} clientData={clientData} 
                    docLabel={docLabel} docValue={docValue} condFiscal={condFiscal} 
                    isSale={isSale} formatAfipDate={formatAfipDate} 
              />
          )}
      </div>

      <style>{`
        @media print {
            @page { 
                size: 58mm auto; /* Ajuste automático de largo */
                margin: 0; 
            }
            
            body { 
                margin: 0; 
                padding: 0;
                background: white;
            }

            /* Ocultar todo lo que no sea el ticket usando visibility (más compatible) */
            body * {
                visibility: hidden;
            }

            /* Mostrar solo el ticket y posicionarlo absolutamente al inicio */
            .print-area, .print-area * {
                visibility: visible;
            }

            .print-area {
                position: absolute;
                top: 0;
                left: 0;
                /* ANCHO IDEAL: 48mm es el ancho de impresión real de una POS58 (dejando margen) */
                width: 48mm; 
                padding: 0;
                margin: 0;
                background: white;
            }

            /* --- TIPOGRAFÍA DE ALTO IMPACTO (Estilo Térmico) --- */
            * {
                color: #000 !important;
                font-family: 'Courier New', Courier, monospace !important; /* Monospace para alineación */
                font-size: 10px !important; /* Letra base */
                line-height: 1.1 !important; 
                font-weight: 700 !important;
                text-transform: uppercase !important;
                -webkit-print-color-adjust: exact;
            }

            /* Tamaños específicos */
            .t-title { font-size: 14px !important; font-weight: 900 !important; display: block; text-align: center; }
            .t-big { font-size: 16px !important; font-weight: 900 !important; }
            .t-normal { font-size: 11px !important; font-weight: 800 !important; }
            .t-small { font-size: 9px !important; font-weight: 600 !important; }
            
            /* Líneas */
            .border-dash { border-bottom: 1px dashed #000 !important; margin: 4px 0 !important; width: 100%; display: block; }
            .border-solid { border-bottom: 1px solid #000 !important; margin: 3px 0 !important; width: 100%; }

            /* Tabla de Items (Flexbox para ajuste perfecto) */
            .row-flex {
                display: flex;
                width: 100%;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 2px;
            }
            
            /* Columnas calibradas */
            .col-qty { width: 15%; text-align: left; }
            .col-desc { 
                width: 60%; 
                text-align: left; 
                padding-right: 2px; 
                white-space: normal; /* Permitir wrap en térmicas */
                overflow: hidden; 
            }
            .col-total { width: 25%; text-align: right; }

            /* Imágenes */
            img, svg { 
                filter: grayscale(100%) contrast(150%) !important; 
                max-width: 100% !important;
            }
            
            ::-webkit-scrollbar { display: none; }
        }
      `}</style>
    </div>
  );
};