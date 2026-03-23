import React, { useEffect, useState } from 'react';
import { 
    ShieldCheck, Search, Calendar, CheckCircle2, 
    AlertCircle, RefreshCcw, Store, DollarSign, 
    Plus, Lock, Eye, AlertTriangle, TrendingUp
} from 'lucide-react';
import { collection, getDocs, query, orderBy, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../database/firebase';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

export const SuperAdminPage = () => {
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('ALL'); // ALL, ACTIVE, WARNING, EXPIRED
    const [showPINS, setShowPINS] = useState({});
    
    const navigate = useNavigate();
    const SAAS_PRICE = 50000;

    const loadCompanies = async () => {
        setLoading(true);
        try {
            const q = query(collection(db, 'companies'), orderBy('createdAt', 'desc'));
            const snap = await getDocs(q);
            const companiesList = snap.docs.map(d => ({ id: d.id, ...d.data() }));

            // Cargar sucursales para extraer los PINs
            for (let company of companiesList) {
                const branchSnap = await getDocs(collection(db, 'companies', company.id, 'branches'));
                company.branches = branchSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            }

            setCompanies(companiesList);
        } catch (e) {
            toast.error("Error al leer base de datos");
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
            toast.success(`Suscripción extendida ${days} días`);
            loadCompanies();
        } catch (e) { toast.error("Error al actualizar"); }
    };

    const toggleStatus = async (id, current) => {
        const next = current === 'ACTIVE' ? 'EXPIRED' : 'ACTIVE';
        if (!window.confirm(`¿Estás seguro de marcar a este cliente como ${next}?`)) return;
        try {
            await updateDoc(doc(db, 'companies', id), { subscriptionStatus: next });
            toast.success(`Cliente marcado como ${next}`);
            loadCompanies();
        } catch (e) { toast.error("Error al cambiar estado"); }
    };

    const togglePinVisibility = (companyId) => {
        setShowPINS(prev => ({ ...prev, [companyId]: !prev[companyId] }));
    };

    // Funciones de cálculo de estado
    const today = new Date();
    const getDaysLeft = (expiryString) => {
        if (!expiryString) return -1;
        const expiry = new Date(expiryString);
        return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
    };

    // Procesamiento de datos para los filtros y métricas
    const processedCompanies = companies.map(c => {
        const daysLeft = getDaysLeft(c.expiryDate);
        let status = 'ACTIVE';
        if (c.subscriptionStatus === 'EXPIRED' || daysLeft < 0) status = 'EXPIRED';
        else if (daysLeft <= 5) status = 'WARNING';
        
        return { ...c, computedStatus: status, daysLeft };
    });

    const filtered = processedCompanies.filter(c => {
        const matchesText = c.name?.toLowerCase().includes(filter.toLowerCase()) || c.cuit?.includes(filter);
        const matchesStatus = statusFilter === 'ALL' || c.computedStatus === statusFilter;
        return matchesText && matchesStatus;
    });

    // Métricas
    const activeCount = processedCompanies.filter(c => c.computedStatus === 'ACTIVE' || c.computedStatus === 'WARNING').length;
    const expiredCount = processedCompanies.filter(c => c.computedStatus === 'EXPIRED').length;
    const warningCount = processedCompanies.filter(c => c.computedStatus === 'WARNING').length;
    const mrr = activeCount * SAAS_PRICE;

    if (loading) return (
        <div className="h-screen w-full flex flex-col items-center justify-center bg-sys-900 text-white z-[100] fixed inset-0">
            <RefreshCcw className="animate-spin mb-4 text-brand" size={48} />
            <h2 className="font-black tracking-widest uppercase text-xl">SaaS Control Center</h2>
            <p className="text-sys-400 text-xs mt-2 font-bold animate-pulse">Sincronizando clientes...</p>
        </div>
    );

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8 pb-24">
            
            {/* HEADER Y MÉTIRICAS */}
            <div className="bg-white p-6 md:p-8 rounded-3xl border border-sys-200 shadow-sm space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-3xl md:text-4xl font-black text-sys-900 tracking-tighter flex items-center gap-3">
                            <ShieldCheck className="text-brand" size={40} /> MASTER SAAS
                        </h1>
                        <p className="text-sys-500 font-bold text-xs uppercase tracking-widest mt-1">Gestión de Licencias y Cobranza</p>
                    </div>
                    
                    <Button onClick={() => navigate('/valeria')} className="w-full md:w-auto h-12 px-6 bg-sys-900 hover:bg-black text-white shadow-xl shadow-sys-900/20 text-sm">
                        <Plus size={20} className="mr-2"/> Nuevo Cliente
                    </Button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6 border-t border-sys-100">
                    <div className="bg-sys-50 p-4 rounded-2xl border border-sys-200">
                        <p className="text-[10px] font-black text-sys-500 uppercase tracking-widest mb-1">Total Clientes</p>
                        <p className="text-3xl font-black text-sys-900">{companies.length}</p>
                    </div>
                    <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200">
                        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">Activos</p>
                        <p className="text-3xl font-black text-emerald-700">{activeCount}</p>
                    </div>
                    <div className="bg-orange-50 p-4 rounded-2xl border border-orange-200">
                        <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-1">Próx. a Vencer</p>
                        <p className="text-3xl font-black text-orange-700">{warningCount}</p>
                    </div>
                    <div className="bg-brand/10 p-4 rounded-2xl border border-brand/20">
                        <p className="text-[10px] font-black text-brand uppercase tracking-widest mb-1 flex items-center gap-1"><TrendingUp size={12}/> Ingreso Mensual</p>
                        <p className="text-3xl font-black text-brand-dark">${(mrr).toLocaleString('es-AR')}</p>
                    </div>
                </div>
            </div>

            {/* FILTROS Y BUSCADOR */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex bg-white p-1 rounded-xl border border-sys-200 shadow-sm w-full md:w-auto overflow-x-auto no-scrollbar">
                    <button onClick={() => setStatusFilter('ALL')} className={cn("px-4 py-2 rounded-lg text-xs font-black uppercase whitespace-nowrap transition-all", statusFilter === 'ALL' ? "bg-sys-900 text-white" : "text-sys-500 hover:bg-sys-100")}>
                        Todos
                    </button>
                    <button onClick={() => setStatusFilter('ACTIVE')} className={cn("px-4 py-2 rounded-lg text-xs font-black uppercase whitespace-nowrap transition-all", statusFilter === 'ACTIVE' ? "bg-emerald-600 text-white" : "text-sys-500 hover:bg-sys-100")}>
                        Al Día
                    </button>
                    <button onClick={() => setStatusFilter('WARNING')} className={cn("px-4 py-2 rounded-lg text-xs font-black uppercase whitespace-nowrap transition-all flex items-center gap-1", statusFilter === 'WARNING' ? "bg-orange-500 text-white" : "text-sys-500 hover:bg-sys-100")}>
                        <AlertTriangle size={14}/> Vencen Pronto
                    </button>
                    <button onClick={() => setStatusFilter('EXPIRED')} className={cn("px-4 py-2 rounded-lg text-xs font-black uppercase whitespace-nowrap transition-all", statusFilter === 'EXPIRED' ? "bg-red-600 text-white" : "text-sys-500 hover:bg-sys-100")}>
                        Vencidos ({expiredCount})
                    </button>
                </div>

                <div className="relative w-full md:w-80 shrink-0">
                    <Search className="absolute left-3 top-3 text-sys-400" size={18} />
                    <input 
                        type="text" 
                        placeholder="Buscar cliente o CUIT..." 
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-sys-200 rounded-xl outline-none focus:border-brand shadow-sm font-bold text-sm"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    />
                </div>
            </div>

            {/* LISTA DE EMPRESAS */}
            <div className="grid grid-cols-1 gap-5">
                {filtered.map(c => {
                    const isExpired = c.computedStatus === 'EXPIRED';
                    const isWarning = c.computedStatus === 'WARNING';
                    
                    return (
                        <Card key={c.id} className={cn(
                            "p-0 overflow-hidden border-2 transition-all hover:shadow-xl",
                            isExpired ? "border-red-200 bg-red-50/20" : isWarning ? "border-orange-200 bg-orange-50/10" : "border-sys-100"
                        )}>
                            <div className="p-6">
                                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                                    
                                    {/* INFO EMPRESA */}
                                    <div className="flex items-center gap-4 flex-1">
                                        <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center text-white shrink-0 shadow-lg font-black text-2xl", c.logoUrl ? "bg-white p-1" : "bg-sys-900")}>
                                            {c.logoUrl ? <img src={c.logoUrl} className="w-full h-full object-contain rounded-xl" alt="Logo" /> : c.name?.charAt(0)}
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-sys-900 uppercase leading-none">{c.name}</h3>
                                            <div className="flex flex-wrap items-center gap-2 mt-2">
                                                <span className="text-[10px] font-mono bg-sys-100 px-2 py-0.5 rounded border text-sys-500">ID: {c.id.slice(0,8)}</span>
                                                <span className="text-[10px] font-black text-brand uppercase px-2 py-0.5 bg-brand/10 rounded">{c.planId || 'PLAN FULL'}</span>
                                                {c.cuit && <span className="text-[10px] font-bold text-sys-400">CUIT: {c.cuit}</span>}
                                            </div>
                                        </div>
                                    </div>

                                    {/* ESTADO Y VENCIMIENTO */}
                                    <div className="grid grid-cols-2 gap-8 px-0 lg:px-8 lg:border-x border-sys-100 min-w-[280px]">
                                        <div className="text-left lg:text-center">
                                            <p className="text-[10px] font-black text-sys-400 uppercase mb-1">Estado</p>
                                            <span className={cn(
                                                "inline-flex px-3 py-1 rounded-full text-[10px] font-black uppercase border items-center justify-center gap-1",
                                                isExpired ? "bg-red-50 text-red-600 border-red-200" : 
                                                isWarning ? "bg-orange-50 text-orange-600 border-orange-200 animate-pulse" :
                                                "bg-emerald-50 text-emerald-600 border-emerald-100"
                                            )}>
                                                {isExpired ? <AlertCircle size={12}/> : isWarning ? <AlertTriangle size={12}/> : <CheckCircle2 size={12}/>}
                                                {isExpired ? 'VENCIDO' : isWarning ? 'VENCE PRONTO' : 'ACTIVO'}
                                            </span>
                                        </div>
                                        <div className="text-right lg:text-center">
                                            <p className="text-[10px] font-black text-sys-400 uppercase mb-1">Vencimiento</p>
                                            <p className={cn("text-sm font-black", isExpired ? "text-red-600" : isWarning ? "text-orange-600" : "text-sys-800")}>
                                                {c.expiryDate ? new Date(c.expiryDate).toLocaleDateString('es-AR') : '---'}
                                            </p>
                                            {c.daysLeft >= 0 && c.daysLeft <= 10 && !isExpired && (
                                                <p className="text-[9px] font-bold text-orange-500 mt-0.5">En {c.daysLeft} días</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* ACCIONES DE PAGO */}
                                    <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto mt-4 lg:mt-0">
                                        <Button 
                                            variant="primary" 
                                            className="flex-1 lg:flex-none h-12 px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-black shadow-lg shadow-emerald-200/50"
                                            onClick={() => updateSubscription(c.id, 30)}
                                        >
                                            <DollarSign className="mr-1" size={18}/> ACREDITAR PAGO
                                        </Button>
                                        <Button 
                                            variant={isExpired ? "secondary" : "danger"}
                                            onClick={() => toggleStatus(c.id, c.subscriptionStatus)}
                                            className="flex-1 lg:flex-none h-12 px-4 font-black uppercase tracking-tighter"
                                        >
                                            {isExpired ? 'Reactivar' : 'Suspender'}
                                        </Button>
                                    </div>
                                </div>

                                {/* LISTA DE SUCURSALES Y PINS */}
                                <div className="mt-6 pt-4 border-t border-sys-100 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                                    <div className="flex flex-wrap gap-3">
                                        {c.branches?.map(b => (
                                            <div key={b.id} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-sys-200 shadow-sm">
                                                <Store size={14} className="text-brand" />
                                                <span className="text-[11px] font-bold text-sys-800">{b.name}</span>
                                                <div className="flex items-center gap-1 ml-2 border-l pl-2 border-sys-200">
                                                    <Lock size={12} className="text-sys-300" />
                                                    <span className="text-[11px] font-mono font-black text-brand">
                                                        {showPINS[c.id] ? (b.pin || b.adminPin || 'S/N') : '••••'}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <button 
                                        onClick={() => togglePinVisibility(c.id)}
                                        className="text-[10px] font-black text-sys-400 hover:text-brand flex items-center gap-1 uppercase bg-sys-50 px-3 py-1.5 rounded-lg transition-colors shrink-0"
                                    >
                                        <Eye size={14} /> {showPINS[c.id] ? 'Ocultar PINS' : 'Revelar PINS'}
                                    </button>
                                </div>
                            </div>
                        </Card>
                    );
                })}

                {filtered.length === 0 && !loading && (
                    <div className="text-center py-24 bg-white rounded-3xl border-2 border-dashed border-sys-200">
                        <Store size={64} className="mx-auto text-sys-200 mb-4" />
                        <h3 className="text-lg font-black text-sys-900 uppercase">Sin resultados</h3>
                        <p className="text-sys-400 font-bold text-sm mt-1">No se encontraron empresas con ese filtro.</p>
                        <Button onClick={() => setFilter('')} variant="ghost" className="mt-4">Limpiar Búsqueda</Button>
                    </div>
                )}
            </div>
        </div>
    );
};