/**
 * BOT SUPPLIER PAYMENT -- Registrar un pago a proveedor (a cuenta) desde el
 * bot de WhatsApp.
 *
 * A proposito NUNCA toca cash_movements ni shifts, a diferencia de
 * registerPayment() del frontend (purchaseRepository.js linea ~620, que SI
 * genera una salida de caja real cuando method !== 'debt'). Un pago
 * confirmado por WhatsApp puede procesarse minutos u horas despues del
 * mensaje original, sin garantia de que exista un turno abierto en ese
 * momento -- tocar caja/turno desde un webhook async es justo el tipo de
 * riesgo que se decidio evitar. El pago queda registrado 100% a cuenta
 * corriente del proveedor (mismo criterio que ya usa botPurchases.js para
 * las compras). Si el dueno necesita que quede reflejado como salida real de
 * caja de HOY, lo carga desde la app.
 *
 * NUNCA crea el proveedor si no existe.
 */
const admin = require("firebase-admin");
const { HttpError } = require("./botPurchases");

async function registerBotSupplierPayment(db, body) {
  const { companyId, branchId, clientRequestId, supplier, amount, description } = body || {};

  if (!companyId) throw new HttpError(400, "Falta companyId");
  if (!clientRequestId) throw new HttpError(400, "Falta clientRequestId");
  if (!supplier || (!supplier.id && !supplier.name)) throw new HttpError(400, "Falta supplier.id o supplier.name");
  if (typeof amount !== "number" || !(amount > 0)) throw new HttpError(400, "amount invalido");

  const companyRef = db.collection("companies").doc(String(companyId));

  const existingSnap = await companyRef.collection("supplier_ledger")
    .where("clientRequestId", "==", clientRequestId)
    .limit(1)
    .get();
  if (!existingSnap.empty) {
    return existingSnap.docs[0].data().botResponse || { alreadyProcessed: true };
  }

  let supplierRef;
  if (supplier.id) {
    supplierRef = companyRef.collection("suppliers").doc(String(supplier.id));
  } else {
    const nombreBuscado = String(supplier.name).trim().toUpperCase();
    const HIGH_SUFFIX = String.fromCharCode(0xf8ff);
    const q = await companyRef.collection("suppliers")
      .orderBy("name")
      .startAt(nombreBuscado)
      .endAt(nombreBuscado + HIGH_SUFFIX)
      .limit(5)
      .get();
    const activos = q.docs.filter(d => !d.data().deleted);
    if (!activos.length) throw new HttpError(404, `No encontre ningun proveedor activo que coincida con "${supplier.name}"`);
    if (activos.length > 1) throw new HttpError(400, `Hay mas de un proveedor que coincide con "${supplier.name}" -- usa supplier.id para desambiguar.`);
    supplierRef = activos[0].ref;
  }

  const ledgerId = `sledg_bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = new Date().toISOString();

  // Lectura del saldo DENTRO de la transaccion (no antes) -- asi el calculo
  // de saldoNuevo es atomico de verdad contra pagos/compras concurrentes
  // sobre el mismo proveedor (todas las lecturas antes que las escrituras,
  // dentro de la misma tx, como exige Firestore).
  const botResponse = await db.runTransaction(async (tx) => {
    const supplierSnap = await tx.get(supplierRef);
    if (!supplierSnap.exists || supplierSnap.data().deleted) {
      throw new HttpError(404, `Proveedor ${supplierRef.id} no existe`);
    }
    const supplierData = supplierSnap.data();
    const saldoAnterior = Number(supplierData.balance) || 0;
    const saldoNuevo = Math.max(0, saldoAnterior - amount);
    const respuesta = { supplierId: supplierRef.id, name: supplierData.name, saldoAnterior, saldoNuevo };

    tx.set(companyRef.collection("supplier_ledger").doc(ledgerId), {
      id: ledgerId,
      supplierId: supplierRef.id,
      date: timestamp,
      type: "PAYMENT",
      amount,
      description: description || "Pago a cuenta (WhatsApp)",
      balance: saldoNuevo,
      refId: null,
      clientRequestId,
      source: "whatsapp_bot",
      syncStatus: "synced",
      _appliedToBalance: true,
      botResponse: respuesta
    });
    tx.set(supplierRef, {
      balance: saldoNuevo,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return respuesta;
  });

  return botResponse;
}

module.exports = { registerBotSupplierPayment };
