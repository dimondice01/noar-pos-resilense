/**
 * BACKEND - NOAR POS RESILIENCE (SaaS READY - LIGHTWEIGHT)
 * Cloud Functions for Firebase
 * ARQUITECTURA: Multi-Tenant (Aislamiento por CompanyID)
 * * NOTA: La carga inicial de productos (Seeding) se ha movido al Frontend
 * para evitar costos de cómputo en Cloud Functions.
 */

const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const admin = require("firebase-admin");

// Importamos el módulo de AFIP (Debe existir el archivo afip.js en la misma carpeta)
const afip = require("./afip"); 

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
async function getCompanyConfig(companyId, type) {
    if (!companyId) {
        throw new Error("Error Backend: Falta el ID de la empresa (companyId) en la petición.");
    }

    const docRef = db.doc(`companies/${companyId}/config/${type}`);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) {
        throw new Error(`El servicio ${type} no está configurado para la empresa ${companyId}.`);
    }
    
    const data = docSnap.data();
    
    if (type === 'mercadopago') {
        if (!data.isActive) throw new Error(`MercadoPago está desactivado en la empresa ${companyId}.`);
        if (!data.accessToken || !data.userId || !data.externalPosId) {
            throw new Error("Configuración MP incompleta (Faltan Tokens o IDs de Caja).");
        }
    }

    if (type === 'afip') {
        if (!data.isActive) throw new Error(`AFIP está desactivado en la empresa ${companyId}.`);
        if (!data.cert || !data.key) throw new Error("Falta Certificado o Clave Privada de AFIP.");
    }
    
    return data;
}

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
// 🚀 ENDPOINT 1: MERCADOPAGO (QR DINÁMICO SAAS)
// ==================================================================
app.post("/create-order", async (req, res) => {
  try {
    const { total, companyId } = req.body;
    const amount = Number(Number(total).toFixed(2));

    if (!amount || amount <= 0) return res.status(400).json({ error: "Monto inválido" });

    const mpConfig = await getCompanyConfig(companyId, 'mercadopago');
    logger.info(`💳 QR solicitado por: ${companyId} | Collector: ${mpConfig.userId}`);

    const externalReference = `NOAR-${companyId}-${Date.now()}`;

    const orderData = {
      external_reference: externalReference,
      title: "Consumo Local", 
      description: "Compra presencial", 
      notification_url: "https://www.google.com", 
      total_amount: amount,
      items: [
        {
          sku_number: "POS-GEN",
          category: "food",
          title: "Consumo General",
          unit_price: amount,
          quantity: 1,
          unit_measure: "unit",
          total_amount: amount,
        },
      ],
      cash_out: { amount: 0 }
    };

    const url = `https://api.mercadopago.com/instore/orders/qr/seller/collectors/${mpConfig.userId}/pos/${encodeURIComponent(mpConfig.externalPosId)}/qrs`;
    
    await axios.put(url, orderData, {
      headers: {
        "Authorization": `Bearer ${mpConfig.accessToken}`, 
        "Content-Type": "application/json"
      }
    });

    res.status(200).json({ 
      success: true, 
      message: "Orden MP Creada",
      reference: externalReference 
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
    const { total, deviceId, companyId } = req.body;
    const amount = Number(Number(total).toFixed(2));
    const mpConfig = await getCompanyConfig(companyId, 'mercadopago');
    const targetDevice = deviceId || "SIN_DISPOSITIVO"; 

    logger.info(`📟 Point (${companyId}) -> Enviando $${amount} a ${targetDevice}`);

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
    logger.error("❌ Error Point Data:", error.response?.data || error.message);
    res.status(500).json({ 
        error: "Error de comunicación con Terminal", 
        details: error.response?.data?.message || error.message
    });
  }
});

// ==================================================================
// 🔍 ENDPOINT 3: CHECK STATUS (SAAS - MULTI-PROVEEDOR)
// ==================================================================
app.post("/check-payment-status", async (req, res) => {
  try {
    const { reference, provider, companyId } = req.body;

    // Solo MP necesita credenciales dinámicas para consultar
    if (provider === 'mercadopago' || provider === 'point') {
        
        const mpConfig = await getCompanyConfig(companyId, 'mercadopago');
        const headers = { "Authorization": `Bearer ${mpConfig.accessToken}` };

        // A. MERCADOPAGO QR
        if (provider === 'mercadopago') {
            const url = `https://api.mercadopago.com/v1/payments/search?external_reference=${reference}&status=approved`;
            const response = await axios.get(url, { headers });
            
            if (response.data.results?.length > 0) {
                const p = response.data.results[0];
                return res.status(200).json({ status: 'approved', id: p.id, method: p.payment_method_id });
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

    // C. CLOVER (Simulado)
    else if (provider === 'clover') {
      const timestamp = parseInt(reference.split('-')[1] || Date.now());
      if ((Date.now() - timestamp) > 5000) return res.status(200).json({ status: 'approved', id: `CLV-${Date.now()}` });
      return res.status(200).json({ status: 'pending' });
    }

    res.status(400).json({ error: "Proveedor desconocido" });

  } catch (error) {
    // logger.error("Error verificando pago:", error.message); // Opcional reducir logs
    res.status(500).json({ error: "Error de verificación" });
  }
});

// ==================================================================
// 🚀 ENDPOINT 4: CLOVER (SIMULADO)
// ==================================================================
app.post("/create-clover-order", async (req, res) => {
    try {
      const { total, reference } = req.body; 
      const amount = Number(Number(total).toFixed(2));
      const finalRef = reference || `CLV-${Date.now()}`;
      
      logger.info(`☘️ (Clover) Iniciando cobro por $${amount} (Ref: ${finalRef})`);
  
      res.status(200).json({
        success: true,
        status: "PENDING",
        reference: finalRef,
        message: "Esperando pago en terminal Clover..."
      });
  
    } catch (error) {
      logger.error("Error Clover:", error);
      res.status(500).json({ error: "Error Clover" });
    }
});

// ==================================================================
// 📠 ENDPOINT 5: FACTURACIÓN AFIP (SAAS)
// ==================================================================
app.post("/create-invoice", async (req, res) => {
  try {
    const { total, client, companyId } = req.body; 
    const amount = Number(Number(total).toFixed(2));
    const datosCliente = client || { docNumber: "0", fiscalCondition: "CONSUMIDOR_FINAL" };

    logger.info(`📠 AFIP (${companyId}): Solicitud Factura por $${amount}`);

    const afipConfig = await getCompanyConfig(companyId, 'afip');
    const factura = await afip.emitirFactura(amount, datosCliente, false, null, afipConfig);

    logger.info(`✅ Factura Autorizada: CAE ${factura.cae}`);
    res.status(200).json(factura);

  } catch (error) {
    logger.error("❌ Error Facturación:", error.message);
    res.status(500).json({ 
      error: "Error al facturar", 
      details: error.message 
    });
  }
});

// ==================================================================
// 🔄 ENDPOINT 6: NOTA DE CRÉDITO (SAAS)
// ==================================================================
app.post("/create-credit-note", async (req, res) => {
  try {
    const { total, client, associatedDocument, companyId } = req.body;
    const amount = Number(Number(total).toFixed(2));
    const datosCliente = client || { docNumber: "0", fiscalCondition: "CONSUMIDOR_FINAL" };

    if (!associatedDocument) return res.status(400).json({ error: "Falta documento asociado" });

    const afipConfig = await getCompanyConfig(companyId, 'afip');

    logger.info(`🔄 AFIP (${companyId}): Solicitud NC por $${amount}`);

    const notaCredito = await afip.emitirFactura(amount, datosCliente, true, associatedDocument, afipConfig);

    logger.info(`✅ NC Autorizada: CAE ${notaCredito.cae}`);
    res.status(200).json(notaCredito);

  } catch (error) {
    logger.error("❌ Error Nota Crédito:", error.message);
    res.status(500).json({ 
      error: "Error al emitir NC", 
      details: error.message 
    });
  }
});

// ==================================================================
// 🔍 ENDPOINT AUXILIAR: LISTAR CAJAS MP (TOKEN DIRECTO)
// ==================================================================
app.post("/get-mp-stores", async (req, res) => {
  try {
    const { accessToken } = req.body; 
    
    if (!accessToken) return res.status(400).json({ error: "Falta Access Token" });

    const meRes = await axios.get("https://api.mercadopago.com/users/me", {
        headers: { "Authorization": `Bearer ${accessToken}` }
    });
    const userId = meRes.data.id;

    const url = "https://api.mercadopago.com/pos?limit=100"; 
    
    const posRes = await axios.get(url, {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });

    const results = posRes.data.results || [];
    
    const cajas = results.map(c => ({
        id: c.id, 
        name: c.name, 
        external_id: c.external_id, 
        store_id: c.store_id
    }));

    res.status(200).json({ 
        success: true, 
        userId: userId, 
        cajas: cajas 
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
// 🏭 FÁBRICA DE CLIENTES (CREATE TENANT - SÓLO ESTRUCTURA)
// ==================================================================
app.post("/create-tenant", async (req, res) => {
  const { email, password, businessName, ownerName } = req.body;

  if (!email || !password || !businessName) {
    return res.status(400).json({ error: "Faltan datos (email, password, businessName)" });
  }

  try {
    logger.info(`🏗️ Iniciando creación de inquilino: ${businessName}`);

    // 1. Crear Usuario en Firebase Auth
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: ownerName || "Dueño"
    });

    const uid = userRecord.uid;
    const companyId = businessName.toLowerCase().replace(/[^a-z0-9]/g, '_'); 

    logger.info(`✅ Usuario creado: ${uid}. ID Empresa: ${companyId}`);

    // 2. Crear Estructura Base en Firestore
    const initBatch = db.batch();

    // A) Documento de la Empresa
    const companyRef = db.collection('companies').doc(companyId);
    initBatch.set(companyRef, {
      name: businessName,
      createdAt: new Date().toISOString(),
      ownerUid: uid,
      isActive: true,
      plan: 'BASIC'
    });

    // B) Perfil de Usuario vinculado a la empresa
    const userRef = db.collection('users').doc(uid);
    initBatch.set(userRef, {
      email,
      name: ownerName || "Admin",
      role: 'ADMIN',
      companyId: companyId,
      createdAt: new Date().toISOString()
    });

    // C) Inicializar Configuración Vacía
    const mpConfigRef = db.collection('companies').doc(companyId).collection('config').doc('mercadopago');
    initBatch.set(mpConfigRef, { isActive: false, createdAt: new Date().toISOString() });
    
    const afipConfigRef = db.collection('companies').doc(companyId).collection('config').doc('afip');
    initBatch.set(afipConfigRef, { isActive: false, createdAt: new Date().toISOString() });

    await initBatch.commit();
    
    // ⚠️ NOTA CRÍTICA: SE ELIMINÓ LA CLONACIÓN DE PRODUCTOS.
    // Esta responsabilidad ahora recae en el Frontend (useDbSeeder) para evitar costos de Backend.

    logger.info(`✅ Estructura SaaS creada (Sin productos).`);

    res.status(200).json({
      success: true,
      message: `Cliente '${businessName}' creado exitosamente.`,
      credentials: { email, password },
      companyId
    });

  } catch (error) {
    logger.error("❌ Error creando tenant:", error);
    res.status(500).json({ error: error.message });
  }
});

// Exportamos la función HTTP (SIN CONFIGURACIÓN DE MEMORIA CUSTOM)
// Usará el default de Google (normalmente 256MB / 60s), capa gratuita.
exports.api = onRequest({ cors: true }, app);