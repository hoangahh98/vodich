# Mô hình bảo mật & phân quyền

Tài liệu này mô tả app CHẶN như thế nào, và quan trọng hơn: chặn ở ĐÂU. Nguyên tắc xuyên
suốt là **mọi thứ trên giao diện chỉ là trang trí** — ẩn một cái nút không chặn được ai. Phần
chặn thật luôn nằm ở server.

## 1. Bốn lớp chặn

Một request đi qua bốn lớp, theo đúng thứ tự này:

| # | Lớp | Ở đâu | Chặn cái gì |
|---|-----|-------|-------------|
| 1 | `LocalsMiddleware` | `src/common/locals.middleware.ts` | Nạp `currentUser` + bộ feature vào `res.locals` |
| 2 | `CsrfMiddleware` | `src/common/csrf.ts` | Request ghi đến từ site khác |
| 3 | `FeatureGuard` (toàn cục) | `src/common/feature.guard.ts` | Chưa đăng nhập, thiếu feature, sai vai |
| 4 | Bộ lọc chủ sở hữu trong service | các `*.service.ts` | Tài nguyên của admin khác |

Lớp 3 và lớp 4 giải quyết hai việc KHÁC NHAU, thiếu một cái là hở:

- Lớp 3 trả lời *"người này có được vào module Đội Bóng không?"*
- Lớp 4 trả lời *"người này có được xem **đội số 5** không?"*

Một admin có feature `TEAMS` vẫn không được đụng vào đội của admin khác — đó là việc của lớp 4.

## 2. FeatureGuard: mặc định CHẶN

`FeatureGuard` đăng ký toàn cục bằng `APP_GUARD` trong `app.module.ts`. Nghĩa là:

> Mọi route đều đòi đăng nhập, **trừ khi** được đánh dấu `@Public()`.

Thêm một route mới mà quên nghĩ tới quyền thì nó bị khoá, chứ không hở ra. Đây là điểm khác
căn bản với cách cũ (gọi tay `requireFeature()` trong từng handler): quên gọi là hở endpoint,
và không có gì nhắc.

Các decorator, đặt trên class hoặc từng method (method thắng class):

| Decorator | Ý nghĩa |
|-----------|---------|
| `@Public()` | Mở cho khách vãng lai. **Chỉ 3 controller được phép**, xem mục 5. |
| `@FeatureAccess('TEAMS')` | Phải được cấp feature đó |
| `@AdminOnly()` | Phải là ADMIN (chặn vai CLIENT) |
| `@RootAdminOnly()` | Chỉ admin gốc (`APP_ADMIN_USERNAME`) |

Guard cũng phân biệt trình duyệt với lời gọi `fetch()`: request mong JSON sẽ nhận `401`/`403`
dạng JSON thay vì `302` sang `/login` (redirect câm khiến phía client tưởng là thành công).

## 3. Bộ lọc chủ sở hữu

Mọi module có chủ dùng chung đúng một hàm — `ownedOrSharedWhere()` trong
`src/common/admin-scope.ts`:

```ts
{ OR: [{ ownerAdminId: adminId }, { permissions: { some: { adminId } } }] }
```

Hai luật bắt buộc:

1. **Lọc trong CHÍNH câu truy vấn**, không tra id trần rồi kiểm sau. Tức là
   `findFirst({ where: { id, ...scope } })`, không phải `findUnique({ where: { id } })` rồi `if`.
2. **Xoá/sửa dùng `deleteMany`/`updateMany` kèm id chủ sở hữu**, để gửi lên id của người khác
   thì tác động 0 dòng thay vì thành công.

Module đã áp dụng: giải đấu, đội bóng.

> Du lịch, hồ sơ y tế và sổ chi tiêu cũng dùng đúng khuôn này cho tới khi ba module bị gỡ
> hẳn ngày 3/8/2026 (migration `20260803180000_drop_medical_household_travel`). Khuôn vẫn là
> khuôn bắt buộc cho mọi module có chủ sở hữu thêm sau này.

### Ngoại lệ có chủ ý

- Hiện **không còn** ngoại lệ nào theo module: admin gốc thấy hết. Ngoại lệ duy nhất từng có là
  hồ sơ y tế (admin gốc không mặc nhiên xem được bệnh án nhà người khác), đã đi cùng module đó.
- **Vai CLIENT**: chỉ đọc, và chỉ thấy giải/đội **đã được cấp quyền xem** (mục 3b). Mật khẩu
  CLIENT là `123456789` dùng chung — **cố ý**, vì mọi thao tác ghi đều đòi vai ADMIN.

## 3b. Quyền XEM của thành viên (từ 9/2026)

Có tên trong giải **không còn** tự động nghĩa là được xem giải. Quyền xem là hai bảng riêng,
`player_tournament_access` và `player_team_access`, cấp ở màn hình **Thành viên → Phân quyền**
(`/players/:id/access`, `PlayerAccessService`). Bộ lọc cho vai CLIENT nằm ở một chỗ:
`src/common/player-scope.ts` (`clientTournamentWhere`, `clientTeamWhere`).

| Ai | Thấy gì trên màn hình Thành viên | Cấp/thu được gì |
|----|----------------------------------|-----------------|
| Admin gốc | Mọi thành viên, mọi giải, mọi đội | Tất cả |
| Admin phụ | Mọi thành viên; chỉ giải/đội mình **tạo ra hoặc được chia sẻ quyền quản lý** (`ownedOrSharedWhere`), và chỉ trong module được cấp (TOURNAMENTS / TEAMS) | Chỉ trong phạm vi đó |
| CLIENT | Không vào được (`@AdminOnly`) | — |

Ba luật bắt buộc, `test/player-access.test.js` khoá lại:

1. **Phạm vi áp ngay trong truy vấn, cả đọc lẫn ghi.** Id giải gửi lên ngoài phạm vi bị lọc bỏ
   trước khi chạm bảng quyền; lệnh xoá cũng chỉ xoá `tournamentId IN (phạm vi)`. Admin phụ không
   thể thu quyền mà admin khác đã cấp cho giải của họ, kể cả khi sửa form.
2. **So khớp CLIENT bằng email, không bằng `user.id`.** Với người đăng ký ngoài, `user.id` là id
   dòng đăng ký; dùng nó làm `playerId` là mở nhầm đội của vận động viên có id trùng (lỗi từng
   có ở bộ lọc đội cũ).
3. **Ngoại lệ duy nhất**: người đăng ký ngoài chưa có hồ sơ `player` (không có chỗ để cấp quyền)
   vẫn thấy đúng giải mình vừa đăng ký, khớp lời hứa của trang "Đăng ký thành công".

Luồng tự động, để admin không phải cấp tay từng người: thêm người vào giải/đội (kể cả đăng ký
ngoài khớp hồ sơ có sẵn) → cấp luôn; xoá khỏi giải / gỡ khỏi đội → thu lại. "Bỏ giải" (withdraw)
không thu, vì còn khôi phục được. Migration `20260908120000` cấp sẵn cho mọi người đang có tên
trong giải/đội để không ai mất quyền lúc deploy.


## 4. Chống CSRF

Kiểm `Origin`/`Referer` cho mọi request ghi (`POST`/`PUT`/`PATCH`/`DELETE`), nằm ở
`src/common/csrf.ts`. Chọn cách này thay vì token ẩn trong form vì app có hàng chục form EJS —
gắn token vào từng form là hàng chục chỗ để quên, còn kiểm Origin nằm ở **một** chỗ và áp cho
cả route tương lai.

Đây là lớp thứ hai chồng lên cookie `sameSite: 'lax'`. Thiếu cả `Origin` lẫn `Referer` thì
**chặn**, không cho qua.

## 5. Bề mặt công khai

Đúng ba controller được `@Public()`:

| Controller | Lý do |
|------------|-------|
| `AuthController` | Trang đăng nhập — không mở thì thành vòng lặp redirect |
| `HealthController` | Render gọi `/healthz`, `/readyz` khi chưa có session; chỉ trả cờ boolean |
| `ExternalRegistrationController` | Người ngoài tự đăng ký giải qua link chia sẻ; đã có rate-limit theo IP + email |

Riêng `ExternalRegistrationController` là bề mặt công khai DUY NHẤT chạm vào dữ liệu thật, nên
nó chỉ được thấy giải **đang mở đăng ký ngoài** — lọc ngay trong truy vấn
(`findFirst({ where: { id, externalRegistrationEnabled: true } })`), áp cho cả GET lẫn POST.

Trước đây chỉ POST kiểm cờ đó, còn GET cứ tìm thấy id là render. Người lạ dò
`/external-register/1`, `/2`, `/3`… là lấy được **tên của mọi giải** trong hệ thống, kể cả giải
chưa hề mở đăng ký. Giải không tồn tại và giải chưa mở phải trả lời **giống hệt nhau**: phân
biệt hai câu đó chính là xác nhận id nào đang dùng. `test/security.test.js` khoá cả ba điểm này.

Danh sách này được **khoá bằng test** (`test/security.test.js`). Thêm `@Public()` ở chỗ khác
là test đỏ ngay, buộc người sửa phải cân nhắc.

## 6. Log

- **Mọi write action** (`POST`/`PUT`/`PATCH`/`DELETE`) đều được ghi vào bảng `app_log`.
- **Mọi lỗi** được ghi, kể cả lỗi 5xx (chỉ hiện thông báo chung ra ngoài, không lộ stack).
- **Truy cập bị từ chối** ghi với `category = 'ACCESS'`. Điểm này quan trọng: guard chạy TRƯỚC
  interceptor trong Nest, nên `HttpLogInterceptor` không nhìn thấy các request bị guard chặn.
  Vì vậy guard tự gọi `LogService.recordDenied()` — nếu không, đúng loại sự kiện đáng theo dõi
  nhất lại là loại duy nhất biến mất khỏi log.
- **Không ghi secret**: `safeParams()` che mọi trường có tên khớp
  `pass|pwd|secret|token|otp|cvv|card|authorization|cookie|api_key|credential|session|signature|csrf`,
  **kể cả nằm trong object/mảng lồng nhau**. Ảnh base64 bị cắt còn 300 ký tự.
- **Không nuốt exception**: hỏng đường ghi log thì báo ra `console.error`, không im lặng.

Xem log tại `/logs` (chỉ admin gốc), lọc theo `ACCESS` để soi khi nghi có người dò quyền.

## 7. Fail-fast khi cấu hình sai

App **không khởi động** ở production nếu:

- `SESSION_SECRET` thiếu hoặc còn giá trị mặc định.
- `APP_ADMIN_PASSWORD` yếu (trừ khi đặt `ALLOW_WEAK_ADMIN_PASSWORD=true`).
- `REQUIRE_REDIS=true` mà Redis không kết nối được.

Sai cấu hình bảo mật thì chết ngay lúc deploy vẫn hơn là chạy âm thầm ở trạng thái hở.

## 8. Test bảo mật chạy ở đâu

| File | Kiểm gì |
|------|---------|
| `test/authorization.test.js` | Rò dữ liệu giữa hai admin, FeatureGuard, khoá tính năng |
| `test/security.test.js` | CSRF, che secret trong log, danh sách route công khai |
| `test/permission-snapshot.test.js` | Giao diện từng vai nhìn thấy đúng những gì |
| `test/player-access.test.js` | Quyền xem thành viên theo phạm vi admin, bộ lọc CLIENT |
| `e2e/permissions.spec.js` | Cả stack trong trình duyệt thật, **cần `E2E_DATABASE_URL`** |

CI có bước `scripts/assert-e2e-permissions-ran.js` để bắt trường hợp bộ e2e phân quyền tự
skip vì thiếu DB — không có bước đó thì pipeline xanh giả.

## Khoá phóng to trang trên điện thoại

Mọi trang đều có `<meta name="viewport" ... user-scalable=no, maximum-scale=1>`, nhưng **iOS bỏ
qua hai thuộc tính đó từ iOS 10** — Apple cố tình gỡ quyền của trang web vì lý do trợ năng. Nên
thẻ meta một mình chưa bao giờ khoá được zoom trên iPhone, thiết bị chính của chủ app.

Khoá thật cần ba lớp, `test/ui-smoke.test.js` khoá cả ba lại:

1. Thẻ `meta viewport` — có tác dụng trên Android/Chrome.
2. `touch-action: pan-x pan-y` ở `html`/`body` — cho cuộn, cấm chụm ngón và nhấn đúp để phóng.
3. `public/js/no-zoom.js` — chặn `gesturestart/change/end` (sự kiện riêng của Safari) và
   `touchmove` từ 2 ngón trở lên. Nạp ở `partials/head` để cả trang đăng nhập lẫn các màn hình
   game (không có menu dưới) đều được khoá.

Giới hạn phải nói rõ: đây là chặn cử chỉ **trong trang**. Người dùng vẫn phóng to được qua
Cài đặt → Trợ năng của iOS, và đó là đúng — không nên khoá tuyệt đối. Ctrl + lăn chuột trên máy
tính cũng cố ý không chặn.
