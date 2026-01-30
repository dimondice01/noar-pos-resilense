import React, { useState, useEffect, useRef, forwardRef } from 'react';
import QRCode from "react-qr-code";
import { X, Printer, CheckCircle } from 'lucide-react';
import { useReactToPrint } from 'react-to-print';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { doc, getDoc } from 'firebase/firestore'; 
import { db } from '../../../database/firebase'; 
import { Button } from '../../../core/ui/Button'; 
import defaultLogo from '../../../assets/logo.png'; 

// =========================================================
// 1. HELPERS
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

// =========================================================
// 2. CONTENIDO DEL TICKET (DISEÑO RETAIL PREMIUM)
// =========================================================
const TicketContent = forwardRef(({ 
    logoSrc, EMPRESA, data, isFiscal, isSale 
}, ref) => {
    
    const items = Array.isArray(data.items) ? data.items : [];
    const client = data.client || { name: 'CONSUMIDOR FINAL' };
    const afip = data.afip || {};
    
    // Mapeo de datos
    const ptoVta = afip.ptoVta || afip.puntoVenta || "0000";
    const numero = afip.numero || afip.cbteNumero || afip.nro || "00000000";
    const letra = afip.letra || afip.cbteLetra || "X";
    const tipoCbteCode = afip.tipo || afip.cbteTipo || (isFiscal ? "011" : "NO FISCAL");
    const cae = afip.cae || "";
    const vto = afip.vencimiento || afip.caeFchVto || afip.vtoCAE || "";
    const qrData = afip.qr_data || afip.qr || "";

    const tituloComprobante = isFiscal ? "FACTURA" : "TICKET X"; // Más corto, más grande
    const docLabel = client.docType === '80' ? 'CUIT' : 'DNI';
    const docValue = (client.docNumber && client.docNumber !== '0') ? client.docNumber : null;
    const condFiscalCliente = (client.fiscalCondition || 'Consumidor Final').replace(/_/g, ' ');

    // Totales
    const total = parseFloat(data.totalSale || data.total || 0);
    const subtotal = parseFloat(data.baseAmount || data.total || 0);
    const surcharge = parseFloat(data.surcharge || 0);
    const discount = parseFloat(data.discount || 0);

    return (
        <div ref={ref} className="ticket-print-container">
            <div className="ticket-body"> 
                
                {/* --- BRANDING HEADER --- */}
                <div className="flex flex-col items-center mb-2">
                    {logoSrc && (
                        <img 
                            src={logoSrc} 
                            alt="Logo"
                            className="mb-2 object-contain"
                            // Aumentamos tamaño para que se luzca en la impresión
                            style={{ maxHeight: '25mm', maxWidth: '90%', filter: 'grayscale(100%) contrast(150%)' }} 
                            onError={(e) => e.target.style.display = 'none'}
                        />
                    )}
                    
                    <h1 className="text-lg font-black leading-none uppercase text-center mt-1">{EMPRESA.nombre}</h1>
                    
                    <div className="text-[10px] font-bold text-center uppercase leading-tight mt-1 px-2">
                        <p>{EMPRESA.direccion}</p>
                        <p className="mt-0.5">{EMPRESA.condicionIva} • CUIT: {EMPRESA.cuit}</p>
                        <p>IIBB: {EMPRESA.iibb || 'Exento'} • INICIO: {EMPRESA.inicioAct || '-'}</p>
                    </div>
                </div>

                {/* --- TIPO COMPROBANTE (Barra Sólida) --- */}
                <div className="border-y-2 border-black py-1 my-2 flex justify-between items-center">
                    <div className="flex flex-col">
                        <span className="text-xs font-black tracking-wider">{tituloComprobante}</span>
                        <span className="text-xs font-bold font-mono">
                            N° {String(ptoVta).padStart(4, '0')}-{String(numero).padStart(8, '0')}
                        </span>
                    </div>
                    {/* CUADRO LETRA */}
                    <div className="border-2 border-black w-9 h-9 flex flex-col items-center justify-center bg-white">
                        <span className="text-xl font-black leading-none">{letra}</span>
                        <span className="text-[6px] font-bold leading-none mt-0.5">COD {tipoCbteCode}</span>
                    </div>
                </div>

                {/* --- FECHA Y CLIENTE --- */}
                <div className="mb-2 text-[10px] font-bold uppercase leading-tight">
                    <div className="flex justify-between mb-1">
                        <span>FECHA: {new Date(data.date).toLocaleDateString('es-AR')}</span>
                        <span>HORA: {new Date(data.date).toLocaleTimeString('es-AR', {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                    
                    <div className="border-t border-black border-dashed my-1"></div>
                    
                    <div className="flex"><span className="w-12">CLIENTE:</span> <span className="font-black truncate flex-1">{client.name}</span></div>
                    {docValue && <div className="flex"><span className="w-12">{docLabel}:</span> <span className="font-mono font-black">{docValue}</span></div>}
                    <div className="flex"><span className="w-12">COND:</span> <span>{condFiscalCliente}</span></div>
                    {client.address && <div className="flex"><span className="w-12">DOM:</span> <span className="truncate flex-1">{client.address}</span></div>}
                </div>

                {/* --- ITEMS TABLE (Estilo Supermercado) --- */}
                <div className="mb-2">
                    <div className="flex border-y border-black py-0.5 mb-1 text-[9px] font-black">
                        <div className="w-[12%] text-center">CNT</div>
                        <div className="w-[63%]">PRODUCTO</div>
                        <div className="w-[25%] text-right">IMPORTE</div>
                    </div>
                    
                    {items.map((item, idx) => (
                        <div key={idx} className="flex mb-1 items-start text-[10px] font-bold">
                            <div className="w-[12%] text-center font-mono pt-0.5">
                                {item.isWeighable ? parseFloat(item.quantity).toFixed(3) : Math.round(item.quantity)}
                            </div>
                            <div className="w-[63%] uppercase leading-tight pr-1">
                                {item.name}
                            </div>
                            <div className="w-[25%] text-right font-mono font-black pt-0.5">
                                {formatCurrency(item.subtotal || (item.price * item.quantity))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* --- TOTALES (Jerarquía Alta) --- */}
                <div className="mt-3 border-t-2 border-black pt-1">
                    <div className="flex justify-between text-[10px] font-bold">
                        <span>SUBTOTAL</span>
                        <span className="font-mono">{formatCurrency(subtotal)}</span>
                    </div>
                    {discount > 0 && (
                        <div className="flex justify-between text-[10px] font-bold">
                            <span>DESCUENTO</span>
                            <span className="font-mono">-{formatCurrency(discount)}</span>
                        </div>
                    )}
                    {surcharge > 0 && (
                        <div className="flex justify-between text-[10px] font-bold">
                            <span>RECARGO</span>
                            <span className="font-mono">{formatCurrency(surcharge)}</span>
                        </div>
                    )}

                    <div className="flex justify-between items-end mt-2 mb-1">
                        <span className="text-lg font-black tracking-tighter">TOTAL</span>
                        <span className="text-2xl font-black font-mono tracking-tight leading-none">
                            ${formatCurrency(total)}
                        </span>
                    </div>
                </div>
                
                <div className="text-[10px] font-bold uppercase text-right mb-4">
                    PAGO: {(isSale ? (data.payment?.method || data.paymentMethod) : data.method) || 'EFECTIVO'}
                </div>

                {/* --- FOOTER FISCAL --- */}
                {isFiscal && cae && (
                    <div className="mt-2 pt-2 border-t border-black border-dashed text-center">
                        <div className="flex flex-col items-center">
                            {/* QR GRANDE */}
                            <div className="bg-white p-1 mb-2">
                                {qrData && <QRCode value={qrData} size={110} level="L" />}
                            </div>
                            
                            <div className="text-[9px] font-black uppercase mb-1">
                                COMPROBANTE AUTORIZADO
                            </div>

                            <div className="w-full border-2 border-black p-1 flex justify-between text-[10px] font-mono font-bold bg-white text-black">
                                <div className="flex flex-col items-start">
                                    <span>CAE:</span>
                                    <span>VTO:</span>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span>{cae}</span>
                                    <span>{formatAfipDate(vto)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {!isFiscal && (
                     <div className="mt-4 border-2 border-black p-2 text-center">
                        <p className="text-[10px] font-black uppercase">Documento no válido como factura</p>
                    </div>
                )}

                <div className="mt-4 text-center">
                    <p className="text-[10px] font-black uppercase">*** ¡GRACIAS POR SU COMPRA! ***</p>
                    <p className="text-[8px] font-mono mt-1">{data.id || data.localId}</p>
                </div>
            </div>
        </div>
    );
});

// =========================================================
// 3. MODAL PRINCIPAL
// =========================================================
export const TicketModal = ({ isOpen, onClose, sale, receipt }) => {
    const data = sale || receipt;
    const { user, activeBranchId } = useAuthStore(); 
    const componentRef = useRef(null);
    const [branchConfig, setBranchConfig] = useState(null);

    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: `Ticket-${data?.number || 'venta'}`,
        onAfterPrint: () => console.log("✅ Impresión finalizada"),
    });

    // Cargar Configuración
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
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-sys-100 p-6 rounded-3xl shadow-2xl w-full max-w-sm flex flex-col max-h-[95vh] print:hidden">
                <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-2">
                        <CheckCircle className="text-green-500" size={24} />
                        <h3 className="font-black text-sys-900 uppercase text-lg">Ticket Listo</h3>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full"><X size={20}/></button>
                </div>
                
                {/* PREVIEW */}
                <div className="bg-white p-4 shadow-inner overflow-y-auto border-t-[10px] border-sys-800 rounded-b-lg mb-4" style={{maxHeight: '450px'}}>
                    <TicketContent 
                        ref={componentRef}
                        logoSrc={logoSrc} 
                        EMPRESA={EMPRESA} 
                        data={data}
                        isFiscal={isFiscal}
                        isSale={isSale}
                    />
                </div>

                <div className="flex flex-col gap-2">
                    <Button 
                        onClick={handlePrint} 
                        className="w-full py-4 bg-brand hover:bg-brand-dark text-white font-black rounded-xl flex justify-center gap-2 shadow-lg shadow-brand/20 transition-all active:scale-95"
                    >
                        <Printer size={22}/> IMPRIMIR TICKET
                    </Button>
                    <button onClick={onClose} className="w-full py-3 text-sys-500 font-bold uppercase text-xs hover:bg-sys-200 rounded-xl">
                        Cerrar
                    </button>
                </div>
            </div>

            {/* ESTILOS DE IMPRESIÓN (MODO RETAIL) */}
            <style>{`
                /* Fuente del sistema, limpia y legible */
                @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700;900&display=swap');

                .ticket-print-container { width: 100%; background: white; color: black; }
                
                .ticket-body { 
                    width: 72mm; /* Margen de seguridad para papel de 80mm */
                    margin: 0 auto; 
                    padding: 0;
                    /* Usamos Sans-Serif para textos por legibilidad */
                    font-family: 'Roboto', Helvetica, Arial, sans-serif; 
                    text-transform: uppercase;
                    line-height: 1.2;
                }

                /* Números siempre en Monospace para alinear decimales */
                .font-mono { font-family: 'Courier New', Courier, monospace !important; letter-spacing: -0.5px; }
                
                /* Negritas reales para impresora térmica */
                .font-bold { font-weight: 700; }
                .font-black { font-weight: 900; }

                /* Utilidades para flex */
                .flex { display: flex; }
                .flex-col { flex-direction: column; }
                .items-center { align-items: center; }
                .justify-between { justify-content: space-between; }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                
                /* Ocultar en impresión */
                @media print {
                    @page { size: 80mm auto; margin: 0; }
                    body { margin: 0; padding: 0; background: white !important; }
                    .ticket-print-container { display: block !important; }
                    
                    /* Forzar contraste máximo */
                    * { 
                        color: #000 !important; 
                        text-shadow: none !important;
                        box-shadow: none !important;
                    }
                }
            `}</style>
        </div>
    );
};