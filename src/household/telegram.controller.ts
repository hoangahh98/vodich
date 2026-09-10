import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { Public } from '../common/feature.decorator';
import { HouseholdTelegramService, TelegramUpdate } from './household-telegram.service';

/**
 * Hai cửa công khai của bot, cùng một bí mật:
 *  - POST /telegram/webhook/<secret>: Telegram gọi khi có tin nhắn của NGƯỜI hoặc bấm nút.
 *  - POST /telegram/ingest/<secret>: Apps Script gửi nội dung mail ngân hàng {chat_id, text}.
 *
 * Webhook Telegram gọi vào — bắt buộc @Public vì Telegram không có phiên đăng nhập. Bảo vệ bằng
 * HAI lớp: bí mật nằm trong đường dẫn (`TELEGRAM_WEBHOOK_SECRET`, chỉ ai đặt webhook mới biết) và
 * header `X-Telegram-Bot-Api-Secret-Token` mà Telegram gửi kèm khi đặt webhook với `secret_token`.
 * Sai một trong hai là 200 rỗng (không lộ gì), không xử lý. Chưa cấu hình bí mật = route đóng.
 *
 * Đặt webhook một lần (thay <token>, <host>, <secret>):
 *   https://api.telegram.org/bot<token>/setWebhook?url=https://<host>/telegram/webhook/<secret>&secret_token=<secret>
 */
@Controller()
export class TelegramController {
  constructor(private readonly telegram: HouseholdTelegramService) {}

  @Post('/telegram/webhook/:secret')
  @Public()
  @HttpCode(200)
  async webhook(@Param('secret') secret: string, @Headers('x-telegram-bot-api-secret-token') header: string | undefined, @Body() body: TelegramUpdate) {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET || '';
    if (!expected || secret !== expected || (header && header !== expected)) return { ok: true };
    await this.telegram.handleUpdate(body || {});
    return { ok: true };
  }

  /**
   * Apps Script gửi mail vào đây (không gửi vào nhóm bằng token bot — Telegram không đưa tin của
   * chính bot về webhook). Trả lý do khi sai bí mật/thiếu dữ liệu để người cài script còn biết.
   */
  @Post('/telegram/ingest/:secret')
  @Public()
  @HttpCode(200)
  async ingest(@Param('secret') secret: string, @Body() body: { chat_id?: string | number; text?: string; mail_id?: string }) {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET || '';
    if (!expected || secret !== expected) return { ok: false, reason: 'Sai bí mật' };
    const chatId = String(body?.chat_id || '').trim();
    const text = String(body?.text || '').trim();
    if (!chatId || !text) return { ok: false, reason: 'Thiếu chat_id hoặc text' };
    // `mail_id` = id tin của Gmail. MSB gửi HAI mail giống hệt nhau từng chữ cho hai giao dịch khác nhau
    // (chủ app gặp 10/9/2026: hai lần trả 1.000đ cùng phút, cùng hạn mức khả dụng) — chỉ id tin mới phân
    // biệt được. Script cũ không gửi id thì vẫn chạy như trước (chống trùng theo nội dung).
    return this.telegram.ingestFromScript(chatId, text, String(body?.mail_id || '').trim());
  }
}
