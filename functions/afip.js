/**
 * MÓDULO AFIP - NOAR POS
 * Adaptado de tu versión Golden Master
 */
const admin = require("firebase-admin");
const soap = require("soap");
const xmlbuilder = require("xmlbuilder");
const forge = require("node-forge");
const fs = require("fs");
const path = require("path");

// Inicializar Firebase Admin si no existe (Singleton)
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// ==============================================================================
// ⚙️ CONFIGURACIÓN (Ajusta tus datos aquí)
// ==============================================================================
const CONFIG = {
  CUIT: "27278612932", // Tu CUIT
  PTO_VTA: 5,          // Tu Punto de Venta
  CONDICION: "MONOTRIBUTO", // 'MONOTRIBUTO' o 'RESPONSABLE_INSCRIPTO'
  
  // Rutas de Archivos
  CERT: path.join(__dirname, "keys", "certificado.crt"),
  KEY: path.join(__dirname, "keys", "clave.key"),
  
  // AFIP URLs (Homologación = Testing / Producción = Real)
  // CAMBIAR A PRODUCCIÓN CUANDO ESTÉS LISTO
  WSDL: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL", 
  WSAA: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms?WSDL"
};

const TA_REF = db.doc("config/afip_token");

// ==============================================================================
// 🔐 LÓGICA DE AUTENTICACIÓN (WSAA)
// ==============================================================================

async function getValidToken() {
  const doc = await TA_REF.get();
  if (doc.exists) {
    const data = doc.data();
    const expires = new Date(data.expirationTime);
    // Si faltan más de 10 min para vencer, sirve
    if (expires > new Date(Date.now() + 10 * 60000)) {
      return data;
    }
  }
  return generateNewToken();
}

async function generateNewToken() {
  console.log("🔐 AFIP: Generando nuevo Ticket de Acceso...");
  
  if (!fs.existsSync(CONFIG.CERT) || !fs.existsSync(CONFIG.KEY)) {
    throw new Error("Faltan archivos .crt o .key en la carpeta functions/keys/");
  }

  const certPem = fs.readFileSync(CONFIG.CERT, "utf8");
  const keyPem = fs.readFileSync(CONFIG.KEY, "utf8");
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);

  // XML de Solicitud (TRA)
  const now = new Date();
  const uniqueId = Math.floor(now.getTime() / 1000);
  const genTime = new Date(now.getTime() - 600000).toISOString();
  const expTime = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();

  const TRA = xmlbuilder.create("loginTicketRequest", { encoding: "UTF-8" })
    .att("version", "1.0")
    .ele("header")
      .ele("uniqueId", uniqueId).up()
      .ele("generationTime", genTime).up()
      .ele("expirationTime", expTime).up()
    .up()
    .ele("service", "wsfe")
    .end();

  // Firma CMS (PKCS#7)
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(TRA, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({ key: key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256 });
  p7.sign();
  const cms = forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());

  // Llamada a WSAA
  const client = await soap.createClientAsync(CONFIG.WSAA);
  const [result] = await client.loginCmsAsync({ in0: cms });
  const xml = result.loginCmsReturn;

  // Extracción
  const token = xml.match(/<token>(.*?)<\/token>/)[1];
  const sign = xml.match(/<sign>(.*?)<\/sign>/)[1];

  const authData = { token, sign, expirationTime: expTime };
  await TA_REF.set(authData);
  return authData;
}

// ==============================================================================
// 📠 LÓGICA DE FACTURACIÓN (WSFEv1)
// ==============================================================================

async function getUltimoComprobante(client, auth, tipoCbte) {
  const [res] = await client.FECompUltimoAutorizadoAsync({
    Auth: { Token: auth.token, Sign: auth.sign, Cuit: CONFIG.CUIT },
    PtoVta: CONFIG.PTO_VTA,
    CbteTipo: tipoCbte
  });
  return res.FECompUltimoAutorizadoResult.CbteNro || 0;
}

/**
 * Función Principal: Emitir Factura
 * @param {number} total - Monto total de la venta
 * @param {string} docNro - DNI o CUIT del cliente (0 para consumidor final)
 */
async function emitirFactura(total, docNro = "0") {
  const auth = await getValidToken();
  const client = await soap.createClientAsync(CONFIG.WSDL);

  // 1. Configuración de Comprobante (Monotributo = Tipo 11 - Factura C)
  // Si necesitas Factura A/B, cambia lógica aquí según tu código original
  const CBTE_TIPO = 11; 
  const DOC_TIPO = docNro === "0" ? 99 : (docNro.length === 11 ? 80 : 96); // 99=Final, 80=CUIT, 96=DNI

  // 2. Obtener último número
  const ultimo = await getUltimoComprobante(client, auth, CBTE_TIPO);
  const proximo = ultimo + 1;

  console.log(`📠 AFIP: Emitiendo Factura C #${proximo} por $${total}`);

  // 3. Preparar Payload
  const fecha = new Date().toISOString().substring(0, 10).replace(/-/g, ""); // AAAAMMDD
  
  const payload = {
    Auth: { Token: auth.token, Sign: auth.sign, Cuit: CONFIG.CUIT },
    FeCAEReq: {
      FeCabReq: {
        CantReg: 1,
        PtoVta: CONFIG.PTO_VTA,
        CbteTipo: CBTE_TIPO
      },
      FeDetReq: {
        FECAEDetRequest: {
          Concepto: 1, // Productos
          DocTipo: DOC_TIPO,
          DocNro: docNro,
          CbteDesde: proximo,
          CbteHasta: proximo,
          CbteFch: fecha,
          ImpTotal: total.toFixed(2),
          ImpTotConc: 0,
          ImpNeto: total.toFixed(2), // En Factura C, Neto = Total
          ImpOpEx: 0,
          ImpTrib: 0,
          ImpIVA: 0,
          MonId: "PES",
          MonCotiz: 1,
          CondicionIVAReceptorId: 5 // 5 = Consumidor Final (Default Monotributo)
        }
      }
    }
  };

  // 4. Solicitar CAE
  const [res] = await client.FECAESolicitarAsync(payload);
  const resultado = res.FECAESolicitarResult;

  // Manejo de Errores AFIP
  if (resultado.FeCabResp.Resultado === "R") {
    const err = resultado.FeDetResp.FECAEDetResponse[0].Observaciones.Obs[0];
    throw new Error(`Rechazo AFIP (${err.Code}): ${err.Msg}`);
  }

  const detalle = resultado.FeDetResp.FECAEDetResponse[0] || resultado.FeDetResp.FECAEDetResponse;

  return {
    success: true,
    cae: detalle.CAE,
    vto: detalle.CAEFchVto,
    numero: proximo,
    tipo: "C",
    qr_data: `https://www.afip.gob.ar/fe/qr/?p=${btoa(JSON.stringify({
       ver: 1, fecha: fecha, cuit: CONFIG.CUIT, ptoVta: CONFIG.PTO_VTA, tipoCmp: CBTE_TIPO, nroCmp: proximo, importe: total, moneda: "PES", ctz: 1, tipoDocRec: DOC_TIPO, nroDocRec: parseInt(docNro), tipoCodAut: "E", codAut: detalle.CAE
    }))}` // Generamos la URL del QR para imprimir
  };
}

module.exports = { emitirFactura };