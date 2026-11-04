// LUẬT NGHIỆP VỤ — các hàm thuần (không đụng cơ sở dữ liệu), được kiểm thử trong tests/rules.test.js
const cfg = require("./config");

// Làm tròn tiền đến hàng nghìn: round1000 làm tròn gần nhất (tiền giảm), ceil1000 làm tròn lên (tiền cọc).
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

// T05: kiểm tra mức giảm nhân viên nhập: phải là số, không âm, không vượt MAX_DISCOUNT (5%).
// Vượt hạn mức thì báo lỗi; không có bước chuyển chủ cửa hàng duyệt (đúng mô hình TO-BE).
function validateDiscount(pct) {
  if (pct === "" || pct === null || pct === undefined || isNaN(pct)) return { ok: false, error: `Nhập mức giảm từ 0 đến ${cfg.MAX_DISCOUNT}%.` };
  pct = Number(pct);
  if (pct < 0) return { ok: false, error: "Mức giảm không được âm." };
  if (pct > cfg.MAX_DISCOUNT) return { ok: false, error: `Vượt hạn mức ${cfg.MAX_DISCOUNT}% của nhân viên. Hệ thống không tự duyệt mức vượt quyền.` };
  return { ok: true, value: pct };
}

// T07: tổng = giá POS − giảm (chỉ trên giá hàng) + phí gia công (không giảm phí)
// Ví dụ: giá 18.500.000, giảm 3% = 555.000, phí 800.000 → tổng 18.745.000; cọc 30% = 5.624.000.
function calcQuote({ price, discountPct = 0, fee = 0, coGiaCong = false, depositRate = cfg.DEPOSIT_RATE }) {
  const discountAmt = round1000(price * discountPct / 100);
  const workFee = coGiaCong ? fee : 0;
  const total = price - discountAmt + workFee;
  // Chỉ đơn có gia công mới phải đặt cọc; hàng có sẵn thì tiền cọc bằng 0.
  const depositRequired = coGiaCong ? ceil1000(total * depositRate / 100) : 0;
  return { listPrice: price, discountPct, discountAmt, fee: workFee, total, depositRequired };
}

// T06: hạn hoàn thành trong giờ làm của xưởng
// Hạn thợ đưa ra phải nằm trong giờ làm 08:00–18:00 và phải sau thời điểm hiện tại.
function validateDeadline(str, now = null) {
  if (!str) return { ok: false, error: "Chọn thời điểm hoàn thành." };
  const d = new Date(str);
  if (isNaN(d)) return { ok: false, error: "Thời điểm không hợp lệ." };
  const mins = d.getHours() * 60 + d.getMinutes();
  if (mins < cfg.WORK_START * 60 || mins > cfg.WORK_END * 60) return { ok: false, error: `Hạn phải trong giờ làm việc 0${cfg.WORK_START}:00–${cfg.WORK_END}:00.` };
  if (now && d <= now) return { ok: false, error: "Hạn hoàn thành phải sau thời điểm hiện tại." };
  return { ok: true };
}

// validPhone: số điện thoại 10 số, bắt đầu bằng 0.
// available: số hàng còn bán được = tồn kho − số đã giữ cho các đơn khác.
const validPhone = p => /^0\d{9}$/.test(String(p || "").replace(/\s/g, ""));
const available = p => (p.stock || 0) - (p.reserved || 0);

// Các cổng XOR — viết thành hàm riêng để dễ đối chiếu với điều kiện trong file .bpmn
const gateways = {
  // Mỗi hàm nhận dữ liệu đơn và trả về tên bước tiếp theo, giống mũi tên đi ra khỏi cổng trong BPMN.
  // Cổng 1 “Khách yêu cầu giảm giá?”: có → T05 (nhân viên xét giảm), không → sang cổng 2.
  GDiscount: o => (o.yeu_cau_giam_gia ? "T05" : "GQuoteCustom"),     // yeuCauGiamGia = true / false
  // Cổng 2 “Cần gia công thêm?”: có → T06 (thợ xác nhận phí, hạn), không → T07 (máy tính báo giá).
  GQuoteCustom: o => (o.co_gia_cong ? "T06" : "T07"),                // coGiaCong = true / false
  // Cổng 3 “Khách chốt đơn?”: có → T09 (lưu đơn), không → kết thúc, đơn ghi là không thành công.
  GAccept: accept => (accept ? "T09" : "EndNo")                      // khachChapThuan = true / false
};

// Tạo mã đơn dạng VV-nămthángngày-số thứ tự, ví dụ VV-261031-0001.
function makeCode(id, date = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return `VV-${String(date.getFullYear()).slice(2)}${p(date.getMonth() + 1)}${p(date.getDate())}-${String(id).padStart(4, "0")}`;
}

module.exports = { NODES, LANE_ROLE, validateDiscount, calcQuote, validateDeadline, validPhone, available, gateways, makeCode, round1000, ceil1000 };
