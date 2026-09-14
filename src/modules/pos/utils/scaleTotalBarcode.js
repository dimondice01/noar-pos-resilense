// 🔥 HELPER: VALIDADOR DE DÍGITO VERIFICADOR EAN-13 ESTÁNDAR
const isValidEAN13 = (code) => {
    let sum = 0;
    for (let i = 0; i < 12; i++) {
        const digit = code.charCodeAt(i) - 48;
        sum += (i % 2 === 0) ? digit : digit * 3;
    }
    const check = (10 - (sum % 10)) % 10;
    return check === (code.charCodeAt(12) - 48);
};

// 🔥 PARSER DE BALANZAS "SOPORTE TOTAL" (KRETZ) - ticket con importe total, sin PLU
// Formato: prefix(6 dígitos configurable) + 1 dígito (ignorado) + 5 dígitos importe + dígito verificador EAN13
// El importe de 5 dígitos puede venir en CENTAVOS (default, balanzas tipo A) o en PESOS
// directos (algunas balanzas, mismo modelo que ya nos pasó con el formato "Total" por PLU) —
// por eso `profile.isCents` es configurable por sucursal en TeamPage (default true, retrocompatible).
// profiles: [{ prefix: '209999', categoryName: 'VERDULERIA', isCents: true }, ...] de la sucursal activa
//
// 🔥 FIX: el 4to dígito del prefijo (índice 3) NO es fijo — codifica la CANTIDAD DE
// ARTÍCULOS del ticket (confirmado comparando dos tickets reales: "220100" con 1
// artículo vs "220200" con 2). Si guardamos el prefijo completo tal cual lo vimos en
// un ticket de 1 artículo, un ticket con 2+ artículos trae ese dígito distinto y el
// match exacto fallaba (ni siquiera lo detectaba). Por eso el match ignora esa
// posición — compara solo los dígitos 1-3 y 5-6.
const prefixMatches = (codePrefix, profilePrefix) =>
    codePrefix[0] === profilePrefix[0] &&
    codePrefix[1] === profilePrefix[1] &&
    codePrefix[2] === profilePrefix[2] &&
    codePrefix[4] === profilePrefix[4] &&
    codePrefix[5] === profilePrefix[5];

export const parseTotalScaleBarcode = (code, profiles = []) => {
    if (!code || code.length !== 13 || !profiles.length) return null;
    if (!isValidEAN13(code)) return null;

    const prefix = code.substring(0, 6);
    const profile = profiles.find(p => prefixMatches(prefix, p.prefix));
    if (!profile) return null;

    const rawValue = parseInt(code.substring(7, 12), 10);
    if (isNaN(rawValue) || rawValue <= 0) return null;

    const total = profile.isCents === false ? rawValue : rawValue / 100;
    return { categoryName: profile.categoryName, total };
};
