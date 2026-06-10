/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, FormEvent, ChangeEvent } from "react";
import { api } from "../services/api";
import { Business, User } from "../types";
import { cn } from "../lib/utils";
import { 
  Settings as SettingsIcon, 
  Store, 
  MapPin, 
  Phone, 
  DollarSign, 
  Save, 
  ShieldCheck, 
  Lock,
  Globe,
  Printer,
  Database,
  Download,
  Upload,
  Mail,
  ShieldAlert,
  FileCode,
  Trash2
} from "lucide-react";
import { motion } from "motion/react";
import CryptoJS from "crypto-js";

const BACKUP_SECRET = "smart-erp-secure-backup-key-@2024";

export function Settings({ onBusinessUpdate }: { onBusinessUpdate?: (b: Business) => void }) {
  const [business, setBusiness] = useState<Business | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'profile' | 'printer' | 'backup'>('profile');
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error' | 'info'} | null>(null);
  
  // States for Security tab
  const [passwords, setPasswords] = useState({ current: "", new: "", confirm: "" });
  
  // State for Printer tab
  const [selectedPrinter, setSelectedPrinter] = useState('thermal');

  // Backup loading state
  const [backupAction, setBackupAction] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [lastImportedData, setLastImportedData] = useState<any>(null);
  const [importStatus, setImportStatus] = useState<{
    stage: 'idle' | 'reading' | 'decrypting' | 'reviewing' | 'restoring' | 'success' | 'error',
    message?: string,
    summary?: { products: number, sales: number, users: number, businessName: string }
  }>({ stage: 'idle' });

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [bizData, users, backupStatus] = await Promise.all([
          api.getBusiness(),
          api.getUsers(),
          api.getBackupStatus()
        ]);
        setBusiness(bizData);
        if (bizData.defaultPrinter) {
          setSelectedPrinter(bizData.defaultPrinter);
        }
        setLastBackupAt(backupStatus.lastBackupAt);
        // Find current admin or logged in user
        const admin = users.find(u => u.role === 'admin' || u.id === "1");
        if (admin) setCurrentUser(admin);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleManualBackup = async () => {
    if (!business.backupEmail || !business.backupEmail.trim()) {
      showNotify("দয়া করে প্রথমে ব্যাকআপ ইমেইল সেট করুন।", "error");
      return;
    }
    setBackupAction(true);
    try {
      // First save business settings to ensure email is up to date
      await api.updateBusiness(business);
      showNotify("ইমেইল ব্যাকআপ প্রসেস হচ্ছে...", "info");
      const res = await api.triggerBackup();
      if (res.skipped) {
        showNotify("ব্যাকআপ ইমেইল সেট করা নেই। দয়া করে প্রথমে ব্যাকআপ ইমেইল সেট করুন।", "error");
        return;
      }
      setLastBackupAt(res.lastBackupAt);
      showNotify("সফলভাবে ইমেইল ব্যাকআপ পাঠানো হয়েছে!", "success");
    } catch (err: any) {
      showNotify(err.message || "ইমেইল পাঠাতে ব্যর্থ হয়েছে।", "error");
    } finally {
      setBackupAction(false);
    }
  };

  const showNotify = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleExportData = async () => {
    setBackupAction(true);
    try {
      const allData = await api.getAllData();
      const jsonData = JSON.stringify(allData);
      
      // Encrypt data
      const encrypted = CryptoJS.AES.encrypt(jsonData, BACKUP_SECRET).toString();
      const backupPayload = `HISHAB_BAK_V2:${encrypted}`;
      
      const blob = new Blob([backupPayload], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `smart_erp_backup_${new Date().toISOString().split('T')[0]}.bak`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      showNotify("ড্যাটা সফলভাবে এক্সপোর্ট এবং ইনক্রিপ্ট করা হয়েছে");
    } catch (err) {
      showNotify("এক্সপোর্ট করতে সমস্যা হয়েছে", "error");
    } finally {
      setBackupAction(false);
    }
  };

  const handleImportData = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBackupAction(true);
    setImportStatus({ stage: 'reading', message: "ফাইল পড়া হচ্ছে..." });
    
    try {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = (e) => reject(new Error("File reading failed"));
        reader.readAsText(file);
      });

      setImportStatus({ stage: 'decrypting', message: "ডিক্রিপ্ট এবং প্রসেস হচ্ছে..." });
      
      // Artificial delay so user can see what's happening
      await new Promise(r => setTimeout(r, 800));

      let encryptedContent = content;
      if (content.startsWith('HISHAB_BAK_V2:')) {
        encryptedContent = content.replace('HISHAB_BAK_V2:', '');
      }

      // Decrypt data
      const bytes = CryptoJS.AES.decrypt(encryptedContent, BACKUP_SECRET);
      const decryptedData = bytes.toString(CryptoJS.enc.Utf8);
      
      if (!decryptedData) {
        throw new Error("ভুল পাসওয়ার্ড অথবা নষ্ট ফাইল (Decryption Failed)");
      }
      
      let parsedData;
      try {
        parsedData = JSON.parse(decryptedData);
      } catch (e) {
        console.error("JSON Parse Error on Decrypted Data:", e);
        throw new Error("ডিক্রিপ্ট করা তথ্য সঠিক নয় (Invalid JSON format)");
      }
      
      setLastImportedData(parsedData);
      
      const summary = {
        users: parsedData.users?.length || 0,
        products: parsedData.products?.length || 0,
        sales: parsedData.sales?.length || 0,
        businessName: parsedData.business?.name || "Unknown"
      };

      // Move to reviewing stage
      setImportStatus({ 
        stage: 'reviewing', 
        message: "ব্যাকআপ ফাইল চেক করা হয়েছে। নিচের তথ্যগুলো আপনার বর্তমান টাটাবেজকে পরিবর্তন করবে।",
        summary
      });

      // We wait for the user to click "Confirm" in the UI section
      // The actual API call will be moved to a separate function or handled via state

    } catch (err: any) {
      console.error("Import Error:", err);
      setImportStatus({ 
        stage: 'error', 
        message: err.message || "ইমপোর্ট ব্যর্থ হয়েছে। ফাইলটি সঠিক নয়।" 
      });
      showNotify(err.message || "ইমপোর্ট ব্যর্থ হয়েছে।", "error");
    } finally {
      setBackupAction(false);
      e.target.value = '';
    }
  };

  const confirmAndRestore = async () => {
    if (!lastImportedData || importStatus.stage !== 'reviewing') return;
    
    setBackupAction(true);
    setImportStatus(prev => ({ ...prev, stage: 'restoring', message: "সার্ভারে ড্যাটা ক্লিয়ার এবং রিস্টোর হচ্ছে..." }));

    try {
      showNotify("সার্ভারে ড্যাটা পাঠানো হচ্ছে...", "success");
      
      const response = await api.restoreDB(lastImportedData);
      console.log("Server Restore Response:", response);
      
      setImportStatus({ stage: 'success', message: "সফলভাবে রিস্টোর করা হয়েছে!" });
      showNotify("সফলভাবে রিস্টোর করা হয়েছে!", "success");
      
      // We don't reload automatically, we'll show a button in the UI
    } catch (err: any) {
      console.error("Restore Error:", err);
      setImportStatus({ stage: 'error', message: err.message || "সার্ভারে ড্যাটা রিস্টোর করতে ব্যর্থ হয়েছে" });
      showNotify("রিস্টোর ব্যর্থ হয়েছে", "error");
    } finally {
      setBackupAction(false);
    }
  };

  const handleUpdateBusiness = async (e: FormEvent) => {
    e.preventDefault();
    if (!business) return;
    setSaving(true);
    try {
      await api.updateBusiness(business);
      if (onBusinessUpdate) onBusinessUpdate(business);
      showNotify("ব্যবসার তথ্য সফলভাবে আপডেট করা হয়েছে");
    } catch (err) {
      showNotify("আপডেট করতে সমস্যা হয়েছে", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setSaving(true);
    try {
      await api.updateUser(currentUser.id, currentUser);
      showNotify("আপনার প্রোফাইল তথ্য আপডেট করা হয়েছে");
    } catch (err) {
      showNotify("আপডেট করতে সমস্যা হয়েছে", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      showNotify("নতুন পাসওয়ার্ড দুটি মিলছে না", "error");
      return;
    }
    if (passwords.new.length < 6) {
      showNotify("পাসওয়ার্ড অন্তত ৬ অক্ষরের হতে হবে", "error");
      return;
    }
    setSaving(true);
    try {
      await api.changePassword({ currentPassword: passwords.current, newPassword: passwords.new });
      showNotify("পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে");
      setPasswords({ current: "", new: "", confirm: "" });
    } catch (err) {
      showNotify("পাসওয়ার্ড পরিবর্তন ব্যর্থ হয়েছে", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center animate-pulse">
        <SettingsIcon className="mx-auto w-12 h-12 text-slate-300 animate-spin-slow" />
        <p className="mt-4 font-bengali text-slate-500">সেটিংস লোড হচ্ছে...</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto bg-slate-50 dark:bg-slate-950 transition-colors duration-300 min-h-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-bengali">সিস্টেম সেটিংস</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-bengali">আপনার শপ এবং সিস্টেমের যাবতীয় কনফিগারেশন</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar Tabs */}
        <div className="lg:col-span-1 space-y-2">
          {[
            { id: 'profile', label: 'শপ প্রোফাইল', icon: Store },
            { id: 'printer', label: 'প্রিন্টার সেটিংস', icon: Printer },
            { id: 'backup', label: 'ব্যাকআপ ও রিস্টোর', icon: Database },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bengali font-bold transition-all ${
                activeSubTab === tab.id 
                  ? 'bg-primary text-white shadow-lg shadow-primary/20' 
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="lg:col-span-3">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
            {activeSubTab === 'profile' && business && (
              <form onSubmit={handleUpdateBusiness} className="p-8 space-y-6">
                <div className="flex items-center gap-6 mb-8 p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800">
                  <div className="relative group">
                    <div className="w-24 h-24 bg-white dark:bg-slate-800 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-400 dark:text-slate-600 overflow-hidden group-hover:border-primary transition-all">
                      {business.logo ? (
                        <img src={business.logo} alt="Shop Logo" className="w-full h-full object-contain" />
                      ) : (
                        <Store size={40} />
                      )}
                    </div>
                    <label className="absolute -bottom-2 -right-2 w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center cursor-pointer shadow-lg hover:scale-110 transition-all">
                      <Save size={14} />
                      <input 
                        type="file" 
                        className="hidden" 
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              const img = new Image();
                              img.onload = () => {
                                const canvas = document.createElement("canvas");
                                const MAX_WIDTH = 240;
                                const MAX_HEIGHT = 240;
                                let width = img.width;
                                let height = img.height;

                                if (width > height) {
                                  if (width > MAX_WIDTH) {
                                    height = Math.round((height * MAX_WIDTH) / width);
                                    width = MAX_WIDTH;
                                  }
                                } else {
                                  if (height > MAX_HEIGHT) {
                                    width = Math.round((width * MAX_HEIGHT) / height);
                                    height = MAX_HEIGHT;
                                  }
                                }

                                canvas.width = width;
                                canvas.height = height;
                                const ctx = canvas.getContext("2d");
                                if (ctx) {
                                  ctx.drawImage(img, 0, 0, width, height);
                                  // Compress as JPEG (usually under 15KB!) to ensure reliable Firestore saving
                                  const compressedBase64 = canvas.toDataURL("image/jpeg", 0.85);
                                  setBusiness({...business, logo: compressedBase64});
                                } else {
                                  setBusiness({...business, logo: event.target?.result as string});
                                }
                              };
                              img.src = event.target?.result as string;
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                    </label>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 font-bengali">শপ লোগো</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 font-bengali">আপনার শপের লোগো আপলোড করুন (JPEG/PNG)</p>
                    {business.logo && (
                      <button 
                        type="button"
                        onClick={() => setBusiness({...business, logo: ""})}
                        className="text-xs text-rose-500 font-bold font-bengali mt-2 hover:underline"
                      >
                        লোগো মুছে ফেলুন
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 mb-4">
                  <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center text-slate-400 dark:text-slate-500">
                    <Store size={32} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 font-bengali">শপ ইনফরমেশন</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 font-bengali">ইনভয়েস এবং রিপোর্টে এই তথ্যগুলো দেখা যাবে</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300 font-bengali">শপের নাম</label>
                    <div className="relative">
                      <Store className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input 
                        type="text"
                        className="w-full bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl py-2 pl-12 pr-4 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 outline-none transition-all font-bengali text-sm"
                        value={business.name || ""}
                        onChange={e => setBusiness({...business, name: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300 font-bengali">ফোন নম্বর</label>
                    <div className="relative">
                      <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input 
                        type="text"
                        className="w-full bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl py-2 pl-12 pr-4 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 outline-none transition-all font-sans text-sm"
                        value={business.phone || ""}
                        onChange={e => setBusiness({...business, phone: e.target.value})}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300 font-bengali">ঠিকানা</label>
                  <div className="relative">
                    <MapPin className="absolute left-4 top-4 text-slate-400" size={18} />
                    <textarea 
                      rows={3}
                      className="w-full bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl py-2 pl-12 pr-4 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 outline-none transition-all font-bengali text-sm"
                      value={business.address || ""}
                      onChange={e => setBusiness({...business, address: e.target.value})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300 font-bengali">কারেন্সি (Currency)</label>
                    <div className="relative">
                      <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <select 
                        className="w-full bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl py-2 pl-12 pr-4 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 outline-none transition-all font-sans text-sm"
                        value={business.currency}
                        onChange={e => setBusiness({...business, currency: e.target.value})}
                      >
                        <option value="BDT">BDT (৳)</option>
                        <option value="USD">USD ($)</option>
                        <option value="INR">INR (₹)</option>
                      </select>
                    </div>
                  </div>
                </div>

                <button 
                  disabled={saving}
                  className="flex items-center gap-2 px-8 py-3 bg-primary text-white rounded-xl font-bold font-bengali hover:scale-105 active:scale-95 transition-all shadow-lg shadow-primary/30 disabled:opacity-50"
                  type="submit"
                >
                  <Save size={20} />
                  {saving ? "সেভ হচ্ছে..." : "পরিবর্তন সংরক্ষণ করুন"}
                </button>
              </form>
            )}

            {activeSubTab === 'backup' && (
              <div className="p-8 space-y-8">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-500">
                      <Database size={32} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 font-bengali">ব্যাকআপ অ্যান্ড রিস্টোর</h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400 font-bengali">আপনার সিস্টেমের সকল তথ্য সুরক্ষিত রাখুন</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Left Column: Status & Direct Backup */}
                  <div className="space-y-6">
                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 transition-colors">
                      <div className="flex items-center gap-4 mb-6">
                        <div className={cn(
                          "w-14 h-14 rounded-2xl flex items-center justify-center transition-all",
                          lastBackupAt ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600" : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                        )}>
                          <Mail size={28} />
                        </div>
                        <div>
                          <p className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">সর্বশেষ সফল ইমেইল ব্যাকআপ</p>
                          <p className={cn(
                            "text-base font-bold font-sans",
                            lastBackupAt ? "text-slate-900 dark:text-slate-100" : "text-slate-500"
                          )}>
                            {lastBackupAt 
                              ? new Date(lastBackupAt).toLocaleString('bn-BD', {
                                  year: 'numeric', month: 'long', day: 'numeric',
                                  hour: '2-digit', minute: '2-digit', hour12: true
                                })
                              : "আজ এখনও কোন ব্যাকআপ পাঠানো হয়নি"}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <button
                          onClick={handleManualBackup}
                          disabled={backupAction}
                          className="w-full py-4 bg-slate-900 dark:bg-blue-600 text-white rounded-2xl font-bold font-bengali hover:bg-slate-800 dark:hover:bg-blue-700 disabled:opacity-50 transition-all flex items-center justify-center gap-3 shadow-xl shadow-slate-900/10 dark:shadow-blue-900/20"
                        >
                          <Save size={20} />
                          {backupAction ? "ব্যাকআপ প্রসেস হচ্ছে..." : "ব্যাকআপ ইমেইল করুন"}
                        </button>
                      </div>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 space-y-6 transition-colors">
                      <h4 className="font-bold text-slate-900 dark:text-slate-100 font-bengali flex items-center gap-2">
                        <Download size={18} className="text-slate-400 dark:text-slate-500" />
                        ম্যানুয়াল এক্সপোর্ট ও ইমপোর্ট
                      </h4>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <button 
                          onClick={handleExportData}
                          disabled={backupAction}
                          className="flex flex-col items-center gap-2 p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl hover:border-primary transition-all group"
                        >
                          <Download size={20} className="text-slate-400 dark:text-slate-500 group-hover:text-primary dark:group-hover:text-blue-400" />
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-300 font-bengali">এক্সপোর্ট</span>
                        </button>
                        
                        <div className="relative">
                          <input 
                            type="file"
                            onChange={handleImportData}
                            accept=".bak"
                            className="absolute inset-0 opacity-0 cursor-pointer z-10"
                          />
                          <div className="flex flex-col items-center gap-2 p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl hover:border-emerald-500 transition-all group h-full">
                            <Upload size={20} className="text-slate-400 dark:text-slate-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400" />
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 font-bengali">ইমপোর্ট</span>
                          </div>
                        </div>
                      </div>

                      {importStatus.stage === 'reviewing' && importStatus.summary && (
                        <div className="p-4 bg-white rounded-2xl border-2 border-emerald-500 space-y-4 animate-in fade-in slide-in-from-top-4">
                           <h5 className="font-bold text-emerald-700 font-bengali text-xs">ব্যাকআপ ফাইল প্রস্তুত:</h5>
                           <div className="grid grid-cols-2 gap-2 text-[11px] font-sans">
                              <div>Shop: <span className="font-bold">{importStatus.summary.businessName}</span></div>
                              <div>Users: <span className="font-bold">{importStatus.summary.users}</span></div>
                              <div>Products: <span className="font-bold">{importStatus.summary.products}</span></div>
                              <div>Sales: <span className="font-bold">{importStatus.summary.sales}</span></div>
                           </div>
                           <button 
                            onClick={confirmAndRestore}
                            className="w-full py-2 bg-emerald-600 text-white rounded-xl font-bold font-bengali hover:bg-emerald-700"
                           >
                            রিস্টোর কনফার্ম করুন
                           </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: SMTP Config */}
                  <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 space-y-6 transition-colors">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 bg-primary/10 dark:bg-blue-900/30 text-primary dark:text-blue-400 rounded-xl flex items-center justify-center">
                        <Mail size={20} />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 dark:text-slate-100 font-bengali">ইমেইল সেটিংস (SMTP)</h4>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bengali">ব্যাকআপ পাঠানোর জন্য জিমেইল সেট করুন</p>
                      </div>
                    </div>
 
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider font-sans">Gmail Address</label>
                        <input 
                          type="email"
                          placeholder="your-email@gmail.com"
                          className="w-full bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl py-3 px-4 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 outline-none transition-all font-sans"
                          value={business.smtpConfig?.user || ""}
                          onChange={e => setBusiness({
                            ...business, 
                            smtpConfig: { ...(business.smtpConfig || {pass: ""}), user: e.target.value }
                          })}
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider font-sans">Gmail App Password</label>
                        <input 
                          type="password"
                          placeholder="•••• •••• •••• ••••"
                          className="w-full bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl py-3 px-4 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 outline-none transition-all font-sans"
                          value={business.smtpConfig?.pass || ""}
                          onChange={e => setBusiness({
                            ...business, 
                            smtpConfig: { ...(business.smtpConfig || {user: ""}), pass: e.target.value }
                          })}
                        />
                        <p className="text-[9px] text-slate-400 font-bengali italic mb-1">App Passwords ১৬ অক্ষরের হয়। regular password দিবেন না।</p>
                        <a 
                          href="https://myaccount.google.com/apppasswords" 
                          target="_blank" 
                          rel="noreferrer"
                          className="text-[10px] text-primary hover:underline font-bengali"
                        >
                          কিভাবে App Password পাবেন? এখানে ক্লিক করুন
                        </a>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider font-sans">Sender Name</label>
                        <input 
                          type="text"
                          className="w-full bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl py-2 px-4 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 outline-none transition-all font-bengali text-sm"
                          value={business.smtpConfig?.senderName || "Smart Business Backup"}
                          onChange={e => setBusiness({
                            ...business, 
                            smtpConfig: { ...(business.smtpConfig || {user: "", pass: ""}), senderName: e.target.value }
                          })}
                        />
                      </div>
 
                      <div className="flex gap-3">
                        <button 
                          onClick={handleUpdateBusiness}
                          disabled={saving}
                          className="w-full py-3 bg-primary text-white rounded-xl font-bold font-bengali hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
                        >
                          {saving ? "সেভ হচ্ছে..." : "সেটিংস সেভ করুন"}
                        </button>
                      </div>
 
                      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800 flex gap-3">
                        <Mail className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" size={18} />
                        <div className="space-y-2 flex-1">
                          <p className="text-xs font-bold text-blue-800 dark:text-blue-200 font-bengali">ব্যাকআপ ইমেইল (Recipient):</p>
                          <input 
                            type="email"
                            placeholder="recipient@example.com"
                            className="w-full bg-white dark:bg-slate-800 border-blue-200 dark:border-blue-700 rounded-lg py-2 px-3 focus:ring-2 focus:ring-primary/20 outline-none text-xs font-sans text-slate-900 dark:text-slate-200"
                            value={business.backupEmail || ""}
                            onChange={e => setBusiness({...business, backupEmail: e.target.value})}
                          />
                          <p className="text-[9px] text-blue-700 dark:text-blue-400 font-bengali leading-relaxed">
                            * এই ইমেইলে প্রতিদিন রাত ১২টা এবং দুপুর ১২টায় অটোমেটিক ব্যাকআপ পাঠানো হবে।
                          </p>
                        </div>
                      </div>

                      <div className="p-5 bg-amber-50 rounded-2xl border border-amber-100 flex gap-3">
                        <ShieldAlert className="text-amber-600 shrink-0 mt-0.5" size={18} />
                        <div className="space-y-2">
                          <p className="text-xs font-bold text-amber-800 font-bengali">নির্দেশিকা:</p>
                          <ul className="text-[10px] text-amber-700 font-bengali space-y-1.5 leading-relaxed">
                            <li>১. জিমেইলে <strong>2-Step Verification</strong> চালু থাকতে হবে।</li>
                            <li>২. গুগল সেটিং থেকে <strong>"App Password"</strong> তৈরি করে সেটি ব্যবহার করুন।</li>
                          </ul>
                        </div>
                      </div>

                      <div className="p-6 bg-rose-50 dark:bg-rose-900/10 rounded-2xl border border-rose-100 dark:border-rose-900/30 space-y-4">
                        <div className="flex items-center gap-3">
                          <Trash2 className="text-rose-600" size={20} />
                          <h4 className="text-sm font-bold text-rose-900 dark:text-rose-100 font-bengali">ডাটা রিসেট (ডেঞ্জার জোন)</h4>
                        </div>
                        <p className="text-xs text-rose-700 dark:text-rose-400 font-bengali leading-relaxed">
                          রিস্টোর ফিচারটি চেক করার জন্য এখান থেকে সকল পন্য, কাস্টমার এবং বিক্রয় তথ্য মুছে ফেলতে পারেন। এটি স্থায়ীভাবে ডাটা মুছে দিবে।
                        </p>
                        <button 
                          onClick={async () => {
                            if (!business?.id) {
                              showNotify("দয়া করে একটু অপেক্ষা করুন, সেটিংস লোড হচ্ছে", "info");
                              return;
                            }
                            if (window.confirm("আপনি কি নিশ্চিত? সকল ডাটা মুছে যাবে!")) {
                              try {
                                showNotify("ডাটা মোছা হচ্ছে...", "info");
                                const response = await fetch("/api/debug/clear-all-data", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ businessId: business.id })
                                });
                                
                                const resData = await response.json();
                                if (response.ok && resData.success) {
                                  showNotify("সকল ডাটা সফলভাবে মুছে ফেলা হয়েছে!", "success");
                                  setTimeout(() => {
                                    window.location.href = "/"; 
                                  }, 1500);
                                } else {
                                  let errMsg = resData.error || resData.message || "মুছতে সমস্যা হয়েছে";
                                  if (resData.errors && resData.errors.length > 0) {
                                    errMsg += ": " + resData.errors.join(", ");
                                  }
                                  throw new Error(errMsg);
                                }
                              } catch (e: any) {
                                console.error("Clear error:", e);
                                showNotify(e.message || "ডাটা মুছতে সমস্যা হয়েছে", "error");
                              }
                            }
                          }}
                          className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 px-4 rounded-xl shadow-lg shadow-rose-900/20 transition-all font-bengali text-sm"
                        >
                          সকল তথ্য মুছে ফেলুন
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSubTab === 'printer' && (
              <div className="p-8 space-y-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-16 h-16 bg-amber-50 dark:bg-amber-900/20 rounded-2xl flex items-center justify-center text-amber-600 dark:text-amber-500">
                    <Printer size={32} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 font-bengali">প্রিন্টার এবং ইনভয়েস</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 font-bengali">থার্মাল এবং এ-ফোর প্রিন্টিং সেটআপ</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div 
                    onClick={async () => { 
                      setSelectedPrinter('thermal'); 
                      if (business) {
                        const updatedBiz = { ...business, defaultPrinter: 'thermal' as const };
                        setBusiness(updatedBiz);
                        await api.updateBusiness(updatedBiz);
                        if (onBusinessUpdate) onBusinessUpdate(updatedBiz);
                      }
                      showNotify("ডিফল্ট প্রিন্টার: Thermal");
                    }}
                    className={cn(
                      "p-6 rounded-3xl border transition-all cursor-pointer",
                      selectedPrinter === 'thermal' ? "bg-slate-50 dark:bg-slate-800 border-primary/20 dark:border-blue-500/30 ring-2 ring-primary/5" : "bg-white dark:bg-slate-800/30 border-slate-200 dark:border-slate-800"
                    )}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <Printer size={20} className={selectedPrinter === 'thermal' ? "text-primary dark:text-blue-400" : "text-slate-400 dark:text-slate-600"} />
                      {selectedPrinter === 'thermal' && <span className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse" />}
                    </div>
                    <p className="font-black text-slate-900 dark:text-slate-100">Thermal 80mm</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-bengali">
                      {selectedPrinter === 'thermal' ? "ডিফল্ট প্রিন্টার হিসেবে সেট করা আছে" : "কানেক্ট করতে ক্লিক করুন"}
                    </p>
                  </div>
                  <div 
                    onClick={async () => { 
                      setSelectedPrinter('a4'); 
                      if (business) {
                        const updatedBiz = { ...business, defaultPrinter: 'a4' as const };
                        setBusiness(updatedBiz);
                        await api.updateBusiness(updatedBiz);
                        if (onBusinessUpdate) onBusinessUpdate(updatedBiz);
                      }
                      showNotify("ডিফল্ট প্রিন্টার: A4 Laser");
                    }}
                    className={cn(
                      "p-6 rounded-3xl border transition-all cursor-pointer",
                      selectedPrinter === 'a4' ? "bg-slate-50 dark:bg-slate-800 border-primary/20 dark:border-blue-500/30 ring-2 ring-primary/5" : "bg-white dark:bg-slate-800/30 border-slate-200 dark:border-slate-800"
                    )}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <Globe size={20} className={selectedPrinter === 'a4' ? "text-primary dark:text-blue-400" : "text-slate-400 dark:text-slate-600"} />
                      {selectedPrinter === 'a4' && <span className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse" />}
                    </div>
                    <p className="font-bold text-slate-900 dark:text-slate-100">A4 Laser Desktop</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-bengali">
                      {selectedPrinter === 'a4' ? "ডিফল্ট প্রিন্টার হিসেবে সেট করা আছে" : "কানেক্ট করতে ক্লিক করুন"}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {notification && (
        <motion.div 
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          className={`fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-xl z-50 flex items-center gap-3 ${
            notification.type === 'success' ? 'bg-emerald-600 text-white' : 
            notification.type === 'info' ? 'bg-blue-600 text-white' : 'bg-rose-600 text-white'
          }`}
        >
          <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center font-bold">
            {notification.type === 'success' ? '✓' : '!'}
          </div>
          <span className="font-bold font-bengali">{notification.message}</span>
        </motion.div>
      )}
    </div>
  );
}
