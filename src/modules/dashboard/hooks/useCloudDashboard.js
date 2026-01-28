import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { useAuthStore } from '../../auth/store/useAuthStore';

export const useCloudDashboard = () => {
    const { user, activeBranchId } = useAuthStore();

    const [stats, setStats] = useState({
        totalSales: 0,
        count: 0,
        averageTicket: 0,
        cashTotal: 0,
        digitalTotal: 0,
        fiscalCount: 0,
        recentSales: [],
        topProducts: [],
        pendingShifts: [], // 🔥 NUEVO: Cajas por auditar
        loading: true
    });

    useEffect(() => {
        if (!user || !user.companyId) {
            setStats(prev => ({ ...prev, loading: false }));
            return;
        }

        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);

        // --- 1. LISTENER DE VENTAS (HOY) ---
        const salesRef = collection(db, 'companies', user.companyId, 'sales');
        
        // Query base: Ventas de hoy
        let salesQ = query(
            salesRef,
            where('date', '>=', start.toISOString()),
            where('date', '<=', end.toISOString()),
            orderBy('date', 'desc')
        );

        // Filtrar por sucursal si hay una seleccionada
        if (activeBranchId) {
            salesQ = query(salesQ, where('branchId', '==', activeBranchId));
        }

        const unsubSales = onSnapshot(salesQ, (snapshot) => {
            let total = 0;
            let cash = 0;
            let digital = 0;
            let fiscal = 0;
            const salesData = [];
            const productMap = {}; 

            snapshot.forEach((doc) => {
                const data = doc.data();
                const saleTotal = parseFloat(data.total || 0);
                
                total += saleTotal;

                // Métodos de Pago
                const paymentMethod = (data.payment?.method || data.method || '').toUpperCase();
                if (paymentMethod === 'CASH' || paymentMethod === 'EFECTIVO') {
                    cash += parseFloat(data.payment?.amountPaid || saleTotal);
                } else {
                    digital += parseFloat(data.payment?.amountPaid || saleTotal);
                }

                if (data.afip?.status === 'APPROVED') fiscal++;

                if (salesData.length < 10) {
                    salesData.push({
                        id: doc.id,
                        number: data.number || `V-${doc.id.slice(-4)}`, // Mostrar número real
                        time: new Date(data.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        total: saleTotal,
                        method: paymentMethod,
                        branchId: data.branchId
                    });
                }

                // Top Productos
                if (data.items && Array.isArray(data.items)) {
                    data.items.forEach(item => {
                        const name = item.name;
                        const qty = parseFloat(item.quantity || 1);
                        productMap[name] = (productMap[name] || 0) + qty;
                    });
                }
            });

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
                recentSales: salesData,
                topProducts: sortedProducts,
                loading: false
            }));
        }, (err) => console.error("Error sales stream:", err));

        // --- 2. LISTENER DE CAJAS PENDIENTES (SHIFTS) ---
        const shiftsRef = collection(db, 'companies', user.companyId, 'shifts');
        
        // Buscamos cajas CERRADAS pero NO AUDITADAS (audited: false)
        // Opcional: Filtrar por sucursal también
        let shiftsQ = query(
            shiftsRef,
            where('status', '==', 'CLOSED'),
            where('audited', '==', false),
            orderBy('closedAt', 'desc'),
            limit(10) // Solo las últimas 10 pendientes para no saturar
        );

        if (activeBranchId) {
            shiftsQ = query(shiftsQ, where('branchId', '==', activeBranchId));
        }

        const unsubShifts = onSnapshot(shiftsQ, (snapshot) => {
            const pending = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setStats(prev => ({ ...prev, pendingShifts: pending }));
        }, (err) => console.error("Error shifts stream:", err));

        return () => {
            unsubSales();
            unsubShifts();
        };
    }, [user?.companyId, activeBranchId]); // Se recarga al cambiar sucursal

    return stats;
};