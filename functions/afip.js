/**
 * MÓDULO AFIP - NOAR POS (SaaS FINAL)
 * Versión: Multi-Tenant & "Super Limpiador" 🧼
 * * Cambios SaaS:
 * 1. No lee DB globalmente. Recibe la config desde index.js.
 * 2. Guarda el Token de Auth basado en el CUIT (Aislamiento de Sesión).
 * 3. Repara claves privadas rotas o mal copiadas.
 */

const admin = require("firebase-admin");
const soap = require("soap");
const xmlbuilder = require("xmlbuilder");
const forge = require("node-forge");
const https = require("https"); 
const axios = require("axios");

// Inicialización de Firebase (si no está ya init)
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// 🛡️ FIX SSL: AFIP usa cifrados antiguos que Node nuevo rechaza
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
// 🧼 SUPER LIMPIADOR DE CLAVES (CRÍTICO)
// ==================================================================
function cleanAndFormatKey(rawString, type) {
    if (!rawString) return "";

    // 1. Quitar cualquier cabecera existente
    let body = rawString
        .replace(/-----BEGIN.*?-----/g, '')
        .replace(/-----END.*?-----/g, '');

    // 2. ELIMINACIÓN TOTAL DE ESPACIOS
    body = body.replace(/\s+/g, '');

    // 3. Reconstruir en bloques de 64 caracteres (Estándar PEM)
    const chunks = body.match(/.{1,64}/g);
    if (!chunks) throw new Error(`El formato del ${type} está corrupto y no se puede reconstruir.`);
    
    const cleanBody = chunks.join('\n');

    // 4. Poner las cabeceras correctas
    if (type === 'KEY') {
        return `-----BEGIN RSA PRIVATE KEY-----\n${cleanBody}\n-----END RSA PRIVATE KEY-----`;
    } else {
        return `-----BEGIN CERTIFICATE-----\n${cleanBody}\n-----END CERTIFICATE-----`;
    }
}

// ==================================================================
// 🔐 AUTENTICACIÓN (WSAA) - ISOLATED BY CUIT
// ==================================================================
async function getValidToken(config) {
  // 🔑 ESTRATEGIA SAAS: Guardamos el token usando el CUIT como ID.
  // Así el token del Kiosco Pepe (CUIT A) no se mezcla con el de Farmacia Lola (CUIT B).
  const tokenRef = db.collection('afip_tokens').doc(config.cuit);

  try {
    const doc = await tokenRef.get();
    
    if (doc.exists) {
      const data = doc.data();
      const expires = new Date(data.expirationTime);
      // Margen de seguridad de 10 mins
      if (expires > new Date(Date.now() + 10 * 60000)) {
        return data;
      }
    }
    // Si no existe o venció, generamos uno nuevo
    return generateNewToken(config, tokenRef);

  } catch (error) {
    console.error("⚠️ Error leyendo caché de token, generando nuevo...", error);
    return generateNewToken(config, tokenRef);
  }
}

async function generateNewToken(config, tokenRef) {
  console.log(`🔐 AFIP: Autenticando CUIT ${config.cuit}...`);

  try {
      const privateKey = forge.pki.privateKeyFromPem(config.keyPem);
      const cert = forge.pki.certificateFromPem(config.certPem);

      // FIX HORA: Ajuste a UTC-3 aproximado para evitar error "Computer time is too far"
      const now = new Date();
      const genTime = new Date(now.getTime() - 600000).toISOString(); // -10 min
      const expTime = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(); // +12 hs
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
      
      // Guardamos el token en Firestore separado por CUIT
      await tokenRef.set(authData);
      
      return authData;

  } catch (error) {
      const msg = error.root?.Envelope?.Body?.Fault?.faultstring || error.message;
      console.error("❌ Fallo Auth AFIP:", msg);
      
      if(msg.includes("CMS")) throw new Error("AFIP rechazó la firma: Verifica que subiste el Certificado (.crt) correcto.");
      throw new Error(`Error AFIP Auth: ${msg}`);
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
  
  if (res.FECompUltimoAutorizadoResult.Errors) {
      throw new Error("Error consultando último comprobante");
  }
  
  return res.FECompUltimoAutorizadoResult.CbteNro || 0;
}

/**
 * Función principal exportada.
 * Ahora recibe 'config' como 5to argumento (Inyección de Dependencias).
 */
async function emitirFactura(total, cliente = {}, esNotaCredito = false, comprobanteAsociado = null, rawConfig) {
  
  // 1. Preparar Configuración (Limpieza y Validación)
  if (!rawConfig) throw new Error("Error Interno: No se recibió configuración de AFIP.");
  
  // Limpiamos las claves al vuelo antes de usarlas
  const config = {
      cuit: rawConfig.cuit.replace(/[^0-9]/g, ''), 
      ptoVta: parseInt(rawConfig.ptoVta) || 1,
      certPem: cleanAndFormatKey(rawConfig.cert, 'CERT'),
      keyPem: cleanAndFormatKey(rawConfig.key, 'KEY')
  };

  // 2. Obtener Token (Usando el CUIT de la config)
  const auth = await getValidToken(config);
  const clientSoap = await soap.createClientAsync(WSFE_URL, SOAP_OPTIONS);

  // 3. Preparar Datos Factura
  const docNro = cliente.docNumber || "0";
  const condFiscal = cliente.fiscalCondition || 'CONSUMIDOR_FINAL';
  const condIvaId = CONDICION_IVA[condFiscal] || 5;
  
  // Lógica inteligente de tipo de documento
  let docTipo = 99; // Por defecto: Sin identificar
  if (docNro !== "0") {
      docTipo = docNro.length === 11 ? 80 : 96; // 80=CUIT, 96=DNI
  }

  const CBTE_TIPO = esNotaCredito ? 13 : 11; // 11=Factura C, 13=Nota Credito C

  // 4. Obtener numeración
  const ultimo = await getUltimoComprobante(clientSoap, auth, CBTE_TIPO, config.ptoVta, config.cuit);
  const proximo = ultimo + 1;

  console.log(`📠 Emitiendo Cbte. Tipo ${CBTE_TIPO} #${proximo} ($${total}) para CUIT ${config.cuit}`);

  const fecha = new Date(Date.now() - 10800000).toISOString().slice(0,10).replace(/-/g,"");

  const FeDetReq = {
    Concepto: 1, // Productos
    DocTipo: docTipo, DocNro: docNro,
    CbteDesde: proximo, CbteHasta: proximo, CbteFch: fecha,
    ImpTotal: total.toFixed(2), ImpTotConc: 0, ImpNeto: total.toFixed(2),
    ImpOpEx: 0, ImpTrib: 0, ImpIVA: 0, MonId: "PES", MonCotiz: 1,
    CondicionIVAReceptorId: condIvaId
  };

  // Si es Nota de Crédito, vinculamos la factura original
  if (esNotaCredito && comprobanteAsociado) {
    FeDetReq.CbtesAsoc = { 
        CbteAsoc: { 
            Tipo: 11, // Asumimos que anulamos Factura C
            PtoVta: comprobanteAsociado.ptoVta, 
            Nro: comprobanteAsociado.nro 
        }
    };
  }

  // 5. Solicitar CAE a AFIP
  try {
      const [res] = await clientSoap.FECAESolicitarAsync({
        Auth: { Token: auth.token, Sign: auth.sign, Cuit: config.cuit },
        FeCAEReq: { FeCabReq: { CantReg: 1, PtoVta: config.ptoVta, CbteTipo: CBTE_TIPO }, FeDetReq: { FECAEDetRequest: FeDetReq } }
      });

      const resultado = res.FECAESolicitarResult;
      
      // Validar Aprobación
      if (resultado.FeCabResp.Resultado !== "A") {
          const errs = resultado.Errors?.Err;
          const msgError = Array.isArray(errs) ? errs[0].Msg : (errs?.Msg || "Rechazo desconocido de AFIP");
          throw new Error(`AFIP Rechazó: ${msgError}`);
      }

      const detalle = resultado.FeDetResp.FECAEDetResponse[0] || resultado.FeDetResp.FECAEDetResponse;
      
      // Generar data para QR
      const qrJson = JSON.stringify({
          ver: 1, fecha: fecha, cuit: parseInt(config.cuit), ptoVta: config.ptoVta, tipoCmp: CBTE_TIPO, nroCmp: proximo,
          importe: parseFloat(total.toFixed(2)), moneda: "PES", ctz: 1, tipoDocRec: docTipo, nroDocRec: parseInt(docNro),
          tipoCodAut: "E", codAut: parseInt(detalle.CAE)
      });

      return {
        success: true, 
        cae: detalle.CAE, 
        vencimiento: detalle.CAEFchVto, 
        numero: proximo, 
        ptoVta: config.ptoVta, 
        tipo: CBTE_TIPO,
        qr_data: `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(qrJson).toString('base64')}`
      };

  } catch (error) {
      console.error("❌ Error AFIP (Catch Final):", error);
      throw new Error(error.message || "Error de comunicación con AFIP");
  }
}

module.exports = { emitirFactura };