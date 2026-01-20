// ---------------------------------------------------------
// 🧪 SCRIPT DE PRUEBA DIRECTA A MERCADO PAGO
// ---------------------------------------------------------

// 1. REEMPLAZA ESTO CON TU TOKEN REAL (Cópialo de Integraciones)
const ACCESS_TOKEN = "APP_USR-8932702393988485-011415-de68562ce58fcf5b11928416b85716cc-356944829"; 

async function verCajas() {
    console.log("🔍 Buscando cajas disponibles en esta cuenta...");

    try {
        // Usamos fetch nativo (Node 18+)
        const response = await fetch("https://api.mercadopago.com/pos?limit=50", {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (!response.ok) {
            console.log("❌ ERROR AL LISTAR:");
            console.log(data);
            return;
        }

        const cajas = data.results || []; // A veces viene en paging.results o directo results

        if (cajas.length === 0) {
            console.log("⚠️ LA CUENTA NO TIENE CAJAS CREADAS.");
            console.log("Solución: Ve al panel de MP o usa el botón 'Crear Caja' si tienes.");
        } else {
            console.log(`✅ ENCONTRADAS ${cajas.length} CAJAS REALES:`);
            console.log("------------------------------------------------");
            cajas.forEach(c => {
                console.log(`📌 NOMBRE: ${c.name}`);
                console.log(`   ID (USAR ESTE): ${c.id}`); // 👈 ESTE ES EL QUE NECESITAS
                console.log(`   EXTERNAL_ID:    ${c.external_id}`);
                console.log(`   SUCURSAL (Store): ${c.store_id}`);
                console.log("------------------------------------------------");
            });
        }

    } catch (error) {
        console.error("Error de Red:", error);
    }
}

probarQR();