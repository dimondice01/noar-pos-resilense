import { getDB } from '../../../database/db';

export const masterRepository = {
  // Obtener lista (storeName = 'categories' | 'brands' | 'suppliers')
  async getAll(storeName) {
    const db = await getDB();
    return db.getAll(storeName);
  },

  // Guardar item
  async save(storeName, item) {
    const db = await getDB();
    // Normalizamos: guardamos solo el nombre (value)
    // Si quisieras objetos complejos, aquí lo manejas
    const newItem = {
      ...item,
      // Si no tiene ID, dejamos que IDB lo genere (autoIncrement) o generamos uno si editamos
    };
    return db.put(storeName, newItem);
  },

  // Borrar
  async delete(storeName, id) {
    const db = await getDB();
    return db.delete(storeName, id);
  }
};