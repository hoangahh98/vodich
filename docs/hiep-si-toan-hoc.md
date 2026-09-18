# Tech Spec — Game "Hiệp Sĩ Toán Học" ⚔️

Ứng dụng học toán nhập vai (RPG) cho trẻ **4–7 tuổi**: bé đóng vai hiệp sĩ, trả lời
câu hỏi toán để hạ quái và vượt 10 ải cứu công chúa/hoàng tử. Đề bài do **AI (Groq)**
sinh động theo **tuổi + ghi chú** của từng bé.

## 1. Kiến trúc & sự khác biệt với spec gốc

Spec gốc mô tả stack React + PostgreSQL thuần + Groq. Dự án thực tế là
**NestJS 10 + Prisma (PostgreSQL/Supabase) + EJS + vanilla JS**, chạy sau CSP
`script-src 'self'` (cấm inline script, không có pipeline build React). Vì vậy:

| Spec gốc | Hiện thực trong dự án | Lý do |
|----------|------------------------|-------|
| React component (game loop) | **State machine vanilla JS** `public/js/games-knight.js` | Đồng bộ 8 game hiện có; React island không chạy được dưới CSP/không có bundler. Mô hình state (`playerHp`, `monsterHp`, `question`, `timer`) giữ nguyên như một component React. |
| SQL thuần | **Prisma models + migration SQL** | Toàn dự án dùng Prisma; migration `.sql` vẫn là deliverable SQL. |
| Groq sinh đề | **Sinh đề bằng code**, không gọi AI | Đề do AI sinh có lúc đặt sai đáp án — xem mục 3. Game vì thế KHÔNG cần `GROQ_API_KEY`. |

Các tệp thêm mới:
- `src/games/knight.constants.ts` — 10 ải + quái (nguồn sự thật ở server).
- `src/games/knight-ai.service.ts` — sinh câu hỏi từ (tuổi, ghi chú, mức khó, ải) bằng code. Tên
  lớp còn chữ "Ai" là dấu vết của bản đầu, giờ nó không gọi AI nữa.
- `src/games/knight.service.ts` — CRUD nhân vật + lưu/nạp tiến trình (Prisma).
- `src/games/knight.controller.ts` — routes `/games/hiep-si*`.
- `src/views/games/knight.ejs` — 4 màn (chọn/tạo nhân vật, bản đồ ải, chiến đấu) + overlay.
- `public/js/games-knight.js` — vòng lặp game.
- `prisma/migrations/20260713100000_add_knight_math_game/migration.sql`.
- CSS trong `public/css/app.css` (`.game-stage-knight`, `.knight-*`), thẻ hub nhóm "Học vui".

## 2. Lược đồ cơ sở dữ liệu

Bảng `app_user` (Users) đã có sẵn cho đăng nhập. Thêm 2 bảng:

```sql
CREATE TABLE "knight_character" (               -- Characters: hồ sơ nhân vật (Save/Load)
  "id" BIGSERIAL PRIMARY KEY,
  "owner_user_id" BIGINT NOT NULL,              -- thuộc về app_user (chống IDOR)
  "name" VARCHAR(60) NOT NULL,
  "gender" VARCHAR(10) NOT NULL DEFAULT 'boy',
  "age" INTEGER NOT NULL,                        -- 4..7
  "notes" TEXT NOT NULL DEFAULT '',             -- ghi chú điểm mạnh/yếu
  "current_stage" INTEGER NOT NULL DEFAULT 1,   -- màn chơi hiện tại (chơi tiếp)
  "hp" INTEGER NOT NULL DEFAULT 10,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | RESTING | VICTORY
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "knight_progress" (                -- GameProgress: lịch sử từng ải
  "id" BIGSERIAL PRIMARY KEY,
  "character_id" BIGINT NOT NULL,
  "stage_number" INTEGER NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'CLEARED',
  "stars" INTEGER NOT NULL DEFAULT 0,           -- 0..3
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX ON "knight_progress"("character_id","stage_number");
CREATE INDEX ON "knight_character"("owner_user_id");
-- FK owner_user_id -> app_user, character_id -> knight_character (ON DELETE CASCADE)
```

**Ràng buộc "không tìm kiếm theo khoảng":** mọi truy vấn cấu hình/tiến trình đều
dùng **so khớp chính xác** — `findUnique(id)`, `findMany(where ownerUserId = ...)`,
`upsert(where characterId_stageNumber)`, và tra ải bằng `STAGES.find(s => s.stage === n)`.
Không dùng `gt/lt/gte/lte/between`.

## 3. Sinh câu hỏi bằng CODE, không gọi AI

> **Đã đổi so với spec gốc.** Ban đầu đề do Groq sinh, `sanitizeQuestions` lọc lại và có fallback
> tĩnh khi AI hỏng. Nay `KnightAiService` **không gọi AI nữa** — `isConfigured()` luôn trả `true`
> và `generateQuestions` dựng đề hoàn toàn bằng code. Lý do: đề do AI sinh có lúc **đặt sai đáp
> án**, mà sai đáp án với bé 4–7 tuổi thì tệ hơn hẳn một bộ đề đơn giản nhưng luôn đúng. Đổi lại,
> game không cần `GROQ_API_KEY`, không có độ trễ mạng và không tốn hạn mức API.

`KnightAiService.generateQuestions({ age, notes, monster, count, level, stage })`:

1. **Độ khó** = mốc theo mức người chơi chọn (`easy` 0 / `medium` 3 / `hard` 6) **+ số ải đã đi**,
   kẹp trong 0–16 — ải càng cao càng khó.
2. **Chọn dạng câu theo tuổi** (`typePool`): 4 tuổi thiên về đếm, quy luật, hình khối; 5 tuổi thêm
   cộng/trừ bằng hình; 6–7 tuổi cộng/trừ bằng số, so sánh, dãy số. Ngoài ra còn dạng mở rộng: so
   sánh dấu, trước/sau, đếm cạnh hình, vật thật, loại vật khác nhóm, nặng/nhẹ, chia kẹo, đếm
   chân/bánh xe, xem giờ, thứ trong tuần, suy luận bắc cầu, và **cân thăng bằng** (1 vật lớn = k
   vật nhỏ).
3. **`notes` (điểm mạnh/yếu bố mẹ ghi) cộng trọng số** cho đúng dạng cần luyện: ghi "cộng" thì dạng
   cộng xuất hiện dày hơn, ghi "hình" thì thêm quy luật/hình khối… Ghi chú cũng đổi bộ emoji minh
   hoạ (`themeEmojis`) để hợp sở thích của bé.
4. **Không câu nào trùng nhau** trong một ải: mỗi câu dựng xong lấy `signature` rồi bỏ nếu đã gặp.
   Số câu xin luôn đủ cho trường hợp xấu nhất (hạ hết đợt + tối đa `MAX_HP−1` câu sai).
5. Đáp án đúng **theo cấu tạo** — câu được dựng từ con số trước rồi mới sinh lựa chọn nhiễu, nên
   không có chuyện đáp án sai.

Định dạng 1 câu hỏi (trực quan, bấm chọn — không gõ phím):
```json
{ "prompt": "Đếm xem có tất cả mấy 🍎?", "visual": "🍎🍎🍎", "choices": ["2","3","4"], "answer": 1 }
```

Ngoài `type: 'choice'` mặc định còn `type: 'match'` (nối số với nhóm hình, dùng `pairs`), và các
trường phụ `clock` (vẽ đồng hồ kim), `balance` (vẽ cân), `explain` (giải thích khi bé chọn xong).

Endpoint `/quiz` vẫn giữ **rate-limit 20 lần/phút/IP** (`RateLimitService`) — không phải để giữ hạn
mức AI nữa mà để một tab lặp vô hạn không ngốn CPU server.

## 4. Cơ chế RPG (state machine — `games-knight.js`)

- **Nhân vật:** 10 HP. **Quái:** thường 1 HP · tinh anh 2–3 HP · **boss 10 HP** (ải 5 & 10).
- Trả lời **đúng** → −1 HP quái (+ hiệu ứng, confetti). Đủ số → **qua ải**.
- Trả lời **sai** hoặc **hết 180s** → quái cắn −1 HP nhân vật (hiện đáp án đúng để bé học).
- **HP nhân vật = 0** → trạng thái `RESTING`, **chơi lại đúng màn hiện tại** (không reset toàn bộ);
  các ải đã qua vẫn giữ.
- **Qua ải cuối (10)** → `VICTORY` (cứu công chúa). Sao mỗi ải: 3⭐ nếu không sai, 2⭐ nếu sai ≤2, còn lại 1⭐.
- Mỗi câu có **đồng hồ 180s** (thanh + số, đổi màu khi ≤20s).

Tiến trình được lưu server sau mỗi ải qua/nghỉ ngơi (`POST /progress`), nên bé đăng nhập
lại **chơi tiếp** từ đúng màn.

## 5. API

| Method | Path | Việc |
|--------|------|------|
| GET  | `/games/hiep-si` | Trang game (list nhân vật + bản đồ ải, gate `requireUser`) |
| POST | `/games/hiep-si/character` | Tạo nhân vật `{name,gender,age,notes}` |
| POST | `/games/hiep-si/character/delete` | Xoá nhân vật (kiểm sở hữu) |
| POST | `/games/hiep-si/quiz` | Sinh đề cho 1 ải `{characterId,stage}` (rate-limit) |
| POST | `/games/hiep-si/progress` | Lưu tiến trình `{characterId,stage,hp,cleared,stars}` |

Mọi endpoint kiểm `req.session.user` và **quyền sở hữu nhân vật** (so `ownerUserId === BigInt(user.id)`).

## 6. UI/UX responsive & màn hình gập

- `min-height: 100svh`, lưới **`auto-fit/auto-fill`** cho danh sách nhân vật, bản đồ ải và
  các thẻ đáp án → tự dàn lại khi mở gập từ thanh dài sang vuông.
- Media query riêng cho **foldable mở ngang / màn thấp** (`min-width:720px and max-height:560px`)
  thu nhỏ arena, và cho điện thoại nhỏ (`max-width:480px`).
- Tương tác **bấm thẻ hình/số** (không bàn phím); phản hồi âm thanh + emoji + confetti.

## 7. Triển khai

- Migration tự chạy khi deploy: `render:build` → `npx prisma migrate deploy`.
- Biến môi trường: **không cần cái nào**. Game không gọi AI nên `GROQ_API_KEY` không liên quan tới
  nó (biến ấy chỉ còn phục vụ game "Tập nói chuyện tiếng Anh").
- Không cần thư viện mới; đã build sạch (`nest build`).
