import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { useAuthStore } from '../../auth/store/useAuthStore'; // 👈 IMPORTANTE

export const useCloudDashboard = () => {
    // 1. Traemos el usuario para saber el ID de la empresa
    const { user } = useAuthStore();

    const [stats, setStats] = useState({
        totalSales: 0,
        count: 0,
        averageTicket: 0,
        cashTotal: 0,
        digitalTotal: 0,
        fiscalCount: 0,
        recentSales: [],
        topProducts: [],
        loading: true
    });

    useEffect(() => {
        // 2. Validación de Seguridad: Si no hay empresa, no consultamos nada
        if (!user || !user.companyId) {
            setStats(prev => ({ ...prev, loading: false }));
            return;
        }

        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);

        // 3. 🔥 LA CORRECCIÓN CLAVE: Apuntar a la subcolección de la empresa
        const salesRef = collection(db, 'companies', user.companyId, 'sales');

        const q = query(
            salesRef, // Usamos la referencia SaaS
            where('date', '>=', start.toISOString()),
            where('date', '<=', end.toISOString()),
            orderBy('date', 'desc')
        );

        console.log(`📡 Escuchando ventas en vivo para: ${user.companyId}`);

        const unsubscribe = onSnapshot(q, (snapshot) => {
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

                // Métodos
                // Ajuste: A veces viene como 'cash', a veces 'EFECTIVO'. Normalizamos.
                const paymentMethod = (data.payment?.method || data.method || '').toUpperCase();
                
                if (paymentMethod === 'CASH' || paymentMethod === 'EFECTIVO' || paymentMethod === 'EFVO') {
                    cash += parseFloat(data.payment?.amountPaid || saleTotal); // Fallback a total si no hay amountPaid
                } else {
                    digital += parseFloat(data.payment?.amountPaid || saleTotal);
                }

                // Fiscal
                if (data.afip?.status === 'APPROVED') fiscal++;

                // Lista Reciente (Max 10 para que se vea más lleno)
                if (salesData.length < 10) {
                    salesData.push({
                        id: doc.id,
                        time: new Date(data.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        total: saleTotal,
                        items: data.items?.length || data.itemCount || 0,
                        method: paymentMethod
                    });
                }

                // 🏆 LOGICA TOP PRODUCTOS
                if (data.items && Array.isArray(data.items)) {
                    data.items.forEach(item => {
                        const name = item.name;
                        const qty = parseFloat(item.quantity || 1);
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
                averageTicket: snapshot.size > 0 ? total / snapshot.size : 0,
                cashTotal: cash,
                digitalTotal: digital,
                fiscalCount: fiscal,
                recentSales: salesData,
                topProducts: sortedProducts,
                loading: false
            });
        }, (error) => {
            // Si da error de permisos, es probable que la regla de Firestore tarde un seg en propagarse
            console.error("Error Dashboard RealTime:", error);
            setStats(prev => ({ ...prev, loading: false }));
        });

        return () => unsubscribe();
    }, [user?.companyId]); // 4. Se reinicia si cambia la empresa

    return stats;
};