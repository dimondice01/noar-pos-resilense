/**
 * SERVICIO DE EXPORTACIÓN PARA BALANZAS (KRETZ / SYSTEL)
 * Diseñado para integrarse con iTegra (Kretz) y Qendra (Systel)
 */
export const scaleService = {

    /**
     * Genera el contenido del archivo según la marca
     */
    generateScaleFile: (products, brand) => {
        if (!products || products.length === 0) return null;

        if (brand === 'KRETZ') {
            // Formato iTegra estándar: PLU, Nombre, Precio, Departamento, Vencimiento
            // PLU: código del producto (máx 6)
            // Precio: con punto decimal
            return products.map(p => {
                const plu = String(p.code).slice(-6).padStart(1, '0');
                const name = p.name.substring(0, 28).replace(/,/g, ''); // Limpiar comas
                const price = parseFloat(p.price).toFixed(2);
                return `${plu},${name},${price},1,0`;
            }).join('\r\n');
        }

        if (brand === 'SYSTEL') {
            // Formato Systel Qendra (CSV sugerido)
            // Estructura: Codigo;Nombre;Precio;Unidad;Vencimiento
            return products.map(p => {
                const code = String(p.code).slice(-6);
                const name = p.name.substring(0, 25).replace(/;/g, ''); // Limpiar punto y coma
                const price = parseFloat(p.price).toFixed(2).replace('.', ','); // Systel suele usar coma decimal
                return `${code};${name};${price};1;0`;
            }).join('\r\n');
        }

        return null;
    },

    /**
     * Ejecuta la descarga del archivo en el navegador
     */
    downloadFile: (content, brand) => {
        if (!content) return;

        const filename = brand === 'KRETZ' ? 'novedades_kretz.txt' : 'productos_systel.csv';
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        link.href = url;
        link.download = filename;
        
        document.body.appendChild(link);
        link.click();
        
        // Limpieza
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    }
};