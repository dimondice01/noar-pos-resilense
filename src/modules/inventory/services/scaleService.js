const HANDLE_DB_NAME = 'noar-scale-handles';
const HANDLE_STORE_NAME = 'handles';

function openHandleDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(HANDLE_DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getStoredHandle(brand) {
    const db = await openHandleDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE_NAME, 'readonly');
        const req = tx.objectStore(HANDLE_STORE_NAME).get(brand);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

async function setStoredHandle(brand, handle) {
    const db = await openHandleDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
        tx.objectStore(HANDLE_STORE_NAME).put(handle, brand);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function verifyPermission(handle) {
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if ((await handle.requestPermission(opts)) === 'granted') return true;
    return false;
}

export const scaleService = {
    supportsFileSystemAccess: () => typeof window !== 'undefined' && 'showSaveFilePicker' in window,

    generateScaleFile: (products, brand) => {
        if (!products || products.length === 0) return null;

        const normalizeName = (name) =>
            name.normalize("NFD").replace(/[̀-ͯ]/g, "")
                .replace(/[^a-zA-Z0-9 ]/g, '').trim().toUpperCase();

        if (brand === 'KRETZ') {
            const rows = [];
            for (const p of products) {
                const baseName = normalizeName(p.name).substring(0, 36);
                const tiers = Array.isArray(p.priceTiers) && p.priceTiers.length > 0 ? p.priceTiers : null;

                if (tiers) {
                    for (const tier of tiers) {
                        const plu = String(tier.plu).replace(/\D/g, '').slice(-6);
                        const rawPrice = parseFloat(tier.price) || 0;
                        const price = rawPrice > 0 ? rawPrice.toFixed(2) : "0.01";
                        const label = tier.label
                            ? `${baseName} ${normalizeName(tier.label)}`.substring(0, 36)
                            : baseName;
                        rows.push(`${plu},${label},${price},1,1,01`);
                    }
                } else {
                    const plu = String(p.code).replace(/\D/g, '').slice(-6);
                    const rawPrice = parseFloat(p.price) || 0;
                    const price = rawPrice > 0 ? rawPrice.toFixed(2) : "0.01";
                    rows.push(`${plu},${baseName},${price},1,1,01`);
                }
            }
            return rows.join('\r\n');
        }

        if (brand === 'SYSTEL') {
            // Formato 8 columnas: Categoria;CodInterno;Nombre;PLU;Precio;Precio;P/U;0
            // price en noar es el precio final que va al ticket → va directo en ambas columnas de precio
            const rows = [];
            for (const p of products) {
                const category = (p.category || 'GENERAL').replace(/;/g, '').toUpperCase();
                const pu = p.isWeighable ? 'P' : 'U';
                const tiers = Array.isArray(p.priceTiers) && p.priceTiers.length > 0 ? p.priceTiers : null;

                if (tiers) {
                    for (const tier of tiers) {
                        const plu = String(tier.plu).replace(/\D/g, '').slice(-6);
                        const baseName = p.name.substring(0, 18).replace(/;/g, '').toUpperCase();
                        const label = tier.label
                            ? `${baseName} ${tier.label.substring(0, 5).toUpperCase()}`.substring(0, 18)
                            : baseName;
                        const price = Math.round(parseFloat(tier.price) || 0);
                        rows.push(`${category};${plu};${label};${plu};${price};${price};${pu};0`);
                    }
                } else {
                    const plu = String(p.code).replace(/\D/g, '').slice(-6);
                    const name = p.name.substring(0, 18).replace(/;/g, '').toUpperCase();
                    const price = Math.round(parseFloat(p.price) || 0);
                    rows.push(`${category};${plu};${name};${plu};${price};${price};${pu};0`);
                }
            }
            return rows.join('\r\n');
        }

        return null;
    },

    downloadFile: (content, brand) => {
        if (!content) return;
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
    },

    // Guarda siempre en la misma ubicación elegida por el cliente, reemplazando el archivo anterior.
    // Si el navegador no soporta File System Access API (o el usuario cancela el picker), cae a downloadFile.
    saveFile: async (content, brand) => {
        if (!content) return { ok: false, mode: 'empty' };
        const filename = brand === 'KRETZ' ? 'novedades.txt' : 'productos_systel.csv';

        if (scaleService.supportsFileSystemAccess()) {
            try {
                let handle = await getStoredHandle(brand);
                if (handle && !(await verifyPermission(handle))) handle = null;

                if (!handle) {
                    handle = await window.showSaveFilePicker({
                        suggestedName: filename,
                        types: [{ description: 'Archivo de balanza', accept: { 'text/plain': ['.txt', '.csv'] } }],
                    });
                    await setStoredHandle(brand, handle);
                }

                const writable = await handle.createWritable();
                await writable.write(content);
                await writable.close();
                return { ok: true, mode: 'filesystem' };
            } catch (err) {
                if (err?.name === 'AbortError') return { ok: false, mode: 'cancelled' };
                console.warn('scaleService: fallback a descarga por error de File System Access', err);
            }
        }

        scaleService.downloadFile(content, brand);
        return { ok: true, mode: 'download' };
    },

    // Olvida la ubicación guardada para que la próxima exportación vuelva a preguntar dónde guardar.
    forgetSavedLocation: async (brand) => {
        const db = await openHandleDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
            tx.objectStore(HANDLE_STORE_NAME).delete(brand);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
};
