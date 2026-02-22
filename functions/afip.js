/**
 * MÓDULO AFIP - NOAR POS (SaaS FINAL PRO - RESPONSABLE INSCRIPTO READY)
 * Versión: 4.1 - IVA Engine & Smart Type Selection & Consumidor Final Safe
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

// 🛡️ FIX SSL
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

// Mapeo de Condiciones Fiscales a ID de AFIP
const CONDICION_IVA = {
  'RESPONSABLE_INSCRIPTO': 1, 
  'MONOTRIBUTO': 6, 
  'CONSUMIDOR_FINAL': 5,
  'EXENTO': 4, 
  'NO_RESPONSABLE': 3,
};

// Tipos de Comprobantes
const CBTE_TIPOS = {
    // Facturas
    FACTURA_A: 1,
    FACTURA_B: 6,
    FACTURA_C: 11,
    // Notas de Crédito
    NC_A: 3,
    NC_B: 8,
    NC_C: 13
};

// ==================================================================
// 🧼 SUPER LIMPIADOR DE CLAVES
// ==================================================================
function cleanAndFormatKey(rawString, type) {
    if (!rawString) return "";
    let body = rawString.replace(/-----BEGIN.*?-----/g, '').replace(/-----END.*?-----/g, '');
    body = body.replace(/\s+/g, '');
    const chunks = body.match(/.{1,64}/g);
    if (!chunks) throw new Error(`El formato del ${type} está corrupto.`);
    const cleanBody = chunks.join('\n');
    if (type === 'KEY') return `-----BEGIN RSA PRIVATE KEY-----\n${cleanBody}\n-----END RSA PRIVATE KEY-----`;
    return `-----BEGIN CERTIFICATE-----\n${cleanBody}\n-----END CERTIFICATE-----`;
}

// ==================================================================
// 🔐 AUTENTICACIÓN (WSAA)
// ==================================================================
async function getValidToken(config) {
  const tokenRef = db.collection('afip_tokens').doc(config.cuit);
  try {
    const doc = await tokenRef.get();
    if (doc.exists) {
      const data = doc.data();
      const expires = new Date(data.expirationTime);
      if (expires > new Date(Date.now() + 10 * 60000)) return data;
    }
    return generateNewToken(config, tokenRef);
  } catch (error) {
    return generateNewToken(config, tokenRef);
  }
}

async function generateNewToken(config, tokenRef) {
  console.log(`🔐 AFIP: Autenticando CUIT ${config.cuit}...`);
  try {
      const privateKey = forge.pki.privateKeyFromPem(config.keyPem);
      const cert = forge.pki.certificateFromPem(config.certPem);
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
      
      await tokenRef.set(authData);
      return authData;
  } catch (error) {
      const msg = error.root?.Envelope?.Body?.Fault?.faultstring || error.message;
      if(msg.includes("CMS")) throw new Error("AFIP rechazó la firma: Certificado incorrecto.");
      throw new Error(`Error AFIP Auth: ${msg}`);
  }
}

// ==================================================================
// 🧠 LÓGICA DE NEGOCIO: SELECCIÓN DE COMPROBANTE
// ==================================================================
function determinarComprobante(emisorCondicion, receptorCondicion, esNC) {
    const soyRI = emisorCondicion === 'RESPONSABLE_INSCRIPTO';
    const receptorEsRI = receptorCondicion === 'RESPONSABLE_INSCRIPTO';
    const receptorEsMono = receptorCondicion === 'MONOTRIBUTO';

    if (soyRI) {
        // RI emite A a otro RI o Monotributista
        if (receptorEsRI || receptorEsMono) {
            return esNC ? CBTE_TIPOS.NC_A : CBTE_TIPOS.FACTURA_A;
        }
        // RI emite B a Consumidor Final o Exento
        return esNC ? CBTE_TIPOS.NC_B : CBTE_TIPOS.FACTURA_B;
    } else {
        // Monotributista siempre emite C
        return esNC ? CBTE_TIPOS.NC_C : CBTE_TIPOS.FACTURA_C;
    }
}

async function getUltimoComprobante(clientSoap, auth, tipoCbte, ptoVta, cuit) {
  try {
      const [res] = await clientSoap.FECompUltimoAutorizadoAsync({
        Auth: { Token: auth.token, Sign: auth.sign, Cuit: cuit },
        PtoVta: ptoVta, CbteTipo: tipoCbte
      });

      if (res.FECompUltimoAutorizadoResult.Errors) {
          const errMsg = res.FECompUltimoAutorizadoResult.Errors.Err[0]?.Msg || "Error desconocido";
          console.error(`❌ AFIP Error en GetUltimoCbte (Tipo: ${tipoCbte}):`, errMsg);
          throw new Error(errMsg);
      }

      return res.FECompUltimoAutorizadoResult.CbteNro || 0;
  } catch (err) {
      console.error(`❌ AFIP Fatal Error (Tipo: ${tipoCbte}):`, err.message);
      throw new Error(`Error consultando último comprobante (Tipo ${tipoCbte}). Revisa si el Punto de Venta ${ptoVta} está habilitado para este tipo de factura.`);
  }
}

// ==================================================================
// 📡 EMISIÓN DE FACTURA (MASTER FUNCTION)
// ==================================================================
async function emitirFactura(total, cliente = {}, esNotaCredito = false, comprobanteAsociado = null, rawConfig) {
  
  if (!rawConfig) throw new Error("Error Interno: Falta configuración AFIP.");
  
  // 1. Configuración y Auth
  const config = {
      cuit: rawConfig.cuit.replace(/[^0-9]/g, ''), 
      ptoVta: parseInt(rawConfig.ptoVta) || 1,
      certPem: cleanAndFormatKey(rawConfig.cert, 'CERT'),
      keyPem: cleanAndFormatKey(rawConfig.key, 'KEY'),
      taxCondition: rawConfig.taxCondition || 'MONOTRIBUTO' // Default seguro
  };

  const auth = await getValidToken(config);
  const clientSoap = await soap.createClientAsync(WSFE_URL, SOAP_OPTIONS);

  // 2. Datos Cliente y Tipo de Factura
  let docNro = cliente.docNumber || "0";
  const condFiscalCliente = cliente.fiscalCondition || 'CONSUMIDOR_FINAL';
  const condIvaId = CONDICION_IVA[condFiscalCliente] || 5; // 5 = Consumidor Final
  
  let docTipo = 99; // 99 = Sin Identificar (Consumidor Final Anónimo)
  if (docNro !== "0") {
      docTipo = docNro.length === 11 ? 80 : 96; // 80=CUIT, 96=DNI
  }

  // 🔥 REGLA AFIP: Si el total supera el límite, exige DNI para Consumidor Final.
  // Límite actual aproximado: $344.000. Ponemos una validación de seguridad a $100.000 para atajarlo antes de que AFIP rechace.
  if (total >= 100000 && docTipo === 99) {
      throw new Error(`Para facturas mayores a $100.000, AFIP exige identificar al cliente con DNI o CUIT.`);
  }

  // 🔥 CEREBRO: Determinar A, B o C
  const CBTE_TIPO = determinarComprobante(config.taxCondition, condFiscalCliente, esNotaCredito);

  // 🛡️ Validación estricta Factura A
  if (CBTE_TIPO === CBTE_TIPOS.FACTURA_A || CBTE_TIPO === CBTE_TIPOS.NC_A) {
      if (docTipo !== 80) throw new Error("Para emitir Factura A, el cliente debe tener un CUIT válido.");
  }

  // 3. Numeración
  const ultimo = await getUltimoComprobante(clientSoap, auth, CBTE_TIPO, config.ptoVta, config.cuit);
  const proximo = ultimo + 1;
  const fecha = new Date(Date.now() - 10800000).toISOString().slice(0,10).replace(/-/g,"");

  // 4. 🧮 CÁLCULOS MATEMÁTICOS (IVA & TOTALES)
  // AFIP exige que la suma sea EXACTA: ImpNeto + ImpIVA = ImpTotal
  let impTotal = Number(parseFloat(total).toFixed(2));
  let impNeto = impTotal;
  let impIVA = 0;
  let arrayIva = null;

  // Si es A o B, hay que desglosar el IVA (Calculamos sobre el 21%)
  if (CBTE_TIPO === CBTE_TIPOS.FACTURA_A || CBTE_TIPO === CBTE_TIPOS.FACTURA_B || CBTE_TIPO === CBTE_TIPOS.NC_A || CBTE_TIPO === CBTE_TIPOS.NC_B) {
      // Usar Math.round(num * 100) / 100 es más preciso que toFixed en JS
      impNeto = Math.round((impTotal / 1.21) * 100) / 100;
      impIVA = Math.round((impTotal - impNeto) * 100) / 100; 
      
      arrayIva = {
          AlicIva: [
              {
                  Id: 5, // 21%
                  BaseImp: impNeto,
                  Importe: impIVA
              }
          ]
      };
  }

  console.log(`📠 Emitiendo Tipo ${CBTE_TIPO} #${proximo} | Total: ${impTotal} | Neto: ${impNeto} | IVA: ${impIVA}`);

  const FeDetReq = {
    Concepto: 1, // 1 = Productos (Bienes)
    DocTipo: docTipo, 
    DocNro: docNro,
    CbteDesde: proximo, 
    CbteHasta: proximo, 
    CbteFch: fecha,
    ImpTotal: impTotal,
    ImpTotConc: 0,
    ImpNeto: impNeto,
    ImpOpEx: 0, 
    ImpTrib: 0, 
    ImpIVA: impIVA, 
    MonId: "PES", 
    MonCotiz: 1,
    CondicionIVAReceptorId: condIvaId // Este campo a veces es ignorado por WSFE, pero lo mandamos por seguridad
  };

  // Inyectar Array de IVA si corresponde (Facturas A y B)
  if (arrayIva && impIVA > 0) {
      FeDetReq.Iva = arrayIva;
  }

  // Vincular Nota de Crédito
  if (esNotaCredito && comprobanteAsociado) {
    FeDetReq.CbtesAsoc = { 
        CbteAsoc: { 
            Tipo: comprobanteAsociado.tipo, // Ej: 1 para Fac A, 6 para Fac B
            PtoVta: comprobanteAsociado.ptoVta, 
            Nro: comprobanteAsociado.nro 
        }
    };
  }

  // 5. Solicitar CAE
  try {
      const requestPayload = {
        Auth: { Token: auth.token, Sign: auth.sign, Cuit: config.cuit },
        FeCAEReq: { 
            FeCabReq: { CantReg: 1, PtoVta: config.ptoVta, CbteTipo: CBTE_TIPO }, 
            FeDetReq: { FECAEDetRequest: FeDetReq } 
        }
      };

      // console.log("📦 Payload enviado a AFIP:", JSON.stringify(requestPayload, null, 2));

      const [res] = await clientSoap.FECAESolicitarAsync(requestPayload);

      const resultado = res.FECAESolicitarResult;
      
      if (resultado.FeCabResp.Resultado !== "A") {
          const errs = resultado.Errors?.Err;
          const msgError = Array.isArray(errs) ? errs[0].Msg : (errs?.Msg || "Rechazo desconocido");
          throw new Error(`AFIP Rechazó: ${msgError}`);
      }

      const detalle = resultado.FeDetResp.FECAEDetResponse[0] || resultado.FeDetResp.FECAEDetResponse;
      
      if (detalle.Resultado !== "A") {
          const obs = detalle.Observaciones?.Obs;
          const msgObs = Array.isArray(obs) ? obs[0].Msg : (obs?.Msg || "Error en el detalle");
          throw new Error(`AFIP Rechazó (Detalle): ${msgObs}`);
      }

      // QR Data (Formato JSON Base64)
      const qrJson = JSON.stringify({
          ver: 1, fecha: fecha, cuit: parseInt(config.cuit), ptoVta: config.ptoVta, tipoCmp: CBTE_TIPO, nroCmp: proximo,
          importe: impTotal, moneda: "PES", ctz: 1, tipoDocRec: docTipo, nroDocRec: parseInt(docNro),
          tipoCodAut: "E", codAut: parseInt(detalle.CAE)
      });

      return {
        success: true, 
        cae: detalle.CAE, 
        vencimiento: detalle.CAEFchVto, 
        numero: proximo, 
        ptoVta: config.ptoVta, 
        tipo: CBTE_TIPO,
        letra: CBTE_TIPO === 1 || CBTE_TIPO === 3 ? 'A' : (CBTE_TIPO === 6 || CBTE_TIPO === 8 ? 'B' : 'C'), // Helper visual
        qr_data: `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(qrJson).toString('base64')}`
      };

  } catch (error) {
      console.error("❌ Error solicitando CAE:", error);
      throw new Error(error.message || "Error al intentar autorizar el comprobante en AFIP.");
  }
}

module.exports = { emitirFactura };