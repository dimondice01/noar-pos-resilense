import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
// 👇 Tu import de estilos original (lo respetamos)
import './styles/index.css' 
// 👇 Importamos el Hook del Sembrador que creamos
import { useDbSeeder } from './core/hooks/useDbSeeder';

const Root = () => {
  // 1. Invocamos al Sembrador
  // Este hook leerá el CSV automáticamente al iniciar
  const { isReady, loadingMsg } = useDbSeeder();

  // 2. Si NO está listo, mostramos Pantalla de Carga Profesional
  if (!isReady) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-sys-100 gap-6 animate-in fade-in duration-500">
        
        {/* Spinner Personalizado */}
        <div className="relative">
          <div className="w-16 h-16 border-4 border-sys-200 rounded-full"></div>
          <div className="absolute top-0 left-0 w-16 h-16 border-4 border-brand border-t-transparent rounded-full animate-spin"></div>
        </div>

        {/* Mensajes de Estado (Cambiarán según lo que haga el Seeder) */}
        <div className="text-center space-y-2">
          <h2 className="text-xl font-black text-sys-900 tracking-tight">NOAR POS</h2>
          <p className="text-sm font-medium text-sys-500 animate-pulse">
            {loadingMsg || "Iniciando sistema..."}
          </p>
        </div>

        {/* Barra de progreso decorativa */}
        <div className="w-48 h-1 bg-sys-200 rounded-full overflow-hidden mt-4">
          <div className="h-full bg-brand animate-progress-indeterminate"></div>
        </div>
      </div>
    );
  }

  // 3. Si está listo, mostramos la App Real
  return <App />;
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)