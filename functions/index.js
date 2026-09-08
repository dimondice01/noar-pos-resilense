/**
 * BACKEND - NOAR POS RESILIENCE (SaaS READY - LIGHTWEIGHT)
 * Cloud Functions for Firebase
 * ARQUITECTURA: Multi-Tenant (Aislamiento por CompanyID)
 * * NOTA: La carga inicial de productos (Seeding) se ha movido al Frontend
 * para evitar costos de cómputo en Cloud Functions.
 */

const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentWritten, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const admin = require("firebase-admin");

// Importamos el módulo de AFIP (Debe existir el archivo afip.js en la misma carpeta)
const afipModule = require("./afip");
// Carga de compras a proveedor desde el bot de WhatsApp (ver botPurchases.js)
const { registerBotPurchase, HttpError: BotPurchaseError } = require("./botPurchases");

// 🔒 Secret compartido para autenticar al bot de WhatsApp (servicio propio, no de
// terceros). Se crea con: firebase functions:secrets:set BOT_API_KEY
const BOT_API_KEY = defineSecret("BOT_API_KEY");

// 🌎 Huso horario de este proyecto (Argentina, UTC-3, sin horario de verano) — usado
// para calcular el "día" real de reports/topProducts_* a partir de timestamps en UTC.
// Nota: "salvadorpos1"/"el-salvador" es el nombre del cliente/proyecto, no el país —
// este sistema es 100% Argentina (facturación AFIP/CUIT).
const SALES_TZ_OFFSET_HOURS = -3;

// Inicialización de Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Configuración de Express
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Middleware para limpiar el prefijo '/api' si se usa reescritura en firebase.json
app.use((req, res, next) => {
  if (req.url.startsWith('/api')) {
    req.url = req.url.replace('/api', '');
  }
  next();
});

// ==================================================================
// 🛠️ HELPER CORE: OBTENER CONFIGURACIÓN SAAS
// ==================================================================
async function getCompanyConfig(companyId, type, branchId = null) {
    if (!companyId) {
        throw new Error("Error Backend: Falta el ID de la empresa (companyId) en la petición.");
    }

    // 🔥 LÓGICA DE RUTAS: Si hay branchId, busca en la sucursal, si no, en la ruta global original
    const docPath = branchId 
        ? `companies/${companyId}/branches/${branchId}/integrations/${type}`
        : `companies/${companyId}/config/${type}`;

    const docRef = db.doc(docPath);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) {
        throw new Error(`El servicio ${type} no está configurado para la empresa ${companyId} ${branchId ? `en la sucursal ${branchId}` : ''}.`);
    }
    
    const data = docSnap.data();
    
    if (type === 'mercadopago') {
        if (!data.isActive) throw new Error(`MercadoPago está desactivado.`);
        if (!data.accessToken) throw new Error("Configuración MP incompleta (Falta Access Token).");
    }

    if (type === 'afip') {
        if (!data.isActive) throw new Error(`AFIP está desactivado.`);
        if (!data.cert || !data.key) throw new Error("Falta Certificado o Clave Privada de AFIP.");
    }

    if (type === 'clover') {
        if (!data.isActive) throw new Error(`Clover está desactivado.`);
        if (!data.merchantId || !data.apiToken) throw new Error("Falta Merchant ID o Token de Clover.");
    }

    if (type === 'payway') {
        if (!data.isActive) throw new Error(`Payway está desactivado.`);
        if (!data.apiKeyPublica || !data.apiKeySecreta) throw new Error("Configuración Payway incompleta (Falta API Key pública/secreta).");
        if (!data.cuit) throw new Error("Configuración Payway incompleta (Falta CUIT del comercio).");
    }

    return data;
}

// ==================================================================
// 🛠️ HELPER: TOKEN OAUTH2 PAYWAY (PRISMA) - CACHEADO EN MEMORIA
// ==================================================================
// 🔥 Prisma recomienda explícitamente NO pedir un token OAuth en cada
// llamada ("no es buena práctica"). Cacheamos en memoria del proceso
// (vive mientras la instancia de Cloud Function esté "caliente"; se
// resetea en cold start, lo cual es aceptable ya que el token dura ~1h).
// 🔥 CONFIRMADO (2026-09-02): el tutorial genérico de Prisma documenta
// api-sandbox.prismamediosdepago.com para OAuth, pero ese host devuelve
// 401 "CREDENTIAL NO EXIST" para este proyecto/producto. El dominio real
// que acepta las credenciales de Payway (coincide con el "Endpoint" que
// muestra el dashboard del proyecto) es payway.com.ar — verificado con
// una llamada real que devolvió access_token válido.
const PAYWAY_HOSTS = {
    sandbox: 'api-sandbox.payway.com.ar',
    homologacion: 'api-homo.payway.com.ar', // ⚠️ sin confirmar contra sandbox real, solo por patrón
    produccion: 'api.payway.com.ar'          // ⚠️ sin confirmar contra sandbox real, solo por patrón
};
const paywayTokenCache = new Map(); // key: `${companyId}_${branchId}` -> { token, expiresAt }

async function getPaywayAccessToken(companyId, branchId) {
    const paywayConfig = await getCompanyConfig(companyId, 'payway', branchId);
    const cacheKey = `${companyId}_${branchId || 'global'}`;
    const cached = paywayTokenCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
        return { token: cached.token, config: paywayConfig };
    }

    const host = PAYWAY_HOSTS[paywayConfig.environment || 'sandbox'];
    const basicAuth = Buffer.from(`${paywayConfig.apiKeyPublica}:${paywayConfig.apiKeySecreta}`).toString('base64');

    const tokenRes = await axios.get(`https://${host}/v1/oauth/accesstoken?grant_type=client_credentials`, {
        headers: { "Authorization": `Basic ${basicAuth}` }
    });

    const { access_token, expires_in } = tokenRes.data;
    // 🛡️ Restamos 60s de margen para no usar un token que vence a mitad de una request.
    const expiresAt = Date.now() + (Number(expires_in) - 60) * 1000;
    paywayTokenCache.set(cacheKey, { token: access_token, expiresAt });

    return { token: access_token, config: paywayConfig };
}

// 🛡️ Payway devuelve errores como { errors: [{ status, code, title, message }] }.
// Sin esto, `details` queda como objeto y el frontend lo muestra como "[object Object]".
function extractPaywayErrorMessage(error) {
    const data = error.response?.data;
    // 🛡️ Payway no es consistente: a veces devuelve {errors:[{message,title}]},
    // a veces un string plano. Cubrimos ambos para no perder el mensaje real.
    if (typeof data === 'string' && data.trim()) return data;
    const apiError = data?.errors?.[0];
    if (apiError) return apiError.message || apiError.title || JSON.stringify(apiError);
    return error.message || "Sin respuesta detallada";
}

// ==================================================================
// 1. ENDPOINT: OBTENER TERMINALES (MODO DEBUG TOTAL)
// ==================================================================
app.post('/get-mp-terminals', async (req, res) => {
    try {
        const { accessToken } = req.body;

        if (!accessToken) return res.status(400).json({ error: "Falta el Access Token" });

        console.log("🔍 MODO DEBUG: Buscando cualquier cosa que parezca un Point...");

        const strategies = [
            fetch('https://api.mercadopago.com/point/integration-api/devices', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }).then(r => r.json().then(data => ({ source: 'legacy', data }))),

            fetch('https://api.mercadopago.com/pos', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }).then(r => r.json().then(data => ({ source: 'new', data })))
        ];

        const results = await Promise.allSettled(strategies);
        const uniqueMap = new Map();

        results.forEach(result => {
            if (result.status === 'fulfilled') {
                const { source, data } = result.value;
                
                // --- A. PROCESAR LEGACY (Aquí estaba tu terminal) ---
                if (source === 'legacy' && Array.isArray(data.devices)) {
                    console.log(`📦 Legacy encontró: ${data.devices.length} items`);
                    
                    data.devices.forEach((d, index) => {
                        // 🔥 LOG DE ORO: Ver qué tiene adentro este objeto
                        console.log(`🔎 Item Legacy #${index}:`, JSON.stringify(d));

                        // Intentamos pescar el ID de donde sea
                        const rawId = d.device_id || d.id || d.serial_number || d.uuid;
                        
                        // Si aun así es nulo, generamos uno falso para que LO VEAS en pantalla
                        const finalId = rawId ? String(rawId) : `UNKNOWN_ID_${index}`;

                        uniqueMap.set(finalId, {
                            id: finalId,
                            name: d.name || `Point Detectado (${d.model || '?'})`,
                            model: d.model || 'Legacy Device',
                            // Guardamos todo el objeto original para inspección
                            original_data: d 
                        });
                    });
                } 
                
                // --- B. PROCESAR NUEVA API ---
                else if (source === 'new' && Array.isArray(data.results)) {
                    data.results.forEach(pos => {
                        // Filtro suave: Si tiene 'category' o 'point' en el nombre
                        const isHardware = pos.category === 'mpos' || pos.category === 'point' || (pos.name && pos.name.toLowerCase().includes('point'));
                        
                        if (isHardware) {
                            const rawId = pos.id || pos.external_id;
                            const id = String(rawId);
                            
                            if (!uniqueMap.has(id)) {
                                uniqueMap.set(id, {
                                    id: id,
                                    name: pos.name,
                                    model: 'Smart POS (Nube)',
                                    original_data: pos
                                });
                            }
                        }
                    });
                }
            }
        });

        // NO NORMALIZAMOS IDS AÚN PARA VER QUÉ LLEGA REALMENTE
        const validDevices = Array.from(uniqueMap.values());

        console.log(`✅ Devolviendo ${validDevices.length} dispositivos brutos.`);
        return res.json({ devices: validDevices });

    } catch (error) {
        console.error("Server Error:", error);
        return res.status(500).json({ error: "Error interno" });
    }
});

// ==================================================================
// ⚙️ ENDPOINT: CONFIGURAR POINT (MODO PDV / STANDALONE)
// ==================================================================
app.post('/change-point-mode', async (req, res) => { // 👈 Cambiado el nombre para matchear el front
    try {
        const { accessToken, deviceId, mode } = req.body;
        
        if (!accessToken || !deviceId) {
            return res.status(400).json({ error: "Faltan credenciales o ID de dispositivo" });
        }

        // 1. Normalización estricta del ID
        let targetId = deviceId.trim();
        
        // Si el ID no tiene el doble guion bajo, es un ID corto (S/N). 
        // Mercado Pago para los Smart POS (Newland) requiere el prefijo del modelo.
        if (!targetId.includes('__')) {
            targetId = `NEWLAND_N950__${targetId}`;
        }

        // 2. Validación de modo
        // La API de MP espera exactamente "PDV" o "STANDALONE"
        const targetMode = (mode === 'PDV' || mode === 'POINT') ? "PDV" : "STANDALONE";

        console.log(`🚀 Cambiando modo de Point ${targetId} a ${targetMode}...`);

        // 3. Llamada a la API de Mercado Pago
        // Nota: Usamos PATCH según la documentación de Integration API de Point
        const mpResponse = await fetch(`https://api.mercadopago.com/point/integration-api/devices/${targetId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                operating_mode: targetMode
            })
        });

        const data = await mpResponse.json();

        if (!mpResponse.ok) {
            console.error("❌ Error de MP:", data);
            return res.status(mpResponse.status).json({ 
                error: "Mercado Pago rechazó el cambio de modo", 
                details: data 
            });
        }

        console.log(`✅ Éxito: Terminal ${targetId} ahora en modo ${targetMode}`);
        return res.json({ 
            success: true, 
            message: `Terminal configurada en modo ${targetMode}`,
            device: data 
        });

    } catch (error) {
        console.error("🔥 Error crítico en change-point-mode:", error);
        return res.status(500).json({ error: "Error interno procesando la terminal" });
    }
});

// ==================================================================
// 🛡️ ENDPOINT: GESTIÓN DE USUARIOS (SaaS AWARE)
// ==================================================================
app.post("/create-user", async (req, res) => {
  try {
    const { email, password, name, role, companyId } = req.body; 
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    
    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    if (!companyId) {
        return res.status(400).json({ error: "Falta companyId para asignar al usuario." });
    }

    logger.info(`👤 Creando usuario: ${email} (${role}) para empresa: ${companyId}`);

    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: name,
    });

    await db.collection('users').doc(userRecord.uid).set({
      name,
      email,
      role: role || 'CAJERO', 
      companyId: companyId,
      createdAt: new Date().toISOString(),
      createdBy: decodedToken.uid
    });

    res.status(200).json({ success: true, uid: userRecord.uid });

  } catch (error) {
    logger.error("Error creando usuario:", error);
    res.status(500).json({ error: error.message });
  }
});


// ==================================================================
// 🍀 ENDPOINT 4: CLOVER (REAL INTEGRATION)
// ==================================================================
app.post("/create-clover-order", async (req, res) => {
    try {
      const { total, companyId, externalId, branchId } = req.body; 
      const amount = Number(Number(total).toFixed(2));
      
      // 1. Obtener Credenciales de la Empresa
      const cloverConfig = await getCompanyConfig(companyId, 'clover', branchId);
      
      logger.info(`☘️ Clover (${companyId}): Iniciando cobro por $${amount}`);
  
      // 2. Determinar entorno (Sandbox vs Prod)
      const isProduction = false; 
      const baseUrl = isProduction 
          ? "https://api.clover.com" 
          : "https://sandbox.clover.com";
          
      // 3. Enviar orden a la nube de Clover
      const url = `${baseUrl}/v1/merchants/${cloverConfig.merchantId}/payments`;
      
      const response = await axios.post(url, {
          amount: Math.round(amount * 100), // Clover usa centavos
          currency: "ARS",
          externalPaymentId: externalId || `noar-${Date.now()}`,
          capture: true
      }, {
          headers: {
              'Authorization': `Bearer ${cloverConfig.apiToken}`,
              'Content-Type': 'application/json'
          }
      });
  
      // 4. Responder al Frontend
      res.status(200).json({
        success: true,
        status: "APPROVED",
        paymentId: response.data.id,
        raw: response.data
      });
  
    } catch (error) {
      logger.error("❌ Error Clover:", error.response?.data || error.message);
      res.status(500).json({ 
          error: "Error procesando pago con Clover",
          details: error.response?.data?.message || error.message
      });
    }
});


// ==================================================================
// 🚀 ENDPOINT 1: MERCADOPAGO (QR DINÁMICO SAAS) - BLINDADO POR SUCURSAL
// ==================================================================
app.post("/create-order", async (req, res) => {
  try {
    const { total, companyId, deviceId, branchId } = req.body;
    const amount = Number(Number(total).toFixed(2));

    if (!amount || amount <= 0) return res.status(400).json({ error: "Monto inválido" });

    // 1. Obtenemos la configuración de la sucursal (Trae el accessToken)
    const mpConfig = await getCompanyConfig(companyId, 'mercadopago', branchId);
    
    logger.info(`💳 QR solicitado por Sucursal: ${branchId || 'Global'} | Empresa: ${companyId}`);

    // 2. 🔥 REPARACIÓN DINÁMICA: Si no tenemos el userId en la config, lo pedimos a MP en tiempo real
    let userId = mpConfig.userId;
    if (!userId) {
        const meRes = await axios.get("https://api.mercadopago.com/users/me", {
            headers: { "Authorization": `Bearer ${mpConfig.accessToken}` }
        });
        userId = meRes.data.id;
    }

    let targetPosId = deviceId || mpConfig.externalPosId;

    if (!targetPosId) {
        return res.status(400).json({ error: "No hay ID de Caja (POS) asignado a este usuario." });
    }

    const externalReference = `NOAR-${companyId}-${Date.now()}`;

    const orderData = {
      external_reference: externalReference,
      title: "Venta Salvador POS", 
      description: "Compra presencial en sucursal", 
      notification_url: "https://www.google.com", 
      total_amount: amount,
      items: [
        {
          sku_number: "POS-GEN",
          category: "marketplace",
          title: "Cargo General POS",
          unit_price: amount,
          quantity: 1,
          unit_measure: "unit",
          total_amount: amount,
        },
      ],
      cash_out: { amount: 0 }
    };

    // 3. 🔥 URL CORREGIDA: Ahora usamos el userId recuperado dinámicamente
    const url = `https://api.mercadopago.com/instore/orders/qr/seller/collectors/${userId}/pos/${encodeURIComponent(targetPosId)}/qrs`;
    
    await axios.put(url, orderData, {
      headers: {
        "Authorization": `Bearer ${mpConfig.accessToken}`, 
        "Content-Type": "application/json"
      }
    });

    res.status(200).json({ 
      success: true, 
      reference: externalReference,
      usedPosId: targetPosId 
    });

  } catch (error) {
    const mpErrorData = error.response ? error.response.data : "Sin respuesta detallada";
    logger.error(`❌ Error MP QR (${req.body.companyId}):`, mpErrorData);

    res.status(500).json({ 
        error: "Error procesando QR con MercadoPago", 
        details: mpErrorData || error.message 
    });
  }
});

// ==================================================================
// 📟 ENDPOINT 2: MERCADOPAGO POINT (SAAS)
// ==================================================================
app.post("/create-point-order", async (req, res) => {
  try {
    // 🔥 CORRECCIÓN: Agregamos branchId al destructuring
    const { total, deviceId, companyId, branchId } = req.body;
    
    const amount = Number(Number(total).toFixed(2));
    
    // 🔥 CORRECCIÓN: Pasamos branchId a la configuración para leer las credenciales DE LA SUCURSAL
    const mpConfig = await getCompanyConfig(companyId, 'mercadopago', branchId);
    
    const targetDevice = deviceId || "SIN_DISPOSITIVO"; 

    logger.info(`📟 Point (${companyId}) -> Enviando $${amount} a ${targetDevice} desde Sucursal: ${branchId || 'Global'}`);

    const body = {
        amount: Math.round(amount * 100), 
        additional_info: {
            external_reference: `NOAR-POINT-${companyId}-${Date.now()}`,
            print_on_terminal: true 
        }
    };

    const url = `https://api.mercadopago.com/point/integration-api/devices/${targetDevice}/payment-intents`;
    
    const response = await axios.post(url, body, {
       headers: { "Authorization": `Bearer ${mpConfig.accessToken}` } 
    });

    res.status(200).json({ 
        success: true, 
        reference: response.data.id, 
        status: "OPEN" 
    });

  } catch (error) {
    // Mejoramos el log para ver si falla por token o por dispositivo
    logger.error("❌ Error Point Data:", error.response?.data || error.message);
    res.status(500).json({ 
        error: "Error de comunicación con Terminal", 
        details: error.response?.data?.message || error.message
    });
  }
});

// ==================================================================
// 💳 ENDPOINT: PAYWAY (PAYSTORE TERMINALS - TERMINAL FÍSICA)
// ==================================================================
// 🔥 Requiere terminal física Payway registrada (terminal_id) — no genera
// un QR "de software" sin hardware, a diferencia de /create-order de MP.
// El número de tarjeta NUNCA pasa por este backend: lo maneja la terminal.
app.post("/create-payway-order", async (req, res) => {
  try {
    const { total, companyId, branchId, terminalId } = req.body;
    const amount = Number(Number(total).toFixed(2));

    if (!amount || amount <= 0) return res.status(400).json({ error: "Monto inválido" });
    if (!terminalId) return res.status(400).json({ error: "Falta el ID de la terminal Payway (terminalId)." });

    const { token, config } = await getPaywayAccessToken(companyId, branchId);
    const host = PAYWAY_HOSTS[config.environment || 'sandbox'];

    logger.info(`💳 Payway solicitado por Sucursal: ${branchId || 'Global'} | Empresa: ${companyId} | Terminal: ${terminalId}`);

    // 🛡️ Payway valida el body COMPLETO contra su fixture en sandbox (no solo
    // monto/terminal) — incluimos todos los campos documentados, aunque algunos
    // no apliquen a nuestro caso, porque su ausencia ya causó "No se pudo
    // completar la operación" en pruebas reales.
    const body = {
        payment_request_data: {
            payment_amount: String(amount),
            terminal_menu_text: `Venta Noar POS $${amount}`,
            ecr_provider: "Noar POS",
            ecr_name: "Noar POS",
            ecr_version: "1.0",
            change_amount: "0",
            ecr_transaction_id: null,
            installments_number: 1,
            bank_account_type: null,
            payment_plan_id: null,
            payment_type: null,
            print_method: "MOBITEF_NON_FISCAL",
            print_copies: "BOTH",
            print_preview: "NONE",
            terminals_list: [{ terminal_id: terminalId }],
            card_brand_product: null,
            terminal_operation_method: "CARD",
            qr_benefit_code: true,
            trx_receipt_notes: null,
            card_holder_id: null,
            merchant_group_code: config.merchantGroupCode || "1238494234", // ⚠️ fallback = fixture de sandbox
            is_tip: true, // ⚠️ TODO: sacar de la venta real; por ahora fijo en true para que matchee el fixture de sandbox
            currency_code: "032" // 🔥 ISO 4217 numérico para ARS
        }
    };

    const url = `https://${host}/v1/paystore_terminals/terminal_payments/payments?cuit_cuil=${encodeURIComponent(config.cuit)}`;

    const response = await axios.post(url, body, {
        headers: {
            "Authorization": `Bearer ${token}`,
            "apikey": config.apiKeyPublica,
            "Content-Type": "application/json"
        }
    });

    res.status(200).json({
        success: true,
        reference: response.data.payment_data.payment_id,
        status: response.data.payment_data.payment_status
    });

  } catch (error) {
    logger.error(`❌ Error Payway (${req.body.companyId}):`, error.response?.data || error.message);
    res.status(500).json({
        error: "Error procesando pago con Payway",
        details: extractPaywayErrorMessage(error)
    });
  }
});

// ==================================================================
// 🔍 ENDPOINT 3: CHECK STATUS (SAAS - MULTI-PROVEEDOR)
// ==================================================================
app.post("/check-payment-status", async (req, res) => {
  try {
    // 🔥 AHORA RECIBIMOS branchId PARA SABER QUÉ TOKEN USAR EN LA BÚSQUEDA
    const { reference, provider, companyId, branchId } = req.body;

    if (provider === 'mercadopago' || provider === 'point') {
        
        // Obtenemos la config de la sucursal (o global si branchId es null)
        const mpConfig = await getCompanyConfig(companyId, 'mercadopago', branchId);
        const headers = { "Authorization": `Bearer ${mpConfig.accessToken}` };

        // A. MERCADOPAGO QR
        if (provider === 'mercadopago') {
            const url = `https://api.mercadopago.com/v1/payments/search?external_reference=${reference}&status=approved`;
            const response = await axios.get(url, { headers });
            
            if (response.data.results?.length > 0) {
                const p = response.data.results[0];
                return res.status(200).json({ 
                    status: 'approved', 
                    id: p.id, 
                    method: p.payment_method_id 
                });
            }
            return res.status(200).json({ status: 'pending' });
        } 
        
        // B. MERCADOPAGO POINT
        else if (provider === 'point') {
            const url = `https://api.mercadopago.com/point/integration-api/payment-intents/${reference}`;
            const response = await axios.get(url, { headers });
            const intent = response.data;
            
            if (intent.state === 'FINISHED') {
                 const paymentId = (intent.payment_ids && intent.payment_ids.length > 0) ? intent.payment_ids[0] : 'POINT-OK';
                 return res.status(200).json({ status: 'approved', id: paymentId });
            } 
            else if (intent.state === 'CANCELED') {
                 return res.status(200).json({ status: 'canceled' });
            }
            return res.status(200).json({ status: 'pending' });
        }
    }

    // C. CLOVER (Simulado/Directo)
    else if (provider === 'clover') {
      // Clover suele ser síncrono en nuestro create-order, pero dejamos el pending por si acaso
      return res.status(200).json({ status: 'approved', id: `CLV-${Date.now()}` });
    }

    // D. PAYWAY (PAYSTORE TERMINALS)
    else if (provider === 'payway') {
        const { token, config } = await getPaywayAccessToken(companyId, branchId);
        const host = PAYWAY_HOSTS[config.environment || 'sandbox'];
        const url = `https://${host}/v1/paystore_terminals/terminal_payments/payments/${reference}?cuit_cuil=${encodeURIComponent(config.cuit)}`;

        const response = await axios.get(url, {
            headers: { "Authorization": `Bearer ${token}`, "apikey": config.apiKeyPublica }
        });

        const paywayStatus = response.data?.payment_data?.payment_status;

        // 🛡️ SIN CONFIRMAR: la documentación pública de Payway solo confirma el
        // valor "PAYMENT_REQUEST" (pendiente, recién creado). Los valores exactos
        // para aprobado/rechazado/cancelado NO están documentados y hay que
        // verificarlos contra una respuesta real de sandbox antes de ir a producción.
        if (paywayStatus === 'PAYMENT_APPROVED') {
            return res.status(200).json({ status: 'approved', id: reference, rawStatus: paywayStatus });
        }
        if (paywayStatus === 'PAYMENT_REJECTED' || paywayStatus === 'PAYMENT_CANCELLED') {
            return res.status(200).json({ status: 'rejected', rawStatus: paywayStatus });
        }
        return res.status(200).json({ status: 'pending', rawStatus: paywayStatus });
    }

    res.status(400).json({ error: "Proveedor desconocido" });

  } catch (error) {
    logger.error("❌ Error verificando pago:", error.response?.data || error.message);
    res.status(500).json({ error: "Error de verificación en el servidor" });
  }
});

// ==================================================================
// 📠 ENDPOINT: FACTURACIÓN AFIP (FACTURA A/B/C)
// ==================================================================
app.post('/create-invoice', async (req, res) => {
  try {
    // 🛡️ EXTRACCIÓN BLINDADA Y DIRECTA (Evita colisiones con objetos anidados)
    const companyId = req.body.companyId || req.body.data?.companyId || req.body.operation?.companyId;
    const branchId = req.body.branchId || req.body.data?.branchId || req.body.operation?.branchId;
    const total = req.body.total || req.body.data?.total || req.body.operation?.total;
    const client = req.body.client || req.body.data?.client || req.body.operation?.client;

    logger.info(`📠 AFIP: Solicitud Factura por $${total} | Empresa: ${companyId} | Sucursal: ${branchId}`);

    // VALIDACIÓN DE SEGURIDAD BÁSICA
    if (!companyId || !branchId) {
      throw new Error(`Faltan identificadores. Empresa: ${companyId || 'N/A'}, Sucursal: ${branchId || 'N/A'}`);
    }

    // FIX CLAVE: Blindaje de Cliente "Consumidor Final"
    const sanitizedClient = client && client.fiscalCondition ? client : {
        name: "Consumidor Final",
        docType: "99", // 99 = Sin Identificar
        docNumber: "0",
        fiscalCondition: "CONSUMIDOR_FINAL"
    };

    // BUSCAR CONFIGURACIÓN EN FIRESTORE
    const configPath = `companies/${companyId}/branches/${branchId}/integrations/afip`;
    const configSnap = await db.doc(configPath).get();

    if (!configSnap.exists) {
      throw new Error(`La sucursal ${branchId} no tiene configurado AFIP.`);
    }

    const afipData = configSnap.data();

    if (!afipData.isActive) throw new Error("La facturación AFIP está desactivada para esta sucursal.");
    if (!afipData.cert || !afipData.key || !afipData.cuit) throw new Error("Credenciales de AFIP incompletas.");

    // DELEGAR AL MÓDULO ESPECIALIZADO
    const result = await afipModule.emitirFactura(
        total,             
        sanitizedClient,   
        false,             
        null,              
        afipData           
    );

    logger.info(`✅ Factura ${result.letra} ${result.numero} autorizada exitosamente. Neto: ${result.impNeto}, IVA: ${result.impIVA}`);
    
    // 🔥 FIX DEFINITIVO: Aseguramos que el servidor devuelva los campos calculados explícitamente.
    // Aunque result ya los traiga, este parseo lo blinda en el JSON response.
    res.json({
        ...result,
        impNeto: result.impNeto || 0,
        impIVA: result.impIVA || 0
    });

  } catch (error) {
    const errCompany = req.body?.companyId || req.body?.data?.companyId || req.body?.operation?.companyId || 'N/A';
    const errBranch = req.body?.branchId || req.body?.data?.branchId || req.body?.operation?.branchId || 'N/A';
    logger.error(`❌ Error en Proceso Facturación [company: ${errCompany} | branch: ${errBranch}]:`, error);
    res.status(500).json({ 
        error: "Error al procesar el comprobante electrónico", 
        details: error.message 
    });
  }
});

// ==================================================================
// 🔄 ENDPOINT 6: NOTA DE CRÉDITO (SAAS)
// ==================================================================
app.post("/create-credit-note", async (req, res) => {
  try {
    // 🛡️ EXTRACCIÓN BLINDADA Y DIRECTA
    const companyId = req.body.companyId || req.body.data?.companyId || req.body.operation?.companyId;
    const branchId = req.body.branchId || req.body.data?.branchId || req.body.operation?.branchId;
    const total = req.body.total || req.body.data?.total || req.body.operation?.total;
    const client = req.body.client || req.body.data?.client || req.body.operation?.client;
    const associatedDocument = req.body.associatedDocument || req.body.data?.associatedDocument || req.body.operation?.associatedDocument;
    
    const amount = Number(Number(total).toFixed(2));
    const datosCliente = client && client.fiscalCondition ? client : { docNumber: "0", fiscalCondition: "CONSUMIDOR_FINAL" };

    logger.info(`🔄 AFIP: Solicitud NC por $${amount} | Empresa: ${companyId} | Sucursal: ${branchId}`);

    if (!companyId || !branchId) {
        throw new Error(`Faltan identificadores para NC. Empresa: ${companyId || 'N/A'}, Sucursal: ${branchId || 'N/A'}`);
    }

    if (!associatedDocument) return res.status(400).json({ error: "Falta documento asociado" });

    // Llama a la función global con el branchId ya asegurado
    const afipConfig = await getCompanyConfig(companyId, 'afip', branchId);

    const notaCredito = await afipModule.emitirFactura(amount, datosCliente, true, associatedDocument, afipConfig);

    logger.info(`✅ NC Autorizada: CAE ${notaCredito.cae}`);
    
    // 🔥 FIX DEFINITIVO: Aplicamos el mismo blindaje a las Notas de Crédito
    res.status(200).json({
        ...notaCredito,
        impNeto: notaCredito.impNeto || 0,
        impIVA: notaCredito.impIVA || 0
    });

  } catch (error) {
    logger.error("❌ Error Nota Crédito:", error.message);
    res.status(500).json({ 
      error: "Error al emitir NC", 
      details: error.message 
    });
  }
});

// ==================================================================
// 🔍 ENDPOINT AUXILIAR: LISTAR CAJAS Y "AUTO-REPARAR" LAS VIEJAS
// ==================================================================
app.post("/get-mp-stores", async (req, res) => {
  try {
    const { accessToken } = req.body; 
    
    if (!accessToken) return res.status(400).json({ error: "Falta Access Token" });

    // 1. Obtener Usuario
    const meRes = await axios.get("https://api.mercadopago.com/users/me", {
        headers: { "Authorization": `Bearer ${accessToken}` }
    });
    const userId = meRes.data.id;

    // 2. Obtener Cajas
    const url = "https://api.mercadopago.com/pos?limit=100"; 
    const posRes = await axios.get(url, {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });

    let results = posRes.data.results || [];
    
    // 🔥 AUTO-REPARACIÓN DE CAJAS VIEJAS
    const repairedCajas = await Promise.all(results.map(async (c) => {
        
        let finalExternalId = c.external_id;

        // Si la caja existe pero no tiene external_id (causa del error 404)
        if (!finalExternalId) {
            try {
                const newExternalId = `POS${c.id}`; // Generamos ID estable: POS_12345
                console.log(`🔧 Reparando caja ID ${c.id} -> Asignando ${newExternalId}...`);
                
                await axios.put(
                    `https://api.mercadopago.com/pos/${c.id}`, 
                    { 
                        name: c.name,
                        external_id: newExternalId,
                        fixed_amount: true // Vital para que acepte cobros dinámicos
                    }, 
                    { headers: { "Authorization": `Bearer ${accessToken}` } }
                );
                
                finalExternalId = newExternalId; 
            } catch (err) {
                console.error(`⚠️ No se pudo reparar caja ${c.id}:`, err.message);
            }
        }

        return {
            id: c.id, 
            name: c.name, 
            external_id: finalExternalId || c.id.toString(), // Siempre devolvemos algo usable
            store_id: c.store_id
        };
    }));

    res.status(200).json({ 
        success: true, 
        userId: userId, 
        cajas: repairedCajas 
    });

  } catch (error) {
    logger.error("❌ Error listando Cajas MP:", error.response?.data || error.message);
    res.status(500).json({ error: "No se pudieron cargar las cajas. Token inválido." });
  }
});

// ==================================================================
// 🔑 GENERADOR DE CLAVES VISUAL (SOLUCIÓN HTML)
// ==================================================================
app.get("/generate-afip-keys", (req, res) => {
  try {
    const forge = require("node-forge");
    
    // 1. Generar claves RSA 2048
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
    
    // 2. Crear CSR Simplificado
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = keys.publicKey;
    csr.setSubject([
      { name: 'commonName', value: 'SalvadorPOS' },
      { name: 'countryName', value: 'AR' },
      { name: 'organizationName', value: 'SalvadorPOS' }
    ]);
    
    csr.sign(keys.privateKey, forge.md.sha256.create());
    const csrPem = forge.pki.certificationRequestToPem(csr);

    // 3. Devolver HTML
    res.send(`
      <html>
        <head>
            <style>
                body { font-family: sans-serif; padding: 20px; background: #f0f2f5; }
                textarea { width: 100%; height: 200px; font-family: monospace; border: 1px solid #ccc; padding: 10px; border-radius: 5px; }
                h3 { color: #333; margin-top: 20px; }
                .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); max-width: 800px; margin: 0 auto; }
                .alert { background: #e3f2fd; color: #0d47a1; padding: 10px; border-radius: 4px; margin-bottom: 20px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>🛠️ Generador de Claves AFIP</h2>
                <div class="alert">
                    <strong>Instrucciones:</strong><br>
                    1. Copia el contenido de la <strong>Caja 1</strong> y pégalo en un archivo llamado <code>pedido.csr</code>.<br>
                    2. Sube ese pedido a la web de AFIP.<br>
                    3. Copia el contenido de la <strong>Caja 2</strong> y pégalo en la configuración de tu sistema POS.
                </div>

                <h3>1. PEDIDO DE FIRMA (CSR) - Para subir a AFIP</h3>
                <textarea onclick="this.select()">${csrPem}</textarea>

                <h3>2. CLAVE PRIVADA (KEY) - Para tu Configuración POS</h3>
                <textarea onclick="this.select()">${privateKeyPem}</textarea>
            </div>
        </body>
      </html>
    `);

  } catch (error) {
    res.status(500).send(`Error: ${error.message}`);
  }
});

// ==================================================================
// 🪄 GENERADOR AUTOMÁTICO CSR (HELPER)
// ==================================================================
app.post("/generate-afip-csr", async (req, res) => {
  try {
    const forge = require("node-forge");
    
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
    
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = keys.publicKey;
    csr.setSubject([
      { name: 'commonName', value: 'SalvadorPOS' },
      { name: 'countryName', value: 'AR' },
      { name: 'organizationName', value: 'SalvadorPOS' }
    ]);
    csr.sign(keys.privateKey, forge.md.sha256.create());
    const csrPem = forge.pki.certificationRequestToPem(csr);

    res.status(200).json({ 
        success: true, 
        csr: csrPem,
        privateKey: privateKeyPem,
        message: "Claves generadas."
    });

  } catch (error) {
    logger.error("Error generando claves:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==================================================================
// 🏭 FÁBRICA DE CLIENTES (CREATE TENANT - CON TRIAL)
// ==================================================================
app.post("/create-tenant", async (req, res) => {
  const { email, password, businessName, ownerName } = req.body;

  if (!email || !password || !businessName) {
    return res.status(400).json({ error: "Faltan datos (email, password, businessName)" });
  }

  try {
    // 1. Crear Usuario en Firebase Auth
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: ownerName || "Dueño"
    });

    const uid = userRecord.uid;
    const companyId = businessName.toLowerCase().replace(/[^a-z0-9]/g, '_'); 

    // 🔥 LÓGICA TRIAL: Calculamos fecha de vencimiento (Hoy + 3 días)
    const now = new Date();
    const trialEndDate = new Date();
    trialEndDate.setDate(now.getDate() + 3); 

    // 2. Crear Estructura Base en Firestore
    const initBatch = db.batch();

    // A) Documento de la Empresa (CON SUSCRIPCIÓN)
    const companyRef = db.collection('companies').doc(companyId);
    initBatch.set(companyRef, {
      name: businessName,
      createdAt: now.toISOString(),
      ownerUid: uid,
      isActive: true, // La empresa está activa tecnicamente
      
      // 👇 ACÁ ESTÁ LA MAGIA DEL BLOQUEO
      subscription: {
          plan: 'trial',          // trial | monthly | lifetime
          status: 'active',       // active | expired | paid
          startDate: now.toISOString(),
          trialEndDate: trialEndDate.toISOString(), // Fecha de muerte del trial
          isLifetime: false
      }
    });

    // B) Perfil de Usuario
    const userRef = db.collection('users').doc(uid);
    initBatch.set(userRef, {
      email,
      name: ownerName || "Admin",
      role: 'ADMIN',
      companyId: companyId,
      createdAt: now.toISOString()
    });

    // C) Inicializar Configuración Vacía
    const mpConfigRef = db.collection('companies').doc(companyId).collection('config').doc('mercadopago');
    initBatch.set(mpConfigRef, { isActive: false, createdAt: now.toISOString() });
    
    const afipConfigRef = db.collection('companies').doc(companyId).collection('config').doc('afip');
    initBatch.set(afipConfigRef, { isActive: false, createdAt: now.toISOString() });

    const cloverConfigRef = db.collection('companies').doc(companyId).collection('config').doc('clover');
    initBatch.set(cloverConfigRef, { isActive: false, createdAt: now.toISOString() });

    await initBatch.commit();
    
    res.status(200).json({
      success: true,
      message: `Cliente creado con Trial de 3 días.`,
      companyId
    });

  } catch (error) {
    console.error("❌ Error creando tenant:", error);
    res.status(500).json({ error: error.message });
  }
});


// ==================================================================
// 🛡️ ENDPOINT: BORRADO SEGURO DE USUARIOS (NUEVO)
// ==================================================================
app.post("/delete-user", async (req, res) => {
  try {
    const { uid } = req.body; // ID del usuario a borrar
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // 1. Verificar identidad del solicitante
    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // 2. Validar que quien pide borrar sea ADMIN u OWNER
    const requestor = await db.collection('users').doc(decodedToken.uid).get();
    if (!requestor.exists || (requestor.data().role !== 'ADMIN' && requestor.data().role !== 'OWNER')) {
        return res.status(403).json({ error: "No tienes permisos para eliminar usuarios." });
    }

    // 3. Verificar que el usuario a borrar pertenezca a la misma empresa
    const targetUser = await db.collection('users').doc(uid).get();
    if (targetUser.exists && targetUser.data().companyId !== requestor.data().companyId) {
        return res.status(403).json({ error: "No puedes borrar usuarios de otra empresa." });
    }

    logger.info(`🗑️ Eliminando usuario ${uid} solicitado por ${decodedToken.uid}`);

    // 4. Borrar de Authentication (Revoca el acceso inmediatamente)
    await admin.auth().deleteUser(uid);

    // 5. Borrar de Firestore (Limpia los datos del perfil)
    await db.collection('users').doc(uid).delete();

    res.status(200).json({ success: true, message: "Usuario eliminado y acceso revocado." });

  } catch (error) {
    logger.error("Error borrando usuario:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==================================================================
// 🤖 ENDPOINT: CARGA DE COMPRA A PROVEEDOR DESDE EL BOT DE WHATSAPP
// ==================================================================
// Único caller esperado: el bot de WhatsApp (repo aparte), después de que el
// cliente confirmó por texto los datos leídos de la foto de una boleta.
// Autenticación: header x-bot-key contra el secret BOT_API_KEY.
app.post("/bot/purchases", async (req, res) => {
  try {
    const providedKey = req.headers["x-bot-key"];
    if (!providedKey || providedKey !== BOT_API_KEY.value()) {
      return res.status(401).json({ error: "No autorizado" });
    }

    const result = await registerBotPurchase(db, req.body);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof BotPurchaseError) {
      return res.status(error.status).json({ error: error.message });
    }
    logger.error("❌ Error /bot/purchases:", error);
    res.status(500).json({ error: "Error registrando la compra", details: error.message });
  }
});

// ==================================================================
// 📡 ENDPOINT: WEBHOOK MERCADOPAGO (NUEVO)
// ==================================================================
app.post("/webhook/mercadopago", async (req, res) => {
    const { type, data } = req.body;
    const topic = req.query.topic || type;
    const id = req.query.id || data?.id;

    try {
        if (topic === 'payment' && id) {
            logger.info(`🔔 Webhook MP: Pago recibido ID ${id}`);
        }
        res.status(200).send("OK");
    } catch (error) {
        logger.error("Webhook Error:", error);
        res.status(500).send("Error");
    }
});

// Exportamos la función HTTP
console.log("Versión con Auto-Fix Forzado v3.1");
exports.api = onRequest({ cors: true, secrets: [BOT_API_KEY] }, app);

// ==================================================================
// 📉 TRIGGER: STOCK CRÍTICO (ROLLUP PARA EL BOT DE WHATSAPP)
// ==================================================================
// Mantiene companies/{companyId}/branches/{branchId}/reports/lowStock
// actualizado a partir de cada escritura real de stock (venta, compra,
// ajuste) — el bot lee 1 solo doc por sucursal en vez de escanear
// catálogo + inventario completos en cada consulta.
exports.onInventoryStockWritten = onDocumentWritten(
  "companies/{companyId}/branches/{branchId}/inventory/{productId}",
  async (event) => {
    const { companyId, branchId, productId } = event.params;
    const after = event.data.after.exists ? event.data.after.data() : null;
    const lowStockRef = db.doc(`companies/${companyId}/branches/${branchId}/reports/lowStock`);

    // Doc de inventario borrado: no hay stock que reportar, solo limpiar si estaba en rojo.
    if (!after) {
      await lowStockRef.set({ [`items.${productId}`]: admin.firestore.FieldValue.delete() }, { merge: true });
      return;
    }

    const stock = Number(after.stock) || 0;

    let minStock = 5;
    let name = null;
    try {
      const productSnap = await db.doc(`companies/${companyId}/products/${productId}`).get();
      if (productSnap.exists) {
        const productData = productSnap.data();
        minStock = Number(productData.minStock) || 5;
        name = productData.name || null;
      }
    } catch (err) {
      logger.warn(`⚠️ lowStock: no se pudo leer products/${productId} (${companyId})`, err);
    }

    if (stock <= minStock) {
      await lowStockRef.set({
        [`items.${productId}`]: {
          name,
          stock,
          minStock,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }
      }, { merge: true });
    } else {
      await lowStockRef.set({ [`items.${productId}`]: admin.firestore.FieldValue.delete() }, { merge: true });
    }
  }
);

// ==================================================================
// 🏆 TRIGGER: RANKING DE PRODUCTOS MÁS VENDIDOS (ROLLUP DIARIO)
// ==================================================================
// Mantiene companies/{companyId}/branches/{branchId}/reports/topProducts_{YYYY-MM-DD}
// con contadores por producto, incrementados al crearse cada venta — el
// bot suma hasta 7 docs para "lo más vendido de la semana" en vez de
// escanear la colección sales completa.
// 🛡️ Simplificación aceptada: no resta si la venta se reembolsa después
// (REFUNDED/PARTIAL_REFUND) — es un ranking aproximado para el bot, no
// una cifra contable.
exports.onSaleCreatedTopProducts = onDocumentCreated(
  "companies/{companyId}/sales/{saleId}",
  async (event) => {
    const sale = event.data.data();
    if (!sale) return;
    if (sale.type && sale.type !== 'SALE') return; // excluye BUDGET
    if (sale.status === 'ABANDONED') return;

    const items = Array.isArray(sale.items) ? sale.items : [];
    if (items.length === 0) return;

    const { companyId } = event.params;
    const branchId = sale.branchId || 'main';
    // 🌎 sale.date/createdAt se guardan en UTC (.toISOString() del frontend). Sin esto,
    // el "día" quedaría en UTC y cualquier venta desde las 21:00 hora local (Argentina,
    // UTC-3) caería en el doc del día siguiente. Ajustar SALES_TZ_OFFSET_HOURS si este
    // mismo código se reusa en un proyecto de otro país/huso horario.
    const rawDate = sale.date || sale.createdAt || new Date().toISOString();
    const localDate = new Date(new Date(rawDate).getTime() + SALES_TZ_OFFSET_HOURS * 60 * 60 * 1000);
    const day = localDate.toISOString().slice(0, 10);
    const reportRef = db.doc(`companies/${companyId}/branches/${branchId}/reports/topProducts_${day}`);

    const update = {};
    for (const item of items) {
      const productId = item.id || item.productId;
      if (!productId) continue;
      const qty = Number(item.quantity) || 0;
      const revenue = Number(item.subtotal) || (Number(item.price) || 0) * qty;
      update[`items.${productId}.qty`] = admin.firestore.FieldValue.increment(qty);
      update[`items.${productId}.revenue`] = admin.firestore.FieldValue.increment(revenue);
      update[`items.${productId}.name`] = item.name || null;
    }

    if (Object.keys(update).length === 0) return;
    await reportRef.set(update, { merge: true });
  }
);