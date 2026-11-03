// Cơ sở dữ liệu SQLite (tích hợp sẵn trong Node.js, không cần cài thêm).
// Dữ liệu lưu bền vững trong file data/vangvida.db.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { hashPassword } = require("./auth");

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  full_name     TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('khach','nhanvien','tho')),
  phone         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  type     TEXT NOT NULL,
  gender   TEXT NOT NULL,
  stone    TEXT NOT NULL,
  material TEXT NOT NULL,
  price    INTEGER NOT NULL CHECK (price >= 0),
  stock    INTEGER NOT NULL CHECK (stock >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  size     TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  code               TEXT UNIQUE,                       -- cấp ở T09
  customer_id        INTEGER NOT NULL REFERENCES users(id),
  node               TEXT NOT NULL,                     -- hoạt động BPMN hiện tại
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')),
  need_type          TEXT, need_budget INTEGER, need_size TEXT, need_stone TEXT, need_gender TEXT, need_note TEXT,
  contact_channel    TEXT,
  product_id         TEXT REFERENCES products(id),
  measured_size      TEXT,
  co_gia_cong        INTEGER NOT NULL DEFAULT 0,
  custom_note        TEXT,
  yeu_cau_giam_gia   INTEGER NOT NULL DEFAULT 0,
  requested_discount REAL NOT NULL DEFAULT 0,
  discount_pct       REAL NOT NULL DEFAULT 0,
  work_fee           INTEGER NOT NULL DEFAULT 0,
  work_deadline      TEXT,
  list_price         INTEGER, discount_amt INTEGER, total INTEGER, deposit_required INTEGER,
  appointment        TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_suggestions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT    NOT NULL REFERENCES products(id),
  confidence REAL    NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  reason     TEXT,
  source     TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_history (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  node     TEXT NOT NULL,
  lane     TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id),
  text     TEXT NOT NULL,
  at       TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Danh mục minh họa: tên theo trang vangvidajewelry.vn/trang-suc, giá/tồn/ni là số giả định
const SEED_PRODUCTS = [
  ["VV01","Lắc tay Lu thống Lam Ngọc","Vòng tay","Nữ","Sapphire","Vàng 18K",32000000,1,"16"],
  ["VV02","Lắc tay nữ SAPPHIRE","Vòng tay","Nữ","Sapphire","Vàng 18K",24500000,2,"16"],
  ["VV03","Nhẫn Bạch Ngọc","Nhẫn","Unisex","Cẩm thạch","Vàng 18K",6800000,3,"12"],
  ["VV04","Nhẫn Lam Ngọc","Nhẫn","Nữ","Sapphire","Vàng 18K",15900000,2,"11"],
  ["VV05","Nhẫn Nam đá Moissanite","Nhẫn","Nam","Moissanite","Vàng trắng 14K",12500000,4,"19"],
  ["VV06","Nhẫn Nam đá RUBY","Nhẫn","Nam","Ruby","Vàng 18K",21000000,1,"20"],
  ["VV07","Nhẫn Nam GARNET","Nhẫn","Nam","Garnet","Bạc S925",8900000,3,"19"],
  ["VV08","Nhẫn Nam Peridot","Nhẫn","Nam","Peridot","Vàng 14K",9500000,2,"18"],
  ["VV09","Nhẫn Nam TOURMALINE XANH","Nhẫn","Nam","Tourmaline","Vàng 18K",13800000,0,"20"],
  ["VV10","Nhẫn Nữ đá GARNET","Nhẫn","Nữ","Garnet","Bạc S925",7200000,3,"10"],
  ["VV11","Nhẫn Nữ EMERALD","Nhẫn","Nữ","Emerald","Vàng 18K",18500000,2,"11"],
  ["VV12","Nhẫn Nữ PERIDOT","Nhẫn","Nữ","Peridot","Vàng 14K",7900000,2,"10"],
  ["VV13","Dây chuyền mặt Spinel","Dây chuyền","Nữ","Spinel","Vàng 18K",11200000,2,""],
  ["VV14","Vòng tay Cẩm thạch","Vòng tay","Nữ","Cẩm thạch","Cẩm thạch",16000000,1,"56"]
];

// Tài khoản demo cho 3 vai trò (mật khẩu chung: vangvida123). Đổi trước khi dùng thật.
const SEED_USERS = [
  ["khach1","Nguyễn Thu Hà","khach","0905123456"],
  ["khach2","Trần Minh Anh","khach","0376799797"],
  ["nhanvien1","Lê Hoàng Nam","nhanvien","0911222333"],
  ["tho1","Phạm Văn Tài","tho","0988777666"]
];
const DEMO_PASSWORD = "vangvida123";

function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  seed(db);
  return db;
}

function seed(db) {
  const hasProducts = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
  if (!hasProducts) {
    const ins = db.prepare("INSERT INTO products (id,name,type,gender,stone,material,price,stock,size) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const p of SEED_PRODUCTS) ins.run(...p);
  }
  const hasUsers = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (!hasUsers) {
    const ins = db.prepare("INSERT INTO users (username,password_hash,full_name,role,phone) VALUES (?,?,?,?,?)");
    for (const [u, name, role, phone] of SEED_USERS) ins.run(u, hashPassword(DEMO_PASSWORD), name, role, phone);
  }
}

// Chạy nhiều câu lệnh như một giao dịch: lỗi giữa chừng thì hoàn tác toàn bộ
function tx(db, fn) {
  db.exec("BEGIN");
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

module.exports = { openDb, tx, DEMO_PASSWORD, SEED_USERS };
