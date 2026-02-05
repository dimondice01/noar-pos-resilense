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
    { key: 'name', label: 'Nombre / Descripción', type: 'text', required: true },
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
        if (!val) return { unit: 'UN', isWeighable: false };
        const str = String(val).toLowerCase().trim();
        const weighableKeywords = ['kg', 'kilo', 'gramo', 'gr', 'lt', 'litro', 'mt', 'metro', 'pesable'];
        if (weighableKeywords.some(k => str.includes(k))) {
            return { unit: 'KG', isWeighable: true };
        }
        return { unit: 'UN', isWeighable: false };
    };

    // =================================================================
    // 🚀 PROCESADOR PRINCIPAL
    // =================================================================
    const processImport = async (columnMapping, branchId) => {
        if (!file || !user?.companyId) return;
        
        // 🔥 VALIDACIÓN OBLIGATORIA
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
                        setProgress({ current: 0, total: rows.length, stage: 'Analizando Datos...' });

                        // 1. CARGA DE MAESTROS
                        const existingCats = await localDB.categories.toArray();
                        const existingBrands = await localDB.brands.toArray();
                        const catMap = new Map(existingCats.map(c => [c.name.toUpperCase(), c.id]));
                        const brandMap = new Map(existingBrands.map(b => [b.name.toUpperCase(), b.id]));

                        const existingProducts = await localDB.products.toArray();
                        const productCodeMap = new Map(existingProducts.map(p => [String(p.code).trim().toUpperCase(), p]));

                        const newCategories = [];
                        const newBrands = [];
                        const productsToUpsert = [];
                        const stockUpdates = [];

                        // 3. BUCLE DE PROCESAMIENTO
                        for (let i = 0; i < rows.length; i++) {
                            const row = rows[i];
                            const rawData = {}; 

                            Object.keys(columnMapping).forEach(colIndex => {
                                const fieldKey = columnMapping[colIndex];
                                if (fieldKey !== 'ignore') rawData[fieldKey] = row[colIndex];
                            });

                            if (!rawData.name || !rawData.price) continue; 

                            // --- CATEGORÍAS ---
                            let categoryId = 'general';
                            let categoryName = 'GENERAL'; 

                            if (rawData.category) {
                                const rawCatName = String(rawData.category).trim().toUpperCase();
                                if (rawCatName) {
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
                            }

                            // --- MARCAS ---
                            let brandId = null;
                            let brandName = null;

                            if (rawData.brand) {
                                const rawBrandName = String(rawData.brand).trim().toUpperCase();
                                if (rawBrandName) {
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
                            }

                            // --- PRODUCTO ---
                            const code = rawData.code ? String(rawData.code).trim() : `GEN-${Date.now()}-${i}`;
                            const { unit, isWeighable } = normalizeUnit(rawData.unit);
                            
                            const existingProduct = productCodeMap.get(code.toUpperCase());
                            const productId = existingProduct ? existingProduct.id : crypto.randomUUID();
                            const stockQty = normalizeMoney(rawData.stock);

                            // 🔥 Sanitize: Aseguramos que ningún campo sea undefined
                            const product = {
                                id: productId,
                                code: code || '',
                                name: String(rawData.name).trim().toUpperCase() || 'SIN NOMBRE',
                                price: normalizeMoney(rawData.price),
                                cost: normalizeMoney(rawData.cost),
                                taxRate: normalizeTax(rawData.tax),
                                category: categoryName,
                                categoryId: categoryId,
                                brand: brandName,
                                brandId: brandId,
                                unit: unit,
                                isWeighable: isWeighable,
                                stock: 0, // 🔥 SIEMPRE 0 EN GLOBAL
                                active: true,
                                syncStatus: 'pending',
                                updatedAt: new Date().toISOString()
                            };

                            productsToUpsert.push(product);

                            if (stockQty > 0) {
                                stockUpdates.push({
                                    productId: productId,
                                    qty: stockQty,
                                    name: product.name,
                                    targetBranchId: branchId // 🔥 Aseguramos el destino
                                });
                            }

                            if (i % 50 === 0) setProgress(p => ({ ...p, current: i }));
                        }

                        // 4. GUARDADO LOCAL (Dexie)
                        setProgress({ current: rows.length, total: rows.length, stage: 'Guardando Catálogo...' });

                        await localDB.transaction('rw', [localDB.products, localDB.categories, localDB.brands], async () => {
                            if (newCategories.length) await localDB.categories.bulkPut(newCategories);
                            if (newBrands.length) await localDB.brands.bulkPut(newBrands);
                            if (productsToUpsert.length) await localDB.products.bulkPut(productsToUpsert);
                        });

                        // 5. SINCRONIZACIÓN NUBE (Firestore Batch)
                        if (stockUpdates.length > 0) {
                            setProgress({ current: rows.length, total: rows.length, stage: 'Sincronizando Stock...' });
                            
                            // Guardado local de inventario
                            await localDB.inventory.bulkPut(stockUpdates.map(s => ({
                                branchId: s.targetBranchId,
                                productId: s.productId,
                                stock: s.qty,
                                updatedAt: new Date().toISOString()
                            })));

                            // 🔥 FIX IMPORTANTE: Reducimos el lote a 200 items
                            // 200 items * 2 operaciones (Update + Log) = 400 operaciones (Seguro bajo 500)
                            const chunkSize = 200; 
                            
                            for (let i = 0; i < stockUpdates.length; i += chunkSize) {
                                const chunk = stockUpdates.slice(i, i + chunkSize);
                                const batch = writeBatch(firestoreDB);
                                const companyRef = doc(firestoreDB, 'companies', user.companyId);

                                chunk.forEach(item => {
                                    // Op 1: Actualizar Stock
                                    const invRef = doc(collection(companyRef, 'branches', item.targetBranchId, 'inventory'), item.productId);
                                    batch.set(invRef, {
                                        stock: item.qty,
                                        updatedAt: serverTimestamp()
                                    }, { merge: true });

                                    // Op 2: Registrar Movimiento
                                    const movRef = doc(collection(companyRef, 'stock_movements'));
                                    batch.set(movRef, {
                                        productId: item.productId || 'unknown',
                                        productName: item.name || 'Desconocido',
                                        branchId: item.targetBranchId,
                                        type: 'IN',
                                        reason: 'Importación Masiva',
                                        quantity: item.qty,
                                        date: serverTimestamp(),
                                        userId: user.uid || 'system'
                                    });
                                });

                                await batch.commit(); // 🔥 Si esto falla, ahora sí saltará al catch
                            }
                        }

                        resolve({ 
                            processed: productsToUpsert.length, 
                            categories: newCategories.length, 
                            brands: newBrands.length,
                            stockMovements: stockUpdates.length
                        });

                    } catch (error) {
                        console.error("Error Importación:", error);
                        reject(error); // 🔥 Esto asegura que la UI muestre el error rojo
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

    return { parseFile, processImport, previewData, file, isProcessing, progress };
};