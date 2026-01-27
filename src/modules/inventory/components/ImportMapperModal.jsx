import React, { useState } from 'react';
import { useSmartImport } from '../hooks/useSmartImport';
import { ArrowRight, X, AlertTriangle, Upload, Save } from 'lucide-react';

// Opciones disponibles para mapear
const DB_FIELDS = [
    { value: 'ignore', label: 'Ignorar Columna' },
    { value: 'name', label: 'Nombre Producto' },
    { value: 'price', label: 'Precio Venta' },
    { value: 'cost', label: 'Costo' },
    { value: 'stock', label: 'Stock Inicial' },
    { value: 'code', label: 'Código de Barras' },
];

export const ImportMapperModal = ({ isOpen, onClose, branchId, onSuccess }) => {
    const { parseFile, processImport, previewData, headers, isProcessing } = useSmartImport();
    const [mapping, setMapping] = useState({});

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) parseFile(file);
    };

    const handleMapChange = (colIndex, field) => {
        setMapping(prev => ({ ...prev, [colIndex]: field }));
    };

    const handleSave = async () => {
        // Validar que seleccionó al menos el nombre
        if (!Object.values(mapping).includes('name')) {
            alert("⚠️ Error: Debes identificar cuál columna es el 'Nombre Producto'.");
            return;
        }

        try {
            const count = await processImport(mapping, branchId);
            alert(`✅ Éxito: Se procesaron ${count} productos.`);
            if (onSuccess) onSuccess();
            onClose();
        } catch (e) {
            alert("❌ Error al importar: " + e.message);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl overflow-hidden border border-gray-200">
                
                {/* Header */}
                <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <div>
                        <h2 className="text-xl font-black text-gray-900 flex items-center gap-2">
                            <Upload className="text-brand" size={24} /> Importador Inteligente
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">Sube tu Excel y dinos qué es cada columna.</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500">
                        <X size={24}/>
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
                    
                    {!previewData.length ? (
                        <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-2xl bg-white hover:bg-blue-50/50 transition-colors group cursor-pointer">
                            <input type="file" accept=".csv,.txt" onChange={handleFileChange} className="hidden" id="csvUpload"/>
                            <label htmlFor="csvUpload" className="cursor-pointer flex flex-col items-center p-12 w-full h-full justify-center">
                                <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                    <Upload size={40} />
                                </div>
                                <span className="text-2xl font-bold text-gray-700">Subir Archivo CSV</span>
                                <p className="text-gray-400 mt-2">Formatos aceptados: .csv (separado por comas o punto y coma)</p>
                            </label>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Warning Box */}
                            <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex gap-3 text-amber-800 text-sm shadow-sm">
                                <AlertTriangle size={20} className="shrink-0 mt-0.5"/>
                                <div>
                                    <strong className="block font-bold mb-1">¿Cómo funciona?</strong>
                                    Si el producto ya existe (coincide Nombre o Código), actualizaremos sus datos. Si no, lo crearemos nuevo.
                                </div>
                            </div>

                            {/* Mapper Table */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="bg-gray-100 text-gray-700">
                                            <tr>
                                                {headers.map((colName, index) => (
                                                    <th key={index} className="p-4 min-w-[200px]">
                                                        <div className="mb-3 text-xs font-bold uppercase text-gray-500 tracking-wider">
                                                            {colName}
                                                        </div>
                                                        <select 
                                                            className="w-full p-2.5 bg-white border-2 border-gray-300 rounded-lg focus:border-brand focus:ring-4 focus:ring-brand/10 font-bold text-gray-800 transition-all cursor-pointer hover:border-gray-400"
                                                            onChange={(e) => handleMapChange(index, e.target.value)}
                                                            defaultValue="ignore"
                                                        >
                                                            {DB_FIELDS.map(f => (
                                                                <option key={f.value} value={f.value}>{f.label}</option>
                                                            ))}
                                                        </select>
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {previewData.slice(0, 5).map((row, rowIndex) => (
                                                <tr key={rowIndex} className="hover:bg-gray-50 transition-colors">
                                                    {row.map((cell, cellIndex) => (
                                                        <td key={cellIndex} className="p-4 text-gray-600 truncate max-w-[200px] border-r border-gray-100 last:border-0">
                                                            {cell}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="p-2 text-center text-xs text-gray-400 bg-gray-50 border-t border-gray-100">
                                    Mostrando previsualización de las primeras 5 filas
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-gray-200 bg-white flex justify-end gap-3 items-center">
                    <button 
                        onClick={onClose} 
                        className="px-6 py-3 rounded-xl font-bold text-gray-600 hover:bg-gray-100 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button 
                        onClick={handleSave} 
                        disabled={!previewData.length || isProcessing}
                        className="px-8 py-3 rounded-xl bg-gray-900 text-white font-bold hover:bg-black shadow-xl shadow-gray-900/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all active:scale-95"
                    >
                        {isProcessing ? (
                            <><span className="animate-spin">⏳</span> Procesando...</>
                        ) : (
                            <><Save size={20}/> Confirmar Importación</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};