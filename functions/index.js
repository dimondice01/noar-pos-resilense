/**
 * BACKEND - NOAR POS RESILENSE
 * Cloud Functions for Firebase
 * VERSIÓN FINAL: MercadoPago (Producción) + Clover (Simulado) + AFIP
 */
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ==================================================================
// ⚙️ CONFIGURACIÓN MERCADOPAGO (ÁREA CRÍTICA)
// ==================================================================

// 🔴 TU TOKEN REAL
const MP_ACCESS_TOKEN = "APP_USR-613005236982546-120215-3a81b19fe8fa9372f1c0161bef4676ac-2126819795"; 

// TUS DATOS REALES
const MP_USER_ID = "2126819795"; 
const MP_EXTERNAL_POS_ID = "NOARPOS1"; 

// ==================================================================
// 🚀 ENDPOINT 1: MERCADOPAGO (QR) - CORREGIDO (REDONDEO)
// ==================================================================
app.post("/create-order", async (req, res) => {
  try {
    const { total } = req.body;
    
    // 🔥 CORRECCIÓN CRÍTICA: Redondeo a 2 decimales para evitar "invalid_total_amount"
    // Convertimos a Float, fijamos 2 decimales y volvemos a número.
    // Ejemplo: 6669.9999999 -> "6670.00" -> 6670
    const amount = Number(Number(total).toFixed(2));

    if (!amount || amount <= 0) return res.status(400).json({ error: "Monto inválido" });

    const externalReference = `NOAR-${Date.now()}`;

    // 📦 PAYLOAD BLINDADO
    const orderData = {
      external_reference: externalReference,
      title: "Consumo Noar POS", 
      description: "Compra presencial en local", 
      notification_url: "https://www.google.com", 
      total_amount: amount, // Usamos el monto limpio
      items: [
        {
          sku_number: "POS-001",
          category: "food",
          title: "Consumo General",
          description: "Consumo General",
          unit_price: amount, // Usamos el monto limpio
          quantity: 1,
          unit_measure: "unit",
          total_amount: amount, // Usamos el monto limpio
        },
      ],
    };

    const url = `https://api.mercadopago.com/instore/orders/qr/seller/collectors/${MP_USER_ID}/pos/${MP_EXTERNAL_POS_ID}/qrs`;
    
    logger.info(`📡 (MP) Enviando orden de $${amount} a NOARPOS1...`);
    
    await axios.put(url, orderData, {
      headers: {
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`, 
        "Content-Type": "application/json"
      }
    });

    logger.info("✅ (MP) ÉXITO: Orden Creada.");
    res.status(200).json({ success: true, message: "Orden MP Creada" });

  } catch (error) {
    const mpError = error.response ? error.response.data : error.message;
    logger.error("❌ Error MP:", mpError);
    res.status(500).json({ error: "Error MP", details: mpError });
  }
});

// ==================================================================
// 🚀 ENDPOINT 2: CLOVER POS (SIMULADO)
// ==================================================================
app.post("/create-clover-order", async (req, res) => {
  try {
    const { total } = req.body;
    const amount = Number(Number(total).toFixed(2)); // Redondeo aquí también por seguridad
    
    logger.info(`☘️ (Clover) Iniciando cobro por $${amount}...`);

    // === MODO SIMULACIÓN ===
    await new Promise(resolve => setTimeout(resolve, 2000)); 

    logger.info("✅ (Clover) Pago Aprobado (Simulado)");

    res.status(200).json({
      success: true,
      status: "APPROVED",
      paymentId: `CLV-${Date.now()}`,
      message: "Pago aprobado en terminal Clover"
    });

  } catch (error) {
    logger.error("Error Clover:", error);
    res.status(500).json({ error: "Error Clover" });
  }
});

// 1. IMPORTAR EL MÓDULO AFIP
const afip = require("./afip");

// ==================================================================
// 🚀 ENDPOINT 3: FACTURACIÓN AFIP (Actualizado para Clientes)
// ==================================================================
app.post("/create-invoice", async (req, res) => {
  try {
    // 🔥 Ahora extraemos 'client' del body (enviado desde PosPage.jsx)
    const { total, client } = req.body; 
    
    const amount = Number(Number(total).toFixed(2));

    // Si por alguna razón no llega cliente, fallback a Consumidor Final
    const datosCliente = client || { docNumber: "0", fiscalCondition: "CONSUMIDOR_FINAL" };

    logger.info(`📠 AFIP: Solicitud Factura por $${amount} para ${datosCliente.docNumber}`);

    // Pasamos el objeto cliente completo al módulo AFIP
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

exports.api = onRequest(app);