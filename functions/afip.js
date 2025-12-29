/**
 * MÓDULO AFIP - NOAR POS (SaaS FINAL)
 * Versión: "Super Limpiador Agresivo" 🧼
 * Repara claves privadas rotas, elimina espacios y reconstruye el formato PEM.
 */
const admin = require("firebase-admin");
const soap = require("soap");
const xmlbuilder = require("xmlbuilder");
const forge = require("node-forge");
const https = require("https"); 
const axios = require("axios");

// Inicialización de Firebase
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Referencias
const TA_REF = db.doc("secrets/afip_token"); 
const CONFIG_REF = db.doc("secrets/afip");   

// 🛡️ FIX SSL: AFIP usa cifrados viejos
const legacyAgent = new https.Agent({
  ciphers: 'DEFAULT@SECLEVEL=1',
  keepAlive: true,
});

const afipAxios = axios.create({
  httpsAgent: legacyAgent,
  headers: { 'Content-Type': 'text/xml; charset=utf-8' }
});

const SOAP_OPTIONS = {
  request: afipAxios,
  wsdl_options: { httpsAgent: legacyAgent }
};

// URLs Producción
const WSAA_URL = "https://wsaa.afip.gov.ar/ws/services/LoginCms?WSDL";
const WSFE_URL = "https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL";

const CONDICION_IVA = {
  'RESPONSABLE_INSCRIPTO': 1, 'MONOTRIBUTO': 6, 'CONSUMIDOR_FINAL': 5,
  'EXENTO': 4, 'NO_RESPONSABLE': 3,
};

// ==================================================================
// 🧼 SUPER LIMPIADOR: El corazón de la reparación
// ==================================================================
function cleanAndFormatKey(rawString, type) {
    if (!rawString) return "";

    // 1. Quitar cualquier cabecera existente para tener solo el contenido
    let body = rawString
        .replace(/-----BEGIN.*?-----/g, '')
        .replace(/-----END.*?-----/g, '');

    // 2. ELIMINACIÓN TOTAL DE ESPACIOS (Aquí estaba tu error principal)
    // Borra espacios en blanco, tabulaciones y saltos de línea basura
    body = body.replace(/\s+/g, '');

    // 3. Reconstruir en bloques de 64 caracteres (Estándar PEM)
    const chunks = body.match(/.{1,64}/g);
    if (!chunks) throw new Error(`El formato del ${type} está corrupto y no se puede reconstruir.`);
    
    const cleanBody = chunks.join('\n');

    // 4. Poner las cabeceras correctas y limpias
    if (type === 'KEY') {
        return `-----BEGIN RSA PRIVATE KEY-----\n${cleanBody}\n-----END RSA PRIVATE KEY-----`;
    } else {
        return `-----BEGIN CERTIFICATE-----\n${cleanBody}\n-----END CERTIFICATE-----`;
    }
}

// ==================================================================
// 🛠️ CONFIGURACIÓN (Aquí aplicamos la limpieza)
// ==================================================================
async function getConfig() {
    const doc = await CONFIG_REF.get();
    if (!doc.exists) throw new Error("No hay configuración AFIP en la base de datos.");
    
    const data = doc.data();
    if (!data.isActive) throw new Error("AFIP está desactivado.");
    if (!data.cert || !data.key || !data.cuit) throw new Error("Faltan certificados o CUIT.");

    // 👇 AQUÍ OCURRE LA MAGIA: Limpiamos antes de usar 👇
    return {
        cuit: data.cuit.replace(/[^0-9]/g, ''), 
        ptoVta: parseInt(data.ptoVta) || 1,
        // Guardamos las versiones ya reparadas
        certPem: cleanAndFormatKey(data.cert, 'CERT'),
        keyPem: cleanAndFormatKey(data.key, 'KEY')
    };
}

// ==================================================================
// 🔐 AUTENTICACIÓN (WSAA)
// ==================================================================
async function getValidToken(config) {
  try {
    const doc = await TA_REF.get();
    if (doc.exists) {
      const data = doc.data();
      const expires = new Date(data.expirationTime);
      // Margen de seguridad de 5 mins
      if (expires > new Date(Date.now() + 5 * 60000)) {
        return data;
      }
    }
    return generateNewToken(config);
  } catch (error) {
    console.error("⚠️ Token cacheado inválido, generando nuevo...");
    return generateNewToken(config);
  }
}

async function generateNewToken(config) {
  console.log(`🔐 AFIP: Intentando autenticar CUIT ${config.cuit}...`);

  try {
      // Usamos las claves ya limpias y formateadas
      const privateKey = forge.pki.privateKeyFromPem(config.keyPem);
      const cert = forge.pki.certificateFromPem(config.certPem);

      // FIX HORA: Ajuste a UTC-3 aproximado
      const now = new Date();
      const genTime = new Date(now.getTime() - 600000).toISOString(); 
      const expTime = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
      const uniqueId = Math.floor(now.getTime() / 1000);

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
      p7.addSigner({ key: privateKey, certificate: cert, digestAlgorithm: forge.pki.oids.sha256 });
      p7.sign();
      const cms = forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());

      const client = await soap.createClientAsync(WSAA_URL, SOAP_OPTIONS);
      const [result] = await client.loginCmsAsync({ in0: cms });
      
      const token = result.loginCmsReturn.match(/<token>(.*?)<\/token>/)[1];
      const sign = result.loginCmsReturn.match(/<sign>(.*?)<\/sign>/)[1];
      
      const authData = { token, sign, expirationTime: expTime };
      await TA_REF.set(authData);
      return authData;

  } catch (error) {
      const msg = error.root?.Envelope?.Body?.Fault?.faultstring || error.message;
      console.error("❌ Fallo Auth AFIP:", msg);
      
      if(msg.includes("CMS")) throw new Error("AFIP rechazó la firma: Verifica que subiste el Certificado (.crt) que corresponde a esa Clave Privada (.key).");
      throw new Error(`Error de conexión con AFIP: ${msg}`);
  }
}

// ==================================================================
// 📡 FACTURACIÓN (WSFE)
// ==================================================================
async function getUltimoComprobante(clientSoap, auth, tipoCbte, ptoVta, cuit) {
  const [res] = await clientSoap.FECompUltimoAutorizadoAsync({
    Auth: { Token: auth.token, Sign: auth.sign, Cuit: cuit },
    PtoVta: ptoVta, CbteTipo: tipoCbte
  });
  return res.FECompUltimoAutorizadoResult.CbteNro || 0;
}

async function emitirFactura(total, cliente = {}, esNotaCredito = false, comprobanteAsociado = null) {
  const config = await getConfig();
  const auth = await getValidToken(config);
  const clientSoap = await soap.createClientAsync(WSFE_URL, SOAP_OPTIONS);

  const docNro = cliente.docNumber || "0";
  const condFiscal = cliente.fiscalCondition || 'CONSUMIDOR_FINAL';
  const condIvaId = CONDICION_IVA[condFiscal] || 5;
  const docTipo = (docNro !== "0") ? (docNro.length === 11 ? 80 : 96) : 99;
  const CBTE_TIPO = esNotaCredito ? 13 : 11;

  const ultimo = await getUltimoComprobante(clientSoap, auth, CBTE_TIPO, config.ptoVta, config.cuit);
  const proximo = ultimo + 1;

  console.log(`📠 Emitiendo FC #${proximo} ($${total})`);

  // Fecha compatible
  const fecha = new Date(Date.now() - 10800000).toISOString().slice(0,10).replace(/-/g,"");

  const FeDetReq = {
    Concepto: 1, DocTipo: docTipo, DocNro: docNro,
    CbteDesde: proximo, CbteHasta: proximo, CbteFch: fecha,
    ImpTotal: total.toFixed(2), ImpTotConc: 0, ImpNeto: total.toFixed(2),
    ImpOpEx: 0, ImpTrib: 0, ImpIVA: 0, MonId: "PES", MonCotiz: 1,
    CondicionIVAReceptorId: condIvaId
  };

  if (esNotaCredito && comprobanteAsociado) {
    FeDetReq.CbtesAsoc = { CbteAsoc: { Tipo: 11, PtoVta: comprobanteAsociado.ptoVta, Nro: comprobanteAsociado.nro }};
  }

  try {
      const [res] = await clientSoap.FECAESolicitarAsync({
        Auth: { Token: auth.token, Sign: auth.sign, Cuit: config.cuit },
        FeCAEReq: { FeCabReq: { CantReg: 1, PtoVta: config.ptoVta, CbteTipo: CBTE_TIPO }, FeDetReq: { FECAEDetRequest: FeDetReq } }
      });

      const resultado = res.FECAESolicitarResult;
      if (resultado.FeCabResp.Resultado !== "A") {
          const errs = resultado.Errors?.Err;
          throw new Error(Array.isArray(errs) ? errs[0].Msg : errs?.Msg || "Rechazo desconocido");
      }

      const detalle = resultado.FeDetResp.FECAEDetResponse[0] || resultado.FeDetResp.FECAEDetResponse;
      
      const qrJson = JSON.stringify({
          ver: 1, fecha: fecha, cuit: parseInt(config.cuit), ptoVta: config.ptoVta, tipoCmp: CBTE_TIPO, nroCmp: proximo,
          importe: parseFloat(total.toFixed(2)), moneda: "PES", ctz: 1, tipoDocRec: docTipo, nroDocRec: parseInt(docNro),
          tipoCodAut: "E", codAut: parseInt(detalle.CAE)
      });

      return {
        success: true, cae: detalle.CAE, vencimiento: detalle.CAEFchVto, numero: proximo, ptoVta: config.ptoVta, tipo: CBTE_TIPO,
        qr_data: `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(qrJson).toString('base64')}`
      };

  } catch (error) {
      console.error("❌ Error Facturación:", error);
      throw new Error(error.message);
  }
}

module.exports = { emitirFactura };