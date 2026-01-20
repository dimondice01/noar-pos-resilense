const ACCESS_TOKEN = "APP_USR-8932702393988485-011415-de68562ce58fcf5b11928416b85716cc-356944829"; // Tu token real

async function reparar() {
    console.log("🔧 Intentando reparación manual para ver el error...");
    // Usamos el ID de la caja "Noar" que salió en tu lista
    const cajaId = 124314102; 
    const newId = "POS" + cajaId;

    try {
        const response = await fetch(`https://api.mercadopago.com/pos/${cajaId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: "Noar",
                external_id: newId, // Intentamos forzar esto
                fixed_amount: true
            })
        });

        const result = await response.json();

        if (response.ok) {
            console.log("✅ ¡EXTRAÑO! Se reparó manualmente correctamente.");
        } else {
            console.log("❌ ERROR AL REPARAR (Esta es la razón):");
            console.log(JSON.stringify(result, null, 2));
        }
    } catch (e) { console.error(e); }
}

reparar();