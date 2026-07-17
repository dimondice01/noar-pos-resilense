import ExcelJS from 'exceljs';

const COLUMNS = [
    { key: 'rank',     label: '#',              width: 6,  numeric: true  },
    { key: 'name',     label: 'Producto',       width: 36, numeric: false },
    { key: 'quantity', label: 'Cant. Vendida',  width: 14, numeric: true  },
    { key: 'avgPrice', label: 'Precio Prom.',   width: 14, numeric: true, numFmt: '"$"#,##0.00' },
    { key: 'revenue',  label: 'Ingresos ($)',   width: 15, numeric: true, numFmt: '"$"#,##0.00' },
    { key: 'cost',     label: 'Costo ($)',      width: 15, numeric: true, numFmt: '"$"#,##0.00' },
    { key: 'profit',   label: 'Ganancia ($)',   width: 15, numeric: true, numFmt: '"$"#,##0.00' },
    { key: 'margin',   label: 'Margen (%)',     width: 12, numeric: true, numFmt: '0.0"%"' },
    { key: 'share',    label: '% del Total',    width: 12, numeric: true, numFmt: '0.0"%"' },
];

export const exportTopProductsToExcel = async (items, filtersInfo = {}) => {
    const totalRevenue = items.reduce((sum, p) => sum + (p.revenue || 0), 0);

    const rows = items.map((p, idx) => {
        const revenue = p.revenue || 0;
        const cost = p.cost || 0;
        const profit = revenue - cost;
        return {
            rank: idx + 1,
            name: p.name,
            quantity: p.quantity || 0,
            avgPrice: p.quantity > 0 ? revenue / p.quantity : 0,
            revenue,
            cost,
            profit,
            margin: cost > 0 ? (profit / cost) * 100 : 0,
            share: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
        };
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Noar POS';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('Productos Más Vendidos');
    const BRAND = 'C2410C';
    const GRAY_HDR = 'F3F4F6';
    const colCount = COLUMNS.length;

    // ── FILA 1: Título ──────────────────────────────────────────────
    ws.mergeCells(1, 1, 1, colCount);
    const titleCell = ws.getCell('A1');
    titleCell.value = 'PRODUCTOS MÁS VENDIDOS';
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 28;

    // ── FILA 2: Filtros activos ──────────────────────────────────────
    ws.mergeCells(2, 1, 2, colCount);
    const parts = [];
    if (filtersInfo.periodLabel) parts.push(`Período: ${filtersInfo.periodLabel}`);
    if (filtersInfo.search) parts.push(`Búsqueda: "${filtersInfo.search}"`);
    parts.push(`Generado: ${new Date().toLocaleDateString('es-AR')}`);
    parts.push(`Total: ${items.length} productos`);

    const filterCell = ws.getCell('A2');
    filterCell.value = parts.join('   |   ');
    filterCell.font = { size: 9, color: { argb: 'FF6B7280' }, italic: true };
    filterCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
    filterCell.alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getRow(2).height = 18;

    // ── FILA 3: Headers ─────────────────────────────────────────────
    ws.columns = COLUMNS.map(c => ({ key: c.key, width: c.width }));
    const headerRow = ws.getRow(3);
    COLUMNS.forEach((col, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = col.label;
        cell.font = { bold: true, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + GRAY_HDR } };
        cell.border = { bottom: { style: 'medium', color: { argb: 'FF' + BRAND } } };
        cell.alignment = { horizontal: col.numeric ? 'right' : 'left', vertical: 'middle' };
    });
    headerRow.height = 20;

    // ── FILAS DE DATOS ───────────────────────────────────────────────
    rows.forEach((r, idx) => {
        const row = ws.addRow(r);
        const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFFAFAFA';

        row.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
            cell.font = { size: 10 };
        });

        COLUMNS.forEach((col, i) => {
            const cell = row.getCell(i + 1);
            if (col.numFmt) cell.numFmt = col.numFmt;
            if (col.numeric) cell.alignment = { horizontal: 'right' };
        });

        row.height = 18;
    });

    // ── DESCARGA ────────────────────────────────────────────────────
    const buf = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const date = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `productos_mas_vendidos_${date}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
};
