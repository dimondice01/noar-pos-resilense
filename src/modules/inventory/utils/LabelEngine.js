// =========================================================================
// 🚀 NEXUS LABEL ENGINE (Utility)
// =========================================================================
export const GondolaLabelEngine = {
    calculatePromoDetails: (p) => {
        if (!p.promo) return { isPromo: false, currentPrice: p.price };
        
        const now = new Date();
        const startStr = p.promo.startDate || '';
        const endStr = p.promo.endDate || '';
        
        if (!startStr || !endStr) return { isPromo: false, currentPrice: p.price };

        // Ajuste de fecha para comparación robusta
        const start = new Date(startStr + 'T00:00:00');
        const end = new Date(endStr + 'T23:59:59');
        
        if (now < start || now > end) {
            return { isPromo: false, currentPrice: p.price };
        }

        let details = {
            isPromo: true,
            type: p.promo.type,
            oldPrice: p.price,
            currentPrice: p.price,
            label: p.promo.name || 'OFERTA',
            footer: ''
        };

        const val = parseFloat(p.promo.value) || 0;

        if (p.promo.type === 'PERCENTAGE') {
            details.currentPrice = p.price * (1 - val / 100);
            details.footer = `AHORRO DIRECTO ${val}%`;
        } else if (p.promo.type === 'BUNDLE_DEAL') {
            const m = parseFloat(p.promo.payValue) || 1;
            const totalCombo = (p.price * m);
            details.currentPrice = totalCombo; 
            const unitPrice = totalCombo / val;
            details.label = `${val}x${m}`;
            details.footer = `LLEVANDO ${val} UN. PAGAS $${unitPrice.toLocaleString('es-AR', {maximumFractionDigits: 2})} C/U`;
        } else if (p.promo.type === 'BULK_THRESHOLD') {
            const disc = parseFloat(p.promo.discountValue) || 0;
            details.currentPrice = p.price * (1 - disc / 100);
            details.footer = `LLEVANDO ${val} UN. O MÁS`;
        } else if (p.promo.type === 'QUANTITY_LIMIT') {
             const disc = parseFloat(p.promo.discountValue) || 0;
             details.currentPrice = p.price * (1 - disc / 100);
             details.footer = `LÍMITE ${val} UNIDADES`;
        } else if (p.promo.type === 'FIXED_QTY_PRICE') {
             const fixedTotal = parseFloat(p.promo.fixedAmount) || 0;
             details.currentPrice = fixedTotal;
             details.label = `${val} x $${fixedTotal}`;
             details.footer = `LLEVANDO ${val} UN. PAGAS $${fixedTotal.toLocaleString('es-AR', {maximumFractionDigits: 2})} EL LOTE`;
        }

        return details;
    }
};