import { useState } from 'react';
import Papa from 'papaparse';
import { productRepository } from '../../modules/inventory/repositories/productRepository';
import { collection, getDocs, limit, query, writeBatch, doc } from 'firebase/firestore'; // Importamos writeBatch y doc
import { db } from '../../database/firebase';

export const useDbSeeder = () => {
  const [loadingMsg, setLoadingMsg] = useState("");
  const [isSeeding, setIsSeeding] = useState(false);

  const uploadMasterCatalog = async () => {
    setIsSeeding(true);
    setLoadingMsg("Verificando...");

    try {
      // 1. OBTENER CSV
      const response = await fetch('/catalogo.csv');
      
      if (!response.ok) {
        throw new Error("❌ No se encontró public/catalogo.csv");
      }

      const rawText = await response.text();
      // Limpieza simple por si el CSV tiene encabezados raros de Excel
      let cleanCsv = rawText;
      if (rawText.startsWith("Listado actualizado")) {
          cleanCsv = rawText.substring(rawText.indexOf('\n') + 1);
      }

      setLoadingMsg("Analizando y limpiando duplicados...");

      Papa.parse(cleanCsv, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          const rows = results.data;
          const uniqueProducts = new Map(); // Usamos Map para garantizar unicidad por CÓDIGO
          let duplicadosCount = 0;
          
          // 2. FILTRADO INTELIGENTE
          for (const row of rows) {
              // Limpiamos espacios y forzamos string
              const code = String(row.CODIGO || '').trim();
              const name = String(row.ARTICULO || '').trim();

              // Si no tiene código o nombre, basura.
              if (!code || !name) continue;

              // Si ya existe en nuestro Map, es un duplicado. Lo ignoramos.
              if (uniqueProducts.has(code)) {
                  duplicadosCount++;
                  console.warn(`🗑️ Duplicado detectado y omitido: ${code} - ${name}`);
                  continue; 
              }

              // Si es nuevo, lo preparamos
              uniqueProducts.set(code, {
                  // Usamos el código como ID del documento para evitar duplicados en Firestore también
                  // id: crypto.randomUUID(), <--- CAMBIO: NO usar ID aleatorio si queremos evitar duplicados fáciles
                  // Mejor usamos un ID generado, pero garantizamos unicidad por lógica.
                  // Pero para el maestro, usar el código como ID es una estrategia válida, 
                  // aunque Firestore prefiere IDs aleatorios para distribución.
                  // Mantendremos ID aleatorio pero filtraremos antes.
                  
                  id: crypto.randomUUID(), 
                  code: code,
                  name: name.toUpperCase(),
                  price: parseFloat(row.PRECIO) || 0,
                  stock: 0,
                  cost: 0, 
                  category: 'GENERAL', 
                  minStock: 5, 
                  isWeighable: false,
                  createdAt: new Date().toISOString(),
                  syncStatus: 'SYNCED' 
              });
          }

          const productsArray = Array.from(uniqueProducts.values());

          if (productsArray.length > 0) {
            setLoadingMsg(`Subiendo ${productsArray.length} productos únicos (${duplicadosCount} duplicados eliminados)...`);
            
            // 3. SUBIDA POR LOTES (BATCH) OPTIMIZADA
            // Firestore aguanta 500 ops por batch. Haremos chunks de 450.
            const chunkSize = 450;
            const chunks = [];
            for (let i = 0; i < productsArray.length; i += chunkSize) {
                chunks.push(productsArray.slice(i, i + chunkSize));
            }

            let batchCount = 0;
            for (const chunk of chunks) {
                const batch = writeBatch(db);
                chunk.forEach(prod => {
                    // Referencia a master_products
                    const docRef = doc(db, "master_products", prod.id);
                    batch.set(docRef, prod);
                });
                await batch.commit();
                batchCount++;
                setLoadingMsg(`☁️ Lote ${batchCount}/${chunks.length} subido...`);
            }

            setLoadingMsg(`✅ ¡Listo! ${productsArray.length} productos cargados.`);
            alert(`Proceso finalizado.\n\n✅ Cargados: ${productsArray.length}\n🗑️ Duplicados eliminados: ${duplicadosCount}`);
          } else {
            setLoadingMsg('⚠️ El CSV no tenía productos válidos.');
          }
          
          setIsSeeding(false);
        },
        error: (err) => {
          console.error("Error CSV:", err);
          setLoadingMsg("Error leyendo CSV");
          setIsSeeding(false);
        }
      });
    } catch (error) {
      console.error("Error Seeder:", error);
      setLoadingMsg("Error: " + error.message);
      setIsSeeding(false);
    }
  };

  return { uploadMasterCatalog, loadingMsg, isSeeding };
};