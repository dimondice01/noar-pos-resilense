import React, { useState } from 'react';
import { cashRepository } from '../cash/repositories/cashRepository';
import { getDB } from '../../database/db';
import { useAuthStore } from '../auth/store/useAuthStore';

// ============================================================
// 🧪 QA TEST RUNNER — NOAR POS RESILIENCE
// Ruta: /qa-test
// Prueba: ventas cash, transfer, SPLIT, budget, abandono,
//          gasto, retiro, cierre Z y verificación del snapshot
// ============================================================

const log = (arr, msg, type = 'info') => [...arr, { msg, type, time: new Date().toLocaleTimeString() }];
const fmt = (n) => `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

export const QATestPage = () => {
    const { user } = useAuthStore();
    const [running, setRunning] = useState(false);
    const [logs, setLogs] = useState([]);
    const [report, setReport] = useState(null);

    const addLog = (msg, type = 'info') => setLogs(prev => log(prev, msg, type));

    const runQA = async () => {
        setRunning(true);
        setLogs([]);
        setReport(null);

        try {
            const db = await getDB();

            // ── STEP 0: Clean previous QA data ──────────────────────────
            addLog('🧹 Limpiando datos QA anteriores...', 'info');
            const prevSales = await db.sales.filter(s => s.id?.startsWith('qa_')).toArray();
            if (prevSales.length > 0) await db.sales.bulkDelete(prevSales.map(s => s.id));
            const prevMovs = await db.cash_movements.filter(m => m.description?.includes('[QA]')).toArray();
            if (prevMovs.length > 0) await db.cash_movements.bulkDelete(prevMovs.map(m => m.id));
            addLog(`✅ ${prevSales.length} ventas QA anteriores eliminadas`, 'success');

            // ── STEP 1: Open Shift ───────────────────────────────────────
            addLog('💼 Abriendo turno con fondo $10.000...', 'info');
            const shift = await cashRepository.openShift(10000, 'QA_TESTER');
            addLog(`✅ Turno abierto: #${shift.id.slice(-8)} | Fondo: ${fmt(10000)}`, 'success');

            // ── STEP 2: Insert test sales ────────────────────────────────
            addLog('🛒 Insertando ventas de prueba...', 'info');
            const now = new Date().toISOString();
            const testSales = [
                {
                    id: `qa_sale_cash_${Date.now()}`,
                    shiftId: shift.id, branchId: shift.branchId, date: now,
                    status: 'COMPLETED', type: 'SALE', method: 'cash',
                    total: 5000, subtotal: 5000, discount: 0, surcharge: 0,
                    payments: [{ method: 'cash', amount: 5000, total: 5000 }],
                    payment: { method: 'cash', amountPaid: 5000 },
                    items: [{ id: 'p1', name: 'Producto A', price: 5000, quantity: 1, subtotal: 5000, cost: 2000 }],
                    netProfit: 3000, syncStatus: 'pending', updatedAt: now
                },
                {
                    id: `qa_sale_transfer_${Date.now() + 1}`,
                    shiftId: shift.id, branchId: shift.branchId, date: now,
                    status: 'COMPLETED', type: 'SALE', method: 'transfer',
                    total: 3000, subtotal: 3000, discount: 0, surcharge: 0,
                    payments: [{ method: 'transfer', amount: 3000, total: 3000 }],
                    payment: { method: 'transfer', amountPaid: 3000 },
                    items: [{ id: 'p2', name: 'Producto B', price: 3000, quantity: 1, subtotal: 3000, cost: 1000 }],
                    netProfit: 2000, syncStatus: 'pending', updatedAt: now
                },
                {
                    id: `qa_sale_split_${Date.now() + 2}`,
                    shiftId: shift.id, branchId: shift.branchId, date: now,
                    status: 'COMPLETED', type: 'SALE', method: 'SPLIT',
                    total: 4000, subtotal: 4000, discount: 0, surcharge: 0,
                    payments: [
                        { method: 'cash', amount: 2000, total: 2000 },
                        { method: 'transfer', amount: 2000, total: 2000 }
                    ],
                    payment: { method: 'cash', amountPaid: 2000 },
                    items: [{ id: 'p3', name: 'Producto C (Combinado)', price: 4000, quantity: 1, subtotal: 4000, cost: 1500 }],
                    netProfit: 2500, syncStatus: 'pending', updatedAt: now
                },
                {
                    id: `qa_sale_budget_${Date.now() + 3}`,
                    shiftId: shift.id, branchId: shift.branchId, date: now,
                    status: 'COMPLETED', type: 'BUDGET', method: 'budget',
                    total: 8000, subtotal: 8000, discount: 0, surcharge: 0,
                    payments: [{ method: 'budget', amount: 8000, total: 8000 }],
                    payment: { method: 'budget', amountPaid: 8000 },
                    items: [{ id: 'p4', name: 'Presupuesto Grande', price: 8000, quantity: 1, subtotal: 8000, cost: 0 }],
                    netProfit: 0, syncStatus: 'pending', updatedAt: now
                },
                {
                    id: `qa_sale_abandoned_${Date.now() + 4}`,
                    shiftId: shift.id, branchId: shift.branchId, date: now,
                    status: 'ABANDONED', type: 'SALE', method: 'cash',
                    number: `ABND-${Date.now()}`,
                    total: 2500, subtotal: 2500, discount: 0, surcharge: 0,
                    payments: [{ method: 'cash', amount: 2500, total: 2500 }],
                    payment: { method: 'cash', amountPaid: 2500 },
                    items: [{ id: 'p5', name: 'Venta Abandonada (NO CONTAR)', price: 2500, quantity: 1, subtotal: 2500, cost: 0 }],
                    netProfit: 0, syncStatus: 'pending', updatedAt: now
                }
            ];
            await db.sales.bulkPut(testSales);
            addLog('✅ 5 ventas insertadas: EFECTIVO, TRANSFERENCIA, SPLIT, PRESUPUESTO, ABANDONO', 'success');

            // ── STEP 3: Expense ──────────────────────────────────────────
            addLog('💸 Registrando gasto $500 (Compra de insumos)...', 'info');
            await db.cash_movements.put({
                id: `qa_mov_exp_${Date.now()}`,
                shiftId: shift.id, branchId: shift.branchId,
                type: 'EXPENSE', method: 'cash', amount: 500,
                description: '[QA] Compra de insumos', date: now,
                userId: user?.uid, companyId: user?.companyId, syncStatus: 'pending'
            });
            addLog('✅ Gasto registrado: $500 efectivo', 'success');

            // ── STEP 4: Withdrawal ───────────────────────────────────────
            addLog('🏦 Registrando retiro $300 (Retiro para banco)...', 'info');
            await db.cash_movements.put({
                id: `qa_mov_wit_${Date.now()}`,
                shiftId: shift.id, branchId: shift.branchId,
                type: 'WITHDRAWAL', method: 'cash', amount: 300,
                description: '[QA] Retiro para banco', date: now,
                userId: user?.uid, companyId: user?.companyId, syncStatus: 'pending'
            });
            addLog('✅ Retiro registrado: $300 efectivo', 'success');

            // ── STEP 5: Cash Income (INGRESO) ────────────────────────────
            addLog('💵 Registrando ingreso $1.000 (Cobro deuda cliente)...', 'info');
            await db.cash_movements.put({
                id: `qa_mov_in1_${Date.now()}`,
                shiftId: shift.id, branchId: shift.branchId,
                type: 'IN', method: 'cash', amount: 1000,
                description: '[QA] Cobro deuda cliente Juan', date: now,
                userId: user?.uid, companyId: user?.companyId, syncStatus: 'pending'
            });
            addLog('✅ Ingreso registrado: $1.000 efectivo (cobro deuda)', 'success');

            addLog('💵 Registrando ingreso $700 (Ingreso manual caja)...', 'info');
            await db.cash_movements.put({
                id: `qa_mov_in2_${Date.now() + 1}`,
                shiftId: shift.id, branchId: shift.branchId,
                type: 'IN', method: 'cash', amount: 700,
                description: '[QA] Ingreso manual por ajuste', date: now,
                userId: user?.uid, companyId: user?.companyId, syncStatus: 'pending'
            });
            addLog('✅ Ingreso registrado: $700 efectivo (ajuste)', 'success');

            // ── STEP 5: Get Audit Data ───────────────────────────────────
            addLog('📊 Calculando auditoría del turno...', 'info');
            const audit = await cashRepository.getShiftAuditData(shift.id);

            // Expected values:
            // salesCash = 5000 (cash) + 2000 (split-cash) = 7000
            // salesTransfer = 3000 (transfer) + 2000 (split-transfer) = 5000
            // BUDGET → ignored (type=BUDGET)
            // ABANDONED → ignored (status=ABANDONED)
            // manualOut = 500 (expense) + 300 (withdrawal) = 800
            // manualIn = 1000 (cobro deuda) + 700 (ajuste) = 1700
            // expectedCash = 10000 + 7000 + 1700 - 800 = 17900
            const EXPECTED_CASH = 10000 + 7000 + 1700 - 800;  // 17900
            const EXPECTED_TRANSFER = 5000;
            const EXPECTED_MANUAL_OUT = 800;
            const EXPECTED_MANUAL_IN = 1700;
            const EXPECTED_TOTAL_SALES = 12000; // 5000+3000+4000 (budget & abandoned excluded)

            const checks = [
                { label: 'Teórico Caja (expectedCash)', got: audit.expectedCash, expected: EXPECTED_CASH },
                { label: 'Ventas Efectivo', got: audit.salesByMethod?.cash, expected: 7000 },
                { label: 'Ventas Transferencia', got: (audit.salesByMethod?.transfer || 0), expected: EXPECTED_TRANSFER },
                { label: 'Gastos+Retiros (manualOut)', got: audit.manualOut, expected: EXPECTED_MANUAL_OUT },
                { label: 'Ingresos Efectivo (manualIn)', got: audit.manualIn, expected: EXPECTED_MANUAL_IN },
                { label: 'Total Ventas', got: audit.totalSales, expected: EXPECTED_TOTAL_SALES },
                { label: 'Presupuesto NO contado', got: audit.salesByMethod?.budget || 0, expected: 0 },
                { label: 'Items gastos detallados', got: (audit.manualOutItems?.length || 0), expected: 2 },
                { label: 'Items ingresos detallados', got: (audit.manualInItems?.length || 0), expected: 2 },
            ];

            checks.forEach(c => {
                const ok = Math.abs(c.got - c.expected) < 1;
                addLog(`${ok ? '✅' : '❌'} ${c.label}: ${fmt(c.got)} (esperado: ${fmt(c.expected)})`, ok ? 'success' : 'error');
            });

            // ── STEP 6: Close Shift ──────────────────────────────────────
            addLog('🔒 Cerrando turno (declarando monto exacto)...', 'info');
            const closeData = {
                declaredCash: audit.expectedCash,  // declaramos el exacto → diferencia $0
                leftInCash: 10000,
                expectedCash: audit.expectedCash,
                expectedDigital: audit.totalDigital
            };
            const closedShift = await cashRepository.closeShift(shift.id, closeData);
            addLog(`✅ Turno cerrado | Diferencia: ${fmt(closedShift?.difference || 0)}`, 'success');

            // ── STEP 7: Verify Snapshot ──────────────────────────────────
            addLog('🔍 Verificando auditSnapshot congelado...', 'info');
            const closedFromDB = await (await getDB()).shifts.get(shift.id);
            const snap = closedFromDB?.auditSnapshot || {};
            const snapChecks = [
                { label: 'snap.manualOut', got: snap.manualOut, expected: EXPECTED_MANUAL_OUT },
                { label: 'snap.manualIn', got: snap.manualIn, expected: EXPECTED_MANUAL_IN },
                { label: 'snap.expectedCash', got: snap.expectedCash, expected: EXPECTED_CASH },
                { label: 'snap.salesByMethod.cash', got: snap.salesByMethod?.cash, expected: 7000 },
                { label: 'snap.salesByMethod.transfer', got: snap.salesByMethod?.transfer, expected: EXPECTED_TRANSFER },
                { label: 'snap.totalSales', got: snap.totalSales, expected: EXPECTED_TOTAL_SALES },
                { label: 'snap.manualOutItems.length', got: snap.manualOutItems?.length || 0, expected: 2 },
                { label: 'snap.manualInItems.length', got: snap.manualInItems?.length || 0, expected: 2 },
            ];
            snapChecks.forEach(c => {
                const ok = Math.abs((c.got || 0) - c.expected) < 1;
                addLog(`${ok ? '✅' : '❌'} Snapshot → ${c.label}: ${fmt(c.got)} (esperado: ${fmt(c.expected)})`, ok ? 'success' : 'error');
            });

            // ── FINAL REPORT ─────────────────────────────────────────────
            const allPassed = [...checks, ...snapChecks].every(c => Math.abs((c.got || 0) - c.expected) < 1);
            const reportData = {
                shiftId: shift.id.slice(-8),
                status: allPassed ? '🟢 TODOS LOS CHECKS PASARON' : '🔴 HAY FALLOS — REVISAR',
                audit,
                snap,
                checks: [...checks, ...snapChecks],
                ticket: {
                    fondoInicial: fmt(10000),
                    ventasEfectivo: fmt(7000),
                    ventasTransferencia: fmt(EXPECTED_TRANSFER),
                    ventasSplit: 'SPLIT → EFECTIVO $2.000 + TRANSFERENCIA $2.000',
                    presupuesto: 'EXCLUÍDO (type=BUDGET)',
                    abandono: 'EXCLUÍDO (status=ABANDONED)',
                    ingresoCobroDeuda: fmt(1000),
                    ingresoAjuste: fmt(700),
                    totalIngresos: fmt(EXPECTED_MANUAL_IN),
                    gastoInsumos: fmt(500),
                    retiroBanco: fmt(300),
                    totalGastosRetiros: fmt(EXPECTED_MANUAL_OUT),
                    teoricoCaja: fmt(EXPECTED_CASH),
                    declarado: fmt(audit.expectedCash),
                    diferencia: fmt(0),
                }
            };
            setReport(reportData);
            addLog(allPassed ? '🏆 QA COMPLETO — SISTEMA OK' : '⛔ QA COMPLETO — HAY ERRORES', allPassed ? 'success' : 'error');

        } catch (err) {
            addLog(`❌ ERROR FATAL: ${err.message}`, 'error');
            console.error(err);
        } finally {
            setRunning(false);
        }
    };

    return (
        <div style={{ fontFamily: 'monospace', padding: 24, background: '#0f172a', minHeight: '100vh', color: '#e2e8f0' }}>
            <div style={{ maxWidth: 900, margin: '0 auto' }}>
                <h1 style={{ fontSize: 22, fontWeight: 900, color: '#38bdf8', marginBottom: 8 }}>
                    🧪 QA Test Runner — NOAR POS
                </h1>
                <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 24 }}>
                    Prueba completa: Efectivo · Transferencia · SPLIT · Presupuesto · Abandono · Gasto · Retiro · Cierre Z
                </p>

                <button
                    onClick={runQA}
                    disabled={running}
                    style={{
                        background: running ? '#475569' : '#0ea5e9',
                        color: 'white', border: 'none', padding: '12px 32px',
                        borderRadius: 8, fontWeight: 900, fontSize: 14,
                        cursor: running ? 'not-allowed' : 'pointer', marginBottom: 24
                    }}
                >
                    {running ? '⏳ Ejecutando...' : '▶ EJECUTAR QA COMPLETO'}
                </button>

                {/* LOGS */}
                {logs.length > 0 && (
                    <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, marginBottom: 24, maxHeight: 400, overflowY: 'auto' }}>
                        {logs.map((l, i) => (
                            <div key={i} style={{
                                fontSize: 13, padding: '3px 0',
                                color: l.type === 'success' ? '#4ade80' : l.type === 'error' ? '#f87171' : '#94a3b8'
                            }}>
                                <span style={{ color: '#475569', marginRight: 8 }}>[{l.time}]</span>
                                {l.msg}
                            </div>
                        ))}
                    </div>
                )}

                {/* REPORT */}
                {report && (
                    <div style={{ background: '#1e293b', borderRadius: 12, padding: 24 }}>
                        <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 16, color: '#f8fafc' }}>
                            📋 Reporte Final — Turno #{report.shiftId}
                        </h2>
                        <div style={{
                            background: report.status.startsWith('🟢') ? '#14532d' : '#7f1d1d',
                            padding: 12, borderRadius: 8, marginBottom: 20,
                            fontWeight: 900, fontSize: 14, textAlign: 'center'
                        }}>
                            {report.status}
                        </div>

                        {/* Ticket Z Summary */}
                        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8', marginBottom: 8, borderBottom: '1px solid #334155', paddingBottom: 4 }}>
                            🎫 TICKET Z SIMULADO
                        </h3>
                        <div style={{ fontSize: 12, lineHeight: 2 }}>
                            {Object.entries(report.ticket).map(([k, v]) => (
                                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #334155' }}>
                                    <span style={{ color: '#94a3b8', textTransform: 'uppercase', fontSize: 11 }}>{k.replace(/([A-Z])/g, ' $1')}</span>
                                    <span style={{ fontWeight: 700, color: '#e2e8f0' }}>{v}</span>
                                </div>
                            ))}
                        </div>

                        {/* Checks Table */}
                        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8', margin: '20px 0 8px', borderBottom: '1px solid #334155', paddingBottom: 4 }}>
                            ✅ VERIFICACIONES
                        </h3>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ color: '#64748b', textAlign: 'left' }}>
                                    <th style={{ padding: '4px 8px' }}>Campo</th>
                                    <th style={{ padding: '4px 8px', textAlign: 'right' }}>Esperado</th>
                                    <th style={{ padding: '4px 8px', textAlign: 'right' }}>Obtenido</th>
                                    <th style={{ padding: '4px 8px', textAlign: 'center' }}>Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.checks.map((c, i) => {
                                    const ok = Math.abs((c.got || 0) - c.expected) < 1;
                                    return (
                                        <tr key={i} style={{ borderTop: '1px solid #1e293b', background: ok ? 'transparent' : '#450a0a' }}>
                                            <td style={{ padding: '4px 8px', color: '#94a3b8' }}>{c.label}</td>
                                            <td style={{ padding: '4px 8px', textAlign: 'right', color: '#64748b' }}>{fmt(c.expected)}</td>
                                            <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700 }}>{fmt(c.got)}</td>
                                            <td style={{ padding: '4px 8px', textAlign: 'center' }}>{ok ? '✅' : '❌'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};
