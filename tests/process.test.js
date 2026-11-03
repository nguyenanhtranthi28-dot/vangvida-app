// Kiểm thử động cơ quy trình T01–T09 trên cơ sở dữ liệu tạm trong bộ nhớ
const test = require("node:test");
const assert = require("node:assert/strict");
const { openDb } = require("../src/db");
const P = require("../src/process");
const AI = require("../src/ai");

const rules = (need, cat) => AI.recommend(need, cat, { apiKey: "" });
const OPTS = { checkPast: false };
function setup() {
  const db = openDb(":memory:");
  const u = n => { const r = db.prepare("SELECT id, username, full_name AS fullName, role FROM users WHERE username = ?").get(n); return { ...r }; };
  return { db, kh: u("khach1"), kh2: u("khach2"), nv: u("nhanvien1"), th: u("tho1") };
}

test("Kịch bản chính: hàng có sẵn, không giảm → chốt, lưu đơn, giữ hàng", async () => {
  const { db, kh, nv } = setup();
  const id = await P.createOrder(db, kh, { type: "Nhẫn", budget: 8000000, gender: "Nữ", stone: "Peridot", size: "10" }, rules);
  let o = P.getOrder(db, id);
  assert.equal(o.node, "T03", "T02 tự chạy và chuyển sang T03");
  assert.ok(P.orderDetail(db, id).suggestions.some(s => s.product_id === "VV12"), "AI gợi ý được Nhẫn Nữ PERIDOT");
  await P.doTask(db, nv, id, "T03", { productId: "VV12", measuredSize: "10", coGiaCong: false }, rules, OPTS);
  o = await P.doTask(db, kh, id, "T04", { yeuCauGiamGia: false }, rules, OPTS);
  assert.equal(o.node, "T08", "không giảm, không gia công → T07 tự tính rồi sang T08");
  assert.equal(o.total, 7900000);
  o = await P.doTask(db, kh, id, "T08", { accept: true }, rules, OPTS);
  assert.equal(o.status, "won");
  assert.equal(o.node, "CHO_GIAO");
  assert.match(o.code, /^VV-\d{6}-\d{4}$/);
  assert.equal(db.prepare("SELECT reserved FROM products WHERE id='VV12'").get().reserved, 1);
});

test("Nhánh gia công + giảm giá: đi qua T05, T06; chặn giảm vượt 5%", async () => {
  const { db, kh2, nv, th } = setup();
  const id = await P.createOrder(db, kh2, { type: "Nhẫn", budget: 20000000, stone: "Emerald", size: "9" }, rules);
  await P.doTask(db, nv, id, "T03", { productId: "VV11", measuredSize: "9", coGiaCong: true, customNote: "Thu ni 11 → 9" }, rules, OPTS);
  let o = await P.doTask(db, kh2, id, "T04", { yeuCauGiamGia: true, requestedDiscount: 8 }, rules, OPTS);
  assert.equal(o.node, "T05");
  await assert.rejects(P.doTask(db, nv, id, "T05", { discountPct: 8 }, rules, OPTS), /Vượt hạn mức/);
  o = await P.doTask(db, nv, id, "T05", { discountPct: 3 }, rules, OPTS);
  assert.equal(o.node, "T06", "có gia công → sang thợ");
  await assert.rejects(P.doTask(db, th, id, "T06", { feasible: true, workFee: 800000, workDeadline: "2026-11-06T19:00" }, rules, OPTS), /giờ làm việc/);
  o = await P.doTask(db, th, id, "T06", { feasible: true, workFee: 800000, workDeadline: "2026-11-06T16:00" }, rules, OPTS);
  assert.equal(o.total, 18745000);
  assert.equal(o.deposit_required, 5624000);
  await assert.rejects(P.doTask(db, kh2, id, "T08", { accept: true }, rules, OPTS), /lịch hẹn/);
  o = await P.doTask(db, kh2, id, "T08", { accept: true, appointment: "2026-11-07T10:00" }, rules, OPTS);
  assert.equal(o.node, "CHO_COC");
});

test("Khách không chốt → kết thúc EndNo, không giữ hàng", async () => {
  const { db, kh, nv } = setup();
  const id = await P.createOrder(db, kh, { type: "Nhẫn", budget: 12000000, gender: "Nam" }, rules);
  await P.doTask(db, nv, id, "T03", { productId: "VV05", coGiaCong: false }, rules, OPTS);
  await P.doTask(db, kh, id, "T04", { yeuCauGiamGia: true, requestedDiscount: 5 }, rules, OPTS);
  let o = await P.doTask(db, nv, id, "T05", { discountPct: 2 }, rules, OPTS);
  assert.equal(o.total, 12250000);
  o = await P.doTask(db, kh, id, "T08", { accept: false }, rules, OPTS);
  assert.equal(o.status, "lost");
  assert.equal(o.node, "EndNo");
  assert.equal(db.prepare("SELECT reserved FROM products WHERE id='VV05'").get().reserved, 0);
});

test("Phân quyền theo lane: sai vai trò, sai bước, khách khác đều bị chặn", async () => {
  const { db, kh, kh2, nv, th } = setup();
  const id = await P.createOrder(db, kh, { type: "Nhẫn", budget: 8000000 }, rules);
  await assert.rejects(P.doTask(db, kh, id, "T03", { productId: "VV12" }, rules, OPTS), e => e.status === 403);
  await assert.rejects(P.doTask(db, th, id, "T03", { productId: "VV12" }, rules, OPTS), e => e.status === 404 || e.status === 403);
  await assert.rejects(P.doTask(db, kh2, id, "T04", {}, rules, OPTS), e => e.status === 404);
  await assert.rejects(P.doTask(db, nv, id, "T05", { discountPct: 1 }, rules, OPTS), e => e.status === 409);
  await assert.rejects(P.createOrder(db, nv, { type: "Nhẫn", budget: 1 }, rules), e => e.status === 403);
});

test("Ngoại lệ: không chọn được mẫu hết hàng; hai đơn tranh 1 món cuối → đơn sau quay lại T03", async () => {
  const { db, kh, kh2, nv } = setup();
  const a = await P.createOrder(db, kh, { type: "Nhẫn", budget: 15000000 }, rules);
  await assert.rejects(P.doTask(db, nv, a, "T03", { productId: "VV09" }, rules, OPTS), /hết hàng/);
  const b = await P.createOrder(db, kh2, { type: "Nhẫn", budget: 22000000 }, rules);
  for (const [id, who] of [[a, kh], [b, kh2]]) {
    await P.doTask(db, nv, id, "T03", { productId: "VV06", coGiaCong: false }, rules, OPTS);
    await P.doTask(db, who, id, "T04", { yeuCauGiamGia: false }, rules, OPTS);
  }
  assert.equal((await P.doTask(db, kh, a, "T08", { accept: true }, rules, OPTS)).status, "won");
  const ob = await P.doTask(db, kh2, b, "T08", { accept: true }, rules, OPTS);
  assert.equal(ob.node, "T03", "VV06 chỉ còn 1, đơn thứ hai bị trả về T03");
  assert.equal(ob.status, "open");
});

test("Lưu trữ bền vững: dữ liệu còn sau khi mở lại file cơ sở dữ liệu", async () => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const file = path.join(os.tmpdir(), `vv-test-${Date.now()}.db`);
  let db = openDb(file);
  const kh = { ...db.prepare("SELECT id, role FROM users WHERE username='khach1'").get() };
  const id = await P.createOrder(db, kh, { type: "Nhẫn", budget: 8000000 }, rules);
  db.close();
  db = openDb(file);
  assert.equal(P.getOrder(db, id).node, "T03");
  db.close(); fs.unlinkSync(file);
});
