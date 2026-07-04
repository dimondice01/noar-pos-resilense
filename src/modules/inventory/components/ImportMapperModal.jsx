import React, { useState, useEffect } from 'react';
// 🔥 Importamos AVAILABLE_FIELDS para tener las opciones reales
import { useSmartImport, AVAILABLE_FIELDS } from '../hooks/useSmartImport';
import { X, Upload, Save, AlertTriangle, CheckCircle, FileSpreadsheet, Scale } from 'lucide-react';
import { cn } from '../../../core/utils/cn';

export const ImportMapperModal = ({ isOpen, onClose, branchId, onSuccess }) => {
    const {
        parseFile,
        processImport,
        processScaleImport,
        previewData,
        isProcessing,
        progress
    } = useSmartImport();

    const [mapping, setMapping] = useState({});
    const [headers, setHeaders] = useState([]);
    const [roundTo50, setRoundTo50] = useState(false);
    const [forceWeighable, setForceWeighable] = useState(false);

    // Modo Balanza
    const [scaleMode, setScaleMode] = useState(false);
    const [scaleColPlu,   setScaleColPlu]   = useState(0);
    const [scaleColName,  setScaleColName]  = useState(1);
    const [scaleColPrice, setScaleColPrice] = useState(2);
    const [scaleUpdatePrice, setScaleUpdatePrice] = useState(false);
    const [scaleResult, setScaleResult] = useState(null);

    // Extraer headers reales del preview cuando cambia
    useEffect(() => {
        if (previewData && previewData.length > 0) {
            // Asumimos que la fila 0 son headers visuales si el usuario lo desea, 
            // pero PapaParse header:false nos da arrays por índice.
            // Generamos índices visuales "Columna A, B, C..." o usamos el contenido de la fila 0 como guía visual
            const sampleRow = previewData[0];
            setHeaders(sampleRow.map((_, i) => `Columna ${i + 1}`));
        }
    }, [previewData]);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) { parseFile(file); setScaleResult(null); }
    };

    const handleScaleSave = async () => {
        try {
            const result = await processScaleImport(scaleColPlu, scaleColName, scaleColPrice, scaleUpdatePrice);
            setScaleResult(result);
            if (result.matched > 0 && onSuccess) onSuccess();
        } catch (e) {
            console.error(e);
            alert('❌ Error al procesar el archivo de balanza.');
        }
    };

    const handleMapChange = (colIndex, fieldKey) => {
        setMapping(prev => ({ ...prev, [colIndex]: fieldKey }));
    };

    const handleSave = async () => {
        // Validación: Solo el Precio y Código son los más críticos para un Upsert
        const selectedFields = Object.values(mapping);
        if (!selectedFields.includes('code')) return alert("⚠️ Error: Falta asignar la columna 'Código de Barras' para identificar los productos.");
        if (!selectedFields.includes('price')) return alert("⚠️ Error: Falta asignar la columna 'Precio'.");

        try {
            // 🔥 LE PASAMOS LA OPCIÓN AL HOOK
            const result = await processImport(mapping, branchId, { roundTo50, forceWeighable });
            
            // Mensaje de éxito detallado
            let msg = `✅ ¡Importación / Actualización Exitosa!\n\n`;
            msg += `📦 Productos Procesados: ${result.processed}\n`;
            if (result.categories > 0) msg += `📂 Categorías Creadas: ${result.categories}\n`;
            if (result.brands > 0) msg += `🏷️ Marcas Creadas: ${result.brands}\n`;
            if (result.stockMovements > 0) msg += `📈 Movimientos de Stock: ${result.stockMovements}`;

            alert(msg);
            
            if (onSuccess) onSuccess();
            onClose();
        } catch (e) {
            console.error(e);
            alert("❌ Ocurrió un error durante la importación. Revisa la consola.");
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-sys-200">
                
                {/* Header */}
                <div className="p-5 border-b border-sys-100 flex justify-between items-center bg-sys-50">
                    <div>
                        <h2 className="text-xl font-black text-sys-900 flex items-center gap-2">
                            {scaleMode ? <Scale className="text-orange-500" size={24} /> : <Upload className="text-brand" size={24} />}
                            {scaleMode ? 'Importar PLUs de Balanza' : 'Importador Inteligente'}
                        </h2>
                        <p className="text-sm text-sys-500 mt-1">
                            {scaleMode
                                ? 'Carga el CSV de tu balanza y actualiza el PLU de cada producto pesable por nombre.'
                                : 'Sube tu Excel/CSV y actualiza masivamente tus precios o catálogo.'}
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => { setScaleMode(m => !m); setScaleResult(null); }}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all",
                                scaleMode
                                    ? "bg-orange-500 text-white border-orange-500 shadow-lg shadow-orange-500/20"
                                    : "bg-white text-orange-600 border-orange-200 hover:border-orange-400"
                            )}
                        >
                            <Scale size={16} /> Modo Balanza
                        </button>
                        <button onClick={onClose} className="p-2 hover:bg-sys-200 rounded-full transition-colors text-sys-400 hover:text-sys-600">
                            <X size={24}/>
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-hidden flex flex-col bg-sys-50 relative">
                    
                    {/* Loading Overlay */}
                    {isProcessing && (
                        <div className="absolute inset-0 z-10 bg-white/90 flex flex-col items-center justify-center p-8 backdrop-blur-sm">
                            <div className="w-16 h-16 border-4 border-sys-100 border-t-brand rounded-full animate-spin mb-4"></div>
                            <h3 className="text-xl font-black text-sys-800 mb-2">{progress.stage}</h3>
                            <div className="w-full max-w-md h-2 bg-sys-100 rounded-full overflow-hidden mb-2">
                                <div 
                                    className="h-full bg-brand transition-all duration-300 ease-out"
                                    style={{ width: `${(progress.current / (progress.total || 1)) * 100}%` }}
                                ></div>
                            </div>
                            <p className="text-sm font-medium text-sys-500">
                                Procesando {progress.current} de {progress.total} filas...
                            </p>
                        </div>
                    )}

                    {!previewData.length ? (
                        <div className="flex-1 flex flex-col items-center justify-center p-12">
                            <input type="file" accept=".csv,.txt" onChange={handleFileChange} className="hidden" id="csvUpload"/>
                            <label 
                                htmlFor="csvUpload" 
                                className="group cursor-pointer flex flex-col items-center justify-center p-12 border-2 border-dashed border-sys-300 rounded-3xl bg-white hover:border-brand hover:bg-brand/5 transition-all w-full max-w-2xl"
                            >
                                <div className="w-24 h-24 bg-sys-100 text-sys-400 group-hover:bg-brand/10 group-hover:text-brand rounded-full flex items-center justify-center mb-6 transition-colors">
                                    <FileSpreadsheet size={48} />
                                </div>
                                <span className="text-2xl font-black text-sys-700 group-hover:text-brand mb-2">Subir Archivo CSV</span>
                                <p className="text-sys-400 text-center max-w-md">
                                    Arrastra tu archivo aquí o haz clic para buscarlo.<br/>
                                    <span className="text-xs mt-2 block opacity-70">Soporta separación por comas (,) o punto y coma (;)</span>
                                </p>
                            </label>
                        </div>
                    ) : scaleMode ? (
                        <div className="flex-1 overflow-auto p-6 space-y-4">
                            <div className="bg-orange-50 border border-orange-100 p-4 rounded-xl flex gap-3 text-orange-800 text-sm">
                                <Scale size={20} className="shrink-0 mt-0.5 text-orange-500"/>
                                <div>
                                    <strong className="block font-bold mb-1">Cruce por Nombre</strong>
                                    El sistema busca cada fila del CSV por <strong>nombre exacto</strong>, pisa el código genérico con el PLU real y <strong>marca el producto como pesable (KG)</strong> automáticamente. Indicá en qué columna está cada dato.
                                </div>
                            </div>

                            {/* Selector de columnas */}
                            <div className="bg-white border border-sys-200 rounded-xl p-4 grid grid-cols-3 gap-4">
                                {[
                                    { label: 'Columna PLU', value: scaleColPlu, set: setScaleColPlu },
                                    { label: 'Columna Nombre', value: scaleColName, set: setScaleColName },
                                    { label: 'Columna Precio', value: scaleColPrice, set: setScaleColPrice },
                                ].map(({ label, value, set }) => (
                                    <div key={label}>
                                        <label className="text-[10px] font-bold text-sys-500 uppercase block mb-1.5">{label}</label>
                                        <select
                                            value={value}
                                            onChange={e => set(Number(e.target.value))}
                                            className="w-full border border-sys-200 rounded-lg py-2 px-3 text-sm font-medium outline-none focus:border-orange-400"
                                        >
                                            {(previewData[0] || []).map((cell, i) => (
                                                <option key={i} value={i}>Col {i + 1} — {String(cell).slice(0, 20)}</option>
                                            ))}
                                        </select>
                                    </div>
                                ))}
                            </div>

                            {/* Opción actualizar precio */}
                            <div className="flex items-center gap-3 bg-white p-3 px-4 rounded-xl border border-sys-200 w-fit cursor-pointer hover:bg-sys-50"
                                onClick={() => setScaleUpdatePrice(v => !v)}>
                                <input type="checkbox" checked={scaleUpdatePrice} onChange={() => {}} className="w-5 h-5 text-orange-500 rounded" />
                                <label className="text-sm font-bold text-sys-800 cursor-pointer select-none flex flex-col">
                                    <span>También actualizar el precio</span>
                                    <span className="text-[10px] text-sys-500 font-normal">Si no está marcado, solo se pisa el PLU</span>
                                </label>
                            </div>

                            {/* Preview */}
                            <div className="bg-white border border-sys-200 rounded-xl overflow-hidden">
                                <table className="w-full text-xs">
                                    <thead className="bg-sys-50 border-b border-sys-200">
                                        <tr>
                                            {(previewData[0] || []).map((_, i) => (
                                                <th key={i} className={cn("p-3 text-left font-bold text-sys-500",
                                                    i === scaleColPlu   && "text-orange-600 bg-orange-50",
                                                    i === scaleColName  && "text-blue-600 bg-blue-50",
                                                    i === scaleColPrice && scaleUpdatePrice && "text-green-600 bg-green-50"
                                                )}>
                                                    {i === scaleColPlu ? '⚡ PLU' : i === scaleColName ? '🏷 Nombre' : i === scaleColPrice && scaleUpdatePrice ? '$ Precio' : `Col ${i+1}`}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-sys-100">
                                        {previewData.slice(0, 5).map((row, ri) => (
                                            <tr key={ri} className="hover:bg-sys-50">
                                                {row.map((cell, ci) => (
                                                    <td key={ci} className={cn("p-3 font-mono",
                                                        ci === scaleColPlu   && "font-bold text-orange-700",
                                                        ci === scaleColName  && "font-bold text-blue-700",
                                                        ci === scaleColPrice && scaleUpdatePrice && "font-bold text-green-700"
                                                    )}>{cell}</td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div className="p-2 text-center text-[10px] text-sys-400 bg-sys-50 border-t border-sys-200 uppercase tracking-wider">Vista previa — 5 primeras filas</div>
                            </div>

                            {/* Resultado post-import */}
                            {scaleResult && (
                                <div className={cn("p-4 rounded-xl border text-sm font-medium", scaleResult.matched > 0 ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800")}>
                                    <p className="font-bold mb-1">✅ {scaleResult.matched} productos actualizados con PLU</p>
                                    {scaleResult.unmatched > 0 && (
                                        <p className="text-[11px] text-orange-700">⚠️ {scaleResult.unmatched} sin coincidencia por nombre: {scaleResult.unmatchedNames.slice(0, 5).join(', ')}{scaleResult.unmatched > 5 ? '...' : ''}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex-1 overflow-auto p-6">

                            {/* Warning Box */}
                            <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex gap-3 text-blue-800 text-sm shadow-sm mb-4">
                                <AlertTriangle size={20} className="shrink-0 mt-0.5 text-blue-600"/>
                                <div>
                                    <strong className="block font-bold mb-1 text-blue-700">Actualización Inteligente (Upsert)</strong>
                                    Por favor, mapea la columna <strong>Código</strong> y <strong>Precio</strong>. Si el producto ya existe en tu base, solo sobreescribiremos el precio y respetaremos su nombre/categoría. Si es nuevo, lo crearemos.
                                </div>
                            </div>

                            {/* OPCIONES */}
                            <div className="flex flex-wrap gap-3 mb-6">
                                <div className="flex items-center gap-3 bg-white p-3 px-4 rounded-xl border border-sys-200 shadow-sm cursor-pointer hover:bg-sys-50 transition-colors" onClick={() => setRoundTo50(!roundTo50)}>
                                    <input type="checkbox" id="roundTo50Toggle" checked={roundTo50} onChange={(e) => setRoundTo50(e.target.checked)} className="w-5 h-5 text-brand rounded focus:ring-brand border-gray-300 cursor-pointer"/>
                                    <label htmlFor="roundTo50Toggle" className="text-sm font-bold text-sys-800 cursor-pointer select-none flex flex-col">
                                        <span>Redondear precios a múltiplos de $50</span>
                                        <span className="text-[10px] text-sys-500 font-normal">Ejemplo: $1123 ➔ $1100 | $1135 ➔ $1150</span>
                                    </label>
                                </div>
                                <div className="flex items-center gap-3 bg-white p-3 px-4 rounded-xl border border-orange-200 shadow-sm cursor-pointer hover:bg-orange-50 transition-colors" onClick={() => setForceWeighable(!forceWeighable)}>
                                    <input type="checkbox" id="forceWeighableToggle" checked={forceWeighable} onChange={(e) => setForceWeighable(e.target.checked)} className="w-5 h-5 text-orange-500 rounded focus:ring-orange-400 border-gray-300 cursor-pointer"/>
                                    <label htmlFor="forceWeighableToggle" className="text-sm font-bold text-sys-800 cursor-pointer select-none flex flex-col">
                                        <span className={forceWeighable ? "text-orange-700" : ""}>Marcar todos como pesables (KG)</span>
                                        <span className="text-[10px] text-sys-500 font-normal">Útil para importar archivo de balanza completo</span>
                                    </label>
                                </div>
                            </div>

                            {/* Mapper Table */}
                            <div className="bg-white rounded-xl shadow-sm border border-sys-200 overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="bg-sys-50 text-sys-700 border-b border-sys-200">
                                            <tr>
                                                {headers.map((_, index) => (
                                                    <th key={index} className="p-4 min-w-[220px] bg-sys-50">
                                                        <div className="mb-3 text-[10px] font-black uppercase text-sys-400 tracking-widest">
                                                            Columna {index + 1}
                                                        </div>
                                                        <select 
                                                            className={cn(
                                                                "w-full p-2.5 rounded-lg border-2 font-bold transition-all cursor-pointer outline-none",
                                                                mapping[index] && mapping[index] !== 'ignore' 
                                                                    ? "border-brand bg-brand/5 text-brand" 
                                                                    : "border-sys-200 bg-white text-sys-600 hover:border-sys-300"
                                                            )}
                                                            onChange={(e) => handleMapChange(index, e.target.value)}
                                                            defaultValue="ignore"
                                                        >
                                                            {AVAILABLE_FIELDS.map(f => (
                                                                <option key={f.key} value={f.key}>
                                                                    {f.label} {f.required ? '*' : ''}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-sys-100">
                                            {previewData.slice(0, 5).map((row, rowIndex) => (
                                                <tr key={rowIndex} className="hover:bg-sys-50/50 transition-colors">
                                                    {row.map((cell, cellIndex) => (
                                                        <td key={cellIndex} className="p-4 text-sys-600 truncate max-w-[200px] border-r border-sys-100 last:border-0 font-mono text-xs">
                                                            {cell}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="p-3 text-center text-xs font-medium text-sys-400 bg-sys-50 border-t border-sys-200 uppercase tracking-wider">
                                    Vista previa de las primeras 5 filas
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-sys-200 bg-white flex justify-between gap-3 items-center">
                    <button 
                        onClick={onClose} 
                        disabled={isProcessing}
                        className="px-6 py-3 rounded-xl font-bold text-sys-500 hover:bg-sys-100 transition-colors disabled:opacity-50"
                    >
                        Cancelar Operación
                    </button>
                    
                    <button
                        onClick={scaleMode ? handleScaleSave : handleSave}
                        disabled={!previewData.length || isProcessing}
                        className={cn(
                            "px-8 py-3 rounded-xl text-white font-bold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all active:scale-95",
                            scaleMode ? "bg-orange-500 hover:bg-orange-600 shadow-orange-500/20" : "bg-sys-900 hover:bg-black shadow-sys-900/20"
                        )}
                    >
                        {isProcessing ? <>Procesando...</> : scaleMode
                            ? <><Scale size={20}/> Cargar PLUs</>
                            : <><CheckCircle size={20}/> Confirmar e Importar</>
                        }
                    </button>
                </div>
            </div>
        </div>
    );
};