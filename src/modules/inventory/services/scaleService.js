export const scaleService = {
    generateScaleFile: (products, brand) => {
        if (!products || products.length === 0) return null;

        if (brand === 'KRETZ') {
            return products.map(p => {
                // 1. PLU: Solo números, máximo 6 dígitos según modelo. 
                const plu = String(p.code).replace(/\D/g, '').slice(-6);

                // 2. NOMBRE: ¡CLAVE! Eliminamos TODO lo que no sea letra o espacio.
                // iTegra falla con puntos, comas, tildes o símbolos en el envío a balanza.
                const cleanName = p.name
                    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Quita acentos
                    .replace(/[^a-zA-Z0-9 ]/g, '') // Quita puntos, comas, #, etc.
                    .substring(0, 36) // Aumentado a 36 caracteres para la Kretz Report NX
                    .trim()
                    .toUpperCase();

                // 3. PRECIO: Aseguramos punto decimal y 2 dígitos exactos.
                // Filtramos precios en 0 porque algunas balanzas bloquean el envío.
                const rawPrice = parseFloat(p.price) || 0;
                const price = rawPrice > 0 ? rawPrice.toFixed(2) : "0.01";

                // 4. FORMATO: PLU, Nombre, Precio, Departamento, Familia
                // Forzamos Departamento 1 y Familia 1 para evitar bloqueos en iTegra
                return `${plu},${cleanName},${price},1,1,01`;
            }).join('\r\n');
        }

        if (brand === 'SYSTEL') {
            return products.map(p => {
                const code = String(p.code).replace(/\D/g, '').slice(-6);
                const name = p.name.substring(0, 25).replace(/;/g, '').toUpperCase();
                const price = parseFloat(p.price).toFixed(2).replace('.', ',');
                return `${code};${name};${price};1;0`;
            }).join('\r\n');
        }

        return null;
    },

    downloadFile: (content, brand) => {
        if (!content) return;
        // Nombre de archivo sin espacios para evitar líos en Windows y JDataGate
        const filename = brand === 'KRETZ' ? 'novedades.txt' : 'productos_systel.csv';
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    }
};