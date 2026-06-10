import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import nodemailer from "nodemailer";
import CryptoJS from "crypto-js";
import dotenv from "dotenv";
import os from "os";
import axios from "axios";
import cron from "node-cron";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

dotenv.config();

// Initialize Firebase Admin
let FIREBASE_PROJECT_ID = "scientific-host-453909-u2";
let FIRESTORE_DATABASE_ID = "ai-studio-45fc14df-81c8-48af-bf9b-fd5472f78b4c";

try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (config.projectId) FIREBASE_PROJECT_ID = config.projectId;
    if (config.firestoreDatabaseId) FIRESTORE_DATABASE_ID = config.firestoreDatabaseId;
    console.log("[Firebase Admin] Config loaded from firebase-applet-config.json:", FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID);
  }
} catch (e: any) {
  console.warn("[Firebase Admin] Failed to load firebase-applet-config.json, using defaults.", e.message);
}

// Initialize firestore lazily to avoid startup crashes
let firestore: any;
let isFirestoreAccessible: boolean = true;

function getFirestoreInstance() {
  if (!isFirestoreAccessible) return null;
  if (firestore) return firestore;
  try {
    if (admin.apps.length === 0) {
      try {
        // Try zero-config initialization first (safest in Cloud Run / AI Studio)
        admin.initializeApp();
        console.log("[Firebase Admin] Initialized with default surroundings.");
      } catch (e) {
        // Fallback to explicit project ID
        admin.initializeApp({
          projectId: FIREBASE_PROJECT_ID
        });
        console.log("[Firebase Admin] Initialized with explicit Project ID:", FIREBASE_PROJECT_ID);
      }
    }
    
    // In Admin SDK v11+, getFirestore() can take a databaseId as a string
    const dbId = FIRESTORE_DATABASE_ID as string;
    if (dbId && dbId !== "(default)") {
       try {
         firestore = getFirestore(dbId);
         console.log("[Firebase Admin] Using specific database instance:", dbId);
       } catch (err: any) {
         console.warn("[Firebase Admin] Could not get specific database instance, falling back to default.", err.message);
         firestore = getFirestore();
       }
    } else {
       firestore = getFirestore();
       console.log("[Firebase Admin] Using default database instance.");
    }
  } catch (e: any) {
    console.error("[Firebase Admin] Fatal Error in getFirestoreInstance:", e.message);
  }
  return firestore;
}

// Handling __dirname and __filename for both ESM and CJS
const isCjs = typeof __filename !== "undefined" && typeof __dirname !== "undefined";
const _filename = isCjs ? __filename : fileURLToPath(import.meta.url);
const _dirname = isCjs ? __dirname : path.dirname(_filename);

const BACKUP_SECRET = "smart-erp-secure-backup-key-@2024";

// Use /tmp for writable state in production (Cloud Run friendly)
// Note: OS/Tmp is always writable, whereas app root might be read-only after deploy
const IS_PROD = process.env.NODE_ENV === "production";
const LAST_BACKUP_PATH = path.join(process.cwd(), "last_backup.txt");
const DB_PATH = path.join(process.cwd(), "db.json");

async function fetchFirestoreBackupData(businessId: string = "main-business"): Promise<any> {
  const firestore = getFirestoreInstance();
  if (!firestore) {
    console.error("[Backup Engine] Firestore not initialized properly.");
    return null;
  }
  console.log(`[Backup Engine] Fetching Firestore data for Business: ${businessId}`);
  const collections = ["products", "customers", "sales", "expenses", "suppliers", "categories", "users", "sms_logs"];
  const allData: any = { 
    version: "2.5-AUTO", 
    timestamp: new Date().toISOString(),
    backupType: "Scheduled Automatic"
  };
  
  try {
    // Fetch Business Settings
    const bizDoc = await firestore.collection("businesses").doc(businessId).get();
    if (bizDoc.exists) {
      allData.business = { id: bizDoc.id, ...bizDoc.data() };
    }

    // Fetch Sub-collections
    for (const colName of collections) {
      console.log(`[Backup Engine] Reading collection: ${colName}`);
      try {
        const snapshot = await firestore.collection("businesses").doc(businessId).collection(colName).get();
        allData[colName] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (colErr: any) {
        console.error(`[Backup Engine] Error reading collection ${colName}: ${colErr.message}`);
        allData[colName] = [];
      }
    }

    // Fetch Supplier Transactions (Nested Sub-collections)
    allData.supplierTransactions = {};
    if (allData.suppliers && Array.isArray(allData.suppliers)) {
      console.log(`[Backup Engine] Fetching transactions for ${allData.suppliers.length} suppliers...`);
      for (const supplier of allData.suppliers) {
        try {
          const transSnapshot = await firestore
            .collection("businesses")
            .doc(businessId)
            .collection("suppliers")
            .doc(supplier.id)
            .collection("transactions")
            .get();
          
          if (!transSnapshot.empty) {
            allData.supplierTransactions[supplier.id] = transSnapshot.docs.map(doc => ({ 
              id: doc.id, 
              ...doc.data() 
            }));
          }
        } catch (transErr: any) {
          console.error(`[Backup Engine] Failed to fetch transactions for supplier ${supplier.id}:`, transErr.message);
        }
      }
    }

    // Fetch customer payments (Nested Sub-collections)
    allData.customerPayments = {};
    if (allData.customers && Array.isArray(allData.customers)) {
      console.log(`[Backup Engine] Fetching payments for ${allData.customers.length} customers...`);
      for (const customer of allData.customers) {
        try {
          const paySnapshot = await firestore
            .collection("businesses")
            .doc(businessId)
            .collection("customers")
            .doc(customer.id)
            .collection("payments")
            .get();
          
          if (!paySnapshot.empty) {
            allData.customerPayments[customer.id] = paySnapshot.docs.map(doc => ({ 
              id: doc.id, 
              ...doc.data() 
            }));
          }
        } catch (payErr: any) {
          console.error(`[Backup Engine] Failed to fetch payments for customer ${customer.id}:`, payErr.message);
        }
      }
    }

    return allData;
  } catch (err: any) {
    console.error(`[Backup Engine] Error fetching from Firestore: ${err.message}`);
    return null;
  }
}

async function sendBackupEmail(email: string, data: any, smtpConfig?: any) {
  if (!email || !email.includes('@')) {
    console.error("[Backup System] Invalid email provided:", email);
    throw new Error("বৈধ ব্যাকআপ ইমেইল ঠিকানা প্রদান করুন।");
  }
  
  const todayStr = new Date().toISOString().split('T')[0];
  const tempPath = path.join(os.tmpdir(), `backup_${todayStr}_${Date.now()}.bak`);
  
  try {
    console.log("[Backup System] Initializing encryption for:", email);
    
    // Encrypt data before sending
    const encrypted = CryptoJS.AES.encrypt(JSON.stringify(data), BACKUP_SECRET).toString();
    const backupPayload = `HISHAB_BAK_V2:${encrypted}`;
    const backupFileName = `backup_${todayStr}.bak`;
    
    // Create a temporary backup file
    fs.writeFileSync(tempPath, backupPayload);
    console.log("[Backup System] Temporary backup file written to disk.");

    // Prioritize DB config over ENV
    let user = (smtpConfig?.user || process.env.SMTP_USER || "").trim();
    let pass = (smtpConfig?.pass || process.env.SMTP_PASS || "").trim();
    const senderName = smtpConfig?.senderName || "Smart Business Backup";

    // Gmail App Passwords should not have spaces
    if (pass.length > 0) {
      pass = pass.replace(/\s/g, '');
    }

    if (!user || !pass) {
      console.error("[SMTP] Credential Error. User:", user ? "Defined" : "Empty", "Pass:", pass ? "Defined" : "Empty");
      throw new Error("SMTP সেটিংস (ইমেইল অথবা অ্যাপ পাসওয়ার্ড) পাওয়া যায়নি। দয়া করে সেটিংস থেকে সেট করুন।");
    }

    console.log("[SMTP] Transporter setup for Gmail Service");
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false
      },
      debug: true,
      logger: true,
      connectionTimeout: 45000,
      greetingTimeout: 45000,
      socketTimeout: 60000
    });

    // Verify connection
    try {
      console.log("[SMTP] Verifying connection with Google Servers...");
      await transporter.verify();
      console.log("[SMTP] Connection verified successfully.");
    } catch (verifyErr: any) {
      console.error("[SMTP Auth Failure Details]:", verifyErr);
      
      let friendlyError = verifyErr.message;
      if (verifyErr.responseCode === 535 || verifyErr.message.includes('535') || verifyErr.message.includes('Invalid login') || verifyErr.message.includes('Username and Password not accepted')) {
        friendlyError = "আপনার জিমেইল বা অ্যাপ পাসওয়ার্ড (App Password) সঠিক নয়। নিশ্চিত করুন আপনার গুগল একাউন্টে ২-স্টেপ ভেরিফিকেশন চালু আছে এবং ১৬ সংখ্যার App Password ব্যবহার করছেন।";
      } else if (verifyErr.code === 'ETIMEDOUT' || verifyErr.code === 'ECONNREFUSED') {
        friendlyError = "গুগল সার্ভারের সাথে কানেক্ট করা যাচ্ছে না (Connection Timeout)। আপনার ইন্টারনেট চেক করে আবার চেষ্টা করুন।";
      } else if (verifyErr.message.includes('ENOTFOUND')) {
        friendlyError = "ইন্টারনেট কানেকশন নেই বা ডিএনএস (DNS) সমস্যা। গুগল সার্ভার খুঁজে পাওয়া যাচ্ছে না।";
      } else {
        friendlyError = `সার্ভার ত্রুটি: ${verifyErr.message}`;
      }
      
      throw new Error(friendlyError);
    }

    console.log("[SMTP] Sending backup email to:", email);
    const nowBN = new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' });
    
    await transporter.sendMail({
      from: `"${senderName}" <${user}>`,
      to: email,
      replyTo: user,
      subject: `হিসাবপাতি বিজনেস ব্যাকআপ ড্যাটা - ${new Date().toLocaleDateString('bn-BD')}`,
      priority: 'high',
      headers: {
        'X-Priority': '1 (Highest)',
        'X-MSMail-Priority': 'High',
        'Importance': 'high'
      },
      text: `প্রিয় গ্রাহক,\n\nআপনার ব্যবসার প্রতিদিনের নিরাপদ ব্যাকআপ ড্যাটা সংযুক্তি হিসেবে পাঠানো হয়েছে।\n\nবিস্তারিত তথ্য:\nতারিখ ও সময়: ${nowBN}\nব্যবসার নাম: ${data.business?.name || 'Smart Business'}\nব্যাকআপ টাইপ: সম্পূর্ণ ডাটাবেস\n\nসতর্কতা: এই ফাইলটি (.bak) উচ্চমাত্রায় এনক্রিপ্ট করা। এটি শুধুমাত্র আপনার হিসাবপাতি অ্যাপের 'Restore' অপশন থেকে ব্যবহার করা যাবে। ফাইলটি কারো সাথে শেয়ার করবেন না।\n\nধন্যবাদ,\nসিস্টেম অটোমেশন টিম`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #0f172a; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 20px;">হিসাবপাতি বিজনেস ব্যাকআপ</h1>
          </div>
          <div style="padding: 25px; color: #1e293b; line-height: 1.6;">
            <p>আপনার ব্যবসার নিরাপদ ড্যাটা ব্যাকআপ ফাইলটি তৈরি করা হয়েছে এবং এই ইমেইলের সাথে সংযুক্ত করা হয়েছে।</p>
            <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 5px 0;"><strong>ব্যবসার নাম:</strong> ${data.business?.name || 'Smart Business'}</p>
              <p style="margin: 5px 0;"><strong>তারিখ ও সময়:</strong> ${nowBN}</p>
              <p style="margin: 5px 0;"><strong>ফাইলের নাম:</strong> ${backupFileName}</p>
            </div>
            <p style="color: #64748b; font-size: 13px; border-left: 4px solid #f59e0b; padding-left: 15px;">
              <strong>সতর্কতা:</strong> এই ফাইলটি (.bak) এনক্রিপ্ট করা। এটি ডিক্রিপ্ট করার জন্য শুধুমাত্র আপনার হিসাবপাতি অ্যাপের 'Restore' ফাংশনটি ব্যবহার করুন।
            </p>
          </div>
          <div style="background-color: #f1f5f9; padding: 15px; text-align: center; color: #94a3b8; font-size: 11px;">
            এটি একটি সিস্টেম জেনারেটেড ইমেইল। দয়া করে এখানে রিপ্লাই করবেন না।
          </div>
        </div>
      `,
      attachments: [{
        filename: backupFileName,
        path: tempPath,
        contentType: 'application/octet-stream'
      }]
    });

    console.log("[Backup System] Email sent successfully!");
  } catch (err: any) {
    console.error("[Backup System] Critical Error:", err.message);
    throw err;
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
        console.log("[Backup System] Temp file cleaned up.");
      } catch (cleanupErr) {
        console.warn("[Backup System] Failed to cleanup temp file:", cleanupErr);
      }
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Mock Database File - Defined globally above for Cloud Run compatibility
  
  const initialData = {
    users: [
      { 
        id: "1", 
        name: "মোঃ মমিন আলী", 
        email: "mominkhan051220@gmail.com", 
        phone: "01741456838", 
        password: "momin123", 
        role: "admin", 
        lastSeen: new Date().toISOString() 
      }
    ],
    products: [
      { id: "p1", name: "Classic Polo Shirt", bnName: "ক্লাসিক পোলো শার্ট", sku: "POLO-001", barcode: "12345678", categoryId: "c1", brandId: "b1", unit: "pcs", purchasePrice: 350, salePrice: 550, stock: 45, minStock: 10 },
      { id: "p2", name: "Denim Jeans", bnName: "ডেনিম জিন্স", sku: "JEAN-002", barcode: "87654321", categoryId: "c2", brandId: "b2", unit: "pcs", purchasePrice: 800, salePrice: 1200, stock: 20, minStock: 5 },
      { id: "p3", name: "Leather Wallet", bnName: "লেদার ওয়ালেট", sku: "WAL-003", barcode: "11223344", categoryId: "c1", brandId: "b1", unit: "pcs", purchasePrice: 400, salePrice: 750, stock: 8, minStock: 10 },
      { id: "p4", name: "Laptop Backpack", bnName: "ল্যাপটপ ব্যাকপ্যাক", sku: "BAG-004", barcode: "44332211", categoryId: "c3", unit: "pcs", purchasePrice: 1200, salePrice: 1800, stock: 15, minStock: 5 },
      { id: "p5", name: "Casual Sneakers", bnName: "ক্যাজুয়াল স্নিকার্স", sku: "SHO-005", barcode: "55667788", categoryId: "c4", unit: "pcs", purchasePrice: 1500, salePrice: 2200, stock: 10, minStock: 3 }
    ],
    categories: [
      { id: "c1", name: "শার্ট" },
      { id: "c2", name: "প্যান্ট" },
      { id: "c3", name: "ব্যাগ" },
      { id: "c4", name: "জুতা" }
    ],
    customers: [
      { id: "cust1", name: "Rahim Ahmed", phone: "01812345678", dueAmount: 500, totalSpent: 2500 }
    ],
    suppliers: [
      { id: "sup1", name: "Fashion Wholesale Ltd", phone: "01911223344", address: "Dhaka, Bangladesh", dueAmount: 12000 }
    ],
    sales: [
      { id: "s1", invoiceNo: "INV-1001", customerId: "cust1", userId: "1", totalAmount: 1500, discount: 0, vat: 75, payableAmount: 1575, paidAmount: 1575, dueAmount: 0, paymentMethod: "cash", createdAt: new Date(Date.now() - 86400000).toISOString(), items: [] }
    ],
    expenses: [
      { id: "e1", category: "Rent", amount: 5000, note: "Shop rent for May", date: new Date().toISOString(), userId: "1" },
      { id: "e2", category: "Electricity", amount: 1200, note: "Electric bill", date: new Date().toISOString(), userId: "1" }
    ],
    transactions: [],
    smsLogs: [],
    smsConfig: { apiKey: "", senderId: "", provider: "Default" },
    business: {
      id: "b1",
      name: "আমার শপ",
      address: "ঢাকা, বাংলাদেশ",
      phone: "01700000000",
      currency: "BDT",
      logo: "",
      backupEmail: "",
      smtpConfig: {
        user: "",
        pass: "",
        senderName: "Smart Business Backup"
      }
    }
  };

  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2));
  }

  const getDB = (): any => {
    try {
      if (!fs.existsSync(DB_PATH)) return initialData;
      const content = fs.readFileSync(DB_PATH, "utf-8");
      if (!content || !content.trim()) return initialData;
      
      try {
        const data = JSON.parse(content);
        return {
          users: (data.users && data.users.length > 0) ? data.users : initialData.users,
          products: data.products || [],
          categories: data.categories || [],
          customers: data.customers || [],
          suppliers: data.suppliers || [],
          sales: data.sales || [],
          expenses: data.expenses || [],
          transactions: data.transactions || [],
          smsLogs: data.smsLogs || [],
          smsConfig: data.smsConfig || initialData.smsConfig,
          business: data.business || initialData.business
        };
      } catch (parseError) {
        console.error("Critical: db.json is corrupted. Using initial data.", parseError);
        return initialData;
      }
    } catch (e) {
      console.error("Database Read Error:", e);
      return initialData;
    }
  };
  const saveDB = (data: any) => {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error("Database Write Error:", e);
    }
  };

  // --- API Routes ---
  
  // Database Backup & Restore
  app.get("/api/db/all", (req, res) => {
    res.json(getDB());
  });

  app.post("/api/db/restore", (req, res) => {
    try {
      const newData = req.body;
      console.log("[Restore] Received restore request. Keys present:", Object.keys(newData));

      if (!newData.users || !newData.products || !newData.business) {
        console.warn("[Restore] Rejecting: Missing required entity collections");
        return res.status(400).json({ error: "ফাইলটি সঠিক ফরম্যাটে নেই (Missing collections)" });
      }

      saveDB(newData);
      
      const summary = {
        users: newData.users?.length || 0,
        products: newData.products?.length || 0,
        sales: newData.sales?.length || 0,
        businessName: newData.business?.name
      };

      console.log("[Restore] Database successfully overwritten. Summary:", summary);
      res.json({ 
        success: true, 
        message: "Database restored successfully",
        summary
      });
    } catch (e) {
      console.error("[Restore] Error during restoration:", e);
      res.status(500).json({ error: "সার্ভারে ড্যাটা রিস্টোর করতে ব্যর্থ হয়েছে" });
    }
  });

  // Dashboard Stats
  app.get("/api/dashboard/stats", (req, res) => {
    const db = getDB();
    const today = new Date().toISOString().split('T')[0];
    const todaySales = db.sales
      .filter((s:any) => s.createdAt.startsWith(today))
      .reduce((acc:number, s:any) => acc + s.totalAmount, 0);
    
    const monthlyTotal = db.sales.reduce((acc:number, s:any) => acc + s.totalAmount, 0);
    const totalExpense = db.expenses.reduce((acc:number, e:any) => acc + e.amount, 0);

    res.json({
      todaySales,
      monthlySales: monthlyTotal,
      totalProfit: (monthlyTotal * 0.3) - totalExpense, // Mock profit calc
      totalDue: db.customers.reduce((acc:number, c:any) => acc + c.dueAmount, 0),
      totalExpense,
      totalProducts: db.products.length,
      lowStockCount: db.products.filter((p:any) => p.stock <= p.minStock).length,
      recentSales: db.sales.slice(-5).reverse()
    });
  });

  // Analytics Reports
  app.get("/api/reports/sales-by-date", (req, res) => {
    const db = getDB();
    const salesByDate: Record<string, number> = {};
    
    // Last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    db.sales.forEach((sale: any) => {
      const date = sale.createdAt.split('T')[0];
      if (new Date(date) >= thirtyDaysAgo) {
        salesByDate[date] = (salesByDate[date] || 0) + sale.payableAmount;
      }
    });

    res.json(Object.entries(salesByDate).map(([date, amount]) => ({ date, amount })));
  });

  app.get("/api/reports/expense-by-category", (req, res) => {
    const db = getDB();
    const expenseByCat: Record<string, number> = {};
    
    db.expenses.forEach((exp: any) => {
      expenseByCat[exp.category] = (expenseByCat[exp.category] || 0) + exp.amount;
    });

    res.json(Object.entries(expenseByCat).map(([category, amount]) => ({ category, amount })));
  });

  // Users
  app.get("/api/users", (req, res) => {
    res.json(getDB().users);
  });

  app.post("/api/users", (req, res) => {
    const db = getDB();
    const user = {
      ...req.body,
      id: "u" + Date.now(),
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    saveDB(db);
    res.json(user);
  });

  app.put("/api/users/:id", (req, res) => {
    const db = getDB();
    const { id } = req.params;
    const index = db.users.findIndex((u: any) => u.id === id);
    if (index === -1) return res.status(404).json({ error: "User not found" });
    
    db.users[index] = { ...db.users[index], ...req.body };
    saveDB(db);
    res.json(db.users[index]);
  });

  app.delete("/api/users/:id", (req, res) => {
    const db = getDB();
    const { id } = req.params;
    const index = db.users.findIndex((u: any) => u.id === id);
    if (index === -1) return res.status(404).json({ error: "User not found" });
    
    // Prevent deleting the main admin
    if (id === "1") return res.status(403).json({ error: "Cannot delete main admin" });

    db.users.splice(index, 1);
    saveDB(db);
    res.json({ success: true });
  });

  app.post("/api/users/change-password", (req, res) => {
    const { currentPassword, newPassword } = req.body;
    // In a real app, we'd verify the current password. 
    // Here we just simulate success.
    res.json({ success: true, message: "Password updated successfully" });
  });

  // Products
  app.get("/api/products", (req, res) => {
    res.json(getDB().products);
  });

  app.post("/api/products", (req, res) => {
    const db = getDB();
    const product = {
      ...req.body,
      id: "p" + Date.now(),
    };
    db.products.push(product);
    saveDB(db);
    res.json(product);
  });

  app.put("/api/products/:id", (req, res) => {
    const db = getDB();
    const { id } = req.params;
    const index = db.products.findIndex((p: any) => p.id === id);
    if (index === -1) return res.status(404).json({ error: "Product not found" });
    
    db.products[index] = { ...db.products[index], ...req.body };
    saveDB(db);
    res.json(db.products[index]);
  });

  app.delete("/api/products/:id", (req, res) => {
    const db = getDB();
    const { id } = req.params;
    const index = db.products.findIndex((p: any) => p.id === id);
    if (index === -1) return res.status(404).json({ error: "Product not found" });
    
    db.products.splice(index, 1);
    saveDB(db);
    res.json({ success: true });
  });

  // Categories
  app.get("/api/categories", (req, res) => {
    res.json(getDB().categories);
  });

  app.post("/api/categories", (req, res) => {
    const db = getDB();
    const category = {
      ...req.body,
      id: "c" + Date.now(),
    };
    db.categories.push(category);
    saveDB(db);
    res.json(category);
  });

  // Sales
  app.get("/api/sales", (req, res) => {
    const db = getDB();
    const salesWithCustomers = db.sales.map((sale: any) => {
      const customer = db.customers.find((c: any) => c.id === sale.customerId);
      return {
        ...sale,
        customerName: customer ? customer.name : "Unknown Customer",
        customerPhone: customer ? customer.phone : undefined,
        customerAddress: customer ? customer.address : undefined
      };
    });
    res.json(salesWithCustomers);
  });

  app.post("/api/sales", (req, res) => {
    const db = getDB();
    const sale = {
      ...req.body,
      id: "sale_" + Date.now(),
      invoiceNo: "INV-" + (db.sales.length + 1001),
      createdAt: new Date().toISOString()
    };

    // Update stock
    sale.items.forEach((item: any) => {
      const product = db.products.find((p: any) => p.id === item.productId);
      if (product) {
        product.stock -= item.quantity;
        if (item.scannedBarcodes && Array.isArray(item.scannedBarcodes)) {
           product.barcodes = (product.barcodes || []).filter((b: string) => !item.scannedBarcodes.includes(b));
        }
      }
    });

    // Update customer due if any
    const customer = db.customers.find((c: any) => c.id === sale.customerId);
    if (customer) {
      sale.customerName = customer.name;
      sale.customerPhone = customer.phone;
      sale.customerAddress = customer.address;
      customer.dueAmount += sale.dueAmount;
      customer.totalSpent += sale.payableAmount;
    }

    db.sales.push(sale);
    saveDB(db);
    res.json(sale);
  });

  app.delete("/api/sales/:id", (req, res) => {
    const db = getDB();
    const { id } = req.params;
    
    if (!id) return res.status(400).json({ error: "ID is required" });

    // Find absolute index to be sure
    const saleIndex = db.sales.findIndex((s: any) => String(s.id) === String(id));

    if (saleIndex === -1) {
      return res.status(404).json({ error: "Sale not found" });
    }

    const sale = db.sales[saleIndex];

    // Restore stock
    try {
      if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach((item: any) => {
          const product = db.products.find((p: any) => String(p.id) === String(item.productId));
          if (product) {
            product.stock = Number(product.stock || 0) + Number(item.quantity || 0);
            if (item.scannedBarcodes && Array.isArray(item.scannedBarcodes)) {
              product.barcodes = Array.from(new Set([...(product.barcodes || []), ...item.scannedBarcodes]));
            }
          }
        });
      }
    } catch (err) {
      console.error("Error restoring stock:", err);
    }

    // Update customer balances
    try {
      if (sale.customerId) {
        const customer = db.customers.find((c: any) => String(c.id) === String(sale.customerId));
        if (customer) {
          customer.dueAmount = Math.max(0, Number(customer.dueAmount || 0) - Number(sale.dueAmount || 0));
          customer.totalSpent = Math.max(0, Number(customer.totalSpent || 0) - Number(sale.payableAmount || 0));
        }
      }
    } catch (err) {
      console.error("Error updating customer balance:", err);
    }

    db.sales.splice(saleIndex, 1);
    saveDB(db);
    res.json({ success: true, message: "Sale deleted and stock updated" });
  });

  // Customers
  app.get("/api/customers", (req, res) => {
    res.json(getDB().customers);
  });

  app.post("/api/customers", (req, res) => {
    const db = getDB();
    const customer = {
      ...req.body,
      id: "c" + Date.now(),
      createdAt: new Date().toISOString(),
    };
    db.customers.push(customer);
    saveDB(db);
    res.json(customer);
  });

  app.put("/api/customers/:id", (req, res) => {
    const db = getDB();
    const { id } = req.params;
    const index = db.customers.findIndex((c: any) => c.id === id);
    if (index === -1) return res.status(404).json({ error: "Customer not found" });
    
    db.customers[index] = { ...db.customers[index], ...req.body };
    saveDB(db);
    res.json(db.customers[index]);
  });

  app.delete("/api/customers/:id", (req, res) => {
    const db = getDB();
    const { id } = req.params;
    const index = db.customers.findIndex((c: any) => c.id === id);
    if (index === -1) return res.status(404).json({ error: "Customer not found" });
    
    db.customers.splice(index, 1);
    saveDB(db);
    res.json({ success: true });
  });

  // Suppliers
  app.get("/api/suppliers", (req, res) => {
    res.json(getDB().suppliers);
  });

  app.post("/api/suppliers", (req, res) => {
    const db = getDB();
    const supplier = {
      ...req.body,
      id: "s" + Date.now(),
      createdAt: new Date().toISOString(),
    };
    db.suppliers.push(supplier);
    saveDB(db);
    res.json(supplier);
  });

  app.put("/api/suppliers/:id", (req, res) => {
    const db = getDB();
    const { id } = req.params;
    const index = db.suppliers.findIndex((s: any) => s.id === id);
    if (index === -1) return res.status(404).json({ error: "Supplier not found" });
    
    db.suppliers[index] = { ...db.suppliers[index], ...req.body };
    saveDB(db);
    res.json(db.suppliers[index]);
  });

  app.delete("/api/suppliers/:id", (req, res) => {
    const db = getDB();
    const { id } = req.params;
    const index = db.suppliers.findIndex((s: any) => s.id === id);
    if (index === -1) return res.status(404).json({ error: "Supplier not found" });
    
    db.suppliers.splice(index, 1);
    saveDB(db);
    res.json({ success: true });
  });

  // Supplier Transactions & Payments
  app.get("/api/suppliers/:id/transactions", (req, res) => {
    const db = getDB();
    const { id } = req.params;
    const transactions = (db.transactions || []).filter((t: any) => t.supplierId === id);
    res.json(transactions);
  });

  app.post("/api/suppliers/:id/payments", (req, res) => {
    const db = getDB();
    const { id } = req.params;
    const { amount, description } = req.body;
    
    const index = db.suppliers.findIndex((s: any) => s.id === id);
    if (index === -1) return res.status(404).json({ error: "Supplier not found" });
    
    const payment = {
      id: "t" + Date.now(),
      supplierId: id,
      type: "payment",
      amount: Number(amount),
      description: description || "বকেয়া পরিশোধ",
      date: new Date().toISOString()
    };
    
    if (!db.transactions) db.transactions = [];
    db.transactions.push(payment);
    
    // Update supplier due amount
    db.suppliers[index].dueAmount -= Number(amount);
    
    saveDB(db);
    res.json(payment);
  });

  // SMS logs
  app.get("/api/sms/logs", (req, res) => {
    res.json(getDB().smsLogs || []);
  });

  app.post("/api/sms/send", (req, res) => {
    const db = getDB();
    const { recipient, message } = req.body;
    
    // Simulate sending SMS
    const log = {
      id: "sms" + Date.now(),
      recipient,
      message,
      status: "sent",
      createdAt: new Date().toISOString(),
    };
    
    if (!db.smsLogs) db.smsLogs = [];
    db.smsLogs.unshift(log);
    saveDB(db);
    res.json(log);
  });

  app.get("/api/sms/config", (req, res) => {
    res.json(getDB().smsConfig || { apiKey: "", senderId: "", provider: "Default" });
  });

  app.put("/api/sms/config", (req, res) => {
    const db = getDB();
    db.smsConfig = req.body;
    saveDB(db);
    res.json(db.smsConfig);
  });

  // SMS Proxy to avoid CORS
  app.get("/api/sms/proxy", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: "URL is required" });
    }
    
    try {
      console.log("[SMS Proxy] Forwarding request to:", url);
      const response = await axios.get(url, { 
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      console.log("[SMS Proxy] Remote Response:", response.status, response.data);
      res.json(response.data);
    } catch (err: any) {
      const statusCode = err.response?.status || 500;
      const errorMsg = err.response?.data || err.message;
      console.error(`[SMS Proxy] Error ${statusCode}:`, errorMsg);
      res.status(statusCode).json({ 
        error: errorMsg,
        status: statusCode,
        urlSent: url 
      });
    }
  });

  // Business Settings
  app.get("/api/business", (req, res) => {
    res.json(getDB().business);
  });

  app.put("/api/business", (req, res) => {
    const db = getDB();
    console.log("[Business API] Updating settings. Email:", req.body.backupEmail);
    if (req.body.smtpConfig) {
      console.log("[Business API] SMTP Config present. User:", req.body.smtpConfig.user);
    }
    db.business = { ...db.business, ...req.body };
    saveDB(db);
    res.json(db.business);
  });

  // Expenses
  app.get("/api/expenses", (req, res) => {
    res.json(getDB().expenses);
  });

  app.post("/api/expenses", (req, res) => {
    const db = getDB();
    const expense = {
      ...req.body,
      id: "e" + Date.now(),
      createdAt: new Date().toISOString(),
    };
    db.expenses.push(expense);
    saveDB(db);
    res.json(expense);
  });

  app.put("/api/expenses/:id", (req, res) => {
    const db = getDB();
    const { id } = req.params;
    const index = db.expenses.findIndex((e: any) => e.id === id);
    if (index === -1) return res.status(404).json({ error: "Expense not found" });
    
    db.expenses[index] = { ...db.expenses[index], ...req.body };
    saveDB(db);
    res.json(db.expenses[index]);
  });

  app.delete("/api/expenses/:id", (req, res) => {
    const db = getDB();
    const { id } = req.params;
    const index = db.expenses.findIndex((e: any) => e.id === id);
    if (index === -1) return res.status(404).json({ error: "Expense not found" });
    
    db.expenses.splice(index, 1);
    saveDB(db);
    res.json({ success: true });
  });

  // Payments
  app.post("/api/customers/:id/payment", (req, res) => {
    const db = getDB();
    const { id } = req.params;
    const { amount, method } = req.body;
    const numAmount = Number(amount);

    const customer = db.customers.find((c: any) => c.id === id);
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    if (isNaN(numAmount) || numAmount <= 0) return res.status(400).json({ error: "Invalid amount" });

    // Update customer due
    customer.dueAmount = Math.max(0, Number(customer.dueAmount || 0) - numAmount);
    
    // Log transaction (Optional: would go to a ledger in a full implementation)
    const transaction = {
      id: "tr_" + Date.now(),
      customerId: id,
      amount: numAmount,
      method,
      date: new Date().toISOString(),
      type: "due_payment"
    };
    
    if (!db.transactions) db.transactions = [];
    db.transactions.push(transaction);

    saveDB(db);
    res.json({ success: true, newDue: customer.dueAmount });
  });

  // Get last backup status
  app.get("/api/backup/status", (req, res) => {
    if (fs.existsSync(LAST_BACKUP_PATH)) {
      const lastTime = fs.readFileSync(LAST_BACKUP_PATH, "utf-8").trim();
      res.json({ lastBackupAt: lastTime });
    } else {
      res.json({ lastBackupAt: null });
    }
  });

  // Manual Trigger Backup
  app.post("/api/backup/trigger", async (req, res) => {
    try {
      const db = getDB();
      const email = db.business?.backupEmail;
      if (!email) return res.status(400).json({ error: "ব্যাকআপ ইমেইল সেট করা নেই" });
      
      await sendBackupEmail(email, db, db.business?.smtpConfig);
      const now = new Date().toISOString();
      fs.writeFileSync(LAST_BACKUP_PATH, now);
      
      res.json({ success: true, message: "ব্যাকআপ ইমেইল পাঠানো হয়েছে", lastBackupAt: now });
    } catch (e: any) {
      console.error("[Backup API] Error:", e.message);
      res.status(500).json({ error: `ইমেইল পাঠাতে ব্যর্থ হয়েছে: ${e.message}` });
    }
  });

  // Trigger Email Backup with Data
  app.post("/api/backup/email", async (req, res) => {
    try {
      const { data, email, smtpConfig } = req.body;
      if (!email) return res.status(400).json({ error: "ইমেইল প্রদান করা হয়নি" });
      
      await sendBackupEmail(email, data, smtpConfig);
      res.json({ success: true, message: "ব্যাকআপ ইমেইল পাঠানো হয়েছে" });
    } catch (e: any) {
      console.error("[Backup API] Error:", e.message);
      res.status(500).json({ error: `ইমেইল পাঠাতে ব্যর্থ হয়েছে: ${e.message}` });
    }
  });

  // Clear Data Route (for testing restore) - FIRESTORE ONLY
  app.post("/api/debug/clear-all-data", async (req, res) => {
    const firestore = getFirestoreInstance();
    if (!firestore) {
      console.error("[DEBUG] Clear failed: Firestore instance is null");
      return res.status(500).json({ error: "ফায়ারস্টোর ডাটাবেস পাওয়া যায়নি" });
    }
    const { businessId } = req.body;
    if (!businessId) {
       console.error("[DEBUG] Clear failed: businessId is missing in request body");
       return res.status(400).json({ error: "বিজনেস আইডি পওয়া যায়নি" });
    }

    const report: string[] = [];
    const errors: string[] = [];

    try {
      console.log(`[DEBUG] !!! FULL WIPE STARTING for business: ${businessId} !!!`);
      const collections = ["products", "customers", "sales", "expenses", "categories", "suppliers", "sms_logs"];
      const businessRef = firestore.collection("businesses").doc(businessId);

      // Check if firestore is truly reachable
      try {
        // Just a simple ping to see if we can talk to the database
        await firestore.listCollections(); 
        console.log("[DEBUG] Firestore connection verified.");
      } catch (connErr: any) {
        console.error("[DEBUG] Firestore connection test failed:", connErr.message);
        return res.status(500).json({ 
          error: "ফায়ারস্টোর ডাটাবেসে কানেক্ট করা যাচ্ছে না",
          details: connErr.message,
          database: FIRESTORE_DATABASE_ID
        });
      }

      for (const colName of collections) {
        try {
          console.log(`[DEBUG] Wiping collection: ${colName}`);
          const colRef = businessRef.collection(colName);
          const snapshot = await colRef.get();
          
          if (snapshot.empty) {
            console.log(`[DEBUG] Collection ${colName} is already empty.`);
            report.push(`${colName}: empty`);
            continue;
          }

          console.log(`[DEBUG] Found ${snapshot.size} documents in ${colName}`);

          // Helper for batching deletions in subcollections
          const wipeSubcollection = async (docRef: any, subColName: string) => {
            try {
              const subSnap = await docRef.collection(subColName).get();
              if (subSnap.empty) return;
              
              console.log(`[DEBUG] Deleting ${subSnap.size} docs from nested ${subColName}`);
              const bSize = 500;
              for (let i = 0; i < subSnap.docs.length; i += bSize) {
                const b = firestore.batch();
                subSnap.docs.slice(i, i + bSize).forEach((p: any) => b.delete(p.ref));
                await b.commit();
              }
            } catch (subErr: any) {
              console.error(`[DEBUG] Failed to wipe subcollection ${subColName}:`, subErr.message);
            }
          };

          // Handle Nested Sub-collections first for specific collections
          for (const doc of snapshot.docs) {
            if (colName === 'customers') {
                await wipeSubcollection(doc.ref, 'payments');
            }
            if (colName === 'suppliers') {
                await wipeSubcollection(doc.ref, 'transactions');
            }
          }

          // Now delete main collection docs
          const batchSize = 500;
          for (let i = 0; i < snapshot.docs.length; i += batchSize) {
            const batch = firestore.batch();
            snapshot.docs.slice(i, i + batchSize).forEach((doc: any) => {
              batch.delete(doc.ref);
            });
            await batch.commit();
          }
          console.log(`[DEBUG] Successfully wiped ${colName}`);
          report.push(`${colName}: wiped ${snapshot.size}`);
        } catch (colErr: any) {
          console.error(`[DEBUG] Error wiping ${colName}:`, colErr.message);
          errors.push(`${colName}: ${colErr.message}`);
        }
      }
      
      // Also clear db.json items if they exist
      try {
        console.log("[DEBUG] Wiping local db.json data...");
        const db = getDB();
        db.products = [];
        db.customers = [];
        db.sales = [];
        db.expenses = [];
        db.suppliers = [];
        db.transactions = [];
        db.smsLogs = [];
        if (db.categories) db.categories = [];
        saveDB(db);
        report.push("local_db: wiped");
      } catch (dbErr: any) {
        console.error("[DEBUG] Local DB wipe failed:", dbErr.message);
        errors.push(`local_db: ${dbErr.message}`);
      }

      console.log("[DEBUG] Wipe process finished for", businessId);
      res.json({ 
        success: errors.length === 0, 
        message: errors.length === 0 ? "সকল ডাটা সফলভাবে মুছে ফেলা হয়েছে।" : "কিছু ডাটা মুছতে সমস্যা হয়েছে।",
        report,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (err: any) {
      console.error("[DEBUG] Clear data process CRASHED:", err.message);
      res.status(500).json({ error: `ডাটা মুছতে গিয়ে সার্ভার ক্রাশ করেছে: ${err.message}` });
    }
  });

  // Vite setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Improved Automated Backup Scheduler using node-cron
    // Runs twice daily at 12:00 AM and 12:00 PM (Dhaka Time)
    cron.schedule('0 0,12 * * *', async () => {
      if (!isFirestoreAccessible) {
        console.log("[Scheduler] Firestore is disabled or inaccessible. Skipping scheduled Firestore backup.");
        return;
      }
      const firestore = getFirestoreInstance();
      if (!firestore) return;
      const nowDhaka = new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' });
      console.log(`[Scheduler] [${nowDhaka}] Starting automatic semi-daily backup process...`);
      
      try {
        const businessesSnapshot = await firestore.collection("businesses").get();
        if (businessesSnapshot.empty) {
          console.warn("[Scheduler] No businesses found in Firestore. Skipping backup.");
          return;
        }

        console.log(`[Scheduler] Found ${businessesSnapshot.size} businesses to process.`);

        for (const bizDoc of businessesSnapshot.docs) {
          const biz = { id: bizDoc.id, ...bizDoc.data() } as any;
          const email = biz.backupEmail;
          
          if (email && email.includes('@')) {
            console.log(`[Scheduler] Processing Business: ${biz.name || biz.id} -> ${email}`);
            
            // 1. Fetch real Firestore Data
            const firestoreData = await fetchFirestoreBackupData(biz.id);
            if (!firestoreData) {
              console.error(`[Scheduler] Could not fetch data for ${biz.id}, skipping email.`);
              continue;
            }

            try {
              // 2. Send Email
              await sendBackupEmail(email, firestoreData, biz.smtpConfig);
              
              // 3. Update status locally
              const now = new Date().toISOString();
              fs.writeFileSync(LAST_BACKUP_PATH, now);
              console.log(`[Scheduler] Automatic backup sent successfully for ${biz.id}`);
            } catch (err: any) {
              console.error(`[Scheduler] Email failed for ${biz.id}:`, err.message);
            }
          } else {
             console.log(`[Scheduler] Business ${biz.id} has no backup email set. Skipping.`);
          }
        }
      } catch (globalErr: any) {
        if (
          globalErr.message.includes("API has not been used") || 
          globalErr.message.includes("disabled") || 
          globalErr.message.includes("PERMISSION_DENIED") ||
          globalErr.code === 7
        ) {
          isFirestoreAccessible = false;
          console.log("[Scheduler] Firestore API is disabled or inaccessible. Disabled automatic Firestore sync backups.");
        } else {
          console.error("[Scheduler] Global backup loop error:", globalErr.message);
        }
      }
    }, {
      timezone: "Asia/Dhaka"
    });

    // Also run a check on startup to ensure we didn't miss today's backup
    const runMissedBackupCheck = async () => {
      if (!isFirestoreAccessible) return;
      try {
        const firestore = getFirestoreInstance();
        if (!firestore) return;
        const businessesSnapshot = await firestore.collection("businesses").get();
        if (businessesSnapshot.empty) return;

        const today = new Date().toISOString().split('T')[0];
        let lastBackupAt = "";
        if (fs.existsSync(LAST_BACKUP_PATH)) {
          lastBackupAt = fs.readFileSync(LAST_BACKUP_PATH, "utf-8").trim();
        }
        const lastBackupDay = lastBackupAt.split('T')[0];

        if (lastBackupDay !== today) {
          console.log("[Scheduler] Missed daily backup check triggered at server startup...");
          for (const bizDoc of businessesSnapshot.docs) {
            const biz = { id: bizDoc.id, ...bizDoc.data() } as any;
            if (biz.backupEmail && biz.backupEmail.includes('@')) {
              const data = await fetchFirestoreBackupData(biz.id);
              if (data) {
                await sendBackupEmail(biz.backupEmail, data, biz.smtpConfig);
                fs.writeFileSync(LAST_BACKUP_PATH, new Date().toISOString());
                console.log(`[Scheduler] Missed backup caught up for ${biz.id}`);
              }
            }
          }
        }
      } catch (err: any) {
        if (
          err.message.includes("API has not been used") || 
          err.message.includes("disabled") || 
          err.message.includes("PERMISSION_DENIED") ||
          err.code === 7
        ) {
          isFirestoreAccessible = false;
          console.log("[Scheduler] Firestore API is disabled or inaccessible in this project. Bypassing missed daily backup check.");
        } else {
          console.error("[Scheduler] Missed daily backup check failed:", err.message);
        }
      }
    };

    runMissedBackupCheck();
  });
}

startServer();
