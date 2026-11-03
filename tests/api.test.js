// Kiểm thử tích hợp qua HTTP: đăng nhập, cookie phiên, chặn truy cập trái phép
const test = require("node:test");
const assert = require("node:assert/strict");
const { openDb } = require("../src/db");
const { createApp } = require("../server");
const AI = require("../src/ai");

async function start() {
  const db = openDb(":memory:");
  const qrFn = async o => ({ ok: true, amount: o.co_gia_cong ? o.deposit_required : o.total, dataUrl: "data:image/png;base64,AA==" });
  const srv = createApp(db, { aiFn: (n, c) => AI.recommend(n, c, { apiKey: "" }), qrFn, checkPast: false });
  await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, path, body, cookie, csrf = true) => {
    const h = { "Content-Type": "application/json" };
    if (csrf) h["X-Requested-With"] = "vangvida";
    if (cookie) h.Cookie = cookie;
    const res = await fetch(base + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null), cookie: (res.headers.get("set-cookie") || "").split(";")[0] };
  };
  const login = async u => (await call("POST", "/api/login", { username: u, password: "vangvida123" })).cookie;
  return { srv, call, login };
}

test("Chưa đăng nhập thì không gọi được API nghiệp vụ", async () => {
  const { srv, call } = await start();
  assert.equal((await call("GET", "/api/orders")).status, 401);
  srv.close();
});
test("Sai mật khẩu bị từ chối; cookie phiên là HttpOnly", async () => {
  const { srv, call } = await start();
  assert.equal((await call("POST", "/api/login", { username: "khach1", password: "sai" })).status, 401);
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "vangvida" }, body: JSON.stringify({ username: "khach1", password: "vangvida123" }) });
  assert.match(res.headers.get("set-cookie"), /HttpOnly/);
  srv.close();
});
test("Yêu cầu POST thiếu header chống CSRF bị chặn", async () => {
  const { srv, call, login } = await start();
  const c = await login("khach1");
  assert.equal((await call("POST", "/api/orders", { type: "Nhẫn", budget: 1000000 }, c, false)).status, 403);
  srv.close();
});
test("Luồng qua API với 3 vai trò, mỗi vai trò chỉ làm được việc của mình", async () => {
  const { srv, call, login } = await start();
  const kh = await login("khach1"), nv = await login("nhanvien1"), th = await login("tho1");
  const r1 = await call("POST", "/api/orders", { type: "Nhẫn", budget: 20000000, stone: "Emerald" }, kh);
  assert.equal(r1.status, 201);
  const id = r1.body.order.id;
  assert.equal((await call("POST", `/api/orders/${id}/tasks/T03`, { productId: "VV11" }, kh)).status, 403);
  assert.equal((await call("POST", `/api/orders/${id}/tasks/T03`, { productId: "VV11", coGiaCong: true, customNote: "Khắc tên" }, nv)).status, 200);
  assert.equal((await call("POST", `/api/orders/${id}/tasks/T04`, { yeuCauGiamGia: false }, kh)).body.order.node, "T06");
  assert.equal((await call("GET", "/api/tasks", null, th)).body.length, 1, "thợ thấy đúng 1 việc T06");
  const r6 = await call("POST", `/api/orders/${id}/tasks/T06`, { feasible: true, workFee: 500000, workDeadline: "2026-11-06T15:00" }, th);
  assert.equal(r6.body.order.total, 19000000);
  const r8 = await call("POST", `/api/orders/${id}/tasks/T08`, { accept: true, appointment: "2026-11-07T09:00" }, kh);
  assert.equal(r8.body.order.status, "won");
  const qr = await call("GET", `/api/orders/${id}/payment-qr`, null, kh);
  assert.equal(qr.body.amount, 5700000, "QR tiền cọc 30% của 19.000.000");
  assert.equal((await call("GET", `/api/orders/${id}/payment-qr`, null, await login("khach2"))).status, 404, "khách khác không xem được QR");
  assert.equal((await call("GET", "/api/report", null, kh)).status, 403);
  assert.equal((await call("GET", "/api/report", null, nv)).body.won, 1);
  srv.close();
});
test("Không đọc được file ngoài thư mục public", async () => {
  const { srv } = await start();
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/..%2fsrc%2fconfig.js`);
  assert.notEqual(res.status, 200);
  srv.close();
});

test("Đăng ký khách hàng: tạo tài khoản, tự đăng nhập, gửi được yêu cầu T01", async () => {
  const { srv, call } = await start();
  const r = await call("POST", "/api/register", { fullName: "Võ Thị Lan", phone: "0905111222", username: "lanvo", password: "matkhau123", password2: "matkhau123" });
  assert.equal(r.status, 201);
  const me = await call("GET", "/api/me", null, r.cookie);
  assert.equal(me.body.user.role, "khach");
  assert.equal(me.body.user.fullName, "Võ Thị Lan");
  assert.equal((await call("POST", "/api/orders", { type: "Nhẫn", budget: 9000000 }, r.cookie)).status, 201);
  srv.close();
});
test("Đăng ký không tự nâng quyền được: gửi role nhanvien vẫn thành khách", async () => {
  const { srv, call } = await start();
  const r = await call("POST", "/api/register", { fullName: "Kẻ Gian", phone: "0905333444", username: "kegian", password: "matkhau123", role: "nhanvien" });
  const me = await call("GET", "/api/me", null, r.cookie);
  assert.equal(me.body.user.role, "khach");
  assert.equal((await call("GET", "/api/report", null, r.cookie)).status, 403);
  srv.close();
});
test("Đăng ký bị từ chối: trùng tên, mật khẩu ngắn, sai số điện thoại, nhập lại không khớp", async () => {
  const { srv, call } = await start();
  const base = { fullName: "Người Mới", phone: "0905555666", username: "nguoimoi", password: "matkhau123" };
  assert.equal((await call("POST", "/api/register", { ...base, username: "khach1" })).status, 409);
  assert.equal((await call("POST", "/api/register", { ...base, password: "123" })).status, 400);
  assert.equal((await call("POST", "/api/register", { ...base, phone: "12345" })).status, 400);
  assert.equal((await call("POST", "/api/register", { ...base, password2: "khac12345" })).status, 400);
  assert.equal((await call("POST", "/api/register", { ...base, username: "Có Dấu" })).status, 400);
  srv.close();
});
