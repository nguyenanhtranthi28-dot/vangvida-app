// ĐỘNG CƠ QUY TRÌNH — đưa một đơn tư vấn đi qua các hoạt động T01–T09 đúng như mô hình TO-BE.
// Mọi kiểm tra quyền và luật đều chạy ở máy chủ; giao diện chỉ hiển thị.
const cfg = require("./config");
const { tx } = require("./db");
const R = require("./rules");

class BizError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const COLUMNS = new Set(["code","node","status","need_type","need_budget","need_size","need_stone","need_gender","need_note","contact_channel",
  "product_id","measured_size","co_gia_cong","custom_note","yeu_cau_giam_gia","requested_discount","discount_pct","work_fee","work_deadline",
  "list_price","discount_amt","total","deposit_required","appointment"]);

function updateOrder(db, id, fields) {
  const keys = Object.keys(fields);
  for (const k of keys) if (!COLUMNS.has(k)) throw new Error(`Cột không hợp lệ: ${k}`);
  const sql = `UPDATE orders SET ${keys.map(k => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`;
  db.prepare(sql).run(...keys.map(k => fields[k]), id);
}
function log(db, orderId, node, lane, actorId, text) {
  db.prepare("INSERT INTO order_history (order_id,node,lane,actor_id,text) VALUES (?,?,?,?,?)").run(orderId, node, lane, actorId ?? null, text);
}
const gwLog = (db, id, name, answer) => log(db, id, "GW", "HT", null, `Cổng “${name}” → ${answer}`);
const fmt = n => (Number(n) || 0).toLocaleString("vi-VN") + " ₫";
const catalog = db => db.prepare("SELECT * FROM products ORDER BY id").all();
const getOrder = (db, id) => db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(id));

// Ai được xem đơn nào
function canSee(user, o) {
  if (!o) return false;
  if (user.role === "nhanvien") return true;
  if (user.role === "khach") return o.customer_id === user.id;
  if (user.role === "tho") return o.co_gia_cong === 1;
  return false;
}
function listOrders(db, user) {
  if (user.role === "nhanvien") return db.prepare("SELECT * FROM orders ORDER BY id DESC").all();
  if (user.role === "khach") return db.prepare("SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC").all(user.id);
  return db.prepare("SELECT * FROM orders WHERE co_gia_cong = 1 ORDER BY id DESC").all();
}
// Việc đang chờ vai trò này (lane → vai trò)
function myTasks(db, user) {
  return listOrders(db, user).filter(o => o.status === "open" && R.NODES[o.node] && R.LANE_ROLE[R.NODES[o.node].lane] === user.role);
}
function orderDetail(db, id) {
  const o = getOrder(db, id);
  return {
    order: o,
    customer: db.prepare("SELECT id, full_name, phone FROM users WHERE id = ?").get(o.customer_id),
    product: o.product_id ? db.prepare("SELECT * FROM products WHERE id = ?").get(o.product_id) : null,
    suggestions: db.prepare(`SELECT s.*, p.name, p.price, p.stock, p.reserved, p.size, p.material, p.stone FROM ai_suggestions s
                             JOIN products p ON p.id = s.product_id WHERE s.order_id = ? AND s.created_at = (SELECT MAX(created_at) FROM ai_suggestions WHERE order_id = ?)
                             ORDER BY s.confidence DESC`).all(o.id, o.id),
    history: db.prepare(`SELECT h.*, u.full_name AS actor FROM order_history h LEFT JOIN users u ON u.id = h.actor_id WHERE h.order_id = ? ORDER BY h.id`).all(o.id)
  };
}

/* ---------- T01: khách tạo yêu cầu (sự kiện bắt đầu) ---------- */
async function createOrder(db, user, d, aiFn) {
  if (user.role !== "khach") throw new BizError("Chỉ khách hàng thực hiện T01.", 403);
  if (!d.type) throw new BizError("Chọn loại trang sức.");
  if (!(Number(d.budget) > 0)) throw new BizError("Ngân sách phải lớn hơn 0.");
  if (d.phone && !R.validPhone(d.phone)) throw new BizError("Số điện thoại phải gồm 10 số, bắt đầu bằng 0.");
  const id = tx(db, () => {
    const r = db.prepare(`INSERT INTO orders (customer_id,node,need_type,need_budget,need_size,need_stone,need_gender,need_note,contact_channel)
                          VALUES (?,?,?,?,?,?,?,?,?)`).run(user.id, "T02", d.type, Number(d.budget), d.size || "", d.stone || "", d.gender || "", String(d.note || "").slice(0, 500), d.channel || "Zalo");
    const oid = Number(r.lastInsertRowid);
    if (d.phone) db.prepare("UPDATE users SET phone = ? WHERE id = ?").run(String(d.phone).replace(/\s/g, ""), user.id);
    log(db, oid, "T01", "KH", user.id, `Khách cần ${d.type}, ngân sách ${fmt(d.budget)}${d.stone ? `, đá ${d.stone}` : ""}${d.size ? `, ni ${d.size}` : ""}.`);
    return oid;
  });
  await runAuto(db, id, aiFn);
  return id;
}

/* ---------- Các user task còn lại ---------- */
const HANDLERS = {
  // T03 — nhân viên kiểm tra gợi ý, tư vấn, đo ni
  T03(db, o, d, user) {
    const p = db.prepare("SELECT * FROM products WHERE id = ?").get(String(d.productId || ""));
    if (!p) throw new BizError("Chọn một mẫu cho khách thử.");
    if (R.available(p) <= 0) throw new BizError("Mẫu này đã hết hàng khả dụng.");
    const co = d.coGiaCong ? 1 : 0;
    if (co && !String(d.customNote || "").trim()) throw new BizError("Ghi yêu cầu gia công (ni, khắc, điều chỉnh…).");
    updateOrder(db, o.id, { product_id: p.id, measured_size: d.measuredSize || "", co_gia_cong: co, custom_note: d.customNote || "" });
    const fromAI = db.prepare("SELECT 1 FROM ai_suggestions WHERE order_id = ? AND product_id = ?").get(o.id, p.id);
    log(db, o.id, "T03", "NV", user.id, `Chọn ${p.name}${fromAI ? " (từ gợi ý AI)" : " (tra cứu thủ công)"}; ni đo ${d.measuredSize || "—"}; ${co ? "cần gia công" : "không gia công"}.`);
    return "T04";
  },
  // T04 — khách thử mẫu, có thể đề nghị giảm → cổng GDiscount
  T04(db, o, d, user) {
    const yeu = d.yeuCauGiamGia ? 1 : 0;
    const req = Number(d.requestedDiscount) || 0;
    if (yeu && req <= 0) throw new BizError("Nhập mức giảm khách đề nghị.");
    updateOrder(db, o.id, { yeu_cau_giam_gia: yeu, requested_discount: yeu ? req : 0, discount_pct: 0 });
    log(db, o.id, "T04", "KH", user.id, yeu ? `Khách đề nghị giảm ${req}%.` : "Khách đồng ý giá niêm yết.");
    gwLog(db, o.id, "Khách yêu cầu giảm giá?", yeu ? "Có" : "Không");
    const next = R.gateways.GDiscount({ yeu_cau_giam_gia: yeu });
    return next === "T05" ? "T05" : quoteGateway(db, getOrder(db, o.id));
  },
  // T05 — nhân viên duyệt mức giảm 0–5%
  T05(db, o, d, user) {
    const v = R.validateDiscount(d.discountPct);
    if (!v.ok) throw new BizError(v.error);
    if (v.value > o.requested_discount) throw new BizError(`Không duyệt cao hơn mức khách đề nghị (${o.requested_discount}%).`);
    updateOrder(db, o.id, { discount_pct: v.value });
    log(db, o.id, "T05", "NV", user.id, `Duyệt giảm ${v.value}% (khách đề nghị ${o.requested_discount}%).`);
    return quoteGateway(db, o);
  },
  // T06 — thợ xác nhận phí và hạn gia công
  T06(db, o, d, user, opts) {
    if (!d.feasible) throw new BizError("Xưởng không nhận được thì xử lý như ngoại lệ (thương lượng lại với khách).");
    if (d.workFee === "" || d.workFee === undefined || !(Number(d.workFee) >= 0)) throw new BizError("Nhập phí gia công (0 nếu miễn phí).");
    const v = R.validateDeadline(d.workDeadline, opts.checkPast ? new Date() : null);
    if (!v.ok) throw new BizError(v.error);
    updateOrder(db, o.id, { work_fee: Number(d.workFee), work_deadline: d.workDeadline });
    log(db, o.id, "T06", "TH", user.id, `Xác nhận phí ${fmt(d.workFee)}, hạn ${d.workDeadline.replace("T", " ")}.`);
    return "T07";
  },
  // T08 — khách chốt hoặc không → cổng GAccept
  T08(db, o, d, user) {
    const accept = !!d.accept;
    gwLog(db, o.id, "Khách chốt đơn?", accept ? "Có" : "Không");
    if (!accept) {
      updateOrder(db, o.id, { status: "lost" });
      log(db, o.id, "T08", "KH", user.id, "Khách chưa chốt đơn. Kết thúc tư vấn.");
      return R.gateways.GAccept(false);
    }
    if (o.co_gia_cong && !d.appointment) throw new BizError("Chọn lịch hẹn nhận hàng gia công.");
    if (o.co_gia_cong && new Date(d.appointment) < new Date(o.work_deadline)) throw new BizError("Lịch hẹn nhận hàng phải sau hạn hoàn thành của xưởng.");
    updateOrder(db, o.id, { appointment: d.appointment || "", contact_channel: d.channel || o.contact_channel });
    log(db, o.id, "T08", "KH", user.id, `Chấp thuận tổng giá ${fmt(o.total)}${d.appointment ? `, hẹn ${d.appointment.replace("T", " ")}` : ""}.`);
    return R.gateways.GAccept(true);
  }
};

function quoteGateway(db, o) {
  gwLog(db, o.id, "Cần gia công thêm?", o.co_gia_cong ? "Có" : "Không");
  return R.gateways.GQuoteCustom(o);
}

async function doTask(db, user, orderId, node, data, aiFn, opts = { checkPast: true }) {
  const o = getOrder(db, orderId);
  if (!o || !canSee(user, o)) throw new BizError("Không tìm thấy đơn.", 404);
  if (o.status !== "open") throw new BizError("Đơn đã kết thúc.", 409);
  const meta = R.NODES[node];
  if (!meta || meta.kind !== "user" || node === "T01") throw new BizError(`${node} không phải tác vụ người dùng.`, 400);
  if (R.LANE_ROLE[meta.lane] !== user.role) throw new BizError(`${node} thuộc lane “${meta.lane}”, vai trò của bạn không được thực hiện.`, 403);
  if (o.node !== node) throw new BizError(`Đơn đang ở ${o.node}, chưa thể thực hiện ${node}.`, 409);
  tx(db, () => {
    const next = HANDLERS[node](db, o, data || {}, user, opts);
    updateOrder(db, o.id, { node: next });
  });
  await runAuto(db, o.id, aiFn);
  return getOrder(db, o.id);
}

/* ---------- Service task (lane Hệ thống & AI) chạy tự động ---------- */
async function runT02(db, id, aiFn) {
  const o = getOrder(db, id);
  const need = { type: o.need_type, budget: o.need_budget, size: o.need_size, stone: o.need_stone, gender: o.need_gender, note: o.need_note };
  const r = await aiFn(need, catalog(db));
  tx(db, () => {
    const at = new Date().toISOString();
    const ins = db.prepare("INSERT INTO ai_suggestions (order_id,product_id,confidence,reason,source,created_at) VALUES (?,?,?,?,?,?)");
    for (const it of r.items) ins.run(id, it.id, it.confidence, it.reason, r.source, at);
    const low = r.items.filter(i => i.confidence < cfg.AI_THRESHOLD).length;
    log(db, id, "T02", "HT", null, `${r.source}: ${r.items.length} gợi ý${low ? `, ${low} dưới ngưỡng tin cậy ${cfg.AI_THRESHOLD}` : ""}.`);
    if (getOrder(db, id).node === "T02") updateOrder(db, id, { node: "T03" });
  });
}
function runT07(db, id) {
  const o = getOrder(db, id);
  const p = db.prepare("SELECT price FROM products WHERE id = ?").get(o.product_id);
  const q = R.calcQuote({ price: p.price, discountPct: o.discount_pct, fee: o.work_fee, coGiaCong: !!o.co_gia_cong });
  updateOrder(db, id, { list_price: q.listPrice, discount_amt: q.discountAmt, total: q.total, deposit_required: q.depositRequired, node: "T08" });
  log(db, id, "T07", "HT", null, `Báo giá: ${fmt(q.listPrice)} − ${fmt(q.discountAmt)} + phí ${fmt(q.fee)} = ${fmt(q.total)}${q.depositRequired ? `; cọc ${fmt(q.depositRequired)}` : ""}.`);
}
function runT09(db, id) {
  const o = getOrder(db, id);
  const p = db.prepare("SELECT * FROM products WHERE id = ?").get(o.product_id);
  if (R.available(p) <= 0) { // ngoại lệ POS: hàng vừa bị giữ cho đơn khác
    updateOrder(db, id, { node: "T03" });
    log(db, id, "T09", "HT", null, `Không giữ được ${p.name} (hết hàng khả dụng). Quay lại T03 chọn mẫu khác.`);
    return;
  }
  db.prepare("UPDATE products SET reserved = reserved + 1 WHERE id = ?").run(p.id);
  const code = R.makeCode(id);
  const next = o.co_gia_cong ? "CHO_COC" : "CHO_GIAO";
  updateOrder(db, id, { code, status: "won", node: next });
  log(db, id, "T09", "HT", null, `Lưu đơn ${code}, giữ 1 ${p.name}.`);
  gwLog(db, id, "Đơn có gia công?", o.co_gia_cong ? "Có → chuyển sang thu cọc (T10, ngoài phạm vi ứng dụng)" : "Không → chuyển sang đóng gói, thanh toán (T16, ngoài phạm vi ứng dụng)");
}
async function runAuto(db, id, aiFn) {
  for (let i = 0; i < 10; i++) {
    const node = getOrder(db, id).node;
    if (node === "T02") await runT02(db, id, aiFn);
    else if (node === "T07") tx(db, () => runT07(db, id));
    else if (node === "T09") tx(db, () => runT09(db, id));
    else return;
  }
}

// Service task T02 gọi lại theo yêu cầu nhân viên (khi gợi ý không phù hợp)
async function rerunAI(db, user, id, aiFn) {
  const o = getOrder(db, id);
  if (!o) throw new BizError("Không tìm thấy đơn.", 404);
  if (user.role !== "nhanvien") throw new BizError("Chỉ nhân viên được chạy lại gợi ý.", 403);
  if (o.node !== "T03") throw new BizError("Chỉ chạy lại gợi ý khi đơn đang ở T03.", 409);
  await runT02(db, id, aiFn);
}

module.exports = { BizError, createOrder, doTask, rerunAI, listOrders, myTasks, orderDetail, canSee, getOrder, catalog };
