// LUẬT NGHIỆP VỤ — các hàm thuần (không đụng cơ sở dữ liệu), được kiểm thử trong tests/rules.test.js
const cfg = require("./config");

const round1000 = n => Math.round(n / 1000) * 1000;
const ceil1000 = n => Math.ceil(n / 1000) * 1000;

// Lane BPMN → vai trò đăng nhập (lane chính là phân quyền)
const LANE_ROLE = { KH: "khach", NV: "nhanvien", TH: "tho" };

// Các hoạt động trong phạm vi ứng dụng (T01–T09 của mô hình TO-BE)
const NODES = {
  T01: { name: "Cung cấp nhu cầu và ngân sách", lane: "KH", kind: "user" },
  T02: { name: "AI Agent tra cứu và gợi ý mẫu", lane: "HT", kind: "service" },
  T03: { name: "Kiểm tra gợi ý, tư vấn và đo ni", lane: "NV", kind: "user" },
  T04: { name: "Thử mẫu, xem giá và đề nghị giảm", lane: "KH", kind: "user" },
  T05: { name: "Xét mức giảm trong hạn mức 5%", lane: "NV", kind: "user" },
  T06: { name: "Xác nhận phí và hạn gia công", lane: "TH", kind: "user" },
  T07: { name: "Tính và gửi tổng báo giá hợp lệ", lane: "HT", kind: "service" },
  T08: { name: "Chốt tổng giá, lịch hẹn và thông tin", lane: "KH", kind: "user" },
  T09: { name: "Lưu đơn POS và giữ hàng", lane: "HT", kind: "service" }
};

function validateDiscount(pct) {
  if (pct === "" || pct === null || pct === undefined || isNaN(pct)) return { ok: false, error: `Nhập mức giảm từ 0 đến ${cfg.MAX_DISCOUNT}%.` };
  pct = Number(pct);
  if (pct < 0) return { ok: false, error: "Mức giảm không được âm." };
  if (pct > cfg.MAX_DISCOUNT) return { ok: false, error: `Vượt hạn mức ${cfg.MAX_DISCOUNT}% của nhân viên. Hệ thống không tự duyệt mức vượt quyền.` };
  return { ok: true, value: pct };
}

// T07: tổng = giá POS − giảm (chỉ trên giá hàng) + phí gia công (không giảm phí)
function calcQuote({ price, discountPct = 0, fee = 0, coGiaCong = false, depositRate = cfg.DEPOSIT_RATE }) {
  const discountAmt = round1000(price * discountPct / 100);
  const workFee = coGiaCong ? fee : 0;
  const total = price - discountAmt + workFee;
  const depositRequired = coGiaCong ? ceil1000(total * depositRate / 100) : 0;
  return { listPrice: price, discountPct, discountAmt, fee: workFee, total, depositRequired };
}

// T06: hạn hoàn thành trong giờ làm của xưởng
function validateDeadline(str, now = null) {
  if (!str) return { ok: false, error: "Chọn thời điểm hoàn thành." };
  const d = new Date(str);
  if (isNaN(d)) return { ok: false, error: "Thời điểm không hợp lệ." };
  const mins = d.getHours() * 60 + d.getMinutes();
  if (mins < cfg.WORK_START * 60 || mins > cfg.WORK_END * 60) return { ok: false, error: `Hạn phải trong giờ làm việc 0${cfg.WORK_START}:00–${cfg.WORK_END}:00.` };
  if (now && d <= now) return { ok: false, error: "Hạn hoàn thành phải sau thời điểm hiện tại." };
  return { ok: true };
}

const validPhone = p => /^0\d{9}$/.test(String(p || "").replace(/\s/g, ""));
const available = p => (p.stock || 0) - (p.reserved || 0);

// Các cổng XOR — viết thành hàm riêng để dễ đối chiếu với điều kiện trong file .bpmn
const gateways = {
  GDiscount: o => (o.yeu_cau_giam_gia ? "T05" : "GQuoteCustom"),     // yeuCauGiamGia = true / false
  GQuoteCustom: o => (o.co_gia_cong ? "T06" : "T07"),                // coGiaCong = true / false
  GAccept: accept => (accept ? "T09" : "EndNo")                      // khachChapThuan = true / false
};

function makeCode(id, date = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return `VV-${String(date.getFullYear()).slice(2)}${p(date.getMonth() + 1)}${p(date.getDate())}-${String(id).padStart(4, "0")}`;
}

module.exports = { NODES, LANE_ROLE, validateDiscount, calcQuote, validateDeadline, validPhone, available, gateways, makeCode, round1000, ceil1000 };
