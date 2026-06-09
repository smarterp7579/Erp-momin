/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sidebar } from "./components/Sidebar";
import { MobileNav } from "./components/MobileNav";
import { Header } from "./components/Header";
import { Product, Customer, Sale, User, Business } from "./types";
import { Printer, X, Download, FileText, Building2, Mail, Lock, ArrowRight, Loader2 } from "lucide-react";
// @ts-ignore - html2pdf doesn't have built-in types
import html2pdf from 'html2pdf.js';
import { setApiBusinessId, api } from "./services/api";
import { cn } from "./lib/utils";
import { 
  signInWithEmailAndPassword, 
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInAnonymously,
  setPersistence,
  browserSessionPersistence
} from "firebase/auth";
import { auth, db, doc, getDoc, setDoc, collection, query, where, getDocs, limit } from "./lib/firebase";

// Lazy Load Components
const Dashboard = lazy(() => import("./components/Dashboard").then(m => ({ default: m.Dashboard })));
const POS = lazy(() => import("./components/POS").then(m => ({ default: m.POS })));
const ProductList = lazy(() => import("./components/ProductList").then(m => ({ default: m.ProductList })));
const CustomerList = lazy(() => import("./components/CustomerList").then(m => ({ default: m.CustomerList })));
const SalesList = lazy(() => import("./components/SalesList").then(m => ({ default: m.SalesList })));
const SupplierList = lazy(() => import("./components/SupplierList").then(m => ({ default: m.SupplierList })));
const Accounting = lazy(() => import("./components/Accounting").then(m => ({ default: m.Accounting })));
const Reports = lazy(() => import("./components/Reports").then(m => ({ default: m.Reports })));
const DueManagement = lazy(() => import("./components/DueManagement").then(m => ({ default: m.DueManagement })));
const SMSModule = lazy(() => import("./components/SMSModule").then(m => ({ default: m.SMSModule })));
const UserManagement = lazy(() => import("./components/UserManagement").then(m => ({ default: m.UserManagement })));
const Settings = lazy(() => import("./components/Settings").then(m => ({ default: m.Settings })));

const LoadingFallback = () => (
  <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-slate-950 transition-colors">
    <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
  </div>
);

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [printHtml, setPrintHtml] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  
  const [business, setBusiness] = useState<Business | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("smart_business_theme");
    return (saved as "light" | "dark") || "light";
  });

  const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);

  const resetIdleTimer = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (user) {
      idleTimerRef.current = setTimeout(() => {
        handleLogout();
        alert("অ্যাক্টিভিটি না থাকায় আপনাকে লগআউট করে দেয়া হয়েছে। অনুগ্রহ করে আবার লগইন করুন।");
      }, INACTIVITY_TIMEOUT);
    }
  };

  useEffect(() => {
    if (user) {
      const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
      const handleActivity = () => resetIdleTimer();

      events.forEach(event => window.addEventListener(event, handleActivity));
      resetIdleTimer();

      return () => {
        events.forEach(event => window.removeEventListener(event, handleActivity));
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      };
    }
  }, [user]);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("smart_business_theme", theme);
  }, [theme]);
  
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  useEffect(() => {
    // Initial Auth Check from Session with anonymous integration
    const checkAuth = async () => {
      try {
        let cred = null;
        try {
          cred = await signInAnonymously(auth);
          console.log("[Firebase Auth] Anonymous sign in successful. UID:", cred?.user?.uid);
        } catch (authErr: any) {
          // If anonymous authentication is disabled on the project, log as a warning and use the graceful offline/unauthenticated fallback.
          console.warn("[Firebase Auth] Anonymous sign in is not enabled in Firebase Console (admin-restricted-operation is expected if anonymous auth is turned off in the console):", authErr.message || authErr);
        }
        
        const savedUser = localStorage.getItem("smart_business_user");
        if (savedUser) {
          try {
            const userData = JSON.parse(savedUser);
            setUser(userData);
            setApiBusinessId(userData.businessId);
            
            // Sync session metadata to Firestore if signed in
            if (cred && cred.user) {
              await setDoc(doc(db, "sessions", cred.user.uid), {
                businessId: userData.businessId,
                userId: userData.id,
                role: userData.role,
                email: userData.email,
                name: userData.name,
                updatedAt: new Date().toISOString()
              });
              console.log("[Firebase Auth] Active session synchronized successfully.");
            }
          } catch (e) {
            console.warn("Session sync failed:", e);
          }
        }
      } catch (err: any) {
        console.warn("Session check fallback:", err.message || err);
        const savedUser = localStorage.getItem("smart_business_user");
        if (savedUser) {
          try {
            const userData = JSON.parse(savedUser);
            setUser(userData);
            setApiBusinessId(userData.businessId);
          } catch (e) {
            console.error("Session parse error:", e);
          }
        }
      }
      setIsInitializing(false);
    };

    checkAuth();

    const loadBusiness = async () => {
      try {
        const data = await api.getBusiness();
        setBusiness(data);
      } catch (err) {
        console.error("Failed to load business info:", err);
      }
    };
    loadBusiness();

    const handlePrint = (e: any) => {
      setPrintHtml(e.detail.html);
      setIsGeneratingPDF(false);
    };

    window.addEventListener('smart-print', handlePrint);
    return () => {
      window.removeEventListener('smart-print', handlePrint);
    };
  }, []);

  // Auto Backup Effect - Only runs once user is confirmed authenticated in Firebase
  useEffect(() => {
    if (user && !isInitializing) {
      const checkAndTriggerBackup = async () => {
        try {
          const status = await api.getBackupStatus();
          const today = new Date().toISOString().split('T')[0];
          if (!status.lastBackupAt || status.lastBackupAt.split('T')[0] !== today) {
            console.log("[Auto Backup] Triggering daily backup...");
            await api.triggerBackup();
          }
        } catch (err) {
          console.error("[Auto Backup] Check failed:", err);
        }
      };
      
      // Delay to ensure Firebase Auth session is recognized by rules engine
      const timer = setTimeout(checkAndTriggerBackup, 2000);
      return () => clearTimeout(timer);
    }
  }, [user, isInitializing]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);

    const email = loginEmail.trim().toLowerCase();
    const password = loginPassword.trim();
    const BOOTSTRAP_EMAILS = [
      "mominkhan051220@gmail.com",
      "apondreem@gmail.com",
      "admin@smartbusiness.com"
    ];

    try {
      try {
        // First try normal login
        const userData = await api.login(email, password);
        handleLogin(userData);
      } catch (loginErr: any) {
        // Bootstrap check for main admin if normal login fails or password mismatches
        const isBootstrapAdmin = 
          BOOTSTRAP_EMAILS.includes(email) ||
          email.startsWith("mominkhan") ||
          email.includes("mominkhan");
        
        if (isBootstrapAdmin && password.length > 0) {
          console.log("[Bootstrap] Using emergency login for admin:", email);
          
          let allUsers: User[] = [];
          try {
            allUsers = await api.getUsers();
          } catch (e) {
            console.warn("Bootstrap getUsers failed, trying empty list", e);
          }
          
          const matchedUser = allUsers.find(u => (u.email || "").toLowerCase().trim() === email);
          
          let adminUser: User;
          const fullPermissions = ["dashboard", "pos", "sales", "add_sale", "delete_sale", "products", "add_product", "delete_product", "customers", "add_customer", "delete_customer", "suppliers", "accounting", "due", "sms", "reports", "users", "settings"];
          
          if (!matchedUser) {
            // Create the admin doc if missing
            adminUser = {
              id: "admin-master-" + Date.now(),
              name: "Super Admin",
              email: email,
              password: password,
              role: "admin",
              createdAt: new Date().toISOString(),
              businessId: "main-business",
              permissions: fullPermissions
            };
            await api.createUser(adminUser);
          } else {
            // User exists but wrong password in DB or something else? Sync it.
            adminUser = { ...matchedUser };
            
            // Only update if password or role needs fixing
            if (adminUser.password !== password || adminUser.role !== 'admin') {
              adminUser.password = password;
              adminUser.role = "admin";
              adminUser.permissions = fullPermissions;
              await api.updateUser(adminUser.id, adminUser);
            }
          }
          
          handleLogin(adminUser);
          setLoginLoading(false);
          return;
        }
        // If not bootstrap admin, throw the original error
        throw loginErr;
      }
    } catch (err: any) {
      console.error("Login Fail:", err);
      setLoginError(err.message || "লগইন করা সম্ভব হয়নি।");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!loginEmail.trim()) {
      setLoginError("পাসওয়ার্ড রিসেট করতে আগে ইমেইল এড্রেসটি লিখুন।");
      return;
    }
    
    setResetLoading(true);
    setLoginError(null);
    setResetSuccess(null);
    
    try {
      await sendPasswordResetEmail(auth, loginEmail.trim());
      setResetSuccess("আপনার ইমেইলে একটি পাসওয়ার্ড রিসেট লিংক পাঠানো হয়েছে। অনুগ্রহ করে ইমেইল চেক করুন।");
    } catch (err: any) {
      console.error("Reset Error:", err);
      setLoginError("পাসওয়ার্ড রিসেট লিংক পাঠানো যায়নি। ইমেইল কি সঠিক?");
    } finally {
      setResetLoading(false);
    }
  };

  const handleLogin = async (userData: User) => {
    setUser(userData);
    setApiBusinessId(userData.businessId);
    localStorage.setItem("smart_business_user", JSON.stringify(userData));

    // Also sync to active firestore session if signed in anonymously
    if (auth.currentUser) {
      try {
        await setDoc(doc(db, "sessions", auth.currentUser.uid), {
          businessId: userData.businessId,
          userId: userData.id,
          role: userData.role,
          email: userData.email,
          name: userData.name,
          updatedAt: new Date().toISOString()
        });
        console.log("[Firebase Auth] Session synced on login:", auth.currentUser.uid);
      } catch (err) {
        console.error("[Firebase Auth] Failed to sync session on login:", err);
      }
    }
  };

  const handleLogout = async () => {
    if (auth.currentUser) {
      try {
        // Clean up the session document in Firestore on logout
        await setDoc(doc(db, "sessions", auth.currentUser.uid), {
          businessId: "",
          userId: "",
          role: "",
          updatedAt: new Date().toISOString()
        });
      } catch (e) {
        console.warn("[Firebase Auth] Failed to cleanup session document on logout:", e);
      }
    }
    setUser(null);
    setApiBusinessId(null);
    setLoginEmail("");
    setLoginPassword("");
    localStorage.removeItem("smart_business_user");
  };

  const handleFinalPrint = () => {
    // We use the existing hidden #printable-area which is configured in CSS
    // to be the only thing visible during print. This is much more reliable
    // on mobile devices than window.open().
    window.print();
  };

  const handleDownloadPDF = async () => {
    // Target the inner invoice div for a clean PDF without preview shadows
    const element = document.querySelector('.preview-content-container > div');
    if (!element) return;
    setIsGeneratingPDF(true);
    
    try {
      const opt = {
        margin: [10, 10],
        filename: `smart-business-${new Date().getTime()}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
          scale: 3, // High definition
          useCORS: true, 
          letterRendering: true,
          scrollY: 0,
          onclone: (clonedDoc: Document) => {
            // Remove any potential shadows/borders from the preview container for a clean PDF
            const target = clonedDoc.querySelector('.preview-content-container > div') as HTMLElement;
            if (target) {
              target.style.boxShadow = 'none';
              target.style.border = 'none';
              target.style.padding = '0';
              target.style.margin = '0';
            }

            // Force white background for the whole PDF body
            clonedDoc.body.style.background = '#ffffff';
            clonedDoc.body.style.padding = '0';

            const root = clonedDoc.documentElement;
            root.classList.remove('dark');

            const styles = clonedDoc.getElementsByTagName('style');
            for (let i = 0; i < styles.length; i++) {
              styles[i].innerHTML = styles[i].innerHTML.replace(/oklch\(([^)]+)\)/g, (match, p1) => {
                if (p1.includes('0.627 0.265 256') || p1.includes(' 277')) return '#2563eb';
                if (p1.includes('0.6 0.118 184') || p1.includes(' 145')) return '#059669';
                if (p1.includes('0.577 0.245 27') || p1.includes(' 40')) return '#e11d48';
                return '#1e293b'; 
              });
            }
          }
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      // @ts-ignore
      await html2pdf().set(opt).from(element).save();
    } catch (err) {
      console.error("PDF generation failed:", err);
      handleFinalPrint();
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const toggleTheme = () => {
    setTheme(prev => prev === "light" ? "dark" : "light");
  };

  const canAccessTab = (tabId: string) => {
    if (!user) return false;
    if (user.role === 'admin' || user.id === "1") return true; 
    
    // Explicitly handle "pos" which might be mapped from "pos" permission
    if (user.permissions?.includes(tabId)) return true;
    
    return false;
  };

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="flex flex-col items-center"
        >
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-6" />
          <h1 className="text-3xl font-black text-white mb-2 tracking-tight">Smart Business</h1>
          <p className="text-slate-400 font-medium font-bengali">সিস্টেম লোড হচ্ছে, অনুগ্রহ করে অপেক্ষা করুন...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className={cn("min-h-screen transition-colors duration-300", theme === "dark" && "dark")}>
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;700&display=swap');
          
          .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: #e2e8f0;
            border-radius: 10px;
          }
          .dark .custom-scrollbar::-webkit-scrollbar-thumb {
            background: #1e293b;
          }

          @media print {
            .no-print-global {
              display: none !important;
              height: 0 !important;
              overflow: hidden !important;
            }
            #printable-area {
              display: block !important;
              visibility: visible !important;
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              width: 100% !important;
              background: white !important;
            }
            body {
              background: white !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            @page {
              margin: 0;
              size: auto;
            }
          }
        `}
      </style>

      {/* Printable Area (Only visible during print) */}
      <div id="printable-area" className="hidden print:block text-slate-900 bg-white">
        <div dangerouslySetInnerHTML={{ __html: printHtml || "" }} />
      </div>

      {printHtml && (
        <div className="no-print-global fixed inset-0 z-[9999] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white w-full max-w-4xl max-h-[95vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in duration-300 text-slate-900">
            <div className="p-4 sm:p-6 border-b border-slate-100 flex items-center justify-between bg-white">
              <div>
                <h3 className="text-xl font-black tracking-tight text-slate-900">প্রিন্ট প্রিভিউ</h3>
                <p className="hidden sm:block text-xs text-slate-500 font-medium">ডকুমেন্টটি প্রিন্ট করার আগে দেখে নিন</p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={handleDownloadPDF}
                  disabled={isGeneratingPDF}
                  className="bg-blue-600 text-white px-4 sm:px-6 py-2 rounded-xl font-bold font-bengali shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all flex items-center gap-2 disabled:opacity-50 text-xs sm:text-sm"
                >
                  {isGeneratingPDF ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Download size={16} />
                  )}
                  <span>PDF</span>
                </button>
                <button 
                  onClick={handleFinalPrint}
                  className="bg-blue-600 text-white px-4 sm:px-6 py-2 rounded-xl font-bold font-bengali shadow-lg shadow-primary/20 hover:scale-105 transition-all flex items-center gap-2 text-xs sm:text-sm"
                >
                  <Printer size={16} />
                  <span>প্রিন্ট</span>
                </button>
                <button 
                  onClick={() => setPrintHtml(null)}
                  className="bg-slate-100 text-slate-600 p-2 rounded-xl hover:bg-slate-200 transition-all"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-12 bg-slate-100 text-slate-900 preview-content-container" ref={pdfContainerRef}>
              <div dangerouslySetInnerHTML={{ __html: printHtml }} className="mx-auto bg-white p-10" style={{ maxWidth: '800px', minHeight: '1000px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)', border: '1px solid #e2e8f0' }} />
            </div>
          </div>
        </div>
      )}

      {/* Auth Content */}
      <AnimatePresence mode="wait">
        {!user ? (
          <motion.div
            key="login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn("no-print-global min-h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-300 flex items-center justify-center p-4 overflow-hidden relative", theme === "dark" && "dark")}
          >
            <div className="absolute top-0 -left-4 w-96 h-96 bg-blue-400 rounded-full mix-blend-multiply filter blur-[128px] opacity-10 animate-pulse" />
            <div className="absolute bottom-0 -right-4 w-96 h-96 bg-indigo-400 rounded-full mix-blend-multiply filter blur-[128px] opacity-10 animate-pulse delay-700" />
            
            <div className="w-full max-w-md relative z-10">
              <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-white dark:border-slate-800 rounded-[2.5rem] p-8 shadow-2xl shadow-blue-900/5">
                <div className="text-center mb-10">
                  <div className="mb-6 flex justify-center group">
                    {business?.logo ? (
                      <img src={business.logo} alt="Logo" className="h-20 w-auto object-contain group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="h-20 flex items-center justify-center text-blue-600">
                        <Building2 size={48} />
                      </div>
                    )}
                  </div>
                  <h1 className="text-3xl font-black text-slate-900 dark:text-white mb-2 tracking-tight font-bengali">
                    {business?.name || "হিসাব পাতি"}
                  </h1>
                  <p className="text-slate-500 dark:text-slate-400 font-medium font-bengali text-sm">
                    সুব্যবস্থাপনার মাধ্যমে ব্যবসা পরিচালনা করুন
                  </p>
                </div>

                <form onSubmit={handleSignIn} className="space-y-6">
                  {loginError && (
                    <motion.div 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 p-3 rounded-xl text-center text-sm font-bold font-bengali flex flex-col gap-2"
                    >
                      <span>{loginError}</span>
                      {(loginError.includes("পাসওয়ার্ড") || loginError.includes("লগইন সাময়িকভাবে বন্ধ")) && (
                        <button 
                          type="button"
                          onClick={handleForgotPassword}
                          disabled={resetLoading}
                          className="text-xs underline hover:text-rose-700 disabled:opacity-50"
                        >
                          {resetLoading ? "লিংক পাঠানো হচ্ছে..." : "পাসওয়ার্ড রিসেট লিংক পাঠান"}
                        </button>
                      )}
                    </motion.div>
                  )}

                  {resetSuccess && (
                     <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/50 text-emerald-600 dark:text-emerald-400 p-3 rounded-xl text-center text-sm font-bold font-bengali"
                      >
                        {resetSuccess}
                      </motion.div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-600 dark:text-slate-400 ml-1 font-bengali">ইমেইল ঠিকানা</label>
                    <div className="relative group">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors" size={18} />
                      <input
                        type="email"
                        required
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        placeholder="admin@smartbusiness.com"
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl py-3.5 pl-12 pr-4 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 focus:bg-white dark:focus:bg-slate-700 transition-all placeholder:text-slate-400"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-600 dark:text-slate-400 ml-1 font-bengali">পাসওয়ার্ড</label>
                    <div className="relative group">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors" size={18} />
                      <input
                        type="password"
                        required
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl py-3.5 pl-12 pr-4 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 focus:bg-white dark:focus:bg-slate-700 transition-all placeholder:text-slate-400"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loginLoading}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl shadow-xl shadow-blue-200 flex items-center justify-center gap-2 group transition-all relative overflow-hidden disabled:opacity-70"
                  >
                    {loginLoading ? (
                      <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <span className="font-bengali">লগইন করুন</span>
                        <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </button>
                </form>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="app"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={cn("no-print-global flex bg-slate-50 dark:bg-slate-950 h-screen overflow-hidden transition-colors duration-300", theme === "dark" && "dark")}
          >
            <div className="hidden md:flex flex-shrink-0">
              <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} user={user} business={business} />
            </div>
            
            <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
              <Header 
                onLogout={handleLogout} 
                onNewSale={() => setActiveTab("pos")} 
                user={user} 
                theme={theme}
                toggleTheme={toggleTheme}
                business={business}
              />
              
              <main className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 transition-colors duration-300 custom-scrollbar pb-20 md:pb-0">
                <Suspense fallback={<LoadingFallback />}>
                  {activeTab === "dashboard" && canAccessTab("dashboard") && <Dashboard user={user} />}
                  {activeTab === "pos" && canAccessTab("pos") && <POS user={user} />}
                  {activeTab === "sales" && canAccessTab("sales") && <SalesList user={user} />}
                  {activeTab === "products" && canAccessTab("products") && <ProductList user={user} />}
                  {activeTab === "customers" && canAccessTab("customers") && <CustomerList user={user} />}
                  {activeTab === "suppliers" && canAccessTab("suppliers") && <SupplierList user={user} />}
                  {activeTab === "accounting" && canAccessTab("accounting") && <Accounting user={user} />}
                  {activeTab === "reports" && canAccessTab("reports") && <Reports user={user} />}
                  {activeTab === "due" && canAccessTab("due") && <DueManagement user={user} />}
                  {activeTab === "sms" && canAccessTab("sms") && <SMSModule />}
                  {activeTab === "users" && canAccessTab("users") && <UserManagement user={user} />}
                  {activeTab === "settings" && canAccessTab("settings") && <Settings onBusinessUpdate={setBusiness} />}
                  
                  {/* Access Denied View */}
                  {user && !canAccessTab(activeTab) && (
                    <div className="flex flex-col items-center justify-center p-20 text-center space-y-4">
                      <div className="w-20 h-20 bg-rose-50 dark:bg-rose-900/20 text-rose-500 rounded-full flex items-center justify-center">
                         <Lock size={40} />
                      </div>
                      <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 font-bengali">এক্সেস সীমিত (Access Denied)</h2>
                      <p className="text-slate-500 dark:text-slate-400 font-bengali max-w-sm">আপনার এই মডিউলে প্রবেশের অনুমতি নেই। বিস্তারিত জানতে এডমিনের সাথে যোগাযোগ করুন।</p>
                      <button 
                        onClick={() => setActiveTab("dashboard")}
                        className="px-6 py-2 bg-primary text-white rounded-xl font-bold font-bengali"
                      >
                        ড্যাশবোর্ডে ফিরে যান
                      </button>
                    </div>
                  )}
                </Suspense>
              </main>

              <MobileNav activeTab={activeTab} setActiveTab={setActiveTab} user={user} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
