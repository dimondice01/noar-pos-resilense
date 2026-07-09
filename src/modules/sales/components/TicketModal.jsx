import React, { useState, useEffect, useRef, forwardRef, useCallback } from 'react';
import QRCode from "react-qr-code";
import { X, Printer, Ticket, FileText } from 'lucide-react';
import { useReactToPrint } from 'react-to-print';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { doc, getDoc } from 'firebase/firestore'; 
import { db } from '../../../database/firebase'; 
import { getDB } from '../../../database/db'; 
import { Button } from '../../../core/ui/Button'; 
import { cn } from '../../../core/utils/cn'; 
import defaultLogo from '../../../assets/logo.png'; 

// 🔥 Importamos la nueva Factura A4
import { InvoiceA4 } from './InvoiceA4';

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
    
    // Si viene pegado de AFIP (Ej: 20260222 -> 22/02/2026)
    if (str.length === 8 && !str.includes('-')) {
        return `${str.slice(6, 8)}/${str.slice(4, 6)}/${str.slice(0, 4)}`;
    }
    
    // 🔥 FIX: Evita el salto de día por Zona Horaria si viene como YYYY-MM-DD
    if (str.includes('-')) {
        const partes = str.split('T')[0].split('-'); 
        if (partes.length === 3) {
            return `${partes[2]}/${partes[1]}/${partes[0]}`;
        }
    }

    try {
        const date = new Date(str);
        if (!isNaN(date.getTime())) return date.toLocaleDateString('es-AR');
    } catch (e) {}
    return str;
};

const PAYMENT_LABELS = {
    cash: 'EFECTIVO',
    card: 'TARJETA',
    debit: 'DÉBITO',
    credit: 'CRÉDITO',
    transfer: 'TRANSFERENCIA', 
    mercadopago: 'MERCADOPAGO', 
    qr: 'QR / TRANSF.', 
    employee_account: 'CTA. PERSONAL',
    account: 'CTA. CTE. (FIADO)',
    other: 'OTRO',
    split: 'PAGO COMBINADO',
    budget: 'PRESUPUESTO'
};

// =========================================================
// 2. CONTENIDO DEL TICKET (DISEÑO RETAIL 58mm)
// =========================================================
const TicketContent = forwardRef(({ 
    logoSrc, EMPRESA, data, isFiscal 
}, ref) => {
    
    const items = Array.isArray(data.items) ? data.items : [];
    const client = data.client || { name: 'CONSUMIDOR FINAL' };
    const afip = data.afip || {};
    
    let numeroComprobante = "0000-00000000";
    let letraComprobante = "X";
    let tipoComprobante = "TICKET DE VENTA";

    // 🔥 LÓGICA DE DETECCIÓN DE TIPO DE COMPROBANTE CON PRIORIDAD
    const isBudget = data.type === 'BUDGET' || data.status === 'BUDGET';
    const isReceipt = data.type === 'RECEIPT'; // Para los cobros desde el ClientDashboard

    if (isBudget) {
        tipoComprobante = "PRESUPUESTO";
        letraComprobante = "P";
        numeroComprobante = data.number || `ID: ${data.localId?.slice(-8).toUpperCase()}`;
    } else if (isReceipt) {
        tipoComprobante = "RECIBO DE PAGO";
        letraComprobante = "R";
        numeroComprobante = data.number || data.localId || `ID: ${Date.now().toString().slice(-8)}`;
    } else if (isFiscal) {
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
            numeroComprobante = `ID: ${data.localId?.slice(-8).toUpperCase()}`;
        }
    }

    const cae = afip.cae || "";
    const vto = afip.vencimiento || afip.caeFchVto || afip.vtoCAE || "";
    const qrData = afip.qr_data || afip.qr || "";
    
    const docLabel = client.docType === '80' ? 'CUIT' : 'DNI';
    const docValue = (client.docNumber && client.docNumber !== '0') ? client.docNumber : null;
    const condFiscalCliente = (client.fiscalCondition || 'Consumidor Final').replace(/_/g, ' ');

    const total = parseFloat(data.total || data.amount || 0);
    const subtotal = parseFloat(data.subtotal || data.total || 0);
    const surcharge = parseFloat(data.surcharge || 0);
    const discount = parseFloat(data.discount || 0);

    const amountPaid = parseFloat(data.amountPaid || 0);
    const amountDebt = parseFloat(data.amountDebt || 0);
    const newBalance = parseFloat(data.newBalance || 0); 

    let paymentDetails = [];
    if (data.payments && Array.isArray(data.payments) && data.payments.length > 0) {
        paymentDetails = data.payments;
    } else if (data.payment) {
        paymentDetails = [data.payment];
    } else if (data.method) {
        paymentDetails = [{ method: data.method, amount: total }];
    } else {
        paymentDetails = [{ method: 'cash', amount: total }];
    }

    return (
        <div ref={ref} className="ticket-print-container">
            <div className="ticket-body px-2"> 
                
                {/* --- HEADER --- */}
                <div className="flex flex-col items-center mb-2 pb-2 border-b-2 border-black border-dashed text-center">
                    {logoSrc && (
                        <img 
                            src={logoSrc} 
                            alt="Logo"
                            className="mb-1 object-contain grayscale contrast-150 bg-white"
                            style={{ maxHeight: '20mm', maxWidth: '80%' }} 
                            onError={(e) => e.target.style.display = 'none'}
                        />
                    )}
                    
                    {isBudget && (
                        <div className="w-full text-center font-black text-[12px] border-y-2 border-black py-1 my-1 tracking-widest bg-gray-100 print:bg-transparent">
                            *** PRESUPUESTO ***
                        </div>
                    )}
                    
                    <h1 className="text-lg font-black leading-tight uppercase mb-1">{EMPRESA.nombre}</h1>
                    <p className="text-[9px] font-bold uppercase leading-tight mb-1">{EMPRESA.razonSocial}</p>

                    <div className="text-[9px] font-bold uppercase leading-tight">
                        <p>{EMPRESA.direccion}</p>
                        <p className="mt-0.5">{EMPRESA.condicionIva}</p>
                        <p>CUIT: {EMPRESA.cuit}</p>
                        {EMPRESA.iibb && <p>IIBB: {EMPRESA.iibb}</p>}
                        {EMPRESA.inicioAct && <p>INICIO ACT: {formatAfipDate(EMPRESA.inicioAct)}</p>}
                    </div>
                </div>

                {/* --- INFO COMPROBANTE --- */}
                <div className="flex justify-between items-center py-1 border-b-2 border-black mb-2">
                    <div className="flex flex-col">
                        <span className="text-xs font-black leading-none">{tipoComprobante} "{letraComprobante}"</span>
                        <span className="text-[10px] font-mono mt-0.5 font-bold">{numeroComprobante}</span>
                    </div>
                    <div className="text-right text-[9px] font-bold leading-tight">
                        <p>{new Date(data.date || data.createdAt).toLocaleDateString('es-AR')}</p>
                        <p>{new Date(data.date || data.createdAt).toLocaleTimeString('es-AR', {hour: '2-digit', minute:'2-digit'})}</p>
                    </div>
                </div>

                {/* --- CLIENTE --- */}
                <div className="mb-2 text-[9px] font-bold uppercase leading-tight border-b border-black border-dashed pb-1">
                    <div className="flex mb-0.5"><span className="w-10 text-black">CLI:</span> <span className="truncate flex-1">{client.name}</span></div>
                    {docValue && <div className="flex mb-0.5"><span className="w-10">{docLabel}:</span> <span className="font-mono">{docValue}</span></div>}
                    <div className="flex mb-0.5"><span className="w-10">IVA:</span> <span className="truncate flex-1">{condFiscalCliente}</span></div>
                </div>

                {/* --- TABLA ITEMS (Solo si no es recibo) --- */}
                {!isReceipt && (
                    <div className="mb-2">
                        <div className="flex border-b-2 border-black py-0.5 mb-1 text-[9px] font-black bg-gray-100 print:bg-transparent">
                            <div className="w-[15%] text-left">CANT</div>
                            <div className="w-[55%] pl-1">DETALLE</div>
                            <div className="w-[30%] text-right">TOTAL</div>
                        </div>
                        
                        {items.map((item, idx) => {
                            const hasPromo = item.appliedPromo || (item.originalPrice && item.originalPrice > item.price);
                            const qty = parseFloat(item.quantity);
                            const displayQty = (item.isWeighable || qty % 1 !== 0) ? qty.toFixed(3) : Math.round(qty);

                            return (
                                <div key={idx} className="mb-1.5 border-b border-dotted border-gray-400 pb-1 last:border-0 last:pb-0">
                                    <div className="flex items-start text-[10px] font-bold leading-none">
                                        <div className="w-[15%] text-left font-mono">
                                            {displayQty}
                                        </div>
                                        <div className="w-[55%] uppercase pl-1 pr-1 break-words">
                                            {item.name}
                                        </div>
                                        <div className="w-[30%] text-right font-mono text-black">
                                            {formatCurrency(item.subtotal)}
                                        </div>
                                    </div>
                                    {hasPromo ? (
                                        <div className="flex items-center text-[8px] mt-0.5 pl-[15%] text-black font-bold">
                                            <span className="italic uppercase mr-1">{item.promoLabel || "OFERTA"}</span>
                                            {item.originalPrice > 0 && (
                                                <span className="line-through decoration-1 text-[7px]">
                                                    ({formatCurrency(item.originalPrice)})
                                                </span>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="text-[8px] text-right font-mono mt-0.5 text-gray-500 print:text-black">
                                            Unit: {formatCurrency(item.price)}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* --- TOTALES --- */}
                <div className="mt-1 border-t-2 border-black pt-2">
                    {!isReceipt && (
                        <div className="text-[9px] font-bold mb-1 space-y-0.5">
                             <div className="flex justify-between">
                                <span>SUBTOTAL</span>
                                <span className="font-mono">{formatCurrency(subtotal)}</span>
                            </div>
                            {discount > 0 && (
                                <div className="flex justify-between text-black">
                                    <span>DESCUENTO</span>
                                    <span className="font-mono">-{formatCurrency(discount)}</span>
                                </div>
                            )}
                            {surcharge > 0 && !isBudget && (
                                <div className="flex justify-between">
                                    <span>RECARGO</span>
                                    <span className="font-mono">{formatCurrency(surcharge)}</span>
                                </div>
                            )}

                            {/* 🔥 DESGLOSE DE IMPUESTOS (Factura A: Ley 27.743 Título IV inciso a) punto 1) */}
                            {(afip.cbteLetra === 'A' || data.letra === 'A') && parseFloat(afip.impNeto) > 0 && !isBudget && (
                                <div className="mt-1 pt-1 border-t border-black border-dashed">
                                    <div className="flex justify-between mb-0.5">
                                        <span>NETO GRAVADO</span>
                                        <span className="font-mono">{formatCurrency(afip.impNeto)}</span>
                                    </div>
                                    <div className="flex justify-between mb-0.5">
                                        <span>IVA (21%)</span>
                                        <span className="font-mono">{formatCurrency(afip.impIVA)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>OTROS IMP. NAC. INDIRECTOS</span>
                                        <span className="font-mono">{formatCurrency(0)}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 🔥 LEY 27.743 - RÉGIMEN DE TRANSPARENCIA FISCAL AL CONSUMIDOR
                        Factura B (venta a Consumidor Final/Exento): Título IV inciso a) punto 2 + Anexo II Apartado B inciso g) */}
                    {isFiscal && (afip.cbteLetra === 'B') && !isBudget && (
                        <div className="mt-2 pt-1 border-t border-black border-dashed text-[8px] font-bold">
                            <p className="uppercase leading-tight mb-0.5">Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)</p>
                            <div className="flex justify-between text-[9px]">
                                <span>IVA Contenido</span>
                                <span className="font-mono">{formatCurrency(afip.impIVA)}</span>
                            </div>
                            <div className="flex justify-between text-[9px]">
                                <span>Otros Imp. Nac. Indirectos</span>
                                <span className="font-mono">{formatCurrency(0)}</span>
                            </div>
                        </div>
                    )}
                    
                    <div className="flex justify-between items-center border-y-2 border-black py-1 mt-1">
                        <span className="text-base font-black tracking-widest">
                            {isBudget ? "TOTAL PPTADO." : isReceipt ? "IMPORTE PAGO" : "TOTAL"}
                        </span>
                        <span className="text-xl font-black font-mono tracking-tight leading-none">
                            ${formatCurrency(total)}
                        </span>
                    </div>

                    {/* 🔥 RESUMEN FINANCIERO: CTA CTE Y FIADOS 🔥 */}
                    {amountDebt > 0 && !isReceipt && !isBudget && (
                        <div className="mt-1 mb-1 pt-1 border-b-2 border-black text-[10px] font-bold">
                            <div className="flex justify-between text-black mb-0.5">
                                <span>ABONÓ EN ACTO:</span>
                                <span className="font-mono">{formatCurrency(amountPaid)}</span>
                            </div>
                            <div className="flex justify-between text-black">
                                <span>SALDO ADEUDADO:</span>
                                <span className="font-mono">{formatCurrency(amountDebt)}</span>
                            </div>
                        </div>
                    )}

                    {/* 🔥 RESUMEN FINANCIERO: RECIBOS (PAGOS DE CTA CTE) 🔥 */}
                    {isReceipt && (
                        <div className="mt-1 mb-1 pt-1 border-b-2 border-black text-[10px] font-bold">
                            <div className="flex justify-between text-black mb-0.5">
                                <span>ENTREGA A CUENTA:</span>
                                <span className="font-mono">{formatCurrency(total)}</span>
                            </div>
                            <div className="flex justify-between text-black">
                                <span>DEUDA ACTUALIZADA:</span>
                                <span className="font-mono">{formatCurrency(newBalance)}</span>
                            </div>
                        </div>
                    )}
                </div>
                
                {/* --- FORMA DE PAGO --- */}
                <div className="mt-2 mb-3 text-[9px]">
                    {isBudget ? (
                        <div className="text-center py-2 mt-3 font-bold border-2 border-black">
                            DOCUMENTO NO VÁLIDO COMO PAGO
                        </div>
                    ) : (
                        <>
                            <p className="font-black border-b border-black border-dashed mb-0.5 pb-0.5 text-black">
                                {isReceipt ? "MEDIO DE PAGO" : "FORMA DE PAGO"}
                            </p>
                            {paymentDetails.map((p, i) => (
                                <div key={i} className="flex justify-between items-center font-bold py-0.5">
                                    <span className="uppercase">
                                        {PAYMENT_LABELS[p.method] || p.method}
                                        {p.surcharge > 0 && <span className="text-[7px] ml-1 font-normal">(+{formatCurrency(p.surcharge)})</span>}
                                    </span>
                                    <span className="font-mono">{formatCurrency(p.total || p.amount)}</span>
                                </div>
                            ))}
                        </>
                    )}
                </div>

                {/* --- FOOTER FISCAL --- */}
                {isFiscal && !isBudget && cae && (
                    <div className="mt-2 text-center border-t border-black border-dashed pt-2">
                        <div className="flex justify-center mb-1.5">
                            {qrData && <QRCode value={qrData} size={150} level="M" />}
                        </div>
                        <div className="w-full flex flex-col text-[9px] font-mono font-bold mt-1.5">
                            <span>CAE: {cae}</span>
                            <span>VTO: {formatAfipDate(vto)}</span>
                        </div>
                        <div className="text-[8px] font-black uppercase mt-1 italic">Comprobante Autorizado</div>
                    </div>
                )}

                {!isFiscal && !isBudget && !isReceipt && (
                      <div className="mt-3 text-center">
                        <p className="text-[8px] font-bold uppercase border border-black p-1 inline-block">Doc. no válido como factura</p>
                    </div>
                )}
                
                {/* 🔥 MENSAJE FINAL DE PRESUPUESTO */}
                {isBudget && (
                    <div className="mt-3 text-center">
                        <p className="text-[10px] font-black uppercase border-y border-black py-1.5 inline-block w-full">VÁLIDO POR 7 DÍAS</p>
                    </div>
                )}

                <div className="mt-4 text-center pb-4">
                    <p className="text-[10px] font-black uppercase tracking-tight">
                        {isBudget ? "¡ESPERAMOS SU COMPRA!" : "¡GRACIAS POR SU COMPRA!"}
                    </p>
                    <p className="text-[8px] font-mono mt-0.5 font-bold">Operador: {data.userName || data.operatorName || 'Usuario'}</p>
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
    const invoiceA4Ref = useRef(null);
    const modalRef = useRef(null); 
    
    const [branchConfig, setBranchConfig] = useState(() => {
        try {
            const cached = localStorage.getItem(`SALVADOR_BRANCH_CONFIG_${activeBranchId}`);
            return cached ? JSON.parse(cached) : null;
        } catch (e) {
            return null;
        }
    });
    const [viewMode, setViewMode] = useState('ticket'); 

    const handlePrintTicket = useReactToPrint({
        contentRef: componentRef,
        documentTitle: `Ticket-${data?.number || 'venta'}`,
        onAfterPrint: onClose 
    });

    const handlePrintA4 = useReactToPrint({
        contentRef: invoiceA4Ref,
        documentTitle: `Factura-${data?.number || 'venta'}`,
        onAfterPrint: onClose 
    });

    const handlePrint = useCallback(() => {
        if (viewMode === 'a4') {
            handlePrintA4();
        } else {
            handlePrintTicket();
        }
    }, [viewMode, handlePrintA4, handlePrintTicket]);

    useEffect(() => {
        if (isOpen && data) {
            // 🔥 REDUCCIÓN DE LATENCIA: Como el logo es Base64 (Local), no necesitamos esperar a la red
            const timer = setTimeout(() => {
                handlePrint();
            }, 100); 
            return () => clearTimeout(timer);
        }
    }, [isOpen, data, handlePrint]);

    useEffect(() => {
        if (!isOpen) return;
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

    useEffect(() => {
        if (!isOpen || !user?.companyId || !activeBranchId) return;

        const loadConfigInstant = async () => {
            try {
                const dbLocal = await getDB();
                
                // 🔥 1. Intentamos la config específica de la sucursal (Dexie)
                const branchEntry = await dbLocal.config.get(`branch_config_${activeBranchId}`);
                if (branchEntry && branchEntry.value) {
                    setBranchConfig(branchEntry.value);
                    return; // Éxito total
                }

                // 🔥 2. Si no hay de sucursal, probamos la global de empresa (Dexie)
                const companyEntry = await dbLocal.config.get('company_info');
                if (companyEntry && companyEntry.value) {
                    setBranchConfig(prev => ({ 
                        ...prev, 
                        name: companyEntry.value.name, 
                        logoBase64: companyEntry.value.logoUrl 
                    }));
                }

                // 📡 FALLBACK: Solo si no hay NADA local, vamos a Nube (1 sola vez)
                if (navigator.onLine) {
                    const docRef = doc(db, 'companies', user.companyId, 'branches', activeBranchId);
                    const snap = await getDoc(docRef);
                    if (snap.exists()) {
                        const cloudData = snap.data();
                        setBranchConfig(cloudData);
                        // Persistimos para que la próxima sea instantánea
                        await dbLocal.config.put({ key: `branch_config_${activeBranchId}`, value: cloudData });
                    }
                }
            } catch (e) {
                console.warn("Error en carga instantánea de ticket:", e);
            }
        };

        loadConfigInstant();
    }, [isOpen, user?.companyId, activeBranchId]);

    useEffect(() => {
        if (isOpen) setViewMode('ticket');
    }, [isOpen]);

    if (!isOpen || !data) return null;

    const isSale = !!sale;
    const isFiscal = isSale && (sale.afip?.status === 'APPROVED' || !!sale.afip?.cae);

    const EMPRESA = {
        nombre: branchConfig?.name || "MI NEGOCIO",
        razonSocial: branchConfig?.razonSocial || branchConfig?.name || "MI NEGOCIO",
        cuit: branchConfig?.cuit || "",
        direccion: branchConfig?.address || "",
        domicilio: branchConfig?.address || "",
        condicionIva: branchConfig?.taxCondition || "Consumidor Final",
        // 🔥 AHORA LEE DIRECTAMENTE EL BASE64 EN CACHÉ ANTES DE MIRAR LA URL VIEJA
        logoUrl: branchConfig?.logoBase64 || branchConfig?.logoUrl || null,
        iibb: branchConfig?.iibb || "",
        inicioAct: branchConfig?.inicioAct || "",
    };

    const logoSrc = EMPRESA.logoUrl || defaultLogo;

    return (
        <div 
            className="fixed inset-0 z-[-100] opacity-0 pointer-events-none flex items-center justify-center p-4 outline-none print:opacity-100 print:z-auto print:bg-white print:p-0"
            tabIndex={-1} 
            ref={modalRef} 
        >
            <div className={cn(
                "bg-sys-100 p-6 rounded-3xl shadow-2xl w-full flex flex-col max-h-[95vh] print:hidden animate-in fade-in zoom-in duration-200 border-4 border-transparent focus-within:border-brand/20 transition-all",
                viewMode === 'a4' ? "max-w-4xl" : "max-w-sm"
            )}>
                
                <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-2">
                        {viewMode === 'a4' ? <FileText className="text-brand" size={24} /> : <Ticket className="text-brand" size={24} />}
                        <h3 className="font-black text-sys-900 uppercase text-lg">
                            {viewMode === 'a4' ? 'Vista Previa Factura A4' : 'Ticket de Venta 58mm'}
                        </h3>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full"><X size={20}/></button>
                </div>
                
                <div className="bg-white p-4 shadow-inner overflow-y-auto border-t-[8px] border-sys-800 rounded-b-lg mb-4 flex justify-center flex-1 custom-scrollbar">
                    {viewMode === 'ticket' ? (
                        <div className="shadow-md border border-gray-100 p-2 my-auto" style={{width: '240px', minHeight: '300px'}}>
                            <TicketContent 
                                ref={componentRef}
                                logoSrc={logoSrc} 
                                EMPRESA={EMPRESA} 
                                data={data}
                                isFiscal={isFiscal}
                            />
                        </div>
                    ) : (
                        <div className="shadow-2xl border border-gray-200 scale-90 sm:scale-100 origin-top">
                            <div ref={invoiceA4Ref}>
                                <InvoiceA4 sale={data} companyConfig={EMPRESA} />
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                        {isFiscal && (
                            <Button 
                                variant="outline"
                                onClick={() => setViewMode(viewMode === 'a4' ? 'ticket' : 'a4')} 
                                className="flex-1 py-4 font-bold border-sys-300 text-sys-700 bg-white"
                            >
                                {viewMode === 'a4' ? "Ver Ticket (58mm)" : "Ver Factura (A4)"}
                            </Button>
                        )}
                        <Button 
                            onClick={handlePrint} 
                            className={cn("py-4 font-black flex justify-center gap-2 shadow-lg transition-all active:scale-95 group", isFiscal ? "flex-1" : "w-full")}
                        >
                            <Printer size={22} className="group-hover:animate-bounce"/> 
                            <span>IMPRIMIR (ENTER)</span>
                        </Button>
                    </div>
                    <button onClick={onClose} className="w-full py-3 text-sys-500 font-bold uppercase text-xs hover:bg-sys-200 rounded-xl transition-colors mt-1">
                        Cerrar Vista Previa (ESC)
                    </button>
                </div>
            </div>

            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');

                .ticket-print-container { 
                    width: 100%; 
                    background: white; 
                    color: black; 
                }
                
                .ticket-body { 
                    width: 48mm; 
                    margin: 0 auto; 
                    padding: 0;
                    font-family: 'Roboto', sans-serif; 
                    text-transform: uppercase;
                    line-height: 1.1;
                    font-size: 10px; 
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
                .text-left { text-align: left; }
                
                @media print {
                    @page { size: auto; margin: 0; }
                    body { margin: 0; padding: 0; background: white !important; }
                    
                    .ticket-print-container { 
                        display: block !important; 
                        width: 100% !important;
                    }
                    
                    .ticket-body {
                        width: 100% !important;
                        padding-left: 2mm !important;
                        padding-right: 2mm !important;
                        box-sizing: border-box !important;
                    }
                    
                    * { 
                        color: #000 !important; 
                        text-shadow: none !important;
                        box-shadow: none !important;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    
                    img { display: block !important; opacity: 1 !important; margin-left: auto; margin-right: auto; }
                    svg { max-width: 100%; height: auto; }
                }
            `}</style>
        </div>
    );
};