const https = require('https');

// 👇 DATOS NUEVOS
const CAJA_ID = "123176324"; 
const NUEVO_EXTERNAL_ID = "NOARPOS2"; // ✨ Nuevo y brillante
const TOKEN = "APP_USR-613005236982546-120215-3a81b19fe8fa9372f1c0161bef4676ac-2126819795";

const data = JSON.stringify({
  "external_id": NUEVO_EXTERNAL_ID, 
  "name": "Caja Noar (V2)"
});

const options = {
  hostname: 'api.mercadopago.com',
  path: `/pos/${CAJA_ID}`,
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

console.log(`🔧 Asignando ID '${NUEVO_EXTERNAL_ID}' a la caja...`);

const req = https.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => { responseData += chunk; });
  
  res.on('end', () => {
    const json = JSON.parse(responseData);
    if (res.statusCode === 200) {
        console.log("🎉 ¡LISTO! Caja actualizada.");
        console.log(`👉 Ahora tu ID Externo es: ${json.external_id}`);
    } else {
        console.log("❌ Error:", json);
    }
  });
});

req.write(data);
req.end();