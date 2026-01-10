// src/modules/inventory/pages/InventoryPage.jsx

import React, { useEffect, useState, useRef } from 'react';
import { 
    Plus, Search, Edit2, Trash2, Package, Scale, AlertTriangle, 
    ArrowUpRight, Filter, CheckSquare, Square, X, History,
    Printer, ChevronLeft, ChevronRight, ArrowRightLeft // 👈 Agregado icono para movimientos
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { productRepository } from '../repositories/productRepository';
import { masterRepository } from '../repositories/masterRepository';

import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';
import { ProductModal } from '../components/ProductModal';
import { MastersModal } from '../components/MastersModal';
import { ProductHistoryModal } from '../components/ProductHistoryModal'; 
import { cn } from '../../../core/utils/cn';

// =================================================================
// 1. COMPONENTE AUXILIAR: BULK UPDATE MODAL
// =================================================================
const BulkUpdateModal = ({ isOpen, onClose, onConfirm, allProducts, masters, manualSelectionIds }) => {
    if (!isOpen) return null;

    const [activeTab, setActiveTab] = useState('manual');
    const [targetId, setTargetId] = useState('');
    const [costPct, setCostPct] = useState(0);
    const [pricePct, setPricePct] = useState(0);
    const [targetList, setTargetList] = useState([]);

    useEffect(() => {
        let list = [];
        if (activeTab === 'manual') list = allProducts.filter(p => manualSelectionIds.has(p.id));
        else if (activeTab === 'brand' && targetId) list = allProducts.filter(p => p.brand === targetId);
        else if (activeTab === 'category' && targetId) list = allProducts.filter(p => p.category === targetId);
        setTargetList(list);
    }, [activeTab, targetId, manualSelectionIds, allProducts]);

    const removeProduct = (id) => setTargetList(prev => prev.filter(p => p.id !== id));

    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-sys-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
          
          <div className="p-5 border-b border-sys-100 bg-sys-50 flex justify-between items-center shrink-0">
             <h3 className="font-bold text-lg text-sys-900 flex items-center gap-2"><ArrowUpRight className="text-brand" /> Actualización Masiva</h3>
             <button onClick={onClose}><X size={20} className="text-sys-400" /></button>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col p-6">
             <div className="flex bg-sys-100 p-1 rounded-xl mb-4 shrink-0">
                {['manual', 'brand', 'category'].map(t => (
                    <button key={t} onClick={() => { setActiveTab(t); setTargetId(''); }} className={cn("flex-1 py-2 text-xs font-bold rounded-lg capitalize transition-all", activeTab === t ? "bg-white shadow text-sys-900" : "text-sys-500")}>
                        {t === 'manual' ? 'Selección' : t === 'brand' ? 'Marca' : 'Categoría'}
                    </button>
                ))}
             </div>

             <div className="shrink-0 mb-4">
                {activeTab === 'brand' && (
                    <select className="w-full p-3 border border-sys-200 rounded-xl text-sm bg-white outline-none focus:border-brand" onChange={(e) => setTargetId(e.target.value)}>
                        <option value="">Selecciona Marca...</option>
                        {masters.brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                    </select>
                )}
                {activeTab === 'category' && (
                    <select className="w-full p-3 border border-sys-200 rounded-xl text-sm bg-white outline-none focus:border-brand" onChange={(e) => setTargetId(e.target.value)}>
                        <option value="">Selecciona Categoría...</option>
                        {masters.categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                )}
             </div>

             {/* LISTA DE AFECTADOS */}
             <div className="flex-1 overflow-y-auto custom-scrollbar border border-sys-200 rounded-xl bg-sys-50 mb-4 relative">
                {targetList.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-sys-400 p-4 text-center"><Package size={32} className="mb-2 opacity-50"/><p className="text-xs">Sin productos afectados.</p></div>
                ) : (
                    <div className="divide-y divide-sys-200">
                        <div className="sticky top-0 bg-sys-100 p-2 text-xs font-bold text-sys-500 uppercase border-b border-sys-200 flex justify-between z-10">
                            <span>Producto ({targetList.length})</span><span>Precio Hoy</span>
                        </div>
                        {targetList.map(p => (
                            <div key={p.id} className="p-3 flex justify-between items-center group hover:bg-white transition-colors bg-sys-50/50">
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <button onClick={() => removeProduct(p.id)} className="p-1.5 bg-white border border-sys-200 rounded-md text-sys-400 hover:text-red-500 transition-colors shadow-sm"><X size={14} /></button>
                                    <div className="truncate">
                                        <p className="text-sm font-medium text-sys-800 truncate">{p.name}</p>
                                        <p className="text-[10px] text-sys-400">{p.code}</p>
                                    </div>
                                </div>
                                <span className="text-sm font-mono font-bold text-sys-600">$ {p.price}</span>
                            </div>
                        ))}
                    </div>
                )}
             </div>

             <div className="grid grid-cols-2 gap-4 pt-4 border-t border-sys-100 shrink-0">
                <div><label className="text-[10px] font-bold text-sys-500 uppercase block mb-1">Subir Costo</label><div className="relative"><input type="number" className="w-full p-2 pl-8 border border-sys-200 rounded-lg font-bold outline-none focus:border-brand" value={costPct} onChange={e => setCostPct(parseFloat(e.target.value) || 0)} /><span className="absolute left-3 top-2 text-sys-400">%</span></div></div>
                <div><label className="text-[10px] font-bold text-brand uppercase block mb-1">Subir Precio</label><div className="relative"><input type="number" className="w-full p-2 pl-8 border border-sys-200 rounded-lg font-bold text-brand bg-brand/5 outline-none focus:border-brand" value={pricePct} onChange={e => setPricePct(parseFloat(e.target.value) || 0)} /><span className="absolute left-3 top-2 text-brand">%</span></div></div>
             </div>
          </div>

          <div className="p-5 bg-sys-50 border-t border-sys-100 flex gap-3 shrink-0">
            <Button variant="ghost" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button onClick={() => onConfirm(targetList, costPct, pricePct)} className="flex-1 shadow-lg shadow-brand/20" disabled={targetList.length === 0 || (costPct === 0 && pricePct === 0)}>Aplicar Aumento</Button>
          </div>
        </div>
      </div>
    );
};

// =================================================================
// 2. COMPONENTE PRINCIPAL (INVENTORY PAGE)
// =================================================================
export const InventoryPage = () => {
  const navigate = useNavigate();

  // ===================== ESTADOS =====================
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Paginación
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20; // ⚡ 20 items por página para velocidad extrema

  // Maestros
  const [masters, setMasters] = useState({ categories: [], brands: [], suppliers: [] });
  
  // Filtros y Búsqueda
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({ category: '', brand: '', supplier: '' });
  
  // Ref para el input de búsqueda
  const searchInputRef = useRef(null);

  // Selección
  const [selectedIds, setSelectedIds] = useState(new Set());
  
  // Modales
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isMastersModalOpen, setIsMastersModalOpen] = useState(false);
  const [isBulkUpdateOpen, setIsBulkUpdateOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  
  // Estado para Historial
  const [historyProduct, setHistoryProduct] = useState(null); 

  const totalStockValuado = products.reduce((acc, p) => {
      const costo = parseFloat(p.cost) || 0;
      const stock = parseFloat(p.stock) || 0;
      return acc + (costo * stock);
  }, 0);
  
  // ===================== CARGA =====================
  const loadData = async () => {
    try {
      const [allProducts, cats, brands, supps] = await Promise.all([
        productRepository.getAll(),
        masterRepository.getAll('categories'),
        masterRepository.getAll('brands'),
        masterRepository.getAll('suppliers')
      ]);
      setProducts((allProducts || []).reverse());
      setMasters({ 
        categories: cats || [], 
        brands: brands || [], 
        suppliers: supps || [] 
      });
    } catch (error) {
      console.error("Error loading data", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
      if (!isProductModalOpen && !isMastersModalOpen && !isBulkUpdateOpen && !historyProduct) {
          setTimeout(() => searchInputRef.current?.focus(), 100);
      }
  }, [isProductModalOpen, isMastersModalOpen, isBulkUpdateOpen, historyProduct]);

  // ===================== LÓGICA SCANNER (ENTER) =====================
  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
        const term = searchTerm.trim();
        if (!term) return;

        // Búsqueda segura (protegida contra undefined)
        const exactMatch = products.find(p => 
            (p.code ? String(p.code) : '') === term
        );
        
        if (exactMatch) {
            setEditingProduct(exactMatch);
            setIsProductModalOpen(true);
            setSearchTerm(''); 
        } else {
            setEditingProduct({ 
                code: term, 
                name: '', cost: 0, price: 0, stock: 0 
            });
            setIsProductModalOpen(true);
            setSearchTerm('');
        }
    }
  };

  // ===================== FILTROS =====================
  // 1. Resetear página al filtrar
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filters]);

  // 2. Filtrado
  const filteredProducts = products.filter(p => {
    const term = searchTerm.toLowerCase();
    
    // FIX: Protección contra undefined
    const name = p.name ? String(p.name).toLowerCase() : '';
    const code = p.code ? String(p.code).toLowerCase() : '';

    const matchesSearch = name.includes(term) || code.includes(term);
    const matchesCat = filters.category ? p.category === filters.category : true;
    const matchesBrand = filters.brand ? p.brand === filters.brand : true;
    const matchesSupp = filters.supplier ? p.supplier === filters.supplier : true;
    
    return matchesSearch && matchesCat && matchesBrand && matchesSupp;
  });

  // 3. PAGINACIÓN (Slicing)
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedProducts = filteredProducts.slice(startIndex, startIndex + itemsPerPage);

  // ===================== SELECCIÓN =====================
  const toggleSelection = (id) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedProducts.length && paginatedProducts.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedProducts.map(p => p.id)));
    }
  };

  // ===================== ACCIONES =====================
  const handleSaveProduct = async (productData) => {
    await productRepository.save(productData);
    loadData();
  };

  const handleDelete = async (id) => {
    if (window.confirm("¿Estás seguro de eliminar este producto?")) {
      await productRepository.delete(id);
      loadData();
    }
  };

  const executeBulkUpdate = async (targetProducts, costPct, pricePct) => {
    if (targetProducts.length === 0) return alert("No hay productos seleccionados.");
    if (!window.confirm(`⚠️ CONFIRMACIÓN:\nSe actualizarán ${targetProducts.length} productos.\nCost: +${costPct}% | Precio: +${pricePct}%`)) return;

    setLoading(true);
    try {
      const updates = targetProducts.map(p => {
          const newCost = (p.cost || 0) * (1 + costPct / 100);
          let calculatedPrice = (p.price || 0) * (1 + pricePct / 100);
          const newPrice = Math.ceil(calculatedPrice / 50) * 50; 
          const newMarkup = newCost > 0 ? ((newPrice - newCost) / newCost * 100).toFixed(2) : (p.markup || 0);
          return { ...p, cost: newCost, price: newPrice, markup: newMarkup };
      });

      for (const p of updates) {
        await productRepository.save(p);
      }
      
      alert(`✅ Éxito: ${updates.length} productos actualizados.`);
      setSelectedIds(new Set());
      setIsBulkUpdateOpen(false);
      loadData();
    } catch (error) {
      console.error(error);
      alert("Error al actualizar.");
    } finally {
      setLoading(false);
    }
  };

  // ===================== RENDERIZADO =====================
  return (
    <div className="space-y-6 pb-20 relative">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold text-sys-900">Inventario</h2>
          <div className="flex gap-4 mt-2 text-xs text-sys-500">
             <p>Valuación Total (Costo): <span className="font-bold text-sys-800">$ {totalStockValuado.toLocaleString('es-AR', {minimumFractionDigits: 0})}</span></p>
             <p>Items: <span className="font-bold text-sys-800">{products.length}</span></p>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-2 justify-end">
            
            {/* 🔥 NUEVO BOTÓN MOVIMIENTOS */}
            <Button 
                variant="secondary" 
                className="border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 px-3"
                onClick={() => navigate('/inventory/movements')}
            >
                <ArrowRightLeft size={18} className="mr-2" /> Movimientos
            </Button>

            <Button 
                variant="secondary" 
                className="border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 px-3"
                onClick={() => navigate('/inventory/print')}
            >
                <Printer size={18} className="mr-2" /> Etiquetas
            </Button>
            
            <div className="w-[1px] h-8 bg-sys-200 mx-1 hidden md:block"></div>

            <Button variant="secondary" className="border-brand/20 text-brand bg-brand/5 hover:bg-brand/10" onClick={() => setIsBulkUpdateOpen(true)}>
               <ArrowUpRight size={18} className="mr-2" /> Aumento Masivo
            </Button>
            <Button variant="secondary" onClick={() => setIsMastersModalOpen(true)}>
               <Filter size={18} className="mr-2" /> Maestros
            </Button>
            <Button onClick={() => { setEditingProduct(null); setIsProductModalOpen(true); }} className="shadow-lg shadow-brand/20">
               <Plus size={20} className="mr-2" /> Nuevo
            </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card className="p-4 flex flex-col md:flex-row gap-4 items-center bg-white shadow-sm border border-sys-100">
        <div className="relative w-full md:w-1/3 group">
            <Search className="absolute left-3 top-2.5 text-sys-400 group-focus-within:text-brand transition-colors" size={18} />
            <input 
                ref={searchInputRef}
                type="text" 
                placeholder="Escanear código o buscar nombre..." 
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-sys-200 bg-sys-50 focus:bg-white focus:border-brand outline-none transition-all text-sm font-medium shadow-sm focus:shadow-md"
                value={searchTerm} 
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={handleSearchKeyDown} 
                autoFocus
            />
            <div className="absolute right-3 top-2.5 text-[10px] text-sys-400 font-mono hidden md:block">ENTER para Acción</div>
        </div>
        <div className="flex gap-2 w-full md:w-2/3 overflow-x-auto no-scrollbar">
            <select className="filter-select" value={filters.category} onChange={e => setFilters({...filters, category: e.target.value})}>
                <option value="">Categoría...</option>
                {masters.categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <select className="filter-select" value={filters.brand} onChange={e => setFilters({...filters, brand: e.target.value})}>
                <option value="">Marca...</option>
                {masters.brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
            <select className="filter-select" value={filters.supplier} onChange={e => setFilters({...filters, supplier: e.target.value})}>
                <option value="">Proveedor...</option>
                {masters.suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
            {(filters.category || filters.brand || filters.supplier) && (
                <button onClick={() => setFilters({category:'', brand:'', supplier:''})} className="p-2 text-red-500 hover:bg-red-50 rounded-lg"><X size={18} /></button>
            )}
        </div>
      </Card>

      {/* Aviso Selección */}
      {selectedIds.size > 0 && (
        <div className="bg-brand-light/30 border border-brand/20 p-3 rounded-xl flex justify-between items-center text-sm text-brand-hover">
            <span>Has seleccionado <b>{selectedIds.size} productos</b> manualmente.</span>
            <Button size="sm" className="bg-brand text-white border-none h-8 text-xs" onClick={() => setIsBulkUpdateOpen(true)}>
                Aplicar Aumento a Selección
            </Button>
        </div>
      )}

      {/* Tabla (Paginada) */}
      <Card className="p-0 overflow-hidden shadow-soft border-0 min-h-[400px]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-sys-50/80 backdrop-blur-sm text-sys-500 text-xs uppercase tracking-wider border-b border-sys-100">
                <th className="p-4 w-10 text-center">
                    <button onClick={toggleSelectAll} className="text-sys-400 hover:text-brand">
                        {selectedIds.size === paginatedProducts.length && paginatedProducts.length > 0 ? <CheckSquare size={18} /> : <Square size={18} />}
                    </button>
                </th>
                <th className="p-4 font-semibold">Producto</th>
                <th className="p-4 font-semibold">Datos</th>
                <th className="p-4 font-semibold text-right">Precios</th>
                <th className="p-4 font-semibold text-center">Stock</th>
                <th className="p-4 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sys-100">
              {/* 🔥 RENDERIZAMOS SOLO LOS 20 PRODUCTOS DE LA PÁGINA */}
              {paginatedProducts.map(p => {
                const isSelected = selectedIds.has(p.id);
                const isLowStock = (p.stock || 0) <= (p.minStock || 5);
                return (
                  <tr key={p.id} className={cn("transition-colors group", isSelected ? "bg-brand-light/20" : "hover:bg-sys-50/50")}>
                    <td className="p-4 text-center">
                        <button onClick={() => toggleSelection(p.id)} className={cn("transition-colors", isSelected ? "text-brand" : "text-sys-300 hover:text-sys-500")}>
                            {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                        </button>
                    </td>
                    <td className="p-4">
                        <div className="font-medium text-sys-900">{p.name || 'Sin Nombre'}</div>
                        <div className="text-xs text-sys-400 font-mono">{p.code || '-'}</div>
                    </td>
                    <td className="p-4">
                        <div className="flex flex-col gap-1">
                            {p.category && <span className="badge">{p.category}</span>}
                            {p.brand && <span className="text-xs text-sys-500">{p.brand}</span>}
                        </div>
                    </td>
                    <td className="p-4 text-right">
                        <div className="text-[10px] text-sys-400">Costo: ${p.cost?.toLocaleString() || '-'}</div>
                        <div className="font-bold text-sys-900 text-base">$ {(p.price || 0).toLocaleString('es-AR')}</div>
                    </td>
                    <td className="p-4 text-center">
                        <div className={cn("stock-badge", isLowStock ? "text-red-600 border-red-100 bg-red-50" : "text-sys-700 border-sys-200 bg-white")}>
                            {isLowStock && <AlertTriangle size={12} />}
                            {p.isWeighable ? (p.stock || 0).toFixed(3) : (p.stock || 0)}
                        </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setHistoryProduct(p)} className="action-btn text-blue-600 bg-blue-50/50 hover:bg-blue-100 border border-blue-200" title="Ver Historial">
                            <History size={16} />
                        </button>
                        <button onClick={() => { setEditingProduct(p); setIsProductModalOpen(true); }} className="action-btn text-brand bg-white border border-sys-200"><Edit2 size={16} /></button>
                        <button onClick={() => handleDelete(p.id)} className="action-btn text-red-500 bg-white border border-sys-200"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {/* Footer de Paginación */}
        <div className="p-4 border-t border-sys-100 bg-sys-50 flex justify-between items-center text-sm">
            <span className="text-sys-500 font-medium">
                Mostrando {paginatedProducts.length} de {filteredProducts.length} productos
            </span>
            <div className="flex items-center gap-2">
                <Button 
                    variant="ghost" 
                    size="sm" 
                    disabled={currentPage === 1} 
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    className="h-8 w-8 p-0"
                >
                    <ChevronLeft size={18} />
                </Button>
                
                <span className="font-bold text-sys-700 min-w-[3rem] text-center">
                    {currentPage} / {totalPages || 1}
                </span>

                <Button 
                    variant="ghost" 
                    size="sm" 
                    disabled={currentPage === totalPages || totalPages === 0} 
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    className="h-8 w-8 p-0"
                >
                    <ChevronRight size={18} />
                </Button>
            </div>
        </div>
      </Card>

      {/* Modales */}
      <ProductModal isOpen={isProductModalOpen} onClose={() => setIsProductModalOpen(false)} productToEdit={editingProduct} onSave={handleSaveProduct} />
      <MastersModal isOpen={isMastersModalOpen} onClose={() => setIsMastersModalOpen(false)} />
      
      <ProductHistoryModal 
          isOpen={!!historyProduct} 
          onClose={() => setHistoryProduct(null)} 
          product={historyProduct} 
      />
      
      <BulkUpdateModal 
          isOpen={isBulkUpdateOpen} 
          onClose={() => setIsBulkUpdateOpen(false)} 
          onConfirm={executeBulkUpdate}
          allProducts={products}
          masters={masters}
          manualSelectionIds={selectedIds}
      />

      <style>{`
        .filter-select { @apply p-2 border border-sys-200 rounded-lg text-sm bg-white min-w-[120px] outline-none focus:border-brand; }
        .badge { @apply inline-flex w-fit px-2 py-0.5 rounded bg-sys-100 text-[10px] text-sys-600 font-bold uppercase; }
        .stock-badge { @apply inline-flex items-center gap-1 px-2 py-1 rounded-lg font-mono text-sm border; }
        .action-btn { @apply p-2 rounded-lg transition shadow-sm; }
      `}</style>
    </div>
  );
};