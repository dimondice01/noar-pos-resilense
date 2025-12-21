const https = require('https');

const DEVICE_ID = "NEWLAND_N950__N950NCC904500758"; // Tu ID largo
const TOKEN = "APP_USR-613005236982546-120215-3a81b19fe8fa9372f1c0161bef4676ac-2126819795";

const options = {
  hostname: 'api.mercadopago.com',
  path: `/point/integration-api/devices/${DEVICE_ID}`,
  method: 'GET',
  headers: { 'Authorization': `Bearer ${TOKEN}` }
};

console.log("📡 Consultando cerebro del Point...");

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const info = JSON.parse(data);
    console.log("------------------------------------------------");
    console.log(`🧠 MODO ACTUAL: ${info.operating_mode}`); // <--- ESTO ES LO QUE IMPORTA
    console.log(`🆔 Estado: ${info.state}`);
    console.log("------------------------------------------------");
    
    if (info.operating_mode === 'STANDALONE') {
        console.log("❌ ERROR: El aparato está en modo 'Calculadora'.");
        console.log("👉 SOLUCIÓN: Tienes que cambiarlo a 'PDV' sí o sí.");
    } else if (info.operating_mode === 'PDV') {
        console.log("✅ BIEN: El aparato está escuchando.");
        console.log("👉 Si no suena, es problema de WiFi/Internet.");
    }
  });
});
req.end();