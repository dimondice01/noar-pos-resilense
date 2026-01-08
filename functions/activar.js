// =======================================================
// ⚡ DATOS DE ENTRADA (¡EDITA ESTO ANTES DE CORRERLO!)
// =======================================================
const ACCESS_TOKEN = "APP_USR-6464722787341288-122820-515f1440ccef22a98937ea06bc0e4343-2126819795"; 
const SERIAL_NUMBER = "CNN904500758"; // Mira la etiqueta atrás (S/N)

// Si tu terminal es la BLANCA/AZUL chica, cambia esto a "PAX_A910"
// Si es la NEGRA GRANDE, déjalo en "NEWLAND_N950"
const MODELO = "NEWLAND_N950"; 

// =======================================================
// 🚀 SCRIPT DE ACTIVACIÓN (NO TOQUES NADA ABAJO)
// =======================================================
const fetch = require('node-fetch');

async function activarTerminal() {
    console.log("\n🚀 INICIANDO ACTIVACIÓN MANUAL...");
    
    // 1. Construimos el ID correcto
    const terminalID = `${MODELO}__${SERIAL_NUMBER}`;
    console.log(`🎯 ID Construido: ${terminalID}`);
    console.log(`🔑 Token: ${ACCESS_TOKEN.substring(0, 15)}...`);

    const url = 'https://api.mercadopago.com/terminals/v1/setup';
    
    const body = {
        terminals: [
            {
                id: terminalID,
                operating_mode: "PDV"
            }
        ]
    };

    try {
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (response.ok) {
            console.log("\n✅ ¡ÉXITO TOTAL! TERMINAL VINCULADA.");
            console.log("---------------------------------------");
            console.log("👉 Reinicia el Point Smart ahora.");
            console.log("👉 Debería iniciar en modo integrado.");
            console.log("Datos de respuesta:", JSON.stringify(data, null, 2));
        } else {
            console.log("\n❌ ERROR DE MERCADOPAGO");
            console.log("---------------------------------------");
            console.log(`Status: ${response.status}`);
            console.log("Detalle:", JSON.stringify(data, null, 2));
            
            if (response.status === 400) {
                console.log("\n💡 PISTA: Verifica que el Token sea del DUEÑO de la terminal.");
                console.log("💡 PISTA: Verifica que el Point esté asignado a una Sucursal en la web de MP.");
            }
        }

    } catch (error) {
        console.error("\n💥 ERROR DE CONEXIÓN:", error.message);
    }
}

activarTerminal();