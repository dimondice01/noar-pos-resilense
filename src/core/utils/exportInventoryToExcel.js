import ExcelJS from 'exceljs';

export const ALL_EXPORT_COLUMNS = [
    { key: 'code',     label: 'Código',      width: 14, numeric: false },
    { key: 'name',     label: 'Nombre',      width: 36, numeric: false, required: true },
    { key: 'category', label: 'Categoría',   width: 18, numeric: false },
    { key: 'brand',    label: 'Marca',       width: 16, numeric: false },
    { key: 'supplier', label: 'Proveedor',   width: 20, numeric: false },
    { key: 'cost',     label: 'Costo ($)',   width: 13, numeric: true,  numFmt: '"$"#,##0.00' },
    { key: 'price',    label: 'Precio ($)',  width: 13, numeric: true,  numFmt: '"$"#,##0.00' },
    { key: 'margin',   label: 'Margen (%)',  width: 13, numeric: true,  numFmt: '0"%"' },
    { key: 'stock',    label: 'Stock',       width: 10, numeric: true  },
    { key: 'minStock', label: 'Stock Mín.', width: 11, numeric: true  },
];

const getValue = (p, key) => {
    if (key === 'margin') {
        const cost  = parseFloat(p.cost  || 0);
        const price = parseFloat(p.price || 0);
        return cost > 0 ? Math.round(((price - cost) / cost) * 100) : 0;
    }
    if (key === 'cost' || key === 'price' || key === 'stock' || key === 'minStock') {
        return parseFloat(p[key] || 0);
    }
    return p[key] || '';
};

export const exportInventoryToExcel = async (products, activeFilters = {}, selectedKeys = null) => {
    const cols = selectedKeys
        ? ALL_EXPORT_COLUMNS.filter(c => selectedKeys.includes(c.key))
        : ALL_EXPORT_COLUMNS;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Noar POS';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('Inventario');
    const BRAND    = 'C2410C';
    const GRAY_HDR = 'F3F4F6';
    const colCount = cols.length;

    // ── FILA 1: Título ──────────────────────────────────────────────
    ws.mergeCells(1, 1, 1, colCount);
    const titleCell = ws.getCell('A1');
    titleCell.value = 'REPORTE DE INVENTARIO';
    titleCell.font  = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 28;

    // ── FILA 2: Filtros activos ──────────────────────────────────────
    ws.mergeCells(2, 1, 2, colCount);
    const parts = [];
    if (activeFilters.category) parts.push(`Categoría: ${activeFilters.category}`);
    if (activeFilters.brand)    parts.push(`Marca: ${activeFilters.brand}`);
    if (activeFilters.search)   parts.push(`Búsqueda: "${activeFilters.search}"`);
    parts.push(`Fecha: ${new Date().toLocaleDateString('es-AR')}`);
    parts.push(`Total: ${products.length} productos`);

    const filterCell = ws.getCell('A2');
    filterCell.value = parts.join('   |   ');
    filterCell.font  = { size: 9, color: { argb: 'FF6B7280' }, italic: true };
    filterCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
    filterCell.alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getRow(2).height = 18;

    // ── FILA 3: Headers ─────────────────────────────────────────────
    ws.columns = cols.map(c => ({ key: c.key, width: c.width }));
    const headerRow = ws.getRow(3);
    cols.forEach((col, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = col.label;
        cell.font  = { bold: true, size: 10 };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + GRAY_HDR } };
        cell.border = { bottom: { style: 'medium', color: { argb: 'FF' + BRAND } } };
        cell.alignment = { horizontal: col.numeric ? 'right' : 'left', vertical: 'middle' };
    });
    headerRow.height = 20;

    // ── FILAS DE DATOS ───────────────────────────────────────────────
    const stockIdx    = cols.findIndex(c => c.key === 'stock') + 1;
    const minStockIdx = cols.findIndex(c => c.key === 'minStock') + 1;

    products.forEach((p, idx) => {
        const rowData = {};
        cols.forEach(c => { rowData[c.key] = getValue(p, c.key); });

        const row = ws.addRow(rowData);
        const bg  = idx % 2 === 0 ? 'FFFFFFFF' : 'FFFAFAFA';

        row.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
            cell.font = { size: 10 };
        });

        cols.forEach((col, i) => {
            const cell = row.getCell(i + 1);
            if (col.numFmt) cell.numFmt = col.numFmt;
            if (col.numeric) cell.alignment = { horizontal: 'right' };
        });

        // Stock crítico
        if (stockIdx > 0) {
            const stock    = parseFloat(p.stock    || 0);
            const minStock = parseFloat(p.minStock || 0);
            if (stock <= minStock) {
                const stockCell = row.getCell(stockIdx);
                stockCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                stockCell.font = { size: 10, color: { argb: 'FFDC2626' }, bold: true };
            }
        }

        row.height = 18;
    });

    // ── DESCARGA ────────────────────────────────────────────────────
    const buf  = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const suffix = (activeFilters.category || activeFilters.brand || 'todos')
        .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]/g, '_');
    const date = new Date().toISOString().slice(0, 10);
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `inventario_${suffix}_${date}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
};
