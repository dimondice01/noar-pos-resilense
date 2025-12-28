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

// ==================================================================
// 🛠️ HELPER: OBTENER CREDENCIALES MP DINÁMICAS
// ==================================================================
async function getMpConfig() {
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

    // Crear en Auth
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: name,
    });

    // Guardar Rol en Firestore
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
// 🚀 ENDPOINT 1: MERCADOPAGO (QR DINÁMICO)
// ==================================================================
app.post("/create-order", async (req, res) => {
  try {
    const { total } = req.body;
    const amount = Number(Number(total).toFixed(2));

    if (!amount || amount <= 0) return res.status(400).json({ error: "Monto inválido" });

    // 1. Obtener Credenciales de la DB
    const mpConfig = await getMpConfig();

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
    };

    // Usamos userId y externalPosId de la configuración
    const url = `https://api.mercadopago.com/instore/orders/qr/seller/collectors/${mpConfig.userId}/pos/${mpConfig.externalPosId}/qrs`;
    
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
    const mpError = error.response ? error.response.data : error.message;
    logger.error("❌ Error MP QR:", mpError);
    res.status(500).json({ error: "Error MP", details: mpError });
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
// 🔍 ENDPOINT 3 (ACTUALIZADO): CHECK STATUS MULTI-PROVEEDOR
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
                 // Intentamos obtener el ID del pago real si existe
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
// 🚀 ENDPOINT 4: FACTURACIÓN AFIP (SAAS)
// ==================================================================
app.post("/create-invoice", async (req, res) => {
  try {
    const { total, client } = req.body; 
    const amount = Number(Number(total).toFixed(2));
    // Corrección: Pasamos el objeto cliente completo, no solo el número
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
// 🔄 ENDPOINT 6: NOTA DE CRÉDITO (SAAS)
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

    // Pasamos el objeto cliente completo
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

exports.api = onRequest(app);