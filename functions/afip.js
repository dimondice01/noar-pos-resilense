/**
 * MÓDULO AFIP - NOAR POS (SaaS DINÁMICO)
 * Lee credenciales desde Firestore (config/afip)
 * Elimina dependencia de archivos físicos .crt/.key
 */
const admin = require("firebase-admin");
const soap = require("soap");
const xmlbuilder = require("xmlbuilder");
const forge = require("node-forge");
const https = require("https"); 
const axios = require("axios");

// Inicialización de Firebase Admin (si no está ya iniciado)
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Referencias a Colecciones de Configuración
const TA_REF = db.doc("secrets/afip_token"); // Token de acceso cacheado
const CONFIG_REF = db.doc("secrets/afip");   // Credenciales del usuario (SaaS)

// 🛡️ PARCHE DE SEGURIDAD SSL (Legacy AFIP)
// AFIP usa cifrados antiguos que Node.js nuevo bloquea por defecto.
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

// URLs Fijas de Producción
const WSAA_URL = "https://wsaa.afip.gov.ar/ws/services/LoginCms?WSDL";
const WSFE_URL = "https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL";

const CONDICION_IVA = {
  'RESPONSABLE_INSCRIPTO': 1,
  'MONOTRIBUTO': 6,
  'CONSUMIDOR_FINAL': 5,
  'EXENTO': 4,
  'NO_RESPONSABLE': 3,
};

// ==================================================================
// 🛠️ HELPER: OBTENER CONFIGURACIÓN DINÁMICA
// ==================================================================
async function getConfig() {
    const doc = await CONFIG_REF.get();
    
    if (!doc.exists) {
        throw new Error("AFIP no está configurado en el sistema (Falta config/afip).");
    }
    
    const data = doc.data();
    
    if (!data.isActive) {
        throw new Error("La integración con AFIP está desactivada en Configuración.");
    }
    
    // Validación de integridad
    if (!data.cert || !data.key || !data.cuit) {
        throw new Error("Configuración AFIP incompleta: Faltan certificados o CUIT.");
    }

    return {
        cuit: data.cuit,
        ptoVta: parseInt(data.ptoVta) || 1,
        cert: data.cert, // Viene como string PEM desde DB
        key: data.key    // Viene como string PEM desde DB
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
      
      // Reutilizamos token si faltan más de 10 min para vencer
      if (expires > new Date(Date.now() + 10 * 60000)) {
        return data;
      }
    }
    // Si venció o no existe, generamos uno nuevo
    return generateNewToken(config);
  } catch (error) {
    console.error("⚠️ Error token cacheado, generando uno nuevo:", error);
    return generateNewToken(config);
  }
}

async function generateNewToken(config) {
  console.log(`🔐 AFIP SaaS: Generando Ticket de Acceso para CUIT ${config.cuit}...`);

  try {
      // 1. Parsear certificados desde Strings (Memoria)
      const cert = forge.pki.certificateFromPem(config.cert);
      const key = forge.pki.privateKeyFromPem(config.key);

      // 2. Crear XML de Solicitud (TRA)
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

      // 3. Firmar CMS (PKCS#7)
      const p7 = forge.pkcs7.createSignedData();
      p7.content = forge.util.createBuffer(TRA, "utf8");
      p7.addCertificate(cert);
      p7.addSigner({ key: key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256 });
      p7.sign();
      const cms = forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());

      // 4. Invocar SOAP WSAA
      const client = await soap.createClientAsync(WSAA_URL, SOAP_OPTIONS);
      const [result] = await client.loginCmsAsync({ in0: cms });
      const xml = result.loginCmsReturn;
      
      const token = xml.match(/<token>(.*?)<\/token>/)[1];
      const sign = xml.match(/<sign>(.*?)<\/sign>/)[1];

      const authData = { token, sign, expirationTime: expTime };
      await TA_REF.set(authData); // Guardamos para reusar
      return authData;

  } catch (error) {
      console.error("❌ Error generando Token AFIP:", error);
      throw new Error("Fallo al autenticar con AFIP. Verifique sus certificados.");
  }
}

// ==================================================================
// 📡 FACTURACIÓN (WSFE)
// ==================================================================
async function getUltimoComprobante(clientSoap, auth, tipoCbte, ptoVta, cuit) {
  const [res] = await clientSoap.FECompUltimoAutorizadoAsync({
    Auth: { Token: auth.token, Sign: auth.sign, Cuit: cuit },
    PtoVta: ptoVta,
    CbteTipo: tipoCbte
  });
  return res.FECompUltimoAutorizadoResult.CbteNro || 0;
}

/**
 * Función Principal Exportada
 */
async function emitirFactura(total, cliente = {}, esNotaCredito = false, comprobanteAsociado = null) {
  // 1. Cargar Configuración Dinámica (SaaS)
  const config = await getConfig();
  
  // 2. Obtener Token Valido (Usando certificados de la DB)
  const auth = await getValidToken(config);
  
  // 3. Cliente SOAP Facturación
  const clientSoap = await soap.createClientAsync(WSFE_URL, SOAP_OPTIONS);

  const docNro = cliente.docNumber || "0";
  const condFiscalStr = cliente.fiscalCondition || 'CONSUMIDOR_FINAL';
  const condicionIvaId = CONDICION_IVA[condFiscalStr] || 5;

  // Lógica DocTipo
  let docTipo = 99; // Sin Identificar
  if (docNro !== "0") {
     docTipo = docNro.length === 11 ? 80 : 96; // 80=CUIT, 96=DNI
  }

  // 11 = Factura C, 13 = Nota de Crédito C
  const CBTE_TIPO = esNotaCredito ? 13 : 11; 

  // Obtener último número
  const ultimo = await getUltimoComprobante(clientSoap, auth, CBTE_TIPO, config.ptoVta, config.cuit);
  const proximo = ultimo + 1;

  const tipoTxt = esNotaCredito ? "Nota Crédito C" : "Factura C";
  console.log(`📠 AFIP SaaS: Generando ${tipoTxt} #${proximo} por $${total} (CUIT: ${config.cuit})`);

  const fecha = new Date().toISOString().substring(0, 10).replace(/-/g, "");

  // Detalle Factura
  const FeDetReq = {
    Concepto: 1, // Productos
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
    CondicionIVAReceptorId: condicionIvaId
  };

  // Asociar comprobante si es NC (Requerido por AFIP)
  if (esNotaCredito && comprobanteAsociado) {
    FeDetReq.CbtesAsoc = {
      CbteAsoc: {
        Tipo: comprobanteAsociado.tipo,
        PtoVta: comprobanteAsociado.ptoVta,
        Nro: comprobanteAsociado.nro
      }
    };
  }

  // Payload final
  const payload = {
    Auth: { Token: auth.token, Sign: auth.sign, Cuit: config.cuit },
    FeCAEReq: {
      FeCabReq: {
        CantReg: 1,
        PtoVta: config.ptoVta,
        CbteTipo: CBTE_TIPO
      },
      FeDetReq: {
        FECAEDetRequest: FeDetReq
      }
    }
  };

  // 4. Disparar a AFIP
  const [res] = await clientSoap.FECAESolicitarAsync(payload);
  const resultado = res.FECAESolicitarResult;

  // Manejo de Errores
  if (resultado.FeCabResp.Resultado === "R" || resultado.FeCabResp.Resultado === "P") {
    const obs = resultado.FeDetResp.FECAEDetResponse[0] ? resultado.FeDetResp.FECAEDetResponse[0].Observaciones : null;
    const errs = resultado.Errors;
    
    let msgError = "Rechazo AFIP desconocido";
    if (errs && errs.Err) {
        msgError = Array.isArray(errs.Err) ? errs.Err[0].Msg : errs.Err.Msg;
    } else if (obs && obs.Obs) {
        msgError = Array.isArray(obs.Obs) ? obs.Obs[0].Msg : obs.Obs.Msg;
    }
    throw new Error(`AFIP Rechazó: ${msgError}`);
  }

  const detalle = resultado.FeDetResp.FECAEDetResponse[0] || resultado.FeDetResp.FECAEDetResponse;

  return {
    success: true,
    cae: detalle.CAE,
    vto: detalle.CAEFchVto,
    numero: proximo,
    ptoVta: config.ptoVta,
    tipo: CBTE_TIPO, // Devolvemos el tipo numérico para guardarlo en DB
    qr_data: `https://www.afip.gob.ar/fe/qr/?p=${btoa(JSON.stringify({
       ver: 1, fecha: fecha, cuit: config.cuit, ptoVta: config.ptoVta, tipoCmp: CBTE_TIPO, nroCmp: proximo, importe: total, moneda: "PES", ctz: 1, tipoDocRec: docTipo, nroDocRec: parseInt(docNro), tipoCodAut: "E", codAut: detalle.CAE
    }))}`
  };
}

module.exports = { emitirFactura };