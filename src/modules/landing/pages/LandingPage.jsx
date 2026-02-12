import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    QrCode, Zap, Receipt, CheckCircle2, 
    ArrowRight, Store, Smartphone, 
    CreditCard, Lock, ShieldCheck, TrendingUp,
    Printer, ScanBarcode, Users, Package,
    AlertTriangle, ChevronDown, ChevronUp,
    LayoutDashboard, Database, BarChart3, Cloud, MessageCircle, 
    Calendar, Clock, Server, Layers, Globe, SmartphoneCharging,
    Scale, WifiOff, PieChart, DollarSign,
    Tag // 🔥 AHORA SÍ: Importado correctamente
} from 'lucide-react';
import { Button } from '../../../core/ui/Button';

// --- CONFIGURACIÓN DE CONTACTO ---
const WHATSAPP_NUMBER = "5493804373795"; 
const WHATSAPP_MESSAGE = "Hola, estoy viendo la web de Noar POS. Me interesa digitalizar mi negocio. Quisiera asesoramiento sobre el sistema y costos.";
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

// --- COMPONENTES UI ---

const Badge = ({ icon: Icon, text, color = "blue" }) => {
    const colors = {
        blue: "bg-blue-50 text-blue-700 border-blue-200",
        green: "bg-green-50 text-green-700 border-green-200",
        purple: "bg-purple-50 text-purple-700 border-purple-200",
        orange: "bg-orange-50 text-orange-700 border-orange-200",
        yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
        dark: "bg-sys-800 text-white border-sys-700",
        brand: "bg-brand/10 text-brand border-brand/20"
    };
    return (
        <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider shadow-sm ${colors[color]}`}>
            {Icon && <Icon size={12} />} {text}
        </div>
    );
};

// LOGO GRÁFICO
const BrandLogo = ({ size = "md" }) => {
    const containerSize = size === "lg" ? "w-12 h-12" : "w-10 h-10";
    return (
        <div className={`${containerSize} bg-sys-900 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20 relative overflow-hidden group`}>
            <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <svg viewBox="0 0 24 24" className="w-3/5 h-3/5" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 4V20" stroke="white" strokeWidth="4" strokeLinecap="round" />
                <path d="M17 4V20" stroke="white" strokeWidth="4" strokeLinecap="round" />
                <path d="M7 4L17 20" stroke="#3b82f6" strokeWidth="4" strokeLinecap="round" />
            </svg>
        </div>
    );
};

const FeatureItem = ({ icon: Icon, title, desc }) => (
    <div className="flex gap-4 items-start group p-4 rounded-xl hover:bg-white border border-transparent hover:border-sys-100 hover:shadow-sm transition-all duration-300">
        <div className="mt-1 p-3 bg-sys-50 group-hover:bg-brand/10 group-hover:text-brand transition-colors rounded-xl text-sys-600 shrink-0">
            <Icon size={24} />
        </div>
        <div>
            <h4 className="font-bold text-sys-900 text-base mb-1">{title}</h4>
            <p className="text-sm text-sys-500 leading-relaxed text-justify">{desc}</p>
        </div>
    </div>
);

const AccordionItem = ({ question, answer }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <div className="border-b border-sys-100 last:border-0">
            <button 
                className="w-full py-5 flex justify-between items-center text-left hover:text-brand transition-colors group"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className={`font-bold text-lg transition-colors ${isOpen ? 'text-brand' : 'text-sys-800'}`}>{question}</span>
                <div className={`p-1 rounded-full transition-all duration-300 ${isOpen ? 'bg-brand/10 text-brand rotate-180' : 'bg-sys-50 text-sys-400 group-hover:bg-sys-100'}`}>
                    <ChevronDown size={20} />
                </div>
            </button>
            <div className={`overflow-hidden transition-all duration-300 ${isOpen ? 'max-h-96 pb-6' : 'max-h-0'}`}>
                <p className="text-sys-500 text-base leading-relaxed pr-8">{answer}</p>
            </div>
        </div>
    );
};

// --- SECCIONES PRINCIPALES ---

const Navbar = () => {
    const navigate = useNavigate();
    return (
        <nav className="fixed top-0 left-0 right-0 bg-white/90 backdrop-blur-md border-b border-sys-100 z-50 shadow-sm supports-[backdrop-filter]:bg-white/70">
            <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
                <div className="flex items-center gap-3 cursor-pointer group" onClick={() => window.scrollTo(0,0)}>
                    <BrandLogo size="md" />
                    <span className="font-sans font-black text-xl tracking-tight text-sys-900 group-hover:text-sys-700 transition-colors">
                        NOAR<span className="text-brand">POS</span>
                    </span>
                </div>
                
                <div className="hidden lg:flex gap-8 text-sm font-bold text-sys-500">
                    <a href="#solutions" className="hover:text-brand hover:bg-brand/5 px-3 py-1.5 rounded-lg transition-all">Soluciones</a>
                    <a href="#payments" className="hover:text-brand hover:bg-brand/5 px-3 py-1.5 rounded-lg transition-all">Pagos</a>
                    <a href="#hardware" className="hover:text-brand hover:bg-brand/5 px-3 py-1.5 rounded-lg transition-all">Hardware</a>
                    <a href="#faq" className="hover:text-brand hover:bg-brand/5 px-3 py-1.5 rounded-lg transition-all">Dudas</a>
                </div>

                <div className="flex gap-3">
                    <Button 
                        variant="ghost"
                        className="font-bold text-sys-600 hover:text-sys-900 hidden sm:flex"
                        onClick={() => navigate('/login')}
                    >
                        Ingresar
                    </Button>
                    <Button 
                        size="sm"
                        className="bg-sys-900 hover:bg-black text-white shadow-lg shadow-sys-900/20 transition-all hover:-translate-y-0.5 font-bold px-6 rounded-xl"
                        onClick={() => window.open(WHATSAPP_LINK, '_blank')}
                    >
                        <MessageCircle size={16} className="mr-2" /> Asesoría
                    </Button>
                </div>
            </div>
        </nav>
    );
};

const Hero = () => {
    return (
        <header className="relative pt-32 pb-24 lg:pt-48 lg:pb-32 overflow-hidden bg-white">
            {/* Background Effects */}
            <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-gradient-to-bl from-brand/10 to-transparent rounded-full blur-[100px] -translate-y-1/2 translate-x-1/4 pointer-events-none"></div>
            <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-gradient-to-tr from-purple-500/10 to-transparent rounded-full blur-[80px] translate-y-1/4 -translate-x-1/4 pointer-events-none"></div>
            
            <div className="container mx-auto px-6 relative z-10">
                <div className="flex flex-col lg:flex-row items-center gap-16">
                    
                    <div className="flex-1 text-center lg:text-left max-w-2xl mx-auto lg:mx-0">
                        <div className="flex flex-wrap justify-center lg:justify-start gap-2 mb-6">
                            <Badge icon={Cloud} text="100% Web Cloud" color="blue" />
                            <Badge icon={WifiOff} text="Tecnología Offline" color="brand" />
                        </div>
                        
                        <h1 className="text-5xl lg:text-7xl font-black text-sys-900 tracking-tight mb-8 leading-[1.05]">
                            El Sistema Operativo de tu <br/>
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand to-purple-600 relative">
                                Negocio Moderno.
                                <svg className="absolute w-full h-3 -bottom-1 left-0 text-brand opacity-40" viewBox="0 0 200 9" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.00025 6.99997C35.5002 9.49994 130.5 4.99984 198 1.99992" stroke="currentColor" strokeWidth="3"/></svg>
                            </span>
                        </h1>
                        
                        <p className="text-xl text-sys-500 mb-10 leading-relaxed">
                            Centralizá <strong>Ventas, Stock, Facturación ARCA y Mercado Pago</strong> en una sola pantalla. 
                            Diseñado para comercios que buscan velocidad, control total y cero errores humanos.
                        </p>

                        <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                            <Button 
                                className="h-14 px-8 text-lg bg-brand hover:bg-brand-hover text-white shadow-xl shadow-brand/30 hover:shadow-brand/40 hover:-translate-y-1 transition-all flex items-center justify-center gap-2 rounded-2xl"
                                onClick={() => window.open(WHATSAPP_LINK, '_blank')}
                            >
                                <Zap size={20} className="fill-yellow-300 text-yellow-300" /> Solicitar Demo
                            </Button>
                            <Button 
                                variant="secondary"
                                className="h-14 px-8 text-lg bg-white border border-sys-200 text-sys-700 hover:bg-sys-50 hover:border-sys-300 rounded-2xl"
                                onClick={() => document.getElementById('solutions').scrollIntoView({ behavior: 'smooth' })}
                            >
                                Ver Funcionalidades
                            </Button>
                        </div>
                        
                        <div className="mt-10 pt-8 border-t border-sys-100 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-8 text-sm text-sys-500 font-medium">
                            <span className="flex items-center gap-2"><div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div> Servidores Activos 99.9%</span>
                            <span className="flex items-center gap-2"><Users size={16}/> +500 Comercios Confían</span>
                        </div>
                    </div>

                    <div className="w-full lg:w-[45%] relative perspective-1000">
                        {/* Mockup Dashboard */}
                        <div className="relative z-20 bg-white border border-sys-200 rounded-3xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.1)] p-4 transform rotate-y-[-5deg] rotate-x-[5deg] hover:rotate-0 transition-transform duration-700 ease-out">
                            {/* Header Mockup */}
                            <div className="flex items-center justify-between border-b border-sys-100 pb-4 mb-4">
                                <div className="flex gap-2">
                                    <div className="w-3 h-3 rounded-full bg-red-400"></div>
                                    <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                                    <div className="w-3 h-3 rounded-full bg-green-400"></div>
                                </div>
                                <div className="h-2 w-32 bg-sys-100 rounded-full"></div>
                            </div>
                            {/* Body Mockup */}
                            <div className="grid grid-cols-3 gap-4 mb-6">
                                <div className="col-span-2 h-32 bg-sys-50 rounded-xl border border-sys-100 flex items-center justify-center relative overflow-hidden">
                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent w-full h-full -translate-x-full animate-[shimmer_2s_infinite]"></div>
                                    <div className="text-center">
                                        <div className="text-3xl font-black text-sys-900">$ 1.250.400</div>
                                        <div className="text-xs text-sys-400 font-bold mt-1 uppercase">Ventas del Día</div>
                                    </div>
                                </div>
                                <div className="col-span-1 h-32 bg-brand text-white rounded-xl shadow-lg shadow-brand/20 p-4 flex flex-col justify-between">
                                    <TrendingUp size={24} className="text-white/80"/>
                                    <div>
                                        <div className="text-2xl font-bold">+18%</div>
                                        <div className="text-[10px] opacity-80">vs Semana Pasada</div>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <div className="h-12 bg-sys-50 rounded-lg w-full flex items-center px-4 justify-between">
                                    <div className="h-2 w-24 bg-sys-200 rounded-full"></div>
                                    <div className="h-2 w-12 bg-green-200 rounded-full"></div>
                                </div>
                                <div className="h-12 bg-sys-50 rounded-lg w-full flex items-center px-4 justify-between">
                                    <div className="h-2 w-32 bg-sys-200 rounded-full"></div>
                                    <div className="h-2 w-12 bg-blue-200 rounded-full"></div>
                                </div>
                                <div className="h-12 bg-sys-50 rounded-lg w-full flex items-center px-4 justify-between">
                                    <div className="h-2 w-20 bg-sys-200 rounded-full"></div>
                                    <div className="h-2 w-12 bg-purple-200 rounded-full"></div>
                                </div>
                            </div>
                        </div>

                        {/* Floating Elements */}
                        <div className="absolute -top-10 -right-10 bg-white p-4 rounded-2xl shadow-xl border border-sys-100 z-30 animate-[float_4s_ease-in-out_infinite]">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-green-100 text-green-600 rounded-lg"><CheckCircle2 size={20}/></div>
                                <div>
                                    <p className="text-xs text-sys-400 font-bold uppercase">Estado ARCA</p>
                                    <p className="text-sm font-black text-sys-800">CAE Autorizado</p>
                                </div>
                            </div>
                        </div>

                        <div className="absolute -bottom-5 -left-5 bg-white p-4 rounded-2xl shadow-xl border border-sys-100 z-30 animate-[float_5s_ease-in-out_infinite_reverse]">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-100 text-blue-600 rounded-lg"><CreditCard size={20}/></div>
                                <div>
                                    <p className="text-xs text-sys-400 font-bold uppercase">Mercado Pago</p>
                                    <p className="text-sm font-black text-sys-800">Acreditado</p>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </header>
    );
};

const ValueProposition = () => (
    <section id="solutions" className="py-24 bg-sys-50 border-t border-sys-200">
        <div className="container mx-auto px-6">
            <div className="text-center max-w-3xl mx-auto mb-16">
                <Badge icon={Layers} text="Ecosistema 360°" color="purple" />
                <h2 className="text-3xl md:text-5xl font-black text-sys-900 mt-6 mb-6">Un ecosistema completo.<br/>No solo una caja registradora.</h2>
                <p className="text-lg text-sys-500">
                    Desde el control de stock milimétrico hasta la gestión de empleados y la facturación electrónica automatizada.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                
                {/* FISCAL */}
                <div className="bg-white p-8 rounded-3xl border border-sys-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group">
                    <div className="w-14 h-14 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                        <Receipt size={28} />
                    </div>
                    <h3 className="text-xl font-bold text-sys-900 mb-3">Facturación ARCA Nativa</h3>
                    <p className="text-sm text-sys-500 leading-relaxed mb-4 text-justify">
                        Conexión directa con los servidores de AFIP (ahora ARCA). Emití Facturas A, B y C sin entrar a la web del organismo.
                        Gestión automática de CAE, vencimientos y libros de IVA.
                    </p>
                    <ul className="text-xs text-sys-400 space-y-2 font-medium">
                        <li className="flex items-center gap-2"><CheckCircle2 size={12} className="text-purple-500"/> Facturación masiva</li>
                        <li className="flex items-center gap-2"><CheckCircle2 size={12} className="text-purple-500"/> Notas de Crédito / Débito</li>
                    </ul>
                </div>

                {/* INVENTARIO */}
                <div className="bg-white p-8 rounded-3xl border border-sys-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group">
                    <div className="w-14 h-14 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                        <Package size={28} />
                    </div>
                    <h3 className="text-xl font-bold text-sys-900 mb-3">Stock Predictivo</h3>
                    <p className="text-sm text-sys-500 leading-relaxed mb-4 text-justify">
                        Soportamos productos unitarios y pesables (balanza). Historial de movimientos (Kardex) para detectar robos hormiga.
                        Alertas automáticas cuando un producto está por agotarse.
                    </p>
                    <ul className="text-xs text-sys-400 space-y-2 font-medium">
                        <li className="flex items-center gap-2"><CheckCircle2 size={12} className="text-orange-500"/> Actualización masiva de precios</li>
                        <li className="flex items-center gap-2"><CheckCircle2 size={12} className="text-orange-500"/> Gestión de Proveedores</li>
                    </ul>
                </div>

                {/* EMPLEADOS */}
                <div className="bg-white p-8 rounded-3xl border border-sys-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group">
                    <div className="w-14 h-14 bg-green-50 text-green-600 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                        <Users size={28} />
                    </div>
                    <h3 className="text-xl font-bold text-sys-900 mb-3">Gestión de Personal</h3>
                    <p className="text-sm text-sys-500 leading-relaxed mb-4 text-justify">
                        Cada empleado tiene su usuario y permisos limitados. Implementamos **Caja Ciega**: ellos cuentan el dinero, el sistema audita si falta o sobra.
                        Módulo de comisiones y adelantos de sueldo.
                    </p>
                    <ul className="text-xs text-sys-400 space-y-2 font-medium">
                        <li className="flex items-center gap-2"><CheckCircle2 size={12} className="text-green-500"/> Auditoría de movimientos</li>
                        <li className="flex items-center gap-2"><CheckCircle2 size={12} className="text-green-500"/> Control de horarios</li>
                    </ul>
                </div>

                {/* ETIQUETAS */}
                <div className="bg-sys-900 p-8 rounded-3xl border border-sys-800 shadow-xl relative overflow-hidden group col-span-1 md:col-span-2 lg:col-span-1">
                    <div className="absolute inset-0 bg-gradient-to-br from-brand/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <div className="w-14 h-14 bg-sys-800 text-white rounded-2xl flex items-center justify-center mb-6 relative z-10 group-hover:scale-110 transition-transform">
                        <Tag size={28} />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-3 relative z-10">Motor de Etiquetas</h3>
                    <p className="text-sm text-sys-400 leading-relaxed mb-4 relative z-10 text-justify">
                        Olvidate del fibrón. Generá etiquetas de góndola, ofertas y códigos de barra profesionales.
                        Diseños personalizables, diferentes tamaños de grilla y exportación a PDF lista para imprimir en A4.
                    </p>
                    <Button size="sm" variant="secondary" className="w-full text-xs font-bold" onClick={() => window.open(WHATSAPP_LINK, '_blank')}>Ver Ejemplos</Button>
                </div>

                {/* OFFLINE MODE */}
                <div className="col-span-1 md:col-span-2 bg-red-50 p-8 rounded-3xl border border-red-100 shadow-sm relative overflow-hidden flex flex-col md:flex-row items-center gap-8">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-4">
                            <WifiOff className="text-red-500" size={24}/>
                            <span className="text-xs font-black text-red-600 uppercase tracking-widest">Tecnología Resilience™</span>
                        </div>
                        <h3 className="text-2xl font-black text-sys-900 mb-4">Si se corta Internet, seguís vendiendo.</h3>
                        <p className="text-sm text-sys-600 leading-relaxed mb-6 text-justify">
                            Sabemos que la conexión en Argentina no siempre es estable. Noar POS detecta el corte y guarda todo localmente en el dispositivo.
                            Podés seguir facturando, descontando stock y abriendo cajones. Cuando vuelve la red, todo se sincroniza con la nube automáticamente.
                        </p>
                    </div>
                    <div className="w-full md:w-1/3 flex justify-center">
                        <div className="relative">
                            <div className="absolute inset-0 bg-red-200 rounded-full blur-2xl opacity-50 animate-pulse"></div>
                            <Server size={80} className="text-red-500 relative z-10"/>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </section>
);

const PaymentIntegrations = () => (
    <section id="payments" className="py-24 bg-white border-t border-sys-100">
        <div className="container mx-auto px-6">
            <div className="flex flex-col md:flex-row items-center gap-12 lg:gap-20">
                <div className="w-full md:w-1/2 order-2 md:order-1">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {/* TARJETA MP */}
                        <div className="bg-sys-50 p-6 rounded-2xl border border-sys-200 hover:shadow-lg transition-shadow relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                                <QrCode size={80} />
                            </div>
                            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center mb-4">
                                <Smartphone size={24} />
                            </div>
                            <h4 className="font-bold text-sys-900 text-lg mb-2">Mercado Pago QR</h4>
                            <p className="text-sm text-sys-500 leading-relaxed">
                                El sistema genera un QR dinámico en pantalla por cada venta. El cliente escanea, paga y el sistema recibe la confirmación al instante. Sin fraudes.
                            </p>
                        </div>

                        {/* TARJETA CLOVER */}
                        <div className="bg-sys-50 p-6 rounded-2xl border border-sys-200 hover:shadow-lg transition-shadow relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                                <CreditCard size={80} />
                            </div>
                            <div className="w-12 h-12 bg-sys-200 text-sys-700 rounded-xl flex items-center justify-center mb-4">
                                <CreditCard size={24} />
                            </div>
                            <h4 className="font-bold text-sys-900 text-lg mb-2">Clover / Point</h4>
                            <p className="text-sm text-sys-500 leading-relaxed">
                                Enviá el monto directamente a la terminal POS. Evitá el error humano de digitar mal el importe en el posnet. Conciliación automática.
                            </p>
                        </div>

                        {/* BANNER FRAUDE */}
                        <div className="col-span-1 sm:col-span-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-8 rounded-2xl shadow-xl relative overflow-hidden">
                            <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/10 rounded-full blur-3xl"></div>
                            <div className="relative z-10 flex flex-col sm:flex-row items-center gap-6">
                                <div className="p-4 bg-white/10 rounded-full backdrop-blur-sm">
                                    <ShieldCheck size={32} className="text-white" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-xl mb-2">Fin de las Transferencias Falsas</h4>
                                    <p className="text-white/80 text-sm leading-relaxed">
                                        Noar POS bloquea el ticket hasta que el dinero impacta realmente en tu cuenta. 
                                        Dejá de mirar el celular del cliente. Mirá tu sistema.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div className="w-full md:w-1/2 order-1 md:order-2">
                    <Badge icon={DollarSign} text="Cobros Digitales" color="green" />
                    <h2 className="text-4xl lg:text-5xl font-black text-sys-900 mt-6 mb-6 leading-tight">
                        Cobrá seguro.<br/>Sin confiar en la palabra de nadie.
                    </h2>
                    <p className="text-lg text-sys-500 leading-relaxed mb-8">
                        Hoy en día, el 70% de las ventas son digitales. No podés depender de que un empleado revise si llegó una transferencia o si el comprobante que muestra el cliente es real.
                    </p>
                    
                    <div className="space-y-6">
                        <div className="flex gap-4">
                            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                                <CheckCircle2 size={20} className="text-green-600"/>
                            </div>
                            <div>
                                <h5 className="font-bold text-sys-900">Acreditación Inmediata</h5>
                                <p className="text-sm text-sys-500 mt-1">El sistema valida la transacción en milisegundos contra la API del banco.</p>
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                                <LayoutDashboard size={20} className="text-blue-600"/>
                            </div>
                            <div>
                                <h5 className="font-bold text-sys-900">Caja Unificada</h5>
                                <p className="text-sm text-sys-500 mt-1">Efectivo, Tarjetas, QR y Transferencias. Todo suma en el mismo cierre de caja Z.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>
);

const SecuritySection = () => (
    <section id="security" className="py-24 bg-white">
        <div className="container mx-auto px-6">
            <div className="flex flex-col lg:flex-row items-center gap-16">
                <div className="w-full lg:w-1/2">
                    <div className="relative group">
                        <div className="absolute -inset-4 bg-gradient-to-r from-blue-100 to-purple-100 rounded-full blur-3xl opacity-50 group-hover:opacity-70 transition-opacity"></div>
                        <img 
                            src="https://images.unsplash.com/photo-1555421689-491a97ff2040?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80" 
                            alt="Seguridad de Datos" 
                            className="relative rounded-3xl shadow-2xl border border-sys-200 grayscale group-hover:grayscale-0 transition-all duration-700 transform group-hover:scale-[1.01]"
                        />
                        <div className="absolute bottom-8 left-8 bg-white p-6 rounded-2xl shadow-xl max-w-xs border border-sys-100 hidden sm:block">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                                <span className="font-bold text-sys-900 text-sm">Backup Automático</span>
                            </div>
                            <p className="text-xs text-sys-500">Tus datos se replican en 3 servidores globales cada 15 minutos.</p>
                        </div>
                    </div>
                </div>
                <div className="w-full lg:w-1/2">
                    <Badge icon={Server} text="Infraestructura Enterprise" color="dark" />
                    <h2 className="text-3xl md:text-5xl font-black text-sys-900 mt-6 mb-8">
                        Tus datos son tuyos.<br/>Y están blindados.
                    </h2>
                    <p className="text-lg text-sys-500 mb-8 leading-relaxed text-justify">
                        No guardamos datos críticos en la computadora del local (que se puede romper o robar). 
                        Todo está en la nube, encriptado con los mismos estándares que usan los bancos digitales (SSL/TLS 256-bit).
                        Si se te rompe la PC, agarrás otra, te logueás y seguís vendiendo como si nada hubiera pasado.
                    </p>
                    
                    <div className="space-y-6">
                        <FeatureItem 
                            icon={Cloud} 
                            title="100% Cloud Native" 
                            desc="Accedé a la facturación de tu negocio desde tu casa, desde la playa o desde el celular. Reportes en tiempo real estés donde estés." 
                        />
                        <FeatureItem 
                            icon={SmartphoneCharging} 
                            title="PWA Instalable" 
                            desc="Podés instalar Noar POS como si fuera una App nativa en tu Android o iOS para entrar más rápido y sin barras de navegación." 
                        />
                        <FeatureItem 
                            icon={ShieldCheck} 
                            title="Roles y Permisos Granulares" 
                            desc="Definí exactamente qué puede hacer cada empleado. Evitá que los cajeros vean el precio de costo o accedan a reportes financieros sensibles." 
                        />
                    </div>
                </div>
            </div>
        </div>
    </section>
);

const HardwareCompatibility = () => (
    <section id="hardware" className="py-20 bg-sys-50 border-y border-sys-200">
        <div className="container mx-auto px-6 text-center">
            <h2 className="text-2xl font-black text-sys-900 mb-8">Funciona con lo que ya tenés</h2>
            <div className="flex flex-wrap justify-center gap-4 md:gap-8">
                <div className="flex items-center gap-3 bg-white px-6 py-4 rounded-xl border border-sys-200 shadow-sm text-sys-700 font-bold">
                    <Printer size={20} className="text-sys-400"/> Impresoras Térmicas
                </div>
                <div className="flex items-center gap-3 bg-white px-6 py-4 rounded-xl border border-sys-200 shadow-sm text-sys-700 font-bold">
                    <ScanBarcode size={20} className="text-sys-400"/> Lectores de Barra
                </div>
                <div className="flex items-center gap-3 bg-white px-6 py-4 rounded-xl border border-sys-200 shadow-sm text-sys-700 font-bold">
                    <Smartphone size={20} className="text-sys-400"/> Celulares y Tablets
                </div>
                <div className="flex items-center gap-3 bg-white px-6 py-4 rounded-xl border border-sys-200 shadow-sm text-sys-700 font-bold">
                    <LayoutDashboard size={20} className="text-sys-400"/> PC y Notebooks
                </div>
                <div className="flex items-center gap-3 bg-white px-6 py-4 rounded-xl border border-sys-200 shadow-sm text-sys-700 font-bold">
                    <Scale size={20} className="text-sys-400"/> Balanzas Digitales
                </div>
            </div>
        </div>
    </section>
);

const BusinessIntelligence = () => (
    <section className="py-24 bg-sys-900 text-white relative overflow-hidden">
        <div className="container mx-auto px-6 text-center relative z-10">
            <Badge icon={PieChart} text="Business Intelligence" color="brand" />
            <h2 className="text-3xl md:text-5xl font-black mt-6 mb-8">Tomá decisiones con datos,<br/>no con intuición.</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-12 text-left">
                <div className="bg-white/5 backdrop-blur-md p-8 rounded-3xl border border-white/10 hover:bg-white/10 transition-colors">
                    <div className="text-4xl font-black text-brand mb-2">+20%</div>
                    <h4 className="font-bold text-lg mb-2">Rentabilidad</h4>
                    <p className="text-sm text-white/60">Al detectar productos con bajo margen y ajustar precios masivamente.</p>
                </div>
                <div className="bg-white/5 backdrop-blur-md p-8 rounded-3xl border border-white/10 hover:bg-white/10 transition-colors">
                    <div className="text-4xl font-black text-purple-400 mb-2">-15%</div>
                    <h4 className="font-bold text-lg mb-2">Pérdidas</h4>
                    <p className="text-sm text-white/60">Controlando el stock fantasma y los vencimientos de mercadería.</p>
                </div>
                <div className="bg-white/5 backdrop-blur-md p-8 rounded-3xl border border-white/10 hover:bg-white/10 transition-colors">
                    <div className="text-4xl font-black text-green-400 mb-2">100%</div>
                    <h4 className="font-bold text-lg mb-2">Tranquilidad</h4>
                    <p className="text-sm text-white/60">Sabiendo exactamente cuánto ganaste al final del día.</p>
                </div>
            </div>
        </div>
    </section>
);

const FAQ = () => (
    <section id="faq" className="py-24 bg-white">
        <div className="container mx-auto px-6 max-w-3xl">
            <div className="text-center mb-12">
                <h2 className="text-3xl font-black text-sys-900 mb-4">Preguntas Frecuentes</h2>
                <p className="text-sys-500">Todo lo que necesitás saber antes de modernizar tu negocio.</p>
            </div>
            
            <div className="space-y-2">
                <AccordionItem 
                    question="¿Cómo es el proceso de instalación?" 
                    answer="Es inmediato. Al ser 100% web, te creamos una cuenta y en 5 minutos estás vendiendo. Te ayudamos a importar tus productos desde Excel si tenés una lista." 
                />
                <AccordionItem 
                    question="¿Necesito una computadora potente?" 
                    answer="No. Noar POS es ultra liviano. Funciona fluido en computadoras de hace 10 años, netbooks del gobierno, tablets o celulares económicos." 
                />
                <AccordionItem 
                    question="¿Qué pasa si se cae AFIP?" 
                    answer="El sistema tiene contingencia. Si los servidores de AFIP no responden (algo común), podés seguir vendiendo con tickets internos y fiscalizar todo junto con un clic cuando el servicio se restablezca." 
                />
                <AccordionItem 
                    question="¿Sirve para kioscos y supermercados?" 
                    answer="Sí, es nuestro fuerte. Tenemos teclas rápidas, búsqueda ultra veloz, integración con balanzas y manejo de códigos de barra para que la cola de clientes vuele." 
                />
                <AccordionItem 
                    question="¿Tienen soporte técnico?" 
                    answer="Sí, soporte humano real por WhatsApp. Nada de bots que te hacen perder tiempo. Entendemos que si tu caja no anda, perdés plata. Estamos para ayudarte." 
                />
            </div>
        </div>
    </section>
);

const CTA = () => {
    const navigate = useNavigate();
    return (
        <section className="py-24 bg-white relative overflow-hidden border-t border-sys-200">
            <div className="container mx-auto px-6 text-center relative z-10">
                <div className="inline-block p-4 bg-sys-50 rounded-2xl border border-sys-100 mb-8 transform -rotate-3">
                    <Database size={40} className="text-brand" />
                </div>
                
                <h2 className="text-4xl md:text-6xl font-black text-sys-900 mb-8 tracking-tight leading-tight">
                    ¿Listo para dejar el cuaderno?
                </h2>
                <p className="text-xl text-sys-500 mb-12 max-w-2xl mx-auto leading-relaxed">
                    Unite a la red de comercios que ya automatizaron su gestión con Noar POS.
                    <br/>Más control. Menos estrés. Más ganancias.
                </p>
                
                <div className="flex flex-col sm:flex-row gap-6 justify-center items-center">
                    <Button 
                        className="h-16 px-12 text-xl bg-sys-900 hover:bg-black text-white shadow-2xl transition-all hover:scale-105 border-none flex items-center justify-center gap-3 rounded-2xl font-bold"
                        onClick={() => window.open(WHATSAPP_LINK, '_blank')}
                    >
                        <MessageCircle size={24} /> Hablar con Ventas
                    </Button>
                    <span className="text-sys-300 text-sm font-medium">o</span>
                    <Button 
                        variant="outline"
                        className="h-16 px-12 text-xl border-2 border-sys-200 text-sys-700 hover:bg-sys-50 rounded-2xl font-bold"
                        onClick={() => navigate('/login')}
                    >
                        Ya soy Cliente
                    </Button>
                </div>
                
                <p className="mt-12 text-sm text-sys-400 font-medium">
                    © 2025 Noar Technology • Desarrollado con ❤️ en Argentina
                </p>
            </div>
        </section>
    );
};

const Footer = () => (
    <footer className="bg-sys-50 py-12 text-sys-500 text-xs border-t border-sys-200">
        <div className="container mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="flex items-center gap-3 opacity-80 hover:opacity-100 transition-opacity">
                <BrandLogo size="md" />
                <span className="font-black text-sys-900 text-lg">NOAR POS</span>
            </div>
            <div className="flex flex-wrap gap-8 font-bold text-sys-600">
                <a href="#features" className="hover:text-brand transition-colors">Características</a>
                <a href="#hardware" className="hover:text-brand transition-colors">Hardware</a>
                <a href="#security" className="hover:text-brand transition-colors">Seguridad</a>
                <a href="#" className="hover:text-brand transition-colors" onClick={() => window.open(WHATSAPP_LINK, '_blank')}>Contacto</a>
            </div>
            <div className="flex gap-6 opacity-60">
                <Globe size={16}/>
                <span>Argentina</span>
            </div>
        </div>
    </footer>
);

export const LandingPage = () => {
    return (
        <div className="min-h-screen bg-white font-sans text-sys-900 selection:bg-brand/20 selection:text-brand scroll-smooth">
            <Navbar />
            <Hero />
            <ValueProposition />
            <PaymentIntegrations />
            <HardwareCompatibility />
            <SecuritySection />
            <BusinessIntelligence />
            <FAQ />
            <CTA />
            <Footer />
        </div>
    );
};