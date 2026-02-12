import React, { useState, useEffect } from 'react';
import { 
    Search, Printer, X, Plus, Trash2, 
    Tag, Barcode, ArrowLeft, Download,
    Palette, Type, Layout, Percent, Calendar, Filter, Grid
} from 'lucide-react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import JsBarcode from 'jsbarcode';
import jsPDF from 'jspdf'; 

import { productRepository } from '../repositories/productRepository';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';
import toast from 'react-hot-toast';

// IMPORTACIÓN DEL MOTOR DE ETIQUETAS
import { GondolaLabelEngine } from '../utils/LabelEngine'; 

// 🎨 MAPA DE COLORES PARA ETIQUETAS
const COLOR_MAP = {
    red:    { r: 220, g: 38,  b: 38,  hex: '#dc2626', bgClass: 'bg-red-600', textClass: 'text-red-600', borderClass: 'border-red-600' },
    yellow: { r: 234, g: 179, b: 8,   hex: '#eab308', bgClass: 'bg-yellow-500', textClass: 'text-yellow-600', borderClass: 'border-yellow-500' },
    green:  { r: 22,  g: 163, b: 74,  hex: '#16a34a', bgClass: 'bg-green-600', textClass: 'text-green-600', borderClass: 'border-green-600' },
    violet: { r: 124, g: 58,  b: 237, hex: '#7c3aed', bgClass: 'bg-violet-600', textClass: 'text-violet-600', borderClass: 'border-violet-600' },
    black:  { r: 0,   g: 0,   b: 0,   hex: '#000000', bgClass: 'bg-black', textClass: 'text-black', borderClass: 'border-black' }
};

// 📐 PRESETS DE GRILLA (A4 = 210mm x 297mm)
const LAYOUT_PRESETS = {
    // --- ESTILO MAXI / SHELF TALKER ---
    // 🔥 CORRECCIÓN: Horizontal (Landscape) W:297 H:210
    'poster_1': { label: 'A4 Gigante Horizontal (1/Hoja)', type: 'shelf_talker', cols: 1, rows: 1, width: 297, height: 210, headerH: 55, priceSize: 220, orientation: 'l' },
    'maxi_3':   { label: 'Oferta Maxi (3/Hoja)', type: 'shelf_talker', cols: 1, rows: 3, width: 210, height: 99,  headerH: 25, priceSize: 120, orientation: 'p' },
    
    // --- ESTILO GÓNDOLA ---
    'gondola_big': { label: 'Góndola Grande (14/Hoja)', type: 'gondola', cols: 2, rows: 7, width: 105, height: 42.4, headerH: 9, priceSize: 45, orientation: 'p' },
    'gondola_std': { label: 'Estándar (21/Hoja)',       type: 'gondola', cols: 3, rows: 7, width: 70,  height: 42.4, headerH: 9, priceSize: 38, orientation: 'p' },
    'gondola_sm':  { label: 'Compacta (28/Hoja)',       type: 'gondola', cols: 4, rows: 7, width: 52.5, height: 42.4, headerH: 9, priceSize: 28, orientation: 'p' },
    
    // --- ESTILO MINI / BARCODE ---
    'mini_65':     { label: 'Mini Códigos (65/Hoja)',   type: 'barcode', cols: 5, rows: 13, width: 42, height: 22.8, headerH: 0, priceSize: 0, orientation: 'p' }
};

export const PrintLabelsPage = () => {
    const navigate = useNavigate();
    const { state } = useLocation(); 
    const { companySlug } = useParams();
    
    // Estados de Datos
    const [allProducts, setAllProducts] = useState([]);
    const [printQueue, setPrintQueue] = useState([]); 
    
    // Estados de Filtros
    const [searchTerm, setSearchTerm] = useState('');
    const [filterDate, setFilterDate] = useState(''); 
    const [showOnlyPromos, setShowOnlyPromos] = useState(false);

    // Estados de Configuración
    const [layoutId, setLayoutId] = useState('gondola_std'); // Default
    const [printStyle, setPrintStyle] = useState('color'); 
    const [labelColor, setLabelColor] = useState('red'); 
    const [isGenerating, setIsGenerating] = useState(false);

    // Derivados
    const currentLayout = LAYOUT_PRESETS[layoutId];

    useEffect(() => {
        const load = async () => {
            const data = await productRepository.getAll();
            setAllProducts(data || []);
        };
        load();
    }, []);

    // 🔥 LOGICA DE AUTO-CARGA
    useEffect(() => {
        if (state?.autoLoadItems && Array.isArray(state.autoLoadItems)) {
            setPrintQueue(state.autoLoadItems);
            toast.success(`${state.autoLoadItems.length} etiquetas cargadas automáticamente`);
            window.history.replaceState({}, document.title);
        }
    }, [state]);

    // 🔥 FIX: Efecto para visualizar códigos en pantalla (Preview HTML)
    useEffect(() => {
        if (currentLayout.type === 'barcode' && printQueue.length > 0) {
            setTimeout(() => {
                printQueue.forEach((item, index) => {
                    try {
                        const uniqueId = `#preview-bc-${item.id}-${index}`;
                        const codeValue = item.code || item.barcode || item.id.slice(0,8).toUpperCase();
                        
                        const svgElement = document.querySelector(uniqueId);
                        if (svgElement) {
                            JsBarcode(uniqueId, codeValue, {
                                format: "CODE128", 
                                lineColor: "#000", 
                                width: 1.5, 
                                height: 35, 
                                displayValue: false, 
                                margin: 0
                            });
                        }
                    } catch (e) {
                        console.warn("Error generando barcode preview:", e);
                    }
                });
            }, 100); 
        }
    }, [printQueue, layoutId]);

    // 🔍 FILTRADO
    const filteredProducts = allProducts.filter(p => {
        const matchesText = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            (p.code && p.code.includes(searchTerm));
        
        let matchesPromo = true;
        if (showOnlyPromos) {
            const promoInfo = GondolaLabelEngine.calculatePromoDetails(p);
            matchesPromo = promoInfo.isPromo;
        }

        let matchesDate = true;
        if (filterDate) {
            const productDate = p.updatedAt ? new Date(p.updatedAt).toISOString().split('T')[0] : '';
            matchesDate = productDate === filterDate;
        }

        return matchesText && matchesPromo && matchesDate;
    }).slice(0, 50); 

    const addToQueue = async (product) => {
        setPrintQueue(prev => [...prev, product]);
    };

    const addAllFiltered = () => {
        if (filteredProducts.length > 100) {
            if(!window.confirm(`¿Agregar ${filteredProducts.length} productos a la cola?`)) return;
        }
        setPrintQueue(prev => [...prev, ...filteredProducts]);
        toast.success(`${filteredProducts.length} productos agregados`);
    };

    const removeFromQueue = (indexToRemove) => setPrintQueue(printQueue.filter((_, idx) => idx !== indexToRemove));

    // =========================================================================
    // 🖨️ GENERADOR PDF: MOTOR INDUSTRIAL (CON LAYOUTS DINÁMICOS)
    // =========================================================================
    const handleDownloadPDF = () => {
        if (printQueue.length === 0) return;
        setIsGenerating(true);

        try {
            // 🔥 CORRECCIÓN: Orientación dinámica (Landscape para Gigante, Portrait para resto)
            const doc = new jsPDF({ 
                orientation: currentLayout.orientation || 'p', 
                unit: 'mm', 
                format: 'a4' 
            });
            
            // Definimos el límite de página según orientación
            const pageHeight = currentLayout.orientation === 'l' ? 210 : 297;
            
            const { width, height, headerH, priceSize, type, cols } = currentLayout;

            let x = 0;
            let y = 0;
            let colCounter = 0;

            const isBW = printStyle === 'bw';
            const activeColor = isBW ? COLOR_MAP.black : COLOR_MAP[labelColor];

            printQueue.forEach((p, idx) => {
                // Control de Salto de Página
                if (y + height > pageHeight + 0.1) {
                    doc.addPage();
                    x = 0; 
                    y = 0; 
                    colCounter = 0;
                }

                const promo = GondolaLabelEngine.calculatePromoDetails(p);
                const isPromo = promo.isPromo;

                // Marco de corte
                doc.setDrawColor(200); 
                doc.setLineWidth(0.1); 
                doc.rect(x, y, width, height);

                // =========================================================
                // 🖼️ MODO SHELF TALKER (MAXI & POSTER)
                // =========================================================
                if (type === 'shelf_talker') {
                    
                    // 1. HEADER
                    if (isPromo) {
                        doc.setFillColor(activeColor.r, activeColor.g, activeColor.b); 
                        doc.rect(x, y, width, headerH, 'F');
                        doc.setTextColor(255);
                        doc.setFont("helvetica", "bold");
                        doc.setFontSize(headerH * 0.8); 
                        doc.text(promo.label, x + (width / 2), y + (headerH * 0.65), { align: "center" });
                    } else {
                        if (isBW) doc.setFillColor(0); else doc.setFillColor(activeColor.r, activeColor.g, activeColor.b);
                        doc.rect(x, y, width, headerH, 'F');
                        doc.setTextColor(255);
                        doc.setFont("helvetica", "bold");
                        doc.setFontSize(headerH * 0.7);
                        doc.text("PRECIO DE LISTA", x + (width / 2), y + (headerH * 0.65), { align: "center" });
                    }

                    // 2. PRECIO
                    doc.setTextColor(0);
                    doc.setFont("helvetica", "bold");
                    doc.setFontSize(priceSize); 
                    
                    const priceStr = Math.floor(promo.currentPrice).toLocaleString('es-AR');
                    const priceWidth = doc.getTextWidth(priceStr);
                    const centerX = x + (width / 2);
                    const centerY = y + (height * 0.60); 
                    
                    doc.text(priceStr, centerX, centerY, { align: "center" });
                    
                    // Signo $ y Centavos
                    const smallFontSize = priceSize * 0.35;
                    doc.setFontSize(smallFontSize);
                    doc.text("$", centerX - (priceWidth / 2) - (smallFontSize/3), centerY - (smallFontSize/2));
                    doc.text("00", centerX + (priceWidth / 2) + (smallFontSize/6), centerY - (smallFontSize/2));

                    // 3. PRODUCTO
                    const nameSize = Math.max(12, priceSize * 0.18);
                    doc.setFontSize(nameSize);
                    const splitName = doc.splitTextToSize(p.name.toUpperCase(), width - 10);
                    doc.text(splitName[0], centerX, centerY + (nameSize * 1.2), { align: "center" });
                    
                    // Footer
                    if (isPromo && promo.footer) {
                        doc.setFontSize(nameSize * 0.7);
                        doc.setTextColor(activeColor.r, activeColor.g, activeColor.b); 
                        doc.text(promo.footer, centerX, y + height - 5, { align: "center" });
                    } else {
                        doc.setFontSize(10);
                        doc.setTextColor(100);
                        doc.text(`REF: ${p.code || p.id.slice(0,8)}`, centerX, y + height - 5, { align: "center" });
                    }
                } 
                
                // =========================================================
                // 🏷️ MODO GÓNDOLA (ESTÁNDAR, BIG, COMPACT)
                // =========================================================
                else if (type === 'gondola') {
                    // Header
                    if (isPromo) {
                        doc.setFillColor(activeColor.r, activeColor.g, activeColor.b);
                        doc.rect(x, y, width, headerH, 'F');
                        doc.setTextColor(255);
                    } else {
                        if (isBW) doc.setFillColor(0); else doc.setFillColor(activeColor.r, activeColor.g, activeColor.b);
                        doc.rect(x, y, width, headerH, 'F');
                        doc.setTextColor(255);
                    }
                    
                    doc.setFont("helvetica", "bold");
                    doc.setFontSize(isPromo ? 10 : 8);
                    doc.text(isPromo ? promo.label : "PRECIO CONTADO", x + (width/2), y + 6.5, { align: "center" });

                    // Nombre
                    doc.setTextColor(0);
                    doc.setFont("helvetica", "bold");
                    const nameFontSize = width < 60 ? 8 : 10;
                    doc.setFontSize(nameFontSize);
                    const splitName = doc.splitTextToSize(p.name.toUpperCase(), width - 4);
                    doc.text(splitName.slice(0, 2), x + (width/2), y + 14, { align: "center" });

                    // Precio
                    doc.setFontSize(priceSize);
                    const priceStr = Math.floor(promo.currentPrice).toLocaleString('es-AR');
                    const priceWidth = doc.getTextWidth(priceStr);
                    const centerX = x + (width/2);

                    doc.text(priceStr, centerX, y + 31, { align: "center" });
                    
                    doc.setFontSize(priceSize * 0.4);
                    doc.text("$", centerX - (priceWidth/2) - 4, y + 26);
                    doc.setFontSize(priceSize * 0.3);
                    doc.text("00", centerX + (priceWidth/2) + 1, y + 23);

                    // Footer
                    doc.setLineWidth(0.2);
                    doc.line(x, y + 35, x + width, y + 35); 

                    if (isPromo) {
                        doc.setFontSize(8);
                        doc.setTextColor(activeColor.r, activeColor.g, activeColor.b);
                        doc.text(promo.footer || "OFERTA", x + 2, y + 39.5);
                        
                        doc.setFontSize(7);
                        doc.setTextColor(100);
                        const oldP = `$${Math.round(p.price)}`;
                        const oldW = doc.getTextWidth(oldP);
                        doc.text(oldP, x + width - 2, y + 39.5, { align: "right" });
                        doc.setLineWidth(0.3);
                        doc.line(x + width - 2 - oldW, y + 38.5, x + width - 2, y + 38.5);
                    } else {
                        doc.setFontSize(7);
                        doc.setTextColor(0);
                        doc.setFont("courier", "bold");
                        doc.text(p.code || p.id.slice(0,8), x + 2, y + 39.5);
                        
                        doc.setFont("helvetica", "normal");
                        doc.setFontSize(6);
                        doc.text(new Date().toLocaleDateString(), x + width - 2, y + 39.5, { align: "right" });
                    }
                } 
                
                // =========================================================
                // 🔥 FIX: MODO BARCODE (IMAGEN REAL EN PDF)
                // =========================================================
                else if (type === 'barcode') {
                    const centerX = x + (width / 2);
                    
                    // 1. Nombre Corto
                    doc.setFont("helvetica", "bold");
                    doc.setTextColor(0);
                    doc.setFontSize(7);
                    const nameShort = p.name.length > 25 ? p.name.substring(0, 25) + '...' : p.name;
                    doc.text(nameShort, centerX, y + 4, { align: "center" });

                    // 2. Generación de Imagen de Código de Barras
                    try {
                        const canvas = document.createElement("canvas");
                        const codeValue = p.code || p.id.slice(0,8).toUpperCase();
                        
                        JsBarcode(canvas, codeValue, {
                            format: "CODE128",
                            lineColor: "#000",
                            width: 2,
                            height: 40,
                            displayValue: false,
                            margin: 0
                        });

                        const imgData = canvas.toDataURL("image/jpeg", 1.0);
                        doc.addImage(imgData, 'JPEG', x + 4, y + 6, width - 8, height - 12);
                    } catch(err) {
                        doc.setFont("courier", "bold");
                        doc.setFontSize(10);
                        doc.text(p.code || "ERROR", centerX, y + 15, { align: "center" });
                    }
                    
                    // 3. Código Texto (Legible)
                    doc.setFont("courier", "bold");
                    doc.setFontSize(8);
                    doc.text(p.code || p.id.slice(0,8).toUpperCase(), centerX, y + height - 2, { align: "center" });
                }

                colCounter++;
                if (colCounter < cols) {
                    x += width;
                } else {
                    x = 0;
                    y += height;
                    colCounter = 0;
                }
            });

            doc.save(`Etiquetas_Nexus_${layoutId}_${new Date().toISOString().slice(0,10)}.pdf`);

        } catch (error) {
            console.error(error);
            alert("Error al generar el PDF.");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleBack = () => {
        if (companySlug) {
            navigate(`/${companySlug}/inventory`);
        } else {
            navigate(-1);
        }
    };

    return (
        <div className="h-[calc(100vh-2rem)] flex flex-col gap-4 animate-in fade-in p-4 bg-sys-50">
            
            {/* --- HEADER --- */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center bg-white p-4 rounded-xl shadow-sm border border-sys-200 gap-4">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" onClick={handleBack} className="rounded-full">
                        <ArrowLeft size={20} />
                    </Button>
                    <div>
                        <h1 className="text-xl font-black text-sys-900 uppercase">Nexus Label Engine</h1>
                        <p className="text-[10px] font-bold text-sys-400 uppercase tracking-widest">Imprenta Digital de Góndola</p>
                    </div>
                </div>

                <div className="flex flex-wrap gap-4 items-center">
                    {/* SELECTOR DE COLORES */}
                    <div className="flex bg-sys-100 p-1.5 rounded-xl items-center gap-2">
                        <span className="text-[10px] font-bold text-sys-400 px-2">COLOR:</span>
                        {Object.keys(COLOR_MAP).map(colorKey => {
                            const c = COLOR_MAP[colorKey];
                            return (
                                <button
                                    key={colorKey}
                                    onClick={() => { setLabelColor(colorKey); setPrintStyle('color'); }}
                                    className={cn(
                                        "w-6 h-6 rounded-full border-2 transition-all hover:scale-110",
                                        c.bgClass,
                                        labelColor === colorKey && printStyle === 'color' ? "ring-2 ring-offset-1 ring-sys-400 border-white scale-110" : "border-transparent opacity-60 hover:opacity-100"
                                    )}
                                    title={colorKey.toUpperCase()}
                                />
                            );
                        })}
                        <div className="w-px h-4 bg-sys-300 mx-1"></div>
                        <button onClick={() => setPrintStyle('bw')} className={cn("px-3 py-1 text-[10px] font-bold rounded-lg transition-all", printStyle === 'bw' ? "bg-sys-900 text-white shadow" : "text-sys-500 hover:bg-white")}>
                           B&N
                        </button>
                    </div>

                    {/* SELECTOR DE LAYOUT (NUEVO) */}
                    <div className="flex bg-sys-100 p-1.5 rounded-xl items-center gap-2 relative">
                        <Grid size={16} className="text-sys-500 ml-2"/>
                        <select 
                            value={layoutId} 
                            onChange={(e) => setLayoutId(e.target.value)}
                            className="bg-transparent text-xs font-bold text-sys-800 outline-none cursor-pointer py-1 pr-2 w-48"
                        >
                            <optgroup label="Maxi Formato">
                                <option value="poster_1">Gigante (1/Hoja) - Horizontal</option>
                                <option value="maxi_3">Oferta (3/Hoja)</option>
                            </optgroup>
                            <optgroup label="Góndola Estándar">
                                <option value="gondola_big">Grande (14/Hoja)</option>
                                <option value="gondola_std">Estándar (21/Hoja)</option>
                                <option value="gondola_sm">Compacta (28/Hoja)</option>
                            </optgroup>
                            <optgroup label="Miniatura">
                                <option value="mini_65">Códigos (65/Hoja)</option>
                            </optgroup>
                        </select>
                    </div>
                </div>
            </div>

            <div className="flex gap-6 h-full min-h-0">
                
                {/* --- SIDEBAR SELECCIÓN --- */}
                <div className="w-1/3 flex flex-col gap-4">
                    <Card className="p-4 border-sys-200">
                        {/* FILTROS AVANZADOS */}
                        <div className="flex flex-col gap-3 mb-4">
                            <div className="flex gap-2">
                                <div className="relative group flex-1">
                                    <Search className="absolute left-3 top-2.5 text-sys-400" size={18} />
                                    <input type="text" placeholder="Buscar producto..." className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-sys-50 border-none outline-none focus:ring-2 focus:ring-brand/20 transition-all font-medium" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                                </div>
                                <button 
                                    onClick={() => setShowOnlyPromos(!showOnlyPromos)} 
                                    className={cn("p-2.5 rounded-xl border transition-all flex items-center justify-center", showOnlyPromos ? "bg-red-50 border-red-200 text-red-600 shadow-sm" : "bg-white border-sys-200 text-sys-400 hover:text-sys-600")}
                                    title="Mostrar solo Ofertas"
                                >
                                    <Percent size={20} />
                                </button>
                            </div>
                            
                            {/* 🔥 DATE FILTER INPUT */}
                            <div className="flex items-center gap-2 bg-sys-50 p-2 rounded-xl border border-sys-100">
                                <div className="p-2 bg-white rounded-lg shadow-sm text-sys-500"><Calendar size={16}/></div>
                                <input 
                                    type="date" 
                                    className="bg-transparent border-none text-xs font-bold text-sys-700 w-full outline-none"
                                    value={filterDate}
                                    onChange={(e) => setFilterDate(e.target.value)}
                                />
                                {filterDate && (
                                    <button onClick={() => setFilterDate('')} className="text-sys-400 hover:text-red-500"><X size={14}/></button>
                                )}
                            </div>
                        </div>

                        <div className="flex justify-between items-center mb-2 px-1">
                            <span className="text-[10px] font-bold text-sys-400 uppercase">{filteredProducts.length} Resultados</span>
                            {filteredProducts.length > 0 && (
                                <button onClick={addAllFiltered} className="text-[10px] font-black text-brand hover:underline">AGREGAR TODOS</button>
                            )}
                        </div>

                        <div className="space-y-2 max-h-[350px] overflow-y-auto custom-scrollbar pr-2">
                            {filteredProducts.map(p => {
                                const promo = GondolaLabelEngine.calculatePromoDetails(p);
                                return (
                                    <button key={p.id} onClick={() => addToQueue(p)} className="w-full flex justify-between items-center p-3 bg-white hover:bg-brand/5 rounded-xl border border-sys-100 hover:border-brand/20 transition-all group">
                                        <div className="min-w-0 text-left">
                                            <p className="text-xs font-black text-sys-800 truncate uppercase">{p.name}</p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-[10px] font-mono text-sys-400">{p.code || 'S/C'}</span>
                                                {promo.isPromo && <span className="bg-red-100 text-red-600 text-[9px] px-1.5 rounded-sm font-bold uppercase">{promo.label}</span>}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className={cn("text-[11px] font-bold", promo.isPromo ? "text-red-600" : "text-sys-900")}>$ {Math.floor(promo.currentPrice)}</p>
                                            {promo.isPromo && <p className="text-[9px] text-sys-400 line-through decoration-red-300">$ {p.price}</p>}
                                        </div>
                                        <Plus size={18} className="text-sys-300 group-hover:text-brand ml-2" />
                                    </button>
                                );
                            })}
                        </div>
                    </Card>

                    <div className="flex-1 bg-white rounded-2xl border border-sys-200 p-5 flex flex-col overflow-hidden">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-[10px] font-black uppercase text-sys-400 tracking-widest">Cola ({printQueue.length})</h2>
                            <button onClick={() => setPrintQueue([])} className="text-[10px] font-bold text-red-500 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors">LIMPIAR</button>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
                            {printQueue.map((item, idx) => (
                                <div key={`${item.id}-${idx}`} className="flex justify-between items-center p-3 bg-sys-50 rounded-xl border border-sys-100 group animate-in slide-in-from-left-2">
                                    <span className="text-[10px] font-bold text-sys-700 truncate flex-1 uppercase">{item.name}</span>
                                    <button onClick={() => removeFromQueue(idx)} className="ml-2 text-sys-300 hover:text-red-500 transition-all"><Trash2 size={14}/></button>
                                </div>
                            ))}
                        </div>
                        <Button className="w-full mt-6 py-4 bg-sys-900 text-white font-black uppercase text-xs tracking-widest shadow-2xl hover:bg-black active:scale-95 transition-all" onClick={handleDownloadPDF} disabled={printQueue.length === 0 || isGenerating}>
                            {isGenerating ? "PROCESANDO..." : <><Printer size={18} className="mr-2"/> GENERAR PDF</>}
                        </Button>
                    </div>
                </div>

                {/* --- PREVIEW AREA (DINÁMICO) --- */}
                <div className="flex-1 bg-sys-200/30 rounded-3xl border border-sys-200 p-8 overflow-y-auto custom-scrollbar flex justify-center">
                    <div 
                        className={cn(
                            "bg-white shadow-2xl origin-top transform transition-all duration-300",
                            currentLayout.orientation === 'l' ? "w-[297mm] h-[210mm] scale-[0.6]" : "min-h-[297mm] w-[210mm] scale-90"
                        )} 
                        style={{ padding: '0' }}
                    >
                        <div className="flex flex-col">
                            {printQueue.length === 0 ? (
                                <div className={cn("flex flex-col items-center justify-center text-sys-300 gap-4", currentLayout.orientation === 'l' ? "h-[210mm]" : "h-[297mm]")}>
                                    <Layout size={64} strokeWidth={1} className="opacity-20"/>
                                    <p className="text-2xl font-black opacity-10 uppercase tracking-tighter">Vista Previa Nexus Engine</p>
                                </div>
                            ) : (
                                <div style={{ 
                                    display: 'grid', 
                                    gridTemplateColumns: `repeat(${currentLayout.cols}, 1fr)`,
                                    alignContent: 'start'
                                }}>
                                    {printQueue.map((p, idx) => {
                                        const promo = GondolaLabelEngine.calculatePromoDetails(p);
                                        const isPromo = promo.isPromo; 
                                        const isBW = printStyle === 'bw';
                                        const activeColor = isBW ? COLOR_MAP.black : COLOR_MAP[labelColor];
                                        
                                        const containerStyle = { height: `${currentLayout.height}mm` };
                                        const headerStyle = { height: `${currentLayout.headerH}mm` };

                                        return (
                                            <div key={`${p.id}-${idx}`} className="border border-sys-900 flex flex-col relative overflow-hidden" style={containerStyle}>
                                                
                                                {currentLayout.type === 'barcode' ? (
                                                    <div className="flex flex-col items-center justify-center h-full p-1 text-center">
                                                        <span className="text-[7px] font-bold truncate w-full mb-1">{p.name.slice(0,25)}</span>
                                                        <svg id={`preview-bc-${p.id}-${idx}`} className="w-full h-8"></svg>
                                                        <span className="font-mono text-[9px] font-bold mt-1">{p.code}</span>
                                                    </div>
                                                ) : (
                                                    <>
                                                        {/* HEADER */}
                                                        <div 
                                                            className={cn(
                                                                "flex items-center justify-center",
                                                                isPromo ? `${activeColor.bgClass} text-white` : (isBW ? "bg-black text-white" : `${activeColor.bgClass} text-white`)
                                                            )}
                                                            style={headerStyle}
                                                        >
                                                            <span className={cn("font-black uppercase", currentLayout.type === 'shelf_talker' ? "text-4xl" : "text-[8px]")}>
                                                                {isPromo ? promo.label : "PRECIO CONTADO"}
                                                            </span>
                                                        </div>
                                                        
                                                        <div className="flex-1 flex flex-col items-center justify-center p-2">
                                                            <h3 className={cn("font-bold text-center mb-1 line-clamp-2 leading-tight px-1 uppercase", currentLayout.type === 'shelf_talker' ? "text-4xl" : "text-[9px]")}>{p.name}</h3>
                                                            <div className="flex items-baseline gap-1">
                                                                <span className={cn("font-black", currentLayout.type === 'shelf_talker' ? "text-[8rem] leading-none" : "text-3xl")}>
                                                                    ${Math.floor(promo.currentPrice).toLocaleString('es-AR')}
                                                                </span>
                                                                <span className={cn("font-bold", currentLayout.type === 'shelf_talker' ? "text-4xl" : "text-xs")}>00</span>
                                                            </div>
                                                            {isPromo && promo.type !== 'BUNDLE_DEAL' && (
                                                                <span className={cn("text-sys-400 line-through font-bold", currentLayout.type === 'shelf_talker' ? "text-2xl" : "text-[10px]")}>
                                                                    ${p.price.toLocaleString('es-AR')}
                                                                </span>
                                                            )}
                                                        </div>

                                                        <div className={cn("p-1 bg-white border-t border-black flex flex-col items-center", currentLayout.type === 'shelf_talker' ? "h-[15mm] justify-center" : "h-auto")}>
                                                            {isPromo && promo.footer ? (
                                                                <span className={cn("font-black uppercase", activeColor.textClass, currentLayout.type === 'shelf_talker' ? "text-xl" : "text-[7px]")}>{promo.footer}</span>
                                                            ) : (
                                                                <div className="w-full flex justify-between px-2 mt-1">
                                                                    <span className={cn("font-mono font-bold text-sys-500", currentLayout.type === 'shelf_talker' ? "text-lg" : "text-[7px]")}>{p.code || 'S/C'}</span>
                                                                    <span className={cn("font-bold text-sys-400", currentLayout.type === 'shelf_talker' ? "text-sm" : "text-[6px]")}>{new Date().toLocaleDateString()}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};