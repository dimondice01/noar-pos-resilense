import { useState } from 'react';
import Papa from 'papaparse';
import { getDB } from '../../../database/db'; // Dexie
import { collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db as firestoreDB } from '../../../database/firebase';
import { useAuthStore } from '../../auth/store/useAuthStore';

// =================================================================
// 🧠 CONFIGURACIÓN CENTRAL DE CAMPOS
// =================================================================
export const AVAILABLE_FIELDS = [
    { key: 'ignore', label: '(Ignorar Columna)', type: 'none' },
    { key: 'code', label: 'Código de Barras / PLU (Balanzas)', type: 'text', required: true },
    { key: 'name', label: 'Nombre / Descripción (Opcional si es actualización)', type: 'text' },
    { key: 'cost', label: 'Costo', type: 'money' },
    { key: 'price', label: 'Precio Final', type: 'money', required: true },
    { key: 'stock', label: 'Stock Inicial (Solo esta Sucursal)', type: 'number' },
    { key: 'category', label: 'Categoría (Auto-Crear)', type: 'master' },
    { key: 'brand', label: 'Marca (Auto-Crear)', type: 'master' },
    { key: 'tax', label: 'IVA / Alicuota (%)', type: 'tax' },
    { key: 'unit', label: 'Unidad (Kg/Un)', type: 'boolean_unit' }
];

export const useSmartImport = () => {
    const { user } = useAuthStore();
    const [isProcessing, setIsProcessing] = useState(false);
    const [previewData, setPreviewData] = useState([]);
    const [file, setFile] = useState(null);
    const [progress, setProgress] = useState({ current: 0, total: 0, stage: '' });

    // 1. Previsualización
    const parseFile = (uploadedFile) => {
        setFile(uploadedFile);
        Papa.parse(uploadedFile, {
            preview: 5,
            header: false,
            skipEmptyLines: true,
            complete: (results) => setPreviewData(results.data)
        });
    };

    // =================================================================
    // ⚙️ PARSERS BLINDADOS (Evitan NaN y undefined)
    // =================================================================
    
    const normalizeMoney = (val) => {
        if (!val) return 0;
        let clean = String(val).replace(/[^0-9.,-]/g, '');
        if (clean.includes(',') && clean.includes('.')) {
            clean = clean.replace(/\./g, '').replace(',', '.');
        } else if (clean.includes(',')) {
            clean = clean.replace(',', '.');
        }
        const num = parseFloat(clean);
        return isNaN(num) ? 0 : num;
    };

    const normalizeTax = (val) => {
        if (!val) return 21;
        const str = String(val).toLowerCase();
        if (str.includes('10.5') || str.includes('10,5')) return 10.5;
        if (str.includes('27')) return 27;
        if (str.includes('0') || str.includes('exento')) return 0;
        return 21;
    };

    const normalizeUnit = (val) => {
        if (val === undefined || val === null || val === '') return { unit: 'UN', isWeighable: false };
        const str = String(val).toLowerCase().trim();
        // Soporte numérico: 0 = pesable, 1 = unitario
        if (str === '0') return { unit: 'KG', isWeighable: true };
        if (str === '1') return { unit: 'UN', isWeighable: false };
        // Soporte letra: P = Pesable, U = Unitario (formato balanza)
        if (str === 'p') return { unit: 'KG', isWeighable: true };
        if (str === 'u') return { unit: 'UN', isWeighable: false };
        const weighableKeywords = ['kg', 'kilo', 'gramo', 'gr', 'lt', 'litro', 'mt', 'metro', 'pesable'];
        if (weighableKeywords.some(k => str.includes(k))) {
            return { unit: 'KG', isWeighable: true };
        }
        return { unit: 'UN', isWeighable: false };
    };

    // =================================================================
    // 🚀 PROCESADOR PRINCIPAL (LOCAL-FIRST OPTIMIZED + SMART UPSERT)
    // =================================================================
    // Agregamos options = { roundTo50: false } para controlar el redondeo opcional
    const processImport = async (columnMapping, branchId, options = { roundTo50: false, forceWeighable: false }) => {
        if (!file || !user?.companyId) return;
        if (!branchId) throw new Error("Falta el ID de la sucursal destino.");

        setIsProcessing(true);
        setProgress({ current: 0, total: 0, stage: 'Iniciando...' });

        const localDB = await getDB();

        return new Promise((resolve, reject) => {
            Papa.parse(file, {
                header: false,
                skipEmptyLines: true,
                complete: async (results) => {
                    try {
                        const rows = results.data;
                        setProgress({ current: 0, total: rows.length, stage: 'Preparando Lotes...' });

                        const existingCats = await localDB.categories.toArray();
                        const existingBrands = await localDB.brands.toArray();
                        const catMap = new Map(existingCats.map(c => [c.name.toUpperCase(), c.id]));
                        const brandMap = new Map(existingBrands.map(b => [b.name.toUpperCase(), b.id]));

                        const existingProducts = await localDB.products.toArray();
                        const productCodeMap = new Map(existingProducts.map(p => [String(p.code).trim().toUpperCase(), p]));

                        const existingBranchInventory = await localDB.inventory.where('branchId').equals(branchId).toArray();
                        const inventoryMap = new Map(existingBranchInventory.map(i => [i.productId, i]));

                        const newCategories = [];
                        const newBrands = [];
                        const productsToUpsert = [];
                        const inventoryToUpsert = [];

                        for (let i = 0; i < rows.length; i++) {
                            const row = rows[i];
                            const rawData = {}; 

                            Object.keys(columnMapping).forEach(colIndex => {
                                const fieldKey = columnMapping[colIndex];
                                if (fieldKey !== 'ignore') rawData[fieldKey] = row[colIndex];
                            });

                            // --- BÚSQUEDA DEL PRODUCTO EXISTENTE ---
                            const code = rawData.code ? String(rawData.code).trim() : `GEN-${Date.now()}-${i}`;
                            const existingProduct = productCodeMap.get(code.toUpperCase());

                            // Validación Inteligente: 
                            // Si es un producto nuevo, SÍ O SÍ necesita un Nombre.
                            // Si ya existe, con tener el Precio nos basta para actualizarlo.
                            if (!existingProduct && !rawData.name) continue; 
                            if (rawData.price === undefined) continue;

                            // --- PROCESAMIENTO DE PRECIO & REDONDEO ---
                            let finalPrice = Math.round(normalizeMoney(rawData.price)); // siempre entero
                            if (options?.roundTo50 && finalPrice > 0) {
                                const rounded = Math.round(finalPrice / 50) * 50;
                                finalPrice = rounded === 0 ? 50 : rounded;
                            }

                            // --- CATEGORÍAS (Respeta existente si no se mapeó) ---
                            let categoryId = existingProduct?.categoryId || 'general';
                            let categoryName = existingProduct?.category || 'GENERAL'; 
                            
                            if (rawData.category && String(rawData.category).trim() !== '') {
                                const rawCatName = String(rawData.category).trim().toUpperCase();
                                categoryName = rawCatName;
                                if (catMap.has(rawCatName)) {
                                    categoryId = catMap.get(rawCatName);
                                } else {
                                    const newId = `cat_${crypto.randomUUID().split('-')[0]}`;
                                    catMap.set(rawCatName, newId);
                                    newCategories.push({ id: newId, name: rawCatName, syncStatus: 'pending' });
                                    categoryId = newId;
                                }
                            }

                            // --- MARCAS (Respeta existente si no se mapeó) ---
                            let brandId = existingProduct?.brandId || null;
                            let brandName = existingProduct?.brand || null;

                            if (rawData.brand && String(rawData.brand).trim() !== '') {
                                const rawBrandName = String(rawData.brand).trim().toUpperCase();
                                brandName = rawBrandName;
                                if (brandMap.has(rawBrandName)) {
                                    brandId = brandMap.get(rawBrandName);
                                } else {
                                    const newId = `brand_${crypto.randomUUID().split('-')[0]}`;
                                    brandMap.set(rawBrandName, newId);
                                    newBrands.push({ id: newId, name: rawBrandName, syncStatus: 'pending' });
                                    brandId = newId;
                                }
                            }

                            // --- UNIDADES ---
                            let unit = existingProduct?.unit || 'UN';
                            let isWeighable = existingProduct ? existingProduct.isWeighable : false;

                            if (options?.forceWeighable) {
                                unit = 'KG';
                                isWeighable = true;
                            } else if (rawData.unit) {
                                const unitData = normalizeUnit(rawData.unit);
                                unit = unitData.unit;
                                isWeighable = unitData.isWeighable;
                            }

                            // --- ENSAMBLAJE FINAL DEL PRODUCTO (MERGE) ---
                            const productId = existingProduct ? existingProduct.id : crypto.randomUUID();
                            const stockQty = rawData.stock !== undefined ? normalizeMoney(rawData.stock) : 0;

                            const product = {
                                id: productId,
                                code: code,
                                // Si no mandaron nombre nuevo, mantenemos el que ya tenía
                                name: rawData.name ? String(rawData.name).trim().toUpperCase() : (existingProduct?.name || 'SIN NOMBRE'),
                                price: finalPrice,
                                // Si no mandaron costo nuevo, mantenemos el existente
                                cost: rawData.cost !== undefined ? Math.round(normalizeMoney(rawData.cost)) : (existingProduct?.cost || 0),
                                taxRate: rawData.tax !== undefined ? normalizeTax(rawData.tax) : (existingProduct?.taxRate || 21),
                                category: categoryName,
                                categoryId: categoryId,
                                brand: brandName,
                                brandId: brandId,
                                unit: unit,
                                isWeighable: isWeighable,
                                stock: existingProduct ? existingProduct.stock : 0, 
                                active: existingProduct ? existingProduct.active : true,
                                syncStatus: 'pending',
                                updatedAt: new Date().toISOString()
                            };

                            productsToUpsert.push(product);

                            // Si mapearon la columna de stock, la actualizamos
                            if (rawData.stock !== undefined) {
                                inventoryToUpsert.push({
                                    branchId: branchId,
                                    productId: productId,
                                    stock: stockQty,
                                    promo: inventoryMap.get(productId)?.promo || null,
                                    updatedAt: new Date().toISOString(),
                                    syncStatus: 'pending'
                                });
                            }

                            if (i % 100 === 0) setProgress(p => ({ ...p, current: i }));
                        }

                        // =================================================================
                        // 💾 GUARDADO LOCAL MASIVO (BLINDADO)
                        // =================================================================
                        setProgress({ current: rows.length, total: rows.length, stage: 'Guardando en Base Local...' });

                        await localDB.transaction('rw', [
                            localDB.products, 
                            localDB.categories, 
                            localDB.brands, 
                            localDB.inventory
                        ], async () => {
                            if (newCategories.length) await localDB.categories.bulkPut(newCategories);
                            if (newBrands.length) await localDB.brands.bulkPut(newBrands);
                            if (productsToUpsert.length) await localDB.products.bulkPut(productsToUpsert);
                            if (inventoryToUpsert.length) await localDB.inventory.bulkPut(inventoryToUpsert);
                        });

                        // =================================================================
                        // ☁️ SYNC NUBE (NON-BLOCKING)
                        // Enviamos en lotes de 100 para no saturar el stream RPC de Firestore
                        // =================================================================
                        if (navigator.onLine) {
                            setProgress({ current: rows.length, total: rows.length, stage: 'Sincronizando con la Nube...' });
                            
                            const chunkSize = 100;
                            for (let j = 0; j < productsToUpsert.length; j += chunkSize) {
                                try {
                                    const chunk = productsToUpsert.slice(j, j + chunkSize);
                                    const batch = writeBatch(firestoreDB);
                                    
                                    chunk.forEach(p => {
                                        const pRef = doc(firestoreDB, `companies/${user.companyId}/products`, p.id);
                                        const { syncStatus, ...dataToCloud } = p;
                                        batch.set(pRef, { ...dataToCloud, lastUpdated: serverTimestamp() }, { merge: true });
                                        
                                        // También sincronizamos el stock en el mismo batch
                                        const inv = inventoryToUpsert.find(invItem => invItem.productId === p.id);
                                        if (inv) {
                                            const stockRef = doc(firestoreDB, `companies/${user.companyId}/branches/${branchId}/inventory`, p.id);
                                            batch.set(stockRef, { 
                                                productId: p.id, 
                                                stock: inv.stock, 
                                                updatedAt: serverTimestamp() 
                                            }, { merge: true });
                                        }
                                    });

                                    await batch.commit();
                                    
                                    // Marcamos como sincronizado localmente tras éxito del batch
                                    const syncedIds = chunk.map(p => p.id);
                                    await localDB.products.bulkUpdate(syncedIds.map(id => ({ key: id, changes: { syncStatus: 'synced' }})));
                                    
                                } catch (batchErr) {
                                    console.warn("⚠️ Batch falló, el syncService reintentará luego:", batchErr);
                                    break; 
                                }
                                setProgress(p => ({ ...p, current: Math.min(j + chunkSize, rows.length) }));
                            }
                        }

                        resolve({ 
                            processed: productsToUpsert.length, 
                            categories: newCategories.length, 
                            brands: newBrands.length,
                            inventory: inventoryToUpsert.length
                        });

                    } catch (error) {
                        console.error("Error Crítico de Importación:", error);
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

    // =================================================================
    // ⚖️ IMPORTADOR DE BALANZA (PLU → match por NOMBRE → pisa código)
    // =================================================================
    const processScaleImport = async (colPlu, colName, colPrice, updatePrice) => {
        if (!file || !user?.companyId) return;
        setIsProcessing(true);
        setProgress({ current: 0, total: 0, stage: 'Leyendo archivo...' });

        const localDB = await getDB();

        return new Promise((resolve, reject) => {
            Papa.parse(file, {
                header: false,
                skipEmptyLines: true,
                delimiter: '',   // auto-detect , o ;
                complete: async (results) => {
                    try {
                        const rows = results.data;
                        setProgress({ current: 0, total: rows.length, stage: 'Cruzando por nombre...' });

                        const existingProducts = await localDB.products
                            .filter(p => !p.deleted)
                            .toArray();

                        const normalize = (s) => (s || '').trim().toUpperCase();
                        const byName = new Map(existingProducts.map(p => [normalize(p.name), p]));

                        const toUpdate = [];
                        const unmatched = [];
                        const timestamp = new Date().toISOString();

                        for (let i = 0; i < rows.length; i++) {
                            const row = rows[i];
                            const plu   = String(row[colPlu]   || '').trim();
                            const name  = normalize(row[colName]  || '');
                            const price = Math.round(normalizeMoney(row[colPrice] || ''));

                            if (!plu || !name) continue;

                            const product = byName.get(name);
                            if (!product) { unmatched.push(name); continue; }

                            const updated = {
                                ...product,
                                code: plu,
                                isWeighable: true,  // si está en balanza, es pesable
                                unit: 'KG',
                                updatedAt: timestamp,
                                syncStatus: 'pending'
                            };
                            if (updatePrice && price > 0) updated.price = price;
                            toUpdate.push(updated);

                            if (i % 50 === 0) setProgress(p => ({ ...p, current: i }));
                        }

                        setProgress({ current: rows.length, total: rows.length, stage: 'Guardando...' });

                        if (toUpdate.length) {
                            await localDB.products.bulkPut(toUpdate);
                        }

                        if (navigator.onLine && toUpdate.length) {
                            const chunkSize = 100;
                            for (let j = 0; j < toUpdate.length; j += chunkSize) {
                                try {
                                    const chunk = toUpdate.slice(j, j + chunkSize);
                                    const batch = writeBatch(firestoreDB);
                                    chunk.forEach(p => {
                                        const { syncStatus, stock, ...cloudData } = p;
                                        const pRef = doc(firestoreDB, `companies/${user.companyId}/products`, p.id);
                                        batch.set(pRef, { ...cloudData, lastUpdated: serverTimestamp() }, { merge: true });
                                    });
                                    await batch.commit();
                                    const ids = chunk.map(p => p.id);
                                    await localDB.products.bulkUpdate(ids.map(id => ({ key: id, changes: { syncStatus: 'synced' } })));
                                } catch (e) {
                                    console.warn('Batch balanza falló, syncService reintentará:', e);
                                    break;
                                }
                            }
                        }

                        resolve({ matched: toUpdate.length, unmatched: unmatched.length, unmatchedNames: unmatched });
                    } catch (error) {
                        reject(error);
                    } finally {
                        setIsProcessing(false);
                    }
                },
                error: (err) => { setIsProcessing(false); reject(err); }
            });
        });
    };

    return { parseFile, processImport, processScaleImport, previewData, file, isProcessing, progress };
};