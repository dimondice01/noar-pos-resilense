import { useEffect, useState } from 'react';
import Papa from 'papaparse';
import { productRepository } from '../../modules/inventory/repositories/productRepository';

export const useDbSeeder = () => {
  const [isReady, setIsReady] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");

  useEffect(() => {
    const seed = async () => {
      try {
        // 1. Verificar códigos existentes en la DB
        const allExisting = await productRepository.getAll();
        
        // Creamos un Set (Conjunto) que usaremos de memoria
        // Aquí guardaremos TANTO los de la DB como los que vayamos encontrando en el CSV
        const processedCodes = new Set(allExisting.map(p => String(p.code).trim()));

        const response = await fetch('/catalogo.csv');
        
        if (response.ok) {
          const rawText = await response.text();
          let cleanCsv = rawText;

          // Limpieza de cabecera basura
          if (rawText.startsWith("Listado actualizado")) {
             cleanCsv = rawText.substring(rawText.indexOf('\n') + 1);
          }

          setLoadingMsg("Analizando catálogo...");

          Papa.parse(cleanCsv, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
              const rows = results.data;
              const newProducts = [];
              
              // 🔄 BUCLE INTELIGENTE (Uno por uno)
              // En lugar de .map(), usamos un for para tener control total
              for (const row of rows) {
                  const code = String(row.CODIGO || '').trim();
                  const name = String(row.ARTICULO || '').trim();

                  // 1. Validación básica
                  if (!code || !name) continue;

                  // 2. DETECTOR DE DUPLICADOS
                  // Si el código YA ESTÁ en nuestro Set (porque venía de la DB o porque lo acabamos de ver en una fila anterior), lo saltamos.
                  if (processedCodes.has(code)) {
                      // Opcional: console.warn(`Duplicado ignorado: ${code} - ${name}`);
                      continue; 
                  }

                  // 3. Si es nuevo, lo agregamos a la lista y al Set para no repetirlo
                  processedCodes.add(code);

                  newProducts.push({
                      id: crypto.randomUUID(),
                      code: code,
                      name: name.toUpperCase(),
                      price: parseFloat(row.PRECIO) || 0,
                      stock: parseFloat(row.STOCK) || 0,
                      
                      // Defaults
                      cost: 0, 
                      category: 'GENERAL', 
                      minStock: 5,
                      isWeighable: false,
                      createdAt: new Date().toISOString(),
                      syncStatus: 'PENDING'
                  });
              }

              // Guardar en lotes
              if (newProducts.length > 0) {
                setLoadingMsg(`Importando ${newProducts.length} productos únicos...`);
                console.log(`✨ Se filtraron duplicados. Importando ${newProducts.length} productos reales.`);
                
                const BATCH_SIZE = 500;
                for (let i = 0; i < newProducts.length; i += BATCH_SIZE) {
                   const batch = newProducts.slice(i, i + BATCH_SIZE);
                   try {
                     await productRepository.saveAll(batch);
                   } catch (err) {
                     console.error(`Error en lote ${i}:`, err);
                     // Si falla un lote, seguimos con el siguiente
                   }
                }
                console.log(`✅ Importación finalizada.`);
              } else {
                console.log('👍 Todo al día (o todo era duplicado).');
              }
              
              setIsReady(true);
            },
            error: (err) => {
              console.error("Error CSV:", err);
              setIsReady(true);
            }
          });
        } else {
          console.warn("⚠️ No se encontró public/catalogo.csv");
          setIsReady(true);
        }
      } catch (error) {
        console.error("❌ Error General:", error);
        setIsReady(true);
      }
    };

    seed();
  }, []);

  return { isReady, loadingMsg };
};