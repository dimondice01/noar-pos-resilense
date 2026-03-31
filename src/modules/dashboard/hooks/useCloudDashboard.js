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
        const salesQ = query(
            salesRef,
            where('date', '>=', start.toISOString()),
            where('date', '<=', end.toISOString())
        );

        const unsubSales = onSnapshot(salesQ, (snapshot) => {
            if (!isMounted.current) return;

            let total = 0;
            let cash = 0;
            let digital = 0;
            let fiscal = 0;
            let netProfit = 0; // 🔥 SPRINT 6: Ganancia Neta
            let rawSales = [];
            const productMap = {}; 

            snapshot.forEach((doc) => {
                const data = doc.data();
                
                // 🛡️ FILTRO CLIENT-SIDE: Sucursal
                if (activeBranchId && activeBranchId !== 'ALL' && data.branchId !== activeBranchId) return;
                if (data.status === 'CANCELLED' || data.status === 'ABANDONED') return;

                const saleTotal = parseFloat(data.total || 0);
                total += saleTotal;
                
                // 🔥 SPRINT 6: Sumamos la ganancia neta guardada en la venta
                netProfit += parseFloat(data.netProfit || 0);

                // Soporte Split Payments
                if (data.payments && Array.isArray(data.payments)) {
                    data.payments.forEach(p => {
                        const amount = parseFloat(p.amount || 0);
                        if (p.method === 'cash') cash += amount;
                        else digital += amount;
                    });
                } else {
                    // Soporte Legacy
                    const method = (data.payment?.method || data.method || 'CASH').toUpperCase();
                    const isCash = method === 'CASH' || method === 'EFECTIVO';
                    const amount = parseFloat(data.payment?.amountPaid || saleTotal);
                    if (isCash) cash += amount;
                    else digital += amount;
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

            // 🔥 SPRINT 6: Cálculo de Margen Operativo (%)
            const marginPercentage = total > 0 ? Math.round((netProfit / total) * 100) : 0;

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
                        await salesRepository.saveFromCloud(sale);
                    }
                }
            }, 2000);

            setStats(prev => ({
                ...prev,
                totalSales: total,
                count: snapshot.size,
                averageTicket: snapshot.size > 0 ? total / snapshot.size : 0,
                cashTotal: cash,
                digitalTotal: digital,
                fiscalCount: fiscal,
                recentSales: recentSales,
                topProducts: sortedProducts,
                netProfit: netProfit,               // 🔥 SPRINT 6
                marginPercentage: marginPercentage, // 🔥 SPRINT 6
                loading: false
            }));
        }, (err) => console.warn("Sales Sync Error:", err.code));

        // ==========================================
        // 1.1 MONITOR DE SINIESTROS (SOLO ADMIN/OWNER) 🚨
        // ==========================================
        let unsubAbandoned = null;
        if (user.role === 'ADMIN' || user.role === 'OWNER') {
            const abandonedQ = query(
                salesRef,
                where('status', '==', 'ABANDONED'),
                where('date', '>=', start.toISOString())
            );

            unsubAbandoned = onSnapshot(abandonedQ, (snapshot) => {
                if (!isMounted.current) return;
                const abandoned = snapshot.docs
                    .map(doc => ({ id: doc.id, ...doc.data() }))
                    .filter(d => {
                        if (activeBranchId && activeBranchId !== 'ALL') return d.branchId === activeBranchId;
                        return true;
                    })
                    .sort((a, b) => new Date(b.date) - new Date(a.date));

                setStats(prev => ({ 
                    ...prev, 
                    abandonedSales: abandoned,
                    abandonedCount: abandoned.length 
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
            
            setStats(prev => ({ ...prev, expenseTotal: expenses }));
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
                const products = await localDb.products.filter(p => !p.deleted).toArray();
                const lowStock = [];
                
                for (const p of products) {
                    let totalStock = 0;
                    if (activeBranchId && activeBranchId !== 'ALL') {
                        const inv = await localDb.inventory.get([activeBranchId, p.id]);
                        totalStock = inv ? parseFloat(inv.stock) : 0;
                    } else {
                        const invs = await localDb.inventory.where('productId').equals(p.id).toArray();
                        totalStock = invs.reduce((acc, curr) => acc + parseFloat(curr.stock || 0), 0);
                    }
                    
                    const minStock = parseFloat(p.minStock || 5); // Por defecto alerta si es menor o igual a 5
                    if (totalStock <= minStock) {
                        lowStock.push({ name: p.name, stock: totalStock });
                    }
                }
                
                lowStock.sort((a, b) => a.stock - b.stock); // Los más críticos primero
                if (isMounted.current) {
                    setStats(prev => ({ ...prev, lowStockItems: lowStock.slice(0, 30) })); // Guardamos los 30 más críticos
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
            if (unsubClients) unsubClients();     // 🔥 SPRINT 6
            if (unsubSuppliers) unsubSuppliers(); // 🔥 SPRINT 6
            if (unsubAbandoned) unsubAbandoned(); // 🔥 SINIESTROS
            clearInterval(stockInterval);         // 🔥 SPRINT 6
        };

    }, [user?.companyId, activeBranchId]); 

    return stats;
};