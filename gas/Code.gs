/**
 * Google Apps Script Backend for HishabPati ERP
 * Paste this into a Google Apps Script project bound to your spreadsheet.
 */

const SPREADSHEET_ID = '1-xkdlFhfCxxHcnUmW6iHxq954QeYUQJgESpV-sWubzU'; // Your provided spreadsheet ID

function doGet(e) {
  const action = e.parameter.action;
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  if (action === 'getDashboard') {
    return createResponse(handleGetDashboard(sheet));
  } else if (action === 'getProducts') {
    return createResponse(getData(sheet, 'PRODUCTS'));
  } else if (action === 'getCustomers') {
    return createResponse(getData(sheet, 'CUSTOMERS'));
  }
  
  return createResponse({ error: 'Invalid action' });
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const action = data.action;
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID);

  if (action === 'createSale') {
    return createResponse(handleCreateSale(sheet, data.payload));
  }
  
  return createResponse({ error: 'Invalid action' });
}

function handleGetDashboard(ss) {
  const sales = getData(ss, 'SALES');
  const products = getData(ss, 'PRODUCTS');
  const customers = getData(ss, 'CUSTOMERS');
  const expenses = getData(ss, 'EXPENSES');

  const today = new Date().toISOString().split('T')[0];
  const todaySales = sales
    .filter(s => s.createdAt.startsWith(today))
    .reduce((acc, s) => acc + (parseFloat(s.totalAmount) || 0), 0);

  return {
    todaySales,
    totalProducts: products.length,
    lowStockCount: products.filter(p => p.stock <= p.minStock).length,
    totalDue: customers.reduce((acc, c) => acc + (parseFloat(c.dueAmount) || 0), 0)
  };
}

function handleCreateSale(ss, payload) {
  const salesSheet = ss.getSheetByName('SALES');
  const saleItemSheet = ss.getSheetByName('SALE_ITEMS');
  const productsSheet = ss.getSheetByName('PRODUCTS');
  
  // Basic implementation: append to sheets
  // In a real app, you'd use Batch updates and LockService
  const invoiceNo = 'INV-' + (salesSheet.getLastRow() + 1000);
  const saleId = 'S-' + Date.now();
  
  salesSheet.appendRow([
    saleId, invoiceNo, payload.customerId, payload.userId, 
    payload.totalAmount, payload.discount, payload.vat, 
    payload.payableAmount, payload.paidAmount, payload.dueAmount,
    payload.paymentMethod, new Date().toISOString()
  ]);
  
  payload.items.forEach(item => {
    saleItemSheet.appendRow([
      saleId, item.productId, item.name, item.quantity, item.unitPrice, item.subtotal
    ]);
    
    // Update Stock (very slow in GAS if done in loop, better to batch)
    updateStock(productsSheet, item.productId, item.quantity);
  });
  
  return { success: true, invoiceNo };
}

function updateStock(sheet, productId, quantity) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === productId) {
      const currentStock = data[i][8]; // Assuming Column I is stock
      sheet.getRange(i + 1, 9).setValue(currentStock - quantity);
      break;
    }
  }
}

function getData(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const rows = values.slice(1);
  return rows.map(row => {
    let obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function createResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
