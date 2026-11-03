// MÁY CHỦ WEB — Node.js thuần (không cần cài thư viện). Chạy: npm start → http://localhost:3000
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const cfg = require("./src/config");
const { openDb } = require("./src/db");
const auth = require("./src/auth");
const P = require("./src/process");
const ai = require("./src/ai");
const R = require("./src/rules");
const pay = require("./src/payment");

const PUBLIC = path.join(__dirname, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > 50 * 1024) { reject(new P.BizError("Dữ liệu gửi lên quá lớn.", 413)); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new P.BizError("JSON không hợp lệ.")); } });
    req.on("error", reject);
  });
}
function cookie(req, name) {
  const m = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function serveStatic(req, res) {
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (rel === "/") rel = "/Giaodientrangchu.html";   // trang chủ của giao diện
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, "Forbidden");      // chặn đọc file ngoài thư mục public
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Không tìm thấy");
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

function createApp(db, { aiFn = (need, cat) => ai.recommend(need, cat), qrFn = o => pay.createPaymentQr(o), checkPast = true } = {}) {
  const qrCache = new Map(); // mỗi đơn chỉ gọi VietQR một lần

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (!url.pathname.startsWith("/api/")) return serveStatic(req, res);
    try {
      const token = cookie(req, "vv_session");
      const user = auth.userFromToken(db, token);
      const m = (re) => url.pathname.match(re);
      const need = () => { if (!user) throw new P.BizError("Vui lòng đăng nhập.", 401); return user; };
      // Yêu cầu ghi phải gửi kèm header này: chặn form giả mạo từ trang khác (CSRF)
      if (req.method === "POST" && req.headers["x-requested-with"] !== "vangvida") throw new P.BizError("Yêu cầu không hợp lệ.", 403);

      if (req.method === "GET" && url.pathname === "/api/health") return send(res, 200, { ok: true, ai: cfg.ANTHROPIC_API_KEY ? "claude" : "rules" });

      if (req.method === "POST" && url.pathname === "/api/login") {
        const { username = "", password = "" } = await readJson(req);
        const uname = String(username).trim().toLowerCase();
        if (auth.tooManyAttempts(uname)) throw new P.BizError("Sai quá nhiều lần. Thử lại sau 10 phút.", 429);
        const row = db.prepare("SELECT * FROM users WHERE username = ?").get(uname);
        if (!row || !auth.verifyPassword(String(password), row.password_hash)) { auth.recordFailure(uname); throw new P.BizError("Sai tên đăng nhập hoặc mật khẩu.", 401); }
        auth.clearFailures(uname);
        const s = auth.createSession(db, row.id, cfg.SESSION_HOURS);
        return send(res, 200, { ok: true }, { "Set-Cookie": `vv_session=${s.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${cfg.SESSION_HOURS * 3600}` });
      }
      if (req.method === "POST" && url.pathname === "/api/register") {
        if (auth.registerLimited(req.socket.remoteAddress || "?")) throw new P.BizError("Đăng ký quá nhiều lần. Thử lại sau 10 phút.", 429);
        const r = auth.registerCustomer(db, await readJson(req));   // vai trò luôn là khách, bỏ qua mọi trường "role" gửi lên
        if (r.error) throw new P.BizError(r.error, r.status || 400);
        const s = auth.createSession(db, r.id, cfg.SESSION_HOURS);   // đăng ký xong tự đăng nhập
        return send(res, 201, { ok: true }, { "Set-Cookie": `vv_session=${s.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${cfg.SESSION_HOURS * 3600}` });
      }
      if (req.method === "POST" && url.pathname === "/api/logout") {
        if (token) auth.destroySession(db, token);
        return send(res, 200, { ok: true }, { "Set-Cookie": "vv_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
      }
      if (req.method === "GET" && url.pathname === "/api/me") return send(res, 200, { user: user || null, settings: { maxDiscount: cfg.MAX_DISCOUNT, aiThreshold: cfg.AI_THRESHOLD, depositRate: cfg.DEPOSIT_RATE, workStart: cfg.WORK_START, workEnd: cfg.WORK_END } });

      if (req.method === "GET" && url.pathname === "/api/products") { need(); return send(res, 200, P.catalog(db)); }
      if (req.method === "GET" && url.pathname === "/api/tasks") return send(res, 200, P.myTasks(db, need()));
      if (req.method === "GET" && url.pathname === "/api/orders") return send(res, 200, P.listOrders(db, need()));
      if (req.method === "POST" && url.pathname === "/api/orders") {
        const id = await P.createOrder(db, need(), await readJson(req), aiFn);
        return send(res, 201, P.orderDetail(db, id));
      }
      let mm;
      if (req.method === "GET" && (mm = m(/^\/api\/orders\/(\d+)$/))) {
        const u = need(); const o = P.getOrder(db, mm[1]);
        if (!P.canSee(u, o)) throw new P.BizError("Không tìm thấy đơn.", 404);
        return send(res, 200, P.orderDetail(db, o.id));
      }
      if (req.method === "POST" && (mm = m(/^\/api\/orders\/(\d+)\/tasks\/(T0[3-8])$/))) {
        const o = await P.doTask(db, need(), mm[1], mm[2], await readJson(req), aiFn, { checkPast });
        return send(res, 200, P.orderDetail(db, o.id));
      }
      if (req.method === "POST" && (mm = m(/^\/api\/orders\/(\d+)\/ai-suggest$/))) {
        await P.rerunAI(db, need(), mm[1], aiFn);
        return send(res, 200, P.orderDetail(db, Number(mm[1])));
      }
      if (req.method === "GET" && (mm = m(/^\/api\/orders\/(\d+)\/payment-qr$/))) {
        const u = need(); const o = P.getOrder(db, mm[1]);
        if (!P.canSee(u, o)) throw new P.BizError("Không tìm thấy đơn.", 404);
        if (o.status !== "won") throw new P.BizError("Chỉ tạo mã QR cho đơn đã chốt (sau T09).", 409);
        if (!qrCache.has(o.id)) { const r = await qrFn(o); if (r.ok) qrCache.set(o.id, r); else return send(res, 200, r); }
        return send(res, 200, qrCache.get(o.id));
      }
      if (req.method === "GET" && url.pathname === "/api/report") {
        if (need().role !== "nhanvien") throw new P.BizError("Chỉ nhân viên xem báo cáo.", 403);
        const all = db.prepare("SELECT * FROM orders").all();
        const won = all.filter(o => o.status === "won"), lost = all.filter(o => o.status === "lost");
        const picked = all.filter(o => o.product_id);
        const fromAI = picked.filter(o => db.prepare("SELECT 1 FROM ai_suggestions WHERE order_id = ? AND product_id = ?").get(o.id, o.product_id));
        return send(res, 200, {
          total: all.length, open: all.length - won.length - lost.length, won: won.length, lost: lost.length,
          conversion: won.length + lost.length ? Math.round(won.length / (won.length + lost.length) * 100) : 0,
          wonValue: won.reduce((s, o) => s + (o.total || 0), 0),
          aiPickRate: picked.length ? Math.round(fromAI.length / picked.length * 100) : 0,
          avgDiscount: won.filter(o => o.discount_pct > 0).length ? +(won.filter(o => o.discount_pct > 0).reduce((s, o) => s + o.discount_pct, 0) / won.filter(o => o.discount_pct > 0).length).toFixed(1) : 0,
          customOrders: won.filter(o => o.co_gia_cong).length
        });
      }
      throw new P.BizError("Không tìm thấy API.", 404);
    } catch (e) {
      if (e instanceof P.BizError) return send(res, e.status, { error: e.message });
      console.error(e);
      return send(res, 500, { error: "Lỗi máy chủ. Xem cửa sổ terminal để biết chi tiết." });
    }
  });
}

if (require.main === module) {
  const db = openDb(cfg.DB_FILE);
  createApp(db).listen(cfg.PORT, () => {
    console.log(`\n  Vang Vida đang chạy tại: http://localhost:${cfg.PORT}`);
    console.log(`  Mã QR thanh toán: VietQR${cfg.VIETQR.demo ? " (tài khoản demo, khai báo VIETQR_ACCOUNT trong .env để dùng tài khoản thật)" : ""}`);
    console.log(`  AI gợi ý mẫu: ${cfg.ANTHROPIC_API_KEY ? "Claude API" : "luật dự phòng (chưa có ANTHROPIC_API_KEY trong .env)"}`);
    console.log("  Nhấn Ctrl+C để dừng.\n");
  });
}

module.exports = { createApp };
