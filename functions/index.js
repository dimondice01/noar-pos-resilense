/**
 * BACKEND - NOAR POS RESILENSE (SaaS READY)
 * Cloud Functions for Firebase
 * VERSIÓN FINAL: MercadoPago (QR + Point) + Clover (Simulado) + AFIP + RBAC
 * Lee credenciales dinámicamente desde Firestore.
 */
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Middleware para limpiar el prefijo '/api'
app.use((req, res, next) => {
  if (req.url.startsWith('/api')) {
    req.url = req.url.replace('/api', '');
  }
  next();
});

// ==================================================================
// 🛠️ HELPER: OBTENER CREDENCIALES MP DINÁMICAS
// ==================================================================
async function getMpConfig() {
    // 🔒 Leemos de la colección segura 'secrets'
    const doc = await db.doc("secrets/mercadopago").get();
    
    if (!doc.exists) {
        throw new Error("MercadoPago no está configurado en el sistema.");
    }
    
    const data = doc.data();
    if (!data.isActive) {
        throw new Error("La integración con MercadoPago está desactivada.");
    }
    
    // Validamos que tenga lo mínimo necesario
    if (!data.accessToken || !data.userId || !data.externalPosId) {
        throw new Error("Configuración MP incompleta (Faltan Tokens o IDs).");
    }
    
    return data; // Retorna { accessToken, userId, externalPosId }
}

// ==================================================================
// 🛡️ ENDPOINT: GESTIÓN DE USUARIOS (ADMIN ONLY)
// ==================================================================
app.post("/create-user", async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    logger.info(`👤 Creando usuario: ${email} (${role}) solicitado por ${decodedToken.email}`);

    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: name,
    });

    await db.collection('users').doc(userRecord.uid).set({
      name,
      email,
      role: role || 'CAJERO', 
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
// 🚀 ENDPOINT 1: MERCADOPAGO (QR DINÁMICO) - CON CORRECCIONES
// ==================================================================
app.post("/create-order", async (req, res) => {
  try {
    const { total } = req.body;
    const amount = Number(Number(total).toFixed(2));

    if (!amount || amount <= 0) return res.status(400).json({ error: "Monto inválido" });

    // 1. Obtener Credenciales de la DB
    const mpConfig = await getMpConfig();

    // 🔍 LOG DEPURACIÓN: Verificamos qué datos estamos usando
    logger.info(`💳 Iniciando QR para Collector: ${mpConfig.userId} | POS: ${mpConfig.externalPosId}`);

    const externalReference = `NOAR-${Date.now()}`;

    const orderData = {
      external_reference: externalReference,
      title: "Consumo Noar POS", 
      description: "Compra presencial en local", 
      notification_url: "https://www.google.com", 
      total_amount: amount,
      items: [
        {
          sku_number: "POS-001",
          category: "food",
          title: "Consumo General",
          unit_price: amount,
          quantity: 1,
          unit_measure: "unit",
          total_amount: amount,
        },
      ],
      cash_out: { amount: 0 } // ✅ FIX: A veces requerido por MP
    };

    // Usamos userId y externalPosId de la configuración
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
    // 🔍 LOG DE ERROR DETALLADO
    const mpErrorData = error.response ? error.response.data : "Sin respuesta detallada";
    
    logger.error("❌ Error CRÍTICO MP QR:", {
        mensaje: error.message,
        status: error.response?.status,
        detalle_mp: mpErrorData
    });

    res.status(500).json({ 
        error: "Error procesando QR con MercadoPago", 
        details: mpErrorData || error.message 
    });
  }
});

// ==================================================================
// 🚀 ENDPOINT 2: CLOVER POS (SIMULADO)
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
// 📟 ENDPOINT 5: MERCADOPAGO POINT (DINÁMICO)
// ==================================================================
app.post("/create-point-order", async (req, res) => {
  try {
    const { total, deviceId } = req.body;
    const amount = Number(Number(total).toFixed(2));

    // 1. Obtener Credenciales de la DB
    const mpConfig = await getMpConfig();

    // Si no envían ID, usamos uno de prueba o fallamos
    const targetDevice = deviceId || "DISPOSITIVO_NO_CONFIGURADO"; 

    logger.info(`📟 (Point) Enviando cobro de $${amount} a terminal ${targetDevice}`);

    const body = {
        amount: Math.round(amount * 100), 
        additional_info: {
            external_reference: `NOAR-POINT-${Date.now()}`,
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
// 🔍 ENDPOINT 3: CHECK STATUS MULTI-PROVEEDOR
// ==================================================================
app.post("/check-payment-status", async (req, res) => {
  try {
    const { reference, provider } = req.body;

    // Solo MP necesita credenciales dinámicas
    if (provider === 'mercadopago' || provider === 'point') {
        const mpConfig = await getMpConfig();
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
    logger.error("Error verificando pago:", error.message);
    res.status(500).json({ error: "Error de verificación" });
  }
});

// IMPORTAR EL MÓDULO AFIP
const afip = require("./afip");

// ==================================================================
// 🚀 ENDPOINT 4: FACTURACIÓN AFIP
// ==================================================================
app.post("/create-invoice", async (req, res) => {
  try {
    const { total, client } = req.body; 
    const amount = Number(Number(total).toFixed(2));
    const datosCliente = client || { docNumber: "0", fiscalCondition: "CONSUMIDOR_FINAL" };

    logger.info(`📠 AFIP: Solicitud Factura por $${amount}`);

    // afip.js ahora se encarga de buscar las credenciales en DB
    const factura = await afip.emitirFactura(amount, datosCliente);

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
// 🔄 ENDPOINT 6: NOTA DE CRÉDITO
// ==================================================================
app.post("/create-credit-note", async (req, res) => {
  try {
    const { total, client, associatedDocument } = req.body; 
    const amount = Number(Number(total).toFixed(2));
    const datosCliente = client || { docNumber: "0", fiscalCondition: "CONSUMIDOR_FINAL" };

    if (!associatedDocument) {
        return res.status(400).json({ error: "Falta documento asociado para anular" });
    }

    logger.info(`🔄 AFIP: Solicitud NC por $${amount} (Anula FC #${associatedDocument.nro})`);

    const notaCredito = await afip.emitirFactura(amount, datosCliente, true, associatedDocument);

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
// 🔍 ENDPOINT AUXILIAR: LISTAR CAJAS DE MERCADOPAGO
// ==================================================================
app.post("/get-mp-stores", async (req, res) => {
  try {
    const { accessToken } = req.body;
    
    if (!accessToken) return res.status(400).json({ error: "Falta Access Token" });

    // 1. Obtener User ID (Me)
    const meRes = await axios.get("https://api.mercadopago.com/users/me", {
        headers: { "Authorization": `Bearer ${accessToken}` }
    });
    const userId = meRes.data.id;

    // 2. Buscar Sucursales (Stores) y Cajas (POS)
    const url = "https://api.mercadopago.com/pos?limit=100"; 
    
    const posRes = await axios.get(url, {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });

    logger.info("Respuesta MP Stores:", posRes.data);

    const results = posRes.data.results || [];
    
    // Filtramos solo lo útil
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
    res.status(500).json({ error: "No se pudieron cargar las cajas. Verifica el Token." });
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
    
    // 2. Crear CSR Simplificado (Solo lo que AFIP necesita)
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = keys.publicKey;
    csr.setSubject([
      { name: 'commonName', value: 'SalvadorPOS' }, // Nombre simple
      { name: 'countryName', value: 'AR' },
      { name: 'organizationName', value: 'SalvadorPOS' }
    ]);
    
    csr.sign(keys.privateKey, forge.md.sha256.create());
    const csrPem = forge.pki.certificationRequestToPem(csr);

    // 3. Devolver HTML para copiar fácil
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
                    1. Copia el contenido de la <strong>Caja 1</strong> y pégalo en un archivo llamado <code>pedido.csr</code> (o úsalo directo si AFIP te deja pegar texto).<br>
                    2. Sube ese pedido a la web de AFIP.<br>
                    3. Copia el contenido de la <strong>Caja 2</strong> y pégalo en la configuración de tu sistema POS (Campo Private Key).
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
// 🪄 GENERADOR AUTOMÁTICO (Guarda la Key y te da el CSR)
// ==================================================================
app.post("/generate-afip-csr", async (req, res) => {
  try {
    const forge = require("node-forge");
    
    // 1. Generar claves RSA 2048 (Formato AFIP)
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
    
    // 2. Crear el Pedido (CSR)
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = keys.publicKey;
    csr.setSubject([
      { name: 'commonName', value: 'SalvadorPOS' },
      { name: 'countryName', value: 'AR' },
      { name: 'organizationName', value: 'SalvadorPOS' }
    ]);
    csr.sign(keys.privateKey, forge.md.sha256.create());
    const csrPem = forge.pki.certificationRequestToPem(csr);

    // 3. ¡MAGIA! Guardamos la Clave Privada DIRECTAMENTE en Firestore
    // Usamos merge: true para no borrar el CUIT ni otros datos si ya existen
    await db.doc("secrets/afip").set({
        key: privateKeyPem,
        updatedAt: new Date().toISOString()
    }, { merge: true });

    logger.info("✅ Clave Privada generada y guardada automáticamente en Firestore.");

    // 4. Devolvemos solo el CSR para que el usuario lo suba a AFIP
    res.status(200).json({ 
        success: true, 
        csr: csrPem,
        message: "Clave guardada. Usa este CSR en AFIP."
    });

  } catch (error) {
    logger.error("Error generando claves:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==================================================================
// 🏭 FÁBRICA DE CLIENTES (CREATE TENANT)
// ==================================================================
app.post("/create-tenant", async (req, res) => {
  const { email, password, businessName, ownerName } = req.body;

  // Validaciones básicas
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
    const companyId = businessName.toLowerCase().replace(/[^a-z0-9]/g, '_'); // ej: "Kiosco Pepe" -> "kiosco_pepe"

    logger.info(`✅ Usuario Auth creado: ${uid}. ID Empresa: ${companyId}`);

    // 2. Crear Documento de la Empresa
    const companyData = {
      name: businessName,
      createdAt: new Date().toISOString(),
      ownerUid: uid,
      isActive: true,
      plan: 'BASIC', // O el plan que definas
      settings: {
        allowNegativeStock: true, // Configuración por defecto recomendada
        ticketFooter: "¡Gracias por su compra!"
      }
    };
    
    // Usamos batch para operaciones atómicas iniciales
    const initBatch = db.batch();

    // A) Guardar empresa
    const companyRef = db.collection('companies').doc(companyId);
    initBatch.set(companyRef, companyData);

    // B) Guardar Perfil de Usuario vinculado a la empresa
    const userRef = db.collection('users').doc(uid);
    initBatch.set(userRef, {
      email,
      name: ownerName || "Admin",
      role: 'ADMIN',
      companyId: companyId, // 🔑 LA LLAVE DEL REINO
      createdAt: new Date().toISOString()
    });

    // C) Crear carpeta secrets vacía (para que no falle el frontend)
    const secretsRef = db.collection('companies').doc(companyId).collection('secrets').doc('config_placeholder');
    initBatch.set(secretsRef, { created: true }); // Placeholder

    await initBatch.commit();
    logger.info(`✅ Estructura base Firestore creada.`);

    // 3. 🚀 CLONACIÓN DEL CATÁLOGO MAESTRO (La Magia)
    // Leemos los productos del maestro
    const masterSnaps = await db.collection('master_products').get();
    
    if (masterSnaps.empty) {
        logger.warn("⚠️ El Catálogo Maestro está vacío. El cliente iniciará sin productos.");
    } else {
        logger.info(`📦 Clonando ${masterSnaps.size} productos para ${companyId}...`);
        
        // Firestore permite max 500 escrituras por batch.
        // Vamos a procesar en lotes.
        const products = masterSnaps.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                // 👇 AQUÍ ESTÁ LA LÓGICA DE NEGOCIO QUE PEDISTE
                id: doc.id, // Mismo ID para facilitar trazabilidad
                stock: 0,   // STOCK 0: Empiezan limpios
                cost: 0,    // COSTO 0: Deben cargar el suyo
                // price: data.price // MANTENEMOS PRECIO (Ya viene en data)
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                syncStatus: 'SYNCED'
            };
        });

        // Función para escribir en lotes (Chunking)
        const chunkArray = (arr, size) => {
            const chunks = [];
            for (let i = 0; i < arr.length; i += size) {
                chunks.push(arr.slice(i, i + size));
            }
            return chunks;
        };

        const batches = chunkArray(products, 450); // Usamos 450 por seguridad (límite 500)
        let batchCount = 0;

        for (const chunk of batches) {
            const batch = db.batch();
            chunk.forEach(prod => {
                // Escribimos en companies/{id}/products/{prodId}
                const ref = db.collection('companies').doc(companyId).collection('products').doc(prod.id);
                // Quitamos el id del cuerpo del documento para no duplicar data innecesaria
                const { id, isMaster, ...prodData } = prod; 
                batch.set(ref, prodData);
            });
            await batch.commit();
            batchCount++;
            console.log(`☁️ Lote ${batchCount}/${batches.length} clonado.`);
        }
    }

    res.status(200).json({
      success: true,
      message: `Cliente '${businessName}' creado exitosamente con ${masterSnaps.size} productos.`,
      credentials: { email, password }, // Devuelve pass para que se la pases al cliente
      companyId
    });

  } catch (error) {
    logger.error("❌ Error creando tenant:", error);
    res.status(500).json({ error: error.message });
  }
});
exports.api = onRequest(app);
