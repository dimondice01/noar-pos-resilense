import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combina clases de Tailwind inteligentemente, resolviendo conflictos.
 * Ejemplo: cn('px-2 py-1', className)
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}