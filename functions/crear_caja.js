const axios = require("axios");

// ==========================================
// CONFIGURACIÓN
// ==========================================

// 🔴 PEGA TU TOKEN AQUÍ (El mismo que usaste en index.js)
const ACCESS_TOKEN = "APP_USR-6074845556284079-120215-10c404f8cc56813b1bf142051464e6bd-3035284226"; 

const USER_ID = 2126819795; // Tu ID real que vimos en el log
const EXTERNAL_POS_ID = "SUC001_POS001"; // El ID que usamos en el POS
const STORE_NAME = "Sucursal Noar Resilense";

async function setup() {
  try {
    console.log("🚀 Iniciando configuración de MercadoPago...");

    // 1. CREAR SUCURSAL (STORE)
    // Es obligatorio tener una sucursal para tener una caja
    console.log("1️⃣ Creando Sucursal...");
    const storeResponse = await axios.post(
      `https://api.mercadopago.com/users/${USER_ID}/stores`,
      {
        name: STORE_NAME,
        location: {
          street_number: "123",
          street_name: "Calle Falsa",
          city_name: "La Rioja",
          state_name: "La Rioja",
          latitude: -29.4131,
          longitude: -66.8558,
          reference: "Centro"
        }
      },
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
    );
    
    const storeId = storeResponse.data.id;
    console.log(`✅ Sucursal creada con ID: ${storeId}`);

    // 2. CREAR CAJA (POS) VINCULADA A LA SUCURSAL
    console.log("2️⃣ Creando Caja (POS)...");
    const posResponse = await axios.post(
      "https://api.mercadopago.com/pos",
      {
        name: "Caja Principal",
        fixed_amount: false,
        store_id: storeId,
        external_store_id: "SUC001",
        external_id: EXTERNAL_POS_ID, // SUC001_POS001
        category: 621102 // Gastronomía/Alimentos
      },
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
    );

    console.log("✅ ¡CAJA CREADA EXITOSAMENTE!");
    console.log("------------------------------------------------");
    console.log("🆔 POS ID (Interno):", posResponse.data.id);
    console.log("🆔 External ID:", posResponse.data.external_id);
    console.log("🖼️ QR IMAGE URL:", posResponse.data.qr.image);
    console.log("------------------------------------------------");
    console.log("👉 AHORA PUEDES USAR EL SISTEMA POS SIN ERRORES.");

  } catch (error) {
    console.error("❌ Error:");
    if (error.response) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
  }
}

setup();