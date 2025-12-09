import React, { useState, useEffect, useRef } from 'react';
import { 
    Search, Printer, X, Plus, Trash2, 
    Tag, Barcode, ArrowLeft, Download, Save 
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import JsBarcode from 'jsbarcode';
import jsPDF from 'jspdf'; 

import { productRepository } from '../repositories/productRepository';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { cn } from '../../../core/utils/cn';

export const PrintLabelsPage = () => {
    const navigate = useNavigate();
    
    // Estados
    const [allProducts, setAllProducts] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [printQueue, setPrintQueue] = useState([]); 
    const [mode, setMode] = useState('gondola'); // 'gondola' | 'barcode'
    const [isGenerating, setIsGenerating] = useState(false);

    // Cargar productos
    useEffect(() => {
        const load = async () => {
            const data = await productRepository.getAll();
            setAllProducts(data || []);
        };
        load();
    }, []);

    // Efecto para visualizar códigos en pantalla (Preview HTML)
    useEffect(() => {
        if (mode === 'barcode' && printQueue.length > 0) {
            setTimeout(() => {
                printQueue.forEach((item, index) => {
                    try {
                        const uniqueId = `#preview-bc-${item.id}-${index}`;
                        const codeValue = item.code || item.id.slice(0,8).toUpperCase();
                        JsBarcode(uniqueId, codeValue, {
                            format: "CODE128", lineColor: "#000", width: 2, height: 30, displayValue: false, margin: 0
                        });
                    } catch (e) {}
                });
            }, 100); 
        }
    }, [printQueue, mode]);

    const filteredProducts = allProducts.filter(p => 
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        (p.code && p.code.includes(searchTerm))
    ).slice(0, 10); 

    // Agregar a la cola (Con auto-generación de código si falta)
    const addToQueue = async (product) => {
        if (product.code && product.code.trim() !== '') {
            setPrintQueue(prev => [...prev, product]);
            return;
        }

        const autoCode = product.id.slice(0, 8).toUpperCase();
        try {
            const updatedProduct = { ...product, code: autoCode };
            await productRepository.save(updatedProduct);
            setAllProducts(prev => prev.map(p => p.id === product.id ? updatedProduct : p));
            setPrintQueue(prev => [...prev, updatedProduct]);
        } catch (error) {
            alert("Error al asignar código automático.");
        }
    };

    const removeFromQueue = (indexToRemove) => setPrintQueue(printQueue.filter((_, idx) => idx !== indexToRemove));

    // =========================================================================
    // 🖨️ MOTOR DE GENERACIÓN PDF (AJUSTADO PARA VISIBILIDAD)
    // =========================================================================
    const handleDownloadPDF = () => {
        if (printQueue.length === 0) return;
        setIsGenerating(true);

        try {
            const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
            const pageWidth = 210;
            const pageHeight = 297;
            const margin = 10; 
            const usableWidth = pageWidth - (margin * 2);
            
            const cols = mode === 'gondola' ? 3 : 4;
            const gap = 2; 
            const labelWidth = (usableWidth - ((cols - 1) * gap)) / cols;
            const labelHeight = mode === 'gondola' ? 45 : 25; 

            let x = margin;
            let y = margin;
            let colCounter = 0;

            const getBarcodeBase64 = (text) => {
                const canvas = document.createElement("canvas");
                JsBarcode(canvas, text, { format: "CODE128", displayValue: false, margin: 0, width: 2, height: 40 });
                return canvas.toDataURL("image/png");
            };

            printQueue.forEach((p) => {
                if (y + labelHeight > pageHeight - margin) {
                    doc.addPage();
                    x = margin;
                    y = margin;
                    colCounter = 0;
                }

                doc.setDrawColor(0); 
                doc.setTextColor(0); 
                doc.setLineWidth(0.3); // Línea fina para mejor corte
                doc.rect(x, y, labelWidth, labelHeight);

                if (mode === 'gondola') {
                    // === DISEÑO GÓNDOLA ===
                    const headerHeight = 14;
                    doc.setLineWidth(0.2);
                    doc.line(x, y + headerHeight, x + labelWidth, y + headerHeight);

                    doc.setFont("helvetica", "bold");
                    doc.setFontSize(10);
                    const splitTitle = doc.splitTextToSize(p.name.toUpperCase(), labelWidth - 2);
                    const textY = y + (headerHeight / 2) + (splitTitle.length > 1 ? -2 : 1);
                    doc.text(splitTitle.slice(0, 2), x + (labelWidth / 2), textY, { align: "center" });

                    doc.setFont("helvetica", "bold");
                    doc.setFontSize(12);
                    doc.text("$", x + 3, y + 28);
                    
                    doc.setFontSize(40); 
                    const priceInt = Math.floor(p.price).toLocaleString('es-AR');
                    doc.text(priceInt, x + (labelWidth / 2) + 1, y + 32, { align: "center" });

                    doc.setFontSize(9);
                    doc.text("00", x + labelWidth - 6, y + 21);

                    doc.setFontSize(6);
                    doc.setFont("helvetica", "normal");
                    doc.text("PRECIO CONTADO", x + (labelWidth / 2), y + 36, { align: "center" });

                    const footerHeight = 6;
                    const footerY = y + labelHeight - footerHeight;
                    doc.line(x, footerY, x + labelWidth, footerY);
                    
                    doc.setFontSize(6);
                    doc.setFont("helvetica", "bold");
                    doc.text("NOAR POS", x + 2, y + labelHeight - 2);
                    
                    doc.setFont("courier", "bold");
                    doc.setFontSize(8);
                    doc.text(p.code || "S/C", x + labelWidth - 2, y + labelHeight - 2, { align: "right" });

                } else {
                    // === DISEÑO CÓDIGO DE BARRAS (AJUSTADO) ===
                    
                    // 1. Nombre (Arriba)
                    doc.setFont("helvetica", "bold");
                    doc.setFontSize(7);
                    const nameShort = p.name.length > 25 ? p.name.substring(0, 25) + '...' : p.name;
                    doc.text(nameShort, x + (labelWidth / 2), y + 4, { align: "center" });

                    // 2. Barcode (Centro)
                    // Usamos el código real. getBarcodeBase64 ya no pone texto, solo barras.
                    const codeVal = p.code || p.id.slice(0,8).toUpperCase();
                    const imgData = getBarcodeBase64(codeVal);
                    
                    const bcWidth = labelWidth - 4; // Margen lateral
                    const bcHeight = 11; // Altura controlada para no pisar el texto
                    doc.addImage(imgData, 'PNG', x + 2, y + 5.5, bcWidth, bcHeight);

                    // 3. Texto Numérico (Abajo - ¡AQUÍ ESTABA EL PROBLEMA!)
                    // Ajustamos Y a 22 para darle espacio debajo de las barras
                    doc.setFont("courier", "bold");
                    doc.setFontSize(10); // Tamaño legible
                    doc.text(codeVal, x + (labelWidth / 2), y + 22, { align: "center" });
                }

                colCounter++;
                if (colCounter < cols) {
                    x += labelWidth + gap;
                } else {
                    x = margin;
                    y += labelHeight + gap;
                    colCounter = 0;
                }
            });

            doc.save(`Etiquetas_${mode}_${new Date().toISOString().slice(0,10)}.pdf`);

        } catch (error) {
            console.error("Error PDF Nativo:", error);
            alert("Error al generar PDF.");
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="h-[calc(100vh-2rem)] flex flex-col gap-4 animate-in fade-in">
            
            {/* Header */}
            <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-sys-200">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" onClick={() => navigate(-1)}>
                        <ArrowLeft size={20} />
                    </Button>
                    <div>
                        <h1 className="text-xl font-bold text-sys-900">Impresión de Etiquetas</h1>
                        <p className="text-xs text-sys-500">Generador de precios y códigos de barra</p>
                    </div>
                </div>

                <div className="flex gap-3 bg-sys-100 p-1 rounded-lg">
                    <button 
                        onClick={() => setMode('gondola')}
                        className={cn("px-4 py-2 text-sm font-bold rounded-md flex items-center gap-2 transition-all", mode === 'gondola' ? "bg-white shadow text-brand" : "text-sys-500 hover:text-sys-700")}
                    >
                        <Tag size={16}/> Góndola (Precio)
                    </button>
                    <button 
                        onClick={() => setMode('barcode')}
                        className={cn("px-4 py-2 text-sm font-bold rounded-md flex items-center gap-2 transition-all", mode === 'barcode' ? "bg-white shadow text-sys-900" : "text-sys-500 hover:text-sys-700")}
                    >
                        <Barcode size={16}/> Códigos de Barra
                    </button>
                </div>
            </div>

            <div className="flex gap-6 h-full min-h-0">
                
                {/* PANEL IZQUIERDO: SELECCIÓN */}
                <div className="w-1/3 flex flex-col gap-4">
                    <Card className="p-4 bg-sys-50 border-sys-200">
                        <div className="relative group">
                            <Search className="absolute left-3 top-3 text-sys-400 group-focus-within:text-brand" size={18} />
                            <input 
                                type="text" 
                                placeholder="Buscar producto..." 
                                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-sys-200 outline-none focus:border-brand transition-all"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="mt-3 flex flex-col gap-2 max-h-[300px] overflow-y-auto custom-scrollbar">
                            {filteredProducts.map(p => (
                                <button 
                                    key={p.id} 
                                    onClick={() => addToQueue(p)}
                                    className="flex justify-between items-center p-2 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-sys-200 group text-left"
                                >
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-sys-800 truncate">{p.name}</p>
                                        <p className="text-[10px] text-sys-500 font-mono">
                                            {p.code ? p.code : <span className="text-orange-500 font-bold flex items-center gap-1"><Save size={10}/> Auto-Generar</span>}
                                        </p>
                                    </div>
                                    <Plus size={16} className="text-sys-400 group-hover:text-brand" />
                                </button>
                            ))}
                        </div>
                    </Card>

                    <div className="flex-1 bg-white rounded-2xl border border-sys-200 p-4 flex flex-col">
                        <div className="flex justify-between items-center mb-2 pb-2 border-b border-sys-100">
                            <span className="text-xs font-bold uppercase text-sys-500">Cola de Impresión ({printQueue.length})</span>
                            {printQueue.length > 0 && (
                                <button onClick={() => setPrintQueue([])} className="text-[10px] text-red-500 hover:underline">Limpiar</button>
                            )}
                        </div>
                        
                        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
                            {printQueue.map((item, idx) => (
                                <div key={`${item.id}-${idx}`} className="flex justify-between items-center p-2 bg-sys-50 rounded-lg text-xs">
                                    <span className="truncate flex-1 pr-2">{item.name}</span>
                                    <button onClick={() => removeFromQueue(idx)} className="text-sys-400 hover:text-red-500"><X size={14}/></button>
                                </div>
                            ))}
                            {printQueue.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center text-sys-300 opacity-50">
                                    <Printer size={32} className="mb-2"/>
                                    <p>Lista vacía</p>
                                </div>
                            )}
                        </div>

                        <Button 
                            className="w-full mt-4 bg-sys-900 hover:bg-black text-white shadow-xl"
                            onClick={handleDownloadPDF}
                            disabled={printQueue.length === 0 || isGenerating}
                        >
                            {isGenerating ? "Generando..." : <><Download size={18} className="mr-2"/> Descargar PDF</>}
                        </Button>
                    </div>
                </div>

                {/* PANEL DERECHO: VISTA PREVIA (Solo Visual HTML) */}
                <div className="flex-1 bg-sys-200/50 rounded-2xl border border-sys-200 overflow-y-auto flex justify-center p-8 custom-scrollbar relative">
                    <div className="bg-white shadow-2xl relative" style={{ width: '210mm', minHeight: '297mm', padding: '10mm', boxSizing: 'border-box' }}>
                        {printQueue.length === 0 ? (
                            <div className="absolute inset-0 flex items-center justify-center text-sys-200">
                                <p className="text-4xl font-black opacity-20 uppercase rotate-45">Vista Previa</p>
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gap: '2mm', gridTemplateColumns: mode === 'gondola' ? 'repeat(3, 1fr)' : 'repeat(4, 1fr)', alignContent: 'start' }}>
                                {printQueue.map((p, idx) => (
                                    <div key={`${p.id}-${idx}`} className={cn("border border-black break-inside-avoid overflow-hidden relative bg-white", mode === 'gondola' ? "h-[45mm] flex flex-col justify-between" : "h-[25mm] p-1 flex flex-col items-center justify-center")}>
                                        {mode === 'gondola' ? (
                                            <div className="flex flex-col h-full">
                                                <div className="h-[14mm] flex items-center justify-center px-1 border-b border-black pt-1">
                                                    <p className="text-[10px] font-bold text-center text-black leading-tight line-clamp-2">{p.name.toUpperCase()}</p>
                                                </div>
                                                <div className="flex-1 flex items-center justify-center relative">
                                                    <span className="text-lg font-bold text-black mr-1 mt-1">$</span>
                                                    <span className="text-5xl font-black text-black tracking-tighter leading-none">{Math.floor(p.price).toLocaleString('es-AR')}</span>
                                                    <div className="flex flex-col ml-0.5 mt-1"><span className="text-xs font-bold text-black leading-none">00</span></div>
                                                    <p className="text-[6px] font-normal text-black uppercase absolute bottom-1">Precio Contado</p>
                                                </div>
                                                <div className="h-[6mm] border-t border-black flex justify-between items-center px-2 bg-white">
                                                    <span className="text-[8px] font-bold">NOAR POS</span>
                                                    <span className="text-[9px] font-mono font-bold">{p.code || p.id.slice(0,6)}</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <p className="text-[8px] font-bold text-black truncate w-full text-center mb-1">{p.name.slice(0,25)}</p>
                                                <svg id={`preview-bc-${p.id}-${idx}`} className="w-full h-full max-h-[14mm]"></svg>
                                                {/* Visualización del código en HTML también */}
                                                <p className="text-[9px] font-mono font-bold text-center w-full leading-none mt-0.5">{p.code || p.id.slice(0,8).toUpperCase()}</p>
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};