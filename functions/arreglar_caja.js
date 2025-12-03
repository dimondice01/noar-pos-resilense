const axios = require("axios");

// 🔴 USA TU TOKEN DE PRODUCCIÓN (APP_USR-...) 
// Necesitamos permisos de admin para "arreglar" la caja.
const ACCESS_TOKEN = "APP_USR-613005236982546-120215-3a81b19fe8fa9372f1c0161bef4676ac-2126819795"; 

// Este es el ID Numérico de la caja que encontramos en el paso anterior
const CAJA_ID_NUMERICO = "122114388"; 

// Este es el ID Externo que queremos asignarle para que el sistema funcione
const NUEVO_EXTERNAL_ID = "NOARPOS1";

async function reparar() {
  try {
    console.log(`🔧 Reparando Caja ${CAJA_ID_NUMERICO}...`);
    
    const url = `https://api.mercadopago.com/pos/${CAJA_ID_NUMERICO}`;
    
    // Enviamos una actualización (PUT) para fijar el external_id
    const response = await axios.put(url, 
      {
        external_id: NUEVO_EXTERNAL_ID,
        name: "Caja Noar (Reparada)" // Le cambiamos el nombre para confirmar
      }, 
      {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
      }
    );

    console.log("✅ ¡CAJA REPARADA EXITOSAMENTE!");
    console.log("------------------------------------------------");
    console.log(`🆔 ID Numérico: ${response.data.id}`);
    console.log(`🔑 NUEVO ID EXTERNO: ${response.data.external_id}`);
    console.log("------------------------------------------------");
    console.log("🚀 AHORA SÍ: Tu sistema puede conectarse a 'SUC001_POS001'.");

  } catch (error) {
    console.error("❌ Error al reparar:");
    console.error(error.response ? error.response.data : error.message);
  }
}

reparar();