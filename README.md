# Vô Địch Tool

Ứng dụng quản lý giải đấu, thành viên, đội bóng, phân quyền, log hệ thống và livescore realtime.

## Stack

- Node.js runtime trên Render
- NestJS + TypeScript
- Prisma + Supabase Postgres
- EJS server-rendered UI
- Socket.IO WebSocket cho cập nhật điểm realtime

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
```

## Deploy Render

Chọn **Web Service -> Runtime Node**.

Build command:

```bash
npm install && npx prisma generate && npm run build
```

Start command:

```bash
npm run start:prod
```

## Tính năng

- Admin đăng nhập, root admin phân quyền module cho admin khác.
- Client đăng nhập bằng email thành viên hoặc email đăng ký ngoài, mật khẩu mặc định `123456789`.
- Quản lý thành viên, chống trùng email.
- Tạo giải, chọn vòng tròn hoặc vòng bảng + loại trực tiếp.
- Nếu chọn vòng bảng mới hiện cấu hình số đội vào vòng trong.
- BXH vòng tròn hiển thị BXH thường; vòng bảng hiển thị `BXH - Bảng A/B/...`.
- Lịch thi đấu realtime qua WebSocket, có loading state khi bấm thao tác.
- Đăng ký ngoài cho giải và lưu riêng trong bảng đăng ký giải.
- Bỏ giải/khôi phục.
- Quản lý đội bóng, thành viên đội, cấu hình quỹ tháng.
- Monitor log chỉ dành cho root admin, hiển thị giờ Việt Nam.

Các tính năng giải trí cũ đã bỏ.
