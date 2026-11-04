// TÍCH HỢP BÊN NGOÀI #2: VietQR — tạo mã QR chuyển khoản ngân hàng cho đơn vừa chốt ở T09.
// Dùng dịch vụ ảnh công khai img.vietqr.io (không cần khóa API). Máy chủ tải ảnh rồi trả về
// cho giao diện, nên trình duyệt không phải gọi trực tiếp ra ngoài.
const cfg = require("./config");

// Số tiền cần chuyển ở bước kế tiếp: đơn gia công → tiền cọc (T10); hàng có sẵn → tổng tiền (T18)
function paymentInfo(order) {
  const isDeposit = !!order.co_gia_cong;
  const amount = isDeposit ? order.deposit_required : order.total;
  // Nội dung chuyển khoản: không dấu, ngắn (ngân hàng giới hạn ký tự), có mã đơn để đối soát
  const addInfo = `${order.code} ${isDeposit ? "COC" : "THANHTOAN"}`;
  return { amount, addInfo, purpose: isDeposit ? "Tiền cọc gia công (bước T10)" : "Thanh toán đơn hàng (bước T18)" };
}

// Ghép đường dẫn ảnh VietQR: mã ngân hàng, số tài khoản, số tiền, nội dung chuyển khoản.
function buildVietQrUrl(amount, addInfo, bank = cfg.VIETQR) {
  const path = `${encodeURIComponent(bank.bankId)}-${encodeURIComponent(bank.account)}-${encodeURIComponent(bank.template)}.png`;
  const q = new URLSearchParams({ amount: String(Math.round(amount)), addInfo, accountName: bank.accountName });
  return `https://img.vietqr.io/image/${path}?${q}`;
}

// Máy chủ tải ảnh QR từ VietQR rồi gửi cho giao diện.
// Ứng dụng chỉ tạo mã, không nhận tiền và không biết khách đã chuyển hay chưa; nhân viên đối soát theo mã đơn.
async function createPaymentQr(order, { fetchFn = globalThis.fetch, bank = cfg.VIETQR } = {}) {
  const info = paymentInfo(order);
  const base = { ...info, bankId: bank.bankId, account: bank.account, accountName: bank.accountName, demoAccount: bank.demo };
  if (!(info.amount > 0)) return { ok: false, ...base, error: "Đơn không có số tiền cần chuyển." };
  try {
    const res = await fetchFn(buildVietQrUrl(info.amount, info.addInfo, bank), { signal: AbortSignal.timeout(10000) });
    const type = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!type.startsWith("image/")) throw new Error("VietQR không trả về ảnh");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 1024 * 1024) throw new Error("Ảnh quá lớn");
    return { ok: true, ...base, source: "VietQR", dataUrl: `data:${type};base64,${buf.toString("base64")}` };
  } catch (e) {
    // Lỗi mạng hoặc dịch vụ ngừng: vẫn trả thông tin để khách chuyển khoản thủ công
    return { ok: false, ...base, error: `Không tạo được mã QR (${e.message}). Khách có thể chuyển khoản thủ công theo thông tin bên dưới.` };
  }
}

module.exports = { paymentInfo, buildVietQrUrl, createPaymentQr };
