import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    QrCode, Zap, Receipt, CheckCircle2, 
    ArrowRight, Store, Smartphone, 
    CreditCard, Lock, ShieldCheck, TrendingUp,
    Printer, ScanBarcode, Users, Package,
    AlertTriangle, ChevronDown, ChevronUp,
    LayoutDashboard, Database, BarChart3, Cloud, MessageCircle 
} from 'lucide-react';
import { Button } from '../../../core/ui/Button';

// --- CONFIGURACIÓN DE CONTACTO ---
const WHATSAPP_NUMBER = "5493804373795"; 
// Mensaje ajustado para consulta de precio
const WHATSAPP_MESSAGE = "Hola, me interesa el sistema Noar POS. Quisiera consultar el precio y conocer las promociones vigentes.";
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

// --- COMPONENTES UI ---

const Badge = ({ icon: Icon, text, color = "blue" }) => {
    const colors = {
        blue: "bg-blue-50 text-blue-700 border-blue-200",
        green: "bg-green-50 text-green-700 border-green-200",
        purple: "bg-purple-50 text-purple-700 border-purple-200",
        orange: "bg-orange-50 text-orange-700 border-orange-200",
    };
    return (
        <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider ${colors[color]}`}>
            <Icon size={12} /> {text}
        </div>
    );
};

// 🔥 NUEVO LOGO GRÁFICO DEFINITIVO (SVG NATIVO)
const BrandLogo = ({ size = "md" }) => {
    const containerSize = size === "lg" ? "w-12 h-12" : "w-10 h-10";
    
    return (
        <div className={`${containerSize} bg-sys-900 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20 relative overflow-hidden group`}>
            {/* Fondo sutil interno */}
            <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            
            <svg viewBox="0 0 24 24" className="w-3/5 h-3/5" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Pata Izquierda */}
                <path d="M7 4V20" stroke="white" strokeWidth="4" strokeLinecap="round" />
                {/* Pata Derecha */}
                <path d="M17 4V20" stroke="white" strokeWidth="4" strokeLinecap="round" />
                {/* Diagonal (Color Brand - Azul Eléctrico) */}
                <path d="M7 4L17 20" stroke="#3b82f6" strokeWidth="4" strokeLinecap="round" />
            </svg>
        </div>
    );
};

const FeatureItem = ({ icon: Icon, title, desc }) => (
    <div className="flex gap-4 items-start">
        <div className="mt-1 p-2 bg-sys-50 rounded-lg text-brand shrink-0">
            <Icon size={20} />
        </div>
        <div>
            <h4 className="font-bold text-sys-900 text-sm">{title}</h4>
            <p className="text-xs text-sys-500 leading-relaxed mt-1">{desc}</p>
        </div>
    </div>
);

const AccordionItem = ({ question, answer }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <div className="border-b border-sys-200">
            <button 
                className="w-full py-4 flex justify-between items-center text-left hover:text-brand transition-colors"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className="font-bold text-sys-800 text-sm md:text-base">{question}</span>
                {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            <div className={`overflow-hidden transition-all duration-300 ${isOpen ? 'max-h-96 pb-4' : 'max-h-0'}`}>
                <p className="text-sys-500 text-sm leading-relaxed pr-4">{answer}</p>
            </div>
        </div>
    );
};

// --- SECCIONES PRINCIPALES ---

const Navbar = () => {
    const navigate = useNavigate();
    return (
        <nav className="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-md border-b border-sys-100 z-50 shadow-sm">
            <div className="max-w-7xl mx-auto px-6 py-3 flex justify-between items-center">
                <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => window.scrollTo(0,0)}>
                    <BrandLogo size="md" />
                    <span className="font-sans font-black text-xl tracking-tight text-sys-900">
                        NOAR<span className="text-brand">POS</span>
                    </span>
                </div>
                <div className="hidden md:flex gap-8 text-sm font-bold text-sys-500">
                    <a href="#payments" className="hover:text-brand transition-colors">Cobros</a>
                    <a href="#fiscal" className="hover:text-brand transition-colors">Fiscal</a>
                    <a href="#stock" className="hover:text-brand transition-colors">Stock</a>
                    <a href="#pricing" className="hover:text-brand transition-colors">Precios</a>
                </div>
                <Button 
                    size="sm"
                    className="bg-brand hover:bg-brand-hover text-white shadow-lg shadow-brand/20 transition-all hover:-translate-y-0.5 font-bold px-6"
                    onClick={() => navigate('/login')}
                >
                    Acceso Clientes
                </Button>
            </div>
        </nav>
    );
};

const Hero = () => {
    return (
        <header className="relative pt-32 pb-20 lg:pt-40 lg:pb-24 overflow-hidden bg-white">
            <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-gradient-to-bl from-blue-50/50 to-transparent rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
            
            <div className="container mx-auto px-6 relative z-10">
                <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
                    
                    {/* Texto Hero */}
                    <div className="flex-1 text-center lg:text-left">
                        <Badge icon={ShieldCheck} text="Integración Oficial Mercado Pago" color="blue" />
                        
                        <h1 className="text-4xl md:text-6xl font-black text-sys-900 tracking-tight mt-6 mb-6 leading-[1.1]">
                            El Fin de las <br/>
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
                                Transferencias Fantasma.
                            </span>
                        </h1>
                        
                        <p className="text-lg text-sys-500 mb-8 leading-relaxed max-w-2xl mx-auto lg:mx-0">
                            Un Sistema de Punto de Venta (PDV) que <strong>verifica cada pago automáticamente</strong>. 
                            QR integrado, Facturación ARCA nativa y Control de Stock.
                            <br/>
                            <span className="font-semibold text-sys-800 block mt-2">
                                Dejá de mirar el celular del cliente. Mirá tu sistema.
                            </span>
                        </p>

                        <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                            <Button 
                                className="h-12 px-8 text-base bg-sys-900 hover:bg-black text-white shadow-xl hover:-translate-y-1 transition-transform flex items-center justify-center gap-2"
                                onClick={() => window.open(WHATSAPP_LINK, '_blank')}
                            >
                                <MessageCircle size={20} /> Solicitar Demo
                            </Button>
                            <Button 
                                variant="secondary"
                                className="h-12 px-8 text-base bg-white border border-sys-200 text-sys-700 hover:bg-sys-50"
                                onClick={() => document.getElementById('pricing').scrollIntoView({ behavior: 'smooth' })}
                            >
                                Ver Planes
                            </Button>
                        </div>
                        
                        <div className="mt-8 flex flex-wrap items-center justify-center lg:justify-start gap-4 text-xs text-sys-400 font-medium">
                            <span className="flex items-center gap-1"><CheckCircle2 size={14} className="text-green-500"/> Alta inmediata</span>
                            <span className="hidden sm:inline">•</span>
                            <span className="flex items-center gap-1"><CheckCircle2 size={14} className="text-green-500"/> Instalación remota</span>
                            <span className="hidden sm:inline">•</span>
                            <span className="flex items-center gap-1"><CheckCircle2 size={14} className="text-green-500"/> Soporte personalizado</span>
                        </div>
                    </div>

                    {/* Mockup Visual */}
                    <div className="w-full lg:w-[45%] relative">
                        <div className="absolute inset-0 bg-gradient-to-tr from-brand to-purple-600 rounded-[2rem] rotate-3 opacity-20 blur-xl"></div>
                        <div className="bg-white border border-sys-200 rounded-[2rem] shadow-2xl p-6 relative rotate-0 hover:rotate-1 transition-transform duration-500 select-none">
                            {/* Header Fake */}
                            <div className="flex justify-between items-center mb-6 border-b pb-4">
                                <div className="flex gap-2">
                                    <div className="w-3 h-3 rounded-full bg-red-400"></div>
                                    <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                                    <div className="w-3 h-3 rounded-full bg-green-400"></div>
                                </div>
                                <div className="text-xs font-mono text-sys-400">DASHBOARD_V2.exe</div>
                            </div>
                            
                            {/* Content Fake */}
                            <div className="space-y-4">
                                <div className="flex gap-4">
                                    <div className="w-2/3 bg-blue-50 p-4 rounded-xl border border-blue-100 relative overflow-hidden">
                                        <div className="flex items-center gap-2 mb-2 relative z-10">
                                            <QrCode size={16} className="text-blue-600"/>
                                            <span className="text-xs font-bold text-blue-700 uppercase">Esperando Pago...</span>
                                        </div>
                                        <div className="h-2 bg-blue-200 rounded-full w-full animate-pulse mb-3 relative z-10"></div>
                                        <div className="text-2xl font-black text-sys-900 relative z-10">$ 12.500,00</div>
                                        {/* Efecto de escaneo */}
                                        <div className="absolute top-0 left-0 w-full h-1 bg-blue-400/50 animate-[scan_2s_ease-in-out_infinite]"></div>
                                    </div>
                                    <div className="w-1/3 bg-sys-50 p-4 rounded-xl border border-sys-100 flex flex-col items-center justify-center">
                                        <Receipt size={24} className="text-sys-400 mb-1"/>
                                        <span className="text-[10px] font-bold text-sys-500 text-center leading-tight">ARCA<br/>Listo</span>
                                    </div>
                                </div>
                                <div className="bg-sys-900 text-white p-4 rounded-xl flex justify-between items-center shadow-lg">
                                    <div>
                                        <p className="text-xs text-white/60 uppercase tracking-wider">Caja Actual</p>
                                        <p className="font-bold text-lg">$ 45.200</p>
                                    </div>
                                    <CheckCircle2 className="text-green-400" />
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </header>
    );
};

const DetailedFeatures = () => (
    <section className="py-24 bg-sys-50">
        <div className="container mx-auto px-6">
            
            {/* BLOQUE 1: MERCADO PAGO */}
            <div id="payments" className="flex flex-col md:flex-row items-center gap-12 mb-32 scroll-mt-24">
                <div className="w-full md:w-1/2 order-2 md:order-1">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-sys-200 hover:shadow-md transition-shadow">
                            <QrCode size={32} className="text-blue-500 mb-4"/>
                            <h4 className="font-bold text-sys-900 mb-2">QR Dinámico</h4>
                            <p className="text-xs text-sys-500 leading-relaxed">El sistema genera un QR único por venta en la pantalla. El cliente escanea y paga. Vos ves la confirmación al instante.</p>
                        </div>
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-sys-200 hover:shadow-md transition-shadow">
                            <CreditCard size={32} className="text-blue-500 mb-4"/>
                            <h4 className="font-bold text-sys-900 mb-2">Point Smart</h4>
                            <p className="text-xs text-sys-500 leading-relaxed">Enviá el monto directo al posnet Point. Evitá errores de tipeo manual por parte del cajero.</p>
                        </div>
                        <div className="col-span-2 bg-blue-600 text-white p-6 rounded-2xl shadow-lg relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10"></div>
                            <h4 className="font-bold text-lg flex items-center gap-2 mb-2 relative z-10">
                                <ShieldCheck /> Anti-Fraude Total
                            </h4>
                            <p className="text-sm opacity-90 relative z-10">
                                El sistema NO imprime el ticket ni finaliza la venta hasta que Mercado Pago confirma que el dinero ingresó a tu cuenta. 
                                <br/><span className="font-bold underline decoration-yellow-400 decoration-2 underline-offset-2">Adiós a las capturas falsas.</span>
                            </p>
                        </div>
                    </div>
                </div>
                <div className="w-full md:w-1/2 order-1 md:order-2">
                    <Badge icon={Smartphone} text="Pagos Digitales" color="blue" />
                    <h2 className="text-3xl md:text-4xl font-black text-sys-900 mt-4 mb-6">
                        Cobrá seguro.<br/>Sin confiar en la palabra de nadie.
                    </h2>
                    <p className="text-sys-500 text-lg leading-relaxed mb-6">
                        Integramos Mercado Pago de forma nativa. No necesitás salir del sistema, abrir la app en tu celular y verificar si llegó la plata. 
                        <strong>Noar POS lo hace por vos.</strong>
                    </p>
                    <ul className="space-y-3">
                        <li className="flex gap-3 items-center text-sys-700 font-medium">
                            <CheckCircle2 size={18} className="text-green-500" /> Acreditación Inmediata
                        </li>
                        <li className="flex gap-3 items-center text-sys-700 font-medium">
                            <CheckCircle2 size={18} className="text-green-500" /> Conciliación automática de caja
                        </li>
                        <li className="flex gap-3 items-center text-sys-700 font-medium">
                            <CheckCircle2 size={18} className="text-green-500" /> Compatible con todas las billeteras
                        </li>
                    </ul>
                </div>
            </div>

            {/* BLOQUE 2: ARCA / AFIP */}
            <div id="fiscal" className="flex flex-col md:flex-row items-center gap-12 mb-32 scroll-mt-24">
                <div className="w-full md:w-1/2">
                    <Badge icon={Receipt} text="Facturación Electrónica" color="purple" />
                    <h2 className="text-3xl md:text-4xl font-black text-sys-900 mt-4 mb-6">
                        ARCA Nativo.<br/>Facturá sin entrar a la web de AFIP.
                    </h2>
                    <p className="text-sys-500 text-lg leading-relaxed mb-6">
                        Olvidate de que se "caiga la página". Nuestro sistema gestiona los tokens de autorización automáticamente.
                        Emití Facturas A, B y C, Notas de Crédito y Débito en un clic.
                    </p>
                    <div className="space-y-4">
                        <FeatureItem 
                            icon={Zap} 
                            title="Facturación Selectiva" 
                            desc="Vos elegís qué ventas fiscalizar y cuáles no. Tené el control total de tu facturación mensual." 
                        />
                        <FeatureItem 
                            icon={BarChart3} 
                            title="Monitor de Límites" 
                            desc="Un panel te muestra cuánto llevás facturado en el día y en el mes para que no te pases de categoría." 
                        />
                    </div>
                </div>
                <div className="w-full md:w-1/2">
                    <div className="bg-white p-8 rounded-3xl border border-sys-200 shadow-xl relative">
                        <div className="absolute -top-4 -right-4 bg-purple-600 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-lg uppercase tracking-wide">
                            Autorizado por ARCA
                        </div>
                        <div className="font-mono text-xs text-sys-400 mb-4 border-b pb-2">PREVISUALIZACIÓN DE TICKET</div>
                        <div className="flex justify-center mb-6">
                            <div className="bg-white border-2 border-sys-100 p-4 w-64 shadow-inner relative">
                                <div className="flex justify-center mb-4 opacity-50"><QrCode size={64}/></div>
                                <div className="space-y-2">
                                    <div className="h-2 bg-sys-100 w-full rounded"></div>
                                    <div className="h-2 bg-sys-100 w-3/4 rounded"></div>
                                    <div className="h-2 bg-sys-100 w-1/2 rounded"></div>
                                </div>
                                <div className="mt-4 pt-4 border-t border-dashed border-sys-200">
                                    <div className="flex justify-between font-bold text-sys-900">
                                        <span>TOTAL</span>
                                        <span>$ 15.400</span>
                                    </div>
                                    <div className="mt-2 text-[9px] text-center text-sys-400">
                                        CAE: 73412345678901<br/>Vto: 20/05/2026
                                    </div>
                                </div>
                                {/* Sello de agua */}
                                <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
                                    <Receipt size={100} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* BLOQUE 3: OPERATIVO (STOCK, CAJA) */}
            <div id="stock" className="bg-sys-900 rounded-[3rem] p-8 md:p-16 text-white shadow-2xl relative overflow-hidden">
                {/* Decoración de fondo */}
                <div className="absolute top-0 left-0 w-96 h-96 bg-brand/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"></div>
                
                <div className="text-center max-w-3xl mx-auto mb-16 relative z-10">
                    <h2 className="text-3xl md:text-4xl font-black mb-6">Gestión Integral del Negocio</h2>
                    <p className="text-white/60 text-lg">
                        Noar POS no es solo para cobrar. Es para administrar.
                        Desde el control de inventario hasta la auditoría de tus empleados.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative z-10">
                    <div className="bg-white/5 backdrop-blur-sm p-8 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors">
                        <Package size={32} className="text-brand mb-4" />
                        <h4 className="text-xl font-bold mb-3">Control de Stock</h4>
                        <p className="text-sm text-white/60 leading-relaxed">
                            Manejá inventario por unidades o peso (ideal fiambrerías).
                            Alertas de stock bajo. Historial de movimientos (Kardex) para detectar robos hormiga.
                        </p>
                    </div>
                    <div className="bg-white/5 backdrop-blur-sm p-8 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors">
                        <Lock size={32} className="text-red-400 mb-4" />
                        <h4 className="text-xl font-bold mb-3">Cierre de Caja Ciego</h4>
                        <p className="text-sm text-white/60 leading-relaxed">
                            Tus empleados no ven cuánto debería haber en caja.
                            Ellos declaran lo que tienen, y el sistema te avisa a vos si falta plata (Arqueo Automático).
                        </p>
                    </div>
                    <div className="bg-white/5 backdrop-blur-sm p-8 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors">
                        <Store size={32} className="text-blue-400 mb-4" />
                        <h4 className="text-xl font-bold mb-3">Multi-Sucursal</h4>
                        <p className="text-sm text-white/60 leading-relaxed">
                            ¿Tenés más de un local? Gestioná todo desde una sola cuenta maestra.
                            Entrá con tu URL personalizada: <code>/sucursal-centro</code> o <code>/sucursal-norte</code>.
                        </p>
                    </div>
                </div>
            </div>

        </div>
    </section>
);

const HardwareSection = () => (
    <section id="hardware" className="py-20 bg-white border-t border-sys-200">
        <div className="container mx-auto px-6">
            <div className="flex flex-col md:flex-row gap-12 items-center">
                <div className="flex-1">
                    <h2 className="text-3xl font-black text-sys-900 mb-6">Compatible con todo tu Hardware</h2>
                    <p className="text-sys-500 mb-8 text-lg">
                        No necesitás comprar equipos caros. Noar POS funciona en cualquier navegador web.
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex items-center gap-3 p-3 bg-sys-50 rounded-xl">
                            <Printer className="text-sys-400"/> 
                            <span className="font-medium text-sys-700 text-sm">Impresoras Térmicas (80mm/58mm)</span>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-sys-50 rounded-xl">
                            <ScanBarcode className="text-sys-400"/> 
                            <span className="font-medium text-sys-700 text-sm">Lectores de Código de Barras</span>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-sys-50 rounded-xl">
                            <Smartphone className="text-sys-400"/> 
                            <span className="font-medium text-sys-700 text-sm">Celulares y Tablets</span>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-sys-50 rounded-xl">
                            <LayoutDashboard className="text-sys-400"/> 
                            <span className="font-medium text-sys-700 text-sm">PCs de Escritorio y Notebooks</span>
                        </div>
                    </div>
                </div>
                <div className="flex-1 bg-sys-50 p-8 rounded-3xl border border-sys-200 shadow-sm">
                    <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                        <AlertTriangle className="text-orange-500" /> ¿Y si se corta Internet?
                    </h3>
                    <p className="text-sys-600 text-sm mb-6 leading-relaxed">
                        Ahí entra nuestra tecnología <strong>Resilience</strong>. El sistema está diseñado para Argentina.
                    </p>
                    <div className="bg-white p-4 rounded-xl border border-sys-100 shadow-sm flex gap-4 items-start">
                        <div className="p-2 bg-red-50 rounded-lg text-red-500 shrink-0">
                            <Cloud size={20} />
                        </div>
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <span className="text-xs font-bold text-red-500 uppercase flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span> Modo Offline
                                </span>
                            </div>
                            <p className="text-xs text-sys-500 leading-relaxed">
                                El sistema detecta el corte y guarda todas las ventas en la memoria interna del dispositivo. 
                                Seguís cobrando y descontando stock. Cuando vuelve la red, todo se sube a la nube solo.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>
);

const PricingSection = () => (
    <section id="pricing" className="py-24 bg-sys-50">
        <div className="container mx-auto px-6 text-center">
            <h2 className="text-3xl md:text-4xl font-black text-sys-900 mb-12">Planes y Precios</h2>
            <div className="max-w-2xl mx-auto bg-white rounded-3xl p-12 shadow-xl border border-sys-200 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-brand to-purple-600"></div>
                
                <Badge icon={Store} text="Licencia de por vida" color="purple" />
                
                <h3 className="text-3xl font-black mt-6 mb-2 text-sys-900">Pago Único</h3>
                <p className="text-sys-500 mb-8 max-w-md mx-auto">
                    Olvidate de las suscripciones mensuales. Pagás una vez y el sistema es tuyo para siempre.
                </p>
                
                {/* 🔥 CAMBIO: PRECIO OCULTO -> CONSULTAR PRECIO */}
                <div className="flex flex-col items-center justify-center gap-2 mb-8">
                    <span className="text-4xl sm:text-5xl font-black text-brand tracking-tight">CONSULTAR PRECIO</span>
                    <span className="text-sm font-bold text-sys-400 uppercase mt-2">Promociones Disponibles</span>
                </div>

                <div className="grid grid-cols-2 gap-4 text-left max-w-sm mx-auto mb-10">
                    <div className="flex items-center gap-2 text-sm text-sys-600 font-medium">
                        <CheckCircle2 size={16} className="text-green-500"/> Instalación Remota
                    </div>
                    <div className="flex items-center gap-2 text-sm text-sys-600 font-medium">
                        <CheckCircle2 size={16} className="text-green-500"/> Capacitación
                    </div>
                    <div className="flex items-center gap-2 text-sm text-sys-600 font-medium">
                        <CheckCircle2 size={16} className="text-green-500"/> Módulos Full
                    </div>
                    <div className="flex items-center gap-2 text-sm text-sys-600 font-medium">
                        <CheckCircle2 size={16} className="text-green-500"/> Soporte x 1 año
                    </div>
                </div>

                <Button 
                    className="mx-auto h-14 px-12 text-lg bg-sys-900 hover:bg-black text-white shadow-xl w-full sm:w-auto flex items-center justify-center gap-2 transition-transform hover:-translate-y-1"
                    onClick={() => window.open(WHATSAPP_LINK, '_blank')}
                >
                    <MessageCircle size={20} /> Hablar con un Asesor
                </Button>
                
                <p className="mt-6 text-xs text-sys-400">
                    *Consultá por planes para vendedores y distribuidores.
                </p>
            </div>
        </div>
    </section>
);

const FAQ = () => (
    <section className="py-20 bg-white">
        <div className="container mx-auto px-6 max-w-3xl">
            <h2 className="text-3xl font-black text-center text-sys-900 mb-12">Preguntas Frecuentes</h2>
            <div className="space-y-2">
                <AccordionItem 
                    question="¿Cómo accedo a mi cuenta?" 
                    answer="Nosotros realizamos la instalación y te entregamos tu usuario y contraseña. Una vez que tengas tus credenciales, podés ingresar desde el botón 'Acceso Clientes'." 
                />
                <AccordionItem 
                    question="¿Necesito instalar algo en mi PC?" 
                    answer="No. Noar POS es un sistema web. Funciona en cualquier dispositivo con Google Chrome (PC, Tablet o Celular) sin instalaciones complicadas." 
                />
                <AccordionItem 
                    question="¿Cómo funciona la integración con Mercado Pago?" 
                    answer="Vinculamos tu cuenta de Mercado Pago al sistema. Al cobrar, el sistema genera el QR o envía la orden al Point. Una vez que el cliente paga, el sistema recibe la señal de 'Aprobado' automáticamente." 
                />
                <AccordionItem 
                    question="¿Qué pasa si tengo problemas técnicos?" 
                    answer="El plan incluye soporte técnico personalizado por WhatsApp durante el primer año. Te ayudamos a resolver cualquier duda al instante." 
                />
                <AccordionItem 
                    question="¿Hay costos de mantenimiento mensual?" 
                    answer="No. El pago es único por la licencia de uso del software. Solo abonás mantenimiento si requerís soporte extendido después del primer año." 
                />
            </div>
        </div>
    </section>
);

const CTA = () => {
    return (
        <section className="py-24 bg-sys-900 text-white relative overflow-hidden">
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
            <div className="container mx-auto px-6 text-center relative z-10">
                <div className="inline-block p-4 bg-white/10 backdrop-blur-md rounded-full mb-6">
                    <Database size={32} className="text-brand" />
                </div>
                <h2 className="text-4xl md:text-6xl font-black mb-6 tracking-tight">
                    Tomá el control hoy.
                </h2>
                <p className="text-xl text-white/60 mb-10 max-w-2xl mx-auto">
                    Dejá de perder tiempo y dinero con sistemas viejos o planillas de Excel. 
                    Pasate a la tecnología que usan los negocios que crecen.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <Button 
                        className="h-16 px-12 text-xl bg-brand hover:bg-brand-hover text-white shadow-2xl transition-all hover:scale-105 border-none flex items-center justify-center gap-2"
                        onClick={() => window.open(WHATSAPP_LINK, '_blank')}
                    >
                        <MessageCircle size={24} /> Contactar Asesor
                    </Button>
                </div>
                <p className="mt-8 text-sm text-white/40">
                    Atención personalizada • Instalación remota a todo el país
                </p>
            </div>
        </section>
    );
};

const Footer = () => (
    <footer className="bg-black py-12 text-white/40 text-sm border-t border-white/10">
        <div className="container mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2">
                <BrandLogo size="md" />
                <span className="font-bold text-white text-lg">NOAR POS</span>
            </div>
            <div className="flex gap-6">
                <a href="#features" className="hover:text-white transition-colors">Características</a>
                <a href="#pricing" className="hover:text-white transition-colors">Precios</a>
                <a href="#" className="hover:text-white transition-colors" onClick={() => window.open(WHATSAPP_LINK, '_blank')}>Soporte</a>
            </div>
            <p>© 2025 Noar Technology. Todos los derechos reservados.</p>
        </div>
    </footer>
);

export const LandingPage = () => {
    return (
        <div className="min-h-screen bg-white font-sans text-sys-900 selection:bg-brand/20 selection:text-brand" id="demo">
            <Navbar />
            <Hero />
            <DetailedFeatures />
            <HardwareSection />
            <PricingSection />
            <FAQ />
            <CTA />
            <Footer />
        </div>
    );
};