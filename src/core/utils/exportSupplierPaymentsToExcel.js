import ExcelJS from 'exceljs';

const COLUMNS = [
    { key: 'date',        label: 'Fecha',       width: 16, numeric: false },
    { key: 'supplier',    label: 'Proveedor',   width: 28, numeric: false },
    { key: 'description', label: 'Descripción', width: 32, numeric: false },
    { key: 'amount',      label: 'Monto ($)',   width: 15, numeric: true, numFmt: '"$"#,##0.00' },
];

export const exportSupplierPaymentsToExcel = async (items, filtersInfo = {}) => {
    const total = items.reduce((sum, m) => sum + (parseFloat(m.amount) || 0), 0);

    const rows = items.map(m => ({
        date: new Date(m.date).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }),
        supplier: m.supplierName || 'Varios',
        description: m.description || '-',
        amount: parseFloat(m.amount) || 0,
    }));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Noar POS';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('Pagos a Proveedores');
    const BRAND = 'C2410C';
    const GRAY_HDR = 'F3F4F6';
    const colCount = COLUMNS.length;

    // ── FILA 1: Título ──────────────────────────────────────────────
    ws.mergeCells(1, 1, 1, colCount);
    const titleCell = ws.getCell('A1');
    titleCell.value = 'PAGOS A PROVEEDORES';
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
    parts.push(`Total: ${items.length} pagos · $ ${total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);

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
    a.download = `pagos_proveedores_${date}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
};
