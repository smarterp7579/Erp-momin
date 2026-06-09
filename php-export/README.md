# HishabPati Smart Business - PHP & SQL Rebuild Guide
## হিসাবপাতি স্মার্ট বিজনেস - পিএইচপি এবং এসকিউএল সেটআপ গাইড

আমাদের এই প্ল্যাটফর্মটি (Google AI Studio Build) সরাসরি Node.js / TypeScript এর মাধ্যমে ক্লাউডে লাইভ প্রিভিউ প্রদর্শন করে। যেহেতু রিয়েল-টাইম ক্লাউড এনভায়রনমেন্টে পিএইচপি এবং মাইএসকিউএল সরাসরি লাইভ চালানো সম্ভব নয়, তাই আমরা আপনার সুবিধার জন্য হিসাবপাতি অ্যাপের **সম্পূর্ণ ডাটাবেজ স্কিমা (schema.sql), ব্যাকএন্ড লজিক (api.php) এবং ফ্রন্টএন্ড সংযোগকারী ফাইল (api-client.ts)** নিখুঁতভাবে তৈরি করে দিয়েছি। 

আপনি এই কোড ব্যবহার করে যেকোনো সিপ্যানেল (cPanel), লোকালহোস্ট (XAMPP/WampServer), অথবা ভিপিএস (VPS) সার্ভারে এই হিসাবপাতি এন্ট্রি-লেভেল ইআরপি ও পিওএস টি কোনো রকম পরিবর্তন ছাড়াই সরাসরি পিএইচপি ও মাইএসকিউএল দিয়ে চালাতে পারবেন!

---

### 📂 আপনার প্রাপ্ত ফাইলসমূহ (Your Files inside `/php-export`):

1. **`schema.sql`**: সম্পূর্ণ MySQL ডাটাবেজ টেবিল স্ট্রাকচার (Businesses, Users, Customers, Products, Sales, Dynamic Inventory, SMS API setup, ইত্যাদি)।
2. **`api.php`**: সম্পূর্ণ REST API ব্যাকএন্ড লজিক যা আপনার রিকোয়েস্ট রুট অনুযায়ী পিএইচপি ও পিডিও (PDO) এর মাধ্যমে কোনো ইনজেকশন ছাড়াই ডাটা ট্রান্সফার ও প্রসেস করে।
3. **`api-client.ts`**: ফ্রন্টএন্ড সার্ভিস স্ক্রিপ্ট, যা দিয়ে আপনি সরাসরি বর্তমান ফায়ারবেজ ডাটাবেজের বদলে আপনার নিজস্ব পিএইচপি ডাটাবেজ এ কানেক্ট করতে পারবেন।

---

### 🚀 সেটআপ করার নিয়মাবলী (Installation Steps):

#### ধাপ ১: ডাটাবেজ তৈরি করুন (Database Creation)
1. আপনার হোস্টিং `Control Panel` বা `Client Area` এ গিয়ে `phpMyAdmin` এ যান।
2. আপনার তৈরি করা ডাটাবেজ: **`if0_42076833_momin7579`** এ প্রবেশ করুন।
3. ডাটাবেজে প্রবেশ করে **Import** অপশনে ক্লিক করুন এবং আপনার সুবিধার্থে তৈরি `/php-export/schema.sql` ফাইলটি আপলোড করে **Go / Import** বাটনে ক্লিক করুন। এটি প্রয়োজনীয় সকল টেবিল ও ডেমো অ্যাডমিন ইউজার তৈরি করে দেবে।

#### ধাপ ২: পিএইচপি এপিআই কনফিগার করুন (PHP API Configuration)
1. আপনার হোস্টিং বা সার্ভারের ফাইল ম্যানেজারে গিয়ে **`htdocs/api/`** নামক ফোল্ডার তৈরি করুন এবং সেখানে `/php-export/api.php` ফাইলটি আপলোড করুন।
2. আমরা ইতিমধ্যেই আপনার প্রদত্ত তথ্য অনুযায়ী `api.php` ফাইলে ডাটাবেজ ক্রেডিয়েনশিয়ালগুলো সম্পূর্ণ রেডি করে দিয়েছি! তবুও আপনি ফাইলটি ওপেন করে লাইন ২৮-৩১ এ দেখতে পারবেন:
   ```php
   define('DB_HOST', 'sql309.infinityfree.com');
   define('DB_NAME', 'if0_42076833_momin7579');
   define('DB_USER', 'if0_42076833');
   define('DB_PASS', 'Mominkhan7579');
   ```

#### ধাপ ৩: ফ্রন্টএন্ড সংযোগ করুন (Frontend Connection)
1. অ্যাপের ফ্রন্টএন্ড কোডের `/src/services/api.ts` ফাইলটি ওপেন করুন।
2. এই ফাইলটির সম্পূর্ণ কন্টেন্ট পরিবর্তন করে `/php-export/api-client.ts` এ থাকা কোডটি পেস্ট করে দিন।
3. আমরা আপনার জন্য `api-client.ts` এ লিঙ্কটি ইতিমধ্যেই নিচে দেওয়া লিঙ্কে সেট করে দিয়েছি:
   ```typescript
   const API_BASE_URL = "http://smartbusiness.great-site.net/api/api.php";
   ```
4. এরপর কোডটি নতুন করে বিল্ড করলেই আপনার সম্পূর্ণ হিসাবপাতি অ্যাপ্লিকেশনটি ফায়ারবেজের পরিবর্তে আপনার নিজস্ব পিএইচপি এবং মাইএসকিউএল ডাটাবেজে চালিত হবে!

---

### 🔑 ডিফল্ট অ্যাডমিন ক্রেডিয়েনশিয়ালস (Default Admin Logins):
ডাটাবেজ ইম্পোর্ট করার পর নিচের ইমেইল এবং পাসওয়ার্ড দিয়ে প্যানেলে সফলভাবে লগইন করতে পারবেন:

- **অ্যাডমিন ১**: 
  - ইমেইল: `admin@smartbusiness.com`
  - পাসওয়ার্ড: `admin123`
- **অ্যাডমিন ২ (মমিন খান)**: 
  - ইমেইল: `mominkhan051220@gmail.com`
  - পাসওয়ার্ড: `momin123`
- **অ্যাডমিন ৩ (আপন ড্রিম)**: 
  - ইমেইল: `apondreem@gmail.com`
  - পাসওয়ার্ড: `apon123`

---

### 📄 English Summary:
For production hosting on any standard Apache/Nginx web server with MySQL (cPanel, cPanel VPS, XAMPP, etc.), we have rebuilt the entirity of the system backend in PHP & SQL under `/php-export`.
To switch your current running Node.js interface to standard PHP/SQL database:
1. Import `schema.sql` into your phpMyAdmin.
2. Edit database access settings inside `api.php` (Line 26-29) and upload to server.
3. Replace `/src/services/api.ts` content with `/php-export/api-client.ts`, configure `API_BASE_URL` variable to point to your live URL.
4. Rebuild the app and deploy!
