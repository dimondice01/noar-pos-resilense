/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ─── Neutros cálidos (reemplazan los slate/grises fríos) ───
        sys: {
          50:  '#FAFAF8', // Fondo base de la app
          100: '#F4F4F0', // Fondo secundario / sidebar
          200: '#EAEAE4', // Bordes sutiles
          300: '#D0D0C8', // Bordes activos / divisores
          400: '#B0B0A6', // Placeholder / iconos deshabilitados
          500: '#7A7A6E', // Texto terciario
          600: '#5A5A50', // Texto secundario
          700: '#3D3D35', // Texto principal suave
          800: '#2A2A22', // Texto principal
          900: '#1A1A14', // Headers / texto oscuro máximo
        },

        // ─── Brand: Burnt Orange ───
        brand: {
          DEFAULT: '#C2410C', // Naranja quemado principal
          hover:   '#9A3412', // Hover / pressed
          active:  '#7C2D12', // Active state / dark variant
          light:   '#FFF7ED', // Fondos sutiles de acento
          muted:   '#FED7AA', // Badges / chips suaves
        },

        // ─── Superficies (cards, modals, inputs) ───
        surface: {
          base:    '#FFFFFF', // Cards y modales
          raised:  '#F9F9F7', // Cards elevadas sobre fondo
          overlay: '#F4F4F0', // Fondos de sección interna
          inverse: '#2A2A22', // Superficies oscuras (ej: header dark)
        },

        // ─── Texto ───
        text: {
          primary:   '#1A1A14',
          secondary: '#5A5A50',
          muted:     '#9A9A8E',
          disabled:  '#C0C0B8',
          inverse:   '#FFFFFF',
          brand:     '#C2410C',
        },

        // ─── Bordes ───
        border: {
          subtle:  '#EAEAE4',
          default: '#D0D0C8',
          strong:  '#B0B0A6',
          brand:   '#C2410C',
          error:   '#EF4444',
        },

        // ─── Semánticos POS ───
        pos: {
          success:      '#16A34A',
          successLight: '#DCFCE7',
          warning:      '#D97706',
          warningLight: '#FEF3C7',
          error:        '#DC2626',
          errorLight:   '#FEE2E2',
          info:         '#2563EB',
          infoLight:    '#DBEAFE',
        },

        // ─── Estados de sincronización ───
        sync: {
          pending: '#F59E0B',
          synced:  '#16A34A',
          error:   '#DC2626',
          offline: '#9A9A8E',
        },
      },

      // ─── Tipografía ───
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      fontSize: {
        'xs':   ['0.75rem',  { lineHeight: '1rem',    letterSpacing: '0.01em' }],
        'sm':   ['0.875rem', { lineHeight: '1.25rem', letterSpacing: '0.005em' }],
        'base': ['1rem',     { lineHeight: '1.5rem',  letterSpacing: '0' }],
        'lg':   ['1.125rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em' }],
        'xl':   ['1.25rem',  { lineHeight: '1.75rem', letterSpacing: '-0.01em' }],
        '2xl':  ['1.5rem',   { lineHeight: '2rem',    letterSpacing: '-0.02em' }],
        '3xl':  ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.02em' }],
        '4xl':  ['2.25rem',  { lineHeight: '2.5rem',  letterSpacing: '-0.03em' }],
      },

      // ─── Sombras ───
      boxShadow: {
        'xs':    '0 1px 2px 0 rgba(26,26,20,0.05)',
        'soft':  '0 2px 8px 0 rgba(26,26,20,0.06), 0 0 1px 0 rgba(26,26,20,0.08)',
        'card':  '0 4px 16px -2px rgba(26,26,20,0.08), 0 0 1px 0 rgba(26,26,20,0.06)',
        'modal': '0 20px 60px -10px rgba(26,26,20,0.18), 0 0 1px 0 rgba(26,26,20,0.1)',
        'float': '0 10px 30px -10px rgba(26,26,20,0.12)',
        'brand': '0 4px 14px 0 rgba(194,65,12,0.30)',
      },

      // ─── Border Radius ───
      borderRadius: {
        'xs':     '4px',
        'sm':     '6px',
        'md':     '8px',
        'lg':     '12px',
        'xl':     '16px',
        '2xl':    '20px',
        '3xl':    '24px',
        'full':   '9999px',
        // Semánticos
        'badge':  '6px',
        'button': '10px',
        'input':  '10px',
        'card':   '16px',
        'modal':  '20px',
      },

      // ─── Transiciones ───
      transitionDuration: {
        'fast': '120ms',
        'base': '200ms',
        'slow': '350ms',
      },
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'bounce-soft': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },

      // ─── Espaciado extra ───
      spacing: {
        '4.5': '1.125rem',
        '13':  '3.25rem',
        '15':  '3.75rem',
        '18':  '4.5rem',
      },
    },
  },
  plugins: [],
}