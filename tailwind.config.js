/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Sistema "Enterprise Shell" - Neutrales y Sobrios
        sys: {
          50: '#f8fafc',  // Fondos principales (casi blanco)
          100: '#f1f5f9', // Fondos secundarios
          200: '#e2e8f0', // Bordes sutiles
          300: '#cbd5e1', // Bordes activos
          500: '#64748b', // Texto secundario
          800: '#1e293b', // Texto principal
          900: '#0f172a', // Elementos oscuros / Headers
        },
        // Acento "Premium" (Azul corporativo o similar)
        brand: {
          DEFAULT: '#0066CC', // Apple Blue style
          hover: '#004499',
          light: '#E5F1FF'
        },
        // Semánticos para el POS
        pos: {
          success: '#34C759', // Verde éxito
          warning: '#FF9500', // Naranja alerta
          error: '#FF3B30',   // Rojo error
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        'soft': '0 2px 8px 0 rgba(0, 0, 0, 0.05), 0 0 1px 0 rgba(0,0,0,0.1)', // Sombra estilo tarjeta Apple
        'float': '0 10px 30px -10px rgba(0, 0, 0, 0.1)',
      }
    },
  },
  plugins: [],
}