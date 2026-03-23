import { db } from '../../../database/firebase';
import { collection, getDocs, doc, updateDoc, query, orderBy } from 'firebase/firestore';

export const saasRepository = {
    // Obtener todas las empresas registradas por Valeria
    async getAllCompanies() {
        const q = query(collection(db, 'companies'), orderBy('createdAt', 'desc'));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    // Actualizar suscripción o PIN desde el Dashboard
    async updateCompanyData(companyId, data) {
        const docRef = doc(db, 'companies', companyId);
        await updateDoc(docRef, {
            ...data,
            updatedAt: new Date().toISOString()
        });
    }
};