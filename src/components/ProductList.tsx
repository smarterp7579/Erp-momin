/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, FormEvent, useRef, ChangeEvent } from "react";
import { api } from "../services/api";
import { Product, Category, User } from "../types";
import { Package, Plus, Search, Filter, MoreVertical, Edit, Trash2, FileSpreadsheet, Download, Scan, X, Barcode, Printer, RefreshCw } from "lucide-react";
import * as XLSX from 'xlsx';
import { cn } from "../lib/utils";
import { BarcodeScanner } from "./BarcodeScanner";
import { BarcodeGenerator } from "./BarcodeGenerator";

interface ProductListProps {
  user: User | null;
}

export function ProductList({ user }: ProductListProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [scannerTarget, setScannerTarget] = useState<'add' | 'remove' | null>(null);
  const [formData, setFormData] = useState<Partial<Product>>({
    name: "",
    bnName: "",
    sku: "",
    barcode: "",
    barcodes: [],
    categoryId: "",
    unit: "pcs",
    purchasePrice: 0,
    salePrice: 0,
    stock: 0,
    minStock: 5,
    expiryDate: "",
    expiredQtyToRemove: 0,
    expiredBarcodesToRemove: [],
  });
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error'} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Barcode Printing State
  const [showBarcodePrintModal, setShowBarcodePrintModal] = useState(false);
  const [barcodeProduct, setBarcodeProduct] = useState<Product | null>(null);
  const [selectedBarcodeForPrint, setSelectedBarcodeForPrint] = useState("");
  const [printQuantity, setPrintQuantity] = useState(12);
  const [storeHeader, setStoreHeader] = useState(() => {
    try {
      const stored = localStorage.getItem("smart_business_user");
      return stored ? JSON.parse(stored).businessName || "হিসাবপাতি স্মার্ট শপ" : "হিসাবপাতি স্মার্ট শপ";
    } catch {
      return "হিসাবপাতি স্মার্ট শপ";
    }
  });
  const [barcodeLayout, setBarcodeLayout] = useState<"a4_3col" | "a4_4col" | "thermal">("a4_3col");
  const [includePrice, setIncludePrice] = useState(true);
  const [includeName, setIncludeName] = useState(true);

  const isAdmin = user?.role === 'admin' || user?.id === "1";
  const canAdd = isAdmin || user?.permissions?.includes('add_product');
  const canDelete = isAdmin || user?.permissions?.includes('delete_product');

  const showNotify = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [prodItems, catItems] = await Promise.all([
        api.getProducts(),
        api.getCategories()
      ]);
      setProducts(prodItems);
      setCategories(catItems);
      if (catItems.length > 0 && !formData.categoryId) {
        setFormData(prev => ({ ...prev, categoryId: catItems[0].id }));
      }
    } catch (err) {
      console.error("Load Error:", err);
    }
  };

  const handleAddNewCategory = async () => {
    if (!newCategoryName.trim()) return;
    try {
      const newCat = await api.createCategory({ name: newCategoryName });
      setCategories(prev => [...prev, newCat]);
      setFormData(prev => ({ ...prev, categoryId: newCat.id }));
      setIsAddingCategory(false);
      setNewCategoryName("");
      showNotify("নতুন ক্যাটাগরি যোগ করা হয়েছে");
    } catch (err) {
      showNotify("ক্যাটাগরি যোগ করা যায়নি", "error");
    }
  };

  const handleCreateOrUpdate = async (e: FormEvent) => {
    e.preventDefault();
    try {
      let finalCategoryId = formData.categoryId;
      let finalStock = Number(formData.stock || 0);

      // Manual removal of expired stock if value is set
      let finalBarcodes = [...(formData.barcodes || [])];
      
      if (editingProduct) {
        if (formData.expiredQtyToRemove && formData.expiredQtyToRemove > 0) {
          finalStock = Math.max(0, finalStock - formData.expiredQtyToRemove);
        }
        
        const expiredBcs = (formData as any).expiredBarcodesToRemove;
        if (expiredBcs && expiredBcs.length > 0) {
          finalBarcodes = finalBarcodes.filter(bc => !expiredBcs.includes(bc));
        }
      }

      // If user is currently adding a new category but didn't click the "plus" button
      if (isAddingCategory && newCategoryName.trim()) {
        try {
          const newCat = await api.createCategory({ name: newCategoryName });
          setCategories(prev => [...prev, newCat]);
          finalCategoryId = newCat.id;
          setIsAddingCategory(false);
          setNewCategoryName("");
        } catch (catErr) {
          console.error("Auto Category Creation Error:", catErr);
          showNotify("নতুন ক্যাটাগরি তৈরি করা সম্ভব হয়নি", "error");
          return;
        }
      }

      const finalData: Partial<Product> = { 
        ...formData, 
        categoryId: finalCategoryId,
        stock: finalStock,
        barcodes: finalBarcodes
      };

      // Remove the UI-only helper field before sending to API
      delete (finalData as any).expiredQtyToRemove;
      delete (finalData as any).expiredBarcodesToRemove;

      if (editingProduct) {
        await api.updateProduct(editingProduct.id, finalData);
        showNotify("পণ্য আপডেট করা হয়েছে");
      } else {
        await api.createProduct(finalData);
        showNotify("নতুন পণ্য যোগ করা হয়েছে");
      }
      setShowModal(false);
      setEditingProduct(null);
      resetForm();
      loadData();
    } catch (err) {
      showNotify("ব্যর্থ হয়েছে!", "error");
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const success = await api.deleteProduct(deleteId);
      if (success) {
        showNotify("পণ্য মুছে ফেলা হয়েছে");
        loadData();
      } else {
        showNotify("মুছে ফেলা সম্ভব হয়নি", "error");
      }
    } catch (err) {
      showNotify("মুছে ফেলা সম্ভব হয়নি", "error");
    } finally {
      setShowDeleteModal(false);
      setDeleteId(null);
    }
  };

  const confirmDelete = (id: string) => {
    setDeleteId(id);
    setShowDeleteModal(true);
  };

  const handlePrint = () => {
    const sheetElement = document.getElementById("print-barcode-sheet");
    if (!sheetElement) return;

    // Pack the styles we need for the barcode stickers so they render beautifully
    const styles = `
      <style>
        @media print {
          body {
            background: white !important;
            color: black !important;
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          #printable-area {
            display: block !important;
            visibility: visible !important;
            padding: 10px !important;
          }
        }
        .print-grid {
          display: grid !important;
          gap: 12px !important;
          grid-template-columns: ${barcodeLayout === "a4_3col" ? "repeat(3, 1fr)" : barcodeLayout === "a4_4col" ? "repeat(4, 1fr)" : "1fr"} !important;
          width: 100% !important;
        }
        .print-card {
          border: 1px solid #e2e8f0 !important;
          border-radius: 8px !important;
          padding: 12px !important;
          text-align: center !important;
          background: white !important;
          color: black !important;
          page-break-inside: avoid !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          justify-content: space-between !important;
          min-height: ${barcodeLayout === "a4_4col" ? "90px" : "110px"} !important;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05) !important;
        }
        @media print {
          .print-card {
            border: 1px solid #000000 !important;
            box-shadow: none !important;
          }
        }
        .barcode-container {
          display: flex !important;
          justify-content: center !important;
          align-items: center !important;
          width: 100% !important;
          margin: 4px 0 !important;
          text-align: center !important;
        }
        .barcode-container svg {
          display: block !important;
          margin: 0 auto !important;
          max-width: 100% !important;
          height: auto !important;
        }
        .print-card-header {
          font-size: 10px !important;
          font-weight: bold !important;
          text-transform: uppercase !important;
          border-bottom: 1px dashed #cbd5e1 !important;
          width: 100% !important;
          padding-bottom: 4px !important;
          margin-bottom: 4px !important;
          color: #475569 !important;
        }
        @media print {
          .print-card-header {
            border-bottom: 1px dashed #000000 !important;
            color: #000000 !important;
          }
        }
        .print-card-name {
          font-size: 11px !important;
          font-weight: bold !important;
          color: #1e293b !important;
          line-height: 1.2 !important;
        }
        @media print {
          .print-card-name {
            color: #000000 !important;
          }
        }
        .print-card-price {
          font-size: 12px !important;
          font-weight: bold !important;
          border-top: 1px dashed #cbd5e1 !important;
          width: 100% !important;
          padding-top: 6px !important;
          margin-top: 4px !important;
          color: #0f172a !important;
        }
        @media print {
          .print-card-price {
            border-top: 1px dashed #000000 !important;
            color: #000000 !important;
          }
        }
      </style>
    `;

    const event = new CustomEvent('smart-print', { 
      detail: { 
        html: styles + `<div class="p-4 bg-white">${sheetElement.innerHTML}</div>`
      } 
    });
    window.dispatchEvent(event);
    setShowBarcodePrintModal(false);
  };

  const resetForm = () => {
    setIsAddingCategory(false);
    setNewCategoryName("");
    setFormData({
      name: "",
      bnName: "",
      sku: "",
      categoryId: categories[0]?.id || "",
      unit: "pcs",
      purchasePrice: 0,
      salePrice: 0,
      stock: 0,
      minStock: 5,
      expiryDate: "",
      expiredQtyToRemove: 0,
    });
  };

  const downloadSampleExcel = () => {
    const headers = [
      ["Product Name (English)", "Product Name (Bangla)", "SKU", "Category", "Unit", "Purchase Price", "Sale Price", "Stock", "Min Stock", "Expiry Date (YYYY-MM-DD)"]
    ];
    const ws = XLSX.utils.aoa_to_sheet(headers);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    XLSX.writeFile(wb, "products_sample.xlsx");
  };

  const handleExcelImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        if (data.length === 0) {
          showNotify("এক্সেল ফাইলে কোনো তথ্য নেই", "error");
          return;
        }

        const currentCats = [...categories];
        const productsToCreate: Partial<Product>[] = [];

        for (const row of data) {
          const catName = row["Category"] || "General";
          let cat = currentCats.find(c => c.name.toLowerCase() === catName.toLowerCase());
          
          if (!cat) {
            try {
              cat = await api.createCategory({ name: catName });
              currentCats.push(cat);
              setCategories([...currentCats]);
            } catch (err) {
              console.error("Failed to create category", catName);
            }
          }

          productsToCreate.push({
            name: String(row["Product Name (English)"] || ""),
            bnName: String(row["Product Name (Bangla)"] || ""),
            sku: String(row["SKU"] || `PROD-${Date.now()}-${Math.floor(Math.random()*1000)}`),
            categoryId: cat?.id || "",
            unit: String(row["Unit"] || "pcs"),
            purchasePrice: Number(row["Purchase Price"] || 0),
            salePrice: Number(row["Sale Price"] || 0),
            stock: Number(row["Stock"] || 0),
            minStock: Number(row["Min Stock"] || 5),
            expiryDate: row["Expiry Date (YYYY-MM-DD)"] ? String(row["Expiry Date (YYYY-MM-DD)"]) : undefined,
          });
        }

        await api.createProductsBatch(productsToCreate);
        showNotify(`${productsToCreate.length} টি পন্য সফলভাবে ইমপোর্ট করা হয়েছে`);
        loadData();
      } catch (err) {
        console.error("Import Error:", err);
        showNotify("ইমপোর্ট করা সম্ভব হয়নি। ফাইলের ফরম্যাট চেক করুন।", "error");
      }
    };
    reader.readAsBinaryString(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const openAddModal = () => {
    setEditingProduct(null);
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      ...product,
      expiredQtyToRemove: 0,
      expiredBarcodesToRemove: []
    });
    setShowModal(true);
  };

  const filtered = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      p.bnName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = selectedCategory === "all" || p.categoryId === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="p-6 space-y-6 bg-slate-50 dark:bg-slate-950 transition-colors duration-300 min-h-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-bengali">পণ্য তালিকা</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-bengali">আপনার আউটলেটের সব পণ্যের তালিকা এখানে দেখুন</p>
        </div>
        {canAdd && (
          <div className="flex flex-wrap items-center gap-3">
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept=".xlsx, .xls" 
              onChange={handleExcelImport}
            />
            <button 
              onClick={downloadSampleExcel}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors font-bengali text-sm"
              title="নমুনা এক্সেল ডাউনলোড করুন"
            >
              <Download size={18} />
              <span>নমুনা ফাইল</span>
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800 rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors font-bengali text-sm"
            >
              <FileSpreadsheet size={18} />
              <span>ইমপোর্ট (Excel)</span>
            </button>
            <button 
              onClick={openAddModal}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 font-bengali text-sm"
            >
              <Plus size={20} />
              <span>নতুন পণ্য যোগ করুন</span>
            </button>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row gap-4 relative transition-colors">
        <div className="relative flex-1 group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" size={18} />
          <input 
            type="text" 
            placeholder="পণ্য খুঁজুন (নাম বা এসকেইউ...)" 
            className="w-full bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg py-1.5 pl-10 pr-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 transition-all font-bengali text-sm"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="relative">
          <button 
            onClick={() => setShowFilterDropdown(!showFilterDropdown)}
            className={`flex items-center gap-2 px-4 py-2 border rounded-xl transition-colors font-bengali ${
              selectedCategory !== 'all' 
                ? 'border-primary bg-primary/5 text-primary' 
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Filter size={18} />
            <span>ফিল্টার {selectedCategory !== 'all' ? '(সক্রিয়)' : ''}</span>
          </button>
          
          {showFilterDropdown && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowFilterDropdown(false)} />
              <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl z-20 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 transition-colors">
                <div className="p-4 bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 italic text-xs text-slate-400 font-bengali">ক্যাটাগরি অনুযায়ী ফিল্টার করুন</div>
                <div className="p-2 max-h-64 overflow-y-auto">
                  <button 
                    onClick={() => { setSelectedCategory('all'); setShowFilterDropdown(false); }}
                    className={`w-full text-left px-4 py-2 rounded-lg font-bengali text-sm transition-colors ${selectedCategory === 'all' ? 'bg-primary text-white' : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
                  >
                    সকল ক্যাটাগরি
                  </button>
                  {categories.map(cat => (
                    <button 
                      key={cat.id}
                      onClick={() => { setSelectedCategory(cat.id); setShowFilterDropdown(false); }}
                      className={`w-full text-left px-4 py-2 rounded-lg font-bengali text-sm transition-colors ${selectedCategory === cat.id ? 'bg-primary text-white' : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-bengali">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider">
                <th className="px-6 py-4 border-b dark:border-slate-800">পণ্য</th>
                <th className="px-6 py-4 border-b dark:border-slate-800">ক্যাটাগরি</th>
                <th className="px-6 py-4 border-b dark:border-slate-800">ক্রয় মূল্য</th>
                <th className="px-6 py-4 border-b dark:border-slate-800">বিক্রয় মূল্য</th>
                <th className="px-6 py-4 border-b dark:border-slate-800">মেয়াদ উত্তীর্ণ</th>
                <th className="px-6 py-4 border-b dark:border-slate-800">স্টক</th>
                <th className="px-6 py-4 text-right border-b dark:border-slate-800">অ্যাকশন</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((product) => (
                <tr key={product.id} className={cn(
                  "hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors animate-in fade-in duration-300",
                  product.stock <= product.minStock ? "bg-rose-50/40 dark:bg-rose-900/10" : ""
                )}>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center relative",
                        product.stock <= product.minStock 
                          ? "bg-rose-100 text-rose-500 dark:bg-rose-900/30 dark:text-rose-400" 
                          : "bg-slate-50 dark:bg-slate-800 text-slate-300 dark:text-slate-600"
                      )}>
                        <Package size={20} />
                        {product.stock <= product.minStock && (
                          <span className="absolute -top-1 -right-1 flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-slate-700 dark:text-slate-200">{product.bnName || product.name}</p>
                          {product.stock <= product.minStock && (
                            <span className="bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 text-[10px] px-1.5 py-0.5 rounded-full font-bold font-bengali">স্টক কম</span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider font-sans">{product.sku}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-slate-600 dark:text-slate-400 text-sm">
                    {categories.find(c => c.id === product.categoryId)?.name || "ক্যাটাগরি নেই"}
                  </td>
                  <td className="px-6 py-4 font-bold text-slate-900 dark:text-slate-100">৳ {product.purchasePrice}</td>
                  <td className="px-6 py-4 font-bold text-primary dark:text-blue-400">৳ {product.salePrice}</td>
                  <td className="px-6 py-4">
                    {product.expiryDate ? (
                      <div className="flex flex-col">
                        <span className={cn(
                          "text-xs font-bold font-bengali",
                          new Date(product.expiryDate) < new Date() 
                            ? "text-rose-500" 
                            : (new Date(product.expiryDate).getTime() - new Date().getTime()) < (5 * 24 * 60 * 60 * 1000)
                              ? "text-amber-500"
                              : "text-slate-600 dark:text-slate-400"
                        )}>
                          {new Date(product.expiryDate).toLocaleDateString('bn-BD')}
                        </span>
                        {new Date(product.expiryDate) < new Date() ? (
                          <span className="text-[10px] font-bold text-rose-500 uppercase tracking-tighter">Expired</span>
                        ) : (new Date(product.expiryDate).getTime() - new Date().getTime()) < (5 * 24 * 60 * 60 * 1000) && (
                          <span className="text-[10px] font-bold text-amber-500 uppercase tracking-tighter">Expiring Soon</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-300 dark:text-slate-700">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      <span className={`font-bold text-sm ${product.stock <= product.minStock ? 'text-rose-500' : 'text-slate-900 dark:text-slate-100'}`}>{product.stock} {product.unit}</span>
                      <div className="w-20 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${product.stock <= product.minStock ? 'bg-rose-500' : 'bg-emerald-500'}`} 
                          style={{ width: `${Math.min(100, (product.stock / (product.minStock || 10) * 2) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 text-slate-400 dark:text-slate-500">
                      <button 
                        onClick={() => openEditModal(product)}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-primary dark:hover:text-blue-400 rounded-lg transition-colors"
                        title="এডিট"
                      >
                        <Edit size={16} />
                      </button>
                      <button 
                        onClick={() => {
                          setBarcodeProduct(product);
                          const defaultCode = product.barcode || (product.barcodes && product.barcodes.length > 0 ? product.barcodes[0] : "") || product.sku;
                          setSelectedBarcodeForPrint(defaultCode);
                          setPrintQuantity(12);
                          setShowBarcodePrintModal(true);
                        }}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg transition-colors"
                        title="বারকোড প্রিন্ট"
                      >
                        <Barcode size={16} />
                      </button>
                      {canDelete && (
                        <button 
                          onClick={() => confirmDelete(product.id)}
                          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-rose-500 rounded-lg transition-colors"
                          title="মুছুন"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                      <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 rounded-lg transition-colors"><MoreVertical size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="p-12 text-center text-slate-400 font-bengali">
              <Package size={48} className="mx-auto mb-4 opacity-20" />
              <p>কোনো পণ্য পাওয়া যায়নি</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 transition-colors">
            <div className="px-8 py-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 sticky top-0 z-10 transition-colors">
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 font-bengali">
                {editingProduct ? "পণ্য এডিট করুন" : "নতুন পণ্য যোগ করুন"}
              </h2>
              <button 
                onClick={() => setShowModal(false)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors text-slate-400 dark:text-slate-500"
              >
                <Plus className="rotate-45" size={24} />
              </button>
            </div>
            
            <form onSubmit={handleCreateOrUpdate} className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300 font-bengali">পণ্যের নাম (English)</label>
                  <input 
                    required 
                    type="text" 
                    className="w-full bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg py-1.5 px-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 outline-none transition-all font-sans text-sm"
                    value={formData.name || ""}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300 font-bengali">পণ্যের নাম (বাংলা)</label>
                  <input 
                    type="text" 
                    className="w-full bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg py-1.5 px-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 outline-none transition-all font-bengali text-sm"
                    value={formData.bnName || ""}
                    onChange={e => setFormData({ ...formData, bnName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300 font-bengali">SKU / কোড</label>
                    <button
                      type="button"
                      onClick={() => {
                        const randomSku = String(Math.floor(10000000 + Math.random() * 90000000));
                        setFormData({ ...formData, sku: randomSku });
                        showNotify("র্যান্ডম SKU জেনারেট করা হয়েছে!", "success");
                      }}
                      className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:opacity-80 font-bengali flex items-center gap-1 bg-indigo-50 dark:bg-indigo-950/45 px-2 py-0.5 rounded-md"
                    >
                      <RefreshCw size={11} /> র্যান্ডম জেনারেট
                    </button>
                  </div>
                  <input 
                    required 
                    type="text" 
                    className="w-full bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg py-1.5 px-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 outline-none transition-all font-sans text-sm"
                    value={formData.sku || ""}
                    onChange={e => setFormData({ ...formData, sku: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300 font-bengali">ক্যাটাগরি</label>
                    <button 
                      type="button"
                      onClick={() => setIsAddingCategory(!isAddingCategory)}
                      className="text-xs font-bold text-primary dark:text-blue-400 hover:underline font-bengali"
                    >
                      {isAddingCategory ? "নির্বাচন করুন" : "+ নতুন ক্যাটাগরি"}
                    </button>
                  </div>
                  {isAddingCategory ? (
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder="ক্যাটাগরির নাম লিখুন"
                        className="flex-1 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg py-1.5 px-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 transition-all font-bengali text-sm"
                        value={newCategoryName}
                        onChange={e => setNewCategoryName(e.target.value)}
                      />
                      <button 
                        type="button"
                        onClick={handleAddNewCategory}
                        className="bg-primary text-white p-1.5 rounded-lg hover:opacity-90"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  ) : (
                    <select 
                      required 
                      className="w-full bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg py-1.5 px-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 transition-all font-bengali text-sm"
                      value={formData.categoryId || ""}
                      onChange={e => setFormData({ ...formData, categoryId: e.target.value })}
                    >
                      <option value="" disabled className="dark:bg-slate-900">ক্যাটাগরি নির্বাচন করুন</option>
                      {categories.map(c => <option key={c.id} value={c.id} className="dark:bg-slate-900">{c.name}</option>)}
                    </select>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300 font-bengali">ইউনিট (Unit)</label>
                  <select 
                    className="w-full bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg py-1.5 px-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 transition-all font-bengali text-sm"
                    value={formData.unit}
                    onChange={e => setFormData({ ...formData, unit: e.target.value })}
                  >
                    <option value="pcs" className="dark:bg-slate-900">পিস (Pcs)</option>
                    <option value="kg" className="dark:bg-slate-900">কেজি (Kg)</option>
                    <option value="gm" className="dark:bg-slate-900">গ্রাম (Gm)</option>
                    <option value="ltr" className="dark:bg-slate-900">লিটার (Ltr)</option>
                    <option value="ml" className="dark:bg-slate-900">মিলি (Ml)</option>
                    <option value="pack" className="dark:bg-slate-900">প্যাক (Pack)</option>
                    <option value="box" className="dark:bg-slate-900">বক্স (Box)</option>
                    <option value="strip" className="dark:bg-slate-900">পাতা (Strip)</option>
                    <option value="bottle" className="dark:bg-slate-900">বোতল (Bottle)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300 font-bengali">বারকোড সমূহ (Barcodes)</label>
                    <div className="flex items-center gap-2">
                      <button 
                        type="button" 
                        onClick={() => {
                          const randomBc = String(Math.floor(1000000000000 + Math.random() * 9000000000000));
                          if (!formData.barcodes?.includes(randomBc)) {
                            setFormData({ ...formData, barcodes: [...(formData.barcodes || []), randomBc] });
                            showNotify("র্যান্ডম বারকোড যোগ করা হয়েছে!", "success");
                          }
                        }}
                        className="text-indigo-600 dark:text-indigo-400 hover:opacity-80 font-bengali flex items-center gap-1 bg-indigo-50 dark:bg-indigo-950/45 px-2 py-1 rounded-md text-xs font-bold"
                      >
                        <RefreshCw size={11} /> র্যান্ডম বারকোড
                      </button>
                      <button 
                        type="button" 
                        onClick={() => setScannerTarget('add')}
                        className="text-primary dark:text-blue-400 hover:bg-primary/10 dark:hover:bg-blue-400/10 p-1.5 rounded-lg flex items-center gap-1 text-xs"
                      >
                        <Scan size={14} /> স্ক্যান
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder="বারকোড লিখে Enter চাপুন"
                        className="w-full bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg py-1.5 px-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 transition-all font-sans text-sm"
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = e.currentTarget.value.trim();
                            if (val && !formData.barcodes?.includes(val)) {
                              setFormData({ ...formData, barcodes: [...(formData.barcodes || []), val] });
                              e.currentTarget.value = "";
                            }
                          }
                        }}
                      />
                    </div>
                    {formData.barcodes && formData.barcodes.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {formData.barcodes.map(code => (
                          <span key={code} className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-xs font-mono text-slate-700 dark:text-slate-300">
                            {code}
                            <button 
                              type="button" 
                              onClick={() => setFormData({ ...formData, barcodes: formData.barcodes?.filter(b => b !== code) })}
                              className="text-slate-400 hover:text-rose-500"
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300 font-bengali">মিনিমাম স্টক অ্যালার্ট</label>
                  <input 
                    type="number" 
                    className="w-full bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg py-1.5 px-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 transition-all text-sm"
                    value={formData.minStock}
                    onChange={e => setFormData({ ...formData, minStock: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300 font-bengali">মেয়াদ উত্তীর্ণ তারিখ (অপশনাল)</label>
                  <input 
                    type="date" 
                    className="w-full bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg py-1.5 px-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm"
                    value={formData.expiryDate || ""}
                    onChange={e => setFormData({ ...formData, expiryDate: e.target.value })}
                  />
                </div>
                {editingProduct && (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-rose-600 dark:text-rose-400 font-bengali">মেয়াদ উত্তীর্ণ পন্য বাদ দিন (Stock Out)</label>
                      <input 
                        type="number" 
                        min="0"
                        max={formData.stock}
                        placeholder="পরিমান লিখুন..."
                        className="w-full bg-rose-50 dark:bg-rose-900/10 border-rose-100 dark:border-rose-900/30 rounded-lg py-1.5 px-3 text-rose-900 dark:text-rose-100 focus:ring-2 focus:ring-rose-500/20 outline-none transition-all font-bold text-sm"
                        value={formData.expiredQtyToRemove || ""}
                        onChange={e => setFormData({ ...formData, expiredQtyToRemove: Number(e.target.value) })}
                      />
                      <p className="text-[10px] text-rose-500 font-bold font-bengali">এই পরিমান পণ্য বর্তমান স্টক থেকে কমিয়ে দেওয়া হবে</p>
                    </div>
                    {(formData.barcodes && formData.barcodes.length > 0) && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-bold text-rose-600 dark:text-rose-400 font-bengali">মেয়াদ উত্তীর্ণ বারকোড বাদ দিন (অপশনাল)</label>
                          <button 
                            type="button" 
                            onClick={() => setScannerTarget('remove')}
                            className="text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 p-1.5 rounded-lg flex items-center gap-1 text-xs font-bold"
                          >
                            <Scan size={14} /> স্ক্যান
                          </button>
                        </div>
                        <div className="space-y-2">
                          <input 
                            type="text" 
                            placeholder="বারকোড স্ক্যান করুন বা লিখুন (Enter চাপুন)"
                            className="w-full bg-rose-50 dark:bg-rose-900/10 border-rose-100 dark:border-rose-900/30 rounded-lg py-1.5 px-3 text-rose-900 dark:text-rose-100 focus:ring-2 focus:ring-rose-500/20 transition-all font-sans text-sm placeholder:text-rose-300"
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const val = e.currentTarget.value.trim();
                                if (val && formData.barcodes?.includes(val) && !(formData as any).expiredBarcodesToRemove?.includes(val)) {
                                  setFormData({
                                    ...formData,
                                    expiredBarcodesToRemove: [...((formData as any).expiredBarcodesToRemove || []), val],
                                    expiredQtyToRemove: (formData.expiredQtyToRemove || 0) + 1
                                  });
                                  e.currentTarget.value = "";
                                } else if (val) {
                                  showNotify("এই বারকোডটি এই পণ্যের বর্তমান বারকোড তালিকায় নেই", "error");
                                }
                              }
                            }}
                          />
                          {((formData as any).expiredBarcodesToRemove || []).length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2 p-2 bg-rose-50 dark:bg-rose-900/20 rounded-lg border border-rose-100 dark:border-rose-900/30">
                              {((formData as any).expiredBarcodesToRemove || []).map((code: string) => (
                                <span key={code} className="inline-flex items-center gap-1 px-2 py-1 bg-white dark:bg-rose-900 border border-rose-200 dark:border-rose-800 rounded-md text-xs font-mono text-rose-700 dark:text-rose-300">
                                  {code}
                                  <button 
                                    type="button" 
                                    onClick={() => setFormData({ 
                                      ...formData, 
                                      expiredBarcodesToRemove: (formData as any).expiredBarcodesToRemove?.filter((b: string) => b !== code),
                                      expiredQtyToRemove: Math.max(0, (formData.expiredQtyToRemove || 1) - 1)
                                    })}
                                    className="text-rose-400 hover:text-rose-600"
                                  >
                                    <X size={12} />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-2xl grid grid-cols-3 gap-6 transition-colors">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300 font-bengali">ক্রয় মূল্য</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">৳</span>
                    <input 
                      required 
                      type="text" 
                      inputMode="decimal"
                      className="w-full bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg py-1.5 pl-7 pr-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 transition-all font-sans text-sm"
                      value={formData.purchasePrice ?? ""}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === "" || /^\d*\.?\d*$/.test(val)) {
                          setFormData({ ...formData, purchasePrice: val as any });
                        }
                      }}
                      onBlur={() => setFormData({ ...formData, purchasePrice: Number(formData.purchasePrice || 0) })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300 font-bengali">বিক্রয় মূল্য</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">৳</span>
                    <input 
                      required 
                      type="text" 
                      inputMode="decimal"
                      className="w-full bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg py-1.5 pl-7 pr-2 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 transition-all font-sans font-bold text-primary dark:text-blue-400 text-sm"
                      value={formData.salePrice ?? ""}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === "" || /^\d*\.?\d*$/.test(val)) {
                          setFormData({ ...formData, salePrice: val as any });
                        }
                      }}
                      onBlur={() => setFormData({ ...formData, salePrice: Number(formData.salePrice || 0) })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300 font-bengali">ওপেনিং স্টক</label>
                  <input 
                    required 
                    type="text" 
                    inputMode="decimal"
                    className="w-full bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg py-1.5 px-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 transition-all font-sans text-sm"
                    value={formData.stock ?? ""}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === "" || /^\d*\.?\d*$/.test(val)) {
                        setFormData({ ...formData, stock: val as any });
                      }
                    }}
                    onBlur={() => setFormData({ ...formData, stock: Number(formData.stock || 0) })}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-4 sticky bottom-0 bg-white dark:bg-slate-900 pt-4 pb-0 transition-colors">
                <button 
                  type="button" 
                  onClick={() => setShowModal(false)}
                  className="px-6 py-2 rounded-xl text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-bold font-bengali hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  বাতিল করুন
                </button>
                <button 
                  type="submit" 
                  className="px-8 py-2 bg-primary dark:bg-blue-600 text-white rounded-xl font-bold font-bengali hover:opacity-90 shadow-lg shadow-primary/20 dark:shadow-blue-900/20"
                >
                  নিশ্চিত করুন
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {scannerTarget && (
        <BarcodeScanner 
          onClose={() => setScannerTarget(null)} 
          onResult={(res) => {
            if (res) {
              if (scannerTarget === 'add') {
                if (!formData.barcodes?.includes(res)) {
                  setFormData({ ...formData, barcodes: [...(formData.barcodes || []), res] });
                }
              } else if (scannerTarget === 'remove') {
                if (formData.barcodes?.includes(res) && !(formData as any).expiredBarcodesToRemove?.includes(res)) {
                  setFormData({
                    ...formData,
                    expiredBarcodesToRemove: [...((formData as any).expiredBarcodesToRemove || []), res],
                    expiredQtyToRemove: (formData.expiredQtyToRemove || 0) + 1
                  });
                } else if (!formData.barcodes?.includes(res)) {
                  showNotify("এই বারকোডটি এই পণ্যের বর্তমান বারকোড তালিকায় নেই", "error");
                }
              }
            }
            setScannerTarget(null);
          }} 
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md p-8 shadow-2xl animate-in zoom-in fade-in duration-200 transition-colors border dark:border-slate-800">
            <div className="w-16 h-16 bg-rose-50 dark:bg-rose-900/20 text-rose-500 rounded-2xl flex items-center justify-center mb-6 mx-auto">
              <Trash2 size={32} />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 text-center mb-2 font-bengali">পণ্যটি ডিলিট করতে চান?</h3>
            <p className="text-slate-500 dark:text-slate-400 text-center mb-8 font-bengali">আপনি কি নিশ্চিতভাবে এই পণ্যটি মুছে ফেলতে চান? এই অ্যাকশনটি রিভার্স করা যাবে না।</p>
            <div className="flex gap-4">
              <button 
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 font-bold font-bengali hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                বাতিল করুন
              </button>
              <button 
                onClick={handleDelete}
                className="flex-1 px-4 py-3 bg-rose-500 text-white rounded-xl font-bold font-bengali hover:bg-rose-600 transition-colors shadow-lg shadow-rose-200 dark:shadow-rose-900/20"
              >
                হ্যাঁ, ডিলিট করুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Generation and Printing Modal */}
      {showBarcodePrintModal && barcodeProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 transition-colors border dark:border-slate-800 flex flex-col md:flex-row h-[85vh]">
            
            {/* Embedded styles for print overlay */}
            <style dangerouslySetInnerHTML={{ __html: `
              @media print {
                body {
                  background: white !important;
                  color: black !important;
                }
                body > * {
                  display: none !important;
                }
                #print-barcode-sheet, #print-barcode-sheet * {
                  display: block !important;
                  visibility: visible !important;
                }
                #print-barcode-sheet {
                  position: absolute !important;
                  left: 0 !important;
                  top: 0 !important;
                  width: 100% !important;
                  height: auto !important;
                  z-index: 9999999 !important;
                  background: white !important;
                  padding: 10px !important;
                }
                .print-grid {
                  display: grid !important;
                  gap: 15px !important;
                  grid-template-columns: ${barcodeLayout === "a4_3col" ? "repeat(3, 1fr)" : barcodeLayout === "a4_4col" ? "repeat(4, 1fr)" : "1fr"} !important;
                }
                .print-card {
                  border: 1px solid #000 !important;
                  border-radius: 4px !important;
                  padding: 8px !important;
                  text-align: center !important;
                  background: white !important;
                  color: black !important;
                  page-break-inside: avoid !important;
                  display: flex !important;
                  flex-direction: column !important;
                  align-items: center !important;
                  justify-content: space-between !important;
                  height: ${barcodeLayout === "a4_4col" ? "90px" : "110px"} !important;
                }
                .barcode-container {
                  display: flex !important;
                  justify-content: center !important;
                  align-items: center !important;
                  width: 100% !important;
                  margin: 4px 0 !important;
                  text-align: center !important;
                }
                .barcode-container svg {
                  display: block !important;
                  margin: 0 auto !important;
                  max-width: 100% !important;
                  height: auto !important;
                }
                .print-card-header {
                  font-size: 10px !important;
                  font-weight: bold !important;
                  border-bottom: 1px dashed #000 !important;
                  width: 100% !important;
                  padding-bottom: 2px !important;
                  margin-bottom: 4px !important;
                }
                .print-card-name {
                  font-size: 11px !important;
                  font-weight: bold !important;
                }
                .print-card-price {
                  font-size: 11px !important;
                  font-weight: bold !important;
                  border-top: 1px dashed #000 !important;
                  width: 100% !important;
                  padding-top: 2px !important;
                }
              }
            `}} />

            {/* Left Column: Settings and Customization Panel */}
            <div className="w-full md:w-1/2 p-6 md:p-8 flex flex-col justify-between border-r border-slate-100 dark:border-slate-800 overflow-y-auto">
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                    <Barcode className="w-6 h-6" />
                    <h2 className="text-xl font-bold font-bengali">বারকোড জেনারেটর</h2>
                  </div>
                  <button 
                    onClick={() => setShowBarcodePrintModal(false)}
                    className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors text-slate-400"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800/0 text-slate-900 dark:text-slate-100">
                  <p className="text-[11px] text-slate-400 font-bold uppercase font-sans tracking-wide">নির্বাচিত পণ্য</p>
                  <p className="font-bold text-slate-800 dark:text-slate-100 font-bengali text-lg">{barcodeProduct.bnName || barcodeProduct.name}</p>
                  <div className="flex justify-between items-center mt-1 text-xs text-slate-500">
                    <span>SKU: {barcodeProduct.sku}</span>
                    <span className="font-bold text-primary dark:text-blue-400">মূল্য: ৳{barcodeProduct.salePrice}</span>
                  </div>
                </div>

                <div className="space-y-4 text-slate-900 dark:text-slate-100">
                  {/* Store Name Header */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 font-bengali">স্টিকারের শীর্ষ নাম (দোকানের নাম)</label>
                    <input 
                      type="text"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm text-slate-950 dark:text-slate-50"
                      value={storeHeader}
                      onChange={e => setStoreHeader(e.target.value)}
                    />
                  </div>

                  {/* Choose which code to serialize */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 font-bengali">প্রিন্টযোগ্য বারকোড নির্বাচন</label>
                    <select 
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm text-slate-900 dark:text-slate-100"
                      value={selectedBarcodeForPrint}
                      onChange={e => setSelectedBarcodeForPrint(e.target.value)}
                    >
                      <option value={barcodeProduct.sku} className="dark:bg-slate-900">{barcodeProduct.sku} (পণ্যের SKU কোড)</option>
                      {barcodeProduct.barcode && <option value={barcodeProduct.barcode} className="dark:bg-slate-900">{barcodeProduct.barcode} (প্রধান বারকোড)</option>}
                      {barcodeProduct.barcodes?.map(bc => (
                        <option key={bc} value={bc} className="dark:bg-slate-900">{bc} (সংযুক্ত বারকোড)</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Sticker quantity */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 dark:text-slate-400 font-bengali">স্টিকারের সংখ্যা</label>
                      <input 
                        type="number"
                        min="1"
                        max="200"
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm text-slate-900 dark:text-slate-100"
                        value={printQuantity}
                        onChange={e => setPrintQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      />
                    </div>

                    {/* Layout select */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 dark:text-slate-400 font-bengali">লেআউট স্টাইল</label>
                      <select 
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm text-slate-900 dark:text-slate-100"
                        value={barcodeLayout}
                        onChange={e => setBarcodeLayout(e.target.value as any)}
                      >
                        <option value="a4_3col" className="dark:bg-slate-900">A4 শীট (৩টি কলাম - স্ট্যান্ডার্ড)</option>
                        <option value="a4_4col" className="dark:bg-slate-900">A4 শীট (৪টি কলাম - ছোট সাইজ)</option>
                        <option value="thermal" className="dark:bg-slate-900">একক থার্মাল লেবেল (১টি কলাম)</option>
                      </select>
                    </div>
                  </div>

                  {/* Toggle Fields on Labels */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-slate-100 dark:border-slate-800/50 space-y-3">
                    <p className="text-xs font-bold text-slate-400/80 font-bengali">স্টিকারে যা যা দেখাবে</p>
                    <div className="flex items-center gap-6">
                      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 font-bengali cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={includeName}
                          onChange={e => setIncludeName(e.target.checked)}
                          className="rounded text-primary focus:ring-primary/20 w-4 h-4 bg-white dark:bg-slate-800"
                        />
                        <span>পণ্যের নাম</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 font-bengali cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={includePrice}
                          onChange={e => setIncludePrice(e.target.checked)}
                          className="rounded text-primary focus:ring-primary/20 w-4 h-4 bg-white dark:bg-slate-800"
                        />
                        <span>পণ্যের মূল্য</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-6 mt-6 border-t border-slate-100 dark:border-slate-800">
                <button 
                  onClick={() => setShowBarcodePrintModal(false)}
                  className="flex-1 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 font-bold hover:bg-slate-50 dark:hover:bg-slate-800 font-bengali text-sm transition-colors"
                >
                  বাতিল করুন
                </button>
                <button 
                  onClick={handlePrint}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 font-bengali text-sm transition-colors shadow-lg shadow-indigo-100 dark:shadow-indigo-950/20"
                >
                  <Printer size={18} />
                  <span>প্রিন্ট করুন</span>
                </button>
              </div>
            </div>

            {/* Right Column: Live Sheet Preview Display */}
            <div className="w-full md:w-1/2 bg-slate-100 dark:bg-slate-950 p-6 md:p-8 flex flex-col h-full overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold text-slate-405 dark:text-slate-500 uppercase tracking-widest">লাইভ প্রিভিউ</span>
                <span className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-bold px-2.5 py-1 rounded-full text-[10px] font-sans">
                  {printQuantity} টি লেবেল
                </span>
              </div>

              {/* Document Wrapper Container for Paper Preview and Print */}
              <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-inner p-6">
                <div id="print-barcode-sheet" className="font-sans text-black bg-white select-none p-2">
                  <div className={cn(
                    "grid gap-4 print-grid",
                    barcodeLayout === "a4_3col" ? "grid-cols-3" : barcodeLayout === "a4_4col" ? "grid-cols-4" : "grid-cols-1 max-w-[220px] mx-auto"
                  )}>
                    {Array.from({ length: printQuantity }).map((_, index) => (
                      <div 
                        key={index} 
                        className={cn(
                          "border border-slate-200 p-2.5 rounded-lg text-center bg-white text-black flex flex-col justify-between items-center shadow-sm print-card",
                          barcodeLayout === "a4_3col" ? "h-[110px]" : barcodeLayout === "a4_4col" ? "h-[90px] text-[10px]" : "h-[110px]"
                        )}
                      >
                        {/* Custom shop header label */}
                        {storeHeader && (
                          <p className="font-extrabold text-[9px] uppercase border-b border-dashed border-slate-300 w-full pb-0.5 mb-1 text-slate-800 tracking-wider font-bengali print-card-header leading-tight">
                            {storeHeader}
                          </p>
                        )}
                        
                        {/* Product Title */}
                        {includeName && (
                          <p className="font-bold text-slate-900 line-clamp-1 text-[10px] px-1 font-bengali leading-none print-card-name">
                            {barcodeProduct.bnName || barcodeProduct.name}
                          </p>
                        )}
                        
                        {/* Barcode vector generator */}
                        <div className="barcode-container my-1 w-full flex items-center justify-center overflow-hidden">
                          <BarcodeGenerator 
                            value={selectedBarcodeForPrint} 
                            width={barcodeLayout === "a4_4col" ? 1.25 : 1.5} 
                            height={barcodeLayout === "a4_4col" ? 28 : 34} 
                            fontSize={9} 
                          />
                        </div>

                        {/* Customer Sale Price marker */}
                        {includePrice && (
                          <p className="font-bold text-slate-950 border-t border-dashed border-slate-200 text-xs w-full pt-1.5 font-bengali leading-none print-card-price">
                            ৳ {barcodeProduct.salePrice}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Notification Toast */}
      {notification && (
        <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-xl z-[100] animate-in slide-in-from-bottom duration-300 flex items-center gap-3 ${
          notification.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        }`}>
          <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
            {notification.type === 'success' ? '✓' : '!'}
          </div>
          <span className="font-bold font-bengali">{notification.message}</span>
        </div>
      )}
    </div>
  );
}
