import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { VitePWA } from 'vite-plugin-pwa' // 👈 Importamos el plugin

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({ 
      // 🔥 ESTRATEGIA DE ACTUALIZACIÓN:
      // 'autoUpdate' hace que la App descargue la nueva versión en segundo plano 
      // y pida recargar (o recargue sola) cuando esté lista.
      registerType: 'autoUpdate', 
      
      // Archivos estáticos críticos
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'], 
      
      // 🧠 CEREBRO DEL OFFLINE (Workbox):
      workbox: {
        // Cacheamos HTML, JS, CSS, Imágenes, JSON
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'], 
        
        // Limpia cachés viejas para no llenar el disco
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        
        // Estrategias de caché avanzadas
        runtimeCaching: [
            // Fuentes de Google (si usaras) - Cache First (Primero Disco)
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365 // 1 año
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            // Imágenes externas - Cache First
            {
                urlPattern: ({ request }) => request.destination === 'image',
                handler: 'CacheFirst',
                options: {
                    cacheName: 'images',
                    expiration: {
                        maxEntries: 60,
                        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Días
                    },
                },
            }
        ]
      },
      
      // 📱 APARIENCIA NATIVA (Manifest):
      manifest: {
        name: 'Noar POS Resilense',
        short_name: 'NoarPOS',
        description: 'Sistema de Punto de Venta Resiliente',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone', // <== Clave para que parezca App de Windows (sin barra de navegador)
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png', // Asegúrate de que estas imágenes existan en /public
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
})