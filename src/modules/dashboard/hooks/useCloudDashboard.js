import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../../database/firebase';

export const useCloudDashboard = () => {
    const [stats, setStats] = useState({
        totalSales: 0,
        count: 0,
        averageTicket: 0, // 💰 NUEVO
        cashTotal: 0,
        digitalTotal: 0,
        fiscalCount: 0,
        recentSales: [],
        topProducts: [], // 🏆 NUEVO
        loading: true
    });

    useEffect(() => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);

        const q = query(
            collection(db, 'sales'),
            where('date', '>=', start.toISOString()),
            where('date', '<=', end.toISOString()),
            orderBy('date', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            let total = 0;
            let cash = 0;
            let digital = 0;
            let fiscal = 0;
            const salesData = [];
            const productMap = {}; // Para contar productos

            snapshot.forEach((doc) => {
                const data = doc.data();
                const saleTotal = parseFloat(data.total || 0);
                
                total += saleTotal;

                // Métodos
                const paymentMethod = (data.payment?.method || '').toUpperCase();
                if (paymentMethod === 'CASH' || paymentMethod === 'EFECTIVO') {
                    cash += parseFloat(data.payment.amountPaid || 0);
                } else {
                    digital += parseFloat(data.payment.amountPaid || 0);
                }

                // Fiscal
                if (data.afip?.status === 'APPROVED') fiscal++;

                // Lista Reciente (Max 5)
                if (salesData.length < 5) {
                    salesData.push({
                        id: doc.id,
                        time: new Date(data.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        total: saleTotal,
                        items: data.itemCount || 0,
                        method: data.payment?.method
                    });
                }

                // 🏆 LOGICA TOP PRODUCTOS
                if (data.items && Array.isArray(data.items)) {
                    data.items.forEach(item => {
                        const name = item.name;
                        const qty = parseFloat(item.quantity || 0);
                        if (productMap[name]) {
                            productMap[name] += qty;
                        } else {
                            productMap[name] = qty;
                        }
                    });
                }
            });

            // Ordenar Top Productos (Top 5)
            const sortedProducts = Object.entries(productMap)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5)
                .map(([name, quantity]) => ({ name, quantity }));

            setStats({
                totalSales: total,
                count: snapshot.size,
                averageTicket: snapshot.size > 0 ? total / snapshot.size : 0, // 💰 Cálculo
                cashTotal: cash,
                digitalTotal: digital,
                fiscalCount: fiscal,
                recentSales: salesData,
                topProducts: sortedProducts, // 🏆 Guardar
                loading: false
            });
        }, (error) => {
            console.error("Error Dashboard RealTime:", error);
            setStats(prev => ({ ...prev, loading: false }));
        });

        return () => unsubscribe();
    }, []);

    return stats;
};