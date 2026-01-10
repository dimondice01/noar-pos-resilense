import { collection, query, limit, getDocs } from 'firebase/firestore'; 
import { db as firestore } from '../../../database/firebase';
import { getDB } from '../../../database/db';

export const movementsRepository = {
  
  /**
   * 🏠 MODO LOCAL
   */
  async getAllLocal() {
    const db = await getDB();
    const [movements, products, categories, suppliers] = await Promise.all([
      db.getAll('movements'),
      db.getAll('products'),
      db.getAll('categories'),
      db.objectStoreNames.contains('suppliers') ? db.getAll('suppliers') : [] 
    ]);

    return this._enrichData(movements, products, categories, suppliers);
  },

  /**
   * ☁️ MODO NUBE (SIN FILTROS DE FECHA)
   * Esto forzará a mostrar lo que sea que haya en Firebase.
   */
  async getCloudByDate(dateStr) {
    console.log(`☁️ [DEBUG] Consultando Nube SIN FILTROS...`);
    
    const movRef = collection(firestore, 'movements');
    const prodRef = collection(firestore, 'products');
    const catRef = collection(firestore, 'categories');
    const supRef = collection(firestore, 'suppliers');

    // 🚨 QUITAMOS LOS WHERE DE FECHA PARA VER SI APARECEN LOS DATOS
    // Solo pedimos los primeros 50 documentos.
    const qMov = query(movRef, limit(50));
    
    const [snapMov, snapProd, snapCat, snapSup] = await Promise.all([
        getDocs(qMov),
        getDocs(prodRef), 
        getDocs(catRef),
        getDocs(supRef) 
    ]);

    console.log(`☁️ [DEBUG] ¡Encontrados! -> ${snapMov.size} Movimientos`);
    
    // 👇 LOG EXTRA: Ver qué fechas tienen realmente para corregir el filtro luego
    snapMov.docs.forEach(d => console.log("📅 Fecha en Firebase:", d.data().date, "Tipo:", typeof d.data().date));

    const movements = snapMov.docs.map(d => ({ ...d.data(), id: d.id }));
    const products = snapProd.docs.map(d => ({ ...d.data(), id: d.id }));
    const categories = snapCat.docs.map(d => ({ ...d.data(), id: d.id }));
    const suppliers = snapSup.docs.map(d => ({ ...d.data(), id: d.id }));

    return {
        data: this._enrichData(movements, products, categories, suppliers),
        categories: categories,
        suppliers: suppliers
    };
  },

  /**
   * 🧠 Helper BLINDADO
   */
  _enrichData(movements, products, categories, suppliers) {
    const productMap = new Map(products.map(p => [String(p.id), p]));
    const categoryMap = new Map(categories.map(c => [String(c.id), c.name]));
    const supplierMap = new Map(suppliers.map(s => [String(s.id), s.name]));

    return movements.map(mov => {
      const prodIdStr = String(mov.productId);
      const product = productMap.get(prodIdStr);
      
      let categoryName = '---';
      let supplierName = '---';

      if (product) {
          const catIdStr = String(product.categoryId);
          categoryName = categoryMap.get(catIdStr) || 'Sin Categoría';
          
          if (product.supplierId) {
             const supIdStr = String(product.supplierId);
             supplierName = supplierMap.get(supIdStr) || 'Sin Proveedor';
          }
      }

      // Normalización de fecha
      let dateObj = new Date();
      try {
          // Soporte para Timestamp de Firebase
          if (mov.date && typeof mov.date.toDate === 'function') {
              dateObj = mov.date.toDate();
          } 
          // Soporte para String o Number
          else if (mov.date) {
              dateObj = new Date(mov.date);
          }
          // Fallback
          else if (mov.createdAt) {
              dateObj = new Date(mov.createdAt);
          }
      } catch (e) {
          console.warn("Error parseando fecha", e);
      }

      return {
        ...mov,
        productName: product ? product.name : `(ID: ${mov.productId})`,
        productCode: product ? product.code : '',
        categoryName, 
        categoryId: product ? product.categoryId : null,
        supplierName,
        dateObj
      };
    }).sort((a, b) => b.dateObj - a.dateObj); 
  }
};