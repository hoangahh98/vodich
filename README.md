# Vô Địch Tool

Ứng dụng quản lý giải đấu, thành viên, đội bóng, phân quyền, log hệ thống và tỉ số trực tiếp.

## Công nghệ

- Node.js runtime trên Render
- NestJS + TypeScript
- Prisma + Supabase Postgres
- EJS server-rendered UI
- Socket.IO WebSocket cho cập nhật điểm tức thời

## Chạy local

```bash
npm install
npx prisma generate
npm run start:dev
```

Biến môi trường:

```env
DATABASE_URL=postgresql://...
APP_ADMIN_USERNAME=admin
APP_ADMIN_PASSWORD=123456789
SESSION_SECRET=change-me
REDIS_URL=redis://...
REQUIRE_REDIS=true
```

`REQUIRE_REDIS=true` dÃ¹ng cho production nhiá»u Render service: náº¿u Redis thiáº¿u hoáº·c káº¿t ná»‘i lá»—i thÃ¬ app dá»«ng khá»Ÿi Ä‘á»™ng thay vÃ¬ fallback sang memory.

## Triển khai Render

Chọn **Web Service -> Runtime Node**.

Lệnh build:

```bash
npm install && npx prisma generate && npm run build
```

Lệnh chạy:

```bash
npm run start:prod
```

## Tính năng

- Quản trị đăng nhập, quản trị gốc phân quyền tính năng cho quản trị khác.
- Khách xem đăng nhập bằng email thành viên hoặc email đăng ký ngoài, mật khẩu mặc định `123456789`.
- Quản lý thành viên, chống trùng email.
- Tạo giải, chọn vòng tròn hoặc vòng bảng + loại trực tiếp.
- Nếu chọn vòng bảng mới hiện cấu hình số đội vào vòng trong.
- BXH vòng tròn hiển thị BXH thường; vòng bảng hiển thị `BXH - Bảng A/B/...`.
- Lịch thi đấu cập nhật tức thời qua WebSocket, có trạng thái đang xử lý khi bấm thao tác.
- Đăng ký ngoài cho giải và lưu riêng trong bảng đăng ký giải.
- Bỏ giải/khôi phục.
- Quản lý đội bóng, thành viên đội, cấu hình quỹ tháng.
- Theo dõi log chỉ dành cho quản trị gốc, hiển thị giờ Việt Nam.

Các tính năng giải trí cũ đã bỏ.
