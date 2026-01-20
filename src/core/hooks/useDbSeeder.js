import { useState } from 'react';
import Papa from 'papaparse';
import { collection, writeBatch, doc, getDocs } from 'firebase/firestore'; 
import { db } from '../../database/firebase';

export const useDbSeeder = () => {
  const [loadingMsg, setLoadingMsg] = useState("");
  const [isSeeding, setIsSeeding] = useState(false);
  const delay = ms => new Promise(res => setTimeout(res, ms));

  // ========================================================================
  // ⚙️ NÚCLEO DE PROCESAMIENTO (Compartido por Archivo y URL)
  // ========================================================================
  const processAndUpload = async (targetCompanyId, rows) => {
      try {
          if (rows.length === 0) throw new Error("El archivo está vacío.");

          setLoadingMsg("Analizando datos...");
          const csvMap = new Map();
          let processedCount = 0;

          // 1. LIMPIEZA Y NORMALIZACIÓN (Formato Kiosco/Despensa)
          rows.forEach((row) => {
              // Indices según tu CSV: [0]=Nombre, [1]=Código, [3]=Precio
              const nameRaw = row[0]; 
              const codeRaw = row[1]; 
              const priceRaw = row[3]; 

              const code = String(codeRaw || '').trim();
              const name = String(nameRaw || '').trim().toUpperCase(); // Todo mayúsculas para Kiosco
              
              // Limpieza de precio (quita $, comas, espacios)
              const priceStr = String(priceRaw || '0').replace(/[^0-9.,]/g, '').replace(',', '.');
              const price = parseFloat(priceStr) || 0;

              if (!code || !name) return; // Saltar filas inválidas

              processedCount++;

              // Mapa para deduplicar dentro del mismo archivo
              csvMap.set(code, {
                  id: code, 
                  code: code,
                  name: name,
                  price: price,
                  stock: 0, // 🔥 REGLA DE ORO: Stock inicial siempre 0 para obligar auditoría o compra
                  cost: 0, 
                  category: 'GENERAL', 
                  minStock: 5, 
                  isWeighable: false, // Por defecto no pesable (se cambia a mano si es fiambrería)
                  active: true,
                  createdAt: new Date().toISOString(),
                  syncStatus: 'SYNCED' 
              });
          });

          if (csvMap.size === 0) throw new Error("No se encontraron productos válidos en el archivo.");

          // 2. 🛡️ VERIFICACIÓN DE SEGURIDAD (CRÍTICO PARA CLIENTES EXISTENTES)
          // Descargamos SOLO los IDs existentes para ver qué ya está creado.
          setLoadingMsg(`🛡️ Protegiendo stock existente en empresa...`);
          
          const existingSnapshot = await getDocs(collection(db, 'companies', targetCompanyId, 'products'));
          const existingCodes = new Set();
          
          // Creamos un Set con los códigos que YA existen en la DB
          existingSnapshot.forEach(d => existingCodes.add(d.id));

          const productsToUpload = [];
          let skippedCount = 0;

          for (const [code, product] of csvMap) {
              if (existingCodes.has(code)) {
                  // 🛑 SI YA EXISTE, LO SALTAMOS. NO TOCAMOS STOCK NI PRECIO.
                  skippedCount++;
              } else {
                  // ✅ Solo si es nuevo, lo agregamos a la cola de subida
                  productsToUpload.push(product);
              }
          }

          console.log(`📊 Reporte: ${productsToUpload.length} Nuevos | ${skippedCount} Ignorados (Ya existían)`);

          // 3. SUBIDA EFICIENTE POR LOTES (BATCH)
          if (productsToUpload.length > 0) {
              setLoadingMsg(`🚀 Inyectando ${productsToUpload.length} productos nuevos...`);
              
              const chunkSize = 450; // Firebase permite 500 max por batch
              const chunks = [];
              for (let i = 0; i < productsToUpload.length; i += chunkSize) {
                  chunks.push(productsToUpload.slice(i, i + chunkSize));
              }

              let batchCount = 0;
              for (const chunk of chunks) {
                  const batch = writeBatch(db);
                  
                  chunk.forEach(prod => {
                      const docRef = doc(db, `companies/${targetCompanyId}/products`, prod.id);
                      batch.set(docRef, prod);
                  });
                  
                  await batch.commit(); // 🔥 1 sola llamada de red para 450 productos
                  
                  batchCount++;
                  setLoadingMsg(`📦 Lote ${batchCount}/${chunks.length} guardado...`);
                  await delay(500); // Pausa técnica para no saturar el navegador
              }
              
              setLoadingMsg(`✅ ¡Listo! Se agregaron ${productsToUpload.length} productos.`);
          } else {
              setLoadingMsg("⚠️ No hubo cambios: Todos los productos ya existían.");
          }
          
          setIsSeeding(false);
          return productsToUpload.length;

      } catch (err) {
          console.error("Error en proceso de seeding:", err);
          setLoadingMsg("Error: " + err.message);
          setIsSeeding(false);
          throw err;
      }
  };

  // 📂 OPCIÓN A: Cargar desde Archivo (Drag & Drop en Configuración)
  const uploadCatalog = async (targetCompanyId, file) => {
    if (!targetCompanyId || !file) return;
    setIsSeeding(true);
    
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: false, 
            skipEmptyLines: true,
            complete: async (results) => {
                try {
                    const count = await processAndUpload(targetCompanyId, results.data);
                    resolve(count);
                } catch (e) { reject(e); }
            },
            error: (err) => {
                setLoadingMsg("Error leyendo CSV local");
                setIsSeeding(false);
                reject(err);
            }
        });
    });
  };

  // 🌐 OPCIÓN B: Cargar desde URL (Para el Wizard de Registro)
  const seedFromUrl = async (targetCompanyId, url) => {
      if (!targetCompanyId || !url) return;
      setIsSeeding(true);
      setLoadingMsg("Descargando catálogo base...");

      try {
          const response = await fetch(url);
          if (!response.ok) throw new Error("No se pudo descargar el catálogo base.");
          const csvText = await response.text();

          return new Promise((resolve, reject) => {
              Papa.parse(csvText, {
                  header: false,
                  skipEmptyLines: true,
                  complete: async (results) => {
                      try {
                          const count = await processAndUpload(targetCompanyId, results.data);
                          resolve(count);
                      } catch (e) { reject(e); }
                  },
                  error: (err) => reject(err)
              });
          });
      } catch (error) {
          setLoadingMsg("Error de descarga");
          setIsSeeding(false);
          throw error;
      }
  };

  return { uploadCatalog, seedFromUrl, loadingMsg, isSeeding };
};