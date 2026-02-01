import { useState, useEffect, useRef } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { useAuthStore } from '../../auth/store/useAuthStore';

export const useCloudDashboard = () => {
    const { user, activeBranchId } = useAuthStore();
    
    // Referencia para evitar actualizaciones en componente desmontado
    const isMounted = useRef(true);

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

        // ==========================================
        // 1. MONITOR DE VENTAS
        // ==========================================
        // Consultamos solo por fecha para evitar índices complejos
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
            let rawSales = [];
            const productMap = {}; 

            snapshot.forEach((doc) => {
                const data = doc.data();
                
                // 🛡️ FILTRO CLIENT-SIDE: Sucursal
                if (activeBranchId && activeBranchId !== 'ALL' && data.branchId !== activeBranchId) return;
                
                if (data.status === 'CANCELLED') return;

                const saleTotal = parseFloat(data.total || 0);
                total += saleTotal;

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
                    method: data.payments ? 'COMBINADO' : (data.payment?.method || data.method || 'CASH').toUpperCase(),
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
                loading: false
            }));
        }, (err) => console.warn("Sales Sync Error:", err.code));

        // ==========================================
        // 2. MONITOR DE EGRESOS (FIX: failed-precondition)
        // ==========================================
        // 🔥 FIX: Quitamos el filtro de branchId de la query de Firestore
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
                
                // 🛡️ FILTRO CLIENT-SIDE: Sucursal (Aquí filtramos manualmente)
                if (activeBranchId && activeBranchId !== 'ALL' && d.branchId !== activeBranchId) return;

                // Sumamos EXPENSE, WITHDRAWAL y PURCHASE
                if (d.type === 'EXPENSE' || d.type === 'WITHDRAWAL' || d.type === 'PURCHASE') {
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
            
            // Filtramos y ordenamos en memoria
            const pending = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(doc => {
                    // 🛡️ FILTRO CLIENT-SIDE
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
                // 🛡️ FILTRO CLIENT-SIDE
                if (activeBranchId && activeBranchId !== 'ALL' && d.branchId !== activeBranchId) return;
                count++;
            });

            setStats(prev => ({ ...prev, activeShiftsCount: count }));
        }, (err) => console.warn("Active Shifts Sync Error:", err.code));

        // 🔥 CLEANUP FUNCTION
        return () => {
            isMounted.current = false;
            if (unsubSales) unsubSales();
            if (unsubMovements) unsubMovements();
            if (unsubShifts) unsubShifts();
            if (unsubActiveShifts) unsubActiveShifts();
        };

    }, [user?.companyId, activeBranchId]); 

    return stats;
};