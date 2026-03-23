import React, { useEffect, useState } from 'react';
import { ShieldCheck, Search, CreditCard, Calendar, CheckCircle2, AlertCircle, RefreshCcw, DollarSign } from 'lucide-react';
import { collection, getDocs, query, orderBy, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import toast from 'react-hot-toast';

export const SaasAdminDashboard = () => {
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');

    const loadCompanies = async () => {
        setLoading(true);
        try {
            const q = query(collection(db, 'companies'), orderBy('createdAt', 'desc'));
            const snap = await getDocs(q);
            setCompanies(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        } catch (e) {
            toast.error("Error al leer empresas");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadCompanies(); }, []);

    const updateSubscription = async (id, days) => {
        const newDate = new Date();
        newDate.setDate(newDate.getDate() + days);
        try {
            const docRef = doc(db, 'companies', id);
            await updateDoc(docRef, {
                expiryDate: newDate.toISOString(),
                subscriptionStatus: 'ACTIVE',
                updatedAt: new Date().toISOString()
            });
            toast.success("Suscripción extendida");
            loadCompanies();
        } catch (e) { toast.error("Error al actualizar"); }
    };

    const toggleStatus = async (id, current) => {
        const next = current === 'ACTIVE' ? 'EXPIRED' : 'ACTIVE';
        try {
            await updateDoc(doc(db, 'companies', id), { subscriptionStatus: next });
            toast.success(`Cliente marcado como ${next}`);
            loadCompanies();
        } catch (e) { toast.error("Error"); }
    };

    const filtered = companies.filter(c => c.name?.toLowerCase().includes(filter.toLowerCase()));

    if (loading) return <div className="h-screen flex items-center justify-center font-black">SALVADOR SAAS...</div>;

    return (
        <div className="p-8 max-w-6xl mx-auto space-y-8">
            <header className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-black text-sys-900 tracking-tighter flex items-center gap-2">
                        <ShieldCheck className="text-brand" size={32} /> CONTROL DE ABONOS
                    </h1>
                    <p className="text-sys-500 font-bold text-xs uppercase">Gestión de suscripciones mensuales ($50.000)</p>
                </div>
                <input 
                    type="text" 
                    placeholder="Buscar cliente..." 
                    className="p-3 border-2 border-sys-200 rounded-2xl outline-none focus:border-brand w-64 font-bold"
                    onChange={(e) => setFilter(e.target.value)}
                />
            </header>

            <div className="grid grid-cols-1 gap-4">
                {filtered.map(c => {
                    const isExpired = new Date(c.expiryDate) < new Date() || c.subscriptionStatus === 'EXPIRED';
                    return (
                        <Card key={c.id} className={cn("p-6 border-2 transition-all", isExpired ? "border-red-200 bg-red-50/30" : "border-sys-100")}>
                            <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                                <div className="flex-1">
                                    <h3 className="text-lg font-black uppercase text-sys-900">{c.name}</h3>
                                    <p className="text-[10px] font-mono text-sys-400">ID: {c.id}</p>
                                </div>

                                <div className="flex gap-8 text-center px-6 border-x border-sys-200">
                                    <div>
                                        <p className="text-[9px] font-black text-sys-400 uppercase">Estado</p>
                                        <span className={cn("text-[10px] font-black px-2 py-1 rounded-full border", 
                                            isExpired ? "bg-red-100 text-red-600 border-red-200" : "bg-green-100 text-green-600 border-green-200")}>
                                            {isExpired ? 'VENCIDO' : 'ACTIVO'}
                                        </span>
                                    </div>
                                    <div>
                                        <p className="text-[9px] font-black text-sys-400 uppercase">Vencimiento</p>
                                        <p className="text-sm font-bold">{new Date(c.expiryDate).toLocaleDateString()}</p>
                                    </div>
                                </div>

                                <div className="flex gap-2">
                                    <Button variant="secondary" onClick={() => updateSubscription(c.id, 30)} className="h-10 text-xs font-bold border-sys-300">
                                        +30 DÍAS (PAGÓ)
                                    </Button>
                                    <Button onClick={() => toggleStatus(c.id, c.subscriptionStatus)} className={cn("h-10 text-xs font-black", isExpired ? "bg-green-600" : "bg-red-600")}>
                                        {isExpired ? 'ACTIVAR' : 'SUSPENDER'}
                                    </Button>
                                </div>
                            </div>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
};