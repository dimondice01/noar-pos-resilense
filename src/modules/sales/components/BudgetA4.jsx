import React from 'react';
import defaultLogo from '../../../assets/logo.png';

// =================================================================
// 🧾 PRESUPUESTO A4 (formato comercial, no fiscal)
// Nota: el print de TicketModal fuerza color negro → diseño monocromo
// =================================================================

const VALIDITY_DAYS = 7;

const money = (n) => `$ ${(Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d && !isNaN(d.getTime()) ? d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-');

export const BudgetA4 = ({ sale, companyConfig }) => {
  if (!sale) return null;

  const emisor = {
    nombre: companyConfig?.nombre || 'MI NEGOCIO',
    razonSocial: companyConfig?.razonSocial || companyConfig?.nombre || '',
    domicilio: companyConfig?.domicilio || companyConfig?.direccion || '',
    condicionIva: (companyConfig?.condicionIva || '').replace(/_/g, ' '),
    cuit: companyConfig?.cuit || '',
    telefono: companyConfig?.telefono || '',
    email: companyConfig?.email || '',
    logoUrl: companyConfig?.logoUrl || defaultLogo,
  };

  const client = sale.client || { name: 'Consumidor Final' };
  const docLabel = client.docType === '80' ? 'CUIT' : 'DNI';
  const docValue = client.docNumber && client.docNumber !== '0' ? client.docNumber : null;
  const condIvaCliente = (client.fiscalCondition || 'Consumidor Final').replace(/_/g, ' ');

  const issued = new Date(sale.date || sale.createdAt);
  const validUntil = new Date(issued.getTime() + VALIDITY_DAYS * 86400000);
  const numero = sale.number || `PTO-${String(sale.localId || '').slice(-8).toUpperCase()}`;

  const items = Array.isArray(sale.items) ? sale.items : [];
  const total = Number(sale.total) || 0;
  const discount = Number(sale.discount) || 0;
  const subtotal = Number(sale.subtotal) || total + discount;

  return (
    <div className="w-[210mm] min-h-[297mm] bg-white text-black font-sans mx-auto box-border print:m-0 print:shadow-none relative">
      <style>{`
        @media print {
          @page { size: A4; margin: 0; }
        }
      `}</style>

      <div className="budget-a4 p-[14mm] flex flex-col min-h-[297mm] box-border">

        {/* ===== CABECERA ===== */}
        <div className="flex justify-between items-start gap-6 pb-5 border-b-[3px] border-black">
          <div className="flex gap-4 items-start">
            {emisor.logoUrl && (
              <img
                src={emisor.logoUrl}
                alt="Logo"
                className="w-24 h-24 object-contain grayscale"
                onError={(e) => (e.target.style.display = 'none')}
              />
            )}
            <div className="text-[11px] leading-snug">
              <h1 className="text-2xl font-black uppercase tracking-tight leading-none mb-1">{emisor.nombre}</h1>
              {emisor.razonSocial && emisor.razonSocial !== emisor.nombre && (
                <p className="font-bold text-gray-700">{emisor.razonSocial}</p>
              )}
              {emisor.domicilio && <p>{emisor.domicilio}</p>}
              {emisor.cuit && <p>CUIT: {emisor.cuit}{emisor.condicionIva && ` · ${emisor.condicionIva}`}</p>}
              {(emisor.telefono || emisor.email) && (
                <p>{[emisor.telefono && `Tel: ${emisor.telefono}`, emisor.email].filter(Boolean).join(' · ')}</p>
              )}
            </div>
          </div>

          <div className="text-right shrink-0">
            <p className="text-[34px] font-black tracking-[0.15em] leading-none">PRESUPUESTO</p>
            <div className="mt-3 inline-grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-[11px] text-left">
              <span className="font-bold text-gray-600 uppercase">N°</span>
              <span className="font-mono font-bold">{numero}</span>
              <span className="font-bold text-gray-600 uppercase">Fecha</span>
              <span className="font-mono">{fmtDate(issued)}</span>
              <span className="font-bold text-gray-600 uppercase">Válido hasta</span>
              <span className="font-mono font-bold">{fmtDate(validUntil)}</span>
            </div>
          </div>
        </div>

        {/* ===== CLIENTE ===== */}
        <div className="mt-5 border border-black rounded-md overflow-hidden">
          <div className="bg-gray-100 px-4 py-1.5 border-b border-black text-[10px] font-black uppercase tracking-widest">
            Presupuestado a
          </div>
          <div className="px-4 py-3 grid grid-cols-2 gap-x-8 gap-y-1 text-[12px]">
            <p><span className="font-bold">Cliente:</span> {client.name}</p>
            <p><span className="font-bold">Condición IVA:</span> {condIvaCliente}</p>
            {docValue && <p><span className="font-bold">{docLabel}:</span> {docValue}</p>}
            {client.address && <p><span className="font-bold">Domicilio:</span> {client.address}</p>}
            {client.phone && <p><span className="font-bold">Teléfono:</span> {client.phone}</p>}
            {client.email && <p><span className="font-bold">Email:</span> {client.email}</p>}
          </div>
        </div>

        {/* ===== DETALLE ===== */}
        <table className="w-full mt-5 text-[12px] border-collapse">
          <thead>
            <tr className="bg-gray-100 border-y-2 border-black text-[10px] uppercase tracking-wider">
              <th className="py-2 px-2 text-center w-[10%]">Cant.</th>
              <th className="py-2 px-2 text-left">Descripción</th>
              <th className="py-2 px-2 text-right w-[18%]">P. Unitario</th>
              <th className="py-2 px-2 text-right w-[18%]">Importe</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const qty = parseFloat(item.quantity) || 0;
              const displayQty = item.isWeighable || qty % 1 !== 0 ? qty.toFixed(3) : Math.round(qty);
              const lineTotal = item.subtotal ?? qty * (Number(item.price) || 0);
              return (
                <tr key={idx} className="border-b border-gray-300 align-top">
                  <td className="py-2 px-2 text-center font-mono">{displayQty}</td>
                  <td className="py-2 px-2">
                    <span className="font-semibold">{item.name}</span>
                    {item.appliedPromo && (
                      <span className="ml-2 text-[10px] italic text-gray-600">({item.promoLabel || 'Oferta'})</span>
                    )}
                    {Array.isArray(item.skus) && item.skus.length > 0 && (
                      <div className="text-[10px] font-mono text-gray-600">SKU: {item.skus.join(', ')}</div>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right font-mono">{money(item.price)}</td>
                  <td className="py-2 px-2 text-right font-mono font-semibold">{money(lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* ===== TOTALES ===== */}
        <div className="flex justify-end mt-4">
          <div className="w-[45%] text-[12px]">
            <div className="flex justify-between py-1">
              <span className="text-gray-700">Subtotal</span>
              <span className="font-mono">{money(subtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between py-1">
                <span className="text-gray-700">Descuento</span>
                <span className="font-mono">- {money(discount)}</span>
              </div>
            )}
            <div className="flex justify-between items-center mt-1 py-2 px-3 border-2 border-black bg-gray-100">
              <span className="font-black uppercase tracking-widest text-[13px]">Total</span>
              <span className="font-mono font-black text-xl">{money(total)}</span>
            </div>
          </div>
        </div>

        <div className="flex-1" />

        {/* ===== CONDICIONES + FIRMA ===== */}
        <div className="mt-8 grid grid-cols-[1fr_auto] gap-10 items-end">
          <div className="text-[10px] leading-relaxed border-l-[3px] border-black pl-3">
            <p className="font-black uppercase tracking-widest text-[10px] mb-1">Condiciones</p>
            <p>• Presupuesto válido por {VALIDITY_DAYS} días desde la fecha de emisión.</p>
            <p>• Precios sujetos a modificación sin previo aviso una vez vencido el plazo.</p>
            <p>• Sujeto a disponibilidad de stock al momento de la compra.</p>
            <p>• Documento no válido como factura.</p>
          </div>
          <div className="w-[60mm] text-center text-[10px]">
            <div className="border-t border-black pt-1 font-bold uppercase">Firma y aclaración</div>
          </div>
        </div>

        <div className="mt-6 pt-2 border-t border-gray-300 flex justify-between text-[9px] text-gray-600">
          <span>Atendido por: {sale.operatorName || sale.userName || '-'}</span>
          <span>Gracias por su consulta</span>
        </div>
      </div>
    </div>
  );
};
