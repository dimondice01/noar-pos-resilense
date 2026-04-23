import { useState, useEffect, useRef } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { getDB } from '../../../database/db'; // 🔥 IMPORTANTE: Usamos Dexie para el cruce rápido de Stock
import { useAuthStore } from '../../auth/store/useAuthStore';
import { salesRepository } from '../../sales/repositories/salesRepository'; // 🔥 SINCRONIZADOR DE BAJADA

export const useCloudDashboard = () => {
    const { user, activeBranchId } = useAuthStore();
    
    // Referencia para evitar actualizaciones en componente desmontado
    const isMounted = useRef(true);
    const syncBuffer = useRef([]);
    const syncTimeout = useRef(null);

    const [stats, setStats] = useState({
        totalSales: 0,
        count: 0,
        averageTicket: 0,
        cashTotal: 0,
        digitalTotal: 0,
        expenseTotal: 0, 
        fiscalCount: 0,
        recentSales: [],
        topProducts: [],
        pendingShifts: [], 
        activeShiftsCount: 0,
        
        // 🔥 SPRINT 6: Nuevas Métricas Enterprise
        netProfit: 0,
        marginPercentage: 0,
        clientDebt: 0,
        supplierDebt: 0,
        lowStockItems: [],
        
        // 🔥 AUDITORÍA NEXUS
        abandonedSales: [],
        abandonedCount: 0,
        
        loading: true
    });

    useEffect(() => {
        isMounted.current = true;
        
        // Si no hay usuario, cortamos aquí
        if (!user || !user.companyId) {
            if (isMounted.current) setStats(prev => ({ ...prev, loading: false }));
            return;
        }

        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);

        const companyPath = `companies/${user.companyId}`;
        
        // Referencias a Colecciones
        const salesRef = collection(db, companyPath, 'sales');
        const shiftsRef = collection(db, companyPath, 'shifts');
        const movementsRef = collection(db, companyPath, 'cash_movements');
        const clientsRef = collection(db, companyPath, 'clients');     // 🔥 SPRINT 6
        const suppliersRef = collection(db, companyPath, 'suppliers'); // 🔥 SPRINT 6

        // ==========================================
        // 1. MONITOR DE VENTAS Y RENTABILIDAD
        // ==========================================
        let salesQ = query(
            salesRef,
            where('date', '>=', start.toISOString()),
            where('date', '<=', end.toISOString())
        );
        if (activeBranchId && activeBranchId !== 'ALL') {
            salesQ = query(salesQ, where('branchId', '==', activeBranchId));
        }

        const unsubSales = onSnapshot(salesQ, (snapshot) => {
            if (!isMounted.current) return;

            let total = 0;
            let cash = 0;
            let digital = 0;
            let fiscal = 0;
            let grossProfit = 0; // 🔥 SPRINT 6: Utilidad Bruta (Ventas - Costos)
            let rawSales = [];
            const productMap = {};

            snapshot.forEach((doc) => {
                const data = doc.data();
                
                const sType = (data.type || '').toUpperCase();
                const sStatus = (data.status || '').toUpperCase();

                // Ignorar presupuestos, internos, cancelados y abandonados
                if (sType === 'BUDGET' || sType === 'INTERNAL') return;
                if (sStatus === 'CANCELLED' || sStatus === 'ABANDONED') return;

                const saleTotal = parseFloat(data.total || 0);
                total += saleTotal;
                
                // 🔥 SPRINT 6: Sumamos la ganancia neta guardada en la venta (Utilidad)
                grossProfit += parseFloat(data.netProfit || 0);

                // Soporte Split Payments (Blindado)
                if (data.payments && Array.isArray(data.payments)) {
                    data.payments.forEach(p => {
                        const amount = parseFloat(p.amount || 0);
                        const pMethod = String(p.method || 'cash').toLowerCase().trim();
                        
                        if (pMethod === 'cash' || pMethod === 'efectivo') {
                            cash += amount;
                        } else if (!['account', 'employee_account', 'budget', 'debt', 'current_account'].includes(pMethod)) {
                            digital += amount;
                        }
                    });
                } else {
                    // Soporte Legacy
                    const method = String(data.payment?.method || data.method || 'CASH').toLowerCase().trim();
                    const isCash = method === 'cash' || method === 'efectivo';
                    const amount = parseFloat(data.payment?.amountPaid || saleTotal);
                    
                    if (isCash) {
                        cash += amount;
                    } else if (!['account', 'employee_account', 'budget', 'debt', 'current_account'].includes(method)) {
                        digital += amount;
                    }
                }

                if (data.afip?.status === 'APPROVED') fiscal++;

                rawSales.push({
                    id: doc.id,
                    number: data.number || `V-${doc.id.slice(-4)}`,
                    date: data.date,
                    time: new Date(data.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    total: saleTotal,
                    // 🔥 Leer data.method directamente, no inferir por la existencia de payments[]
                    method: (data.method === 'SPLIT' ? 'COMBINADO' : (data.method || data.payment?.method || 'CASH')).toUpperCase(),
                    branchId: data.branchId
                });

                if (data.items) {
                    data.items.forEach(item => {
                        productMap[item.name] = (productMap[item.name] || 0) + parseFloat(item.quantity || 1);
                    });
                }
            });

            // Ordenamiento en memoria
            rawSales.sort((a, b) => new Date(b.date) - new Date(a.date));
            const recentSales = rawSales.slice(0, 10);

            const sortedProducts = Object.entries(productMap)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5)
                .map(([name, quantity]) => ({ name, quantity }));

            // 🔥 SINCRONIZACIÓN DE BAJADA DEBENZED (CLOUD -> LOCAL)
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added' || change.type === 'modified') {
                    syncBuffer.current.push({ id: change.doc.id, ...change.doc.data() });
                }
            });

            if (syncTimeout.current) clearTimeout(syncTimeout.current);
            syncTimeout.current = setTimeout(async () => {
                if (syncBuffer.current.length > 0) {
                    const batch = [...syncBuffer.current];
                    syncBuffer.current = [];
                    for (const sale of batch) {
                        try {
                            await salesRepository.saveFromCloud(sale);
                        } catch (e) {}
                    }
                }
            }, 2000);

            setStats(prev => {
                const totalExpenses = prev.expenseTotal || 0;
                const dailyNetProfit = grossProfit - totalExpenses;
                const marginPercentage = total > 0 ? Math.round((dailyNetProfit / total) * 100) : 0;
                
                return {
                    ...prev,
                    totalSales: total,
                    count: snapshot.size,
                    averageTicket: snapshot.size > 0 ? total / snapshot.size : 0,
                    cashTotal: cash,
                    digitalTotal: digital,
                    fiscalCount: fiscal,
                    recentSales: recentSales,
                    topProducts: sortedProducts,
                    grossProfit: grossProfit, 
                    netProfit: dailyNetProfit,
                    marginPercentage: marginPercentage,
                    loading: false
                };
            });
        }, (err) => console.warn("Sales Sync Error:", err.code));

        // ==========================================
        // 1.1 MONITOR DE SINIESTROS (SOLO ADMIN/OWNER) 🚨
        // ==========================================
        let unsubAbandoned = null;
        if (user.role === 'ADMIN' || user.role === 'OWNER') {
            let abandonedQ = query(
                salesRef,
                where('status', '==', 'ABANDONED'),
                where('date', '>=', start.toISOString())
            );
            if (activeBranchId && activeBranchId !== 'ALL') {
                abandonedQ = query(abandonedQ, where('branchId', '==', activeBranchId));
            }

            unsubAbandoned = onSnapshot(abandonedQ, (snapshot) => {
                if (!isMounted.current) return;
                const abandoned = snapshot.docs
                    .map(doc => ({ id: doc.id, ...doc.data() }))
                    .sort((a, b) => new Date(b.date) - new Date(a.date));

                setStats(prev => ({ 
                    ...prev, 
                    abandonedSales: abandoned,
                    abandonedCount: abandoned.length 
                    // No recalculamos margen aquí ya que las ventas abandonadas no afectan ingresos
                }));
            });
        }

        // ==========================================
        // 2. MONITOR DE EGRESOS OPERATIVOS
        // ==========================================
        const movementsQ = query(
            movementsRef,
            where('date', '>=', start.toISOString()),
            where('date', '<=', end.toISOString())
        );

        const unsubMovements = onSnapshot(movementsQ, (snapshot) => {
            if (!isMounted.current) return;
            let expenses = 0;
            
            snapshot.forEach(doc => {
                const d = doc.data();
                if (activeBranchId && activeBranchId !== 'ALL' && d.branchId !== activeBranchId) return;

                if (d.type === 'EXPENSE' || d.type === 'WITHDRAWAL' || d.type === 'PURCHASE') {
                    // Ignoramos retiros de cierre para no inflar los "Gastos Operativos" en el Dashboard
                    if (d.subtype === 'CLOSING' || (d.description && d.description.toLowerCase().includes('rendición de cierre'))) return;
                    expenses += parseFloat(d.amount || 0);
                }
            });
            
            setStats(prev => {
                const net = (prev.grossProfit || 0) - expenses;
                const margin = prev.totalSales > 0 ? Math.round((net / prev.totalSales) * 100) : 0;
                return { 
                    ...prev, 
                    expenseTotal: expenses,
                    netProfit: net,
                    marginPercentage: margin
                };
            });
        }, (err) => console.warn("Movements Sync Error:", err.code));

        // ==========================================
        // 3. MONITOR DE CAJAS PENDIENTES
        // ==========================================
        const shiftsQ = query(
            shiftsRef,
            where('status', '==', 'CLOSED'),
            where('audited', '==', false)
        );

        const unsubShifts = onSnapshot(shiftsQ, (snapshot) => {
            if (!isMounted.current) return;
            
            const pending = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(doc => {
                    if (activeBranchId && activeBranchId !== 'ALL') return doc.branchId === activeBranchId;
                    return true;
                })
                .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))
                .slice(0, 10);
            
            setStats(prev => ({ ...prev, pendingShifts: pending }));
        }, (err) => console.warn("Shifts Sync Error:", err.code));

        // ==========================================
        // 4. MONITOR DE CAJAS ACTIVAS
        // ==========================================
        const activeShiftsQ = query(shiftsRef, where('status', '==', 'OPEN'));

        const unsubActiveShifts = onSnapshot(activeShiftsQ, (snapshot) => {
            if (!isMounted.current) return;

            let count = 0;
            snapshot.forEach(doc => {
                const d = doc.data();
                if (activeBranchId && activeBranchId !== 'ALL' && d.branchId !== activeBranchId) return;
                count++;
            });

            setStats(prev => ({ ...prev, activeShiftsCount: count }));
        }, (err) => console.warn("Active Shifts Sync Error:", err.code));

        // ==========================================
        // 5. FINANZAS EN CALLE (CLIENTES Y PROVEEDORES) 🔥 SPRINT 6
        // ==========================================
        const unsubClients = onSnapshot(clientsRef, (snapshot) => {
            if (!isMounted.current) return;
            let clientDebt = 0;
            snapshot.forEach(doc => {
                const bal = parseFloat(doc.data().balance || 0);
                if (bal > 0) clientDebt += bal;
            });
            setStats(prev => ({ ...prev, clientDebt }));
        }, (err) => console.warn("Clients Sync Error:", err.code));

        const unsubSuppliers = onSnapshot(suppliersRef, (snapshot) => {
            if (!isMounted.current) return;
            let supplierDebt = 0;
            snapshot.forEach(doc => {
                const bal = parseFloat(doc.data().balance || 0);
                if (bal > 0) supplierDebt += bal;
            });
            setStats(prev => ({ ...prev, supplierDebt }));
        }, (err) => console.warn("Suppliers Sync Error:", err.code));

        // ==========================================
        // 6. ALERTAS DE STOCK CRÍTICO (MAGIA LOCAL DEXIE) 🔥 SPRINT 6
        // ==========================================
        const checkLowStock = async () => {
            try {
                const localDb = await getDB();

                // Carga productos e inventario en 2 queries planas en lugar de 1 por producto
                const [products, allInventory] = await Promise.all([
                    localDb.products.filter(p => !p.deleted).toArray(),
                    activeBranchId && activeBranchId !== 'ALL'
                        ? localDb.inventory.where('branchId').equals(activeBranchId).toArray()
                        : localDb.inventory.toArray()
                ]);

                // Índice plano: productId → stock total
                const stockIndex = {};
                for (const inv of allInventory) {
                    stockIndex[inv.productId] = (stockIndex[inv.productId] || 0) + parseFloat(inv.stock || 0);
                }

                const lowStock = [];
                for (const p of products) {
                    const totalStock = stockIndex[p.id] || 0;
                    const minStock = parseFloat(p.minStock || 5);
                    if (totalStock <= minStock) {
                        lowStock.push({ name: p.name, stock: totalStock });
                    }
                }

                lowStock.sort((a, b) => a.stock - b.stock);
                if (isMounted.current) {
                    setStats(prev => ({ ...prev, lowStockItems: lowStock.slice(0, 30) }));
                }
            } catch (e) {
                console.warn("Error evaluando stock crítico:", e);
            }
        };

        checkLowStock();
        // Refrescar cada 2 minutos por si hay ventas que bajen el stock
        const stockInterval = setInterval(checkLowStock, 120000);

        // 🔥 CLEANUP FUNCTION
        return () => {
            isMounted.current = false;
            if (unsubSales) unsubSales();
            if (unsubMovements) unsubMovements();
            if (unsubShifts) unsubShifts();
            if (unsubActiveShifts) unsubActiveShifts();
            if (unsubClients) unsubClients();
            if (unsubSuppliers) unsubSuppliers();
            if (unsubAbandoned) unsubAbandoned();
            if (syncTimeout.current) clearTimeout(syncTimeout.current);
            clearInterval(stockInterval);
        };

    }, [user?.companyId, activeBranchId]); 

    return stats;
};