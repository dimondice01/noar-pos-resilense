import React, { useState, useEffect } from 'react';
import QRCode from "react-qr-code";
import { X, Printer } from 'lucide-react';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { doc, getDoc } from 'firebase/firestore'; 
import { db } from '../../../database/firebase'; 
import defaultLogo from '../../../assets/logo.png'; 

export const TicketModal = ({ isOpen, onClose, sale, receipt, companyConfig }) => {
  const data = sale || receipt;
  const { user } = useAuthStore(); 
  
  const [dbConfig, setDbConfig] = useState(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  useEffect(() => {
    if (isOpen && user?.companyId) {
        const fetchCompanyData = async () => {
            try {
                const docRef = doc(db, 'companies', user.companyId);
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    setDbConfig(snap.data());
                }
            } catch (error) {
                console.error("Error cargando datos:", error);
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
      <div className="bg-sys-100 p-6 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto w-full max-w-sm print:hidden">
        <div className="flex justify-between items-center mb-4 print:hidden">
          <h3 className="font-bold text-sys-900 text-sm">Vista Previa (POS-58)</h3>
          <div className="flex gap-2">
            <button onClick={handlePrint} className="p-2 bg-brand text-white rounded-full hover:bg-brand-hover shadow-lg"><Printer size={18} /></button>
            <button onClick={onClose} className="p-2 bg-white text-sys-500 rounded-full hover:bg-sys-200"><X size={18} /></button>
          </div>
        </div>
        
        {/* Simulador visual */}
        <div className="bg-white mx-auto shadow-md w-[58mm] min-h-[400px] border-t-8 border-sys-800 p-0 overflow-hidden">
             {!loadingConfig && (
                 <TicketContent 
                    logoSrc={logoSrc} EMPRESA={EMPRESA} tipoComprobante={tipoComprobante} letra={letra} 
                    isFiscal={isFiscal} sale={sale} data={data} clientData={clientData} 
                    docLabel={docLabel} docValue={docValue} condFiscal={condFiscal} 
                    isSale={isSale} formatAfipDate={formatAfipDate} 
                 />
             )}
        </div>
      </div>

      {/* --- ÁREA DE IMPRESIÓN REAL --- */}
      <div className="print-area">
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
                size: 58mm auto; 
                margin: 0; 
            }
            
            body { 
                margin: 0; 
                padding: 0;
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
                /* ANCHO IDEAL: 48mm es el ancho de impresión real de una POS58 */
                width: 48mm; 
                /* Padding nulo para maximizar espacio */
                padding: 0;
                margin: 0;
                background: white;
            }

            /* --- TIPOGRAFÍA DE ALTO IMPACTO --- */
            * {
                color: #000 !important;
                font-family: 'Arial', sans-serif !important;
                /* Letra base GRANDE para no necesitar zoom 130% */
                font-size: 11px !important; 
                /* Separación de renglones para legibilidad */
                line-height: 1.2 !important; 
                font-weight: 800 !important; /* Negrita fuerte */
                text-transform: uppercase !important;
                -webkit-print-color-adjust: exact;
            }

            /* Tamaños específicos */
            .t-title { font-size: 13px !important; font-weight: 900 !important; display: block; }
            .t-big { font-size: 15px !important; font-weight: 900 !important; }
            .t-normal { font-size: 11px !important; font-weight: 800 !important; }
            .t-small { font-size: 10px !important; font-weight: 700 !important; }
            
            /* Líneas */
            .border-dash { border-bottom: 2px dashed #000 !important; margin: 4px 0 !important; width: 100%; display: block; }
            .border-solid { border-bottom: 2px solid #000 !important; margin: 3px 0 !important; width: 100%; }

            /* Tabla de Items (Flexbox para ajuste perfecto) */
            .row-flex {
                display: flex;
                width: 100%;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 2px;
            }
            
            /* Columnas calibradas para que entre todo */
            .col-qty { width: 12%; text-align: left; }
            .col-desc { 
                width: 60%; 
                text-align: left; 
                padding-right: 2px; 
                overflow: hidden; 
                white-space: nowrap; 
                text-overflow: ellipsis; /* Puntos suspensivos si es muy largo */
            }
            .col-total { width: 28%; text-align: right; }

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

// =========================================================
// CONTENIDO DEL TICKET (Diseño Full Width 48mm)
// =========================================================
const TicketContent = ({ logoSrc, EMPRESA, tipoComprobante, letra, isFiscal, sale, data, clientData, docLabel, docValue, condFiscal, isSale, formatAfipDate }) => (
    <div className="w-full bg-white text-black font-bold pb-10"> 
        
        {/* ENCABEZADO */}
        <div className="flex flex-col items-center text-center mb-2 px-0">
            {logoSrc && (
                <img 
                    src={logoSrc} 
                    alt="Logo"
                    className="mb-1 object-contain"
                    style={{ maxHeight: '15mm', maxWidth: '100%' }} 
                />
            )}
            <span className="t-title leading-tight mb-1">{EMPRESA.nombre.substring(0,25)}</span>
            {EMPRESA.direccion && <span className="t-small leading-tight">{EMPRESA.direccion.substring(0,40)}</span>}
            <span className="t-small mt-0.5">{EMPRESA.condicionIva.substring(0,25)}</span>
            {EMPRESA.cuit && <span className="t-small">CUIT: {EMPRESA.cuit}</span>}
        </div>

        <div className="border-dash"></div>

        {/* INFO */}
        <div className="flex justify-between items-end mb-1 px-0">
            <div className="flex flex-col">
                <span className="t-normal">{tipoComprobante} "{letra}"</span>
                <span className="t-small">N° {isFiscal ? String(sale.afip.cbteNumero).padStart(8, '0') : (data.localId?.slice(-8) || '---')}</span>
            </div>
            <div className="flex flex-col text-right">
                <span className="t-small">{new Date(data.date).toLocaleDateString('es-AR')}</span>
                <span className="t-small">{new Date(data.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
        </div>

        {/* CLIENTE */}
        <div className="mb-2">
            <div className="flex t-small"><span className="w-8">CLI:</span> <span className="flex-1 truncate">{clientData.name.substring(0, 20)}</span></div>
            {(docValue !== '-' && docValue !== '0') && (
                <div className="flex t-small"><span className="w-8">{docLabel}:</span> <span>{docValue}</span></div>
            )}
            <div className="flex t-small"><span className="w-8">IVA:</span> <span className="flex-1 truncate">{condFiscal.substring(0,18)}</span></div>
        </div>

        <div className="border-solid"></div>

        {/* ITEMS */}
        {isSale && (
            <div className="mb-2">
                <div className="row-flex t-small pb-1">
                    <div className="col-qty">CNT</div>
                    <div className="col-desc">DESC</div>
                    <div className="col-total">TOTAL</div>
                </div>
                
                <div className="flex flex-col gap-1"> 
                    {data.items.map((item, idx) => (
                    <div key={idx} className="row-flex t-normal">
                        <div className="col-qty">
                            {item.isWeighable ? item.quantity.toFixed(2) : item.quantity}
                        </div>
                        <div className="col-desc">
                            {item.name}
                        </div>
                        <div className="col-total">
                            {Math.round(item.subtotal)}
                        </div>
                    </div>
                    ))}
                </div>
            </div>
        )}

        {/* MOVIMIENTOS CAJA */}
        {!isSale && (
            <div className="text-center py-4">
                <div className="border-2 border-black py-1 mb-2"><span className="t-title">PAGO A CUENTA</span></div>
                <p className="t-normal">MONTO ABONADO:</p>
                <p className="t-big mt-1">$ {data.amount}</p>
            </div>
        )}

        <div className="border-solid"></div>

        {/* TOTALES */}
        {isSale && (
            <div className="mt-2 px-0">
                <div className="row-flex items-center">
                    <span className="t-title">TOTAL</span>
                    <span className="t-big">$ {Math.round(data.total).toLocaleString('es-AR')}</span>
                </div>
                <div className="row-flex t-small mt-1 justify-end">
                     <span className="mr-2">PAGO:</span>
                     <span>{(isSale ? (data.payment?.method || data.paymentMethod) : data.method) || 'EFECTIVO'}</span>
                </div>
            </div>
        )}

        <div className="border-dash"></div>

        {/* FOOTER */}
        <div className="mt-2 text-center"> 
            {isFiscal ? (
                <div className="flex flex-col items-center w-full">
                    <div className="bg-white p-1 mb-2" style={{ width: '32mm' }}>
                        {sale.afip.qr && <QRCode value={sale.afip.qr} size={100} style={{ height: "auto", maxWidth: "100%", width: "100%" }} viewBox={`0 0 256 256`} />}
                    </div>
                    <div className="flex items-center justify-center gap-1 w-full mb-1">
                        <span className="italic font-bold t-small">AFIP</span>
                        <span className="t-small">Autorizado</span>
                    </div>
                    <div className="flex justify-between w-full t-small font-mono mt-1 px-0">
                        <span>CAE: {sale.afip.cae}</span>
                        <span>VTO: {formatAfipDate(sale.afip.vtoCAE)}</span>
                    </div>
                </div>
            ) : (
                <div className="space-y-2 mt-2">
                    {!isSale && (
                        <div className="flex flex-col items-center mt-6">
                            <div className="border-t-2 border-black w-24 mb-1"></div>
                            <span className="t-small">FIRMA</span>
                        </div>
                    )}
                    <p className="t-small pt-2">*** NO VALIDO COMO FACTURA ***</p>
                </div>
            )}
            <p className="mt-4 text-[9px]">SISTEMA: NOAR POS</p>
        </div>
    </div>
);