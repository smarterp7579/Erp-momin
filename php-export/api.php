<?php
/**
 * HishabPati Smart ERP & POS - Unified PHP Rest API Endpoint
 * 
 * Instructions:
 * 1. Place this file in your website directory (e.g. /public_html/api/api.php)
 * 2. Configure the database credentials below.
 * 3. Point your frontend to this API.
 */

// Error reporting & Headers
error_reporting(E_ALL);
ini_set('display_errors', 0);
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Content-Type: application/json; charset=UTF-8");

// Handle CORS Pre-flight Options Request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// ==========================================
// 1. DATABASE CONFIGURATION
// ==========================================
define('DB_HOST', 'sql309.infinityfree.com');
define('DB_NAME', 'if0_42076833_momin7579');
define('DB_USER', 'if0_42076833');
define('DB_PASS', 'Mominkhan7579');

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================
function getDbConnection() {
    try {
        $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4";
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];
        return new PDO($dsn, DB_USER, DB_PASS, $options);
    } catch (PDOException $e) {
        respondError("Database Connection Failed: " . $e->getMessage(), 500);
    }
}

function respondJson($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit();
}

function respondError($message, $status = 400) {
    respondJson(['error' => $message], $status);
}

function getJsonInput() {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function generateUuid() {
    return sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        mt_rand(0, 0xffff), mt_rand(0, 0xffff),
        mt_rand(0, 0xffff),
        mt_rand(0, 0x0fff) | 0x4000,
        mt_rand(0, 0x3fff) | 0x8000,
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
    );
}

// Resolve the Current Business Context
// Real multi-tenant architectures extract the business ID from a custom header or token
$headers = getallheaders();
$businessId = isset($headers['X-Business-ID']) ? $headers['X-Business-ID'] : 'main-business';
if (isset($_GET['businessId'])) {
    $businessId = $_GET['businessId'];
}

// Ensure the requested business exists, otherwise initialize it
$pdo = getDbConnection();
$stmt = $pdo->prepare("SELECT id FROM businesses WHERE id = ?");
$stmt->execute([$businessId]);
if (!$stmt->fetch()) {
    $stmt = $pdo->prepare("INSERT INTO businesses (id, name) VALUES (?, 'My Smart Business')");
    $stmt->execute([$businessId]);
}

// Route request actions
$action = isset($_GET['action']) ? $_GET['action'] : '';

switch ($action) {
    
    // ==========================================
    // AUTH & USERS
    // ==========================================
    case 'login':
        $input = getJsonInput();
        $email = isset($input['email']) ? strtolower(trim($input['email'])) : '';
        $password = isset($input['password']) ? trim($input['password']) : '';
        
        $stmt = $pdo->prepare("SELECT * FROM users WHERE LOWER(email) = ?");
        $stmt->execute([$email]);
        $user = $stmt->fetch();
        
        if (!$user) {
            respondError("এই ইমেইল দিয়ে কোনো অ্যাকাউন্ট পাওয়া যায়নি!", 404);
        }
        
        // Simple plain password comparison compatible with seed default
        if ($user['password'] !== $password) {
            respondError("পাসওয়ার্ডটি সঠিক নয়!", 401);
        }
        
        // Deserialize JSON lists
        if (!empty($user['permissions'])) {
            $user['permissions'] = json_decode($user['permissions'], true);
        }
        
        unset($user['password']); // Obscure password
        respondJson($user);
        break;

    case 'getUsers':
        $stmt = $pdo->prepare("SELECT id, businessId, name, email, phone, role, image, permissions, createdAt FROM users WHERE businessId = ?");
        $stmt->execute([$businessId]);
        $users = $stmt->fetchAll();
        foreach ($users as &$u) {
            $u['permissions'] = !empty($u['permissions']) ? json_decode($u['permissions'], true) : [];
        }
        respondJson($users);
        break;

    case 'createUser':
        $input = getJsonInput();
        $id = isset($input['id']) ? $input['id'] : generateUuid();
        $name = isset($input['name']) ? $input['name'] : '';
        $email = isset($input['email']) ? strtolower(trim($input['email'])) : '';
        $phone = isset($input['phone']) ? $input['phone'] : '';
        $password = isset($input['password']) ? $input['password'] : '123456';
        $role = isset($input['role']) ? $input['role'] : 'salesman';
        $image = isset($input['image']) ? $input['image'] : null;
        $permissions = isset($input['permissions']) ? json_encode($input['permissions'], JSON_UNESCAPED_UNICODE) : null;
        
        // Prevent duplicate emails
        $stmt = $pdo->prepare("SELECT id FROM users WHERE email = ? AND id != ?");
        $stmt->execute([$email, $id]);
        if ($stmt->fetch()) {
            respondError("এই ইমেইল দিয়ে ইতঃমধ্যেই একটি অ্যাকাউন্ট আছে।", 400);
        }

        $stmt = $pdo->prepare("REPLACE INTO users (id, businessId, name, email, phone, password, role, image, permissions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$id, $businessId, $name, $email, $phone, $password, $role, $image, $permissions]);
        
        respondJson([
            'id' => $id, 
            'businessId' => $businessId, 
            'name' => $name, 
            'email' => $email, 
            'phone' => $phone, 
            'role' => $role,
            'permissions' => isset($input['permissions']) ? $input['permissions'] : []
        ]);
        break;

    case 'updateUser':
        $id = isset($_GET['id']) ? $_GET['id'] : '';
        $input = getJsonInput();
        if (empty($id)) respondError("User ID required");
        
        $fields = [];
        $params = [];
        
        $updatable = ['name', 'email', 'phone', 'role', 'image', 'permissions'];
        foreach ($updatable as $col) {
            if (array_key_exists($col, $input)) {
                $fields[] = "`$col` = ?";
                $params[] = ($col === 'permissions') ? json_encode($input[$col], JSON_UNESCAPED_UNICODE) : $input[$col];
            }
        }
        
        if (empty($fields)) respondError("No parameters to update");
        
        $params[] = $id;
        $params[] = $businessId;
        
        $stmt = $pdo->prepare("UPDATE users SET " . implode(", ", $fields) . " WHERE id = ? AND businessId = ?");
        $stmt->execute($params);
        
        respondJson(['success' => true]);
        break;

    case 'deleteUser':
        $id = isset($_GET['id']) ? $_GET['id'] : '';
        if (empty($id)) respondError("User id field required");
        $stmt = $pdo->prepare("DELETE FROM users WHERE id = ? AND businessId = ?");
        $stmt->execute([$id, $businessId]);
        respondJson(['success' => true]);
        break;

    case 'changePassword':
        $input = getJsonInput();
        $userId = isset($input['userId']) ? $input['userId'] : '';
        $currentPassword = isset($input['currentPassword']) ? $input['currentPassword'] : '';
        $newPassword = isset($input['newPassword']) ? $input['newPassword'] : '';
        
        $stmt = $pdo->prepare("SELECT password FROM users WHERE id = ? AND businessId = ?");
        $stmt->execute([$userId, $businessId]);
        $dbPass = $stmt->fetchColumn();
        
        if (!$dbPass || $dbPass !== $currentPassword) {
            respondError("বর্তমান পাসওয়ার্ডটি সঠিক নয়!");
        }
        
        $stmt = $pdo->prepare("UPDATE users SET password = ? WHERE id = ? AND businessId = ?");
        $stmt->execute([$newPassword, $userId, $businessId]);
        respondJson(['success' => true]);
        break;

    // ==========================================
    // BUSINESS PROFILE
    // ==========================================
    case 'getBusiness':
        $stmt = $pdo->prepare("SELECT * FROM businesses WHERE id = ?");
        $stmt->execute([$businessId]);
        $bus = $stmt->fetch();
        if (!$bus) {
            $bus = ['id' => $businessId, 'name' => 'Smart Business', 'address' => '', 'phone' => '', 'currency' => 'BDT'];
        }
        respondJson($bus);
        break;

    case 'updateBusiness':
        $input = getJsonInput();
        $name = isset($input['name']) ? $input['name'] : 'Smart Business';
        $address = isset($input['address']) ? $input['address'] : '';
        $phone = isset($input['phone']) ? $input['phone'] : '';
        $currency = isset($input['currency']) ? $input['currency'] : 'BDT';
        $backupEmail = isset($input['backupEmail']) ? $input['backupEmail'] : '';
        
        $stmt = $pdo->prepare("INSERT INTO businesses (id, name, address, phone, currency, backupEmail) VALUES (?, ?, ?, ?, ?, ?) 
                               ON DUPLICATE KEY UPDATE name = VALUES(name), address = VALUES(address), phone = VALUES(phone), currency = VALUES(currency), backupEmail = VALUES(backupEmail)");
        $stmt->execute([$businessId, $name, $address, $phone, $currency, $backupEmail]);
        respondJson(['id' => $businessId, 'name' => $name, 'address' => $address, 'phone' => $phone, 'currency' => $currency, 'backupEmail' => $backupEmail]);
        break;

    // ==========================================
    // PRODUCTS & CATEGORIES
    // ==========================================
    case 'getProducts':
        $stmt = $pdo->prepare("SELECT * FROM products WHERE businessId = ? ORDER BY name ASC");
        $stmt->execute([$businessId]);
        $products = $stmt->fetchAll();
        foreach ($products as &$p) {
            $p['barcodes'] = !empty($p['barcodes']) ? json_decode($p['barcodes'], true) : [];
            // Cast numeric strings to standard values for type safety
            $p['purchasePrice'] = (float)$p['purchasePrice'];
            $p['salePrice'] = (float)$p['salePrice'];
            $p['stock'] = (int)$p['stock'];
            $p['minStock'] = (int)$p['minStock'];
        }
        respondJson($products);
        break;

    case 'createProduct':
        $input = getJsonInput();
        $id = generateUuid();
        $name = isset($input['name']) ? $input['name'] : '';
        $bnName = isset($input['bnName']) ? $input['bnName'] : null;
        $sku = isset($input['sku']) ? $input['sku'] : null;
        $barcode = isset($input['barcode']) ? $input['barcode'] : null;
        $barcodes = isset($input['barcodes']) ? json_encode($input['barcodes'], JSON_UNESCAPED_UNICODE) : null;
        $categoryId = isset($input['categoryId']) ? $input['categoryId'] : null;
        $brandId = isset($input['brandId']) ? $input['brandId'] : null;
        $unit = isset($input['unit']) ? $input['unit'] : 'pcs';
        $purchasePrice = isset($input['purchasePrice']) ? (float)$input['purchasePrice'] : 0.00;
        $salePrice = isset($input['salePrice']) ? (float)$input['salePrice'] : 0.00;
        $stock = isset($input['stock']) ? (int)$input['stock'] : 0;
        $minStock = isset($input['minStock']) ? (int)$input['minStock'] : 5;
        $expiryDate = !empty($input['expiryDate']) ? $input['expiryDate'] : null;
        $image = isset($input['image']) ? $input['image'] : null;

        $stmt = $pdo->prepare("INSERT INTO products (id, businessId, name, bnName, sku, barcode, barcodes, categoryId, brandId, unit, purchasePrice, salePrice, stock, minStock, expiryDate, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$id, $businessId, $name, $bnName, $sku, $barcode, $barcodes, $categoryId, $brandId, $unit, $purchasePrice, $salePrice, $stock, $minStock, $expiryDate, $image]);
        
        $input['id'] = $id;
        respondJson($input);
        break;

    case 'createProductsBatch':
        $input = getJsonInput();
        if (!is_array($input)) respondError("JSON Array required");
        
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare("INSERT INTO products (id, businessId, name, bnName, sku, barcode, barcodes, categoryId, brandId, unit, purchasePrice, salePrice, stock, minStock, expiryDate, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            foreach ($input as $p) {
                $id = generateUuid();
                $name = isset($p['name']) ? $p['name'] : '';
                $bnName = isset($p['bnName']) ? $p['bnName'] : null;
                $sku = isset($p['sku']) ? $p['sku'] : null;
                $barcode = isset($p['barcode']) ? $p['barcode'] : null;
                $barcodes = isset($p['barcodes']) ? json_encode($p['barcodes'], JSON_UNESCAPED_UNICODE) : null;
                $categoryId = isset($p['categoryId']) ? $p['categoryId'] : null;
                $brandId = isset($p['brandId']) ? $p['brandId'] : null;
                $unit = isset($p['unit']) ? $p['unit'] : 'pcs';
                $purchasePrice = isset($p['purchasePrice']) ? (float)$p['purchasePrice'] : 0.00;
                $salePrice = isset($p['salePrice']) ? (float)$p['salePrice'] : 0.00;
                $stock = isset($p['stock']) ? (int)$p['stock'] : 0;
                $minStock = isset($p['minStock']) ? (int)$p['minStock'] : 5;
                $expiryDate = !empty($p['expiryDate']) ? $p['expiryDate'] : null;
                $image = isset($p['image']) ? $p['image'] : null;
                
                $stmt->execute([$id, $businessId, $name, $bnName, $sku, $barcode, $barcodes, $categoryId, $brandId, $unit, $purchasePrice, $salePrice, $stock, $minStock, $expiryDate, $image]);
            }
            $pdo->commit();
            respondJson(['success' => true]);
        } catch (Exception $e) {
            $pdo->rollBack();
            respondError("Batch insert failed: " . $e->getMessage());
        }
        break;

    case 'updateProduct':
        $id = isset($_GET['id']) ? $_GET['id'] : '';
        $input = getJsonInput();
        if (empty($id)) respondError("Product id required");
        
        $fields = [];
        $params = [];
        $cols = ['name', 'bnName', 'sku', 'barcode', 'barcodes', 'categoryId', 'brandId', 'unit', 'purchasePrice', 'salePrice', 'stock', 'minStock', 'expiryDate', 'image'];
        foreach ($cols as $col) {
            if (array_key_exists($col, $input)) {
                $fields[] = "`$col` = ?";
                $params[] = ($col === 'barcodes') ? json_encode($input[$col], JSON_UNESCAPED_UNICODE) : $input[$col];
            }
        }
        
        if (empty($fields)) respondError("Nothing to update");
        $params[] = $id;
        $params[] = $businessId;
        
        $stmt = $pdo->prepare("UPDATE products SET " . implode(", ", $fields) . " WHERE id = ? AND businessId = ?");
        $stmt->execute($params);
        respondJson(['id' => $id]);
        break;

    case 'deleteProduct':
        $id = $_GET['id'];
        $stmt = $pdo->prepare("DELETE FROM products WHERE id = ? AND businessId = ?");
        $stmt->execute([$id, $businessId]);
        respondJson(['success' => true]);
        break;

    case 'getCategories':
        $stmt = $pdo->prepare("SELECT * FROM categories WHERE businessId = ?");
        $stmt->execute([$businessId]);
        respondJson($stmt->fetchAll());
        break;

    case 'createCategory':
        $input = getJsonInput();
        $id = generateUuid();
        $name = isset($input['name']) ? $input['name'] : '';
        $stmt = $pdo->prepare("INSERT INTO categories (id, businessId, name) VALUES (?, ?, ?)");
        $stmt->execute([$id, $businessId, $name]);
        respondJson(['id' => $id, 'name' => $name]);
        break;

    // ==========================================
    // CUSTOMERS & DUE PAYMENTS
    // ==========================================
    case 'getCustomers':
        $userId = isset($_GET['userId']) ? $_GET['userId'] : '';
        if (!empty($userId)) {
            $stmt = $pdo->prepare("SELECT * FROM customers WHERE businessId = ? AND createdBy = ? ORDER BY name ASC");
            $stmt->execute([$businessId, $userId]);
        } else {
            $stmt = $pdo->prepare("SELECT * FROM customers WHERE businessId = ? ORDER BY name ASC");
            $stmt->execute([$businessId]);
        }
        $customers = $stmt->fetchAll();
        foreach ($customers as &$c) {
            $c['dueAmount'] = (float)$c['dueAmount'];
            $c['totalSpent'] = (float)$c['totalSpent'];
        }
        respondJson($customers);
        break;

    case 'createCustomer':
        $input = getJsonInput();
        $id = generateUuid();
        $name = isset($input['name']) ? $input['name'] : '';
        $phone = isset($input['phone']) ? $input['phone'] : '';
        $email = isset($input['email']) ? $input['email'] : null;
        $address = isset($input['address']) ? $input['address'] : null;
        $dueAmount = isset($input['dueAmount']) ? (float)$input['dueAmount'] : 0.00;
        $totalSpent = isset($input['totalSpent']) ? (float)$input['totalSpent'] : 0.00;
        $image = isset($input['image']) ? $input['image'] : null;
        $createdBy = isset($input['createdBy']) ? $input['createdBy'] : null;

        $stmt = $pdo->prepare("INSERT INTO customers (id, businessId, name, phone, email, address, dueAmount, totalSpent, image, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$id, $businessId, $name, $phone, $email, $address, $dueAmount, $totalSpent, $image, $createdBy]);
        
        $input['id'] = $id;
        respondJson($input);
        break;

    case 'createCustomersBatch':
        $input = getJsonInput();
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare("INSERT INTO customers (id, businessId, name, phone, email, address, dueAmount, totalSpent, image, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            foreach ($input as $c) {
                $id = generateUuid();
                $name = isset($c['name']) ? $c['name'] : '';
                $phone = isset($c['phone']) ? $c['phone'] : '';
                $email = isset($c['email']) ? $c['email'] : null;
                $address = isset($c['address']) ? $c['address'] : null;
                $dueAmount = isset($c['dueAmount']) ? (float)$c['dueAmount'] : 0.00;
                $totalSpent = isset($c['totalSpent']) ? (float)$c['totalSpent'] : 0.00;
                $image = isset($c['image']) ? $c['image'] : null;
                $createdBy = isset($c['createdBy']) ? $c['createdBy'] : null;
                
                $stmt->execute([$id, $businessId, $name, $phone, $email, $address, $dueAmount, $totalSpent, $image, $createdBy]);
            }
            $pdo->commit();
            respondJson(['success' => true]);
        } catch (Exception $e) {
            $pdo->rollBack();
            respondError($e->getMessage());
        }
        break;

    case 'updateCustomer':
        $id = isset($_GET['id']) ? $_GET['id'] : '';
        $input = getJsonInput();
        if (empty($id)) respondError("Customer status id required");
        
        $fields = [];
        $params = [];
        $cols = ['name', 'phone', 'email', 'address', 'dueAmount', 'totalSpent', 'image'];
        foreach ($cols as $col) {
            if (array_key_exists($col, $input)) {
                $fields[] = "`$col` = ?";
                $params[] = $input[$col];
            }
        }
        
        if (empty($fields)) respondError("No data sent");
        $params[] = $id;
        $params[] = $businessId;
        
        $stmt = $pdo->prepare("UPDATE customers SET " . implode(", ", $fields) . " WHERE id = ? AND businessId = ?");
        $stmt->execute($params);
        respondJson(['success' => true]);
        break;

    case 'deleteCustomer':
        $id = $_GET['id'];
        $stmt = $pdo->prepare("DELETE FROM customers WHERE id = ? AND businessId = ?");
        $stmt->execute([$id, $businessId]);
        respondJson(['success' => true]);
        break;

    case 'recordPayment':
        $input = getJsonInput();
        $id = generateUuid();
        $customerId = isset($input['customerId']) ? $input['customerId'] : '';
        $amount = isset($input['amount']) ? (float)$input['amount'] : 0.00;
        $method = isset($input['method']) ? $input['method'] : 'Cash';
        
        $pdo->beginTransaction();
        try {
            // Subtract customer balance
            $stmt = $pdo->prepare("UPDATE customers SET dueAmount = dueAmount - ? WHERE id = ? AND businessId = ?");
            $stmt->execute([$amount, $customerId, $businessId]);
            
            // Log pay action
            $stmt = $pdo->prepare("INSERT INTO customer_payments (id, businessId, customerId, amount, method) VALUES (?, ?, ?, ?, ?)");
            $stmt->execute([$id, $businessId, $customerId, $amount, $method]);
            
            $pdo->commit();
            respondJson(['success' => true]);
        } catch (Exception $e) {
            $pdo->rollBack();
            respondError($e->getMessage());
        }
        break;

    // ==========================================
    // SALES MANAGEMENT
    // ==========================================
    case 'getSales':
        $userId = isset($_GET['userId']) ? $_GET['userId'] : '';
        if (!empty($userId)) {
            $stmt = $pdo->prepare("SELECT * FROM sales WHERE businessId = ? AND (userId = ? OR createdBy = ?) ORDER BY createdAt DESC");
            $stmt->execute([$businessId, $userId, $userId]);
        } else {
            $stmt = $pdo->prepare("SELECT * FROM sales WHERE businessId = ? ORDER BY createdAt DESC");
            $stmt->execute([$businessId]);
        }
        $sales = $stmt->fetchAll();
        
        // Fetch Items for each sale
        foreach ($sales as &$sale) {
            $stmt = $pdo->prepare("SELECT * FROM sale_items WHERE saleId = ?");
            $stmt->execute([$sale['id']]);
            $items = $stmt->fetchAll();
            foreach ($items as &$item) {
                $item['scannedBarcodes'] = !empty($item['scannedBarcodes']) ? json_decode($item['scannedBarcodes'], true) : [];
                $item['unitPrice'] = (float)$item['unitPrice'];
                $item['quantity'] = (int)$item['quantity'];
                $item['discount'] = (float)$item['discount'];
                $item['discountPercent'] = (float)$item['discountPercent'];
            }
            $sale['items'] = $items;
            $sale['totalAmount'] = (float)$sale['totalAmount'];
            $sale['payableAmount'] = (float)$sale['payableAmount'];
            $sale['paidAmount'] = (float)$sale['paidAmount'];
            $sale['dueAmount'] = (float)$sale['dueAmount'];
        }
        
        respondJson($sales);
        break;

    case 'createSale':
        $input = getJsonInput();
        $id = generateUuid();
        $invoiceNo = isset($input['invoiceNo']) ? $input['invoiceNo'] : 'INV-' . mt_rand(100000, 999999);
        $customerId = isset($input['customerId']) ? $input['customerId'] : 'walking';
        $customerName = isset($input['customerName']) ? $input['customerName'] : null;
        $customerPhone = isset($input['customerPhone']) ? $input['customerPhone'] : null;
        $customerAddress = isset($input['customerAddress']) ? $input['customerAddress'] : null;
        $totalAmount = isset($input['totalAmount']) ? (float)$input['totalAmount'] : 0.00;
        $discount = isset($input['discount']) ? (float)$input['discount'] : 0.00;
        $vat = isset($input['vat']) ? (float)$input['vat'] : 0.00;
        $payableAmount = isset($input['payableAmount']) ? (float)$input['payableAmount'] : 0.00;
        $paidAmount = isset($input['paidAmount']) ? (float)$input['paidAmount'] : 0.00;
        $dueAmount = isset($input['dueAmount']) ? (float)$input['dueAmount'] : 0.00;
        $paymentMethod = isset($input['paymentMethod']) ? $input['paymentMethod'] : 'Cash';
        $createdBy = isset($input['createdBy']) ? $input['createdBy'] : null;
        $userId = isset($input['userId']) ? $input['userId'] : null;
        $items = isset($input['items']) ? $input['items'] : [];

        $pdo->beginTransaction();
        try {
            // Write Primary Sale Information
            $stmt = $pdo->prepare("INSERT INTO sales (id, businessId, invoiceNo, customerId, customerName, customerPhone, customerAddress, totalAmount, discount, vat, payableAmount, paidAmount, dueAmount, paymentMethod, createdBy, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([$id, $businessId, $invoiceNo, $customerId, $customerName, $customerPhone, $customerAddress, $totalAmount, $discount, $vat, $payableAmount, $paidAmount, $dueAmount, $paymentMethod, $createdBy, $userId]);
            
            // Loop through sell lines
            $itemStmt = $pdo->prepare("INSERT INTO sale_items (saleId, productId, name, quantity, unitPrice, discount, discountPercent, scannedBarcodes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
            foreach ($items as $item) {
                $pId = $item['productId'];
                $qty = (int)$item['quantity'];
                
                // Deduct inventory
                $pStmt = $pdo->prepare("SELECT barcodes, stock FROM products WHERE id = ? AND businessId = ?");
                $pStmt->execute([$pId, $businessId]);
                $prod = $pStmt->fetch();
                
                if ($prod) {
                    $existingBarcodes = !empty($prod['barcodes']) ? json_decode($prod['barcodes'], true) : [];
                    $scanned = isset($item['scannedBarcodes']) ? $item['scannedBarcodes'] : [];
                    
                    // Filter scanned items out of master barcodes
                    if (is_array($scanned) && count($scanned) > 0) {
                        $existingBarcodes = array_values(array_diff($existingBarcodes, $scanned));
                    }
                    
                    $updateP = $pdo->prepare("UPDATE products SET stock = stock - ?, barcodes = ? WHERE id = ? AND businessId = ?");
                    $updateP->execute([$qty, json_encode($existingBarcodes, JSON_UNESCAPED_UNICODE), $pId, $businessId]);
                }
                
                $itemStmt->execute([
                    $id,
                    $pId,
                    $item['name'],
                    $qty,
                    (float)$item['unitPrice'],
                    isset($item['discount']) ? (float)$item['discount'] : 0.00,
                    isset($item['discountPercent']) ? (float)$item['discountPercent'] : 0.00,
                    isset($item['scannedBarcodes']) ? json_encode($item['scannedBarcodes'], JSON_UNESCAPED_UNICODE) : null
                ]);
            }
            
            // Update customer totalSpent & dueAmount
            if ($customerId !== 'walking') {
                $cStmt = $pdo->prepare("UPDATE customers SET dueAmount = dueAmount + ?, totalSpent = totalSpent + ? WHERE id = ? AND businessId = ?");
                $cStmt->execute([$dueAmount, $payableAmount, $customerId, $businessId]);
            }
            
            $pdo->commit();
            respondJson(['id' => $id, 'invoiceNo' => $invoiceNo]);
        } catch (Exception $e) {
            $pdo->rollBack();
            respondError($e->getMessage());
        }
        break;

    case 'deleteSale':
        $id = isset($_GET['id']) ? $_GET['id'] : '';
        if (empty($id)) respondError("Sale ID required");
        
        $pdo->beginTransaction();
        try {
            // Find sale details
            $stmt = $pdo->prepare("SELECT * FROM sales WHERE id = ? AND businessId = ?");
            $stmt->execute([$id, $businessId]);
            $sale = $stmt->fetch();
            
            if (!$sale) throw new Exception("সরাসরি ইনভয়েসটি পাওয়া যায়নি।");
            
            // Fetch sale items
            $stmt = $pdo->prepare("SELECT * FROM sale_items WHERE saleId = ?");
            $stmt->execute([$id]);
            $items = $stmt->fetchAll();
            
            // Refund product inventory stock levels
            foreach ($items as $item) {
                $pId = $item['productId'];
                $qty = (int)$item['quantity'];
                $scanned = !empty($item['scannedBarcodes']) ? json_decode($item['scannedBarcodes'], true) : [];
                
                $pStmt = $pdo->prepare("SELECT barcodes FROM products WHERE id = ? AND businessId = ?");
                $pStmt->execute([$pId, $businessId]);
                $prod = $pStmt->fetch();
                
                if ($prod) {
                    $existingBarcodes = !empty($prod['barcodes']) ? json_decode($prod['barcodes'], true) : [];
                    if (is_array($scanned) && count($scanned) > 0) {
                        $existingBarcodes = array_values(array_unique(array_merge($existingBarcodes, $scanned)));
                    }
                    
                    $updateP = $pdo->prepare("UPDATE products SET stock = stock + ?, barcodes = ? WHERE id = ? AND businessId = ?");
                    $updateP->execute([$qty, json_encode($existingBarcodes, JSON_UNESCAPED_UNICODE), $pId, $businessId]);
                }
            }
            
            // Refund Customer Credit Limit / Balances
            $customerId = $sale['customerId'];
            if ($customerId !== 'walking') {
                $refundDue = (float)$sale['dueAmount'];
                $refundSpent = (float)$sale['payableAmount'];
                
                $cStmt = $pdo->prepare("UPDATE customers SET dueAmount = dueAmount - ?, totalSpent = totalSpent - ? WHERE id = ? AND businessId = ?");
                $cStmt->execute([$refundDue, $refundSpent, $customerId, $businessId]);
            }
            
            // Terminate sale entries safely cascading items
            $stmt = $pdo->prepare("DELETE FROM sales WHERE id = ? AND businessId = ?");
            $stmt->execute([$id, $businessId]);
            
            $pdo->commit();
            respondJson(['success' => true]);
        } catch (Exception $e) {
            $pdo->rollBack();
            respondError($e->getMessage());
        }
        break;

    // ==========================================
    // SUPPLIERS
    // ==========================================
    case 'getSuppliers':
        $stmt = $pdo->prepare("SELECT * FROM suppliers WHERE businessId = ? ORDER BY name ASC");
        $stmt->execute([$businessId]);
        $sups = $stmt->fetchAll();
        foreach ($sups as &$s) {
            $s['dueAmount'] = (float)$s['dueAmount'];
        }
        respondJson($sups);
        break;

    case 'createSupplier':
        $input = getJsonInput();
        $id = generateUuid();
        $name = isset($input['name']) ? $input['name'] : '';
        $phone = isset($input['phone']) ? $input['phone'] : '';
        $email = isset($input['email']) ? $input['email'] : null;
        $address = isset($input['address']) ? $input['address'] : null;
        $company = isset($input['company']) ? $input['company'] : null;
        $dueAmount = isset($input['dueAmount']) ? (float)$input['dueAmount'] : 0.00;

        $stmt = $pdo->prepare("INSERT INTO suppliers (id, businessId, name, phone, email, address, company, dueAmount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$id, $businessId, $name, $phone, $email, $address, $company, $dueAmount]);
        
        $input['id'] = $id;
        respondJson($input);
        break;

    case 'createSuppliersBatch':
        $input = getJsonInput();
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare("INSERT INTO suppliers (id, businessId, name, phone, email, address, company, dueAmount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
            foreach ($input as $s) {
                $id = generateUuid();
                $name = isset($s['name']) ? $s['name'] : '';
                $phone = isset($s['phone']) ? $s['phone'] : '';
                $email = isset($s['email']) ? $s['email'] : null;
                $address = isset($s['address']) ? $s['address'] : null;
                $company = isset($s['company']) ? $s['company'] : null;
                $dueAmount = isset($s['dueAmount']) ? (float)$s['dueAmount'] : 0.00;
                
                $stmt->execute([$id, $businessId, $name, $phone, $email, $address, $company, $dueAmount]);
            }
            $pdo->commit();
            respondJson(['success' => true]);
        } catch (Exception $e) {
            $pdo->rollBack();
            respondError($e->getMessage());
        }
        break;

    case 'updateSupplier':
        $id = isset($_GET['id']) ? $_GET['id'] : '';
        $input = getJsonInput();
        if (empty($id)) respondError("ID required");
        
        $fields = [];
        $params = [];
        $cols = ['name', 'phone', 'email', 'address', 'company', 'dueAmount'];
        foreach ($cols as $col) {
            if (array_key_exists($col, $input)) {
                $fields[] = "`$col` = ?";
                $params[] = $input[$col];
            }
        }
        if (empty($fields)) respondError("No parameters");
        $params[] = $id;
        $params[] = $businessId;
        
        $stmt = $pdo->prepare("UPDATE suppliers SET " . implode(", ", $fields) . " WHERE id = ? AND businessId = ?");
        $stmt->execute($params);
        respondJson(['success' => true]);
        break;

    case 'deleteSupplier':
        $id = $_GET['id'];
        $stmt = $pdo->prepare("DELETE FROM suppliers WHERE id = ? AND businessId = ?");
        $stmt->execute([$id, $businessId]);
        respondJson(['success' => true]);
        break;

    case 'getSupplierTransactions':
        $id = isset($_GET['id']) ? $_GET['id'] : '';
        $stmt = $pdo->prepare("SELECT * FROM supplier_transactions WHERE supplierId = ? AND businessId = ? ORDER BY date DESC");
        $stmt->execute([$id, $businessId]);
        $trans = $stmt->fetchAll();
        foreach ($trans as &$t) {
            $t['amount'] = (float)$t['amount'];
        }
        respondJson($trans);
        break;

    case 'recordSupplierPayment':
        $input = getJsonInput();
        $id = generateUuid();
        $supplierId = isset($input['supplierId']) ? $input['supplierId'] : '';
        $amount = isset($input['amount']) ? (float)$input['amount'] : 0.00;
        $description = isset($input['description']) ? $input['description'] : '';
        
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare("UPDATE suppliers SET dueAmount = dueAmount - ? WHERE id = ? AND businessId = ?");
            $stmt->execute([$amount, $supplierId, $businessId]);
            
            $stmt = $pdo->prepare("INSERT INTO supplier_transactions (id, businessId, supplierId, amount, type, description) VALUES (?, ?, ?, ?, 'payment', ?)");
            $stmt->execute([$id, $businessId, $supplierId, $amount, $description]);
            
            $pdo->commit();
            respondJson(['id' => $id, 'amount' => $amount, 'type' => 'payment', 'description' => $description, 'date' => date('c')]);
        } catch (Exception $e) {
            $pdo->rollBack();
            respondError($e->getMessage());
        }
        break;

    case 'recordSupplierPurchase':
        $input = getJsonInput();
        $id = generateUuid();
        $supplierId = isset($input['supplierId']) ? $input['supplierId'] : '';
        $amount = isset($input['amount']) ? (float)$input['amount'] : 0.00;
        $description = isset($input['description']) ? $input['description'] : '';
        
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare("UPDATE suppliers SET dueAmount = dueAmount + ? WHERE id = ? AND businessId = ?");
            $stmt->execute([$amount, $supplierId, $businessId]);
            
            $stmt = $pdo->prepare("INSERT INTO supplier_transactions (id, businessId, supplierId, amount, type, description) VALUES (?, ?, ?, ?, 'purchase', ?)");
            $stmt->execute([$id, $businessId, $supplierId, $amount, $description]);
            
            $pdo->commit();
            respondJson(['id' => $id, 'amount' => $amount, 'type' => 'purchase', 'description' => $description, 'date' => date('c')]);
        } catch (Exception $e) {
            $pdo->rollBack();
            respondError($e->getMessage());
        }
        break;

    // ==========================================
    // EXPENSES
    // ==========================================
    case 'getExpenses':
        $stmt = $pdo->prepare("SELECT * FROM expenses WHERE businessId = ? ORDER BY date DESC");
        $stmt->execute([$businessId]);
        $expenses = $stmt->fetchAll();
        foreach ($expenses as &$e) {
            $e['amount'] = (float)$e['amount'];
        }
        respondJson($expenses);
        break;

    case 'createExpense':
        $input = getJsonInput();
        $id = generateUuid();
        $category = isset($input['category']) ? $input['category'] : 'General';
        $amount = isset($input['amount']) ? (float)$input['amount'] : 0.00;
        $description = isset($input['description']) ? $input['description'] : '';
        $userId = isset($input['userId']) ? $input['userId'] : null;

        $stmt = $pdo->prepare("INSERT INTO expenses (id, businessId, category, amount, description, userId) VALUES (?, ?, ?, ?, ?, ?)");
        $stmt->execute([$id, $businessId, $category, $amount, $description, $userId]);
        
        respondJson(['id' => $id, 'category' => $category, 'amount' => $amount, 'description' => $description, 'date' => date('c')]);
        break;

    case 'updateExpense':
        $id = isset($_GET['id']) ? $_GET['id'] : '';
        $input = getJsonInput();
        
        $fields = [];
        $params = [];
        $cols = ['category', 'amount', 'description'];
        foreach ($cols as $col) {
            if (array_key_exists($col, $input)) {
                $fields[] = "`$col` = ?";
                $params[] = $input[$col];
            }
        }
        if (empty($fields)) respondError("No params");
        $params[] = $id;
        $params[] = $businessId;
        
        $stmt = $pdo->prepare("UPDATE expenses SET " . implode(", ", $fields) . " WHERE id = ? AND businessId = ?");
        $stmt->execute($params);
        respondJson(['success' => true]);
        break;

    case 'deleteExpense':
        $id = $_GET['id'];
        $stmt = $pdo->prepare("DELETE FROM expenses WHERE id = ? AND businessId = ?");
        $stmt->execute([$id, $businessId]);
        respondJson(['success' => true]);
        break;

    // ==========================================
    // SMS MANAGEMENT
    // ==========================================
    case 'getSMSConfig':
        $stmt = $pdo->prepare("SELECT * FROM sms_config WHERE businessId = ?");
        $stmt->execute([$businessId]);
        $config = $stmt->fetch();
        if (!$config) {
            $config = ['provider' => 'Default', 'apiKey' => '', 'apiUser' => '', 'senderId' => ''];
        }
        respondJson($config);
        break;

    case 'updateSMSConfig':
        $input = getJsonInput();
        $provider = isset($input['provider']) ? $input['provider'] : 'Default';
        $apiKey = isset($input['apiKey']) ? $input['apiKey'] : '';
        $apiUser = isset($input['apiUser']) ? $input['apiUser'] : '';
        $senderId = isset($input['senderId']) ? $input['senderId'] : '';

        $stmt = $pdo->prepare("INSERT INTO sms_config (businessId, provider, apiKey, apiUser, senderId) VALUES (?, ?, ?, ?, ?)
                               ON DUPLICATE KEY UPDATE provider = VALUES(provider), apiKey = VALUES(apiKey), apiUser = VALUES(apiUser), senderId = VALUES(senderId)");
        $stmt->execute([$businessId, $provider, $apiKey, $apiUser, $senderId]);
        respondJson($input);
        break;

    case 'sendSMS':
        $input = getJsonInput();
        $recipient = isset($input['recipient']) ? $input['recipient'] : '';
        $message = isset($input['message']) ? $input['message'] : '';
        
        // Fetch config
        $stmt = $pdo->prepare("SELECT * FROM sms_config WHERE businessId = ?");
        $stmt->execute([$businessId]);
        $config = $stmt->fetch() ?: ['provider' => 'Default', 'apiKey' => '', 'apiUser' => '', 'senderId' => ''];
        
        $status = 'sent';
        $error = '';
        
        // Dynamic PHP execution of gateway queries if provider is specified
        if (!empty($config['apiKey']) && $config['provider'] !== 'Default' && $config['provider'] !== 'Demo') {
            try {
                $phone = strpos($recipient, '88') === 0 ? $recipient : '88' . $recipient;
                $apiKey = urlencode(trim($config['apiKey']));
                $senderId = urlencode(trim($config['senderId']));
                $apiUser = urlencode(trim($config['apiUser']));
                $msg = urlencode($message);
                
                $url = "";
                if ($config['provider'] === "SendMySMS") {
                    $url = "http://sendmysms.net/smsapi?api_key={$apiKey}&username={$apiUser}&type=text&contacts={$phone}&senderid={$senderId}&msg={$msg}";
                } else if ($config['provider'] === "BulksmsBD") {
                    $url = "https://bulksmsbd.net/api/smsapi?api_key={$apiKey}&type=text&number={$phone}&senderid={$senderId}&message={$msg}";
                } else if ($config['provider'] === "AlphaSMS") {
                    $url = "https://api.alphasms.biz/send?apiKey={$apiKey}&to={$phone}&msg={$msg}";
                } else if ($config['provider'] === "MimSMS") {
                    $url = "https://mimsms.com/smsapi?api_key={$apiKey}&type=text&contacts={$phone}&senderid={$senderId}&msg={$msg}";
                } else if ($config['provider'] === "Greenweb") {
                    $url = "https://api.greenweb.com.bd/api.php?json&token={$apiKey}&to={$phone}&message={$msg}";
                }
                
                if (!empty($url)) {
                    $ch = curl_init();
                    curl_setopt($ch, CURLOPT_URL, $url);
                    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
                    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
                    $res = curl_exec($ch);
                    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                    
                    if ($httpCode >= 400 || $res === false) {
                        throw new Exception("Gateway returned code: " . $httpCode . " (Curl error: " . curl_error($ch) . ")");
                    }
                    curl_close($ch);
                }
            } catch (Exception $e) {
                $status = 'failed';
                $error = $e->getMessage();
            }
        }
        
        // Log to db
        $id = generateUuid();
        $stmt = $pdo->prepare("INSERT INTO sms_logs (id, businessId, recipient, message, status, error) VALUES (?, ?, ?, ?, ?, ?)");
        $stmt->execute([$id, $businessId, $recipient, $message, $status, $error]);
        
        if ($status === 'failed') {
            respondError($error);
        }
        
        respondJson(['id' => $id, 'recipient' => $recipient, 'message' => $message, 'status' => $status, 'createdAt' => date('c')]);
        break;

    case 'getSMSLogs':
        $stmt = $pdo->prepare("SELECT * FROM sms_logs WHERE businessId = ? ORDER BY createdAt DESC");
        $stmt->execute([$businessId]);
        respondJson($stmt->fetchAll());
        break;

    // ==========================================
    // AGGREGATE DASHBOARD STATS
    // ==========================================
    case 'getDashboardStats':
        $today = date('Y-m-d');
        $month = date('Y-m');
        
        // Today's Sales Volume
        $stmt = $pdo->prepare("SELECT SUM(totalAmount) FROM sales WHERE businessId = ? AND DATE(createdAt) = ?");
        $stmt->execute([$businessId, $today]);
        $todaySales = (float)$stmt->fetchColumn() ?: 0.00;
        
        // Monthly Sales Volume
        $stmt = $pdo->prepare("SELECT SUM(totalAmount) FROM sales WHERE businessId = ? AND DATE_FORMAT(createdAt, '%Y-%m') = ?");
        $stmt->execute([$businessId, $month]);
        $monthlySales = (float)$stmt->fetchColumn() ?: 0.00;
        
        // Outstanding Total Receivables
        $stmt = $pdo->prepare("SELECT SUM(dueAmount) FROM customers WHERE businessId = ?");
        $stmt->execute([$businessId]);
        $totalDue = (float)$stmt->fetchColumn() ?: 0.00;
        
        // Overall Expenses
        $stmt = $pdo->prepare("SELECT SUM(amount) FROM expenses WHERE businessId = ?");
        $stmt->execute([$businessId]);
        $totalExpense = (float)$stmt->fetchColumn() ?: 0.00;
        
        // Count total unique inventory records
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM products WHERE businessId = ?");
        $stmt->execute([$businessId]);
        $totalProducts = (int)$stmt->fetchColumn() ?: 0;
        
        // Count low stocks
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM products WHERE businessId = ? AND stock <= minStock");
        $stmt->execute([$businessId]);
        $lowStockCount = (int)$stmt->fetchColumn() ?: 0;
        
        // Count expired items
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM products WHERE businessId = ? AND expiryDate IS NOT NULL AND expiryDate < ?");
        $stmt->execute([$businessId, $today]);
        $expiredProductCount = (int)$stmt->fetchColumn() ?: 0;
        
        // Count items expiring within next 5 days
        $threshold = date('Y-m-d', strtotime('+5 days'));
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM products WHERE businessId = ? AND expiryDate IS NOT NULL AND expiryDate >= ? AND expiryDate <= ?");
        $stmt->execute([$businessId, $today, $threshold]);
        $aboutToExpireCount = (int)$stmt->fetchColumn() ?: 0;
        
        // Fetch 5 recent sales with customer names
        $stmt = $pdo->prepare("SELECT * FROM sales WHERE businessId = ? ORDER BY createdAt DESC LIMIT 5");
        $stmt->execute([$businessId]);
        $recentSales = $stmt->fetchAll();
        foreach ($recentSales as &$sale) {
            $sale['totalAmount'] = (float)$sale['totalAmount'];
            $sale['payableAmount'] = (float)$sale['payableAmount'];
            $sale['paidAmount'] = (float)$sale['paidAmount'];
            $sale['dueAmount'] = (float)$sale['dueAmount'];
        }
        
        respondJson([
            'todaySales' => $todaySales,
            'monthlySales' => $monthlySales,
            'totalProfit' => 0,
            'totalDue' => $totalDue,
            'totalExpense' => $totalExpense,
            'totalProducts' => $totalProducts,
            'lowStockCount' => $lowStockCount,
            'expiredProductCount' => $expiredProductCount,
            'aboutToExpireCount' => $aboutToExpireCount,
            'recentSales' => $recentSales
        ]);
        break;

    // ==========================================
    // BACKUPS
    // ==========================================
    case 'getAllData':
        // Full JSON dump of all tables under the current business
        $tables = [
            'products' => 'SELECT * FROM products WHERE businessId = ?',
            'customers' => 'SELECT * FROM customers WHERE businessId = ?',
            'sales' => 'SELECT * FROM sales WHERE businessId = ?',
            'expenses' => 'SELECT * FROM expenses WHERE businessId = ?',
            'suppliers' => 'SELECT * FROM suppliers WHERE businessId = ?',
            'supplier_transactions' => 'SELECT * FROM supplier_transactions WHERE businessId = ?',
            'customer_payments' => 'SELECT * FROM customer_payments WHERE businessId = ?',
            'categories' => 'SELECT * FROM categories WHERE businessId = ?',
            'sms_logs' => 'SELECT * FROM sms_logs WHERE businessId = ?'
        ];
        
        $backup = [
            'version' => '2.1',
            'timestamp' => date('c'),
            'businessId' => $businessId
        ];
        
        foreach ($tables as $key => $sql) {
            $stmt = $pdo->prepare($sql);
            $stmt->execute([$businessId]);
            $backup[$key] = $stmt->fetchAll();
        }
        
        respondJson($backup);
        break;

    default:
        respondError("Unknown action requested: " . $action, 404);
}
