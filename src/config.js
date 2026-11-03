// Cấu hình chung. Giá trị bí mật (khóa API) chỉ đọc từ biến môi trường / file .env, không viết vào mã.
const path = require("node:path");
const fs = require("node:fs");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  DB_FILE: process.env.DB_FILE || path.join(__dirname, "..", "data", "vangvida.db"),

  // Tham số nghiệp vụ lấy từ mô hình TO-BE
  MAX_DISCOUNT: 5,        // T05: nhân viên giảm tối đa 5%
  DEPOSIT_RATE: 30,       // % cọc cho đơn gia công (giả định của nhóm)
  AI_THRESHOLD: 0.6,      // ngưỡng tin cậy gợi ý AI (mục 3.2 báo cáo)
  WORK_START: 8,          // giờ làm của xưởng 08:00–18:00 (T06)
  WORK_END: 18,

  SESSION_HOURS: 8,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  AI_MODEL: process.env.AI_MODEL || "claude-haiku-5-5",

  // Tài khoản nhận tiền cho mã VietQR. Chưa khai báo trong .env thì dùng tài khoản DEMO (không có thật).
  VIETQR: {
    bankId: process.env.VIETQR_BANK_ID || "970436",              // mã BIN ngân hàng (970436 = Vietcombank)
    account: process.env.VIETQR_ACCOUNT || "0123456789",
    accountName: process.env.VIETQR_ACCOUNT_NAME || "VANG VIDA JEWELRY",
    template: process.env.VIETQR_TEMPLATE || "compact2",
    demo: !process.env.VIETQR_ACCOUNT
  }
};
