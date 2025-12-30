import { useState } from 'react';
import Papa from 'papaparse';
import { collection, writeBatch, doc, getDocs } from 'firebase/firestore'; 
import { db } from '../../database/firebase';

export const useDbSeeder = () => {
  const [loadingMsg, setLoadingMsg] = useState("");
  const [isSeeding, setIsSeeding] = useState(false);
  const delay = ms => new Promise(res => setTimeout(res, ms));

  const uploadCatalog = async (targetCompanyId, file) => {
    
    if (!targetCompanyId) { alert("❌ Faltó ID Empresa"); return; }
    if (!file) { alert("❌ Faltó Archivo"); return; }

    setIsSeeding(true);
    setLoadingMsg(`Leyendo archivo local...`);

    return new Promise((resolve, reject) => {
        // ⚙️ CAMBIO CLAVE: header: false
        // Esto le dice al sistema: "No busques títulos, dame los datos crudos por posición [0, 1, 2...]"
        Papa.parse(file, {
            header: false, 
            skipEmptyLines: true,
            complete: async (results) => {
                try {
                    const rows = results.data;
                    
                    if (rows.length === 0) {
                        throw new Error("El archivo CSV está vacío.");
                    }

                    console.log("🔍 Ejemplo de fila cruda:", rows[0]); // Para depuración

                    const csvMap = new Map();
                    let processedCount = 0;

                    // 1. PROCESAR FILAS POR POSICIÓN (ÍNDICES)
                    rows.forEach((row) => {
                        // Tu CSV es: NOMBRE, CODIGO, STOCK, PRECIO
                        // Array:     [0],    [1],    [2],   [3]
                        
                        const nameRaw = row[0]; // Columna A
                        const codeRaw = row[1]; // Columna B
                        const priceRaw = row[3]; // Columna D (La C es stock, la saltamos)

                        const code = String(codeRaw || '').trim();
                        const name = String(nameRaw || '').trim();
                        
                        // Limpieza de precio (quita símbolos raros si hay)
                        const price = parseFloat(String(priceRaw).replace('$','').replace(',','')) || 0;

                        // Validación mínima
                        if (!code || !name) return;

                        // Detectar si la primera fila es un encabezado accidental
                        // Si el código dice "CODIGO" o "779..." no es un número válido, lo saltamos si quieres, 
                        // pero tu archivo parece no tener headers, así que procesamos todo.
                        
                        processedCount++;

                        // Guardamos en el Mapa (Deduplicación automática)
                        csvMap.set(code, {
                            id: code, 
                            code: code,
                            name: name.toUpperCase(),
                            price: price,
                            stock: 0, // Regla de negocio: Stock 0
                            cost: 0, 
                            category: 'GENERAL', 
                            minStock: 5, 
                            isWeighable: false,
                            active: true,
                            createdAt: new Date().toISOString(),
                            syncStatus: 'SYNCED' 
                        });
                    });

                    console.log(`📊 Productos válidos detectados: ${processedCount}`);

                    if (csvMap.size === 0) {
                        throw new Error(`❌ No se pudieron leer productos. Revisa que el CSV tenga el formato correcto.`);
                    }

                    // 2. VERIFICAR NUBE (Para no sobrescribir)
                    setLoadingMsg(`☁️ Verificando duplicados en ${targetCompanyId}...`);
                    const existingSnapshot = await getDocs(collection(db, 'companies', targetCompanyId, 'products'));
                    const existingCodes = new Set();
                    existingSnapshot.forEach(d => existingCodes.add(d.id));

                    const productsToUpload = [];
                    for (const [code, product] of csvMap) {
                        if (!existingCodes.has(code)) {
                            productsToUpload.push(product);
                        }
                    }

                    // 3. SUBIDA POR LOTES (Batch)
                    if (productsToUpload.length > 0) {
                        setLoadingMsg(`🚀 Subiendo ${productsToUpload.length} productos...`);
                        
                        const chunkSize = 450;
                        const chunks = [];
                        for (let i = 0; i < productsToUpload.length; i += chunkSize) {
                            chunks.push(productsToUpload.slice(i, i + chunkSize));
                        }

                        let batchCount = 0;
                        for (const chunk of chunks) {
                            let success = false;
                            let attempts = 0;

                            while (!success && attempts < 3) {
                                try {
                                    const batch = writeBatch(db);
                                    chunk.forEach(prod => {
                                        // Guardar en la colección de la empresa
                                        const docRef = doc(db, `companies/${targetCompanyId}/products`, prod.id);
                                        batch.set(docRef, prod);
                                    });
                                    await batch.commit();
                                    success = true;
                                } catch (e) {
                                    attempts++;
                                    console.warn(`Reintento lote... (${attempts}/3)`);
                                    await delay(2000);
                                }
                            }
                            if (!success) throw new Error("Error de red al subir datos.");
                            
                            batchCount++;
                            setLoadingMsg(`📦 Lote ${batchCount}/${chunks.length} subido...`);
                        }
                        console.log(`✅ Carga finalizada.`);
                    } else {
                        console.log('⚠️ Todo ya existía.');
                    }
                    
                    setIsSeeding(false);
                    setLoadingMsg(""); 
                    resolve(productsToUpload.length);

                } catch (innerError) {
                    console.error("Error procesando:", innerError);
                    setLoadingMsg("Error: " + innerError.message);
                    setIsSeeding(false);
                    reject(innerError);
                }
            },
            error: (err) => {
                console.error("Error CSV:", err);
                setLoadingMsg("Error leyendo archivo");
                setIsSeeding(false);
                reject(err);
            }
        });
    });
  };

  return { uploadCatalog, loadingMsg, isSeeding };
};