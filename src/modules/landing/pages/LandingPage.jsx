import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'react-qr-code';
import {
    MessageCircle, ArrowRight, ChevronDown, Wifi, WifiOff, CheckCircle2, Clock, RefreshCw,
    Receipt, Package, Tag, Wallet, KeyRound, Building2, BookUser, BarChart3, Play, Hand,
    QrCode, CreditCard, Banknote, ArrowLeftRight, Smartphone, Monitor, Printer, ScanBarcode, Scale,
    PackagePlus, PackageMinus, Trash2, AlertTriangle, Search, ShoppingCart, Download, Store, Truck, Plug,
    HardDrive, Cloud, Sparkles, Bot, Send, Undo2, TrendingUp, CheckCheck, CalendarClock, ShieldCheck,
    Copy, FileText, PackageCheck
} from 'lucide-react';
import { Button } from '../../../core/ui/Button';

// --- CONFIGURACIÓN DE CONTACTO ---
const WHATSAPP_NUMBER = "5493804373795";
const WHATSAPP_MESSAGE = "Hola, vi la web de Noar POS y quiero saber más sobre el sistema y los costos.";
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

const MP_BLUE = '#009EE3';

const openWhatsapp = () => window.open(WHATSAPP_LINK, '_blank');
const money = (n) => `$ ${Math.round(n).toLocaleString('es-AR')}`;

// --- ESTILOS / ANIMACIONES DE LA LANDING ---
const LandingStyles = () => (
    <style>{`
        @keyframes noar-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes noar-marquee-rev { from { transform: translateX(-50%); } to { transform: translateX(0); } }
        @keyframes noar-row-in { from { opacity: 0; transform: translateY(-10px) scale(.98); } to { opacity: 1; transform: none; } }
        @keyframes noar-pop { 0% { opacity: 0; transform: translateY(10px) scale(.9); } 60% { transform: translateY(-2px) scale(1.03); } 100% { opacity: 1; transform: none; } }
        @keyframes noar-word { from { opacity: 0; transform: translateY(60%) rotateX(-60deg); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
        @keyframes noar-scan { 0% { top: 6%; } 50% { top: 90%; } 100% { top: 6%; } }
        @keyframes noar-flow { to { background-position: 40px 0; } }
        @keyframes noar-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes noar-print { from { transform: translateY(-101%); } to { transform: translateY(0); } }
        @keyframes noar-check { 0% { transform: scale(0) rotate(-30deg); } 70% { transform: scale(1.2) rotate(6deg); } 100% { transform: scale(1); } }
        @keyframes noar-blink { 50% { opacity: 0; } }
        @keyframes noar-fill { from { width: 0; } to { width: 100%; } }
        @keyframes noar-typing { 0%, 60%, 100% { transform: translateY(0); opacity: .4; } 30% { transform: translateY(-4px); opacity: 1; } }
        @keyframes noar-shine { from { background-position: 200% 0; } to { background-position: -200% 0; } }
        @keyframes noar-twinkle { 0%,100% { transform: scale(1) rotate(0); } 50% { transform: scale(1.25) rotate(15deg); } }
        @keyframes noar-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }

        .noar-typing span { display: inline-block; width: 6px; height: 6px; border-radius: 9999px; background: #7A7A6E; animation: noar-typing 1.2s infinite; }
        .noar-typing span:nth-child(2) { animation-delay: .15s; }
        .noar-typing span:nth-child(3) { animation-delay: .3s; }
        .noar-shine { background: linear-gradient(110deg, #C2410C 30%, #fb923c 45%, #fde68a 50%, #fb923c 55%, #C2410C 70%); background-size: 200% 100%; animation: noar-shine 3.5s linear infinite; }
        .noar-twinkle { animation: noar-twinkle 2s ease-in-out infinite; }
        .noar-grow { transform-origin: bottom; animation: noar-grow .9s cubic-bezier(.2,.8,.2,1) both; }

        .noar-marquee { animation: noar-marquee 38s linear infinite; }
        .noar-marquee-rev { animation: noar-marquee-rev 46s linear infinite; }
        .noar-marquee:hover, .noar-marquee-rev:hover { animation-play-state: paused; }
        .noar-row-in { animation: noar-row-in .45s cubic-bezier(.2,.8,.2,1); }
        .noar-pop { animation: noar-pop .5s cubic-bezier(.2,.8,.2,1) both; }
        .noar-word { display: inline-block; animation: noar-word .55s cubic-bezier(.2,.8,.2,1) both; transform-origin: 50% 100%; }
        .noar-float { animation: noar-float 5s ease-in-out infinite; }
        .noar-check { animation: noar-check .5s cubic-bezier(.2,.8,.2,1) both; }
        .noar-caret { animation: noar-blink 1s step-end infinite; }
        .noar-scanline { position: absolute; left: 4%; right: 4%; height: 3px; border-radius: 3px; background: ${MP_BLUE}; box-shadow: 0 0 14px 3px ${MP_BLUE}88; animation: noar-scan 2.4s ease-in-out infinite; }
        .noar-flow { background-image: repeating-linear-gradient(90deg, currentColor 0 10px, transparent 10px 20px); animation: noar-flow 1s linear infinite; }

        .noar-reveal { opacity: 0; transform: translateY(28px); transition: opacity .8s ease, transform .8s cubic-bezier(.2,.7,.2,1); }
        .noar-reveal.is-in { opacity: 1; transform: none; }

        .noar-dots { background-image: radial-gradient(rgba(26,26,20,.10) 1px, transparent 1px); background-size: 22px 22px; }
        .noar-grid-dark { background-image: linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px); background-size: 48px 48px; }
        .noar-spot { position: relative; }
        .noar-spot::before { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; opacity: 0; transition: opacity .3s;
            background: radial-gradient(420px circle at var(--x, 50%) var(--y, 50%), rgba(194,65,12,.10), transparent 45%); }
        .noar-spot:hover::before { opacity: 1; }
        .noar-spot-dark::before { background: radial-gradient(420px circle at var(--x, 50%) var(--y, 50%), rgba(251,146,60,.16), transparent 45%); }
        .noar-outline { color: transparent; -webkit-text-stroke: 1.5px rgba(26,26,20,.22); }
        .noar-ticket-edge { background: radial-gradient(circle at 8px 0, transparent 7px, #1A1A14 7.5px) 0 0 / 16px 10px repeat-x; }

        @media (prefers-reduced-motion: reduce) {
            .noar-marquee, .noar-marquee-rev, .noar-row-in, .noar-pop, .noar-word, .noar-float, .noar-check, .noar-scanline, .noar-flow,
            .noar-typing span, .noar-shine, .noar-twinkle, .noar-grow { animation: none !important; }
            .noar-reveal { opacity: 1; transform: none; transition: none; }
        }
    `}</style>
);

// --- HOOKS ---

const useInView = (threshold = 0.15) => {
    const ref = useRef(null);
    const [inView, setInView] = useState(() => typeof window !== 'undefined' && !('IntersectionObserver' in window));
    useEffect(() => {
        const el = ref.current;
        if (!el || !('IntersectionObserver' in window)) return;
        const io = new IntersectionObserver(([e]) => {
            if (e.isIntersecting) { setInView(true); io.disconnect(); }
        }, { threshold, rootMargin: '0px 0px -60px 0px' });
        io.observe(el);
        return () => io.disconnect();
    }, [threshold]);
    return [ref, inView];
};

// Índice que avanza en loop mientras `active`
const useCycle = (length, ms, active = true) => {
    const [i, setI] = useState(0);
    useEffect(() => {
        if (!active) return;
        const t = setInterval(() => setI(x => (x + 1) % length), ms);
        return () => clearInterval(t);
    }, [length, ms, active]);
    return i;
};

const useCountUp = (target, duration = 600) => {
    const [value, setValue] = useState(target);
    const from = useRef(target);
    useEffect(() => {
        const start = performance.now();
        const initial = from.current;
        let raf;
        const tick = (now) => {
            const p = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - p, 3);
            setValue(initial + (target - initial) * eased);
            if (p < 1) raf = requestAnimationFrame(tick);
            else from.current = target;
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [target, duration]);
    return value;
};

// Sigue el mouse y expone --x / --y para el spotlight
const trackSpot = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--x', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--y', `${e.clientY - r.top}px`);
};

// --- PIEZAS UI ---

const Reveal = ({ children, delay = 0, className = '' }) => {
    const [ref, inView] = useInView();
    return (
        <div ref={ref} className={`noar-reveal ${inView ? 'is-in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
            {children}
        </div>
    );
};

const BrandLogo = ({ dark = false }) => (
    <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-transform hover:rotate-[-8deg] ${dark ? 'bg-white' : 'bg-sys-900'}`}>
        <svg viewBox="0 0 24 24" className="w-3/5 h-3/5" fill="none">
            <path d="M7 4V20" stroke={dark ? '#1A1A14' : 'white'} strokeWidth="4" strokeLinecap="round" />
            <path d="M17 4V20" stroke={dark ? '#1A1A14' : 'white'} strokeWidth="4" strokeLinecap="round" />
            <path d="M7 4L17 20" stroke="#C2410C" strokeWidth="4" strokeLinecap="round" />
        </svg>
    </div>
);

const Kicker = ({ icon: Icon, children, dark = false }) => (
    <div className={`inline-flex items-center gap-2 text-sm font-semibold mb-4 ${dark ? 'text-orange-300' : 'text-brand'}`}>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${dark ? 'bg-white/10' : 'bg-brand/10'}`}>
            <Icon size={15} />
        </span>
        {children}
    </div>
);

const CtaButton = ({ children, className = '', ...props }) => (
    <Button
        className={`group h-12 px-6 text-base bg-brand hover:bg-brand-hover text-white rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-brand/25 hover:-translate-y-0.5 transition-all ${className}`}
        {...props}
    >
        {children}
        <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
    </Button>
);

// Código de barras decorativo, determinístico
const Barcode = ({ seed = '7790001234567', className = '' }) => {
    const bars = [];
    let x = 0;
    seed.split('').forEach((d, i) => {
        const n = Number(d) || 1;
        [1 + (n % 3), 1 + ((n + i) % 2), 1 + ((n * 7) % 4)].forEach((w, j) => {
            if (j % 2 === 0) bars.push(<rect key={`${i}-${j}`} x={x} y="0" width={w} height="40" />);
            x += w + 1;
        });
    });
    return <svg viewBox={`0 0 ${x} 40`} preserveAspectRatio="none" className={className} fill="currentColor">{bars}</svg>;
};

// --- BARRA DE PROGRESO + NAVBAR ---

const ScrollProgress = () => {
    const [p, setP] = useState(0);
    useEffect(() => {
        const onScroll = () => {
            const h = document.documentElement.scrollHeight - window.innerHeight;
            setP(h > 0 ? window.scrollY / h : 0);
        };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);
    return <div className="fixed top-0 left-0 h-[3px] bg-brand z-[60] origin-left" style={{ width: '100%', transform: `scaleX(${p})` }} />;
};

const Navbar = () => {
    const navigate = useNavigate();
    const [scrolled, setScrolled] = useState(false);
    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    return (
        <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${scrolled ? 'bg-white/85 backdrop-blur-md border-b border-sys-200 shadow-[0_8px_30px_-12px_rgba(26,26,20,.15)]' : 'bg-transparent border-b border-transparent'}`}>
            <div className={`max-w-6xl mx-auto px-4 sm:px-6 flex justify-between items-center transition-all ${scrolled ? 'h-14' : 'h-20'}`}>
                <button className="flex items-center gap-2.5" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                    <BrandLogo />
                    <span className="font-bold text-lg tracking-tight text-sys-900">Noar<span className="text-brand">POS</span></span>
                </button>

                <div className="hidden md:flex items-center gap-1 text-sm font-medium text-sys-600">
                    <a href="#asistente" className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sys-900 hover:bg-brand/5 transition-colors">
                        <Sparkles size={14} className="text-brand noar-twinkle" /> Asistente IA
                        <span className="noar-shine text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md">NUEVO</span>
                    </a>
                    {[['#funciones', 'Funciones'], ['#offline', 'Sin internet'], ['#cobros', 'Cobros'], ['#faq', 'Preguntas']].map(([href, label]) => (
                        <a key={href} href={href} className="relative px-3 py-2 rounded-lg hover:text-sys-900 transition-colors after:absolute after:left-3 after:right-3 after:bottom-1 after:h-0.5 after:bg-brand after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:origin-left">
                            {label}
                        </a>
                    ))}
                </div>

                <div className="flex gap-2">
                    <Button variant="ghost" className="font-medium text-sys-700 hidden sm:flex" onClick={() => navigate('/login')}>
                        Ingresar
                    </Button>
                    <Button size="sm" className="bg-sys-900 hover:bg-black text-white font-medium px-4 rounded-xl flex items-center gap-2" onClick={openWhatsapp}>
                        <MessageCircle size={16} /> Contacto
                    </Button>
                </div>
            </div>
        </nav>
    );
};

// --- HERO ---

const BUSINESS_WORDS = ['almacén', 'kiosco', 'ferretería', 'verdulería', 'dietética', 'librería', 'carnicería'];

const RotatingWord = () => {
    const i = useCycle(BUSINESS_WORDS.length, 2200);
    return (
        <span className="relative inline-block text-brand" style={{ perspective: 600 }}>
            <span key={i} className="noar-word">{BUSINESS_WORDS[i]}</span>
            <span className="absolute left-0 right-0 -bottom-1 h-2 bg-brand/15 rounded-full" />
        </span>
    );
};

const SAMPLE_SALES = [
    { items: 'Yerba 1kg × 2', total: 9800, method: 'QR MP', icon: QrCode },
    { items: 'Queso cremoso 0,750 kg', total: 6375, method: 'Efectivo', icon: Banknote },
    { items: 'Gaseosa 2,25L × 3', total: 8400, method: 'Débito', icon: CreditCard },
    { items: 'Galletitas × 4', total: 5800, method: 'Transferencia', icon: ArrowLeftRight },
    { items: 'Pan 1,2 kg', total: 3600, method: 'Efectivo', icon: Banknote },
    { items: 'Leche × 6', total: 7200, method: 'QR MP', icon: QrCode },
];

// Guion del modo automático: vende, se corta, vende offline, vuelve y sincroniza
const DEMO_SCRIPT = ['sell', 'sell', 'off', 'sell', 'sell', 'on', 'idle', 'sell', 'idle'];

const StatusIcon = ({ status }) => {
    if (status === 'synced') return <CheckCircle2 size={16} className="text-emerald-600 noar-check" />;
    if (status === 'syncing') return <RefreshCw size={16} className="text-sky-600 animate-spin" />;
    return <Clock size={16} className="text-amber-600" />;
};

const PosDemo = () => {
    const [ref, inView] = useInView(0.3);
    const [online, setOnline] = useState(true);
    const [auto, setAuto] = useState(true);
    const [toast, setToast] = useState(null);
    const [sales, setSales] = useState([
        { id: 2, ...SAMPLE_SALES[1], status: 'synced' },
        { id: 1, ...SAMPLE_SALES[0], status: 'synced' },
    ]);
    const nextId = useRef(3);
    const onlineRef = useRef(true);
    const salesRef = useRef(sales);
    const timers = useRef([]);
    const step = useRef(0);

    useEffect(() => { salesRef.current = sales; }, [sales]);
    useEffect(() => () => timers.current.forEach(clearTimeout), []);

    const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
    const setStatus = (id, status) => setSales(s => s.map(x => (x.id === id ? { ...x, status } : x)));
    const showToast = (kind, text) => setToast({ kind, text, key: Date.now() });

    const sell = () => {
        const id = nextId.current++;
        const sample = SAMPLE_SALES[id % SAMPLE_SALES.length];
        const isOnline = onlineRef.current;
        setSales(s => [{ id, ...sample, status: isOnline ? 'syncing' : 'pending' }, ...s].slice(0, 5));
        if (isOnline) {
            later(() => { setStatus(id, 'synced'); showToast('ok', 'Factura B autorizada por ARCA'); }, 900);
        } else {
            showToast('pending', 'Venta guardada en el equipo');
        }
    };

    const setNetwork = (goingOnline) => {
        onlineRef.current = goingOnline;
        setOnline(goingOnline);
        if (!goingOnline) { showToast('pending', 'Sin conexión: la caja sigue'); return; }
        const pending = salesRef.current.filter(x => x.status === 'pending');
        pending.forEach((x, i) => {
            later(() => setStatus(x.id, 'syncing'), 250 + i * 350);
            later(() => setStatus(x.id, 'synced'), 1000 + i * 350);
        });
        later(() => showToast('ok', pending.length ? `${pending.length} ventas sincronizadas` : 'Conexión restablecida'), 1100 + pending.length * 350);
    };

    // Piloto automático hasta que el usuario toque algo
    useEffect(() => {
        if (!auto || !inView) return;
        const t = setInterval(() => {
            const action = DEMO_SCRIPT[step.current % DEMO_SCRIPT.length];
            step.current++;
            if (action === 'sell') sell();
            if (action === 'off') setNetwork(false);
            if (action === 'on') setNetwork(true);
        }, 2100);
        return () => clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [auto, inView]);

    const takeOver = (fn) => () => { setAuto(false); fn(); };

    const pendingCount = sales.filter(x => x.status !== 'synced').length;
    const dayTotal = useCountUp(sales.reduce((acc, x) => acc + x.total, 0));

    return (
        <div ref={ref} className="relative">
            {/* Toast flotante */}
            {toast && (
                <div key={toast.key} className="noar-pop absolute -top-5 right-2 sm:-right-6 z-20 flex items-center gap-2.5 bg-white border border-sys-200 rounded-2xl shadow-xl px-3.5 py-2.5 text-sm font-semibold text-sys-800">
                    <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${toast.kind === 'ok' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                        {toast.kind === 'ok' ? <CheckCircle2 size={16} /> : <HardDrive size={16} />}
                    </span>
                    {toast.text}
                </div>
            )}

            <div className={`bg-white rounded-2xl border shadow-[0_30px_70px_-25px_rgba(26,26,20,.35)] overflow-hidden transition-colors duration-500 ${online ? 'border-sys-200' : 'border-amber-300'}`}>
                <div className={`flex items-center justify-between px-4 py-3 border-b transition-colors duration-500 ${online ? 'bg-sys-50 border-sys-100' : 'bg-amber-50 border-amber-100'}`}>
                    <div className="flex items-center gap-2 text-sm font-semibold text-sys-800">
                        <Store size={16} className="text-brand" /> Caja 1 · Sucursal Centro
                    </div>
                    <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full transition-colors ${online ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-200 text-amber-800'}`}>
                        <span className="relative flex w-2 h-2">
                            <span className={`absolute inset-0 rounded-full animate-ping ${online ? 'bg-emerald-400' : 'bg-amber-500'}`} />
                            <span className={`relative w-2 h-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-600'}`} />
                        </span>
                        {online ? 'En línea' : 'Sin conexión'}
                    </div>
                </div>

                <div className="px-4 pt-4">
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-sys-100 text-sm text-sys-500">
                        <Search size={16} /> Buscar o escanear código<span className="noar-caret">|</span>
                        <ScanBarcode size={16} className="ml-auto text-sys-400" />
                    </div>
                </div>

                <div className="px-4 pt-4 pb-2">
                    <div className="flex justify-between text-xs font-semibold text-sys-500 mb-2">
                        <span>Últimas ventas del turno</span>
                        <span className={pendingCount > 0 ? 'text-amber-600' : 'text-emerald-600'}>
                            {pendingCount > 0 ? `${pendingCount} sin subir` : 'Todo sincronizado'}
                        </span>
                    </div>
                    <ul className="space-y-1.5 min-h-[236px]">
                        {sales.map(s => (
                            <li key={s.id} className={`noar-row-in flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors duration-500 ${s.status === 'pending' ? 'border-amber-200 bg-amber-50/50' : 'border-sys-100 bg-white'}`}>
                                <span className="w-8 h-8 rounded-lg bg-sys-100 flex items-center justify-center text-sys-600 shrink-0">
                                    <s.icon size={15} />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-sys-800 truncate">{s.items}</p>
                                    <p className="text-xs text-sys-500">{s.method}</p>
                                </div>
                                <span className="text-sm font-semibold text-sys-900 tabular-nums">{money(s.total)}</span>
                                <StatusIcon status={s.status} />
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="px-4 pb-4 pt-2 flex items-center gap-3 border-t border-dashed border-sys-200 mt-2">
                    <div className="text-xs text-sys-500 pt-2">
                        Total turno<br /><span className="text-lg font-bold text-sys-900 tabular-nums">{money(dayTotal)}</span>
                    </div>
                    <button
                        onClick={takeOver(sell)}
                        className="ml-auto mt-2 flex items-center gap-2 bg-brand hover:bg-brand-hover active:scale-95 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all"
                    >
                        <ShoppingCart size={16} /> Cobrar venta
                    </button>
                </div>
            </div>

            <div className="absolute -bottom-5 inset-x-0 flex justify-center sm:justify-start sm:left-6 gap-2">
                <button
                    onClick={takeOver(() => setNetwork(!onlineRef.current))}
                    className={`flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg border transition-all active:scale-95 whitespace-nowrap ${online ? 'bg-sys-900 text-white border-sys-900 hover:bg-black' : 'bg-amber-400 text-sys-900 border-amber-500 hover:bg-amber-300'}`}
                >
                    {online ? <WifiOff size={16} /> : <Wifi size={16} />}
                    {online ? 'Cortar internet' : 'Volver a conectar'}
                </button>
            </div>

            <p className="flex items-center justify-center gap-1.5 text-xs text-sys-400 mt-10">
                {auto ? <><Play size={12} className="text-brand" /> Demo en vivo · tocá los botones para probarla vos</> : <><Hand size={12} /> Ahora la controlás vos · datos de ejemplo</>}
            </p>
        </div>
    );
};

const Hero = () => {
    const navigate = useNavigate();
    const onMove = (e) => trackSpot(e);
    return (
        <header onMouseMove={onMove} className="relative pt-32 pb-24 lg:pt-40 lg:pb-32 bg-sys-50 overflow-hidden" style={{ '--x': '70%', '--y': '30%' }}>
            <div className="absolute inset-0 noar-dots [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_80%)]" />
            <div className="absolute inset-0 pointer-events-none transition-[background] duration-300" style={{ background: 'radial-gradient(500px circle at var(--x) var(--y), rgba(194,65,12,.10), transparent 60%)' }} />

            <div className="relative max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-[1.1fr_1fr] gap-16 items-center">
                <div>
                    <Reveal>
                        <a href="#asistente" className="group inline-flex items-center gap-2 bg-white border border-sys-200 hover:border-brand/40 rounded-full pl-1.5 pr-3 py-1 text-xs font-semibold text-sys-700 mb-6 shadow-sm transition-colors">
                            <span className="noar-shine text-white rounded-full px-2 py-0.5 flex items-center gap-1"><Sparkles size={11} /> Nuevo</span>
                            Asistente IA: manejá tu negocio desde WhatsApp
                            <ArrowRight size={13} className="text-brand transition-transform group-hover:translate-x-0.5" />
                        </a>
                    </Reveal>
                    <Reveal delay={100}>
                        <h1 className="text-[2.5rem] sm:text-5xl lg:text-[3.7rem] font-extrabold text-sys-900 tracking-tight leading-[1.05] mb-6">
                            El sistema de tu <RotatingWord /><br />
                            que sigue vendiendo <span className="whitespace-nowrap">sin internet.</span>
                        </h1>
                    </Reveal>
                    <Reveal delay={200}>
                        <p className="text-lg text-sys-600 leading-relaxed mb-8 max-w-xl">
                            Caja, inventario, facturas A, B y C y cobros con Mercado Pago en una sola pantalla.
                            Corre en el navegador y guarda cada venta en el equipo, así la caja nunca se frena.
                        </p>
                    </Reveal>
                    <Reveal delay={300}>
                        <div className="flex flex-col sm:flex-row gap-3 mb-10">
                            <CtaButton onClick={openWhatsapp}><MessageCircle size={18} /> Pedí una demo</CtaButton>
                            <Button
                                variant="secondary"
                                className="h-12 px-6 text-base bg-white border border-sys-200 text-sys-800 hover:bg-sys-100 rounded-xl"
                                onClick={() => navigate('/login')}
                            >
                                Ya tengo cuenta
                            </Button>
                        </div>
                    </Reveal>
                    <Reveal delay={400}>
                        <div className="flex flex-wrap gap-2">
                            {[[Receipt, 'Factura A, B y C'], [QrCode, 'QR Mercado Pago'], [Building2, 'Multi-sucursal'], [WifiOff, 'Modo offline']].map(([Icon, label]) => (
                                <span key={label} className="flex items-center gap-2 text-sm text-sys-700 bg-white border border-sys-200 rounded-full px-3 py-1.5 hover:border-brand/40 hover:text-brand transition-colors">
                                    <Icon size={15} className="text-brand" /> {label}
                                </span>
                            ))}
                        </div>
                    </Reveal>
                </div>
                <Reveal delay={250} className="lg:pl-4">
                    <PosDemo />
                </Reveal>
            </div>
        </header>
    );
};

// --- CINTAS ---

const PAYMENT_CHIPS = [
    { icon: QrCode, label: 'QR Mercado Pago' },
    { icon: Smartphone, label: 'Mercado Pago Point' },
    { icon: CreditCard, label: 'Clover' },
    { icon: Banknote, label: 'Efectivo' },
    { icon: CreditCard, label: 'Débito y crédito' },
    { icon: ArrowLeftRight, label: 'Transferencia' },
    { icon: BookUser, label: 'Cuenta corriente' },
];

const PaymentsMarquee = () => (
    <div className="bg-sys-900 text-white py-5 overflow-hidden">
        <div className="noar-marquee flex w-max gap-10">
            {[...PAYMENT_CHIPS, ...PAYMENT_CHIPS, ...PAYMENT_CHIPS, ...PAYMENT_CHIPS].map((c, i) => (
                <span key={i} className="flex items-center gap-2.5 text-sm font-medium text-white/80 whitespace-nowrap">
                    <c.icon size={18} className="text-orange-400" /> {c.label}
                    <span className="ml-8 w-1.5 h-1.5 rounded-full bg-white/20" />
                </span>
            ))}
        </div>
    </div>
);

const WORDS_BAND = ['Ventas', 'Stock', 'Caja', 'ARCA', 'Etiquetas', 'Sucursales', 'Cobros', 'Kardex'];

const BigWordsBand = () => (
    <div className="py-10 bg-white overflow-hidden select-none" aria-hidden="true">
        <div className="noar-marquee-rev flex w-max gap-10 items-center">
            {[...WORDS_BAND, ...WORDS_BAND, ...WORDS_BAND].map((w, i) => (
                <span key={i} className="flex items-center gap-10 text-6xl md:text-8xl font-extrabold tracking-tight whitespace-nowrap">
                    <span className={i % 2 ? 'noar-outline' : 'text-sys-900'}>{w}</span>
                    <span className="w-4 h-4 rounded-full bg-brand" />
                </span>
            ))}
        </div>
    </div>
);

// --- CLIENTES ---

const Clients = () => (
    <section className="py-14 bg-white">
        <Reveal className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
            <p className="text-sm font-medium text-sys-500 mb-6">Algunos de los comercios que ya lo usan</p>
            <img src="/clients-logos.png" alt="Logos de comercios que usan Noar POS" className="max-w-3xl w-full h-auto mx-auto opacity-80 hover:opacity-100 transition-opacity" />
        </Reveal>
    </section>
);

// --- NOVEDAD: ASISTENTE IA POR WHATSAPP ---
// Skills reales del bot (functions/bot*.js). Las conversaciones son de ejemplo.

const AI_SKILLS = [
    {
        icon: PackageCheck, title: 'Cargar una compra',
        desc: 'Le pasás la boleta del proveedor y suma el stock, recalcula el costo promedio y la carga a cuenta corriente. Si viene un producto nuevo, lo da de alta.',
        chat: [
            { from: 'user', text: 'Llegó la boleta de Distribuidora Sur: 10 yerbas 1kg a $3.800 y 24 gaseosas 2,25L a $1.900' },
            { from: 'bot', text: 'Listo, cargué la compra a cuenta corriente de Distribuidora Sur.', card: { icon: PackagePlus, title: 'Compra · $ 83.600', lines: ['+10 Yerba 1kg', '+24 Gaseosa 2,25L', 'Costo promedio actualizado'] } },
            { from: 'bot', text: 'Ojo: la yerba vino más cara que la última vez. El precio de venta no lo toqué, ¿lo querés cambiar?' },
        ],
    },
    {
        icon: Tag, title: 'Cambiar un precio',
        desc: 'Cambia el precio de venta al instante. Si el producto no existe, no lo inventa: te avisa.',
        chat: [
            { from: 'user', text: 'Sí, pasá la yerba de 1kg a $5.200' },
            { from: 'bot', text: 'Hecho.', card: { icon: TrendingUp, title: 'Yerba 1kg', lines: ['Antes: $ 4.900', 'Ahora: $ 5.200'] } },
        ],
    },
    {
        icon: PackageMinus, title: 'Ajustar stock',
        desc: 'Roturas, vencimientos o conteos. El ajuste queda en el kardex del producto, igual que si lo hicieras desde la app.',
        chat: [
            { from: 'user', text: 'Se rompieron 3 frascos de mermelada de frutilla' },
            { from: 'bot', text: 'Registrado el ajuste.', card: { icon: Trash2, title: 'Ajuste de stock', lines: ['−3 Mermelada frutilla 454g', 'Motivo: rotura', 'Queda en el kardex'] } },
        ],
    },
    {
        icon: Wallet, title: 'Pagar a un proveedor',
        desc: 'Anota el pago en la cuenta corriente del proveedor. No mueve la caja del turno: eso lo seguís manejando vos desde la app.',
        chat: [
            { from: 'user', text: 'Le pagué 50 mil a Distribuidora Sur' },
            { from: 'bot', text: 'Anotado.', card: { icon: BookUser, title: 'Pago a proveedor', lines: ['$ 50.000 a cuenta', 'Saldo pendiente: $ 33.600'] } },
        ],
    },
];

const AI_RULES = [
    { icon: ShieldCheck, title: 'Las mismas reglas que la app', desc: 'Kardex, costo promedio y cuentas corrientes, sin registros paralelos.' },
    { icon: Search, title: 'No inventa', desc: 'Para precios y stock, si no encuentra el producto no lo crea.' },
    { icon: Wallet, title: 'No toca la caja', desc: 'Compras y pagos van a cuenta corriente, no al turno abierto.' },
    { icon: Copy, title: 'No duplica', desc: 'Si un mensaje llega dos veces, se carga una sola vez.' },
];

// Misma cuenta de tiempos que usa el reproductor del chat
const chatDuration = (chat) => chat.reduce((t, m) => t + (m.from === 'user' ? 1200 : 2200), 0);

const ChatBubble = ({ msg }) => {
    const mine = msg.from === 'user';
    return (
        <div className={`noar-pop flex ${mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${mine ? 'bg-[#d9fdd3] text-sys-900 rounded-br-md' : 'bg-white text-sys-800 rounded-bl-md'}`}>
                <p className="leading-snug">{msg.text}</p>
                {msg.card && (
                    <div className="mt-2 rounded-xl border border-sys-200 bg-sys-50 p-3">
                        <p className="flex items-center gap-2 font-bold text-sys-900 text-xs mb-1.5">
                            <msg.card.icon size={14} className="text-brand" /> {msg.card.title}
                        </p>
                        <ul className="space-y-0.5 text-xs text-sys-600 font-mono">
                            {msg.card.lines.map(l => <li key={l}>{l}</li>)}
                        </ul>
                    </div>
                )}
                <p className="flex items-center justify-end gap-1 text-[10px] text-sys-400 mt-1">
                    {mine ? <>10:42 <CheckCheck size={12} className="text-sky-500" /></> : '10:42'}
                </p>
            </div>
        </div>
    );
};

const AiAssistant = () => {
    const [ref, inView] = useInView(0.25);
    const [tab, setTab] = useState(0);
    const [auto, setAuto] = useState(true);
    const [shown, setShown] = useState(0);
    const [typing, setTyping] = useState(false);

    // Reproduce la conversación de la skill activa, mensaje por mensaje
    useEffect(() => {
        if (!inView) return;
        const timers = [];
        const at = (ms, fn) => timers.push(setTimeout(fn, ms));
        const chat = AI_SKILLS[tab].chat;
        let t = 0;
        at(0, () => { setShown(0); setTyping(false); });
        chat.forEach((m, i) => {
            if (m.from === 'user') {
                t += 500; at(t, () => setShown(i + 1));
                t += 700;
            } else {
                at(t, () => setTyping(true));
                t += 1300; at(t, () => { setTyping(false); setShown(i + 1); });
                t += 900;
            }
        });
        if (auto) at(t + 2600, () => setTab(x => (x + 1) % AI_SKILLS.length));
        return () => timers.forEach(clearTimeout);
    }, [tab, inView, auto]);

    const chat = AI_SKILLS[tab].chat;

    return (
        <section id="asistente" className="relative py-20 lg:py-28 bg-white overflow-hidden">
            <div className="absolute top-20 -left-40 w-[500px] h-[500px] rounded-full bg-emerald-200/30 blur-[120px] pointer-events-none" />
            <div className="absolute bottom-0 -right-40 w-[500px] h-[500px] rounded-full bg-orange-200/40 blur-[120px] pointer-events-none" />

            <div ref={ref} className="relative max-w-6xl mx-auto px-4 sm:px-6">
                <Reveal className="max-w-3xl mb-12">
                    <div className="inline-flex items-center gap-2 mb-5">
                        <span className="noar-shine text-white text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5"><Sparkles size={13} /> NUEVO</span>
                        <span className="text-sm font-semibold text-sys-600">Asistente con IA</span>
                    </div>
                    <h2 className="text-3xl md:text-5xl font-extrabold text-sys-900 tracking-tight leading-[1.08] mb-5">
                        Manejá el negocio<br />mandando un <span className="text-[#1fa855]">WhatsApp</span>.
                    </h2>
                    <p className="text-lg text-sys-600 leading-relaxed">
                        Escribile como le escribirías a un empleado. El asistente entiende el mensaje y lo carga en Noar POS:
                        compras, precios, stock y pagos a proveedores, sin abrir la computadora.
                    </p>
                </Reveal>

                <div className="grid lg:grid-cols-[1fr_1.05fr] gap-10 lg:gap-14 items-start">
                    {/* Skills */}
                    <div className="space-y-2.5 order-2 lg:order-1">
                        {AI_SKILLS.map((s, i) => {
                            const on = tab === i;
                            return (
                                <Reveal key={s.title} delay={i * 90}>
                                    <button
                                        onClick={() => { setAuto(false); setTab(i); }}
                                        className={`w-full text-left rounded-2xl border p-4 transition-all duration-300 ${on ? 'bg-white border-brand/40 shadow-[0_18px_40px_-22px_rgba(194,65,12,.5)]' : 'bg-white/60 border-sys-200 hover:bg-white hover:border-sys-300'}`}
                                    >
                                        <div className="flex items-start gap-3.5">
                                            <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300 ${on ? 'bg-brand text-white -rotate-6 scale-105' : 'bg-sys-100 text-sys-600'}`}>
                                                <s.icon size={19} />
                                            </span>
                                            <div className="flex-1">
                                                <h3 className="font-bold text-sys-900">{s.title}</h3>
                                                <div className={`grid transition-all duration-300 ${on ? 'grid-rows-[1fr] opacity-100 mt-1' : 'grid-rows-[0fr] opacity-0'}`}>
                                                    <p className="overflow-hidden text-sm text-sys-600 leading-relaxed">{s.desc}</p>
                                                </div>
                                            </div>
                                        </div>
                                        {on && auto && (
                                            <div className="mt-3 h-0.5 rounded-full bg-sys-100 overflow-hidden">
                                                <div key={tab} className="h-full bg-brand" style={{ width: 0, animation: `noar-fill ${chatDuration(s.chat) + 2600}ms linear forwards` }} />
                                            </div>
                                        )}
                                    </button>
                                </Reveal>
                            );
                        })}

                        <Reveal delay={400}>
                            <div className="grid sm:grid-cols-2 gap-3 pt-4">
                                {AI_RULES.map(r => (
                                    <div key={r.title} className="flex gap-3 p-3 rounded-xl">
                                        <r.icon size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                                        <div>
                                            <p className="text-sm font-semibold text-sys-900">{r.title}</p>
                                            <p className="text-xs text-sys-500 leading-relaxed">{r.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Reveal>
                    </div>

                    {/* Chat */}
                    <Reveal delay={150} className="order-1 lg:order-2">
                        <div className="relative mx-auto max-w-md">
                            <div className="absolute -top-4 -left-4 z-10 w-12 h-12 rounded-2xl bg-white shadow-xl border border-sys-100 flex items-center justify-center noar-float">
                                <Sparkles size={22} className="text-brand noar-twinkle" />
                            </div>
                            <div className="bg-sys-900 rounded-[2.2rem] p-3 shadow-[0_40px_80px_-30px_rgba(26,26,20,.5)]">
                                <div className="rounded-[1.7rem] overflow-hidden bg-[#efeae2]">
                                    <div className="bg-[#075e54] text-white px-4 py-3 flex items-center gap-3">
                                        <span className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center"><Bot size={19} /></span>
                                        <div className="flex-1">
                                            <p className="font-semibold text-sm leading-tight">Asistente Noar</p>
                                            <p className="text-[11px] text-white/70">{typing ? 'escribiendo…' : 'en línea'}</p>
                                        </div>
                                        <Sparkles size={16} className="text-white/70" />
                                    </div>
                                    <div className="h-[400px] px-3 py-4 flex flex-col justify-end gap-2 overflow-hidden noar-dots">
                                        {chat.slice(0, shown).map((m, i) => <ChatBubble key={`${tab}-${i}`} msg={m} />)}
                                        {typing && (
                                            <div className="noar-pop flex justify-start">
                                                <div className="bg-white rounded-2xl rounded-bl-md px-4 py-3 shadow-sm noar-typing flex gap-1"><span /><span /><span /></div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="bg-[#f0f0f0] px-3 py-2.5 flex items-center gap-2">
                                        <div className="flex-1 bg-white rounded-full px-4 py-2 text-sm text-sys-400">Escribí un mensaje</div>
                                        <span className="w-9 h-9 rounded-full bg-[#1fa855] text-white flex items-center justify-center"><Send size={16} /></span>
                                    </div>
                                </div>
                            </div>
                            <p className="text-xs text-sys-400 text-center mt-4">Conversación de ejemplo</p>
                        </div>
                    </Reveal>
                </div>

                <Reveal delay={200} className="mt-12 flex flex-col sm:flex-row items-center gap-4 justify-center">
                    <CtaButton onClick={openWhatsapp}><Sparkles size={18} /> Quiero el asistente</CtaButton>
                    <span className="text-sm text-sys-500">Consultanos para activarlo en tu comercio.</span>
                </Reveal>
            </div>
        </section>
    );
};

// --- FUNCIONES (bento con mini-interfaces animadas) ---

const BentoCard = ({ icon: Icon, title, desc, className = '', children, tone = 'light', delay = 0 }) => {
    const dark = tone === 'dark';
    return (
        <Reveal delay={delay} className={className}>
            <div
                onMouseMove={trackSpot}
                className={`noar-spot ${dark ? 'noar-spot-dark' : ''} group h-full rounded-3xl border p-6 flex flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-24px_rgba(26,26,20,.35)] ${dark ? 'bg-sys-900 border-sys-800 text-white' : 'bg-white border-sys-200 hover:border-sys-300'}`}
            >
                <div className="relative flex items-center gap-3 mb-3">
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:-rotate-6 group-hover:scale-110 ${dark ? 'bg-white/10 text-orange-300' : 'bg-brand/10 text-brand group-hover:bg-brand group-hover:text-white'}`}>
                        <Icon size={20} />
                    </span>
                    <h3 className={`font-bold text-lg ${dark ? 'text-white' : 'text-sys-900'}`}>{title}</h3>
                </div>
                <p className={`relative text-sm leading-relaxed mb-5 ${dark ? 'text-white/65' : 'text-sys-600'}`}>{desc}</p>
                <div className="relative mt-auto">{children}</div>
            </div>
        </Reveal>
    );
};

const InvoiceMini = () => {
    const [ref, inView] = useInView();
    const phase = useCycle(2, 2600, inView); // 0 = enviando, 1 = autorizada
    return (
        <div ref={ref} className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-2xl bg-sys-50 border border-sys-200 p-4 text-sm">
                <div className="flex justify-between items-center mb-3">
                    <span className="font-bold text-sys-900">Factura B</span>
                    {phase === 1 ? (
                        <span key="ok" className="noar-pop flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full"><CheckCircle2 size={12} /> Autorizada</span>
                    ) : (
                        <span key="wait" className="flex items-center gap-1 text-xs font-semibold text-sky-700 bg-sky-100 px-2 py-0.5 rounded-full"><RefreshCw size={12} className="animate-spin" /> Enviando</span>
                    )}
                </div>
                <div className="space-y-1 text-sys-600 font-mono text-xs">
                    <div className="flex justify-between"><span>Nº</span><span>0003-00001284</span></div>
                    <div className="flex justify-between"><span>CAE</span><span className={`transition-opacity ${phase ? 'opacity-100' : 'opacity-30'}`}>{phase ? '75410000000000' : '··············'}</span></div>
                    <div className="flex justify-between"><span>Total</span><span>$ 17.625</span></div>
                </div>
            </div>
            <div className="rounded-2xl bg-amber-50/60 border border-dashed border-amber-300 p-4 text-sm">
                <div className="flex justify-between items-center mb-3">
                    <span className="font-bold text-sys-900">Ticket X</span>
                    <span className="flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full"><Clock size={12} /> Contingencia</span>
                </div>
                <p className="text-xs text-sys-600 leading-relaxed">ARCA no respondió a tiempo. La venta quedó registrada y se factura después.</p>
            </div>
        </div>
    );
};

const KardexMini = () => {
    const [ref, inView] = useInView();
    const rows = [
        { icon: PackagePlus, label: 'Compra a proveedor', qty: '+24', cls: 'text-emerald-600' },
        { icon: ShoppingCart, label: 'Venta', qty: '−2', cls: 'text-sys-700' },
        { icon: Trash2, label: 'Merma', qty: '−1', cls: 'text-red-600' },
        { icon: PackageMinus, label: 'Ajuste manual', qty: '−3', cls: 'text-sys-700' },
    ];
    return (
        <ul ref={ref} className="space-y-1.5 text-sm">
            {rows.map((r, i) => (
                <li key={r.label}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl bg-sys-50 transition-all duration-500"
                    style={{ opacity: inView ? 1 : 0, transform: inView ? 'none' : 'translateX(-16px)', transitionDelay: `${300 + i * 120}ms` }}>
                    <r.icon size={15} className="text-sys-500" />
                    <span className="text-sys-700 flex-1">{r.label}</span>
                    <span className={`font-mono font-semibold ${r.cls}`}>{r.qty}</span>
                </li>
            ))}
        </ul>
    );
};

const LabelMini = () => (
    <div className="flex justify-center py-2">
        <div className="noar-float">
            <div className="w-48 bg-yellow-300 text-sys-900 rounded-lg p-3 shadow-lg -rotate-3 group-hover:rotate-0 group-hover:scale-105 transition-transform duration-500">
                <p className="text-[11px] font-semibold uppercase tracking-wide leading-tight">Yerba mate 1kg</p>
                <p className="text-3xl font-extrabold leading-none my-1.5">$ 4.900</p>
                <Barcode className="w-full h-7 text-sys-900" />
            </div>
        </div>
    </div>
);

const StockMini = () => {
    const [ref, inView] = useInView();
    return (
        <div ref={ref} className="space-y-3">
            {[['Aceite 1,5L', 18, 'bg-red-500'], ['Azúcar 1kg', 35, 'bg-amber-500'], ['Fideos 500g', 82, 'bg-emerald-500']].map(([name, pct, color], i) => (
                <div key={name}>
                    <div className="flex justify-between text-xs text-sys-600 mb-1">
                        <span className="flex items-center gap-1">{pct < 25 && <AlertTriangle size={12} className="text-red-500 animate-pulse" />}{name}</span>
                        <span>{pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-sys-100 overflow-hidden">
                        <div className={`h-2 rounded-full ${color} transition-[width] duration-1000 ease-out`} style={{ width: inView ? `${pct}%` : 0, transitionDelay: `${300 + i * 150}ms` }} />
                    </div>
                </div>
            ))}
        </div>
    );
};

const CashMini = () => {
    const [ref, inView] = useInView();
    const parts = [['Efectivo', 42, 'bg-orange-400'], ['QR MP', 28, 'bg-sky-400'], ['Tarjetas', 20, 'bg-violet-400'], ['Transf.', 10, 'bg-emerald-400']];
    return (
        <div ref={ref}>
            <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mb-3 bg-white/5">
                {parts.map(([l, p, c], i) => (
                    <div key={l} className={`${c} transition-[width] duration-700 ease-out`} style={{ width: inView ? `${p}%` : 0, transitionDelay: `${300 + i * 200}ms` }} />
                ))}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-white/70">
                {parts.map(([l, , c]) => <span key={l} className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${c}`} />{l}</span>)}
            </div>
        </div>
    );
};

const PinMini = () => {
    const [ref, inView] = useInView();
    const filled = useCycle(6, 450, inView); // 0..5: llena 4 dígitos y pausa
    const unlocked = filled >= 4;
    return (
        <div ref={ref} className="flex items-center gap-4">
            <div className="flex -space-x-2">
                {['MG', 'LP', 'JR'].map((ini, i) => (
                    <span key={ini} className={`w-9 h-9 rounded-full border-2 border-white flex items-center justify-center text-xs font-bold text-white transition-transform group-hover:-translate-y-1 ${['bg-brand', 'bg-sys-700', 'bg-sky-600'][i]}`} style={{ transitionDelay: `${i * 60}ms` }}>{ini}</span>
                ))}
            </div>
            <div className={`flex items-center gap-1.5 ml-auto px-3 py-2 rounded-xl transition-colors ${unlocked ? 'bg-emerald-50' : 'bg-sys-50'}`}>
                {[0, 1, 2, 3].map(i => (
                    <span key={i} className={`w-3 h-3 rounded-full transition-all duration-200 ${i < filled ? (unlocked ? 'bg-emerald-500 scale-110' : 'bg-sys-900 scale-110') : 'border-2 border-sys-300'}`} />
                ))}
                {unlocked && <CheckCircle2 size={14} className="noar-check text-emerald-600 ml-1" />}
            </div>
        </div>
    );
};

const BranchesMini = () => {
    const [ref, inView] = useInView();
    const active = useCycle(3, 1400, inView);
    return (
        <div ref={ref} className="flex flex-wrap gap-2">
            {['Centro', 'Barrio Norte', 'Depósito'].map((b, i) => (
                <span key={b} className={`flex items-center gap-1.5 text-xs font-medium border rounded-full px-3 py-1.5 transition-all duration-300 ${active === i ? 'bg-brand text-white border-brand shadow-md shadow-brand/30' : 'bg-sys-50 border-sys-200 text-sys-700'}`}>
                    <Store size={13} className={active === i ? 'text-white' : 'text-brand'} /> {b}
                </span>
            ))}
        </div>
    );
};

const LedgerMini = () => (
    <div className="space-y-1.5 text-sm">
        <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-sys-50 transition-colors group-hover:bg-emerald-50">
            <BookUser size={15} className="text-sys-500" /><span className="flex-1 text-sys-700 truncate">Cliente · Almacén Rosa</span><span className="font-mono text-sys-900">$ 32.400</span>
        </div>
        <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-sys-50 transition-colors group-hover:bg-red-50">
            <Truck size={15} className="text-sys-500" /><span className="flex-1 text-sys-700 truncate">Proveedor · Distribuidora</span><span className="font-mono text-red-600">−$ 118.000</span>
        </div>
    </div>
);

const SalesHistoryMini = () => {
    const [ref, inView] = useInView();
    const returned = useCycle(2, 2400, inView) === 1;
    return (
        <div ref={ref} className="space-y-1.5 text-sm">
            <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-sys-50">
                <FileText size={15} className="text-sys-500" />
                <span className="flex-1 text-sys-700">Factura B 0003-1284</span>
                <span className="font-mono text-sys-900">$ 17.625</span>
                <Printer size={14} className="text-sys-400" />
            </div>
            <div className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-colors duration-500 ${returned ? 'bg-orange-50' : 'bg-sys-50'}`}>
                <Undo2 size={15} className={returned ? 'text-brand' : 'text-sys-500'} />
                <span className="flex-1 text-sys-700">{returned ? 'Devolución · producto fallado' : 'Factura B 0003-1285'}</span>
                <span className={`font-mono transition-colors ${returned ? 'text-brand' : 'text-sys-900'}`}>{returned ? '−$ 1.450' : '$ 8.400'}</span>
                {returned
                    ? <span key="nc" className="noar-pop text-[10px] font-bold text-white bg-brand rounded-md px-1.5 py-0.5">NC</span>
                    : <Printer size={14} className="text-sys-400" />}
            </div>
        </div>
    );
};

const PurchaseMini = () => {
    const [ref, inView] = useInView();
    const step = useCycle(3, 1600, inView);
    return (
        <div ref={ref} className="flex items-center gap-2 text-sm">
            <div className="flex-1 rounded-xl bg-sys-50 p-3 text-center">
                <p className="text-[11px] text-sys-500">Stock</p>
                <p className="font-mono font-semibold text-sys-900">{step === 0 ? '12' : '36'}</p>
            </div>
            <ArrowRight size={16} className={`shrink-0 transition-colors ${step > 0 ? 'text-brand' : 'text-sys-300'}`} />
            <div className="flex-1 rounded-xl bg-sys-50 p-3 text-center">
                <p className="text-[11px] text-sys-500">Costo prom.</p>
                <p className={`font-mono font-semibold transition-colors ${step === 2 ? 'text-brand' : 'text-sys-900'}`}>{step < 2 ? '$ 1.700' : '$ 1.833'}</p>
            </div>
            <div className="flex-1 rounded-xl bg-sys-50 p-3 text-center">
                <p className="text-[11px] text-sys-500">Pago</p>
                <p className="font-semibold text-sys-900 text-xs pt-0.5">{['Cheque', 'Transf.', 'A cuenta'][step]}</p>
            </div>
        </div>
    );
};

const Features = () => (
    <section id="funciones" className="py-20 lg:py-28 bg-sys-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <Reveal className="max-w-2xl mb-12">
                <Kicker icon={Package}>Funciones</Kicker>
                <h2 className="text-3xl md:text-5xl font-extrabold text-sys-900 tracking-tight leading-[1.08]">
                    Todo lo del mostrador.<br /><span className="text-sys-400">Y lo que pasa detrás.</span>
                </h2>
            </Reveal>

            <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                <BentoCard className="md:col-span-4" icon={Receipt} title="Facturación ARCA desde la caja"
                    desc="Facturas A, B y C sin entrar a la web de ARCA. Si ARCA tarda o no responde, la venta no se traba: sale como ticket de contingencia.">
                    <InvoiceMini />
                </BentoCard>
                <BentoCard className="md:col-span-2" delay={100} icon={Tag} title="Etiquetas de góndola"
                    desc="Precio y código de barras, listas para imprimir en A4 desde el inventario.">
                    <LabelMini />
                </BentoCard>

                <BentoCard className="md:col-span-2" icon={Package} title="Kardex por producto"
                    desc="Cada entrada y salida queda registrada: compras, ventas, mermas y ajustes.">
                    <KardexMini />
                </BentoCard>
                <BentoCard className="md:col-span-2" delay={100} icon={AlertTriangle} title="Stock crítico"
                    desc="Ves de un vistazo qué se está por acabar y exportás el inventario a Excel.">
                    <StockMini />
                </BentoCard>
                <BentoCard className="md:col-span-2" delay={200} tone="dark" icon={Wallet} title="Caja y turnos"
                    desc="Apertura y cierre por cajero, ingresos y egresos, y lo cobrado separado por medio de pago.">
                    <CashMini />
                </BentoCard>

                <BentoCard className="md:col-span-2" icon={KeyRound} title="Cajeros con PIN"
                    desc="Cada empleado con su usuario. Las acciones sensibles del inventario piden PIN.">
                    <PinMini />
                </BentoCard>
                <BentoCard className="md:col-span-2" delay={100} icon={BookUser} title="Clientes y proveedores"
                    desc="Cuentas corrientes y compras, con saldos calculados desde los movimientos.">
                    <LedgerMini />
                </BentoCard>
                <BentoCard className="md:col-span-2" delay={200} icon={Building2} title="Sucursales y reportes"
                    desc="Cada sucursal con su stock y sus cajas, y reportes de ventas de todo el negocio.">
                    <BranchesMini />
                </BentoCard>

                <BentoCard className="md:col-span-3" icon={Undo2} title="Historial y devoluciones"
                    desc="Buscá cualquier venta, reimprimí el ticket o la factura A4 y hacé devoluciones parciales con nota de crédito en ARCA.">
                    <SalesHistoryMini />
                </BentoCard>
                <BentoCard className="md:col-span-3" delay={100} icon={Truck} title="Recepción de mercadería"
                    desc="Cargás la factura del proveedor: sube el stock y el costo se recalcula con promedio ponderado. Pagás en efectivo, transferencia, cheque o a cuenta.">
                    <PurchaseMini />
                </BentoCard>
            </div>
        </div>
    </section>
);

// --- OFFLINE ---

const OFFLINE_STEPS = [
    { icon: ShoppingCart, title: 'Vendés', desc: 'La venta se guarda primero en el equipo del local, al instante.', color: 'bg-brand text-white', glow: 'shadow-brand/50' },
    { icon: WifiOff, title: 'Se corta', desc: 'Seguís cobrando y descontando stock. Lo que no se pudo facturar queda como contingencia.', color: 'bg-amber-400 text-sys-900', glow: 'shadow-amber-400/50' },
    { icon: RefreshCw, title: 'Vuelve la red', desc: 'Las ventas pendientes se suben solas y el resto de las cajas y sucursales las ven.', color: 'bg-emerald-400 text-sys-900', glow: 'shadow-emerald-400/50' },
];

const Offline = () => {
    const [ref, inView] = useInView(0.3);
    const active = useCycle(OFFLINE_STEPS.length, 2200, inView);
    return (
        <section id="offline" className="relative py-20 lg:py-28 bg-sys-900 text-white noar-grid-dark overflow-hidden">
            <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full bg-brand/20 blur-[120px] pointer-events-none" />
            <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
                <div className="grid lg:grid-cols-2 gap-10 items-end mb-14">
                    <Reveal>
                        <Kicker icon={WifiOff} dark>Modo sin conexión</Kicker>
                        <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-[1.08]">
                            Se cortó internet.<br /><span className="text-orange-400">La caja sigue.</span>
                        </h2>
                    </Reveal>
                    <Reveal delay={150}>
                        <div className="flex items-center gap-4 text-white/60">
                            <span className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center"><HardDrive size={24} /></span>
                            <span className="flex-1 h-1 rounded-full text-orange-400/70 noar-flow" />
                            <span className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center"><Cloud size={24} /></span>
                        </div>
                        <p className="text-white/60 leading-relaxed mt-4">
                            El sistema trabaja con los datos del equipo y sincroniza con la nube en segundo plano.
                        </p>
                    </Reveal>
                </div>

                <div ref={ref} className="grid md:grid-cols-3 gap-4 relative">
                    {OFFLINE_STEPS.map((s, i) => {
                        const on = active === i;
                        return (
                            <Reveal key={s.title} delay={i * 150}>
                                <div className={`h-full rounded-3xl p-6 border transition-all duration-500 ${on ? 'bg-white/[.08] border-white/25 -translate-y-1' : 'bg-white/[.03] border-white/10'}`}>
                                    <div className="flex items-center justify-between mb-5">
                                        <span className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-500 ${s.color} ${on ? `scale-110 shadow-lg ${s.glow}` : 'opacity-70'}`}>
                                            <s.icon size={22} className={on && i === 2 ? 'animate-spin' : ''} style={{ animationDuration: '2s' }} />
                                        </span>
                                        <span className={`font-mono text-sm transition-colors ${on ? 'text-white' : 'text-white/30'}`}>0{i + 1}</span>
                                    </div>
                                    <h3 className="font-bold text-xl mb-2">{s.title}</h3>
                                    <p className="text-white/65 leading-relaxed">{s.desc}</p>
                                    <div className="mt-5 h-1 rounded-full bg-white/10 overflow-hidden">
                                        <div key={on ? `on-${active}` : 'off'} className="h-full bg-white/60 rounded-full" style={{ width: 0, animation: on ? 'noar-fill 2.2s linear forwards' : 'none' }} />
                                    </div>
                                </div>
                            </Reveal>
                        );
                    })}
                </div>
            </div>
        </section>
    );
};

// --- COBROS: QR real de Mercado Pago ---

const MercadoPagoScreen = () => {
    const [ref, inView] = useInView(0.3);
    const phase = useCycle(2, 3200, inView); // 0 = esperando, 1 = pagado
    const paid = phase === 1;
    return (
        <div ref={ref} className="relative mx-auto w-full max-w-sm">
            <div className="absolute -inset-8 rounded-[3rem] blur-3xl opacity-40 transition-colors duration-700" style={{ background: paid ? '#34d399' : MP_BLUE }} />
            <div className="relative bg-sys-900 rounded-[2.2rem] p-3 shadow-2xl noar-float">
                <div className="bg-white rounded-[1.7rem] overflow-hidden">
                    <div className="px-6 py-4 flex items-center justify-between text-white" style={{ background: MP_BLUE }}>
                        <span className="font-extrabold tracking-tight text-lg">mercado pago</span>
                        <QrCode size={20} />
                    </div>
                    <div className="p-6 text-center">
                        <p className="text-sm text-sys-500 mb-1">Total a cobrar</p>
                        <p className="text-4xl font-extrabold text-sys-900 tabular-nums mb-5">$ 17.625</p>

                        <div className="relative mx-auto w-48 h-48 p-3 rounded-2xl border-2 mb-5 transition-colors duration-500 bg-white" style={{ borderColor: paid ? '#10b981' : MP_BLUE }}>
                            <QRCode value={WHATSAPP_LINK} size={164} level="H" fgColor="#1A1A14" style={{ width: '100%', height: '100%' }} />
                            <span className="absolute inset-0 m-auto w-11 h-11 rounded-xl bg-white flex items-center justify-center shadow">
                                <span className="w-8 h-8 rounded-lg text-white text-[11px] font-black flex items-center justify-center" style={{ background: MP_BLUE }}>MP</span>
                            </span>
                            {!paid && <span className="noar-scanline" />}
                            {paid && (
                                <span className="absolute inset-0 rounded-xl bg-emerald-500/90 flex items-center justify-center">
                                    <CheckCircle2 size={64} className="text-white noar-check" />
                                </span>
                            )}
                        </div>

                        {paid ? (
                            <div key="paid" className="noar-pop flex items-center justify-center gap-2 text-sm font-semibold text-emerald-700 bg-emerald-50 rounded-xl py-2.5">
                                <CheckCircle2 size={16} /> ¡Pago recibido!
                            </div>
                        ) : (
                            <div key="wait" className="flex items-center justify-center gap-2 text-sm font-semibold rounded-xl py-2.5" style={{ color: MP_BLUE, background: `${MP_BLUE}14` }}>
                                <RefreshCw size={15} className="animate-spin" /> Esperando pago…
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <p className="relative text-xs text-sys-400 text-center mt-5">Ilustración · el QR es real: escanealo y te lleva a nuestro WhatsApp</p>
        </div>
    );
};

const Payments = () => (
    <section id="cobros" className="py-20 lg:py-28 bg-white overflow-hidden">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-16 items-center">
            <div>
                <Reveal>
                    <Kicker icon={QrCode}>Cobros</Kicker>
                    <h2 className="text-3xl md:text-5xl font-extrabold text-sys-900 tracking-tight leading-[1.08] mb-5">
                        El monto sale de la caja.<br /><span className="text-sys-400">No del teclado del posnet.</span>
                    </h2>
                    <p className="text-lg text-sys-600 leading-relaxed mb-8">
                        El importe viaja desde el sistema al QR o a la terminal, sin tipearlo dos veces.
                        Al cerrar el turno ves lo cobrado separado por cada medio.
                    </p>
                </Reveal>
                <ul className="space-y-3">
                    {[
                        { icon: QrCode, title: 'QR de Mercado Pago', desc: 'El pago se confirma en la pantalla de cobro, sin mirar el celular del cliente.' },
                        { icon: Smartphone, title: 'Point y Clover', desc: 'El monto llega a la terminal desde la caja.' },
                        { icon: Banknote, title: 'Efectivo, tarjeta y transferencia', desc: 'También como cobros manuales, mezclando medios en una misma venta.' },
                    ].map((p, i) => (
                        <Reveal key={p.title} delay={100 + i * 120}>
                            <li className="group flex gap-4 p-3 -mx-3 rounded-2xl hover:bg-sys-50 transition-colors">
                                <span className="w-11 h-11 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0 transition-all group-hover:bg-brand group-hover:text-white group-hover:-rotate-6">
                                    <p.icon size={20} />
                                </span>
                                <div>
                                    <h3 className="font-bold text-sys-900">{p.title}</h3>
                                    <p className="text-sys-600 text-sm leading-relaxed">{p.desc}</p>
                                </div>
                            </li>
                        </Reveal>
                    ))}
                </ul>
            </div>
            <Reveal delay={200}>
                <MercadoPagoScreen />
            </Reveal>
        </div>
    </section>
);

// --- REPORTES (dashboard ilustrativo) ---

const PERIODS = [
    { label: 'Hoy', ventas: 486200, utilidad: 131300, ganancia: 92400, bars: [30, 45, 62, 80, 55, 70, 90] },
    { label: 'Semana', ventas: 3150000, utilidad: 851000, ganancia: 598000, bars: [55, 62, 48, 75, 88, 95, 70] },
    { label: 'Mes', ventas: 13420000, utilidad: 3620000, ganancia: 2540000, bars: [60, 72, 65, 85, 78, 92, 88] },
];

const Kpi = ({ label, value, accent }) => {
    const v = useCountUp(value, 900);
    return (
        <div className="rounded-2xl bg-sys-50 border border-sys-100 p-3.5">
            <p className="text-[11px] font-medium text-sys-500 mb-1">{label}</p>
            <p className={`text-lg sm:text-xl font-extrabold tabular-nums ${accent}`}>{money(v)}</p>
        </div>
    );
};

const ReportsDashboard = () => {
    const [ref, inView] = useInView(0.3);
    const p = useCycle(PERIODS.length, 3200, inView);
    const period = PERIODS[inView ? p : 0];
    return (
        <div ref={ref} className="relative">
            <div className="absolute -inset-6 bg-brand/10 rounded-[2.5rem] blur-3xl" />
            <div className="relative bg-white rounded-3xl border border-sys-200 shadow-[0_30px_70px_-30px_rgba(26,26,20,.35)] p-5">
                <div className="flex items-center justify-between mb-5">
                    <p className="font-bold text-sys-900 flex items-center gap-2"><BarChart3 size={18} className="text-brand" /> Reportes</p>
                    <div className="flex bg-sys-100 rounded-xl p-1 text-xs font-semibold">
                        {PERIODS.map((x, i) => (
                            <span key={x.label} className={`px-3 py-1.5 rounded-lg transition-all duration-300 ${period === PERIODS[i] ? 'bg-white text-sys-900 shadow-sm' : 'text-sys-500'}`}>{x.label}</span>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-2.5 mb-5">
                    <Kpi label="Ventas netas" value={inView ? period.ventas : 0} accent="text-sys-900" />
                    <Kpi label="Utilidad bruta" value={inView ? period.utilidad : 0} accent="text-sky-700" />
                    <Kpi label="Ganancia neta" value={inView ? period.ganancia : 0} accent="text-emerald-600" />
                </div>

                <div className="flex items-end gap-2 h-32 px-1 mb-2">
                    {period.bars.map((h, i) => (
                        <div key={i} className="flex-1 h-full flex items-end">
                            <div
                                className={`w-full rounded-t-lg transition-all duration-700 ease-out ${i === period.bars.length - 1 ? 'bg-brand' : 'bg-sys-200'}`}
                                style={{ height: inView ? `${h}%` : '4%', transitionDelay: `${i * 60}ms` }}
                            />
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-2 gap-2.5 mt-4">
                    <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 px-3 py-2.5">
                        <BookUser size={16} className="text-emerald-600" />
                        <div><p className="text-[11px] text-sys-500">Por cobrar a clientes</p><p className="text-sm font-bold text-sys-900">$ 184.300</p></div>
                    </div>
                    <div className="flex items-center gap-2.5 rounded-xl bg-red-50 px-3 py-2.5">
                        <Truck size={16} className="text-red-500" />
                        <div><p className="text-[11px] text-sys-500">Por pagar a proveedores</p><p className="text-sm font-bold text-sys-900">$ 412.000</p></div>
                    </div>
                </div>
            </div>
            <p className="relative text-xs text-sys-400 text-center mt-4">Datos de ejemplo</p>
        </div>
    );
};

const REPORT_POINTS = [
    { icon: TrendingUp, text: 'Ventas netas, costo de mercadería, utilidad bruta y ganancia neta.' },
    { icon: Trash2, text: 'Gastos operativos y pérdidas por mermas, separados.' },
    { icon: ArrowLeftRight, text: 'Lo que te deben los clientes y lo que les debés a los proveedores.' },
    { icon: Package, text: 'Ranking de productos más vendidos.' },
    { icon: CalendarClock, text: 'Cierre Z de cada turno, con el detalle por medio de pago.' },
];

const Reports = () => (
    <section id="reportes" className="py-20 lg:py-28 bg-sys-50 overflow-hidden">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-14 items-center">
            <Reveal delay={150} className="order-2 lg:order-1">
                <ReportsDashboard />
            </Reveal>
            <div className="order-1 lg:order-2">
                <Reveal>
                    <Kicker icon={BarChart3}>Reportes</Kicker>
                    <h2 className="text-3xl md:text-5xl font-extrabold text-sys-900 tracking-tight leading-[1.08] mb-5">
                        Sabé cuánto ganaste.<br /><span className="text-sys-400">No cuánto creés.</span>
                    </h2>
                    <p className="text-lg text-sys-600 leading-relaxed mb-7">
                        Como cada venta, compra y gasto pasa por el sistema, los números salen solos. Por día, semana o mes, y por sucursal.
                    </p>
                </Reveal>
                <ul className="space-y-2">
                    {REPORT_POINTS.map((r, i) => (
                        <Reveal key={r.text} delay={80 + i * 80}>
                            <li className="group flex items-center gap-3.5 p-2.5 -mx-2.5 rounded-xl hover:bg-white transition-colors">
                                <span className="w-9 h-9 rounded-xl bg-white border border-sys-200 text-brand flex items-center justify-center shrink-0 transition-all group-hover:bg-brand group-hover:text-white group-hover:border-brand group-hover:-rotate-6">
                                    <r.icon size={17} />
                                </span>
                                <span className="text-sys-700">{r.text}</span>
                            </li>
                        </Reveal>
                    ))}
                </ul>
            </div>
        </div>
    </section>
);

// --- HARDWARE ---

const HARDWARE = [
    { icon: Monitor, label: 'PC o notebook' },
    { icon: Smartphone, label: 'Tablet o celular' },
    { icon: Printer, label: 'Impresora térmica' },
    { icon: ScanBarcode, label: 'Lector de códigos' },
    { icon: Scale, label: 'Productos por peso' },
    { icon: Download, label: 'Instalable como app' },
];

const Hardware = () => (
    <section className="py-20 bg-sys-50 border-y border-sys-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <Reveal className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
                <div>
                    <Kicker icon={Plug}>Equipos</Kicker>
                    <h2 className="text-3xl md:text-4xl font-extrabold text-sys-900 tracking-tight">Funciona con lo que ya tenés</h2>
                </div>
                <p className="text-sys-600 max-w-sm">Corre en el navegador. No hay que instalar programas ni comprar una computadora especial.</p>
            </Reveal>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {HARDWARE.map((h, i) => (
                    <Reveal key={h.label} delay={i * 70}>
                        <div onMouseMove={trackSpot} className="noar-spot group h-full bg-white border border-sys-200 rounded-2xl p-5 flex flex-col items-start gap-6 hover:border-brand/40 hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
                            <h.icon size={30} strokeWidth={1.5} className="relative text-sys-700 group-hover:text-brand group-hover:scale-110 group-hover:-rotate-6 transition-all duration-300" />
                            <span className="relative text-sm font-semibold text-sys-800">{h.label}</span>
                        </div>
                    </Reveal>
                ))}
            </div>
        </div>
    </section>
);

// --- FAQ ---

const AccordionItem = ({ icon: Icon, question, answer }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <div className={`rounded-2xl border transition-all duration-300 ${isOpen ? 'bg-white border-sys-300 shadow-lg shadow-sys-900/5' : 'bg-white/60 border-sys-200 hover:bg-white'}`}>
            <button className="w-full p-5 flex items-center gap-4 text-left" onClick={() => setIsOpen(!isOpen)}>
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300 ${isOpen ? 'bg-brand text-white -rotate-6' : 'bg-sys-100 text-sys-600'}`}>
                    <Icon size={17} />
                </span>
                <span className="font-semibold text-sys-900 flex-1">{question}</span>
                <ChevronDown size={20} className={`shrink-0 text-sys-400 transition-transform duration-300 ${isOpen ? 'rotate-180 text-brand' : ''}`} />
            </button>
            <div className={`grid transition-all duration-300 ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                <div className="overflow-hidden">
                    <p className="text-sys-600 leading-relaxed px-5 pb-5 sm:pl-[4.5rem]">{answer}</p>
                </div>
            </div>
        </div>
    );
};

const FAQS = [
    { icon: ArrowRight, q: '¿Cómo empiezo?', a: 'Nos escribís por WhatsApp, te creamos la cuenta y te ayudamos a cargar tus productos. No hay que instalar nada: entrás desde el navegador.' },
    { icon: Monitor, q: '¿Qué computadora necesito?', a: 'Cualquier equipo con un navegador actualizado (recomendamos Chrome). Si tenés un catálogo de varios miles de productos, conviene una PC con algo de memoria para que la búsqueda vaya fluida.' },
    { icon: WifiOff, q: '¿Qué pasa si se cae internet o ARCA?', a: 'Seguís vendiendo. Las ventas quedan guardadas en el equipo y se suben cuando vuelve la conexión. Los comprobantes que ARCA no pudo autorizar quedan como contingencia para facturarlos después.' },
    { icon: Sparkles, q: '¿Qué puede hacer el asistente de WhatsApp?', a: 'Cargar compras a proveedores, cambiar precios, ajustar stock por roturas o conteos y registrar pagos a proveedores. Todo queda en el sistema con las mismas reglas que si lo hicieras desde la app. Lo que tiene que ver con la caja del turno lo seguís manejando desde la app.' },
    { icon: Building2, q: '¿Sirve si tengo más de una sucursal?', a: 'Sí. Cada sucursal tiene su propio stock, sus cajas y sus usuarios, y desde la misma cuenta ves todo.' },
    { icon: BarChart3, q: '¿Cuánto cuesta?', a: 'Depende de cuántas cajas y sucursales tengas. Escribinos y te pasamos el precio para tu caso.' },
    { icon: MessageCircle, q: '¿Cómo es el soporte?', a: 'Por WhatsApp, con el mismo equipo que desarrolla el sistema.' },
];

const FAQ = () => (
    <section id="faq" className="py-20 lg:py-28 bg-sys-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
            <Reveal>
                <h2 className="text-3xl md:text-4xl font-extrabold text-sys-900 tracking-tight mb-10 text-center">Preguntas frecuentes</h2>
            </Reveal>
            <div className="space-y-3">
                {FAQS.map((f, i) => (
                    <Reveal key={f.q} delay={i * 70}>
                        <AccordionItem icon={f.icon} question={f.q} answer={f.a} />
                    </Reveal>
                ))}
            </div>
        </div>
    </section>
);

// --- CTA: ticket que se imprime ---

const CTA = () => {
    const [ref, inView] = useInView(0.35);
    return (
        <section className="py-20 lg:py-28 bg-white">
            <div ref={ref} className="max-w-3xl mx-auto px-4 sm:px-6">
                {/* Ranura de la impresora */}
                <div className="relative z-10 mx-auto h-5 w-[calc(100%+2rem)] -ml-4 rounded-full bg-sys-200 shadow-inner border border-sys-300" />
                <div className="relative -mt-2.5 overflow-hidden px-2 pb-4">
                    <div style={{ animation: inView ? 'noar-print 1.6s cubic-bezier(.3,.7,.2,1) both' : 'none', transform: inView ? undefined : 'translateY(-101%)' }}>
                        <div className="bg-sys-900 text-white px-6 sm:px-12 pt-14 pb-10 text-center shadow-2xl">
                            <Receipt size={36} className="mx-auto text-orange-400 mb-5" />
                            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">¿Lo querés ver funcionando?</h2>
                            <p className="text-white/65 text-lg mb-8 max-w-lg mx-auto">
                                Te mostramos el sistema con productos parecidos a los de tu comercio y resolvemos tus dudas.
                            </p>
                            <div className="flex justify-center">
                                <CtaButton onClick={openWhatsapp}><MessageCircle size={18} /> Escribinos por WhatsApp</CtaButton>
                            </div>
                            <div className="mt-10 pt-6 border-t border-dashed border-white/15 font-mono text-xs text-white/40 space-y-1.5">
                                <div className="flex justify-between"><span>NOAR POS</span><span>CONSULTA</span></div>
                                <div className="flex justify-between"><span>DEMO PERSONALIZADA</span><span>SIN CARGO</span></div>
                            </div>
                            <Barcode seed="5493804373795" className="w-40 h-8 mx-auto mt-6 text-white/30" />
                        </div>
                        <div className="noar-ticket-edge h-2.5 rotate-180" />
                    </div>
                </div>
            </div>
        </section>
    );
};

const FloatingWhatsapp = () => {
    const [show, setShow] = useState(false);
    useEffect(() => {
        const onScroll = () => setShow(window.scrollY > 600);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);
    return (
        <button
            onClick={openWhatsapp}
            aria-label="Escribinos por WhatsApp"
            className={`fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full bg-[#25D366] text-white shadow-xl shadow-[#25D366]/40 flex items-center justify-center transition-all duration-500 hover:scale-110 ${show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6 pointer-events-none'}`}
        >
            <span className="absolute inset-0 rounded-full bg-[#25D366] animate-ping opacity-30" />
            <MessageCircle size={26} className="relative" />
        </button>
    );
};

const Footer = () => (
    <footer className="bg-sys-900 text-white/60 py-10 text-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2.5">
                <BrandLogo dark />
                <span className="font-bold text-white">Noar<span className="text-orange-400">POS</span></span>
            </div>
            <div className="flex flex-wrap justify-center gap-6">
                <a href="#funciones" className="hover:text-white transition-colors">Funciones</a>
                <a href="#offline" className="hover:text-white transition-colors">Sin internet</a>
                <a href="#cobros" className="hover:text-white transition-colors">Cobros</a>
                <a href={WHATSAPP_LINK} target="_blank" rel="noreferrer" className="hover:text-white transition-colors">Contacto</a>
            </div>
            <span>© {new Date().getFullYear()} Noar Technology · Hecho en Argentina</span>
        </div>
    </footer>
);

export const LandingPage = () => {
    return (
        <div className="min-h-screen bg-white font-sans text-sys-900 scroll-smooth overflow-x-hidden">
            <LandingStyles />
            <ScrollProgress />
            <Navbar />
            <Hero />
            <PaymentsMarquee />
            <Clients />
            <AiAssistant />
            <Features />
            <Offline />
            <Payments />
            <Reports />
            <BigWordsBand />
            <Hardware />
            <FAQ />
            <CTA />
            <Footer />
            <FloatingWhatsapp />
        </div>
    );
};
