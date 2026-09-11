/**
 * BOT PRICE UPDATE — Cambio de precio de venta desde el bot de WhatsApp.
 *
 * Cambio INMEDIATO (no programado): limpia nextPrice/nextCost/priceActivationDate
 * igual que activatePendingPrice() en productRepository.js del frontend, para que
 * un cambio programado pendiente no termine pisando este cambio más adelante.
 * NUNCA crea el producto si no existe (a diferencia de botPurchases.js con items
 * nuevos) — cambiar el precio de "algo inventado" no tiene sentido.
 */
const admin = require("firebase-admin");
const { HttpError } = require("./botPurchases");

async function registerBotPriceUpdate(db, body) {
  const { companyId, branchId, clientRequestId, product, newPrice } = body || {};

  if (!companyId) throw new HttpError(400, "Falta companyId");
  if (!clientRequestId) throw new HttpError(400, "Falta clientRequestId");
  if (!product || (!product.productId && !product.code)) {
    throw new HttpError(400, "Falta product.productId o product.code");
  }
  if (typeof newPrice !== "number" || !(newPrice > 0)) throw new HttpError(400, "newPrice inválido");

  const companyRef = db.collection("companies").doc(String(companyId));

  // 🔒 Idempotencia: log propio de auditoría por clientRequestId.
  const existingSnap = await companyRef.collection("priceHistory")
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
    if (q.empty) throw new HttpError(404, `Producto con código ${product.code} no existe`);
    productRef = q.docs[0].ref;
  }

  const snap = await productRef.get();
  if (!snap.exists) throw new HttpError(404, `Producto ${product.productId || product.code} no existe`);

  const data = snap.data();
  const oldPrice = Number(data.price) || 0;

  // Mismo shape que activatePendingPrice() del frontend (líneas 64-77 de
  // productRepository.js): setear price y limpiar cualquier cambio programado.
  await productRef.set({
    price: newPrice,
    nextPrice: null,
    nextCost: null,
    priceActivationDate: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  const botResponse = { productId: productRef.id, name: data.name, oldPrice, newPrice };

  await companyRef.collection("priceHistory").add({
    productId: productRef.id,
    branchId: branchId || null,
    oldPrice,
    newPrice,
    clientRequestId,
    source: "whatsapp_bot",
    date: new Date().toISOString(),
    botResponse
  });

  return botResponse;
}

module.exports = { registerBotPriceUpdate };
