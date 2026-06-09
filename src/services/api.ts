import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  serverTimestamp,
  limit,
  Timestamp,
  increment,
  writeBatch,
  arrayUnion,
  arrayRemove
} from "firebase/firestore";
import { auth, db, handleFirestoreError, OperationType } from "../lib/firebase";

import { 
  Product, 
  Customer, 
  Sale, 
  DashboardStats, 
  Supplier, 
  SupplierTransaction, 
  SMSLog, 
  SMSConfig, 
  User, 
  Business 
} from "../types";

// Business ID persistence
const STORAGE_KEY = "smart_business_user";
const getStoredBusinessId = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored).businessId : "main-business";
  } catch (e) {
    return "main-business";
  }
};

let currentBusinessId: string = getStoredBusinessId();

export const setApiBusinessId = (id: string | null) => {
  if (id) currentBusinessId = id;
};

// Helper to get collection with business scope
const getScopedCollection = (name: string) => {
  return collection(db, "businesses", currentBusinessId, name);
};

// Helper to clean data for Firestore (remove undefined)
const cleanData = (obj: any): any => {
  if (Array.isArray(obj)) {
    return obj.map(item => typeof item === 'object' && item !== null ? cleanData(item) : (item === undefined ? null : item));
  }
  const result: any = {};
  Object.keys(obj).forEach(key => {
    if (obj[key] !== undefined) {
      if (typeof obj[key] === 'object' && obj[key] !== null && !(obj[key] instanceof Timestamp)) {
        result[key] = cleanData(obj[key]);
      } else {
        result[key] = obj[key];
      }
    }
  });
  return result;
};

let useRestFallback = false;

// Helper to handle offline/connection/permission fallback
const runWithFallback = async <T>(firestoreAction: () => Promise<T>, restAction: () => Promise<T>): Promise<T> => {
  if (useRestFallback) {
    try {
      return await restAction();
    } catch (restErr) {
      console.error("REST fallback also failed:", restErr);
      throw restErr;
    }
  }

  try {
    return await firestoreAction();
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    if (
      errMsg.includes("offline") || 
      errMsg.includes("unavailable") || 
      errMsg.includes("failed-precondition") || 
      errMsg.includes("permission-denied") ||
      errMsg.includes("Permissions") ||
      errMsg.includes("Missing or insufficient permissions")
    ) {
      console.warn("[Firestore Bypass] Firestore error encountered. Switching to fallback REST API:", errMsg);
      useRestFallback = true;
      try {
        return await restAction();
      } catch (restErr) {
        console.error("REST fallback failed:", restErr);
        throw err; // throw original firestore error to keep trace if both fail
      }
    }
    throw err;
  }
};

export const api = {
  getDashboardStats: async (user?: User | null): Promise<DashboardStats> => {
    return runWithFallback(
      async () => {
        const products = await api.getProducts();
        const allSales = await api.getSales();
        const allCustomers = await api.getCustomers();
        const allExpenses = await api.getExpenses();

        const isAdmin = !user || user.role === 'admin' || user.id === "1";
        
        const sales = isAdmin ? allSales : allSales.filter(s => s.userId === user.id || s.createdBy === user.id);
        const customers = isAdmin ? allCustomers : allCustomers.filter(c => c.createdBy === user.id);
        const expenses = isAdmin ? allExpenses : allExpenses.filter(e => e.userId === user.id);

        const today = new Date().toISOString().split("T")[0];
        const todaySales = sales
          .filter(s => s.createdAt && s.createdAt.startsWith(today))
          .reduce((sum, s) => sum + s.totalAmount, 0);
        
        const totalDue = customers.reduce((sum, c) => sum + (c.dueAmount || 0), 0);
        const totalExpense = expenses.reduce((sum, e) => sum + e.amount, 0);

        const now = new Date();
        const expiryThreshold = new Date();
        expiryThreshold.setDate(now.getDate() + 5);

        const expiredProductCount = products.filter(p => p.expiryDate && new Date(p.expiryDate) < now).length;
        const aboutToExpireCount = products.filter(p => p.expiryDate && new Date(p.expiryDate) >= now && new Date(p.expiryDate) <= expiryThreshold).length;

        return {
          todaySales,
          monthlySales: sales.reduce((sum, s) => sum + s.totalAmount, 0),
          totalProfit: 0, 
          totalDue,
          totalExpense,
          totalProducts: products.length,
          lowStockCount: products.filter(p => p.stock <= 5).length,
          expiredProductCount,
          aboutToExpireCount,
          recentSales: sales.slice(0, 5)
        };
      },
      async () => {
        const res = await fetch("/api/dashboard/stats");
        if (!res.ok) throw new Error("REST dashboard stats failed");
        return await res.json();
      }
    );
  },

  getProducts: async (): Promise<Product[]> => {
    return runWithFallback(
      async () => {
        const q = query(getScopedCollection("products"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      },
      async () => {
        const res = await fetch("/api/products");
        if (!res.ok) throw new Error("REST products fetch failed");
        return await res.json();
      }
    );
  },

  createProduct: async (product: Partial<Product>): Promise<Product> => {
    return runWithFallback(
      async () => {
        const createdAt = new Date().toISOString();
        const data = cleanData(product);
        const docRef = await addDoc(getScopedCollection("products"), {
          ...data,
          createdAt
        });
        return { id: docRef.id, ...data, createdAt } as Product;
      },
      async () => {
        const res = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(product)
        });
        if (!res.ok) throw new Error("REST createProduct failed");
        return await res.json();
      }
    );
  },

  createProductsBatch: async (products: Partial<Product>[]): Promise<void> => {
    return runWithFallback(
      async () => {
        const { writeBatch } = await import("firebase/firestore");
        const batch = writeBatch(db);
        const createdAt = new Date().toISOString();
        
        products.forEach(p => {
          const docRef = doc(getScopedCollection("products"));
          const data = cleanData(p);
          batch.set(docRef, { ...data, createdAt });
        });
        
        await batch.commit();
      },
      async () => {
        for (const p of products) {
          const res = await fetch("/api/products", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(p)
          });
          if (!res.ok) throw new Error("REST batch createProduct item failed");
        }
      }
    );
  },

  updateProduct: async (id: string, product: Partial<Product>): Promise<Product> => {
    return runWithFallback(
      async () => {
        const data = cleanData(product);
        const docRef = doc(db, "businesses", currentBusinessId, "products", id);
        await updateDoc(docRef, data);
        return { id, ...data } as Product;
      },
      async () => {
        const res = await fetch(`/api/products/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(product)
        });
        if (!res.ok) throw new Error("REST updateProduct failed");
        return await res.json();
      }
    );
  },

  deleteProduct: async (id: string): Promise<boolean> => {
    return runWithFallback(
      async () => {
        await deleteDoc(doc(db, "businesses", currentBusinessId, "products", id));
        return true;
      },
      async () => {
        const res = await fetch(`/api/products/${id}`, {
          method: "DELETE"
        });
        if (!res.ok) throw new Error("REST deleteProduct failed");
        return true;
      }
    );
  },

  getCategories: async (): Promise<any[]> => {
    return runWithFallback(
      async () => {
        const snapshot = await getDocs(getScopedCollection("categories"));
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      },
      async () => {
        const res = await fetch("/api/categories");
        if (!res.ok) throw new Error("REST getCategories failed");
        return await res.json();
      }
    );
  },

  createCategory: async (category: { name: string }): Promise<any> => {
    return runWithFallback(
      async () => {
        const data = cleanData(category);
        const docRef = await addDoc(getScopedCollection("categories"), data);
        return { id: docRef.id, ...data };
      },
      async () => {
        const res = await fetch("/api/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(category)
        });
        if (!res.ok) throw new Error("REST createCategory failed");
        return await res.json();
      }
    );
  },

  getCustomers: async (userId?: string): Promise<Customer[]> => {
    return runWithFallback(
      async () => {
        const snapshot = await getDocs(getScopedCollection("customers"));
        let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer));
        if (userId) {
          data = data.filter(c => c.createdBy === userId);
        }
        return data;
      },
      async () => {
        const res = await fetch("/api/customers");
        if (!res.ok) throw new Error("REST getCustomers failed");
        let data = await res.json();
        if (userId) {
          data = data.filter((c: any) => c.createdBy === userId);
        }
        return data;
      }
    );
  },

  createCustomer: async (customer: Partial<Customer>): Promise<Customer> => {
    return runWithFallback(
      async () => {
        const createdAt = new Date().toISOString();
        const data = cleanData(customer);
        const docRef = await addDoc(getScopedCollection("customers"), {
          ...data,
          createdAt
        });
        return { id: docRef.id, ...data, createdAt } as Customer;
      },
      async () => {
        const res = await fetch("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(customer)
        });
        if (!res.ok) throw new Error("REST createCustomer failed");
        return await res.json();
      }
    );
  },

  createCustomersBatch: async (customers: Partial<Customer>[]): Promise<void> => {
    return runWithFallback(
      async () => {
        const { writeBatch } = await import("firebase/firestore");
        const batch = writeBatch(db);
        const createdAt = new Date().toISOString();
        
        customers.forEach(c => {
          const docRef = doc(getScopedCollection("customers"));
          const data = cleanData(c);
          batch.set(docRef, { ...data, createdAt });
        });
        
        await batch.commit();
      },
      async () => {
        for (const c of customers) {
          const res = await fetch("/api/customers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(c)
          });
          if (!res.ok) throw new Error("REST batch createCustomer item failed");
        }
      }
    );
  },

  updateCustomer: async (id: string, customer: Partial<Customer>): Promise<Customer> => {
    return runWithFallback(
      async () => {
        const data = cleanData(customer);
        const docRef = doc(db, "businesses", currentBusinessId, "customers", id);
        await updateDoc(docRef, data);
        return { id, ...data } as Customer;
      },
      async () => {
        const res = await fetch(`/api/customers/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(customer)
        });
        if (!res.ok) throw new Error("REST updateCustomer failed");
        return await res.json();
      }
    );
  },

  deleteCustomer: async (id: string): Promise<boolean> => {
    return runWithFallback(
      async () => {
        await deleteDoc(doc(db, "businesses", currentBusinessId, "customers", id));
        return true;
      },
      async () => {
        const res = await fetch(`/api/customers/${id}`, {
          method: "DELETE"
        });
        if (!res.ok) throw new Error("REST deleteCustomer failed");
        return true;
      }
    );
  },

  getSales: async (userId?: string): Promise<Sale[]> => {
    return runWithFallback(
      async () => {
        const q = query(getScopedCollection("sales"));
        const snapshot = await getDocs(q);
        let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale));
        if (userId) {
          data = data.filter(s => s.userId === userId || s.createdBy === userId);
        }
        return data;
      },
      async () => {
        const res = await fetch("/api/sales");
        if (!res.ok) throw new Error("REST getSales failed");
        let data = await res.json();
        if (userId) {
          data = data.filter((s: any) => s.userId === userId || s.createdBy === userId);
        }
        return data;
      }
    );
  },

  createSale: async (sale: Partial<Sale>): Promise<Sale> => {
    return runWithFallback(
      async () => {
        const createdAt = new Date().toISOString();
        const data = cleanData(sale);
        const docRef = await addDoc(getScopedCollection("sales"), {
          ...data,
          createdAt
        });

        for (const item of sale.items || []) {
          const productRef = doc(db, "businesses", currentBusinessId, "products", item.productId);
          const updateData: any = {
            stock: increment(-item.quantity)
          };
          if (item.scannedBarcodes && Array.isArray(item.scannedBarcodes) && item.scannedBarcodes.length > 0) {
            updateData.barcodes = arrayRemove(...item.scannedBarcodes);
          }
          await updateDoc(productRef, updateData);
        }

        if (sale.customerId && sale.customerId !== "walking" && sale.dueAmount && sale.dueAmount > 0) {
          const customerRef = doc(db, "businesses", currentBusinessId, "customers", sale.customerId);
          await updateDoc(customerRef, {
            dueAmount: increment(sale.dueAmount)
          });
        }

        return { id: docRef.id, ...data, createdAt } as Sale;
      },
      async () => {
        const res = await fetch("/api/sales", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sale)
        });
        if (!res.ok) throw new Error("REST createSale failed");
        return await res.json();
      }
    );
  },

  deleteSale: async (id: string): Promise<boolean> => {
    return runWithFallback(
      async () => {
        const saleRef = doc(db, "businesses", currentBusinessId, "sales", id);
        const saleSnap = await getDoc(saleRef);
        if (!saleSnap.exists()) return false;
        const saleData = saleSnap.data() as Sale;

        if (saleData.items && Array.isArray(saleData.items)) {
          for (const item of saleData.items) {
            const productRef = doc(db, "businesses", currentBusinessId, "products", item.productId);
            const updateData: any = {
              stock: increment(item.quantity || 0)
            };
            if (item.scannedBarcodes && Array.isArray(item.scannedBarcodes) && item.scannedBarcodes.length > 0) {
              updateData.barcodes = arrayUnion(...item.scannedBarcodes);
            }
            await updateDoc(productRef, updateData).catch(err => console.error("Restore stock failed", err));
          }
        }

        if (saleData.customerId && saleData.customerId !== "walking" && saleData.dueAmount) {
          const customerRef = doc(db, "businesses", currentBusinessId, "customers", saleData.customerId);
          await updateDoc(customerRef, {
            dueAmount: increment(-saleData.dueAmount),
            totalSpent: increment(-saleData.payableAmount),
          }).catch(err => console.error("Restore customer balance failed", err));
        }

        await deleteDoc(saleRef);
        return true;
      },
      async () => {
        const res = await fetch(`/api/sales/${id}`, {
          method: "DELETE"
        });
        if (!res.ok) throw new Error("REST deleteSale failed");
        return true;
      }
    );
  },

  getSuppliers: async (): Promise<Supplier[]> => {
    return runWithFallback(
      async () => {
        const snapshot = await getDocs(getScopedCollection("suppliers"));
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier));
      },
      async () => {
        const res = await fetch("/api/suppliers");
        if (!res.ok) throw new Error("REST getSuppliers failed");
        return await res.json();
      }
    );
  },

  createSupplier: async (supplier: Partial<Supplier>): Promise<Supplier> => {
    return runWithFallback(
      async () => {
        const data = cleanData(supplier);
        const docRef = await addDoc(getScopedCollection("suppliers"), data);
        return { id: docRef.id, ...data } as Supplier;
      },
      async () => {
        const res = await fetch("/api/suppliers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(supplier)
        });
        if (!res.ok) throw new Error("REST createSupplier failed");
        return await res.json();
      }
    );
  },

  createSuppliersBatch: async (suppliers: Partial<Supplier>[]): Promise<void> => {
    return runWithFallback(
      async () => {
        const { writeBatch } = await import("firebase/firestore");
        const batch = writeBatch(db);
        const createdAt = new Date().toISOString();
        
        suppliers.forEach(s => {
          const docRef = doc(getScopedCollection("suppliers"));
          const data = cleanData(s);
          batch.set(docRef, { ...data, createdAt });
        });
        
        await batch.commit();
      },
      async () => {
        for (const s of suppliers) {
          const res = await fetch("/api/suppliers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(s)
          });
          if (!res.ok) throw new Error("REST batch createSupplier item failed");
        }
      }
    );
  },

  updateSupplier: async (id: string, supplier: Partial<Supplier>): Promise<Supplier> => {
    return runWithFallback(
      async () => {
        const data = cleanData(supplier);
        const docRef = doc(db, "businesses", currentBusinessId, "suppliers", id);
        await updateDoc(docRef, data);
        return { id, ...data } as Supplier;
      },
      async () => {
        const res = await fetch(`/api/suppliers/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(supplier)
        });
        if (!res.ok) throw new Error("REST updateSupplier failed");
        return await res.json();
      }
    );
  },

  deleteSupplier: async (id: string): Promise<boolean> => {
    return runWithFallback(
      async () => {
        await deleteDoc(doc(db, "businesses", currentBusinessId, "suppliers", id));
        return true;
      },
      async () => {
        const res = await fetch(`/api/suppliers/${id}`, {
          method: "DELETE"
        });
        if (!res.ok) throw new Error("REST deleteSupplier failed");
        return true;
      }
    );
  },

  getSupplierTransactions: async (id: string): Promise<SupplierTransaction[]> => {
    return runWithFallback(
      async () => {
        const q = query(collection(db, "businesses", currentBusinessId, "suppliers", id, "transactions"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SupplierTransaction));
      },
      async () => {
        const res = await fetch(`/api/suppliers/${id}/transactions`);
        if (!res.ok) throw new Error("REST getSupplierTransactions failed");
        return await res.json();
      }
    );
  },

  recordSupplierPayment: async (id: string, amount: number, description?: string): Promise<SupplierTransaction> => {
    return runWithFallback(
      async () => {
        const transRef = await addDoc(collection(db, "businesses", currentBusinessId, "suppliers", id, "transactions"), {
          amount,
          description: description || "",
          type: "payment",
          date: new Date().toISOString()
        });

        const supplierRef = doc(db, "businesses", currentBusinessId, "suppliers", id);
        await updateDoc(supplierRef, {
          dueAmount: increment(-amount)
        });

        return { id: transRef.id, amount, description: description || "", type: "payment", date: new Date().toISOString() } as SupplierTransaction;
      },
      async () => {
        const res = await fetch(`/api/suppliers/${id}/payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount, description, type: "payment" })
        });
        if (!res.ok) throw new Error("REST recordSupplierPayment failed");
        return await res.json();
      }
    );
  },

  recordSupplierPurchase: async (id: string, amount: number, description?: string): Promise<SupplierTransaction> => {
    return runWithFallback(
      async () => {
        const transRef = await addDoc(collection(db, "businesses", currentBusinessId, "suppliers", id, "transactions"), {
          amount,
          description: description || "",
          type: "purchase",
          date: new Date().toISOString()
        });

        const supplierRef = doc(db, "businesses", currentBusinessId, "suppliers", id);
        await updateDoc(supplierRef, {
          dueAmount: increment(amount)
        });

        return { id: transRef.id, amount, description: description || "", type: "purchase", date: new Date().toISOString() } as SupplierTransaction;
      },
      async () => {
        const res = await fetch(`/api/suppliers/${id}/payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount, description, type: "purchase" })
        });
        if (!res.ok) throw new Error("REST recordSupplierPurchase failed");
        return await res.json();
      }
    );
  },

  getExpenses: async (userId?: string): Promise<any[]> => {
    return runWithFallback(
      async () => {
        const snapshot = await getDocs(getScopedCollection("expenses"));
        let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (userId) {
          data = data.filter((e: any) => e.userId === userId);
        }
        return data;
      },
      async () => {
        const res = await fetch("/api/expenses");
        if (!res.ok) throw new Error("REST getExpenses failed");
        let data = await res.json();
        if (userId) {
          data = data.filter((e: any) => e.userId === userId);
        }
        return data;
      }
    );
  },

  createExpense: async (expense: any): Promise<any> => {
    return runWithFallback(
      async () => {
        const data = cleanData(expense);
        const docRef = await addDoc(getScopedCollection("expenses"), {
          ...data,
          date: new Date().toISOString()
        });
        return { id: docRef.id, ...data };
      },
      async () => {
        const res = await fetch("/api/expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(expense)
        });
        if (!res.ok) throw new Error("REST createExpense failed");
        return await res.json();
      }
    );
  },

  updateExpense: async (id: string, expense: any): Promise<any> => {
    return runWithFallback(
      async () => {
        const data = cleanData(expense);
        const docRef = doc(db, "businesses", currentBusinessId, "expenses", id);
        await updateDoc(docRef, data);
        return { id, ...data };
      },
      async () => {
        const res = await fetch(`/api/expenses/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(expense)
        });
        if (!res.ok) throw new Error("REST updateExpense failed");
        return await res.json();
      }
    );
  },

  deleteExpense: async (id: string): Promise<boolean> => {
    return runWithFallback(
      async () => {
        await deleteDoc(doc(db, "businesses", currentBusinessId, "expenses", id));
        return true;
      },
      async () => {
        const res = await fetch(`/api/expenses/${id}`, {
          method: "DELETE"
        });
        if (!res.ok) throw new Error("REST deleteExpense failed");
        return true;
      }
    );
  },

  recordPayment: async (customerId: string, amount: number, method: string): Promise<any> => {
    return runWithFallback(
      async () => {
        const customerRef = doc(db, "businesses", currentBusinessId, "customers", customerId);
        await updateDoc(customerRef, {
          dueAmount: increment(-amount)
        });
        
        await addDoc(collection(db, "businesses", currentBusinessId, "customers", customerId, "payments"), {
          amount,
          method,
          date: new Date().toISOString()
        });

        return { success: true };
      },
      async () => {
        const res = await fetch(`/api/customers/${customerId}/payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount, method })
        });
        if (!res.ok) throw new Error("REST recordPayment failed");
        return await res.json();
      }
    );
  },

  getSMSLogs: async (): Promise<SMSLog[]> => {
    return runWithFallback(
      async () => {
        const q = query(getScopedCollection("sms_logs"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SMSLog));
      },
      async () => {
        const res = await fetch("/api/sms/logs");
        if (!res.ok) throw new Error("REST getSMSLogs failed");
        return await res.json();
      }
    );
  },

  sendSMS: async (recipient: string, message: string): Promise<SMSLog> => {
    const path = `businesses/${currentBusinessId}/sms_logs`;
    let sendStatus: 'sent' | 'failed' = 'sent';
    let gatewayError = "";

    return runWithFallback(
      async () => {
        try {
          const config = await api.getSMSConfig();
          
          if (config.apiKey && config.provider !== "Default") {
            try {
              let url = "";
              const phone = recipient.startsWith("88") ? recipient : "88" + recipient;
              const apiKey = config.apiKey.trim();
              const senderId = (config.senderId || '880').trim();
              const apiUser = (config.apiUser || '').trim();
              
              if (config.provider === "SendMySMS") {
                url = `http://sendmysms.net/smsapi?api_key=${apiKey}&username=${apiUser}&type=text&contacts=${phone}&senderid=${senderId}&msg=${encodeURIComponent(message)}`;
              } else if (config.provider === "SEMySMS") {
                url = `http://semysms.net/smsapi?api_key=${apiKey}&username=${apiUser}&type=text&contacts=${phone}&senderid=${senderId}&msg=${encodeURIComponent(message)}`;
              } else if (config.provider === "SBMHosting") {
                url = `http://103.111.45.166/smsapi?api_key=${apiKey}&type=text&contacts=${phone}&senderid=${senderId}&msg=${encodeURIComponent(message)}`;
              } else if (config.provider === "BulksmsBD") {
                url = `https://bulksmsbd.net/api/smsapi?api_key=${apiKey}&type=text&number=${phone}&senderid=${senderId}&message=${encodeURIComponent(message)}`;
              } else if (config.provider === "AlphaSMS") {
                url = `https://api.alphasms.biz/send?apiKey=${apiKey}&to=${phone}&msg=${encodeURIComponent(message)}`;
              } else if (config.provider === "DHSMS") {
                url = `https://dhsms.com.bd/api?api_key=${apiKey}&type=text&number=${phone}&senderid=${senderId}&message=${encodeURIComponent(message)}`;
              } else if (config.provider === "DianaSMS") {
                url = `https://dianasms.com/unit-api/v1/sms/send?api_key=${apiKey}&type=text&contacts=${phone}&senderid=${senderId}&msg=${encodeURIComponent(message)}`;
              } else if (config.provider === "MimSMS") {
                url = `https://mimsms.com/smsapi?api_key=${apiKey}&type=text&contacts=${phone}&senderid=${senderId}&msg=${encodeURIComponent(message)}`;
              } else if (config.provider === "ElitBuzz") {
                url = `http://elitbuzz-bd.com/smsapi?api_key=${apiKey}&type=text&contacts=${phone}&senderid=${senderId}&msg=${encodeURIComponent(message)}`;
              } else if (config.provider === "ReveSMS") {
                url = `http://reseller.revesms.com/smsapi?api_key=${apiKey}&type=text&contacts=${phone}&senderid=${senderId}&msg=${encodeURIComponent(message)}`;
              } else if (config.provider === "SMS8IO") {
                url = `https://app.sms8.io/services/send.php?key=${apiKey}&number=${phone}&message=${encodeURIComponent(message)}`;
              } else if (config.provider === "ADN_SMS") {
                const [key, secret] = apiKey.includes(':') ? apiKey.split(':') : [apiKey, ''];
                url = `https://adnsms.com.bd/api/v1/secure/send-sms?api_key=${key}&api_secret=${secret}&request_type=SINGLE_SMS&message_type=TEXT&mobile=${phone}&message_text=${encodeURIComponent(message)}`;
              } else if (config.provider === "SSLWireless") {
                url = `https://smsplus.sslwireless.com/api/v3/send-sms?api_token=${apiKey}&sid=${senderId}&msisdn=${phone}&sms=${encodeURIComponent(message)}&csms_id=${Date.now()}`;
              } else if (config.provider === "Greenweb") {
                url = `https://api.greenweb.com.bd/api.php?json&token=${apiKey}&to=${phone}&message=${encodeURIComponent(message)}`;
              } else if (config.provider === "Manual") {
                const template = (config.senderId || "").trim();
                const apiUser = (config.apiUser || "").trim();
                if (template.includes("[PHONE]") && template.includes("[MESSAGE]")) {
                  url = template
                    .replace("[PHONE]", phone)
                    .replace("[MESSAGE]", encodeURIComponent(message))
                    .replace("[API_KEY]", apiKey)
                    .replace("[API_USER]", apiUser);
                }
              } else if (config.provider === "Demo") {
                console.log(`[SMS DEMO] Successfully simulated sending to ${phone}: ${message}`);
                await new Promise(resolve => setTimeout(resolve, 800));
                return {
                  id: "demo-" + Date.now(),
                  recipient,
                  message,
                  status: 'sent',
                  createdAt: new Date().toISOString()
                };
              }

              if (url) {
                console.log(`[SMS] Sending via ${config.provider} to ${phone}`);
                let proxyUrl = `/api/sms/proxy?url=${encodeURIComponent(url)}`;
                let response = await fetch(proxyUrl);
                
                if (response.status === 404) {
                  const variations = [];
                  if (config.provider === "SendMySMS") {
                    const subdomains = ['s1', 's2', 's3', 's4', 's5', 'api', 'panel'];
                    subdomains.forEach(sub => {
                      variations.push(url.replace('sendmysms.net', `${sub}.sendmysms.net`));
                    });
                    variations.push(url.replace('/smsapi', '/smsapi.php'));
                    variations.push(url.replace('/smsapi/smsapi', '/smsapi'));
                  } else if (config.provider === "SBMHosting") {
                    variations.push(url.replace('/smsapi', '/api/send-sms'));
                    variations.push(url.replace('/smsapi', '/smsapi.php'));
                    variations.push(url.replace('/smsapi', '/smsapi/api.php'));
                    variations.push(url.replace('/smsapi', '/bulksms'));
                  } else if (config.provider === "DianaSMS") {
                    variations.push(url.replace('dianasms.com', 'panel.dianasms.com'));
                    variations.push(url.replace('/unit-api/v1/sms/send', '/api/v1/sms/send'));
                  } else if (config.provider === "ReveSMS") {
                    variations.push(url.replace('/smsapi', '/smsapi/send'));
                    variations.push(url.replace('reseller.revesms.com', 'mail.revesms.com'));
                  } else if (config.provider === "ElitBuzz") {
                    variations.push(url.replace('elitbuzz-bd.com', 'elitbuzz.com'));
                    variations.push(url.replace('elitbuzz-bd.com', 'panel.elitbuzz-bd.com'));
                    variations.push(url.replace('/smsapi', '/smsapi.php'));
                  } else if (config.provider === "SMS8IO") {
                    variations.push(url.replace('services/send.php', 'api/v1/send'));
                    variations.push(url.replace('services/send.php', 'services/sendSMS.php'));
                  }

                  variations.push(url.replace('/smsapi', '/api/smsapi'));
                  variations.push(url.replace('/smsapi', '/sms/api'));
                  variations.push(url.replace('/smsapi', '/smsapi.php'));

                  for (const vUrl of variations) {
                    if (vUrl === url) continue;
                    console.log(`[SMS] Gateway 404, trying variation: ${vUrl}`);
                    const vProxyUrl = `/api/sms/proxy?url=${encodeURIComponent(vUrl)}`;
                    try {
                      const vResponse = await fetch(vProxyUrl);
                      if (vResponse.ok) {
                        response = vResponse;
                        break;
                      }
                    } catch {}
                  }
                }

                const contentType = response.headers.get("content-type");
                let data: any;
                
                if (contentType && contentType.includes("application/json")) {
                  data = await response.json();
                } else {
                  const text = await response.text();
                  let extractedError = text;
                  if (text.includes("<title>") || text.includes("<h1>")) {
                    const titleMatch = text.match(/<title>(.*?)<\/title>/i);
                    const h1Match = text.match(/<h1>(.*?)<\/h1>/i);
                    const bodyText = text.replace(/<[^>]*>/g, ' ').substring(0, 150).trim();
                    extractedError = `${titleMatch ? titleMatch[1] : ''} ${h1Match ? h1Match[1] : ''}`.trim() || bodyText;
                  }
                  data = { error: extractedError || "Invalid response format", rawResponse: true };
                }
                
                if (!response.ok) {
                  let errorMsg = data.error || data.message || "Gateway Error";
                  if (response.status === 404) {
                    errorMsg = `API URL incorrect (404). Variation testing failed. Please use Manual API with correct URL.`;
                  } else if (response.status === 403) {
                    errorMsg = `Forbidden (403). Check API Key, IP whitelist, or Credit balance.`;
                  }
                  const displayError = typeof errorMsg === 'string' && errorMsg.length > 200 
                    ? errorMsg.substring(0, 200) + "..." : errorMsg;
                  throw new Error(displayError);
                }
              }
            } catch (gateErr: any) {
              console.error("SMS Gateway Execution Error:", gateErr);
              sendStatus = 'failed';
              gatewayError = gateErr.message;
            }
          }

          const logData = {
            recipient,
            message,
            status: sendStatus,
            error: gatewayError,
            createdAt: new Date().toISOString()
          };
          
          const docRef = await addDoc(getScopedCollection("sms_logs"), logData);
          
          if (sendStatus === 'failed') {
            throw new Error(gatewayError || "এসএমএস পাঠানো ব্যর্থ হয়েছে।");
          }
          
          return { id: docRef.id, ...logData };
        } catch (err) {
          if (sendStatus === 'failed') throw err;
          return handleFirestoreError(err, OperationType.CREATE, path);
        }
      },
      async () => {
        const res = await fetch("/api/sms/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipient, message })
        });
        if (!res.ok) throw new Error("REST sendSMS failed");
        return await res.json();
      }
    );
  },

  getBusiness: async (): Promise<Business> => {
    return runWithFallback(
      async () => {
        const docRef = doc(db, "businesses", currentBusinessId);
        const snapshot = await getDoc(docRef);
        if (!snapshot.exists()) {
          return { id: currentBusinessId, name: "Smart Business", address: "", phone: "", currency: "BDT" };
        }
        return { id: snapshot.id, ...snapshot.data() } as Business;
      },
      async () => {
        const res = await fetch("/api/business");
        if (!res.ok) throw new Error("REST business fetch failed");
        return await res.json();
      }
    );
  },

  updateBusiness: async (business: Partial<Business>): Promise<Business> => {
    return runWithFallback(
      async () => {
        const data = cleanData(business);
        const docRef = doc(db, "businesses", currentBusinessId);
        await setDoc(docRef, data, { merge: true });
        return { id: currentBusinessId, ...data } as Business;
      },
      async () => {
        const res = await fetch("/api/business", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(business)
        });
        if (!res.ok) throw new Error("REST updateBusiness failed");
        return await res.json();
      }
    );
  },

  getUsers: async (): Promise<User[]> => {
    return runWithFallback(
      async () => {
        const q = query(collection(db, "users"), where("businessId", "==", currentBusinessId));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
      },
      async () => {
        const res = await fetch("/api/users");
        if (!res.ok) throw new Error("REST getUsers failed");
        return await res.json();
      }
    );
  },

  login: async (email: string, pass: string): Promise<User> => {
    const emailNorm = email.toLowerCase().trim();
    const passwordTrim = pass.trim();
    return runWithFallback(
      async () => {
        let snapshot;
        try {
          let q = query(
            collection(db, "users"), 
            where("email", "==", emailNorm),
            limit(1)
          );
          snapshot = await getDocs(q);
          
          if (snapshot.empty && emailNorm !== email.trim()) {
            q = query(
              collection(db, "users"), 
              where("email", "==", email.trim()),
              limit(1)
            );
            snapshot = await getDocs(q);
          }
        } catch (e: any) {
          console.warn("Direct query failed (likely offline), trying local fallback", e);
          const allUsersSnap = await getDocs(collection(db, "users"));
          const matchedDoc = allUsersSnap.docs.find(d => 
            (d.data().email || "").toLowerCase().trim() === emailNorm || 
            (d.data().email || "").trim() === email.trim()
          );
          if (matchedDoc) {
            snapshot = { empty: false, docs: [matchedDoc] };
          } else {
            throw new Error("এই ইমেইল দিয়ে কোনো অ্যাকাউন্ট পাওয়া যায়নি!");
          }
        }
        
        if (!snapshot || snapshot.empty) {
          throw new Error("এই ইমেইল দিয়ে কোনো অ্যাকাউন্ট পাওয়া যায়নি!");
        }

        const userData = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as User;
        const storedPassword = (userData.password || "").trim();
        if (storedPassword !== passwordTrim) {
          throw new Error("পাসওয়ার্ডটি সঠিক নয়!");
        }

        try {
          const offlineUsers = JSON.parse(localStorage.getItem('smart_business_offline_users') || '{}');
          offlineUsers[emailNorm] = userData;
          localStorage.setItem('smart_business_offline_users', JSON.stringify(offlineUsers));
        } catch(e) {}

        return userData;
      },
      async () => {
        const res = await fetch("/api/users");
        if (!res.ok) throw new Error("REST login check failed");
        const allUsers: User[] = await res.json();
        const userData = allUsers.find(u => (u.email || "").toLowerCase().trim() === emailNorm);
        if (!userData) {
          throw new Error("এই ইমেইল দিয়ে কোনো অ্যাকাউন্ট পাওয়া যায়নি!");
        }
        if ((userData.password || "").trim() !== passwordTrim) {
          throw new Error("পাসওয়ার্ডটি সঠিক নয়!");
        }
        try {
          const offlineUsers = JSON.parse(localStorage.getItem('smart_business_offline_users') || '{}');
          offlineUsers[emailNorm] = userData;
          localStorage.setItem('smart_business_offline_users', JSON.stringify(offlineUsers));
        } catch(e) {}
        return userData;
      }
    );
  },

  createUser: async (user: Partial<User>): Promise<User> => {
    return runWithFallback(
      async () => {
        const data = cleanData(user);
        if (data.email) data.email = data.email.toLowerCase().trim();
        if (data.id) {
          const docRef = doc(db, "users", data.id);
          await setDoc(docRef, data);
          return data as User;
        } else {
          const createdAt = new Date().toISOString();
          const docRef = await addDoc(collection(db, "users"), {
            ...data,
            createdAt
          });
          return { id: docRef.id, ...data, createdAt } as User;
        }
      },
      async () => {
        const res = await fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user)
        });
        if (!res.ok) throw new Error("REST createUser failed");
        return await res.json();
      }
    );
  },

  updateUser: async (id: string, user: Partial<User>): Promise<User> => {
    return runWithFallback(
      async () => {
        const data = cleanData(user);
        const docRef = doc(db, "users", id);
        await updateDoc(docRef, data);
        return { id, ...data } as User;
      },
      async () => {
        const res = await fetch(`/api/users/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user)
        });
        if (!res.ok) throw new Error("REST updateUser failed");
        return await res.json();
      }
    );
  },

  deleteUser: async (id: string): Promise<boolean> => {
    return runWithFallback(
      async () => {
        await deleteDoc(doc(db, "users", id));
        return true;
      },
      async () => {
        const res = await fetch(`/api/users/${id}`, {
          method: "DELETE"
        });
        if (!res.ok) throw new Error("REST deleteUser failed");
        return true;
      }
    );
  },

  changePassword: async (passwords: { currentPassword: string, newPassword: string }): Promise<boolean> => {
    return runWithFallback(
      async () => {
        const userStr = localStorage.getItem("smart_business_user");
        if (!userStr) throw new Error("User session not found");
        const sessionUser = JSON.parse(userStr);
        
        const docRef = doc(db, "users", sessionUser.id);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) throw new Error("User not found in database");
        
        const userData = docSnap.data();
        if (userData.password !== passwords.currentPassword) {
          throw new Error("Current password mismatch");
        }
        
        await updateDoc(docRef, { password: passwords.newPassword });
        localStorage.setItem("smart_business_user", JSON.stringify({ ...sessionUser, password: passwords.newPassword }));
        
        return true;
      },
      async () => {
        const userStr = localStorage.getItem("smart_business_user");
        if (!userStr) throw new Error("User session not found");
        const sessionUser = JSON.parse(userStr);

        const res = await fetch("/api/users/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(passwords)
        });
        if (!res.ok) throw new Error("REST changePassword failed");
        
        localStorage.setItem("smart_business_user", JSON.stringify({ ...sessionUser, password: passwords.newPassword }));
        return true;
      }
    );
  },

  getSMSConfig: async (): Promise<SMSConfig> => {
    return runWithFallback(
      async () => {
        const docRef = doc(db, "businesses", currentBusinessId, "config", "sms");
        const snapshot = await getDoc(docRef);
        return snapshot.data() as SMSConfig || { apiKey: "", senderId: "", provider: "other" };
      },
      async () => {
        const res = await fetch("/api/sms/config");
        if (!res.ok) throw new Error("REST getSMSConfig failed");
        return await res.json();
      }
    );
  },

  updateSMSConfig: async (config: SMSConfig): Promise<SMSConfig> => {
    return runWithFallback(
      async () => {
        const docRef = doc(db, "businesses", currentBusinessId, "config", "sms");
        await setDoc(docRef, config);
        return config;
      },
      async () => {
        const res = await fetch("/api/sms/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config)
        });
        if (!res.ok) throw new Error("REST updateSMSConfig failed");
        return await res.json();
      }
    );
  },

  getSalesByDate: async () => {
    try {
      const sales = await api.getSales();
      const salesByDate: Record<string, number> = {};
      sales.forEach(sale => {
        const date = sale.createdAt?.split("T")[0] || "Unknown";
        salesByDate[date] = (salesByDate[date] || 0) + sale.payableAmount;
      });
      return Object.entries(salesByDate).map(([date, amount]) => ({ date, amount }));
    } catch (err) {
      throw err;
    }
  },

  getExpenseByCategory: async () => {
    try {
      const expenses = await api.getExpenses();
      const expenseByCat: Record<string, number> = {};
      expenses.forEach(exp => {
        expenseByCat[exp.category] = (expenseByCat[exp.category] || 0) + exp.amount;
      });
      return Object.entries(expenseByCat).map(([category, amount]) => ({ category, amount }));
    } catch (err) {
      throw err;
    }
  },

  getBackupStatus: async () => {
    try {
      const response = await fetch("/api/backup/status");
      if (!response.ok) throw new Error("Failed to fetch backup status");
      const data = await response.json();
      return { 
        lastBackupAt: data.lastBackupAt, 
        status: data.lastBackupAt ? "Cloud Synced (Firebase + Email)" : "No backup sent yet"
      };
    } catch (err) {
      return { lastBackupAt: null, status: "Local Only" };
    }
  },
  
  triggerBackup: async () => {
    try {
      const business = await api.getBusiness();
      if (!business.backupEmail || !business.backupEmail.trim()) {
        console.warn("[Auto Backup] Daily backup skipped: No backup email configured.");
        return { success: false, skipped: true, lastBackupAt: null, message: "No backup email configured." };
      }

      const allData = await api.getAllData();
      
      const response = await fetch("/api/backup/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: { ...allData, business },
          email: business.backupEmail,
          smtpConfig: business.smtpConfig
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Email sending failed");
      }

      const resData = await response.json();
      return { success: true, message: resData.message, lastBackupAt: new Date().toISOString() };
    } catch (err: any) {
      throw new Error(err.message || "Failed to trigger backup");
    }
  },

  getAllData: async (): Promise<any> => {
    try {
      const suppliers = await api.getSuppliers();
      const supplierTransactions: Record<string, any[]> = {};
      
      const customers = await api.getCustomers();
      const customerPayments: Record<string, any[]> = {};
      
      await Promise.all([
        ...suppliers.map(async (sup) => {
          try {
            const trans = await api.getSupplierTransactions(sup.id);
            supplierTransactions[sup.id] = trans;
          } catch (e) {
            supplierTransactions[sup.id] = [];
          }
        }),
        ...customers.map(async (cust) => {
          try {
            const payRef = collection(db, "businesses", currentBusinessId, "customers", cust.id, "payments");
            const snap = await getDocs(payRef);
            customerPayments[cust.id] = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          } catch (e) {
            customerPayments[cust.id] = [];
          }
        })
      ]);

      const [products, sales, expenses, categories, users, smsLogs] = await Promise.all([
        api.getProducts(),
        api.getSales(),
        api.getExpenses(),
        api.getCategories(),
        api.getUsers(),
        api.getSMSLogs()
      ]);

      return { 
        products, 
        customers, 
        sales, 
        expenses, 
        suppliers, 
        supplierTransactions,
        customerPayments,
        categories, 
        users,
        smsLogs,
        version: "2.1",
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      console.error("Backup data collection failed:", err);
      throw err;
    }
  },

  restoreDB: async (data: any): Promise<any> => {
    try {
      const response = await fetch("/api/db/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Restore failed");
      }

      return await response.json();
    } catch (err: any) {
      throw new Error(err.message || "Failed to restore database");
    }
  },
};
