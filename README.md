# Vang Vida – Ứng dụng tư vấn và báo giá
## 1. Dùng thử web

Bản chạy trực tuyến: **https://vangvida-app.onrender.com**
Lần mở đầu có thể chờ khoảng 1 phút vì gói miễn phí tạm ngủ khi không có người dùng. Dữ liệu tạo trên bản này sẽ mất khi máy chủ khởi động lại; muốn kiểm tra lưu trữ bền vững, hãy chạy trên máy (mục 2).

Tài khoản demo, mật khẩu chung `vangvida123`:

| Tài khoản | Vai trò | Lane BPMN |
|---|---|---|
| khach1, khach2 | Khách hàng | Khách hàng |
| nhanvien1 | Nhân viên cửa hàng | Nhân viên cửa hàng |
| tho1 | Thợ gia công | Bộ phận gia công |

Khách hàng mới có thể tự đăng ký ở trang đăng nhập. Trang đăng ký chỉ tạo tài khoản khách hàng; tài khoản nhân viên và thợ do cửa hàng cấp.

### Kịch bản chính của nhóm (nhánh có giảm giá và gia công)
Mỗi vai trò mở ở một trình duyệt hoặc cửa sổ ẩn danh riêng.

| Bước | Tài khoản | Thao tác | Kết quả đúng |
|---|---|---|---|
| T01 | khach1 | Tạo yêu cầu: Nhẫn, ngân sách 20.000.000, đá Emerald, giới tính Nữ | Đơn được tạo, chuyển sang T03 |
| T02 | (tự động) | Hệ thống gợi ý mẫu | Danh sách gợi ý kèm độ tin cậy, có VV11 Nhẫn Nữ EMERALD |
| T03 | nhanvien1 | Chọn VV11, nhập ni đo, **tích "cần gia công"**, ghi yêu cầu "Khắc tên" | Chuyển sang T04 |
| T04 | khach1 | Đề nghị giảm 5% | Cổng giảm giá → T05 |
| T05 | nhanvien1 | Duyệt giảm 3% | Cổng gia công → T06 |
| T06 | tho1 | Nhận làm, phí 800.000, hạn trong giờ 08:00–18:00 của ngày sau | Chuyển sang T07 |
| T07 | (tự động) | Hệ thống tính báo giá | 18.500.000 − 555.000 + 800.000 = **18.745.000 đ**, cọc **5.624.000 đ** |
| T08 | khach1 | Chọn lịch hẹn, bấm chốt đơn | Cổng chốt đơn → T09 |
| T09 | (tự động) | Hệ thống lưu đơn, giữ hàng | Đơn có mã dạng VV-...-0001, trạng thái thành công |
| Sau T09 | khach1 | Mở đơn, bấm "Tạo mã QR chuyển khoản" | Mã VietQR số tiền 5.624.000 đ, nội dung có mã đơn |

### Kịch bản phụ
- **Chặn giảm vượt hạn mức:** ở T05, nhân viên nhập giảm 7% → báo lỗi vượt hạn mức 5%, không lưu.
- **Khách không chốt:** ở T08, khách chọn không chốt → đơn kết thúc, không giữ hàng.

## 2. Chạy trên máy

1. Cài **Node.js bản 22.13 trở lên** tại https://nodejs.org. Kiểm tra bằng lệnh `node -v`.
2. Tải mã nguồn (nút **Code → Download ZIP** trên trang này, hoặc clone kho), mở thư mục `vangvida-app` bằng VS Code.
3. Mở terminal (**Terminal → New Terminal**) và gõ:
   npm start
   
4. Mở trình duyệt vào **http://localhost:3000**. Dừng máy chủ: bấm `Ctrl + C` trong terminal.

Ứng dụng không cần cài thêm thư viện. Lần chạy đầu tự tạo tệp dữ liệu `data/vangvida.db` cùng tài khoản và sản phẩm mẫu.

**Nếu PowerShell báo lỗi "running scripts is disabled":** gõ `npm.cmd start` thay cho `npm start`, hoặc đổi terminal sang Command Prompt.

**Muốn làm lại dữ liệu từ đầu:** gõ `npm run reset-db`.

**Bật AI thật cho bước T02 (tùy chọn):** sao chép `.env.example` thành `.env`, điền `ANTHROPIC_API_KEY=...`, chạy lại `npm start`. Không có khóa thì T02 gợi ý theo luật dự phòng, ứng dụng vẫn chạy đầy đủ. Không bao giờ commit tệp `.env` lên Git.

## 3. Kiểm thử tự động

```
npm test
```

Chạy 32 test: luật nghiệp vụ, động cơ quy trình, phân quyền theo lane, API, đăng ký, lưu trữ và hai tích hợp bên ngoài. Kết quả mong đợi: 32/32 đạt.
**Kiểm tra bộ test có bắt được lỗi không:** mở `src/config.js`, đổi `MAX_DISCOUNT: 5` thành `MAX_DISCOUNT: 10`, chạy `npm test`. Hai test về hạn mức giảm sẽ báo lỗi (`fail 2`). Đổi lại `5` thì tất cả đạt. Không commit lần đổi thử này.
## 4. Cấu trúc mã nguồn

```
server.js          Máy chủ web và các API
src/config.js      Tham số nghiệp vụ: giảm tối đa 5%, cọc 30%, ngưỡng AI 0,6, giờ làm 08:00–18:00
src/rules.js       Luật nghiệp vụ: tính báo giá, kiểm tra giảm giá, hạn gia công, ba cổng XOR
src/process.js     Động cơ quy trình: đưa đơn qua T01–T09 đúng mô hình TO-BE
src/auth.js        Đăng nhập, đăng ký, mã hóa mật khẩu, chống dò mật khẩu
src/db.js          Cơ sở dữ liệu SQLite: 6 bảng và dữ liệu mẫu
src/ai.js          T02: gọi Claude API, luật dự phòng, lọc kết quả AI
src/payment.js     Tạo mã VietQR chuyển khoản cho đơn đã chốt
public/            Giao diện: Giaodientrangchu.html, app.js, style.css
tests/             Kiểm thử tự động
docs/              Mô hình BPMN AS-IS, TO-BE và ảnh mô hình
```

Mỗi tệp trong `src/` có chú thích tiếng Việt giải thích từng đoạn mã.

## 5. Đáp ứng 6 yêu cầu kỹ thuật

| Yêu cầu | Cách đáp ứng |
|---|---|
| Xác thực ≥ 3 vai trò | Khách, nhân viên, thợ; mỗi vai trò ứng với một lane BPMN, máy chủ chặn thao tác sai lane (lỗi 403) |
| ≥ 3 cổng XOR | “Khách yêu cầu giảm giá?”, “Cần gia công thêm?”, “Khách chốt đơn?” (`src/rules.js`) |
| Lưu trữ bền vững | SQLite, tệp `data/vangvida.db`; tắt máy chủ mở lại dữ liệu vẫn còn |
| ≥ 1 tích hợp bên ngoài | VietQR tạo mã chuyển khoản (không cần khóa); Claude API gợi ý mẫu ở T02 (cần khóa) |
| Bộ kiểm thử tự động | 30 test, chạy bằng `npm test` |
| ≥ 15 commit Git | Xem lịch sử commit của kho này |

Ánh xạ đầy đủ từ mô hình BPMN sang màn hình, API và phân quyền có trong báo cáo, mục 3.3.3.

## 6. Bảo mật

- Mật khẩu băm bằng scrypt có salt; khóa đăng nhập 10 phút sau 5 lần sai.
- Mọi kiểm tra quyền và luật nằm ở máy chủ, không tin giao diện.
- Chống SQL injection (câu lệnh có tham số), XSS (escape dữ liệu, header CSP) và CSRF (header riêng, cookie SameSite=Strict).
- Khóa API chỉ nằm ở `.env` phía máy chủ hoặc mục Environment trên Render, không có trong kho Git.
- AI chỉ xếp hạng mẫu; giá, tồn kho và mức giảm luôn lấy từ dữ liệu hoặc do người xác nhận.

Hạn chế còn lại: mật khẩu demo dùng chung, chưa có trang đổi mật khẩu; bản chạy trên máy dùng HTTP (bản Render có HTTPS).
