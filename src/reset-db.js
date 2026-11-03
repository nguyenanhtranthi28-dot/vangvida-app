// Xóa cơ sở dữ liệu và tạo lại với dữ liệu mẫu: npm run reset-db
const fs = require("node:fs");
const cfg = require("./config");
const { openDb } = require("./db");
for (const f of [cfg.DB_FILE, cfg.DB_FILE + "-wal", cfg.DB_FILE + "-shm"]) if (fs.existsSync(f)) fs.unlinkSync(f);
openDb(cfg.DB_FILE).close();
console.log("Đã tạo lại cơ sở dữ liệu với dữ liệu mẫu:", cfg.DB_FILE);
