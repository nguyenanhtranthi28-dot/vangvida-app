// Kiểm thử tích hợp VietQR (giả lập mạng, không gọi dịch vụ thật)
const test = require("node:test");
const assert = require("node:assert/strict");
const pay = require("../src/payment");

const BANK = { bankId: "970436", account: "0123456789", accountName: "VANG VIDA JEWELRY", template: "compact2", demo: true };
const orderCustom = { code: "VV-261031-0001", co_gia_cong: 1, deposit_required: 5624000, total: 18745000 };
const orderStock = { code: "VV-261031-0002", co_gia_cong: 0, deposit_required: 0, total: 7900000 };

test("Đơn gia công → QR tiền cọc; hàng có sẵn → QR tổng tiền", () => {
  assert.deepEqual(pay.paymentInfo(orderCustom), { amount: 5624000, addInfo: "VV-261031-0001 COC", purpose: "Tiền cọc gia công (bước T10)" });
  assert.equal(pay.paymentInfo(orderStock).amount, 7900000);
  assert.equal(pay.paymentInfo(orderStock).addInfo, "VV-261031-0002 THANHTOAN");
});
test("Đường dẫn VietQR đúng định dạng, có số tiền và mã đơn", () => {
  const url = pay.buildVietQrUrl(5624000, "VV-261031-0001 COC", BANK);
  assert.match(url, /^https:\/\/img\.vietqr\.io\/image\/970436-0123456789-compact2\.png\?/);
  assert.match(url, /amount=5624000/);
  assert.match(url, /addInfo=VV-261031-0001\+COC/);
});
test("VietQR trả ảnh → chuyển thành data URL", async () => {
  const fakeFetch = async () => ({ ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer });
  const r = await pay.createPaymentQr(orderCustom, { fetchFn: fakeFetch, bank: BANK });
  assert.equal(r.ok, true);
  assert.equal(r.source, "VietQR");
  assert.match(r.dataUrl, /^data:image\/png;base64,/);
});
test("VietQR lỗi → không làm sập, vẫn trả thông tin chuyển khoản thủ công", async () => {
  const badFetch = async () => { throw new Error("mất mạng"); };
  const r = await pay.createPaymentQr(orderStock, { fetchFn: badFetch, bank: BANK });
  assert.equal(r.ok, false);
  assert.equal(r.amount, 7900000);
  assert.match(r.error, /mất mạng/);
});
