import { useEffect, useState } from 'react';
import { productRepository } from '../../modules/inventory/repositories/productRepository';

const MOCK_PRODUCTS = [
  { id: 'p1', code: '7791234567890', name: 'Coca Cola 2.25L', price: 2500, stock: 100, isWeighable: false },
  { id: 'p2', code: '200100', name: 'Jamón Cocido Paladini', price: 12000, stock: 5.500, isWeighable: true }, // Precio x Kg
  { id: 'p3', code: '200101', name: 'Queso Tybo Barraza', price: 9500, stock: 4.200, isWeighable: true },
  { id: 'p4', code: '1001', name: 'Pan Francés', price: 1800, stock: 20, isWeighable: true },
];

export const useDbSeeder = () => {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const seed = async () => {
      // Verificamos si ya hay datos
      const existing = await productRepository.getAll();
      if (existing.length === 0) {
        console.log('🌱 Sembrando base de datos local con datos de prueba...');
        await productRepository.saveAll(MOCK_PRODUCTS);
      } else {
        console.log('⚡ Base de datos local ya tiene datos. Listo.');
      }
      setIsReady(true);
    };

    seed();
  }, []);

  return isReady;
};