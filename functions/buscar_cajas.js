const axios = require("axios");

// 🔴 PEGA TU TOKEN AQUÍ (El de siempre, TEST-...)
const ACCESS_TOKEN = "APP_USR-613005236982546-120215-3a81b19fe8fa9372f1c0161bef4676ac-2126819795"; 

async function buscar() {
  try {
    console.log("🕵️ Buscando cajas en MercadoPago...");
    
    // Consultamos la API de POS
    const response = await axios.get("https://api.mercadopago.com/pos", {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });

    const cajas = response.data.results; // O response.data.paging.results a veces

    if (!cajas || cajas.length === 0) {
      console.log("⚠️ No encontré ninguna caja. ¿Seguro que creaste la Sucursal y la Caja en la web?");
    } else {
      console.log(`✅ ¡ENCONTRÉ ${cajas.length} CAJA(S)!`);
      console.log("------------------------------------------------");
      cajas.forEach(caja => {
        console.log(`🏷️  Nombre visible:  ${caja.name}`);
        console.log(`🔑 ID EXTERNO:      ${caja.external_id}`); // <--- ESTE ES EL QUE NECESITAMOS
        console.log(`🆔 ID Numérico:     ${caja.id}`);
        console.log("------------------------------------------------");
      });
      console.log("👉 Copia el 'ID EXTERNO' y ponlo en functions/index.js");
    }

  } catch (error) {
    console.error("❌ Error al buscar:");
    console.error(error.response ? error.response.data : error.message);
  }
}

buscar();