const https = require('https');

// TUS DATOS DE ORO
const DEVICE_ID = "NEWLAND_N950__N950NCC904500758";
const TOKEN = "APP_USR-613005236982546-120215-3a81b19fe8fa9372f1c0161bef4676ac-2126819795";

const data = JSON.stringify({
  "terminals": [
    {
      "id": DEVICE_ID,
      "operating_mode": "PDV" // 🔥 LA ORDEN SUPREMA
    }
  ]
});

const options = {
  hostname: 'api.mercadopago.com',
  path: '/terminals/v1/setup', // El endpoint que encontraste
  method: 'PATCH', // Es un PATCH, no un POST
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

console.log(`🚀 Enviando orden de transformación a PDV al dispositivo...`);

const req = https.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => { responseData += chunk; });
  
  res.on('end', () => {
    try {
        const json = JSON.parse(responseData);
        
        // Si responde con la lista de terminals actualizada, es un ÉXITO
        if (json.terminals && json.terminals.length > 0) {
            const terminal = json.terminals[0];
            console.log("-------------------------------------------");
            console.log("✅ ¡ORDEN RECIBIDA POR MERCADOPAGO!");
            console.log(`🆔 ID:   ${terminal.id}`);
            console.log(`🧠 MODO: ${terminal.operating_mode}`);
            console.log("-------------------------------------------");
            console.log("⚡ AHORA: Reinicia el Posnet Físico para que baje la orden.");
        } else {
            console.log("❌ Algo falló:", json);
        }
    } catch (e) {
        console.log("Respuesta rara:", responseData);
    }
  });
});

req.write(data);
req.end();