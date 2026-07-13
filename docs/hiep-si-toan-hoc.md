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
| Groq | **Groq** qua `AiService.generateJson` có sẵn | Đúng provider dự án đang dùng (`GROQ_API_KEY`). |

Các tệp thêm mới:
- `src/games/knight.constants.ts` — 10 ải + quái (nguồn sự thật ở server).
- `src/games/knight-ai.service.ts` — sinh câu hỏi từ (tuổi, ghi chú) + fallback tĩnh.
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

## 3. Luồng AI sinh câu hỏi (từ biến Tuổi + Ghi chú)

`KnightAiService.generateQuestions({ age, notes, monster, count })`:

1. Nếu `GROQ_API_KEY` đã cấu hình → dựng prompt cá nhân hoá:
   - **4–5 tuổi:** nhận diện hình khối, quy luật/dãy hình, đếm số lượng qua hình ảnh
     (cảm hứng POMath/Kumon/VioEdu). **6–7 tuổi:** cộng/trừ ≤20, so sánh, toán đố logic.
   - `notes` (điểm mạnh/yếu) được nhét vào prompt để luyện đúng chỗ yếu, tránh làm bé nản.
   - Độ khó theo loại quái (`normal`/`elite`/`boss`).
2. Gọi `ai.generateJson()` → nhận `{ questions: [...] }`.
3. **Kiểm chứng & làm sạch** từng câu (`sanitizeQuestions`): prompt không rỗng, 2–4 lựa chọn,
   `answer` là chỉ số hợp lệ. Câu hỏng bị loại; thiếu thì bù bằng câu tĩnh.
4. Nếu AI chưa cấu hình / lỗi / JSON hỏng → **fallback tĩnh** sinh đề đúng lứa tuổi
   (đếm emoji, quy luật hình, hình khối / cộng trừ, so sánh). **Game luôn chơi được.**

Định dạng 1 câu hỏi (trực quan, bấm chọn — không gõ phím):
```json
{ "prompt": "Đếm xem có tất cả mấy 🍎?", "visual": "🍎🍎🍎", "choices": ["2","3","4"], "answer": 1 }
```

Chống lạm dụng: endpoint `/quiz` có **rate-limit 20 lần/phút/IP** (`RateLimitService`),
`AiService` có timeout 20s + retry 3 lần.

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
- Biến môi trường: **`GROQ_API_KEY`** (tuỳ chọn — không có vẫn chơi được nhờ fallback),
  `GROQ_MODEL` (mặc định `llama-3.3-70b-versatile`), `AI_TIMEOUT_MS`.
- Không cần thư viện mới; đã build sạch (`nest build`).
