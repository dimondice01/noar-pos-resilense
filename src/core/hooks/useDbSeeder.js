import { useState } from 'react';
import Papa from 'papaparse';
import { collection, writeBatch, doc, getDocs, serverTimestamp } from 'firebase/firestore'; 
import { db } from '../../database/firebase';

export const useDbSeeder = () => {
  const [loadingMsg, setLoadingMsg] = useState("");
  const [isSeeding, setIsSeeding] = useState(false);
  const delay = ms => new Promise(res => setTimeout(res, ms));

  // ========================================================================
  // ⚙️ NÚCLEO DE PROCESAMIENTO ENTERPRISE
  // ========================================================================
  // Separa lógica de "Catálogo Maestro" e "Inventario Inicial (Main Branch)"
  // ========================================================================
  const processAndUpload = async (targetCompanyId, rows) => {
      try {
          if (rows.length === 0) throw new Error("El archivo está vacío.");

          setLoadingMsg("Analizando y normalizando datos...");
          const itemsMap = new Map();
          let processedCount = 0;

          // 1. LIMPIEZA Y NORMALIZACIÓN (Formato Kiosco/Despensa)
          rows.forEach((row) => {
              // Indices según tu CSV estándar: [0]=Nombre, [1]=Código, [3]=Precio
              const nameRaw = row[0]; 
              const codeRaw = row[1]; 
              const priceRaw = row[3]; 

              const code = String(codeRaw || '').trim();
              const name = String(nameRaw || '').trim().toUpperCase(); // Estandarización Enterprise
              
              // Limpieza de precio (quita $, comas, espacios)
              const priceStr = String(priceRaw || '0').replace(/[^0-9.,]/g, '').replace(',', '.');
              const price = parseFloat(priceStr) || 0;

              if (!code || !name) return; // Saltar filas inválidas

              processedCount++;

              // Estructura Dual: Maestro + Inventario
              itemsMap.set(code, {
                  // Datos Maestros (Globales)
                  master: {
                      id: code, 
                      code: code,
                      barcode: code, // Asumimos código interno = barras inicialmente
                      name: name,
                      price: price,
                      cost: 0, // Se puede inferir o dejar en 0
                      category: 'GENERAL', 
                      isWeighable: false, 
                      active: true,
                      createdAt: new Date().toISOString(),
                      syncStatus: 'synced' // Nube es la verdad absoluta
                  },
                  // Datos de Inventario (Local - Sucursal Principal)
                  inventory: {
                      productId: code,
                      stock: 0, // Stock inicial seguro
                      minStock: 5,
                      updatedAt: serverTimestamp() // Timestamp de servidor para sincronización
                  }
              });
          });

          if (itemsMap.size === 0) throw new Error("No se encontraron productos válidos en el archivo.");

          // 2. 🛡️ VERIFICACIÓN DE EXISTENCIA (Optimización de Lectura)
          setLoadingMsg(`🛡️ Verificando catálogo existente...`);
          
          const existingSnapshot = await getDocs(collection(db, 'companies', targetCompanyId, 'products'));
          const existingCodes = new Set();
          existingSnapshot.forEach(d => existingCodes.add(d.id));

          const itemsToUpload = [];
          let skippedCount = 0;

          for (const [code, item] of itemsMap) {
              if (existingCodes.has(code)) {
                  // 🛑 Si ya existe el maestro, lo saltamos para no pisar precios actuales.
                  // (En una implementación futura podríamos tener modo "Actualizar Precios")
                  skippedCount++;
              } else {
                  itemsToUpload.push(item);
              }
          }

          console.log(`📊 Reporte Seeder: ${itemsToUpload.length} Nuevos | ${skippedCount} Omitidos`);

          // 3. SUBIDA ATÓMICA POR LOTES (BATCH)
          // ⚠️ Firestore limita a 500 operaciones por Batch.
          // Como escribimos en 2 lugares (Producto + Inventario), el límite seguro es 200 items (400 ops).
          
          if (itemsToUpload.length > 0) {
              setLoadingMsg(`🚀 Inyectando ${itemsToUpload.length} productos a la Base de Datos...`);
              
              const BATCH_SIZE = 200; 
              const chunks = [];
              for (let i = 0; i < itemsToUpload.length; i += BATCH_SIZE) {
                  chunks.push(itemsToUpload.slice(i, i + BATCH_SIZE));
              }

              let batchCount = 0;
              for (const chunk of chunks) {
                  const batch = writeBatch(db);
                  
                  chunk.forEach(({ master, inventory }) => {
                      // A. Escribir Maestro Global
                      const productRef = doc(db, `companies/${targetCompanyId}/products`, master.id);
                      batch.set(productRef, master);

                      // B. Escribir Inventario Inicial (Sucursal 'main')
                      // Esto inicializa la matriz de stock correctamente
                      const inventoryRef = doc(db, `companies/${targetCompanyId}/branches/main/inventory`, master.id);
                      batch.set(inventoryRef, inventory);
                  });
                  
                  await batch.commit(); // 🔥 Commit Atómico
                  
                  batchCount++;
                  setLoadingMsg(`📦 Procesando Lote ${batchCount}/${chunks.length}...`);
                  await delay(300); // Pequeña pausa para estabilidad de red
              }
              
              setLoadingMsg(`✅ ¡Éxito! Se crearon ${itemsToUpload.length} productos y sus inventarios.`);
          } else {
              setLoadingMsg("⚠️ Catálogo al día: No se requirieron cambios.");
          }
          
          setIsSeeding(false);
          return itemsToUpload.length;

      } catch (err) {
          console.error("Error crítico en Seeder:", err);
          setLoadingMsg("Error: " + err.message);
          setIsSeeding(false);
          throw err;
      }
  };

  // 📂 OPCIÓN A: Cargar desde Archivo Local (Drag & Drop)
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
                setLoadingMsg("Error leyendo archivo CSV");
                setIsSeeding(false);
                reject(err);
            }
        });
    });
  };

  // 🌐 OPCIÓN B: Cargar desde URL (Plantillas Predefinidas)
  const seedFromUrl = async (targetCompanyId, url) => {
      if (!targetCompanyId || !url) return;
      setIsSeeding(true);
      setLoadingMsg("Descargando plantilla maestra...");

      try {
          const response = await fetch(url);
          if (!response.ok) throw new Error("No se pudo descargar la plantilla.");
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
          setLoadingMsg("Error de conexión");
          setIsSeeding(false);
          throw error;
      }
  };

  return { uploadCatalog, seedFromUrl, loadingMsg, isSeeding };
};