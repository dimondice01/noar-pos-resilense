import React, { useRef, useEffect } from 'react';
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

// =========================================================
// CONTENIDO DEL TICKET Z
// =========================================================
const TicketZContent = ({ data }) => {
    if (!data) return null;

    // 🔥 DEBUG: Ver qué datos llegan (Abrir consola F12)
    // console.log("Datos recibidos en TicketZ:", data);

    const printDate = new Date().toLocaleString();
    const closeDate = data.closeTime ? new Date(data.closeTime).toLocaleString() : 'PENDIENTE';
    
    // 1. VALORES
    const efvoTeorico = parseFloat(data.expectedCash) || 0;
    const efvoReal = parseFloat(data.declaredCash) || 0;
    const dejadoEnCaja = parseFloat(data.leftInCash) || 0; // 🔥 Aseguramos lectura
    
    // 2. CÁLCULO
    const retiroNeto = Math.max(0, efvoReal - dejadoEnCaja);
    const desvio = efvoReal - efvoTeorico;
    const esPerfecto = Math.abs(desvio) < 10; 

    // 3. MOVIMIENTOS
    const fondoInicial = parseFloat(data.initialAmount) || 0;
    const ingresosExtra = parseFloat(data.cashIn) || 0;
    const egresosExtra = parseFloat(data.cashOut) || 0;
    
    const ventasEfectivo = parseFloat(data.salesByMethod?.cash) || 0;
    const ventasDigital = parseFloat(data.salesByMethod?.digital) || 0;
    const ventasTotales = ventasEfectivo + ventasDigital;

    return (
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
                <div className="row-flex t-small"><span>CAJERO:</span> <span className="uppercase">{data.userName || '---'}</span></div>
                <div className="row-flex t-small"><span>CIERRE:</span> <span>{closeDate}</span></div>
                <div className="row-flex t-small"><span>ID TURNO:</span> <span>#{data.shiftId ? data.shiftId.slice(-6) : '---'}</span></div>
            </div>

            <div className="border-solid"></div>

            {/* FLUJO DE CAJA */}
            <div className="mb-2">
                <p className="t-header">FLUJO DE CAJA</p>
                <div className="row-flex t-normal"><span>(+) FONDO INICIAL:</span><span>{formatMoney(fondoInicial)}</span></div>
                <div className="row-flex t-normal"><span>(+) VENTAS EFECTIVO:</span><span>{formatMoney(ventasEfectivo)}</span></div>
                <div className="row-flex t-normal"><span>(+) INGRESOS EXTRA:</span><span>{formatMoney(ingresosExtra)}</span></div>
                <div className="row-flex t-normal"><span>(-) GASTOS/RETIROS:</span><span>{formatMoney(egresosExtra)}</span></div>
                <div className="border-dash my-1"></div>
                <div className="row-flex t-big"><span>= TEÓRICO CAJA:</span><span>{formatMoney(efvoTeorico)}</span></div>
            </div>

            <div className="border-solid"></div>

            {/* ARQUEO FÍSICO */}
            <div className="mb-2">
                <p className="t-header">ARQUEO FÍSICO</p>
                <div className="row-flex t-big font-bold mt-1"><span>REAL (DECLARADO):</span><span>{formatMoney(efvoReal)}</span></div>
                
                {/* 🔥 DATO CRÍTICO VISIBLE */}
                <div className="row-flex t-normal mt-1"><span>(-) DEJA CAMBIO:</span><span>{formatMoney(dejadoEnCaja)}</span></div>
                
                <div className="border-dash my-1"></div>
                <div className="row-flex t-big font-black"><span>= A RENDIR:</span><span>{formatMoney(retiroNeto)}</span></div>
            </div>

            {/* RESULTADO */}
            <div className="mt-4 p-1 border-2 border-black text-center">
                <p className="t-small font-bold">RESULTADO AUDITORÍA</p>
                <div className="row-flex justify-center gap-2 t-big mt-1">
                    <span>DIFERENCIA:</span>
                    <span>{desvio > 0 ? '+' : ''}{formatMoney(desvio)}</span>
                </div>
                <p className="t-inverse mt-1">{esPerfecto ? ' CAJA BALANCEADA ' : ' REVISAR DIFERENCIAS '}</p>
            </div>

            <div className="border-dash mt-4"></div>

            {/* OTROS MEDIOS */}
            <div className="mb-2">
                <p className="t-header">OTROS MEDIOS</p>
                <div className="row-flex t-normal"><span>TOTAL DIGITAL:</span><span>{formatMoney(ventasDigital)}</span></div>
                <div className="row-flex t-big mt-1"><span>TOTAL VENDIDO:</span><span>{formatMoney(ventasTotales)}</span></div>
                <div className="row-flex t-small mt-1"><span>CANT. OPS:</span><span>{data.salesCount || 0}</span></div>
            </div>

            {/* FIRMAS */}
            <div className="mt-12 space-y-8">
                <div className="flex flex-col items-center">
                    <div className="border-t-2 border-black w-32 mb-1"></div>
                    <span className="t-small">FIRMA CAJERO</span>
                </div>
                <div className="flex flex-col items-center">
                    <div className="border-t-2 border-black w-32 mb-1"></div>
                    <span className="t-small">FIRMA SUPERVISOR</span>
                </div>
            </div>
            <p className="text-center mt-6 t-small">IMPRESO: {printDate}</p>
        </div>
    );
};

// =========================================================
// MODAL PRINCIPAL
// =========================================================
export const TicketZModal = ({ isOpen, onClose, reportData, onConfirmAudit }) => {
    const contentRef = useRef(null);
    
    // Configuración robusta de impresión
    const handlePrint = useReactToPrint({
        contentRef,
        documentTitle: `Z-${new Date().getTime()}`,
        onAfterPrint: () => console.log("Impresión OK"),
        onPrintError: (e) => console.error("Error impresión", e),
        // 🔥 ESTILOS FORZADOS EN EL MOMENTO DE IMPRESIÓN PARA CHROME
        pageStyle: `
            @page { size: 72mm auto; margin: 0mm; }
            @media print {
                body { background-color: white !important; -webkit-print-color-adjust: exact; }
                .ticket-body { width: 100%; padding: 5px; }
            }
        `
    });

    if (!isOpen || !reportData) return null;

    const desvio = (parseFloat(reportData.declaredCash) || 0) - (parseFloat(reportData.expectedCash) || 0);
    const hasIssues = Math.abs(desvio) > 50;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-sys-900/80 backdrop-blur-sm p-4 animate-in fade-in">
            
            {/* MODAL VISIBLE EN PANTALLA */}
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

                {/* VISTA PREVIA */}
                <div className="bg-white mx-auto shadow-lg w-[72mm] min-h-[400px] border-t-8 border-sys-800 overflow-hidden mb-4 relative">
                     {/* Referencia única */}
                     <div ref={contentRef}>
                        <TicketZContent data={reportData} />
                     </div>
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

            {/* ESTILOS CSS PUROS (Sin Tailwind en impresión para evitar conflictos) */}
            <style>{`
                /* ESTILOS DEL TICKET (Se aplican siempre) */
                .ticket-body {
                    font-family: 'Courier New', Courier, monospace;
                    text-transform: uppercase;
                    color: #000;
                    line-height: 1.2;
                    background: white;
                }
                .t-title { font-size: 16px; font-weight: 900; display: block; letter-spacing: 1px; }
                .t-header { font-size: 12px; font-weight: 800; border-bottom: 2px solid #000; display: block; margin-top: 6px; margin-bottom: 2px; }
                .t-big { font-size: 14px; font-weight: 900; }
                .t-normal { font-size: 12px; font-weight: 700; }
                .t-small { font-size: 10px; font-weight: 600; }
                .t-inverse { background: #000; color: #fff; font-weight: bold; font-size: 12px; display: inline-block; padding: 2px 4px; }

                .row-flex { display: flex; justify-content: space-between; width: 100%; }
                .border-dash { border-bottom: 1px dashed #000; margin: 5px 0; width: 100%; }
                .border-solid { border-bottom: 1px solid #000; margin: 5px 0; width: 100%; }

                /* LÓGICA DE IMPRESIÓN */
                @media print {
                    /* Ocultar todo lo que no sea el área de impresión nativa de react-to-print */
                    body * {
                        visibility: hidden;
                    }
                    
                    /* react-to-print crea un div temporal al final del body, ese es el que queremos ver */
                    /* Pero como pasamos contentRef, el contenido dentro de ese ref es lo que importa */
                    
                    #root, .print\\:hidden { display: none !important; }
                    
                    /* Asegurar visibilidad del contenido referenciado */
                    [data-reactroot], html, body {
                        height: auto !important;
                        overflow: visible !important;
                    }
                }
            `}</style>
        </div>
    );
};