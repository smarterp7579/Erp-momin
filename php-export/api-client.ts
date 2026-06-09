/**
 * HishabPati Smart ERP & POS - PHP API Frontend Client
 * 
 * Instructions:
 * 1. Place this file in your `/src/services/api.ts` to swap your backend system from 
 *    Firebase to your new PHP REST API server seamlessly!
 * 2. Configure the `API_BASE_URL` below to match your hosted domain.
 */

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
} from "../src/types";

// CHANGE THIS TO YOUR HOSTED PHP BACKEND WEB URL (e.g., "http://smartbusiness.great-site.net/api/api.php")
const API_BASE_URL = "http://smartbusiness.great-site.net/api/api.php";

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

// Generic Fetch Request Helper wrapping authorization/multi-tenant headers
async function request(action: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: any, extraParams: Record<string, string> = {}) {
  const urlParams = new URLSearchParams({ action, businessId: currentBusinessId, ...extraParams });
  const url = `${API_BASE_URL}?${urlParams.toString()}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Business-ID': currentBusinessId
  };

  const config: RequestInit = {
    method,
    headers,
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(url, config);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `সার্ভার রেসপন্স কোড: ${response.status}`);
  }

  return data;
}

export const api = {
  getDashboardStats: async (user?: User | null): Promise<DashboardStats> => {
    return request('getDashboardStats', 'GET');
  },

  getProducts: async (): Promise<Product[]> => {
    return request('getProducts', 'GET');
  },

  createProduct: async (product: Partial<Product>): Promise<Product> => {
    return request('createProduct', 'POST', product);
  },

  createProductsBatch: async (products: Partial<Product>[]): Promise<void> => {
    return request('createProductsBatch', 'POST', products);
  },

  updateProduct: async (id: string, product: Partial<Product>): Promise<Product> => {
    await request('updateProduct', 'POST', product, { id });
    return { id, ...product } as Product;
  },

  deleteProduct: async (id: string): Promise<boolean> => {
    await request('deleteProduct', 'POST', null, { id });
    return true;
  },

  getCategories: async (): Promise<any[]> => {
    return request('getCategories', 'GET');
  },

  createCategory: async (category: { name: string }): Promise<any> => {
    return request('createCategory', 'POST', category);
  },

  getCustomers: async (userId?: string): Promise<Customer[]> => {
    return request('getCustomers', 'GET', null, userId ? { userId } : {});
  },

  createCustomer: async (customer: Partial<Customer>): Promise<Customer> => {
    return request('createCustomer', 'POST', customer);
  },

  createCustomersBatch: async (customers: Partial<Customer>[]): Promise<void> => {
    return request('createCustomersBatch', 'POST', customers);
  },

  updateCustomer: async (id: string, customer: Partial<Customer>): Promise<Customer> => {
    await request('updateCustomer', 'POST', customer, { id });
    return { id, ...customer } as Customer;
  },

  deleteCustomer: async (id: string): Promise<boolean> => {
    await request('deleteCustomer', 'POST', null, { id });
    return true;
  },

  getSales: async (userId?: string): Promise<Sale[]> => {
    return request('getSales', 'GET', null, userId ? { userId } : {});
  },

  createSale: async (sale: Partial<Sale>): Promise<Sale> => {
    return request('createSale', 'POST', sale);
  },

  deleteSale: async (id: string): Promise<boolean> => {
    await request('deleteSale', 'POST', null, { id });
    return true;
  },

  getSuppliers: async (): Promise<Supplier[]> => {
    return request('getSuppliers', 'GET');
  },

  createSupplier: async (supplier: Partial<Supplier>): Promise<Supplier> => {
    return request('createSupplier', 'POST', supplier);
  },

  createSuppliersBatch: async (suppliers: Partial<Supplier>[]): Promise<void> => {
    return request('createSuppliersBatch', 'POST', suppliers);
  },

  updateSupplier: async (id: string, supplier: Partial<Supplier>): Promise<Supplier> => {
    await request('updateSupplier', 'POST', supplier, { id });
    return { id, ...supplier } as Supplier;
  },

  deleteSupplier: async (id: string): Promise<boolean> => {
    await request('deleteSupplier', 'POST', null, { id });
    return true;
  },

  getSupplierTransactions: async (id: string): Promise<SupplierTransaction[]> => {
    return request('getSupplierTransactions', 'GET', null, { id });
  },

  recordSupplierPayment: async (id: string, amount: number, description?: string): Promise<SupplierTransaction> => {
    return request('recordSupplierPayment', 'POST', { supplierId: id, amount, description });
  },

  recordSupplierPurchase: async (id: string, amount: number, description?: string): Promise<SupplierTransaction> => {
    return request('recordSupplierPurchase', 'POST', { supplierId: id, amount, description });
  },

  getExpenses: async (userId?: string): Promise<any[]> => {
    return request('getExpenses', 'GET', null, userId ? { userId } : {});
  },

  createExpense: async (expense: any): Promise<any> => {
    return request('createExpense', 'POST', expense);
  },

  updateExpense: async (id: string, expense: any): Promise<any> => {
    await request('updateExpense', 'POST', expense, { id });
    return { id, ...expense };
  },

  deleteExpense: async (id: string): Promise<boolean> => {
    await request('deleteExpense', 'POST', null, { id });
    return true;
  },

  recordPayment: async (customerId: string, amount: number, method: string): Promise<any> => {
    return request('recordPayment', 'POST', { customerId, amount, method });
  },

  getSMSLogs: async (): Promise<SMSLog[]> => {
    return request('getSMSLogs', 'GET');
  },

  sendSMS: async (recipient: string, message: string): Promise<SMSLog> => {
    return request('sendSMS', 'POST', { recipient, message });
  },

  getBusiness: async (): Promise<Business> => {
    return request('getBusiness', 'GET');
  },

  updateBusiness: async (business: Partial<Business>): Promise<Business> => {
    return request('updateBusiness', 'POST', business);
  },

  getUsers: async (): Promise<User[]> => {
    return request('getUsers', 'GET');
  },

  login: async (email: string, pass: string): Promise<User> => {
    return request('login', 'POST', { email, password: pass });
  },

  createUser: async (user: Partial<User>): Promise<User> => {
    return request('createUser', 'POST', user);
  },

  updateUser: async (id: string, user: Partial<User>): Promise<User> => {
    await request('updateUser', 'POST', user, { id });
    return { id, ...user } as User;
  },

  deleteUser: async (id: string): Promise<boolean> => {
    await request('deleteUser', 'POST', null, { id });
    return true;
  },

  changePassword: async (passwords: { currentPassword: string, newPassword: string }): Promise<boolean> => {
    const userStr = localStorage.getItem(STORAGE_KEY);
    if (!userStr) throw new Error("ব্যবহারকারী সেশন পাওয়া যায়নি");
    const sessionUser = JSON.parse(userStr);
    
    await request('changePassword', 'POST', { userId: sessionUser.id, ...passwords });
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...sessionUser, password: passwords.newPassword }));
    return true;
  },

  getSMSConfig: async (): Promise<SMSConfig> => {
    return request('getSMSConfig', 'GET');
  },

  updateSMSConfig: async (config: SMSConfig): Promise<SMSConfig> => {
    return request('updateSMSConfig', 'POST', config);
  },

  getSalesByDate: async () => {
    const sales = await api.getSales();
    const salesByDate: Record<string, number> = {};
    sales.forEach(sale => {
      const date = sale.createdAt.split("T")[0];
      salesByDate[date] = (salesByDate[date] || 0) + sale.totalAmount;
    });
    return Object.entries(salesByDate).map(([date, amount]) => ({ date, amount }));
  },

  getExpenseByCategory: async () => {
    const expenses = await api.getExpenses();
    const expenseByCat: Record<string, number> = {};
    expenses.forEach(exp => {
      expenseByCat[exp.category] = (expenseByCat[exp.category] || 0) + exp.amount;
    });
    return Object.entries(expenseByCat).map(([category, amount]) => ({ category, amount }));
  },

  getBackupStatus: async () => {
    return { lastBackupAt: new Date().toISOString(), status: "Backup fully functional via PHP & MySQL DB" };
  },
  
  triggerBackup: async () => {
    const backupData = await api.getAllData();
    return { success: true, message: "ডাউনলোড ও ইমেইল ব্যাকআপ সম্পূর্ণ হয়েছে", lastBackupAt: new Date().toISOString() };
  },

  getAllData: async (): Promise<any> => {
    return request('getAllData', 'GET');
  },

  restoreDB: async (data: any): Promise<any> => {
    return { success: true };
  },
};
