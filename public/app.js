// GIAO DIỆN — gọi API của máy chủ; mọi kiểm tra quyền và luật nằm ở máy chủ (src/process.js).
"use strict";

const LANES = { KH: "Khách hàng", NV: "Nhân viên cửa hàng", HT: "Hệ thống & AI", TH: "Bộ phận gia công" };
const ROLE_LANE = { khach: "KH", nhanvien: "NV", tho: "TH" };
const ROLE_NAME = { khach: "Khách hàng", nhanvien: "Nhân viên", tho: "Thợ gia công" };
const NODES = {
  T01: ["Cung cấp nhu cầu và ngân sách", "KH"], T02: ["AI Agent tra cứu và gợi ý mẫu", "HT"],
  T03: ["Kiểm tra gợi ý, tư vấn và đo ni", "NV"], T04: ["Thử mẫu, xem giá và đề nghị giảm", "KH"],
  T05: ["Xét mức giảm trong hạn mức 5%", "NV"], T06: ["Xác nhận phí và hạn gia công", "TH"],
  T07: ["Tính và gửi tổng báo giá hợp lệ", "HT"], T08: ["Chốt tổng giá, lịch hẹn và thông tin", "KH"],
  T09: ["Lưu đơn POS và giữ hàng", "HT"]
};
const TYPES = ["Nhẫn", "Vòng tay", "Dây chuyền", "Khuyên tai"];
const STONES = ["Emerald", "Ruby", "Sapphire", "Garnet", "Peridot", "Spinel", "Tourmaline", "Moissanite", "Cẩm thạch"];
const STONE_COLOR = { Emerald: "#2e8b57", Ruby: "#b0203a", Sapphire: "#2a4f9e", Garnet: "#7a1f2b", Peridot: "#8fae2e", Spinel: "#c2457a", Tourmaline: "#1f8a8a", Moissanite: "#c9d6df", "Cẩm thạch": "#5c9e6e" };
const NEXT_LABEL = { CHO_COC: "Đã chốt · chuyển sang thu cọc (T10)", CHO_GIAO: "Đã chốt · chuyển sang đóng gói và thanh toán (T16)", EndNo: "Kết thúc tư vấn, chưa chốt" };

const S = { me: null, settings: {}, products: [], tasks: [], orders: [], sel: null, detail: null, flash: null, busy: false, report: null };

/* ---------- Tiện ích ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => (Number(n) || 0).toLocaleString("vi-VN") + " ₫";
const fmtDT = s => { if (!s) return "—"; const d = new Date(s.includes("T") || s.includes("Z") ? s : s.replace(" ", "T") + "Z"); return isNaN(d) ? s : d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }); };
const avail = p => p.stock - p.reserved;
const gem = stone => { const c = STONE_COLOR[stone] || "#b08d57";
  return `<svg viewBox="0 0 100 90" aria-hidden="true"><polygon points="20,5 80,5 98,30 50,88 2,30" fill="${c}"/><polygon points="20,5 35,30 2,30" fill="#fff" opacity=".28"/><polygon points="35,30 65,30 50,88" fill="#fff" opacity=".15"/><polygon points="80,5 65,30 98,30" fill="#000" opacity=".15"/></svg>`; };

async function api(method, path, body) {
  const res = await fetch(path, {
    method, credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Requested-With": "vangvida" },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/login" && path !== "/api/register") { S.me = null; render(); }
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}

/* ---------- Điều hướng ---------- */
function tabsFor(role) {
  const t = [["viec", "Việc của tôi"], ["don", role === "khach" ? "Yêu cầu của tôi" : role === "tho" ? "Đơn gia công" : "Đơn tư vấn"], ["danh-muc", "Trang sức"]];
  if (role === "nhanvien") t.push(["bao-cao", "Báo cáo"]);
  return t;
}
const tab = () => { const h = location.hash.slice(1); return S.me && tabsFor(S.me.role).some(t => t[0] === h) ? h : "viec"; };

async function refresh() {
  if (!S.me) return;
  [S.tasks, S.orders, S.products] = await Promise.all([api("GET", "/api/tasks"), api("GET", "/api/orders"), api("GET", "/api/products")]);
  if (S.sel && S.sel !== "new") S.detail = await api("GET", `/api/orders/${S.sel}`);
  if (tab() === "bao-cao") S.report = await api("GET", "/api/report");
}

/* ---------- Khung trang ---------- */
function render() {
  const app = $("app");
  if (!S.me) {
    $("tabs").innerHTML = ""; $("who").innerHTML = "";
    app.innerHTML = viewLogin();
    return;
  }
  const t = tab();
  $("tabs").innerHTML = tabsFor(S.me.role).map(([id, l]) => `<a href="#${id}" ${id === t ? 'aria-current="page"' : ""}>${l}</a>`).join("");
  $("who").innerHTML = `<span class="lane-tag"><i class="dot l-${ROLE_LANE[S.me.role]}"></i>${esc(S.me.fullName)} · ${ROLE_NAME[S.me.role]}</span><button class="btn ghost sm" data-act="logout">Đăng xuất</button>`;
  const title = tabsFor(S.me.role).find(x => x[0] === t)[1];
  let html = `<div class="crumb">Trang chủ / ${title}</div>`;
  if (t === "viec") html += viewDesk();
  if (t === "don") html += viewOrders();
  if (t === "danh-muc") html += viewCatalog();
  if (t === "bao-cao") html += viewReport();
  app.innerHTML = html;
}

function viewLogin() {
  const err = S.flash ? `<div class="msg ${S.flash.ok ? "ok" : "err"}" role="alert">${esc(S.flash.text)}</div>` : "";
  const v = k => esc((S.draft || {})[k] || "");   // giữ lại chữ đã gõ khi báo lỗi (trừ mật khẩu)
  if (S.authMode === "register") {
    return `<div class="login panel"><h2>Đăng ký tài khoản khách hàng</h2><p class="muted small">Tài khoản dùng để gửi yêu cầu tư vấn, xem báo giá và chốt đơn. Tài khoản nhân viên và thợ gia công do cửa hàng cấp.</p>
      <label class="f mt">Họ và tên<input name="fullName" id="rn" autocomplete="name" value="${v("fullName")}"></label>
      <label class="f mt">Số điện thoại<input name="phone" id="rp" inputmode="tel" autocomplete="tel" placeholder="0905123456" value="${v("phone")}"></label>
      <label class="f mt">Tên đăng nhập<input name="username" id="ru" autocomplete="username" placeholder="ví dụ: thuha.nguyen" value="${v("username")}"></label>
      <label class="f mt">Mật khẩu (ít nhất 8 ký tự)<input name="password" id="rw" type="password" autocomplete="new-password"></label>
      <label class="f mt">Nhập lại mật khẩu<input name="password2" id="rw2" type="password" autocomplete="new-password"></label>
      <div class="btn-row"><button class="btn" data-act="register">Đăng ký</button></div>${err}
      <p class="small mt">Đã có tài khoản? <button class="btn ghost sm" data-act="mode" data-v="login">Đăng nhập</button></p></div>`;
  }
  return `<div class="login panel"><h2>Đăng nhập</h2><p class="muted small">Mỗi tài khoản gắn với một vai trò trong quy trình. Bạn chỉ thấy và thực hiện được các việc thuộc lane của mình.</p>
    <label class="f mt">Tên đăng nhập<input name="username" id="lu" autocomplete="username" value="${v("login")}"></label>
    <label class="f mt">Mật khẩu<input name="password" id="lp" type="password" autocomplete="current-password"></label>
    <div class="btn-row"><button class="btn" data-act="login">Đăng nhập</button></div>${err}
    <p class="small mt">Khách hàng chưa có tài khoản? <button class="btn ghost sm" data-act="mode" data-v="register">Đăng ký</button></p></div>`;
}

/* ---------- Việc của tôi ---------- */
function viewDesk() {
  const lane = ROLE_LANE[S.me.role];
  const inbox = S.tasks.length ? S.tasks.map(o => `<button class="task l-${NODES[o.node][1]}" data-act="open" data-id="${o.id}" ${String(S.sel) === String(o.id) ? 'aria-current="true"' : ""}>
      <strong>${o.node} · ${esc(NODES[o.node][0])}</strong><span>${esc(o.code || `Yêu cầu #${o.id}`)} · ${esc(o.need_type)}, ${fmt(o.need_budget)}</span></button>`).join("")
    : `<p class="small muted">Không có việc đang chờ bạn.</p>`;
  let right;
  if (S.sel === "new") right = viewNewRequest();
  else if (S.detail) right = viewOrder(S.detail);
  else right = `<div class="empty">${S.me.role === "khach" ? "Bấm “Tạo yêu cầu tư vấn” để bắt đầu, hoặc chọn một việc bên trái." : "Chọn một việc bên trái để xử lý."}</div>`;
  return `<div class="pagehead"><div><h2>Việc của tôi</h2><p class="muted small">Các hoạt động thuộc lane “${LANES[lane]}” đang chờ bạn. Bước của lane Hệ thống &amp; AI tự chạy.</p></div>
    ${S.me.role === "khach" ? `<button class="btn" data-act="new">Tạo yêu cầu tư vấn</button>` : ""}</div>
    <div class="desk"><aside class="panel"><h3>${S.tasks.length} việc đang chờ</h3>${inbox}</aside><section>${right}</section></div>`;
}

function flashBox() { return S.flash ? `<div class="msg ${S.flash.ok ? "ok" : "err"}" role="status">${esc(S.flash.text)}</div>` : ""; }
function submitBtn(label, node, extra = "") {
  return `<div class="btn-row"><button class="btn" data-act="do" data-node="${node}" ${extra} ${S.busy ? "disabled" : ""}>${S.busy ? "Đang xử lý…" : label}</button></div>`;
}
const opts = (arr, v) => arr.map(x => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("");

function viewNewRequest() {
  return `<div class="panel"><div class="taskhead"><div><div class="code">T01</div><h3>${NODES.T01[0]}</h3><span class="lane-tag"><i class="dot l-KH"></i>${LANES.KH}</span></div></div>
    <p class="doc">Cho cửa hàng biết loại trang sức, ngân sách, ni và nhu cầu điều chỉnh nếu đã biết. Sau khi gửi, AI tra cứu danh mục và gợi ý mẫu còn hàng (T02), nhân viên sẽ kiểm tra lại.</p>
    <div class="grid2">
      <label class="f">Loại trang sức<select name="type"><option value="">Chọn</option>${opts(TYPES)}</select></label>
      <label class="f">Ngân sách (₫)<input name="budget" type="number" min="0" step="100000"></label>
      <label class="f">Dành cho<select name="gender"><option value="">Không rõ</option>${opts(["Nữ", "Nam"])}</select></label>
      <label class="f">Đá ưa thích<select name="stone"><option value="">Không yêu cầu</option>${opts(STONES)}</select></label>
      <label class="f">Ni (nếu biết)<input name="size"></label>
      <label class="f">Số điện thoại<input name="phone" inputmode="tel" value="${esc(S.me.phone || "")}"></label>
      <label class="f">Kênh liên hệ<select name="channel">${opts(["Zalo", "SMS", "Điện thoại", "Facebook"])}</select></label>
    </div>
    <label class="f mt">Ghi chú / nhu cầu điều chỉnh<textarea name="note"></textarea></label>
    <div class="btn-row"><button class="btn" data-act="create" ${S.busy ? "disabled" : ""}>${S.busy ? "AI đang tra cứu…" : "Gửi yêu cầu"}</button></div>${flashBox()}</div>`;
}

function viewTrack(d) {
  const o = d.order, done = new Set(d.history.map(h => h.node));
  const passedQuote = done.has("T07");
  const cells = Object.keys(NODES).map(id => {
    let c = done.has(id) ? "done" : "todo";
    if (o.node === id && o.status === "open") c = "cur";
    if (c === "todo" && passedQuote && ((id === "T05" && !o.yeu_cau_giam_gia) || (id === "T06" && !o.co_gia_cong))) c = "skip";
    return `<div class="step l-${NODES[id][1]} ${c}" title="${id} · ${esc(NODES[id][0])} (${LANES[NODES[id][1]]})">${id}</div>`;
  }).join("");
  return `<div class="track">${cells}</div>`;
}

function viewOrder(d) {
  const o = d.order, p = d.product;
  const myTurn = o.status === "open" && NODES[o.node] && NODES[o.node][1] === ROLE_LANE[S.me.role];
  const statusText = o.status === "open" ? (NODES[o.node] ? `Đang chờ ${o.node} · ${NODES[o.node][0]}` : o.node) : (NEXT_LABEL[o.node] || o.status);
  let html = "";
  if (myTurn) {
    html += `<div class="panel"><div class="taskhead"><div><div class="code">${o.node}</div><h3>${esc(NODES[o.node][0])}</h3><span class="lane-tag"><i class="dot l-${NODES[o.node][1]}"></i>${LANES[NODES[o.node][1]]}</span></div>
      <div class="small muted right">${esc(o.code || `Yêu cầu #${o.id}`)}<br>${esc(d.customer.full_name)}</div></div>${taskForm(d)}${flashBox()}</div>`;
  } else {
    html += `<div class="panel"><h3>${esc(o.code || `Yêu cầu #${o.id}`)}</h3><p class="muted">${esc(statusText)}</p>${flashBox()}</div>`;
  }
  if (o.status === "won") html += viewPayment(o);
  html += `<div class="panel"><h3>Tiến trình theo mô hình TO-BE</h3>${viewTrack(d)}<p class="small muted">✓ đã thực hiện · ● đang chờ · – bỏ qua theo cổng XOR. Ứng dụng hỗ trợ T01–T09; các bước sau (cọc, gia công, thanh toán) nằm ngoài phạm vi.</p></div>`;
  html += `<div class="panel"><div class="grid2"><div><h3>Thông tin</h3><dl class="sum">
      <dt>Khách</dt><dd>${esc(d.customer.full_name)} ${d.customer.phone ? "· " + esc(d.customer.phone) : ""}</dd>
      <dt>Nhu cầu</dt><dd>${esc(o.need_type)}, ${fmt(o.need_budget)}${o.need_stone ? ", đá " + esc(o.need_stone) : ""}${o.need_size ? ", ni " + esc(o.need_size) : ""}</dd>
      ${o.need_note ? `<dt>Ghi chú</dt><dd>${esc(o.need_note)}</dd>` : ""}
      <dt>Sản phẩm</dt><dd>${p ? esc(p.name) : "—"}</dd>
      <dt>Gia công</dt><dd>${o.product_id ? (o.co_gia_cong ? "Có: " + esc(o.custom_note) : "Không") : "—"}</dd>
      ${o.work_deadline ? `<dt>Hạn xưởng</dt><dd>${esc(o.work_deadline.replace("T", " "))}</dd>` : ""}
      ${o.appointment ? `<dt>Lịch hẹn</dt><dd>${esc(o.appointment.replace("T", " "))}</dd>` : ""}
    </dl></div><div>${o.total != null ? quoteBox(o) : ""}</div></div></div>`;
  html += `<div class="panel"><h3>Nhật ký quy trình</h3><ul class="history">${d.history.slice().reverse().map(h => `<li class="l-${h.lane}"><time>${fmtDT(h.at)}</time><b>${h.node === "GW" ? "Cổng" : h.node}</b> ${esc(h.text)}${h.actor ? ` <span class="muted">(${esc(h.actor)})</span>` : ""}</li>`).join("")}</ul></div>`;
  return html;
}

// Mã QR VietQR cho bước thanh toán kế tiếp (tích hợp bên ngoài, máy chủ gọi giúp)
function viewPayment(o) {
  const q = S.qr && S.qr.orderId === o.id ? S.qr.data : null;
  let body;
  if (!q) body = `<p class="muted small">Tạo mã QR chuyển khoản ${o.co_gia_cong ? "tiền cọc" : "thanh toán"} cho khách quét bằng ứng dụng ngân hàng.</p>
    <div class="btn-row"><button class="btn sm" data-act="qr" ${S.busy ? "disabled" : ""}>${S.busy ? "Đang tạo…" : "Tạo mã QR chuyển khoản"}</button></div>`;
  else body = `<div class="qr">${q.ok ? `<img src="${q.dataUrl}" alt="Mã QR chuyển khoản ${fmt(q.amount)}">` : ""}<dl class="sum">
      <dt>Mục đích</dt><dd>${esc(q.purpose)}</dd><dt>Số tiền</dt><dd class="total money">${fmt(q.amount)}</dd>
      <dt>Nội dung</dt><dd>${esc(q.addInfo)}</dd><dt>Tài khoản</dt><dd>${esc(q.account)} · ${esc(q.accountName)}</dd></dl></div>
      ${q.ok ? `<p class="small muted">Nguồn: VietQR${q.demoAccount ? " · tài khoản demo, không chuyển tiền thật" : ""}</p>` : `<div class="msg err">${esc(q.error)}</div>`}`;
  return `<div class="panel"><h3>Thanh toán bước tiếp theo</h3>${body}</div>`;
}

function quoteBox(o) {
  return `<h3>Báo giá (T07)</h3><dl class="sum">
    <dt>Giá niêm yết POS</dt><dd class="money">${fmt(o.list_price)}</dd>
    <dt>Giảm ${o.discount_pct}%</dt><dd class="money">− ${fmt(o.discount_amt)}</dd>
    <dt>Phí gia công</dt><dd class="money">${fmt(o.co_gia_cong ? o.work_fee : 0)}</dd>
    <dt>Tổng</dt><dd class="total money">${fmt(o.total)}</dd>
    ${o.deposit_required ? `<dt>Cọc yêu cầu</dt><dd class="money">${fmt(o.deposit_required)}</dd>` : ""}</dl>`;
}

function taskForm(d) {
  const o = d.order, p = d.product, st = S.settings;
  switch (o.node) {
    case "T03": {
      const th = st.aiThreshold;
      const cards = d.suggestions.map(s => `<label class="prod"><input type="radio" name="productId" value="${s.product_id}">
          <div class="pic">${gem(s.stone)}</div><h4>${esc(s.name)}</h4><div class="price money">${fmt(s.price)}</div>
          <div class="meta">${esc(s.material)} · ni ${esc(s.size || "—")} · còn ${s.stock - s.reserved}</div>
          <meter min="0" max="1" low="${th}" optimum="1" value="${s.confidence}" title="Độ tin cậy ${s.confidence}"></meter>
          <div class="meta">Tin cậy ${Math.round(s.confidence * 100)}% ${s.confidence < th ? '<span class="badge b-warn">Cần kiểm tra</span>' : '<span class="badge b-ok">Đạt ngưỡng</span>'}</div>
          <div class="meta">${esc(s.reason)}</div></label>`).join("");
      const noneGood = !d.suggestions.some(s => s.confidence >= th);
      const manual = S.products.filter(x => avail(x) > 0).map(x => `<option value="${x.id}">${esc(x.name)} · ${fmt(x.price)} · còn ${avail(x)}</option>`).join("");
      return `<p class="doc">Kiểm tra gợi ý của AI (nguồn: ${esc(d.suggestions[0] ? d.suggestions[0].source : "không có gợi ý")}), tư vấn, đo ni và đưa mẫu cho khách thử. Giá và tồn lấy từ danh mục, không do AI đặt. Gợi ý dưới ngưỡng ${th} cần kiểm tra kỹ.</p>
        ${noneGood ? `<div class="msg err">Không có gợi ý nào đạt ngưỡng tin cậy. Hãy tra cứu thủ công bên dưới.</div>` : ""}
        ${cards ? `<div class="products mt">${cards}</div>` : ""}
        <div class="btn-row"><button class="btn ghost sm" data-act="rerun">Chạy lại gợi ý AI</button></div>
        <label class="f mt">Hoặc tra cứu thủ công<select name="manualId"><option value="">Không dùng</option>${manual}</select></label>
        <div class="grid2 mt"><label class="f">Ni đo thực tế<input name="measuredSize" value="${esc(o.need_size || "")}"></label></div>
        <label class="check"><input type="checkbox" name="coGiaCong"> Cần gia công thêm (đổi ni, khắc chữ, điều chỉnh mẫu)</label>
        <label class="f">Yêu cầu gia công<textarea name="customNote" placeholder="Ví dụ: thu ni 11 → 9, khắc chữ M.A"></textarea></label>
        ${submitBtn("Chuyển mẫu cho khách thử", "T03")}`;
    }
    case "T04": return `<p class="doc">Thử mẫu, xem giá niêm yết và nêu đề nghị giảm giá nếu có.</p>
      <div class="mini">${gem(p.stone)}<div><b>${esc(p.name)}</b><br><span class="price money">${fmt(p.price)}</span> <span class="small muted">giá niêm yết</span>
      ${o.co_gia_cong ? `<br><span class="small muted">Có gia công: ${esc(o.custom_note)}. Phí do thợ xác nhận sau.</span>` : ""}</div></div>
      <div class="radio-row"><label class="check"><input type="radio" name="yeuCauGiamGia" value="0" checked> Đồng ý giá niêm yết</label><label class="check"><input type="radio" name="yeuCauGiamGia" value="1"> Đề nghị giảm giá</label></div>
      <label class="f narrow">Mức đề nghị (%)<input name="requestedDiscount" type="number" min="0" step="0.5"></label>
      ${submitBtn("Xác nhận", "T04")}`;
    case "T05": return `<p class="doc">Quyết định mức giảm từ 0 đến ${st.maxDiscount}% trong thẩm quyền. Không mặc định giảm đủ ${st.maxDiscount}%. Hệ thống không tự duyệt mức vượt quyền.</p>
      <p>Khách đề nghị <b>${o.requested_discount}%</b> trên ${fmt(p.price)} ${o.requested_discount > st.maxDiscount ? '<span class="badge b-warn">Vượt hạn mức</span>' : ""}</p>
      <label class="f narrow">Mức giảm duyệt (%)<input name="discountPct" type="number" min="0" max="${st.maxDiscount}" step="0.5"></label>
      ${submitBtn("Ghi nhận mức giảm", "T05")}`;
    case "T06": return `<p class="doc">Xem yêu cầu, tình trạng ni và lịch xưởng 0${st.workStart}:00–${st.workEnd}:00; xác nhận khả năng thực hiện, phí và thời điểm hoàn thành trước khi khách chốt.</p>
      <dl class="sum"><dt>Mẫu nền</dt><dd>${esc(p.name)} (ni ${esc(p.size || "—")})</dd><dt>Ni đo</dt><dd>${esc(o.measured_size || "—")}</dd><dt>Yêu cầu</dt><dd>${esc(o.custom_note)}</dd></dl>
      <label class="check mt"><input type="checkbox" name="feasible" checked> Xưởng nhận thực hiện được</label>
      <div class="grid2"><label class="f">Phí gia công (₫)<input name="workFee" type="number" min="0" step="50000"></label><label class="f">Hạn hoàn thành<input name="workDeadline" type="datetime-local"></label></div>
      ${submitBtn("Xác nhận phí và hạn", "T06")}`;
    case "T08": return `<p class="doc">Xem tổng báo giá; xác nhận phương án${o.co_gia_cong ? ", lịch hẹn nhận hàng" : ""} và kênh liên hệ. Đơn chỉ được tạo khi bạn chấp thuận.</p>
      ${quoteBox(o)}
      ${o.co_gia_cong ? `<p class="small muted">Xưởng hẹn hoàn thành: ${esc(o.work_deadline.replace("T", " "))}</p><label class="f narrow">Lịch hẹn nhận hàng<input name="appointment" type="datetime-local"></label>` : ""}
      <label class="f narrow mt">Kênh nhận thông báo<select name="channel">${opts(["Zalo", "SMS", "Điện thoại", "Facebook"], o.contact_channel)}</select></label>
      <div class="btn-row"><button class="btn" data-act="do" data-node="T08" data-accept="1" ${S.busy ? "disabled" : ""}>Chốt đơn</button><button class="btn ghost" data-act="do" data-node="T08" data-accept="0">Chưa chốt</button></div>`;
  }
  return "";
}

function collect(root) {
  const d = {};
  root.querySelectorAll("[name]").forEach(el => {
    if (el.type === "checkbox") d[el.name] = el.checked;
    else if (el.type === "radio") { if (el.checked) d[el.name] = el.value; }
    else d[el.name] = el.value;
  });
  return d;
}

/* ---------- Danh sách đơn ---------- */
function viewOrders() {
  const label = o => o.status === "open" ? (NODES[o.node] ? `${o.node} · ${NODES[o.node][0]}` : o.node) : (NEXT_LABEL[o.node] || o.status);
  return `<div class="pagehead"><h2>${tabsFor(S.me.role)[1][1]}</h2></div>
    ${S.orders.length ? `<div class="panel tablewrap"><table><thead><tr><th>Mã</th><th>Nhu cầu</th><th>Sản phẩm</th><th>Gia công</th><th>Tổng</th><th>Trạng thái</th></tr></thead><tbody>
    ${S.orders.map(o => { const p = S.products.find(x => x.id === o.product_id);
      return `<tr class="click" data-act="goto" data-id="${o.id}"><td>${esc(o.code || `#${o.id}`)}</td><td>${esc(o.need_type)}, ${fmt(o.need_budget)}</td><td>${p ? esc(p.name) : "—"}</td><td>${o.product_id ? (o.co_gia_cong ? "Có" : "Không") : "—"}</td><td class="money">${o.total != null ? fmt(o.total) : "—"}</td><td>${esc(label(o))}</td></tr>`; }).join("")}
    </tbody></table></div>` : `<div class="empty">Chưa có đơn nào.</div>`}`;
}

function viewCatalog() {
  return `<div class="pagehead"><div><h2>Trang sức</h2><p class="muted small">Hiển thị ${S.products.length} sản phẩm. “Giữ” là số lượng đã giữ cho đơn ở T09.</p></div></div>
  <div class="products">${S.products.map(p => `<div class="prod ${avail(p) <= 0 ? "out" : ""}"><div class="pic">${gem(p.stone)}</div><h4>${esc(p.name)}</h4><div class="price money">${fmt(p.price)}</div>
    <div class="meta">${esc(p.type)} · ${esc(p.stone)} · ${esc(p.material)}</div>
    <div class="meta">Tồn ${p.stock} · giữ ${p.reserved} ${avail(p) <= 0 ? '<span class="badge b-warn">Hết hàng</span>' : ""}</div></div>`).join("")}</div>`;
}

function viewReport() {
  const r = S.report; if (!r) return `<p class="muted">Đang tải…</p>`;
  return `<div class="pagehead"><div><h2>Báo cáo tư vấn</h2><p class="muted small">Tính trực tiếp từ dữ liệu đơn trong cơ sở dữ liệu.</p></div></div>
  <div class="kpis">
    <div class="kpi"><b>${r.total}</b><span>Yêu cầu tư vấn</span></div>
    <div class="kpi"><b>${r.won}</b><span>Đã chốt đơn</span></div>
    <div class="kpi"><b>${r.conversion}%</b><span>Tỷ lệ chốt (trên phiên đã kết thúc)</span></div>
    <div class="kpi"><b class="money">${fmt(r.wonValue)}</b><span>Giá trị đơn đã chốt</span></div>
    <div class="kpi"><b>${r.aiPickRate}%</b><span>Mẫu được chọn từ gợi ý AI</span></div>
    <div class="kpi"><b>${r.avgDiscount}%</b><span>Mức giảm bình quân (đơn có giảm)</span></div>
  </div>`;
}

/* ---------- Sự kiện ---------- */
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act;
  try {
    if (a === "login") {
      S.draft = { login: $("lu").value };
      await api("POST", "/api/login", { username: $("lu").value, password: $("lp").value });
      S.flash = null; S.draft = null; await boot(); return;
    }
    if (a === "mode") { S.authMode = b.dataset.v; S.flash = null; S.draft = null; render(); return; }
    if (a === "register") {
      S.draft = { fullName: $("rn").value, phone: $("rp").value, username: $("ru").value };
      await api("POST", "/api/register", { fullName: $("rn").value, phone: $("rp").value, username: $("ru").value, password: $("rw").value, password2: $("rw2").value });
      S.authMode = "login"; S.flash = null; S.draft = null; await boot(); return;
    }
    if (a === "logout") { await api("POST", "/api/logout"); S.me = null; S.sel = null; S.detail = null; render(); return; }
    if (a === "new") { S.sel = "new"; S.detail = null; S.flash = null; render(); return; }
    if (a === "open" || a === "goto") {
      S.sel = Number(b.dataset.id); S.flash = null; S.detail = await api("GET", `/api/orders/${S.sel}`);
      if (a === "goto") location.hash = "viec";
      render(); return;
    }
    if (a === "create") {
      const data = collect(b.closest(".panel"));
      S.busy = true; render();
      try { const d = await api("POST", "/api/orders", data); S.sel = d.order.id; S.detail = d; S.flash = { ok: true, text: "Đã gửi yêu cầu. AI đã gợi ý mẫu, nhân viên sẽ kiểm tra và tư vấn (T03)." }; }
      finally { S.busy = false; }
      await refresh(); render(); return;
    }
    if (a === "do") {
      const node = b.dataset.node, data = collect(b.closest(".panel"));
      if (node === "T03" && data.manualId) data.productId = data.manualId;
      if (node === "T04") data.yeuCauGiamGia = data.yeuCauGiamGia === "1";
      if (node === "T08") data.accept = b.dataset.accept === "1";
      S.busy = true; render();
      try {
        const d = await api("POST", `/api/orders/${S.sel}/tasks/${node}`, data);
        S.detail = d;
        const o = d.order;
        S.flash = { ok: true, text: `Đã hoàn thành ${node}. ${o.status === "open" ? `Đơn chuyển sang ${o.node} · ${NODES[o.node][0]} (${LANES[NODES[o.node][1]]}).` : NEXT_LABEL[o.node] || ""}` };
      } finally { S.busy = false; }
      await refresh(); render(); return;
    }
    if (a === "qr") {
      S.busy = true; render();
      try { S.qr = { orderId: S.sel, data: await api("GET", `/api/orders/${S.sel}/payment-qr`) }; } finally { S.busy = false; }
      render(); return;
    }
    if (a === "rerun") { S.detail = await api("POST", `/api/orders/${S.sel}/ai-suggest`); S.flash = { ok: true, text: "Đã chạy lại gợi ý AI." }; render(); return; }
  } catch (err) {
    S.flash = { ok: false, text: err.message }; S.busy = false;
    if (!S.me) render(); else { await refresh().catch(() => {}); render(); }
  }
});
document.addEventListener("keydown", e => {
  if (e.key !== "Enter" || S.me || e.target.tagName !== "INPUT") return;
  const btn = document.querySelector('[data-act="login"], [data-act="register"]');
  if (btn) btn.click();
});
window.addEventListener("hashchange", async () => { S.flash = null; await refresh().catch(() => {}); render(); });

async function boot() {
  const r = await api("GET", "/api/me");
  S.me = r.user; S.settings = r.settings;
  if (S.me) await refresh();
  render();
}
boot().catch(err => { $("app").innerHTML = `<div class="msg err">Không kết nối được máy chủ: ${esc(err.message)}. Hãy chạy “npm start” trong terminal.</div>`; });
