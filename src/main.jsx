import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
// 👇 Tu import de estilos original
import './styles/index.css' 

// 🚀 ARRANQUE DIRECTO (Sin bloqueos)
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)