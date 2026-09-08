/**
 * BOT PURCHASES — Carga de compra a proveedor desde el bot de WhatsApp.
 *
 * Replica del lado del servidor las mismas reglas que ya usa
 * src/modules/suppliers/repositories/purchaseRepository.js (registerPurchase)
 * del frontend: costo neto/impuesto, PPP (costo promedio ponderado),
 * incremento atómico de stock e incremento atómico de suppliers.balance
 * (mismo signo que supplierLedgerService.js: PURCHASE suma).
 *
 * A propósito NUNCA toca product.price ni cash_movements/shifts — ver
 * decisiones de diseño en el plan (carga siempre a cuenta corriente,
 * cambio de precio solo se reporta, no se aplica solo).
 */
const admin = require("firebase-admin");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function generateId(prefix) {
  return `${prefix}_bot_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// Misma fórmula que _calculateLineItem() en purchaseRepository.js (suppliers).
function calculateLineItem(inputCost, taxRate, isTaxIncluded) {
  const rate = parseFloat(taxRate) || 0;
  const cost = parseFloat(inputCost) || 0;
  let netCost;
  let finalCost;

  if (isTaxIncluded) {
    finalCost = cost;
    netCost = cost / (1 + (rate / 100));
  } else {
    netCost = cost;
    finalCost = cost + (cost * (rate / 100));
  }

  return { netCost, finalCost };
}

async function registerBotPurchase(db, body) {
  const { companyId, branchId, clientRequestId, supplier, invoiceNumber, date, items } = body || {};

  if (!companyId) throw new HttpError(400, "Falta companyId");
  if (!branchId) throw new HttpError(400, "Falta branchId");
  if (!clientRequestId) throw new HttpError(400, "Falta clientRequestId");
  if (!supplier || (!supplier.id && !supplier.name)) throw new HttpError(400, "Falta supplier.id o supplier.name");
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, "Falta items");

  const companyRef = db.collection("companies").doc(String(companyId));

  // 🔒 Idempotencia: si ya se procesó este clientRequestId, devolver el mismo resultado
  // sin reaplicar el efecto (evita duplicar stock/deuda ante un reintento del bot).
  const existingSnap = await companyRef.collection("purchases")
    .where("clientRequestId", "==", clientRequestId)
    .limit(1)
    .get();
  if (!existingSnap.empty) {
    const existing = existingSnap.docs[0].data();
    return existing.botResponse || { purchaseId: existingSnap.docs[0].id, alreadyProcessed: true };
  }

  // Resolver proveedor (por id, o crear uno nuevo por nombre)
  let supplierId = supplier.id ? String(supplier.id) : null;
  let supplierName = supplier.name || null;

  if (supplierId) {
    const supplierSnap = await companyRef.collection("suppliers").doc(supplierId).get();
    if (!supplierSnap.exists) throw new HttpError(404, `Proveedor ${supplierId} no existe`);
    supplierName = supplierSnap.data().name || supplierName;
  } else {
    const supplierRef = companyRef.collection("suppliers").doc();
    supplierId = supplierRef.id;
    await supplierRef.set({
      id: supplierId,
      name: supplier.name,
      balance: 0,
      syncStatus: "synced",
      source: "whatsapp_bot",
      createdAt: new Date().toISOString(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  const timestamp = new Date().toISOString();
  const purchaseId = generateId("purch");
  const branchInventoryCol = companyRef.collection("branches").doc(String(branchId)).collection("inventory");
  const productsCol = companyRef.collection("products");

  const itemsRegistered = [];
  const priceChanges = [];
  const unmatchedItems = [];
  let total = 0;

  for (const item of items) {
    const { match, quantity, cost, isTaxIncluded, tax, name, code } = item || {};
    const qty = parseFloat(quantity) || 0;

    if (qty <= 0) {
      unmatchedItems.push({ ...item, reason: "cantidad inválida" });
      continue;
    }

    // Resolver producto existente por productId/code/barcode, o preparar uno nuevo.
    let productRef = null;
    let product = null;

    if (match?.productId) {
      productRef = productsCol.doc(String(match.productId));
      const snap = await productRef.get();
      if (snap.exists) product = snap.data();
    } else if (match?.code || match?.barcode) {
      const codeVal = String(match.code || match.barcode);
      const q = await productsCol.where("code", "==", codeVal).limit(1).get();
      if (!q.empty) {
        productRef = q.docs[0].ref;
        product = q.docs[0].data();
      }
    }

    if (!product && !name) {
      unmatchedItems.push({ ...item, reason: "no se pudo matchear ni crear (falta name)" });
      continue;
    }

    const isNewProduct = !product;
    if (isNewProduct) {
      productRef = productsCol.doc();
      product = {
        id: productRef.id,
        code: code || match?.code || null,
        barcode: match?.barcode || code || null,
        name: String(name).toUpperCase(),
        categoryId: "general",
        active: true,
        isWeighable: false,
        createdAt: timestamp
      };
    }

    const financials = calculateLineItem(cost, tax, isTaxIncluded);
    const lineTotal = financials.finalCost * qty;
    total += lineTotal;

    const inventoryRef = branchInventoryCol.doc(productRef.id);
    const inventorySnap = await inventoryRef.get();
    const currentStock = inventorySnap.exists ? (Number(inventorySnap.data().stock) || 0) : 0;
    const oldCost = Number(product.cost) || 0;
    const oldPrice = Number(product.price) || 0;

    let newWeightedCost = financials.finalCost;
    if (currentStock > 0) {
      newWeightedCost = ((oldCost * currentStock) + (financials.finalCost * qty)) / (currentStock + qty);
    }

    const newBatch = {
      id: generateId("batch"),
      purchaseId,
      dateAdded: timestamp,
      quantity: qty,
      originalCost: financials.finalCost,
      expiryDate: null
    };

    // 🛡️ Nunca tocamos product.price acá — solo cost/PPP. Ver decisión de diseño.
    await productRef.set({
      ...product,
      id: productRef.id,
      cost: newWeightedCost,
      lastPurchaseDate: timestamp,
      supplierId,
      batches: [...(product.batches || []), newBatch],
      syncStatus: "synced",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await inventoryRef.set({
      stock: admin.firestore.FieldValue.increment(qty),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    itemsRegistered.push({ productId: productRef.id, name: product.name, newStock: currentStock + qty });

    if (Math.abs(newWeightedCost - oldCost) > 0.01) {
      priceChanges.push({
        productId: productRef.id,
        name: product.name,
        oldPrice,
        newPrice: null,
        oldCost,
        newCost: newWeightedCost
      });
    }
  }

  const botResponse = { purchaseId, supplierId, total, itemsRegistered, priceChanges, unmatchedItems };

  // Compra siempre 100% a cuenta corriente — nunca toca cash_movements ni shifts.
  await companyRef.collection("purchases").doc(purchaseId).set({
    id: purchaseId,
    companyId,
    branchId,
    supplierId,
    supplierName,
    invoiceNumber: invoiceNumber || null,
    date: date || timestamp,
    createdAt: timestamp,
    status: "COMPLETED",
    paymentStatus: total > 0 ? "UNPAID" : "PAID",
    amountPaid: 0,
    remainingBalance: total,
    totalFinal: total,
    total,
    itemsCount: items.length,
    items,
    clientRequestId,
    source: "whatsapp_bot",
    syncStatus: "synced",
    botResponse
  });

  // 🔥 CONTADOR ATÓMICO: mismo signo que supplierLedgerService.js (PURCHASE suma).
  if (total > 0) {
    const ledgerId = generateId("sledg");
    const ledgerRef = companyRef.collection("supplier_ledger").doc(ledgerId);
    const supplierRef = companyRef.collection("suppliers").doc(supplierId);

    await db.runTransaction(async (tx) => {
      tx.set(ledgerRef, {
        id: ledgerId,
        supplierId,
        date: timestamp,
        type: "PURCHASE",
        amount: total,
        description: `Fac ${invoiceNumber || "S/N"} (WhatsApp)`,
        refId: purchaseId,
        source: "whatsapp_bot",
        syncStatus: "synced",
        _appliedToBalance: true
      });
      tx.set(supplierRef, {
        balance: admin.firestore.FieldValue.increment(total),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
  }

  return botResponse;
}

module.exports = { registerBotPurchase, HttpError };
