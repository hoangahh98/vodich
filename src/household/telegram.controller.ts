import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { Public } from '../common/feature.decorator';
import { HouseholdTelegramService, TelegramUpdate } from './household-telegram.service';

/**
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
}
