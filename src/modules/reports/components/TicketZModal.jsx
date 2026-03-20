import React, { useRef } from 'react';
import { X, Printer, CheckCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { useReactToPrint } from 'react-to-print';
import { cn } from '../../../core/utils/cn';

// Helper de Moneda
const formatMoney = (val) => {
    const num = parseFloat(val);
    if (isNaN(num)) return '$ 0.00';
    return '$ ' + num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Diccionario de Traducción para el Ticket
const PAYMENT_LABELS = {
    cash: 'EFECTIVO',
    mercadopago: 'MERCADOPAGO QR',
    clover: 'TARJETA (CLOVER)',
    point: 'TARJETA (POINT)',
    manual_card: 'TARJETA MANUAL',
    transfer: 'TRANSFERENCIA',
    employee_account: 'CTA. EMPLEADO',
    account: 'CTA. CORRIENTE',
    budget: 'PRESUPUESTO (IGNORAR)',
    digitalOther: 'OTROS DIGITALES'
};

// =========================================================
// CONTENIDO DEL TICKET Z (COMPONENT FOR PRINT)
// =========================================================
// Usamos React.forwardRef para que useReactToPrint acceda al DOM directamente
const TicketZContent = React.forwardRef(({ data }, ref) => {
    if (!data) return null;

    const snap = data.auditSnapshot || {};
    
    const getVal = (...values) => {
        for (const v of values) {
            if (v !== undefined && v !== null && v !== '') return v;
        }
        return 0;
    };

    const getString = (...values) => {
        for (const v of values) {
            if (v && v !== '---') return v;
        }
        return '---';
    };

    const source = {
        id: getString(data.id, data.shiftId),
        userName: getString(snap.shiftName, data.userName, data.shiftName, data.user?.name),
        closedAt: getVal(snap.closeTime, data.closedAt, data.closeTime),
        initialAmount: parseFloat(getVal(snap.initialAmount, data.initialAmount)),
        expectedCash: parseFloat(getVal(snap.expectedCash, data.expectedCash)),
        declaredCash: parseFloat(getVal(snap.declaredCash, data.finalCash, data.declaredCash)),
        leftInCash: parseFloat(getVal(snap.leftInCash, data.leftInCash)),
        cashIn: parseFloat(getVal(snap.cashIn, data.cashIn)), // Ingresos
        cashOut: parseFloat(getVal(snap.cashOut, data.cashOut)), // Salidas
        
        // 🔥 LOS MOVIMIENTOS MANUALES Y DIGITALES EXTRAS LOS LEE TAMBIÉN DEL SNAPSHOT
        manualIn: parseFloat(getVal(snap.manualIn, data.manualIn)),
        manualOut: parseFloat(getVal(snap.manualOut, data.manualOut)),
        digitalIn: parseFloat(getVal(snap.digitalIn, data.digitalIn)), // Total de ingresos digitales extras
        digitalInByMethod: snap.digitalInByMethod || data.digitalInByMethod || {},

        salesByMethod: snap.salesByMethod || data.salesByMethod || { cash: 0 },
        salesCount: getVal(snap.salesCount, data.salesCount),
        totalSales: parseFloat(getVal(snap.totalSales, data.totalSales))
    };

    const printDate = new Date().toLocaleString();
    const closeDate = source.closedAt && source.closedAt !== 0 ? new Date(source.closedAt).toLocaleString() : 'PENDIENTE';
    
    // --- LÓGICA DE CONSISTENCIA VISUAL ---
    // Extraemos totales de VENTAS (El backend ya separó los ingresos extras)
    const ventasEfectivo = parseFloat(source.salesByMethod.cash || 0);
    const mp = parseFloat(source.salesByMethod.mercadopago || 0);
    const clover = parseFloat(source.salesByMethod.clover || 0);
    const point = parseFloat(source.salesByMethod.point || 0);
    const manualCard = parseFloat(source.salesByMethod.manual_card || 0);
    const regularCard = parseFloat(source.salesByMethod.card || 0);
    const transfer = parseFloat(source.salesByMethod.transfer || 0);
    const account = parseFloat(source.salesByMethod.account || source.salesByMethod.employee_account || 0);
    const digitalOther = parseFloat(source.salesByMethod.digitalOther || source.salesByMethod.digital || 0);
    
    const totalTarjetas = clover + point + manualCard + regularCard;
    const ventasDigitales = mp + totalTarjetas + transfer + account + digitalOther;
    
    // Validamos el Total de Ventas Puras
    const ventasTotales = ventasEfectivo + ventasDigitales;

    // 🔥 NUEVO: Cálculo de Cobros de Cta Cte y Otros Ingresos
    const cobrosEfectivo = source.manualIn;
    const cobrosTransferencia = parseFloat(source.digitalInByMethod.transfer || 0);
    const cobrosMercadoPago = parseFloat(source.digitalInByMethod.mercadopago || 0);
    const cobrosTarjetas = parseFloat(source.digitalInByMethod.clover || 0) + parseFloat(source.digitalInByMethod.point || 0) + parseFloat(source.digitalInByMethod.manual_card || 0) + parseFloat(source.digitalInByMethod.card || 0);
    const cobrosOtrosDigitales = parseFloat(source.digitalInByMethod.digitalOther || 0);
    
    const hasCobrosExtras = cobrosEfectivo > 0 || source.digitalIn > 0;

    const retiroNeto = Math.max(0, source.declaredCash - source.leftInCash);
    const desvio = source.declaredCash - source.expectedCash;
    const esPerfecto = Math.abs(desvio) < 10; 

    return (
        <div ref={ref} className="ticket-print-container">
            <div className="ticket-body">
                {/* ENCABEZADO */}
                <div className="text-center mb-2">
                    <h1 className="t-title">CIERRE DE CAJA "Z"</h1>
                    <p className="t-small">*** REPORTE DE AUDITORÍA ***</p>
                    <div className="border-dash"></div>
                </div>

                {/* INFO GENERAL */}
                <div className="mb-2 space-y-1">
                    <div className="row-flex t-small"><span>SUCURSAL:</span> <span>CENTRAL</span></div>
                    <div className="row-flex t-small"><span>CAJERO:</span> <span className="uppercase">{source.userName}</span></div>
                    <div className="row-flex t-small"><span>CIERRE:</span> <span>{closeDate}</span></div>
                    <div className="row-flex t-small"><span>ID TURNO:</span> <span>#{String(source.id).slice(-6)}</span></div>
                </div>

                <div className="border-solid"></div>

                {/* DESGLOSE DE VENTAS */}
                <div className="mb-2">
                    <p className="t-header">VENTAS DEL TURNO</p>
                    
                    <div className="row-flex t-normal mt-1"><span>EFECTIVO:</span><span>{formatMoney(ventasEfectivo)}</span></div>
                    
                    {mp > 0 && <div className="row-flex t-normal"><span>MERCADOPAGO QR:</span><span>{formatMoney(mp)}</span></div>}
                    {totalTarjetas > 0 && <div className="row-flex t-normal"><span>TARJETAS:</span><span>{formatMoney(totalTarjetas)}</span></div>}
                    {transfer > 0 && <div className="row-flex t-normal"><span>TRANSFERENCIA:</span><span>{formatMoney(transfer)}</span></div>}
                    {account > 0 && <div className="row-flex t-normal"><span>CTA CORRIENTE:</span><span>{formatMoney(account)}</span></div>}
                    {digitalOther > 0 && <div className="row-flex t-normal"><span>OTROS DIGITALES:</span><span>{formatMoney(digitalOther)}</span></div>}
                    
                    <div className="border-dash my-1"></div>
                    <div className="row-flex t-big"><span>= TOTAL VENTAS:</span><span>{formatMoney(ventasTotales)}</span></div>
                    <div className="row-flex t-small mt-0.5"><span>CANTIDAD OPS:</span><span>{source.salesCount}</span></div>
                </div>

                {/* 🔥 SECCIÓN DE COBROS Y PAGOS EXTRAS */}
                {(hasCobrosExtras || source.manualOut > 0) && (
                    <>
                        <div className="border-solid"></div>
                        <div className="mb-2">
                            <p className="t-header">OTROS MOVIMIENTOS</p>
                            {cobrosEfectivo > 0 && <div className="row-flex t-normal mt-1"><span>(+) RECIBOS / INGRESOS EFVO:</span><span>{formatMoney(cobrosEfectivo)}</span></div>}
                            {cobrosTransferencia > 0 && <div className="row-flex t-normal mt-1 text-gray-700"><span>(+) RECIBOS TRANSF:</span><span>{formatMoney(cobrosTransferencia)}</span></div>}
                            {cobrosMercadoPago > 0 && <div className="row-flex t-normal mt-1 text-gray-700"><span>(+) RECIBOS MP QR:</span><span>{formatMoney(cobrosMercadoPago)}</span></div>}
                            {cobrosTarjetas > 0 && <div className="row-flex t-normal mt-1 text-gray-700"><span>(+) RECIBOS TARJETAS:</span><span>{formatMoney(cobrosTarjetas)}</span></div>}
                            {cobrosOtrosDigitales > 0 && <div className="row-flex t-normal mt-1 text-gray-700"><span>(+) OTROS ING. DIGITALES:</span><span>{formatMoney(cobrosOtrosDigitales)}</span></div>}
                            
                            {source.manualOut > 0 && <div className="row-flex t-normal mt-1 text-red-600"><span>(-) GASTOS/RETIROS:</span><span>{formatMoney(source.manualOut)}</span></div>}
                        </div>
                    </>
                )}

                <div className="border-solid"></div>

                {/* FLUJO DE CAJA EFECTIVO (SISTEMA) */}
                <div className="mb-2">
                    <p className="t-header">FLUJO EFECTIVO (SISTEMA)</p>
                    <div className="row-flex t-normal mt-1"><span>(+) FONDO INICIAL:</span><span>{formatMoney(source.initialAmount)}</span></div>
                    <div className="row-flex t-normal"><span>(+) VENTAS EFVO:</span><span>{formatMoney(ventasEfectivo)}</span></div>
                    
                    {cobrosEfectivo > 0 && <div className="row-flex t-normal"><span>(+) OTROS INGRESOS:</span><span>{formatMoney(cobrosEfectivo)}</span></div>}
                    {source.manualOut > 0 && <div className="row-flex t-normal text-red-600"><span>(-) GASTOS/RETIROS:</span><span>{formatMoney(source.manualOut)}</span></div>}
                    
                    <div className="border-dash my-1"></div>
                    <div className="row-flex t-big"><span>= TEÓRICO CAJA:</span><span>{formatMoney(source.expectedCash)}</span></div>
                </div>

                <div className="border-solid"></div>

                {/* ARQUEO FÍSICO */}
                <div className="mb-2">
                    <p className="t-header">ARQUEO FÍSICO (CAJERO)</p>
                    <div className="row-flex t-big font-bold mt-1"><span>REAL DECLARADO:</span><span>{formatMoney(source.declaredCash)}</span></div>
                    <div className="row-flex t-normal mt-1"><span>(-) DEJA CAMBIO:</span><span>{formatMoney(source.leftInCash)}</span></div>
                    <div className="border-dash my-1"></div>
                    <div className="row-flex t-big font-black"><span>= A RENDIR (SOBRE):</span><span>{formatMoney(retiroNeto)}</span></div>
                </div>

                {/* RESULTADO */}
                <div className="mt-4 p-1 border-2 border-black text-center result-box">
                    <p className="t-small font-bold">RESULTADO AUDITORÍA</p>
                    <div className="row-flex justify-center gap-2 t-big mt-1">
                        <span>DIFERENCIA:</span>
                        <span>{desvio > 0 ? '+' : ''}{formatMoney(desvio)}</span>
                    </div>
                    <p className="t-inverse mt-1">{esPerfecto ? ' CAJA BALANCEADA ' : ' REVISAR DIFERENCIAS '}</p>
                </div>

                <div className="border-dash mt-4"></div>

                {/* FIRMAS */}
                <div className="mt-12 space-y-8 signature-section">
                    <div className="flex flex-col items-center">
                        <div className="border-t-2 border-black w-32 mb-1"></div>
                        <span className="t-small">FIRMA CAJERO</span>
                    </div>
                    <div className="flex flex-col items-center">
                        <div className="border-t-2 border-black w-32 mb-1"></div>
                        <span className="t-small">FIRMA SUPERVISOR</span>
                    </div>
                </div>
                <p className="text-center mt-6 t-small">SISTEMA SALVADOR POS</p>
                <p className="text-center t-small pb-8">IMPRESO: {printDate}</p>
            </div>
        </div>
    );
});

// =========================================================
// MODAL PRINCIPAL
// =========================================================
export const TicketZModal = ({ isOpen, onClose, reportData, onConfirmAudit }) => {
    const componentRef = useRef(null);
    
    // 🔥 Configuración Blindada para Impresoras Térmicas
    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: `Ticket-Z-${reportData?.id || '000'}`,
    });

    if (!isOpen || !reportData) return null;

    const snap = reportData.auditSnapshot || {};
    const expected = parseFloat(snap.expectedCash ?? reportData.expectedCash ?? 0);
    const declared = parseFloat(reportData.finalCash ?? snap.declaredCash ?? reportData.declaredCash ?? 0);
    const desvio = declared - expected;
    const hasIssues = Math.abs(desvio) > 50;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-sys-900/80 backdrop-blur-sm p-4 animate-in fade-in">
            
            <div className="bg-sys-100 p-6 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto w-full max-w-sm print:hidden flex flex-col">
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h3 className="font-bold text-sys-900 text-lg flex items-center gap-2">
                             <ShieldCheck size={20} className="text-brand"/> Reporte Z
                        </h3>
                        {hasIssues && <span className="text-xs text-red-600 font-bold flex items-center gap-1"><AlertTriangle size={12}/> Diferencia detectada</span>}
                    </div>
                    <button onClick={onClose} className="p-2 bg-white text-sys-500 rounded-full hover:bg-sys-200 transition-colors"><X size={20} /></button>
                </div>

                {/* VISTA PREVIA (Solo pantalla) */}
                <div className="bg-white mx-auto shadow-lg w-full max-w-[72mm] min-h-[400px] border-t-8 border-sys-800 overflow-hidden mb-4 relative">
                     <TicketZContent data={reportData} />
                </div>

                <div className="flex flex-col gap-3">
                    <Button onClick={handlePrint} className="w-full py-4 text-lg shadow-lg shadow-brand/20 bg-brand hover:bg-brand-hover text-white rounded-xl flex items-center justify-center gap-2">
                        <Printer size={20} /> Imprimir Reporte
                    </Button>
                    
                    {onConfirmAudit && (
                        <Button onClick={onConfirmAudit} variant="secondary" className="w-full border-green-200 text-green-700 hover:bg-green-50">
                            <CheckCircle size={18} className="mr-2"/> Aprobar y Archivar
                        </Button>
                    )}
                </div>
            </div>

            {/* 🔥 CONTENEDOR OCULTO PARA IMPRESIÓN (AQUÍ ESTÁ EL TRUCO) */}
            <div style={{ display: 'none' }}>
                <TicketZContent ref={componentRef} data={reportData} />
            </div>

            <style>{`
                /* Estilos del Ticket */
                .ticket-body {
                    width: 100%;
                    padding: 10px;
                    background: white;
                    color: black;
                    font-family: 'Courier New', Courier, monospace;
                    text-transform: uppercase;
                }
                .t-title { font-size: 18px; font-weight: 900; text-align: center; }
                .t-header { font-size: 13px; font-weight: 800; border-bottom: 2px solid black; margin-bottom: 4px; padding-top: 8px; }
                .t-big { font-size: 15px; font-weight: 900; }
                .t-normal { font-size: 12px; font-weight: 700; }
                .t-small { font-size: 11px; font-weight: 600; }
                .t-inverse { background: black; color: white; padding: 2px 4px; font-weight: bold; }
                .row-flex { display: flex; justify-content: space-between; width: 100%; }
                .border-dash { border-bottom: 1px dashed black; margin: 6px 0; }
                .border-solid { border-bottom: 1px solid black; margin: 6px 0; }
                
                /* Configuración de Impresión Térmica */
                @media print {
                    @page {
                        size: 80mm auto; /* Ajuste estándar para térmicas de 80mm o 58mm */
                        margin: 0;
                    }
                    body {
                        margin: 0;
                        padding: 0;
                        background: white;
                    }
                    .ticket-print-container {
                        display: block !important;
                        width: 100% !important;
                        padding: 0 !important;
                        margin: 0 !important;
                    }
                    .ticket-body {
                        width: 100%;
                        padding: 5mm;
                    }
                    .print\\:hidden { display: none !important; }
                }
            `}</style>
        </div>
    );
};