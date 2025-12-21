// ver_cajas.cjs
const https = require('https');

const TOKEN = "APP_USR-613005236982546-120215-3a81b19fe8fa9372f1c0161bef4676ac-2126819795"; // Tu token

const options = {
  hostname: 'api.mercadopago.com',
  path: '/pos', // Endpoint para listar todas las cajas
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json'
  }
};

console.log("🔍 Buscando Cajas...");

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  
  res.on('end', () => {
    const json = JSON.parse(data);
    console.log("👇 TUS CAJAS DISPONIBLES:");
    
    if(json.results) {
        json.results.forEach(caja => {
            console.log(`--------------------------------`);
            console.log(`🆔 ID Interno (USAR ESTE): ${caja.id}`);
            console.log(`📛 Nombre: ${caja.name}`);
            console.log(`🔑 External ID Actual: ${caja.external_id}`);
            console.log(`📅 Sucursal ID: ${caja.store_id}`);
        });
    } else {
        console.log(json);
    }
  });
});

req.end();