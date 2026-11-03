// Unit test cho luật nghiệp vụ và AI. Chạy: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/rules");
const AI = require("../src/ai");

const CAT = [
  { id: "A", name: "Nhẫn A", type: "Nhẫn", gender: "Nữ", stone: "Emerald", material: "Vàng", price: 18500000, stock: 2, reserved: 0, size: "11" },
  { id: "B", name: "Nhẫn B", type: "Nhẫn", gender: "Nam", stone: "Tourmaline", material: "Vàng", price: 13800000, stock: 0, reserved: 0, size: "20" },
  { id: "C", name: "Vòng C", type: "Vòng tay", gender: "Nữ", stone: "Sapphire", material: "Vàng", price: 9000000, stock: 1, reserved: 1, size: "16" }
];

test("T07: không giảm, không gia công → tổng bằng giá niêm yết", () => {
  assert.equal(R.calcQuote({ price: 7900000 }).total, 7900000);
});
test("T07: giảm 3% chỉ trên giá hàng, phí gia công giữ nguyên", () => {
  const q = R.calcQuote({ price: 18500000, discountPct: 3, fee: 800000, coGiaCong: true });
  assert.equal(q.discountAmt, 555000);
  assert.equal(q.total, 18745000);
});
test("T07: cọc 30% làm tròn lên bội số 1.000 đ", () => {
  assert.equal(R.calcQuote({ price: 18500000, discountPct: 3, fee: 800000, coGiaCong: true, depositRate: 30 }).depositRequired, 5624000);
});
test("T07: không gia công thì bỏ qua phí và không yêu cầu cọc", () => {
  const q = R.calcQuote({ price: 7900000, fee: 500000, coGiaCong: false });
  assert.equal(q.total, 7900000);
  assert.equal(q.depositRequired, 0);
});
test("T05: hạn mức giảm 0–5%", () => {
  assert.equal(R.validateDiscount(0).ok, true);
  assert.equal(R.validateDiscount(5).ok, true);
  assert.equal(R.validateDiscount(5.5).ok, false);
  assert.equal(R.validateDiscount(-1).ok, false);
  assert.equal(R.validateDiscount("").ok, false);
});
test("T06: hạn hoàn thành phải trong giờ 08:00–18:00", () => {
  assert.equal(R.validateDeadline("2026-11-05T07:30").ok, false);
  assert.equal(R.validateDeadline("2026-11-05T17:00").ok, true);
  assert.equal(R.validateDeadline("2026-11-05T18:30").ok, false);
  assert.equal(R.validateDeadline("2020-01-01T10:00", new Date()).ok, false);
});
test("Cổng XOR đọc đúng biến như file .bpmn", () => {
  assert.equal(R.gateways.GDiscount({ yeu_cau_giam_gia: 1 }), "T05");
  assert.equal(R.gateways.GDiscount({ yeu_cau_giam_gia: 0 }), "GQuoteCustom");
  assert.equal(R.gateways.GQuoteCustom({ co_gia_cong: 1 }), "T06");
  assert.equal(R.gateways.GQuoteCustom({ co_gia_cong: 0 }), "T07");
  assert.equal(R.gateways.GAccept(true), "T09");
  assert.equal(R.gateways.GAccept(false), "EndNo");
});
test("Số điện thoại Việt Nam 10 số", () => {
  assert.equal(R.validPhone("0376799797"), true);
  assert.equal(R.validPhone("037679979"), false);
  assert.equal(R.validPhone("abc"), false);
});
test("T02 luật dự phòng: không gợi ý hàng hết hoặc đã giữ hết", () => {
  const items = AI.ruleRecommend({ type: "Nhẫn", budget: 20000000 }, CAT);
  assert.deepEqual(items.map(i => i.id), ["A"]);
  assert.equal(AI.ruleRecommend({ type: "Vòng tay", budget: 10000000 }, CAT).length, 0);
});
test("T02 lọc đầu ra AI: bỏ mã lạ, hàng hết, ép độ tin cậy về [0,1]", () => {
  const out = AI.sanitizeAI([{ id: "XX", confidence: 0.9 }, { id: "B", confidence: 0.9 }, { id: "A", confidence: 7, reason: "ok" }], CAT);
  assert.deepEqual(out, [{ id: "A", confidence: 1, reason: "ok" }]);
});
test("Tích hợp Claude API: đọc đúng phản hồi (giả lập, không gọi mạng)", async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: '{"items":[{"id":"A","reason":"đúng đá","confidence":0.82}]}' }] }) });
  const r = await AI.recommend({ type: "Nhẫn" }, CAT, { apiKey: "test", fetchFn: fakeFetch });
  assert.equal(r.source, "Claude API");
  assert.deepEqual(r.items, [{ id: "A", confidence: 0.82, reason: "đúng đá" }]);
});
test("Tích hợp Claude API lỗi → tự chuyển sang luật dự phòng", async () => {
  const badFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const r = await AI.recommend({ type: "Nhẫn", budget: 20000000 }, CAT, { apiKey: "test", fetchFn: badFetch });
  assert.match(r.source, /Luật dự phòng/);
  assert.equal(r.items[0].id, "A");
});
