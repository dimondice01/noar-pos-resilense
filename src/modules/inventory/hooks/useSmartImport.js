import { useState } from 'react';
import Papa from 'papaparse';
import { db } from '../../../database/db';

export const useSmartImport = () => {
    const [isProcessing, setIsProcessing] = useState(false);
    const [previewData, setPreviewData] = useState([]);
    const [headers, setHeaders] = useState([]);
    const [file, setFile] = useState(null);

    // 1. Leer primeras filas para previsualizar
    const parseFile = (uploadedFile) => {
        setFile(uploadedFile);
        Papa.parse(uploadedFile, {
            preview: 5,
            header: false,
            skipEmptyLines: true,
            complete: (results) => {
                setPreviewData(results.data);
                if (results.data.length > 0) {
                    setHeaders(results.data[0].map((_, i) => `Columna ${i + 1}`));
                }
            }
        });
    };

    // 2. Procesar TODO en memoria
    const processImport = async (columnMapping, branchId = null) => {
        if (!file) return;
        setIsProcessing(true);

        return new Promise((resolve, reject) => {
            Papa.parse(file, {
                header: false,
                skipEmptyLines: true,
                complete: async (results) => {
                    try {
                        const count = await bulkUpsertOptimized(results.data, columnMapping, branchId);
                        resolve(count);
                    } catch (error) {
                        console.error(error);
                        reject(error);
                    } finally {
                        setIsProcessing(false);
                    }
                },
                error: (err) => {
                    setIsProcessing(false);
                    reject(err);
                }
            });
        });
    };

    // 3. Lógica BULK INTELIGENTE (El "Portero")
    const bulkUpsertOptimized = async (rows, mapping, branchId) => {
        
        // Cargar todo a RAM para comparar instantáneamente
        const allProducts = await db.products.toArray();
        
        // Mapas para búsqueda O(1)
        const codeMap = new Map();
        const nameMap = new Map();
        
        allProducts.forEach(p => {
            if (p.code) codeMap.set(String(p.code).trim(), p);
            if (p.name) nameMap.set(String(p.name).trim().toLowerCase(), p);
        });

        const productsToUpsert = [];
        const inventoryToUpsert = [];
        const now = new Date().toISOString();

        for (const row of rows) {
            let tempProd = {};
            Object.keys(mapping).forEach(colIndex => {
                const field = mapping[colIndex];
                if (field !== 'ignore') tempProd[field] = row[colIndex];
            });

            if (!tempProd.name) continue;

            // Normalizar claves
            const cleanName = String(tempProd.name).trim();
            const cleanNameLower = cleanName.toLowerCase();
            const incomingCode = tempProd.code ? String(tempProd.code).trim() : null;

            // Buscar coincidencia
            let existing = incomingCode ? codeMap.get(incomingCode) : null;
            if (!existing) existing = nameMap.get(cleanNameLower);

            // Valores nuevos
            const newPrice = tempProd.price ? parseFloat(tempProd.price) : undefined;
            const newCost = tempProd.cost ? parseFloat(tempProd.cost) : undefined;
            const newCode = incomingCode;

            if (existing) {
                // === DETECTOR DE CAMBIOS ===
                let hasChanges = false;
                const updatedProduct = { ...existing, updatedAt: now };

                // Solo si el precio cambia (y es un número válido)
                if (newPrice !== undefined && !isNaN(newPrice) && newPrice !== existing.price) {
                    updatedProduct.price = newPrice;
                    hasChanges = true;
                }
                // Solo si el costo cambia
                if (newCost !== undefined && !isNaN(newCost) && newCost !== existing.cost) {
                    updatedProduct.cost = newCost;
                    hasChanges = true;
                }
                // Solo si el código cambia
                if (newCode && newCode !== existing.code) {
                    updatedProduct.code = newCode;
                    hasChanges = true;
                }

                // 🔥 SI NO HAY CAMBIOS, NO HACEMOS NADA (Ahorro total)
                if (hasChanges) {
                    updatedProduct.syncStatus = 'pending'; // Esto dispara el Sync
                    productsToUpsert.push(updatedProduct);
                }

                // El stock siempre se actualiza en local, pero es una tabla separada
                if (tempProd.stock && branchId) {
                    inventoryToUpsert.push({
                        productId: existing.id,
                        branchId: branchId,
                        stock: parseFloat(tempProd.stock),
                        updatedAt: now
                        // El stock no dispara sync de 'products', dispara sync de 'inventory' si lo implementamos
                    });
                }

            } else {
                // === NUEVO PRODUCTO ===
                const newId = crypto.randomUUID();
                const finalCode = newCode || `INT-${Math.floor(Math.random()*10000000)}`;

                const newProduct = {
                    id: newId,
                    name: cleanName,
                    code: finalCode,
                    price: newPrice || 0,
                    cost: newCost || 0,
                    categoryId: 'general',
                    active: true,
                    syncStatus: 'pending', // Nuevo producto SI se sube
                    createdAt: now
                };

                productsToUpsert.push(newProduct);

                if (branchId) {
                    inventoryToUpsert.push({
                        productId: newId,
                        branchId: branchId,
                        stock: parseFloat(tempProd.stock || 0),
                        updatedAt: now
                    });
                }
            }
        }

        // Escritura Masiva
        if (productsToUpsert.length > 0) {
            await db.products.bulkPut(productsToUpsert);
        }
        if (inventoryToUpsert.length > 0) {
            await db.inventory.bulkPut(inventoryToUpsert);
        }

        return productsToUpsert.length + inventoryToUpsert.length;
    };

    return { parseFile, processImport, previewData, headers, isProcessing };
};