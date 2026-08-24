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
// Formato: prefix(6 dígitos configurable) + 1 dígito (ignorado) + 5 dígitos precio en centavos + dígito verificador EAN13
// profiles: [{ prefix: '209999', categoryName: 'VERDULERIA' }, ...] de la sucursal activa
export const parseTotalScaleBarcode = (code, profiles = []) => {
    if (!code || code.length !== 13 || !profiles.length) return null;
    if (!isValidEAN13(code)) return null;

    const prefix = code.substring(0, 6);
    const profile = profiles.find(p => p.prefix === prefix);
    if (!profile) return null;

    const cents = parseInt(code.substring(7, 12), 10);
    if (isNaN(cents) || cents <= 0) return null;

    return { categoryName: profile.categoryName, total: cents / 100 };
};
