-- HishabPati ERP & POS Database Schema
-- Compatible with MySQL 5.7+ / MariaDB

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 1. Businesses Table
CREATE TABLE IF NOT EXISTS `businesses` (
  `id` VARCHAR(128) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `address` TEXT DEFAULT NULL,
  `phone` VARCHAR(50) DEFAULT NULL,
  `currency` VARCHAR(10) DEFAULT 'BDT',
  `backupEmail` VARCHAR(255) DEFAULT NULL,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Users Table
CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(128) NOT NULL,
  `businessId` VARCHAR(128) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(50) DEFAULT NULL,
  `password` VARCHAR(255) NOT NULL, -- SHA-256 or bcrypt hash
  `role` ENUM('admin', 'manager', 'salesman', 'accountant', 'staff') NOT NULL DEFAULT 'salesman',
  `image` TEXT DEFAULT NULL,
  `permissions` TEXT DEFAULT NULL, -- JSON array of permitted operations
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_email` (`email`),
  CONSTRAINT `fk_users_business` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Categories Table
CREATE TABLE IF NOT EXISTS `categories` (
  `id` VARCHAR(128) NOT NULL,
  `businessId` VARCHAR(128) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_categories_business` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Products Table
CREATE TABLE IF NOT EXISTS `products` (
  `id` VARCHAR(128) NOT NULL,
  `businessId` VARCHAR(128) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `bnName` VARCHAR(200) DEFAULT NULL,
  `sku` VARCHAR(100) DEFAULT NULL,
  `barcode` VARCHAR(100) DEFAULT NULL,
  `barcodes` TEXT DEFAULT NULL, -- JSON array of serialized barcodes
  `categoryId` VARCHAR(128) DEFAULT NULL,
  `brandId` VARCHAR(128) DEFAULT NULL,
  `unit` VARCHAR(20) DEFAULT 'pcs',
  `purchasePrice` DECIMAL(15,2) DEFAULT '0.00',
  `salePrice` DECIMAL(15,2) NOT NULL DEFAULT '0.00',
  `stock` INT NOT NULL DEFAULT 0,
  `minStock` INT DEFAULT 5,
  `expiryDate` DATE DEFAULT NULL,
  `image` TEXT DEFAULT NULL,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_barcode` (`barcode`),
  CONSTRAINT `fk_products_business` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_products_category` FOREIGN KEY (`categoryId`) REFERENCES `categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Customers Table
CREATE TABLE IF NOT EXISTS `customers` (
  `id` VARCHAR(128) NOT NULL,
  `businessId` VARCHAR(128) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `email` VARCHAR(100) DEFAULT NULL,
  `address` TEXT DEFAULT NULL,
  `dueAmount` DECIMAL(15,2) DEFAULT '0.00',
  `totalSpent` DECIMAL(15,2) DEFAULT '0.00',
  `image` TEXT DEFAULT NULL,
  `createdBy` VARCHAR(128) DEFAULT NULL,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_customers_business` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Customer Payments Table
CREATE TABLE IF NOT EXISTS `customer_payments` (
  `id` VARCHAR(128) NOT NULL,
  `businessId` VARCHAR(128) NOT NULL,
  `customerId` VARCHAR(128) NOT NULL,
  `amount` DECIMAL(15,2) NOT NULL DEFAULT '0.00',
  `method` VARCHAR(50) NOT NULL,
  `date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_cust_pay_business` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cust_pay_customer` FOREIGN KEY (`customerId`) REFERENCES `customers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Sales Table
CREATE TABLE IF NOT EXISTS `sales` (
  `id` VARCHAR(128) NOT NULL,
  `businessId` VARCHAR(128) NOT NULL,
  `invoiceNo` VARCHAR(100) DEFAULT NULL,
  `customerId` VARCHAR(128) NOT NULL,
  `customerName` VARCHAR(255) DEFAULT NULL,
  `customerPhone` VARCHAR(50) DEFAULT NULL,
  `customerAddress` TEXT DEFAULT NULL,
  `totalAmount` DECIMAL(15,2) NOT NULL DEFAULT '0.00',
  `discount` DECIMAL(15,2) DEFAULT '0.00',
  `vat` DECIMAL(15,2) DEFAULT '0.00',
  `payableAmount` DECIMAL(15,2) NOT NULL DEFAULT '0.00',
  `paidAmount` DECIMAL(15,2) NOT NULL DEFAULT '0.00',
  `dueAmount` DECIMAL(15,2) DEFAULT '0.00',
  `paymentMethod` VARCHAR(50) DEFAULT 'Cash',
  `createdBy` VARCHAR(128) DEFAULT NULL,
  `userId` VARCHAR(128) DEFAULT NULL,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_sales_business` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Sale Items Table
CREATE TABLE IF NOT EXISTS `sale_items` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `saleId` VARCHAR(128) NOT NULL,
  `productId` VARCHAR(128) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `quantity` INT NOT NULL DEFAULT 1,
  `unitPrice` DECIMAL(15,2) NOT NULL,
  `discount` DECIMAL(15,2) DEFAULT '0.00',
  `discountPercent` DECIMAL(5,2) DEFAULT '0.00',
  `scannedBarcodes` TEXT DEFAULT NULL, -- JSON array of scanned items
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_sale_items_sale` FOREIGN KEY (`saleId`) REFERENCES `sales` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Expenses Table
CREATE TABLE IF NOT EXISTS `expenses` (
  `id` VARCHAR(128) NOT NULL,
  `businessId` VARCHAR(128) NOT NULL,
  `category` VARCHAR(100) NOT NULL,
  `amount` DECIMAL(15,2) NOT NULL DEFAULT '0.00',
  `description` TEXT DEFAULT NULL,
  `userId` VARCHAR(128) DEFAULT NULL,
  `date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_expenses_business` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Suppliers Table
CREATE TABLE IF NOT EXISTS `suppliers` (
  `id` VARCHAR(128) NOT NULL,
  `businessId` VARCHAR(128) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(50) DEFAULT NULL,
  `email` VARCHAR(100) DEFAULT NULL,
  `address` TEXT DEFAULT NULL,
  `company` VARCHAR(255) DEFAULT NULL,
  `dueAmount` DECIMAL(15,2) DEFAULT '0.00',
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_suppliers_business` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Supplier Transactions Table
CREATE TABLE IF NOT EXISTS `supplier_transactions` (
  `id` VARCHAR(128) NOT NULL,
  `businessId` VARCHAR(128) NOT NULL,
  `supplierId` VARCHAR(128) NOT NULL,
  `amount` DECIMAL(15,2) NOT NULL DEFAULT '0.00',
  `type` ENUM('purchase', 'payment') NOT NULL,
  `description` TEXT DEFAULT NULL,
  `date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_sup_trans_business` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sup_trans_supplier` FOREIGN KEY (`supplierId`) REFERENCES `suppliers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. SMS Config Table
CREATE TABLE IF NOT EXISTS `sms_config` (
  `businessId` VARCHAR(128) NOT NULL,
  `provider` VARCHAR(100) NOT NULL DEFAULT 'Default',
  `apiKey` VARCHAR(255) DEFAULT NULL,
  `apiUser` VARCHAR(255) DEFAULT NULL,
  `senderId` VARCHAR(100) DEFAULT NULL,
  PRIMARY KEY (`businessId`),
  CONSTRAINT `fk_sms_config_business` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. SMS Logs Table
CREATE TABLE IF NOT EXISTS `sms_logs` (
  `id` VARCHAR(128) NOT NULL,
  `businessId` VARCHAR(128) NOT NULL,
  `recipient` VARCHAR(100) NOT NULL,
  `message` TEXT NOT NULL,
  `status` ENUM('sent', 'failed') NOT NULL DEFAULT 'sent',
  `error` TEXT DEFAULT NULL,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_sms_logs_business` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- Seed Default Admin Credentials
INSERT INTO `businesses` (`id`, `name`, `address`, `phone`, `currency`) VALUES
('main-business', 'HishabPati Smart Business', 'Dhaka, Bangladesh', '01700000000', 'BDT');

-- password is: password (plain text, or matching the app's standard login system matching `storedPassword === passwordTrim` literal comparison from api.ts)
INSERT INTO `users` (`id`, `businessId`, `name`, `email`, `phone`, `password`, `role`) VALUES
('1', 'main-business', 'Default Admin', 'admin@smartbusiness.com', '01700000000', 'admin123', 'admin'),
('boot-1', 'main-business', 'Momin Khan', 'mominkhan051220@gmail.com', '01711111111', 'momin123', 'admin'),
('boot-2', 'main-business', 'Apon Dreem', 'apondreem@gmail.com', '01722222222', 'apon123', 'admin');
