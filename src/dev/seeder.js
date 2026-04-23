/**
 * NOAR POS — Seeder de Datos para Dev/QA
 *
 * Uso desde consola del navegador:
 *   window.__noarSeed()   → pobla Dexie con datos realistas
 *   window.__noarClear()  → elimina solo los datos del seed (prefijo SEED-)
 */

import { getDB } from '../database/db';
import { useAuthStore } from '../modules/auth/store/useAuthStore';

const uid = () => crypto.randomUUID();
const seedId = (prefix) => `SEED-${prefix}-${uid()}`;
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ============================================================
// DATOS MAESTROS
// ============================================================

const CATEGORIES = [
  { id: seedId('CAT'), name: 'Almacén' },
  { id: seedId('CAT'), name: 'Bebidas' },
  { id: seedId('CAT'), name: 'Limpieza' },
  { id: seedId('CAT'), name: 'Electrónica' },
  { id: seedId('CAT'), name: 'Indumentaria' },
  { id: seedId('CAT'), name: 'Varios' },
];

const BRANDS = [
  { id: seedId('BRD'), name: 'Genérico' },
  { id: seedId('BRD'), name: 'La Serenísima' },
  { id: seedId('BRD'), name: 'Marolio' },
  { id: seedId('BRD'), name: 'Samsung' },
  { id: seedId('BRD'), name: 'Sin Marca' },
];

// ============================================================
// GENERADORES
// ============================================================

function makeProducts(companyId, categoryIds, brandIds) {
  const raw = [
    { name: 'Leche La Serenísima 1L', category: 'Bebidas', cost: 850, price: 1290, stock: 48, taxRate: 0 },
    { name: 'Aceite Marolio 900ml', category: 'Almacén', cost: 1100, price: 1750, stock: 30, taxRate: 10.5 },
    { name: 'Coca-Cola 2.25L', category: 'Bebidas', cost: 980, price: 1450, stock: 60, taxRate: 21 },
    { name: 'Agua Mineral 500ml', category: 'Bebidas', cost: 280, price: 450, stock: 120, taxRate: 0 },
    { name: 'Arroz Largo Fino 1kg', category: 'Almacén', cost: 620, price: 980, stock: 40, taxRate: 0 },
    { name: 'Fideos Spaghetti 500g', category: 'Almacén', cost: 430, price: 680, stock: 55, taxRate: 0 },
    { name: 'Azúcar 1kg', category: 'Almacén', cost: 780, price: 1200, stock: 35, taxRate: 0 },
    { name: 'Harina 0000 1kg', category: 'Almacén', cost: 520, price: 820, stock: 40, taxRate: 0 },
    { name: 'Jabón Líquido Ayudín 750ml', category: 'Limpieza', cost: 890, price: 1380, stock: 25, taxRate: 21 },
    { name: 'Lavandina Regular 1L', category: 'Limpieza', cost: 340, price: 580, stock: 50, taxRate: 21 },
    { name: 'Detergente Magistral 500ml', category: 'Limpieza', cost: 480, price: 780, stock: 30, taxRate: 21 },
    { name: 'Papel Higiénico x4', category: 'Limpieza', cost: 920, price: 1480, stock: 60, taxRate: 21 },
    { name: 'Cable USB-C 1m', category: 'Electrónica', cost: 1200, price: 2500, stock: 15, taxRate: 21 },
    { name: 'Auriculares Bluetooth', category: 'Electrónica', cost: 4500, price: 8900, stock: 8, taxRate: 21 },
    { name: 'Cargador Universal 20W', category: 'Electrónica', cost: 2800, price: 5500, stock: 10, taxRate: 21 },
    { name: 'Funda Celular Universal', category: 'Electrónica', cost: 800, price: 1800, stock: 20, taxRate: 21 },
    { name: 'Remera Básica Talle M', category: 'Indumentaria', cost: 2500, price: 5200, stock: 12, taxRate: 21 },
    { name: 'Medias x3 pares', category: 'Indumentaria', cost: 1100, price: 2400, stock: 18, taxRate: 21 },
    { name: 'Chicles Beldent x12', category: 'Varios', cost: 280, price: 480, stock: 80, taxRate: 21 },
    { name: 'Cigarrillos Marlboro x20', category: 'Varios', cost: 2100, price: 3200, stock: 45, taxRate: 0 },
    { name: 'Encendedor BIC', category: 'Varios', cost: 380, price: 700, stock: 35, taxRate: 21 },
    { name: 'Nafta Adhesiva 100g', category: 'Varios', cost: 420, price: 750, stock: 20, taxRate: 21 },
    { name: 'Pan Lactal Bimbo', category: 'Almacén', cost: 890, price: 1380, stock: 22, taxRate: 0 },
    { name: 'Yogur Frutado 190g', category: 'Bebidas', cost: 420, price: 680, stock: 36, taxRate: 0 },
    { name: 'Galletitas Oreo x144g', category: 'Almacén', cost: 650, price: 1050, stock: 40, taxRate: 21 },
  ];

  return raw.map((p, i) => {
    const catMatch = CATEGORIES.find(c => c.name === p.category);
    const catId = catMatch ? catMatch.id : categoryIds[0];
    const brandId = pick(brandIds);
    const id = seedId('PRD');
    return {
      id,
      code: `SEED-${String(i + 1).padStart(4, '0')}`,
      barcode: [`789${String(randomBetween(1000000, 9999999))}`],
      name: p.name,
      category: p.category,
      categoryId: catId,
      brand: BRANDS.find(b => b.id === brandId)?.name || 'Genérico',
      brandId,
      unit: 'UN',
      isWeighable: false,
      taxRate: p.taxRate,
      cost: p.cost,
      price: p.price,
      minPrice: Math.floor(p.price * 0.85),
      nextPrice: null,
      nextCost: null,
      priceActivationDate: null,
      stock: p.stock,
      minStock: randomBetween(5, 15),
      active: true,
      deleted: false,
      companyId,
      updatedAt: daysAgo(randomBetween(1, 30)),
      syncStatus: 'synced',
    };
  });
}

function makeInventory(products, branchId) {
  return products.map(p => ({
    branchId,
    productId: p.id,
    stock: p.stock,
    promo: null,
    updatedAt: daysAgo(randomBetween(1, 10)),
    syncStatus: 'synced',
  }));
}

function makeSuppliers(companyId) {
  const data = [
    { name: 'Distribuidora Norte SA', docNumber: '30712345678', balance: 45000 },
    { name: 'Lácteos del Sur SRL', docNumber: '30698765432', balance: 12000 },
    { name: 'Electro Import SA', docNumber: '30756789012', balance: 0 },
    { name: 'Indumentaria Mayorista', docNumber: '20345678901', balance: 8500 },
    { name: 'Bebidas y Más SRL', docNumber: '30823456789', balance: 22000 },
  ];
  return data.map((s, i) => ({
    id: seedId('SUP'),
    sequentialId: String(i + 1).padStart(3, '0'),
    name: s.name,
    docNumber: s.docNumber,
    balance: s.balance,
    companyId,
    updatedAt: daysAgo(randomBetween(5, 30)),
    syncStatus: 'synced',
  }));
}

function makeClients(companyId) {
  const data = [
    { name: 'Juan Pérez', docNumber: '20312345678', docType: '96', fiscalCondition: 'CONSUMIDOR_FINAL', balance: 0 },
    { name: 'Distribuidora García SRL', docNumber: '30698765001', docType: '80', fiscalCondition: 'RESPONSABLE_INSCRIPTO', balance: 0 },
    { name: 'María González', docNumber: '27456789012', docType: '96', fiscalCondition: 'CONSUMIDOR_FINAL', balance: 0 },
    { name: 'Carlos López', docNumber: '20345678901', docType: '96', fiscalCondition: 'CONSUMIDOR_FINAL', balance: 0 },
    { name: 'Supermercado El Barrio', docNumber: '30712345001', docType: '80', fiscalCondition: 'RESPONSABLE_INSCRIPTO', balance: 0 },
    { name: 'Ana Martínez', docNumber: '27567890123', docType: '96', fiscalCondition: 'CONSUMIDOR_FINAL', balance: 0 },
    { name: 'Roberto Silva', docNumber: '20456789012', docType: '96', fiscalCondition: 'CONSUMIDOR_FINAL', balance: 0 },
    { name: 'Kiosco Don Pedro', docNumber: '20678901234', docType: '80', fiscalCondition: 'RESPONSABLE_INSCRIPTO', balance: 0 },
  ];
  return data.map((c, i) => ({
    id: seedId('CLI'),
    sequentialId: String(i + 1).padStart(4, '0'),
    name: c.name,
    docNumber: c.docNumber,
    docType: c.docType,
    email: `${c.name.split(' ')[0].toLowerCase()}@seed.com`,
    address: `Calle Falsa ${randomBetween(100, 999)}`,
    fiscalCondition: c.fiscalCondition,
    balance: c.balance,
    companyId,
    updatedAt: daysAgo(randomBetween(1, 20)),
    syncStatus: 'synced',
  }));
}

function makeShifts(companyId, branchId, userId, userName) {
  const shifts = [];
  // 3 turnos cerrados
  for (let i = 3; i >= 1; i--) {
    const openedAt = new Date(Date.now() - i * 86400000);
    openedAt.setHours(8, 0, 0, 0);
    const closedAt = new Date(openedAt);
    closedAt.setHours(20, 0, 0, 0);
    const initialAmount = 5000;
    const expectedCash = initialAmount + randomBetween(30000, 80000);
    const finalCash = expectedCash + randomBetween(-2000, 2000);
    shifts.push({
      id: seedId('SHF'),
      userId,
      userEmail: 'admin@seed.com',
      userName,
      companyId,
      branchId,
      status: 'CLOSED',
      openedAt: openedAt.toISOString(),
      closedAt: closedAt.toISOString(),
      initialAmount,
      expectedCash,
      finalCash,
      leftInCash: 5000,
      withdrawn: finalCash - 5000,
      difference: finalCash - expectedCash,
      discrepancyStatus: Math.abs(finalCash - expectedCash) < 500 ? 'MATCH' : finalCash > expectedCash ? 'SURPLUS' : 'SHORTAGE',
      audited: true,
      auditedAt: closedAt.toISOString(),
      auditSnapshot: {},
      updatedAt: closedAt.toISOString(),
      syncStatus: 'synced',
    });
  }
  // 1 turno abierto (hoy)
  const todayOpen = new Date();
  todayOpen.setHours(8, 0, 0, 0);
  shifts.push({
    id: seedId('SHF'),
    userId,
    userEmail: 'admin@seed.com',
    userName,
    companyId,
    branchId,
    status: 'OPEN',
    openedAt: todayOpen.toISOString(),
    closedAt: null,
    initialAmount: 5000,
    expectedCash: null,
    finalCash: null,
    leftInCash: null,
    withdrawn: null,
    difference: null,
    discrepancyStatus: null,
    audited: false,
    auditedAt: null,
    auditSnapshot: null,
    updatedAt: todayOpen.toISOString(),
    syncStatus: 'synced',
  });
  return shifts;
}

function makeSalesAndMovements(companyId, branchId, userId, userName, shifts, products, clients) {
  const sales = [];
  const cashMovements = [];
  const customerLedger = [];
  const METHODS = ['cash', 'transfer', 'mercadopago', 'card', 'cash'];

  // Distribuir ventas en los 4 turnos (más en el turno abierto)
  const shiftDistribution = [10, 10, 10, 10]; // 40 ventas total

  shifts.forEach((shift, si) => {
    const count = shiftDistribution[si];
    for (let i = 0; i < count; i++) {
      const method = pick(METHODS);
      const isAccount = i === 2 && si < 3; // 1 venta a cuenta por turno (turnos 0,1,2)
      const accountClients = clients.filter(c => c.fiscalCondition === 'RESPONSABLE_INSCRIPTO');
      const client = isAccount ? pick(accountClients) : (Math.random() > 0.7 ? pick(clients) : null);
      const itemCount = randomBetween(1, 4);
      const selectedProducts = [...products].sort(() => Math.random() - 0.5).slice(0, itemCount);

      const items = selectedProducts.map(p => {
        const qty = randomBetween(1, 3);
        const subtotal = p.price * qty;
        return {
          id: p.id,
          name: p.name,
          quantity: qty,
          cost: p.cost,
          price: p.price,
          originalPrice: p.price,
          subtotal,
          profit: (p.price - p.cost) * qty,
          appliedPromo: false,
          promoLabel: '',
        };
      });

      const subtotal = items.reduce((s, it) => s + it.subtotal, 0);
      const discount = Math.random() > 0.8 ? Math.floor(subtotal * 0.05) : 0;
      const total = subtotal - discount;
      const totalCost = items.reduce((s, it) => s + it.cost * it.quantity, 0);
      const saleDate = si === 3
        ? new Date(Date.now() - i * 600000).toISOString() // hoy, espaciado
        : new Date(new Date(shift.openedAt).getTime() + i * 1800000).toISOString();

      const isAfipApproved = si === 1 && i === 0; // 1 venta con AFIP APPROVED
      const saleId = seedId('SAL');

      const sale = {
        id: saleId,
        shiftId: shift.id,
        date: saleDate,
        number: `X-0001-${String(si * 10 + i + 1).padStart(8, '0')}`,
        ticketNumber: `X-0001-${String(si * 10 + i + 1).padStart(8, '0')}`,
        invoiceNumber: `X-0001-${String(si * 10 + i + 1).padStart(8, '0')}`,
        branchId,
        userId,
        userName,
        companyId,
        status: 'COMPLETED',
        type: 'SALE',
        items,
        itemCount: items.reduce((s, it) => s + it.quantity, 0),
        subtotal,
        discount,
        surcharge: 0,
        total,
        amountPaid: isAccount ? 0 : total,
        amountDebt: isAccount ? total : 0,
        totalCost,
        netProfit: total - totalCost - discount,
        client: client ? { id: client.id, name: client.name, docNumber: client.docNumber, fiscalCondition: client.fiscalCondition } : null,
        method: isAccount ? 'account' : method,
        payments: null,
        payment: null,
        afip: isAfipApproved
          ? { status: 'APPROVED', cae: '12345678901234', caeDueDate: daysAgo(-10), invoiceType: 'B', number: 1 }
          : { status: 'SKIPPED' },
        updatedAt: saleDate,
        createdAt: saleDate,
        syncStatus: 'synced',
      };
      sales.push(sale);

      // Movimiento de caja por la venta
      if (!isAccount) {
        cashMovements.push({
          id: seedId('CM'),
          shiftId: shift.id,
          branchId,
          type: 'IN',
          subtype: 'SALE',
          method,
          amount: total,
          description: `Venta ${sale.number}`,
          date: saleDate,
          userId,
          companyId,
          referenceId: saleId,
          supplierName: null,
          updatedAt: saleDate,
          syncStatus: 'synced',
        });
      }

      // Ledger de cliente si es cuenta corriente
      if (isAccount && client) {
        const oldBalance = client.balance;
        client.balance += total;
        customerLedger.push({
          id: seedId('LEDG'),
          clientId: client.id,
          date: saleDate,
          type: 'SALE_DEBT',
          amount: total,
          oldBalance,
          newBalance: client.balance,
          description: `Venta ${sale.number} a cuenta`,
          referenceId: saleId,
          branchId,
          userId,
          updatedAt: saleDate,
          syncStatus: 'synced',
        });
      }
    }
  });

  return { sales, cashMovements, customerLedger };
}

function makePurchasesAndLedger(companyId, branchId, userId, suppliers, products) {
  const purchases = [];
  const supplierLedger = [];
  const movements = [];
  // Mapa para acumular balance real por supplier
  const supplierBalanceMap = {};
  suppliers.forEach(s => { supplierBalanceMap[s.id] = 0; });

  const PURCHASE_DATA = [
    { supplierIdx: 0, payStatus: 'PAID', items: [0, 1, 4, 5] },
    { supplierIdx: 1, payStatus: 'PARTIAL', items: [0, 23] },
    { supplierIdx: 4, payStatus: 'PAID', items: [2, 3] },
    { supplierIdx: 0, payStatus: 'UNPAID', items: [6, 7, 8] },
    { supplierIdx: 2, payStatus: 'PAID', items: [12, 13, 14] },
    { supplierIdx: 3, payStatus: 'PARTIAL', items: [16, 17] },
  ];

  PURCHASE_DATA.forEach((pd, i) => {
    const supplier = suppliers[pd.supplierIdx];
    const purchaseDate = daysAgo(randomBetween(2, 25));
    const purchaseId = seedId('PUR');
    const purchaseItems = pd.items.map(pi => {
      const prod = products[pi];
      const qty = randomBetween(10, 50);
      return {
        id: prod.id,
        code: prod.code,
        name: prod.name,
        qty,
        cost: prod.cost,
        price: prod.price,
        tax: prod.taxRate,
        isTaxIncluded: true,
        expiryDate: null,
        activationDate: null,
        returnedQty: 0,
      };
    });

    const totalNet = purchaseItems.reduce((s, it) => s + it.cost * it.qty, 0);
    const totalFinal = totalNet;
    const amountPaid = pd.payStatus === 'PAID' ? totalFinal : pd.payStatus === 'PARTIAL' ? Math.floor(totalFinal * 0.5) : 0;

    purchases.push({
      id: purchaseId,
      date: purchaseDate,
      branchId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      invoiceNumber: `A-0001-${String(i + 1).padStart(8, '0')}`,
      status: 'COMPLETED',
      itemsCount: purchaseItems.length,
      items: purchaseItems,
      totalNet,
      totalTax: 0,
      totalFinal,
      total: totalFinal,
      amountPaid,
      remainingBalance: totalFinal - amountPaid,
      paymentStatus: pd.payStatus,
      refundedAmount: 0,
      notes: '',
      companyId,
      updatedAt: purchaseDate,
      syncStatus: 'synced',
    });

    // Kardex: movimiento de entrada por la compra
    purchaseItems.forEach(it => {
      movements.push({
        id: seedId('MOV'),
        productId: it.id,
        branchId,
        type: 'STOCK_IN',
        description: `Compra a ${supplier.name}`,
        amount: it.qty,
        date: purchaseDate,
        user: 'Admin Seed',
        refId: purchaseId,
        updatedAt: purchaseDate,
        syncStatus: 'synced',
      });
    });

    // Ledger proveedor — balance parte desde 0 y acumula por compras/pagos
    supplierBalanceMap[supplier.id] += totalFinal;
    let supplierBalance = supplierBalanceMap[supplier.id];
    supplierLedger.push({
      id: seedId('SLEDG'),
      supplierId: supplier.id,
      date: purchaseDate,
      type: 'PURCHASE',
      amount: totalFinal,
      balance: supplierBalance,
      description: `Compra ${purchases[purchases.length - 1].invoiceNumber}`,
      refId: purchaseId,
      updatedAt: purchaseDate,
      syncStatus: 'synced',
    });

    if (amountPaid > 0) {
      supplierBalanceMap[supplier.id] -= amountPaid;
      supplierBalance = supplierBalanceMap[supplier.id];
      supplierLedger.push({
        id: seedId('SLEDG'),
        supplierId: supplier.id,
        date: purchaseDate,
        type: 'PAYMENT',
        amount: amountPaid,
        balance: supplierBalance,
        description: `Pago compra ${i + 1}`,
        refId: purchaseId,
        updatedAt: purchaseDate,
        syncStatus: 'synced',
      });
    }
  });

  // Actualizar el campo balance de cada supplier para que coincida con el ledger
  suppliers.forEach(s => {
    s.balance = supplierBalanceMap[s.id] ?? 0;
  });

  return { purchases, supplierLedger, movements };
}

// ============================================================
// RUNNER PRINCIPAL
// ============================================================

export async function runSeed() {
  console.log('🌱 Iniciando seed NOAR...');
  const db = await getDB();

  // Leer contexto desde el store de Zustand (siempre actualizado)
  const { user, activeBranchId } = useAuthStore.getState();
  if (!user?.companyId) {
    console.error('❌ No hay usuario logueado. Iniciá sesión primero.');
    return;
  }
  if (!activeBranchId) {
    console.error('❌ No hay sucursal activa. Seleccioná una sucursal primero.');
    return;
  }
  const companyId = user.companyId;
  const branchId = activeBranchId;
  const userId = user.uid;
  const userName = user.name || user.email || 'Admin Seed';

  // Idempotencia
  const existing = await db.products.where('code').startsWith('SEED-').count();
  if (existing > 0) {
    console.warn('⚠️ Ya existe seed. Ejecutá window.__noarClear() primero.');
    return;
  }

  // Enriquecer con companyId
  const categories = CATEGORIES.map(c => ({ ...c, companyId, updatedAt: daysAgo(30), syncStatus: 'synced' }));
  const brands = BRANDS.map(b => ({ ...b, companyId, updatedAt: daysAgo(30), syncStatus: 'synced' }));

  console.log('📦 Insertando categorías y marcas...');
  await db.categories.bulkPut(categories);
  await db.brands.bulkPut(brands);

  const products = makeProducts(companyId, categories.map(c => c.id), brands.map(b => b.id));
  const inventory = makeInventory(products, branchId);
  console.log(`📦 Insertando ${products.length} productos...`);
  await db.products.bulkPut(products);
  await db.inventory.bulkPut(inventory);

  const suppliers = makeSuppliers(companyId);
  const clients = makeClients(companyId);
  const shifts = makeShifts(companyId, branchId, userId, userName);

  const { sales, cashMovements, customerLedger } = makeSalesAndMovements(
    companyId, branchId, userId, userName, shifts, products, clients
  );

  // Purchases muta suppliers.balance para que coincida con el ledger
  const { purchases, supplierLedger, movements } = makePurchasesAndLedger(
    companyId, branchId, userId, suppliers, products
  );

  // Insertar en orden, suppliers ya con balance correcto
  console.log(`🏭 Insertando ${suppliers.length} proveedores...`);
  await db.suppliers.bulkPut(suppliers);

  console.log(`👥 Insertando ${clients.length} clientes...`);
  await db.clients.bulkPut(clients);

  console.log(`🕐 Insertando ${shifts.length} turnos...`);
  await db.shifts.bulkPut(shifts);

  console.log(`💰 Insertando ${sales.length} ventas y ${cashMovements.length} movimientos de caja...`);
  await db.sales.bulkPut(sales);
  await db.cash_movements.bulkPut(cashMovements);
  if (customerLedger.length) await db.customer_ledger.bulkPut(customerLedger);

  console.log(`🛒 Insertando ${purchases.length} compras...`);
  await db.purchases.bulkPut(purchases);
  if (supplierLedger.length) await db.supplier_ledger.bulkPut(supplierLedger);
  if (movements.length) await db.movements.bulkPut(movements);

  console.log(`
✅ Seed completado exitosamente!
   • ${categories.length} categorías
   • ${brands.length} marcas
   • ${products.length} productos
   • ${suppliers.length} proveedores
   • ${clients.length} clientes
   • ${shifts.length} turnos (3 cerrados + 1 abierto hoy)
   • ${sales.length} ventas
   • ${cashMovements.length} movimientos de caja
   • ${purchases.length} compras
   • ${movements.length} movimientos de kardex

   👉 Recargá la página para ver los datos en la UI.
   👉 Para limpiar: window.__noarClear()
  `);
}

// ============================================================
// LIMPIEZA
// ============================================================

export async function clearSeed() {
  console.log('🧹 Limpiando datos del seed...');
  const db = await getDB();

  const seedProducts = await db.products.where('code').startsWith('SEED-').toArray();
  const seedProductIds = new Set(seedProducts.map(p => p.id));

  // Tablas con IDs tipo SEED-*
  const tables = [
    'products', 'categories', 'brands', 'suppliers', 'clients',
    'shifts', 'sales', 'purchases',
  ];

  for (const table of tables) {
    try {
      const all = await db[table].toArray();
      const toDelete = all.filter(r => {
        const id = r.id || r.uid;
        return typeof id === 'string' && id.startsWith('SEED-');
      });
      await db[table].bulkDelete(toDelete.map(r => r.id || r.uid));
      if (toDelete.length) console.log(`  🗑️  ${table}: ${toDelete.length} eliminados`);
    } catch (e) {
      console.warn(`  ⚠️  ${table}: ${e.message}`);
    }
  }

  // Tablas relacionales
  const relTables = [
    { name: 'inventory', key: 'productId', ids: seedProductIds },
    { name: 'movements', key: 'productId', ids: seedProductIds },
  ];
  for (const { name, key, ids } of relTables) {
    try {
      const all = await db[name].toArray();
      const toDelete = all.filter(r => ids.has(r[key]));
      if (name === 'inventory') {
        await Promise.all(toDelete.map(r => db[name].delete([r.branchId, r.productId])));
      } else {
        await db[name].bulkDelete(toDelete.map(r => r.id));
      }
      if (toDelete.length) console.log(`  🗑️  ${name}: ${toDelete.length} eliminados`);
    } catch (e) {
      console.warn(`  ⚠️  ${name}: ${e.message}`);
    }
  }

  // cash_movements, customer_ledger, supplier_ledger por ID
  for (const table of ['cash_movements', 'customer_ledger', 'supplier_ledger']) {
    try {
      const all = await db[table].toArray();
      const toDelete = all.filter(r => typeof r.id === 'string' && r.id.startsWith('SEED-'));
      await db[table].bulkDelete(toDelete.map(r => r.id));
      if (toDelete.length) console.log(`  🗑️  ${table}: ${toDelete.length} eliminados`);
    } catch (e) {
      console.warn(`  ⚠️  ${table}: ${e.message}`);
    }
  }

  console.log('✅ Seed eliminado. Recargá la página.');
}
