import React, { useState, useEffect, useRef, forwardRef } from 'react';
import QRCode from "react-qr-code";
import { X, Printer, Ticket } from 'lucide-react';
import { useReactToPrint } from 'react-to-print';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { doc, getDoc } from 'firebase/firestore'; 
import { db } from '../../../database/firebase'; 
import { Button } from '../../../core/ui/Button'; 
import defaultLogo from '../../../assets/logo.png'; 

// =========================================================
// 1. HELPERS DE FORMATO
// =========================================================
const formatCurrency = (amount) => {
    const val = parseFloat(amount);
    if (isNaN(val)) return '0.00';
    return val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatAfipDate = (dateStr) => {
    if (!dateStr) return "-";
    const str = String(dateStr);
    if (str.length === 8) {
        return `${str.slice(6, 8)}/${str.slice(4, 6)}/${str.slice(0, 4)}`;
    }
    try {
        const date = new Date(str);
        if (!isNaN(date)) return date.toLocaleDateString('es-AR');
    } catch (e) {}
    return str;
};

const PAYMENT_LABELS = {
    cash: 'EFECTIVO',
    card: 'TARJETA',
    debit: 'DÉBITO',
    credit: 'CRÉDITO',
    qr: 'QR / TRANSFERENCIA',
    other: 'OTRO',
    split: 'COMBINADO'
};

// =========================================================
// 2. CONTENIDO DEL TICKET (DISEÑO RETAIL PRO TÉRMICO)
// =========================================================
const TicketContent = forwardRef(({ 
    logoSrc, EMPRESA, data, isFiscal 
}, ref) => {
    
    const items = Array.isArray(data.items) ? data.items : [];
    const client = data.client || { name: 'CONSUMIDOR FINAL' };
    const afip = data.afip || {};
    
    // --- LÓGICA DE NUMERACIÓN ROBUSTA ---
    let numeroComprobante = "0000-00000000";
    let letraComprobante = "X";
    let tipoComprobante = "TICKET DE VENTA";

    if (isFiscal) {
        const pto = String(afip.ptoVta || "0").padStart(4, '0');
        const num = String(afip.cbteNumero || afip.numero || "0").padStart(8, '0');
        numeroComprobante = `${pto}-${num}`;
        letraComprobante = afip.cbteLetra || "B";
        tipoComprobante = "FACTURA";
    } else {
        if (data.number) {
            numeroComprobante = data.number; 
            const partes = data.number.split('-');
            if (partes.length > 1) letraComprobante = partes[1]; 
        } else {
            numeroComprobante = `INT-${data.localId?.slice(-8).toUpperCase()}`;
        }
    }

    const cae = afip.cae || "";
    const vto = afip.vencimiento || afip.caeFchVto || afip.vtoCAE || "";
    const qrData = afip.qr_data || afip.qr || "";
    
    const docLabel = client.docType === '80' ? 'CUIT' : 'DNI';
    const docValue = (client.docNumber && client.docNumber !== '0') ? client.docNumber : null;
    const condFiscalCliente = (client.fiscalCondition || 'Consumidor Final').replace(/_/g, ' ');

    // Totales
    const total = parseFloat(data.total || 0);
    const subtotal = parseFloat(data.subtotal || data.total || 0);
    const surcharge = parseFloat(data.surcharge || 0);
    const discount = parseFloat(data.discount || 0);

    // 🔥 NORMALIZACIÓN DE PAGOS (Engine Split)
    let paymentDetails = [];
    if (data.payments && Array.isArray(data.payments)) {
        // Nueva Estructura
        paymentDetails = data.payments;
    } else if (data.payment) {
        // Estructura Legacy
        paymentDetails = [data.payment];
    } else {
        // Fallback Extremo
        paymentDetails = [{ method: data.method || 'cash', amount: total }];
    }

    return (
        <div ref={ref} className="ticket-print-container">
            <div className="ticket-body"> 
                
                {/* --- HEADER --- */}
                <div className="flex flex-col items-center mb-3 pb-3 border-b-2 border-black border-dashed">
                    {logoSrc && (
                        <img 
                            src={logoSrc} 
                            alt="Logo"
                            className="mb-2 object-contain grayscale contrast-150"
                            style={{ maxHeight: '25mm', maxWidth: '70%' }} 
                            onError={(e) => e.target.style.display = 'none'}
                        />
                    )}
                    
                    <h1 className="text-xl font-black leading-none uppercase text-center mb-1">{EMPRESA.nombre}</h1>
                    
                    <div className="text-[10px] font-medium text-center uppercase leading-tight px-2">
                        <p>{EMPRESA.direccion}</p>
                        <p className="mt-0.5">{EMPRESA.condicionIva}</p>
                        <p>CUIT: {EMPRESA.cuit} • IIBB: {EMPRESA.iibb || '-'}</p>
                        <p>INICIO: {EMPRESA.inicioAct || '-'}</p>
                    </div>
                </div>

                {/* --- INFO COMPROBANTE --- */}
                <div className="flex justify-between items-center py-2 border-b-2 border-black mb-3">
                    <div className="flex flex-col">
                        <span className="text-sm font-black">{tipoComprobante} "{letraComprobante}"</span>
                        <span className="text-[11px] font-mono mt-0.5 font-bold">{numeroComprobante}</span>
                    </div>
                    <div className="text-right text-[10px] font-bold leading-tight">
                        <p>FECHA: {new Date(data.date).toLocaleDateString('es-AR')}</p>
                        <p>HORA: {new Date(data.date).toLocaleTimeString('es-AR', {hour: '2-digit', minute:'2-digit'})}</p>
                    </div>
                </div>

                {/* --- CLIENTE --- */}
                <div className="mb-3 text-[10px] font-medium uppercase leading-tight border-b border-black border-dashed pb-2">
                    <div className="flex mb-0.5"><span className="w-12 font-bold">CLIENTE:</span> <span className="truncate flex-1 font-bold">{client.name}</span></div>
                    {docValue && <div className="flex mb-0.5"><span className="w-12 font-bold">{docLabel}:</span> <span className="font-mono">{docValue}</span></div>}
                    <div className="flex mb-0.5"><span className="w-12 font-bold">COND:</span> <span>{condFiscalCliente}</span></div>
                    {client.address && <div className="flex"><span className="w-12 font-bold">DIR:</span> <span className="truncate flex-1">{client.address}</span></div>}
                </div>

                {/* --- TABLA ITEMS --- */}
                <div className="mb-3">
                    <div className="flex border-b-2 border-black py-1 mb-2 text-[10px] font-black bg-gray-100 print:bg-transparent">
                        <div className="w-[12%] text-center">CNT</div>
                        <div className="w-[63%] pl-1">DESCRIPCIÓN</div>
                        <div className="w-[25%] text-right">TOTAL</div>
                    </div>
                    
                    {items.map((item, idx) => {
                        const hasPromo = item.appliedPromo || (item.originalPrice && item.originalPrice > item.price);
                        
                        return (
                            <div key={idx} className="mb-2 border-b border-dotted border-gray-400 pb-1 last:border-0 last:pb-0">
                                {/* Línea Principal */}
                                <div className="flex items-start text-[11px] font-bold">
                                    <div className="w-[12%] text-center font-mono">
                                        {item.isWeighable ? parseFloat(item.quantity).toFixed(3) : Math.round(item.quantity)}
                                    </div>
                                    <div className="w-[63%] uppercase leading-tight pl-1 pr-1">
                                        {item.name}
                                    </div>
                                    <div className="w-[25%] text-right font-mono text-black">
                                        {formatCurrency(item.subtotal)}
                                    </div>
                                </div>

                                {/* Línea de Detalle / Promo */}
                                {hasPromo ? (
                                    <div className="flex items-center text-[9px] mt-0.5 ml-[12%] text-black">
                                        <span className="font-bold mr-1">»</span>
                                        <span className="italic uppercase mr-2 font-bold">{item.promoLabel || "OFERTA"}</span>
                                        {item.originalPrice > 0 && (
                                            <span className="line-through decoration-1 mr-1 text-[8px]">
                                                ({formatCurrency(item.originalPrice)} un.)
                                            </span>
                                        )}
                                    </div>
                                ) : (
                                    <div className="text-[9px] text-right font-mono mt-0.5 mr-1 text-gray-500 print:text-black">
                                        Unit: {formatCurrency(item.price)}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* --- TOTALES --- */}
                <div className="mt-2 border-t-2 border-black pt-3">
                    {/* Desglose compacto */}
                    <div className="text-[10px] font-medium mb-2 space-y-1">
                         <div className="flex justify-between">
                            <span className="font-bold">SUBTOTAL</span>
                            <span className="font-mono">{formatCurrency(subtotal)}</span>
                        </div>
                        {discount > 0 && (
                            <div className="flex justify-between font-bold">
                                <span>DESCUENTO</span>
                                <span className="font-mono">-{formatCurrency(discount)}</span>
                            </div>
                        )}
                        {surcharge > 0 && (
                            <div className="flex justify-between">
                                <span>RECARGO FINANCIERO</span>
                                <span className="font-mono">{formatCurrency(surcharge)}</span>
                            </div>
                        )}
                    </div>

                    {/* TOTAL FINAL GRANDE */}
                    <div className="flex justify-between items-center border-y-2 border-black py-2 mt-2">
                        <span className="text-xl font-black tracking-widest pl-1">TOTAL</span>
                        <span className="text-3xl font-black font-mono tracking-tight leading-none pr-1">
                            ${formatCurrency(total)}
                        </span>
                    </div>
                </div>
                
                {/* --- FORMA DE PAGO (SPLIT SUPPORT) --- */}
                <div className="mt-3 mb-4 text-[10px]">
                    <p className="font-black border-b border-black border-dashed mb-1 pb-1">FORMA DE PAGO</p>
                    {paymentDetails.map((p, i) => (
                        <div key={i} className="flex justify-between items-center font-medium py-0.5">
                            <span className="uppercase font-bold">
                                {PAYMENT_LABELS[p.method] || p.method}
                                {p.surcharge > 0 && <span className="text-[8px] ml-1 font-normal">(Rec. {formatCurrency(p.surcharge)})</span>}
                            </span>
                            <span className="font-mono">{formatCurrency(p.total || p.amount)}</span>
                        </div>
                    ))}
                </div>

                {/* --- FOOTER FISCAL --- */}
                {isFiscal && cae && (
                    <div className="mt-2 text-center border-t border-black border-dashed pt-3">
                        <div className="flex justify-center mb-2">
                            {qrData && <QRCode value={qrData} size={110} level="M" />}
                        </div>
                        <div className="w-full flex justify-between text-[10px] font-mono font-bold px-2">
                            <span>CAE: {cae}</span>
                            <span>VTO: {formatAfipDate(vto)}</span>
                        </div>
                        <div className="text-[9px] font-black uppercase mt-1 italic">Comprobante Autorizado</div>
                    </div>
                )}

                {!isFiscal && (
                      <div className="mt-4 text-center">
                        <p className="text-[9px] font-bold uppercase border-2 border-black p-1 inline-block">Documento no válido como factura</p>
                    </div>
                )}

                <div className="mt-6 text-center pb-8">
                    <p className="text-[11px] font-black uppercase">*** ¡GRACIAS POR SU COMPRA! ***</p>
                    <p className="text-[8px] font-mono mt-1">Usuario: {data.userName || 'Cajero'}</p>
                </div>
            </div>
        </div>
    );
});

// =========================================================
// 3. MODAL PRINCIPAL (CON KEYBOARD LISTENERS)
// =========================================================
export const TicketModal = ({ isOpen, onClose, sale, receipt }) => {
    const data = sale || receipt;
    const { user, activeBranchId } = useAuthStore(); 
    const componentRef = useRef(null);
    const modalRef = useRef(null); // Ref para el foco
    const [branchConfig, setBranchConfig] = useState(null);

    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: `Ticket-${data?.number || 'venta'}`,
        onAfterPrint: () => console.log("✅ Impresión finalizada"),
    });

    // 🔥 KEYBOARD LISTENER (ENTER = PRINT, ESC = CLOSE)
    useEffect(() => {
        if (!isOpen) return;

        // Enfocar el modal para capturar teclas inmediatamente
        setTimeout(() => modalRef.current?.focus(), 50);

        const handleKeyDown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handlePrint();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, handlePrint, onClose]);

    // Cargar Configuración de Sucursal para el Header del Ticket
    useEffect(() => {
        if (isOpen && user?.companyId && activeBranchId) {
            const fetchConfig = async () => {
                try {
                    const cacheKey = `SALVADOR_BRANCH_CONFIG_${activeBranchId}`;
                    const cached = localStorage.getItem(cacheKey);
                    if (cached) setBranchConfig(JSON.parse(cached));

                    if (navigator.onLine) {
                        const docRef = doc(db, 'companies', user.companyId, 'branches', activeBranchId);
                        const snap = await getDoc(docRef);
                        
                        if (snap.exists()) {
                            const freshData = snap.data();
                            setBranchConfig(freshData);
                            localStorage.setItem(cacheKey, JSON.stringify(freshData));
                        } else {
                            // Fallback a empresa general si no hay config de sucursal
                            const compRef = doc(db, 'companies', user.companyId);
                            const compSnap = await getDoc(compRef);
                            if (compSnap.exists()) setBranchConfig(compSnap.data());
                        }
                    }
                } catch (e) { console.error(e); }
            };
            fetchConfig();
        }
    }, [isOpen, user?.companyId, activeBranchId]);

    if (!isOpen || !data) return null;

    const isSale = !!sale;
    const isFiscal = isSale && (sale.afip?.status === 'APPROVED' || !!sale.afip?.cae);

    const EMPRESA = {
        nombre: branchConfig?.name || "MI NEGOCIO",
        cuit: branchConfig?.cuit || "",
        direccion: branchConfig?.address || "",
        condicionIva: branchConfig?.taxCondition || "Consumidor Final",
        logoUrl: branchConfig?.logoUrl || null,
        iibb: branchConfig?.iibb || "",
        inicioAct: branchConfig?.inicioAct || "",
    };

    const logoSrc = EMPRESA.logoUrl || defaultLogo;

    return (
        <div 
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 outline-none"
            tabIndex={-1} // Permite recibir foco
            ref={modalRef} // Referencia para focus()
        >
            <div className="bg-sys-100 p-6 rounded-3xl shadow-2xl w-full max-w-sm flex flex-col max-h-[95vh] print:hidden animate-in fade-in zoom-in duration-200 border-4 border-transparent focus-within:border-brand/20 transition-colors">
                <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-2">
                        <Ticket className="text-brand" size={24} />
                        <h3 className="font-black text-sys-900 uppercase text-lg">Ticket de Venta</h3>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full"><X size={20}/></button>
                </div>
                
                {/* PREVIEW CONTAINER */}
                <div className="bg-white p-4 shadow-inner overflow-y-auto border-t-[8px] border-sys-800 rounded-b-lg mb-4" style={{maxHeight: '450px'}}>
                    <TicketContent 
                        ref={componentRef}
                        logoSrc={logoSrc} 
                        EMPRESA={EMPRESA} 
                        data={data}
                        isFiscal={isFiscal}
                    />
                </div>

                <div className="flex flex-col gap-2">
                    <Button 
                        onClick={handlePrint} 
                        className="w-full py-4 bg-brand hover:bg-brand-dark text-white font-black rounded-xl flex justify-center gap-2 shadow-lg shadow-brand/20 transition-all active:scale-95 group"
                    >
                        <Printer size={22} className="group-hover:animate-bounce"/> 
                        <span>IMPRIMIR (ENTER)</span>
                    </Button>
                    <button onClick={onClose} className="w-full py-3 text-sys-500 font-bold uppercase text-xs hover:bg-sys-200 rounded-xl transition-colors">
                        Cerrar Vista Previa (ESC)
                    </button>
                </div>
            </div>

            {/* ESTILOS DE IMPRESIÓN (MODO RETAIL) */}
            <style>{`
                /* Fuente del sistema, limpia y legible */
                @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');

                .ticket-print-container { width: 100%; background: white; color: black; }
                
                .ticket-body { 
                    width: 72mm; /* Ancho estándar térmico 80mm con márgenes */
                    margin: 0 auto; 
                    padding: 0;
                    font-family: 'Roboto', sans-serif; 
                    text-transform: uppercase;
                    line-height: 1.1;
                    font-size: 11px;
                }

                .font-mono { font-family: 'Courier New', monospace !important; letter-spacing: -0.5px; }
                .font-bold { font-weight: 700; }
                .font-black { font-weight: 900; }

                .flex { display: flex; }
                .flex-col { flex-direction: column; }
                .items-center { align-items: center; }
                .justify-between { justify-content: space-between; }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                
                /* Ocultar en impresión y ajustes finales */
                @media print {
                    @page { size: 80mm auto; margin: 0; }
                    body { margin: 0; padding: 0; background: white !important; }
                    .ticket-print-container { display: block !important; }
                    
                    /* Forzar negro puro para impresoras térmicas */
                    * { 
                        color: #000 !important; 
                        text-shadow: none !important;
                        box-shadow: none !important;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    
                    /* Asegurar que las imágenes (logo/qr) se impriman */
                    img { display: block !important; opacity: 1 !important; }
                }
            `}</style>
        </div>
    );
};