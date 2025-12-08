import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../../../database/firebase';

export const useCloudDashboard = () => {
    const [stats, setStats] = useState({
        totalSales: 0,
        count: 0,
        cashTotal: 0,
        digitalTotal: 0,
        recentSales: [],
        loading: true
    });

    useEffect(() => {
        // 1. Definir rango de HOY
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        
        const end = new Date();
        end.setHours(23, 59, 59, 999);

        // 2. Query a Firestore (Ventas de hoy)
        // Nota: Asegúrate de tener un índice compuesto en Firestore si te lo pide la consola
        const q = query(
            collection(db, 'sales'),
            where('date', '>=', start.toISOString()),
            where('date', '<=', end.toISOString()),
            orderBy('date', 'desc') // Para ver las últimas primero
        );

        // 3. Suscripción REAL-TIME (Websockets)
        const unsubscribe = onSnapshot(q, (snapshot) => {
            let total = 0;
            let cash = 0;
            let digital = 0;
            const salesData = [];

            snapshot.forEach((doc) => {
                const data = doc.data();
                const saleTotal = parseFloat(data.total || 0);
                
                total += saleTotal;

                // Desglose por método (Asumiendo estructura payment.method)
                if (data.payment?.method === 'CASH') {
                    cash += parseFloat(data.payment.amountPaid || 0);
                } else {
                    digital += parseFloat(data.payment.amountPaid || 0);
                }

                // Guardamos las ventas para la lista (solo las primeras 5 para no saturar memoria en dashboard)
                if (salesData.length < 5) {
                    salesData.push({
                        id: doc.id,
                        time: new Date(data.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        total: saleTotal,
                        items: data.itemCount || 0,
                        method: data.payment?.method
                    });
                }
            });

            setStats({
                totalSales: total,
                count: snapshot.size,
                cashTotal: cash,
                digitalTotal: digital,
                recentSales: salesData,
                loading: false
            });
        }, (error) => {
            console.error("Error Dashboard RealTime:", error);
            setStats(prev => ({ ...prev, loading: false }));
        });

        // Limpieza al desmontar
        return () => unsubscribe();
    }, []);

    return stats;
};