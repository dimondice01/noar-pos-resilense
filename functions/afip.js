/**
 * MÓDULO AFIP - NOAR POS
 * Corrección: Mapeo dinámico de Condición Fiscal del Cliente
 */
const admin = require("firebase-admin");
const soap = require("soap");
const xmlbuilder = require("xmlbuilder");
const forge = require("node-forge");
const fs = require("fs");
const path = require("path");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// ⚙️ CONFIGURACIÓN
const CONFIG = {
  CUIT: "27278612932", 
  PTO_VTA: 5,
  CONDICION: "MONOTRIBUTO",
  CERT: path.join(__dirname, "keys", "certificado.crt"),
  KEY: path.join(__dirname, "keys", "clave.key"),
  WSDL: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL", 
  WSAA: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms?WSDL"
};

const TA_REF = db.doc("config/afip_token");

// --- UTILS: MAPEO DE CONDICIONES FISCALES ---
const CONDICION_IVA = {
  'RESPONSABLE_INSCRIPTO': 1,
  'MONOTRIBUTO': 6,
  'CONSUMIDOR_FINAL': 5,
  'EXENTO': 4,
  'NO_RESPONSABLE': 3,
};

// ... [Lógica de getValidToken y generateNewToken SE MANTIENE IGUAL] ...
async function getValidToken() {
  const doc = await TA_REF.get();
  if (doc.exists) {
    const data = doc.data();
    const expires = new Date(data.expirationTime);
    if (expires > new Date(Date.now() + 10 * 60000)) {
      return data;
    }
  }
  return generateNewToken();
}

async function generateNewToken() {
  console.log("🔐 AFIP: Generando nuevo Ticket de Acceso...");
  if (!fs.existsSync(CONFIG.CERT) || !fs.existsSync(CONFIG.KEY)) {
    throw new Error("Faltan archivos .crt o .key");
  }
  const certPem = fs.readFileSync(CONFIG.CERT, "utf8");
  const keyPem = fs.readFileSync(CONFIG.KEY, "utf8");
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);

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

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(TRA, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({ key: key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256 });
  p7.sign();
  const cms = forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());

  const client = await soap.createClientAsync(CONFIG.WSAA);
  const [result] = await client.loginCmsAsync({ in0: cms });
  const xml = result.loginCmsReturn;
  const token = xml.match(/<token>(.*?)<\/token>/)[1];
  const sign = xml.match(/<sign>(.*?)<\/sign>/)[1];

  const authData = { token, sign, expirationTime: expTime };
  await TA_REF.set(authData);
  return authData;
}

// ... [Lógica de getUltimoComprobante SE MANTIENE IGUAL] ...
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
 * @param {number} total - Monto total
 * @param {object} cliente - Objeto con { docNumber, docType, fiscalCondition }
 */
async function emitirFactura(total, cliente = {}) {
  const auth = await getValidToken();
  const clientSoap = await soap.createClientAsync(CONFIG.WSDL);

  // 1. Procesar Datos del Cliente
  const docNro = cliente.docNumber || "0";
  // Si no viene condición, asumimos Consumidor Final
  const condFiscalStr = cliente.fiscalCondition || 'CONSUMIDOR_FINAL';
  const condicionIvaId = CONDICION_IVA[condFiscalStr] || 5;

  // Determinar Tipo Documento AFIP
  // 99: Final, 80: CUIT, 96: DNI
  let docTipo = 99; 
  if (docNro !== "0") {
     docTipo = docNro.length === 11 ? 80 : 96;
  }

  // 2. Configurar Tipo de Comprobante
  // Al ser Monotributista, SIEMPRE emites Factura C (11), sin importar el receptor.
  // Si fueras Resp. Inscripto, aquí iría lógica para elegir A (1) o B (6).
  const CBTE_TIPO = 11; 

  const ultimo = await getUltimoComprobante(clientSoap, auth, CBTE_TIPO);
  const proximo = ultimo + 1;

  console.log(`📠 AFIP: Factura C #${proximo} a Doc: ${docNro} (${condFiscalStr})`);

  const fecha = new Date().toISOString().substring(0, 10).replace(/-/g, "");

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
          Concepto: 1, 
          DocTipo: docTipo,
          DocNro: docNro,
          CbteDesde: proximo,
          CbteHasta: proximo,
          CbteFch: fecha,
          ImpTotal: total.toFixed(2),
          ImpTotConc: 0,
          ImpNeto: total.toFixed(2),
          ImpOpEx: 0,
          ImpTrib: 0,
          ImpIVA: 0,
          MonId: "PES",
          MonCotiz: 1,
          CondicionIVAReceptorId: condicionIvaId // 🔥 AQUÍ ESTABA EL CAMBIO CLAVE
        }
      }
    }
  };

  const [res] = await clientSoap.FECAESolicitarAsync(payload);
  const resultado = res.FECAESolicitarResult;

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
       ver: 1, fecha: fecha, cuit: CONFIG.CUIT, ptoVta: CONFIG.PTO_VTA, tipoCmp: CBTE_TIPO, nroCmp: proximo, importe: total, moneda: "PES", ctz: 1, tipoDocRec: docTipo, nroDocRec: parseInt(docNro), tipoCodAut: "E", codAut: detalle.CAE
    }))}`
  };
}

module.exports = { emitirFactura };