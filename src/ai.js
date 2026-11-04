// T02 — AI Agent gợi ý mẫu. TÍCH HỢP BÊN NGOÀI: Anthropic Claude API.
// Nguyên tắc: AI chỉ xếp hạng mã sản phẩm; giá và tồn kho luôn lấy từ cơ sở dữ liệu (dữ liệu xác thực).
// Không có khóa API hoặc API lỗi → dùng luật dự phòng, quy trình không bị dừng.
const cfg = require("./config");
const { available } = require("./rules");

// Luật dự phòng: chấm điểm minh bạch
// Cộng điểm: đúng loại +0,4; trong ngân sách +0,3 (vượt dưới 10%: +0,12); đúng đá +0,2; hợp giới tính +0,1.
// Sai loại hoặc vượt ngân sách quá 10% thì loại; trả về tối đa 4 mẫu điểm cao nhất.
function ruleRecommend(need, catalog) {
  const out = [];
  for (const p of catalog) {
    if (available(p) <= 0) continue;
    let s = 0; const why = [];
    if (need.type) { if (p.type === need.type) { s += 0.4; why.push("đúng loại"); } else continue; }
    const b = Number(need.budget) || 0;
    if (b) {
      if (p.price <= b) { s += 0.3; why.push("trong ngân sách"); }
      else if (p.price <= b * 1.1) { s += 0.12; why.push("vượt ngân sách dưới 10%"); }
      else continue;
    }
    if (need.stone && p.stone === need.stone) { s += 0.2; why.push("đúng loại đá"); }
    if (need.gender) s += (p.gender === need.gender || p.gender === "Unisex") ? 0.1 : -0.1;
    if (need.size && p.size && String(need.size) !== String(p.size)) { s -= 0.05; why.push(`ni mẫu ${p.size}, có thể điều chỉnh`); }
    out.push({ id: p.id, confidence: Math.max(0, Math.min(0.95, +s.toFixed(2))), reason: why.join(", ") || "phù hợp một phần" });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 4);
}

// Kiểm soát đầu ra AI: bỏ mã không tồn tại / hết hàng / trùng, ép độ tin cậy về [0, 1]
function sanitizeAI(items, catalog) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.map(it => {
    const p = catalog.find(c => c.id === String(it && it.id));
    if (!p || available(p) <= 0 || seen.has(p.id)) return null;
    seen.add(p.id);
    let c = Number(it.confidence); if (isNaN(c)) c = 0;
    return { id: p.id, confidence: +Math.max(0, Math.min(1, c)).toFixed(2), reason: String(it.reason || "").slice(0, 200) };
  }).filter(Boolean).slice(0, 4);
}

// Soạn câu lệnh gửi Claude: nhu cầu của khách + danh mục còn hàng; yêu cầu chỉ trả về JSON.
function buildPrompt(need, catalog) {
  const cat = catalog.filter(p => available(p) > 0)
    .map(p => ({ id: p.id, name: p.name, type: p.type, gender: p.gender, stone: p.stone, material: p.material, price: p.price, size: p.size }));
  return `Bạn là AI Agent tư vấn của cửa hàng trang sức Vang Vida (bước T02).
Chọn tối đa 4 sản phẩm trong DANH MỤC phù hợp nhất với NHU CẦU.
Quy tắc: chỉ dùng id có trong danh mục; không tự đặt giá; ưu tiên đúng loại và trong ngân sách; ni khác thì ghi "cần điều chỉnh ni".
confidence từ 0 đến 1 phản ánh mức khớp thật; không có mẫu khớp tốt thì cho confidence thấp.
Chỉ trả về JSON, không thêm chữ nào khác: {"items":[{"id":"VV01","reason":"lý do ngắn, tối đa 25 từ","confidence":0.8}]}

NHU CẦU: ${JSON.stringify(need)}
DANH MỤC: ${JSON.stringify(cat)}`;
}

// fetchFn được truyền vào để kiểm thử có thể giả lập API mà không gọi mạng thật
// Gọi Claude API; quá 20 giây, lỗi mạng hoặc kết quả không hợp lệ thì chuyển sang luật dự phòng.
async function recommend(need, catalog, { apiKey = cfg.ANTHROPIC_API_KEY, fetchFn = globalThis.fetch } = {}) {
  if (!apiKey) return { source: "Luật dự phòng (chưa cấu hình khóa API)", items: ruleRecommend(need, catalog) };
  try {
    const res = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.AI_MODEL, max_tokens: 800, messages: [{ role: "user", content: buildPrompt(need, catalog) }] }),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    // Không tin hoàn toàn vào AI: lọc kết quả qua sanitizeAI trước khi dùng.
    const items = sanitizeAI(json.items, catalog);
    if (!items.length) return { source: "Luật dự phòng (AI không trả gợi ý hợp lệ)", items: ruleRecommend(need, catalog) };
    return { source: "Claude API", items };
  } catch (e) {
    return { source: `Luật dự phòng (lỗi gọi AI: ${e.message})`, items: ruleRecommend(need, catalog) };
  }
}

module.exports = { recommend, ruleRecommend, sanitizeAI, buildPrompt };
