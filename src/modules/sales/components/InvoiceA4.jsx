import React from 'react';
import QRCode from "react-qr-code";
import { cn } from '../../../core/utils/cn';
import defaultLogo from '../../../assets/logo.png'; 

// =================================================================
// 🖨️ COMPONENTE FACTURA A4 (ESTÁNDAR AFIP ARGENTINA)
// =================================================================

export const InvoiceA4 = ({ sale, companyConfig }) => {
  if (!sale) return null;

  // --- Helpers de Formateo ---
  const formatCurrency = (amount) => `$ ${(Number(amount) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  
  const formatAfipDate = (dateStr) => {
      if (!dateStr) return "-";
      const str = String(dateStr);
      
      // Si viene pegado de AFIP (Ej: 20260222 -> 22/02/2026)
      if (str.length === 8 && !str.includes('-')) {
          return `${str.slice(6, 8)}/${str.slice(4, 6)}/${str.slice(0, 4)}`;
      }
      
      // Si viene como YYYY-MM-DD desde tu base de datos (Evita el salto de día por Zona Horaria)
      if (str.includes('-')) {
          const partes = str.split('T')[0].split('-'); // Toma solo la fecha, ignorando la hora si la trae
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

  // --- Extracción de Datos AFIP ---
  const afip = sale.afip || {};
  const letra = afip.cbteLetra || 'B';
  const codComprobante = afip.cbteTipo ? String(afip.cbteTipo).padStart(2, '0') : (letra === 'A' ? '01' : letra === 'B' ? '06' : '11');
  
  const ptoVta = String(afip.ptoVta || 1).padStart(5, '0');
  const numero = String(afip.cbteNumero || sale.number?.replace(/\D/g, '').slice(-8) || '0').padStart(8, '0');
  
  // 🔥 FIX: Extracción segura de QR y CAE
  const qrData = afip.qr_data || afip.qr || "";
  const cae = afip.cae || "";
  const vto = afip.vtoCAE || afip.vencimiento || afip.caeFchVto || "";

  // --- Datos del Emisor ---
  const emisor = {
    nombre: companyConfig?.nombre || 'MI EMPRESA',
    razonSocial: companyConfig?.razonSocial || companyConfig?.nombre || 'Sin Razón Social',
    domicilio: companyConfig?.domicilio || companyConfig?.direccion || 'Sin Domicilio',
    condicionIva: (companyConfig?.condicionIva || 'Responsable Inscripto').replace(/_/g, ' '),
    cuit: companyConfig?.cuit || '00-00000000-0',
    iibb: companyConfig?.iibb || companyConfig?.cuit || '00-00000000-0',
    inicioActividades: companyConfig?.inicioActividades || companyConfig?.inicioAct || '-',
    logoUrl: companyConfig?.logoUrl || defaultLogo
  };

  // --- Datos del Cliente ---
  const client = sale.client || { name: 'Consumidor Final', docNumber: '0', docType: '99', fiscalCondition: 'CONSUMIDOR_FINAL' };
  const getDocTypeName = (type) => type === '80' ? 'CUIT' : type === '96' ? 'DNI' : 'Doc.';
  const condicionIvaCliente = (client.fiscalCondition || 'Consumidor Final').replace(/_/g, ' ');

  // --- Cálculos de Totales ---
  const total = Number(sale.total) || 0;
  let neto = total;
  let iva = 0;
  
  if (letra === 'A') {
    neto = total / 1.21;
    iva = total - neto;
  }

  const discountAmount = Number(sale.discountAmount || 0);

  return (
    <div className="w-[210mm] min-h-[297mm] bg-white text-black font-sans mx-auto box-border print:m-0 print:shadow-none shadow-2xl relative">
      {/* Estilos para impresión A4 exacta */}
      <style>{`
        @media print {
          @page { size: A4; margin: 0; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          ::-webkit-scrollbar { display: none; }
        }
      `}</style>

      <div className="p-[10mm] flex flex-col h-full">
        
        {/* ========================================== */}
        {/* CABECERA (HEADER AFIP)                     */}
        {/* ========================================== */}
        <div className="relative border-b-2 border-black pb-4 mb-4 flex justify-between items-start">
          
          {/* CUADRO CENTRAL CON LETRA Y CÓDIGO */}
          <div className="absolute left-1/2 -translate-x-1/2 top-0 border-2 border-black bg-white flex flex-col items-center justify-center w-14 h-14 z-10 font-bold">
            <span className="text-3xl leading-none">{letra}</span>
            <span className="text-[10px] leading-none mt-1 border-t border-black w-full text-center pt-0.5">Cod. {codComprobante}</span>
          </div>

          {/* LADO IZQUIERDO (Emisor + Logo) */}
          <div className="w-1/2 pr-10 pt-2 text-sm flex gap-4">
            {emisor.logoUrl && (
              <img 
                src={emisor.logoUrl} 
                alt="Logo Empresa" 
                className="w-20 h-20 object-contain grayscale"
                onError={(e) => e.target.style.display = 'none'}
              />
            )}
            <div>
                <h1 className="text-xl font-black uppercase mb-1 tracking-tight">{emisor.nombre}</h1>
                <p className="font-bold text-xs uppercase mb-2 text-gray-700">Razón Social: {emisor.razonSocial}</p>
                <p className="text-[11px] mb-1"><b>Domicilio Comercial:</b> {emisor.domicilio}</p>
                <p className="text-[11px] mb-1 uppercase"><b>Condición frente al IVA:</b> {emisor.condicionIva}</p>
            </div>
          </div>

          {/* LADO DERECHO (Datos de Comprobante) */}
          <div className="w-1/2 pl-10 pt-2 text-sm text-right">
            <h2 className="text-3xl font-black uppercase mb-1 tracking-widest text-gray-800">FACTURA</h2>
            <div className="flex justify-end gap-2 text-base font-bold mb-2">
              <span>Comp. Nro:</span>
              <span className="font-mono">{ptoVta}-{numero}</span>
            </div>
            <p className="text-[11px] mb-1"><b>Fecha de Emisión:</b> {formatAfipDate(sale.date || sale.createdAt)}</p>
            <p className="text-[11px] mb-1"><b>CUIT:</b> {emisor.cuit}</p>
            <p className="text-[11px] mb-1"><b>Ingresos Brutos:</b> {emisor.iibb}</p>
            <p className="text-[11px] mb-1"><b>Inicio de Actividades:</b> {formatAfipDate(emisor.inicioActividades)}</p>
          </div>
        </div>

        {/* ========================================== */}
        {/* DATOS DEL CLIENTE                          */}
        {/* ========================================== */}
        <div className="border border-black rounded-sm p-3 mb-4 text-[11px] flex flex-wrap bg-gray-50/50 print:bg-transparent">
          <div className="w-1/2 mb-2">
            <span className="font-bold">Nombre/Razón Social:</span> {client.name}
          </div>
          <div className="w-1/2 mb-2">
            <span className="font-bold">{getDocTypeName(client.docType)}:</span> {client.docNumber}
          </div>
          <div className="w-1/2 mb-2 uppercase">
            <span className="font-bold">Condición frente al IVA:</span> {condicionIvaCliente}
          </div>
          <div className="w-1/2 mb-2">
            <span className="font-bold">Domicilio:</span> {client.address || 'N/A'}
          </div>
          <div className="w-1/2 mb-2">
            <span className="font-bold">Condición de Venta:</span> {sale.method?.toUpperCase() || 'CONTADO'}
          </div>
        </div>

        {/* ========================================== */}
        {/* TABLA DE ÍTEMS                             */}
        {/* ========================================== */}
        <div className="flex-1">
          <table className="w-full text-left text-[10px] border-collapse">
            <thead>
              <tr className="bg-gray-200 border-y border-black print:bg-gray-100">
                <th className="py-2 px-2 font-bold w-20">Código</th>
                <th className="py-2 px-2 font-bold">Producto / Descripción</th>
                <th className="py-2 px-2 font-bold text-center w-16">Cant.</th>
                <th className="py-2 px-2 font-bold text-center w-12">U.M.</th>
                <th className="py-2 px-2 font-bold text-right w-24">Precio Unit.</th>
                <th className="py-2 px-2 font-bold text-right w-20">% Bonif.</th>
                <th className="py-2 px-2 font-bold text-right w-28">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {sale.items?.map((item, idx) => {
                const isOff = item.appliedPromo && item.promoLabel?.includes('%');
                const discountText = isOff ? item.promoLabel : '0.00';

                return (
                  <tr key={idx} className="border-b border-gray-200">
                    <td className="py-2 px-2 font-mono text-gray-600">{item.code || item.id?.slice(0,6) || '-'}</td>
                    <td className="py-2 px-2 uppercase font-bold">{item.name}</td>
                    <td className="py-2 px-2 text-center font-mono">{item.isWeighable ? parseFloat(item.quantity).toFixed(3) : item.quantity}</td>
                    <td className="py-2 px-2 text-center uppercase text-gray-600">{item.isWeighable ? 'KG' : 'UN'}</td>
                    <td className="py-2 px-2 text-right font-mono">{formatCurrency(item.originalPrice || item.price)}</td>
                    <td className="py-2 px-2 text-right text-gray-500 font-mono italic">{discountText}</td>
                    <td className="py-2 px-2 text-right font-bold font-mono">{formatCurrency(item.subtotal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ========================================== */}
        {/* PIE FISCAL Y TOTALES                       */}
        {/* ========================================== */}
        <div className="mt-4 shrink-0">
          
          {/* Fila de Totales */}
          <div className="flex justify-end items-start border-t border-black pt-2 mb-6">
            <div className="w-1/2 text-[11px] text-gray-600 italic">
              {discountAmount > 0 && <p>* Incluye bonificaciones por un total de {formatCurrency(discountAmount)}</p>}
            </div>
            
            <div className="w-1/2 pl-10 text-xs">
              {letra === 'A' && (
                <>
                  <div className="flex justify-between mb-1 text-gray-700">
                    <span className="font-bold">Importe Neto Gravado:</span>
                    <span className="font-mono">{formatCurrency(neto)}</span>
                  </div>
                  <div className="flex justify-between mb-1 text-gray-700">
                    <span className="font-bold">IVA 21%:</span>
                    <span className="font-mono">{formatCurrency(iva)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between items-center mt-2 pt-2 border-t-2 border-black text-xl font-black">
                <span>IMPORTE TOTAL:</span>
                <span className="font-mono">{formatCurrency(total)}</span>
              </div>
            </div>
          </div>

          {/* Bloque AFIP */}
          <div className="border border-black rounded-sm p-3 flex justify-between items-center bg-gray-50/30">
            
            {/* Generador de QR Seguro (Local) */}
            <div className="w-24 h-24 bg-white flex items-center justify-center overflow-hidden border border-gray-300 shrink-0 p-1">
              {qrData ? (
                <QRCode value={qrData} size={85} level="M" />
              ) : (
                <div className="text-[10px] font-bold text-center text-gray-400">Sin<br/>Código QR</div>
              )}
            </div>

            <div className="flex-1 flex justify-end items-center gap-10">
              <div className="text-right">
                <p className="font-black text-xl italic text-gray-400 mb-1 tracking-wider">Comprobante Autorizado</p>
                <p className="text-[10px] font-bold text-gray-600">Esta Administración Federal no se responsabiliza por los datos ingresados en el detalle de la operación</p>
              </div>
              
              <div className="text-right text-xs">
                <div className="mb-1">
                  <span className="font-bold mr-2 text-gray-600">CAE N°:</span>
                  <span className="font-mono text-sm font-bold">{cae || 'PENDIENTE'}</span>
                </div>
                <div>
                  <span className="font-bold mr-2 text-gray-600">Fecha de Vto. de CAE:</span>
                  <span className="font-mono font-bold">{formatAfipDate(vto)}</span>
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};