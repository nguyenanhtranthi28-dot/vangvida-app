// Xác thực: băm mật khẩu bằng scrypt (có salt), phiên đăng nhập lưu trong bảng sessions,
// cookie HttpOnly + SameSite=Strict để trình duyệt không cho JavaScript đọc token.
const crypto = require("node:crypto");

// Băm mật khẩu: tạo chuỗi ngẫu nhiên (salt) rồi băm bằng scrypt; chỉ lưu “salt:hash”, không lưu mật khẩu thật.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

// Khi đăng nhập: băm lại mật khẩu với cùng salt rồi so sánh (timingSafeEqual chống đoán qua thời gian phản hồi).
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}

// Đăng nhập đúng → tạo token ngẫu nhiên, lưu vào bảng sessions; máy chủ gửi token cho trình duyệt qua cookie.
function createSession(db, userId, hours) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)").run(token, userId, expires);
  return { token, expires };
}

// Mỗi yêu cầu gửi kèm token → tìm người dùng tương ứng; token hết hạn thì xóa và coi như chưa đăng nhập.
function userFromToken(db, token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.id, u.username, u.full_name, u.role, u.phone, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return { id: row.id, username: row.username, fullName: row.full_name, role: row.role, phone: row.phone };
}

// Đăng xuất: xóa token khỏi bảng sessions.
function destroySession(db, token) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

// Chống dò mật khẩu: tối đa 5 lần sai trong 10 phút cho mỗi tên đăng nhập
const failures = new Map();
function tooManyAttempts(username) {
  const f = failures.get(username);
  return f && f.count >= 5 && Date.now() - f.first < 10 * 60 * 1000;
}
function recordFailure(username) {
  const f = failures.get(username);
  if (!f || Date.now() - f.first > 10 * 60 * 1000) failures.set(username, { count: 1, first: Date.now() });
  else f.count++;
}
function clearFailures(username) { failures.delete(username); }

// Đăng ký: chỉ tạo được tài khoản KHÁCH HÀNG. Nhân viên và thợ do cửa hàng cấp (không tự nâng quyền).
function registerCustomer(db, d) {
  const fullName = String(d.fullName || "").trim();
  const phone = String(d.phone || "").replace(/\s/g, "");
  const username = String(d.username || "").trim().toLowerCase();
  const password = String(d.password || "");
  // Kiểm tra từng trường; sai quy tắc nào thì trả về lỗi tương ứng để giao diện hiển thị.
  if (fullName.length < 2 || fullName.length > 80) return { error: "Nhập họ tên (2–80 ký tự)." };
  if (!/^0\d{9}$/.test(phone)) return { error: "Số điện thoại phải gồm 10 số, bắt đầu bằng 0." };
  if (!/^[a-z0-9_.]{3,30}$/.test(username)) return { error: "Tên đăng nhập 3–30 ký tự, chỉ gồm chữ không dấu, số, dấu chấm hoặc gạch dưới." };
  if (password.length < 8) return { error: "Mật khẩu phải có ít nhất 8 ký tự." };
  if (password !== String(d.password2 ?? password)) return { error: "Hai lần nhập mật khẩu không khớp." };
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) return { error: "Tên đăng nhập đã có người dùng.", status: 409 };
  // Vai trò được ghi cứng là 'khach' trong câu lệnh: gửi lên role khác cũng không có tác dụng.
  const r = db.prepare("INSERT INTO users (username,password_hash,full_name,role,phone) VALUES (?,?,?,'khach',?)")
    .run(username, hashPassword(password), fullName, phone);
  return { id: Number(r.lastInsertRowid) };
}

// Giới hạn số lần đăng ký theo địa chỉ IP: tối đa 10 tài khoản / 10 phút
const registrations = new Map();
function registerLimited(ip) {
  const now = Date.now();
  const list = (registrations.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  registrations.set(ip, list);
  if (list.length >= 10) return true;
  list.push(now);
  return false;
}

module.exports = { registerCustomer, registerLimited, hashPassword, verifyPassword, createSession, userFromToken, destroySession, tooManyAttempts, recordFailure, clearFailures };
