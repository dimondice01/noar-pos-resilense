import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
// 👇 ESTA ES LA LÍNEA CLAVE. Debe apuntar a la carpeta styles
import './styles/index.css' 

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)