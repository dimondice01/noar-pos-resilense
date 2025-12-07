// src/modules/reports/components/TicketZModal.jsx
import React, { useRef } from 'react';
import { X, Printer, Download, TrendingUp, TrendingDown, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

// Dependencias de PDF (Asumiendo que se instalaron: jspdf, html2canvas)
// Si fallan, el usuario debe instalar: npm install jspdf html2canvas
import html2canvas from 'html2canvas'; 
import jsPDF from 'jspdf';

// Utilidades para formato
const formatCurrency = (amount) => `$ ${Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

// --- COMPONENTE ---
export const TicketZModal = ({ isOpen, onClose, reportData }) => {
  const reportRef = useRef(null);
  
  if (!isOpen || !reportData) return null;

  const isPositiveDeviation = reportData.deviation >= 0;
  const isPerfectMatch = reportData.deviation === 0;

  const handleDownloadPDF = async () => {
    const reportElement = reportRef.current;
    if (!reportElement) return;

    // 1. Preparación para captura de alta resolución
    const scale = 3; 
    const originalWidth = reportElement.offsetWidth;
    const originalHeight = reportElement.offsetHeight;

    // 2. Generar Canvas (Captura la estructura HTML)
    const canvas = await html2canvas(reportElement, {
      scale: scale, 
      useCORS: true,
      allowTaint: true,
      scrollX: 0,
      scrollY: 0,
      windowWidth: originalWidth,
      windowHeight: originalHeight
    });

    // 3. Generar PDF (Formato de ticket angosto: 80mm ancho)
    const imgData = canvas.toDataURL('image/jpeg', 1.0);
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [80, 297] // Ancho 80mm, Altura A4 (base)
    });

    // Calcula la altura de la imagen en mm para el ancho de 80mm
    const imgWidth = 80;
    const imgHeight = (canvas.height * imgWidth) / canvas.width / scale; // Dividir por scale para obtener el tamaño real en mm

    // Si la altura supera A4 (297mm), ajustamos el tamaño de la página para evitar cortes
    if (imgHeight > 297) {
        pdf.internal.pageSize.height = imgHeight; 
    }
    
    // Convertir el canvas al tamaño del PDF
    pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
    pdf.save(`Ticket_Z_${new Date().toISOString().substring(0, 10)}.pdf`);
  };
  
  // Contenedor principal con efecto WOW (zoom-in)
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-sys-900/80 backdrop-blur-md p-4 animate-in fade-in zoom-in-95 duration-200 print:hidden">
      
      {/* Botones de acción flotantes */}
      <div className="absolute top-4 right-4 flex gap-3 z-[100]">
         <Button 
            onClick={handleDownloadPDF} 
            className="shadow-xl shadow-brand/20"
            title="Descargar Reporte PDF"
         >
            <Download size={18} className="mr-2" /> Descargar
         </Button>
         <Button onClick={onClose} variant="secondary" className="bg-white/10 text-white hover:bg-white/20 border-white/30">
            <X size={20} />
         </Button>
      </div>
      
      {/* Zona de Renderizado Oculta para captura (Ref) */}
      <div 
        ref={reportRef}
        // Tailwind para que el PDF se vea ancho y bien en el modal
        className="bg-white text-sys-900 font-mono text-[11px] leading-tight w-full max-w-[320px] shadow-lg rounded-xl overflow-y-auto max-h-[90vh]" 
      >
        <div className="p-6">
           <div className="text-center w-full border-b border-sys-900 pb-3 mb-4 space-y-1">
              <h1 className="font-sans font-black text-xl tracking-tight text-sys-900 mb-1">REPORTE Z</h1>
              <p className="font-bold text-sm uppercase">AUDITORÍA DE CAJA FINAL</p>
              <p className="text-xs text-sys-500">CAJERO: {reportData.shiftName}</p> 
           </div>

           {/* DATOS GENERALES */}
           <div className="w-full text-left mb-4 text-[11px]">
               <p className="flex justify-between border-b border-dashed border-sys-200 pb-1 mb-1"><span className="font-bold">Fecha/Hora Cierre:</span> {new Date(reportData.closeTime).toLocaleString('es-AR')}</p>
               <p className="flex justify-between border-b border-dashed border-sys-200 pb-1 mb-1"><span className="font-bold">Ventas Totales:</span> {reportData.salesCount}</p>
               <p className="flex justify-between border-b border-dashed border-sys-200 pb-1 mb-1"><span className="font-bold">Balance Inicial:</span> {formatCurrency(reportData.initialAmount)}</p>
           </div>
           
           {/* RESUMEN FINANCIERO */}
           <div className="w-full border-b border-sys-900 pb-3 mb-4">
              <p className="font-bold text-sm mb-2">RESUMEN POR MEDIO</p>
              <div className="space-y-1 text-xs">
                  {Object.entries(reportData.salesByMethod).map(([method, amount]) => (
                      <div key={method} className="flex justify-between items-center text-sys-700">
                          <span className="capitalize">{method.replace('mercadopago', 'MP QR').replace('digitalOther', 'Otros Digitales')}</span>
                          <span>{formatCurrency(amount)}</span>
                      </div>
                  ))}
                  <div className="pt-2 flex justify-between font-bold border-t border-dashed border-sys-300">
                      <span>MONTO TOTAL VENDIDO</span>
                      <span>{formatCurrency(reportData.totalSales)}</span>
                  </div>
              </div>
           </div>
           
           {/* CUENTA DE EFECTIVO */}
           <div className="w-full mb-4">
              <p className="font-bold text-sm mb-2">MOVIMIENTOS DE CAJA</p>
              <div className="space-y-1 text-xs">
                  <p className="flex justify-between text-sys-700"><span className="font-bold">(+) Ingresos Manuales:</span> {formatCurrency(reportData.cashIn)}</p>
                  <p className="flex justify-between text-sys-700"><span className="font-bold">(-) Egresos/Retiros:</span> {formatCurrency(reportData.cashOut)}</p>
                  <div className="pt-2 flex justify-between font-bold border-t border-dashed border-sys-300">
                      <span>EFECTIVO ESPERADO EN CAJA:</span>
                      <span className="text-blue-600">{formatCurrency(reportData.expectedCash)}</span>
                  </div>
              </div>
           </div>
           
           {/* DESVÍO (RESULTADO CLAVE) */}
           <div className={cn(
             "p-4 rounded-xl text-center border-2",
             isPerfectMatch ? "bg-green-50 border-green-200" :
             isPositiveDeviation ? "bg-orange-50 border-orange-200" : "bg-red-50 border-red-200"
           )}>
               <div className="flex justify-between items-center font-bold text-lg">
                   <p className="text-sm">EFECTIVO REAL DECLARADO:</p>
                   <p className={cn(
                       "text-sys-900",
                       isPerfectMatch ? "text-green-700" : isPositiveDeviation ? "text-orange-700" : "text-red-700"
                   )}>
                       {formatCurrency(reportData.actualCash)}
                   </p>
               </div>
               <div className="flex justify-between items-center text-sm pt-2 mt-2 border-t border-dashed border-sys-300">
                   <p className={cn("font-bold text-base flex items-center gap-1", isPerfectMatch ? "text-green-700" : isPositiveDeviation ? "text-orange-700" : "text-red-700")}>
                      {isPerfectMatch ? <CheckCircle2 size={16} /> : isPositiveDeviation ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                      DESVÍO ({isPerfectMatch ? 'EXACTO' : 'MONTO A AJUSTAR'}):
                   </p>
                   <p className={cn(
                       "text-lg font-black",
                       isPerfectMatch ? "text-green-700" : isPositiveDeviation ? "text-orange-700" : "text-red-700"
                   )}>
                       {formatCurrency(Math.abs(reportData.deviation))}
                   </p>
               </div>
           </div>

           {/* DATA FISCAL */}
           <div className="mt-6 border-t border-dashed border-sys-200 pt-4 text-xs text-sys-500 text-center">
              <p className="font-bold mb-1">RESUMEN FISCAL DEL TURNO</p>
              <p>Último Comp. Emitido: <span className="font-bold text-sys-700">{reportData.lastCbte}</span></p>
              <p>Monto Facturado AFIP: <span className="font-bold text-sys-700">{formatCurrency(reportData.totalAfip)}</span></p>
              <p>Comprobantes Pendientes (AFIP): <span className="font-bold text-red-500">{reportData.pendingAfip}</span></p>
           </div>

        </div>
      </div>
    </div>
  );
};