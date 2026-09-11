/**
 * BOT STOCK ADJUSTMENT -- Ajuste manual de stock desde el bot de WhatsApp
 * (rotura, conteo fisico, vencimiento, etc.)
 *
 * A proposito RECHAZA productos con relacion caja/unidad (isCase/caseProductId/
 * unitsPerCase) -- ajustar uno de esos productos en el frontend dispara una
 * cascada de recalculo entre el producto "caja" y su "unidad" relacionada
 * (ver adjustStock() en productRepository.js). Replicar esa cascada aca sin
 * probarla contra el catalogo real es exactamente el tipo de riesgo que hay
 * que evitar -- esos productos se ajustan solo desde la app.
 *
 * NUNCA crea el producto si no existe. Escribe en companies/{companyId}/movements
 * (la coleccion "maestra" que ya usa el frontend, ver lineas 671-682 de
 * productRepository.js) para que el ajuste aparezca en el Kardex real de la app,
 * no en un log paralelo.
 */
const admin = require("firebase-admin");
const { HttpError } = require("./botPurchases");

async function registerBotStockAdjustment(db, body) {
  const { companyId, branchId, clientRequestId, product, delta, reason } = body || {};

  if (!companyId) throw new HttpError(400, "Falta companyId");
  if (!branchId) throw new HttpError(400, "Falta branchId");
  if (!clientRequestId) throw new HttpError(400, "Falta clientRequestId");
  if (!product || (!product.productId && !product.code)) {
    throw new HttpError(400, "Falta product.productId o product.code");
  }
  if (typeof delta !== "number" || delta === 0) throw new HttpError(400, "delta invalido (debe ser un numero distinto de 0)");

  const companyRef = db.collection("companies").doc(String(companyId));

  const existingSnap = await companyRef.collection("movements")
    .where("clientRequestId", "==", clientRequestId)
    .limit(1)
    .get();
  if (!existingSnap.empty) {
    return existingSnap.docs[0].data().botResponse || { alreadyProcessed: true };
  }

  let productRef;
  if (product.productId) {
    productRef = companyRef.collection("products").doc(String(product.productId));
  } else {
    const q = await companyRef.collection("products").where("code", "==", String(product.code)).limit(1).get();
    if (q.empty) throw new HttpError(404, `Producto con codigo ${product.code} no existe`);
    productRef = q.docs[0].ref;
  }

  const snap = await productRef.get();
  if (!snap.exists) throw new HttpError(404, `Producto ${product.productId || product.code} no existe`);
  const data = snap.data();

  // Limite de seguridad deliberado: no tocar productos con relacion caja/unidad.
  const esCasoComplejo = data.isCase === true || !!data.caseProductId;
  if (esCasoComplejo) {
    throw new HttpError(400, `"${data.name}" tiene relacion caja/unidad -- ese ajuste hay que hacerlo desde la app, no por WhatsApp.`);
  }

  const inventoryRef = companyRef.collection("branches").doc(String(branchId)).collection("inventory").doc(productRef.id);
  const movId = `mov_bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = new Date().toISOString();

  // Lectura del stock DENTRO de la transaccion -- asi el chequeo de "no
  // negativo" y el incremento son atomicos de verdad contra otro ajuste/venta
  // concurrente sobre el mismo producto (todas las lecturas antes que las
  // escrituras, dentro de la misma tx, como exige Firestore).
  const respuesta = await db.runTransaction(async (tx) => {
    const inventorySnap = await tx.get(inventoryRef);
    const stockAnterior = inventorySnap.exists ? (Number(inventorySnap.data().stock) || 0) : 0;
    const stockNuevo = stockAnterior + delta;

    if (stockNuevo < 0) {
      throw new HttpError(400, `El ajuste dejaria el stock en negativo (actual: ${stockAnterior}, ajuste: ${delta}).`);
    }

    const respuestaLocal = { productId: productRef.id, name: data.name, stockAnterior, stockNuevo };

    tx.set(inventoryRef, {
      stock: stockNuevo,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    tx.set(companyRef.collection("movements").doc(movId), {
      id: movId,
      productId: productRef.id,
      branchId: String(branchId),
      type: "ADJUSTMENT",
      amount: Math.abs(delta),
      description: `${reason || "Ajuste manual"} (WhatsApp)`,
      user: "whatsapp_bot",
      date: timestamp,
      refId: null,
      clientRequestId,
      source: "whatsapp_bot",
      botResponse: respuestaLocal
    });

    return respuestaLocal;
  });

  return respuesta;
}

module.exports = { registerBotStockAdjustment };
