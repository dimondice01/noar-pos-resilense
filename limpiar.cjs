// limpiar.js
// Script para ELIMINAR la orden trabada en MercadoPago
const https = require('https');

const DEVICE_ID = "NEWLAND_N950__N950NCC904500758";
const TOKEN = "APP_USR-613005236982546-120215-3a81b19fe8fa9372f1c0161bef4676ac-2126819795";

const options = {
  hostname: 'api.mercadopago.com',
  path: `/point/integration-api/devices/${DEVICE_ID}/payment-intents`,
  method: 'DELETE',
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json'
  }
};

console.log("🔥 Intentando borrar la cola de MercadoPago...");

const req = https.request(options, (res) => {
  console.log(`📡 Respuesta del Servidor: Código ${res.statusCode}`);
  
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  
  res.on('end', () => {
    if (res.statusCode === 200 || res.statusCode === 204) {
        console.log("✅ ¡ÉXITO! La orden trabada fue eliminada.");
        console.log("👉 AHORA: Reinicia el posnet físico y prueba cobrar.");
    } else {
        console.log("❌ Error:", data);
        console.log("Si dice 'Resource not found', es que ya estaba vacía.");
    }
  });
});

req.on('error', (e) => {
  console.error(`❌ Error de conexión: ${e.message}`);
});

req.end();