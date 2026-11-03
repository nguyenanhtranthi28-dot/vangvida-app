# Vang Vida – Ứng dụng tư vấn và báo giá (MIS3047)

Ứng dụng web hỗ trợ giai đoạn **tư vấn → báo giá → chốt đơn (T01–T09)** của quy trình bán hàng TO-BE tại Vang Vida Jewelry.
Viết bằng Node.js thuần, **không cần cài thư viện** (không có `npm install`).

## 1. Chạy ứng dụng trong VS Code

1. Cài **Node.js bản 22.13 trở lên** (khuyên dùng bản LTS mới nhất) tại https://nodejs.org. Kiểm tra: mở terminal, gõ `node -v`.
2. Giải nén thư mục `vangvida-app`, mở VS Code → **File → Open Folder** → chọn thư mục này.
3. Mở terminal trong VS Code: **Terminal → New Terminal**.
4. Gõ lệnh:
   ```
   npm start
   ```
5. Mở trình duyệt vào **http://localhost:3000**. Muốn dừng máy chủ: bấm `Ctrl + C` trong terminal.

**Khách hàng mới:** ở trang đăng nhập bấm “Đăng ký”, nhập họ tên, số điện thoại, tên đăng nhập, mật khẩu (ít nhất 8 ký tự). Đăng ký xong được đăng nhập luôn. Trang đăng ký chỉ tạo được tài khoản khách hàng; tài khoản nhân viên và thợ do cửa hàng cấp sẵn.

Tài khoản demo (mật khẩu chung `vangvida123`):

| Tài khoản | Vai trò | Lane BPMN |
|---|---|---|
| khach1, khach2 | Khách hàng | Khách hàng |
| nhanvien1 | Nhân viên cửa hàng | Nhân viên cửa hàng |
| tho1 | Thợ gia công | Bộ phận gia công |

Các lệnh khác:
- `npm test` — chạy toàn bộ kiểm thử tự động.
- `npm run reset-db` — xóa dữ liệu, tạo lại dữ liệu mẫu.

### Tích hợp bên ngoài
Ứng dụng có **2 tích hợp bên ngoài**:
1. **VietQR (chạy ngay, không cần khóa):** sau khi khách chốt đơn (T09), mở đơn và bấm “Tạo mã QR chuyển khoản”. Máy chủ gọi dịch vụ `img.vietqr.io` để tạo mã QR cọc (đơn gia công) hoặc QR thanh toán (hàng có sẵn), nội dung chuyển khoản chứa mã đơn để đối soát. Mặc định dùng **tài khoản demo không có thật**; muốn dùng tài khoản thật thì khai báo `VIETQR_ACCOUNT` trong `.env`.
2. **Anthropic Claude API (cần khóa):** dùng cho AI gợi ý mẫu ở T02, xem mục dưới.

### Bật AI thật (tùy chọn)
Sao chép `.env.example` thành `.env`, điền `ANTHROPIC_API_KEY=...`, rồi chạy lại `npm start`.
Không có khóa thì T02 dùng **luật dự phòng**, ứng dụng vẫn chạy đầy đủ. **Không commit file `.env` lên Git** (đã có trong `.gitignore`).

## 2. Cấu trúc mã nguồn

```
server.js          Máy chủ web + định tuyến API
src/config.js      Cấu hình, tham số nghiệp vụ (hạn mức giảm 5%, cọc 30%, ngưỡng AI 0,6)
src/db.js          Lược đồ cơ sở dữ liệu SQLite + dữ liệu mẫu
src/auth.js        Đăng nhập: băm mật khẩu scrypt, phiên, chống dò mật khẩu
src/rules.js       Luật nghiệp vụ dạng hàm thuần (báo giá, giảm giá, giờ xưởng, các cổng XOR)
src/ai.js          T02: gọi Claude API + luật dự phòng + lọc đầu ra AI
src/payment.js     Tích hợp VietQR: tạo mã QR chuyển khoản cho đơn đã chốt
src/process.js     Động cơ quy trình: chạy đơn qua T01–T09 đúng mô hình TO-BE
public/            Giao diện: Giaodientrangchu.html (trang chủ), app.js, style.css
tests/             Kiểm thử tự động (30 test)
data/vangvida.db   File cơ sở dữ liệu (tự tạo khi chạy lần đầu)
```

## 3. Ánh xạ BPMN → tính năng

| Phần tử BPMN | Loại | Trong ứng dụng |
|---|---|---|
| T01 Cung cấp nhu cầu | User task (KH) | Màn hình “Tạo yêu cầu tư vấn” → `POST /api/orders` |
| T02 AI gợi ý mẫu | Service task | `src/ai.js` → `recommend()`; chạy lại: `POST /api/orders/:id/ai-suggest` |
| T03 Kiểm tra gợi ý, đo ni | User task (NV) | Màn hình chọn mẫu → `POST /api/orders/:id/tasks/T03` |
| T04 Thử mẫu, đề nghị giảm | User task (KH) | `POST /api/orders/:id/tasks/T04` |
| T05 Xét giảm ≤ 5% | User task (NV) | `POST /api/orders/:id/tasks/T05`, luật `validateDiscount()` |
| T06 Xác nhận phí, hạn | User task (TH) | `POST /api/orders/:id/tasks/T06`, luật `validateDeadline()` |
| T07 Tính báo giá | Business rule task | `calcQuote()` chạy tự động |
| T08 Chốt đơn | User task (KH) | `POST /api/orders/:id/tasks/T08` |
| T09 Lưu đơn, giữ hàng | Service task | `runT09()`: cấp mã đơn, tăng `products.reserved` |
| Cổng “Khách yêu cầu giảm giá?” | XOR | `gateways.GDiscount` (yeuCauGiamGia) |
| Cổng “Cần gia công thêm?” | XOR | `gateways.GQuoteCustom` (coGiaCong) |
| Cổng “Khách chốt đơn?” | XOR | `gateways.GAccept` (khachChapThuan) |
| Lane Khách / Nhân viên / Gia công | Lane | Vai trò đăng nhập `khach` / `nhanvien` / `tho`; máy chủ chặn sai lane (HTTP 403) |
| Lane Hệ thống & AI | Lane | Các service task tự chạy trong `runAuto()` |
| Đối tượng dữ liệu “Báo giá”, “Đơn POS” | Data object | Các cột báo giá và bảng `orders` |

Ngoài phạm vi: T10–T22 (cọc, gia công, thanh toán, bàn giao). Sau T09 đơn chuyển trạng thái `CHO_COC` hoặc `CHO_GIAO`.

## 4. Đáp ứng 6 yêu cầu kỹ thuật (mục 4.1)

| Yêu cầu | Cách đáp ứng |
|---|---|
| Xác thực ≥ 3 vai trò | Đăng nhập thật, khách tự đăng ký (`POST /api/register`, luôn mang vai trò khách), mật khẩu băm scrypt, phiên lưu trong bảng `sessions`, cookie HttpOnly |
| ≥ 3 luồng phê duyệt XOR | 3 cổng: giảm giá, gia công, chốt đơn |
| Lưu trữ bền vững | SQLite, file `data/vangvida.db` |
| ≥ 1 tích hợp bên ngoài | VietQR tạo mã QR chuyển khoản sau T09 (không cần khóa) + Anthropic Claude API cho T02 (khóa cất trong `.env`) |
| Bộ kiểm thử tự động | `npm test` — 30 test: luật, quy trình, phân quyền, API, đăng ký, lưu trữ, 2 tích hợp |
| ≥ 15 commit Git | Nhóm tự thực hiện — xem gợi ý mục 6 |

## 5. Bảo mật đã áp dụng
- Mật khẩu băm scrypt có salt, so sánh an toàn thời gian; khóa đăng nhập 10 phút sau 5 lần sai.
- Kiểm tra quyền và luật ở **máy chủ**, không tin giao diện.
- Câu lệnh SQL dùng tham số (chống SQL injection); giao diện escape dữ liệu (chống XSS); header CSP.
- POST bắt buộc header `X-Requested-With` + cookie SameSite=Strict (chống CSRF).
- Giới hạn kích thước dữ liệu gửi lên; chặn đọc file ngoài thư mục `public`.
- Khóa API chỉ ở `.env` phía máy chủ; AI không được đặt giá, đầu ra AI được lọc.
- Đăng ký bị giới hạn 10 lần / 10 phút mỗi địa chỉ IP; trường “role” gửi lên bị bỏ qua nên không tự nâng quyền được.
- Hạn chế còn lại: chưa có HTTPS (chạy cục bộ), mật khẩu demo dùng chung, chưa có trang đổi mật khẩu.

## 6. Làm việc với Git (≥ 15 commit)
Thầy chấm “quá trình làm việc”, nên commit cần phản ánh công việc thật theo thời gian: mỗi khi nhóm sửa, thêm hoặc kiểm thử một phần thì commit một lần, mỗi thành viên commit phần mình làm. Không nên dồn 15 commit vào vài phút.

Cách làm bằng giao diện VS Code (không cần gõ lệnh):
1. Cài Git: https://git-scm.com → Download for Windows, cài với lựa chọn mặc định, rồi tắt và mở lại VS Code.
2. Lần đầu, mở terminal và khai báo tên (mỗi người một lần trên máy mình):
   `git config --global user.name "Ho Ten"` và `git config --global user.email "email@example.com"`
3. Bấm biểu tượng **Source Control** (hình nhánh cây) ở thanh trái → **Initialize Repository**.
4. Viết nội dung commit vào ô Message, ví dụ “Khởi tạo dự án: mã nguồn ứng dụng T01–T09”, bấm **Commit** (chọn Yes nếu hỏi stage all).
5. Mỗi lần sửa xong một việc: vào Source Control, xem file thay đổi, ghi nội dung rõ ràng, bấm Commit.
6. Muốn cả nhóm cùng làm và nộp đường link: tạo kho trên GitHub, bấm **Publish Branch** trong Source Control.

Gợi ý các việc tự nhiên tạo ra commit trong thời gian còn lại: sửa giao diện theo ý nhóm; đổi dữ liệu sản phẩm cho sát thực tế; khai báo tài khoản VietQR; chỉnh câu chữ các màn hình; thêm test cho trường hợp nhóm phát hiện; sửa lỗi khi chạy thử; cập nhật README và tài liệu; chụp kết quả kiểm thử. Mỗi việc là một commit.
