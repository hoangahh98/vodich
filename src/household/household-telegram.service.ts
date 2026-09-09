import { Injectable, Logger } from '@nestjs/common';
import { Household, HouseholdPurpose, HouseholdSource } from '@prisma/client';
import { formatMoney } from '../common/money';
import { PrismaService } from '../prisma.service';
import { parseBankMessage } from './bank-parsers';
import { HouseholdLedgerService } from './household-ledger.service';

/** Phần của một update Telegram mà ta dùng. Bot API gửi nhiều hơn nhưng không cần khai hết. */
export interface TelegramUpdate {
  update_id?: number;
  message?: { message_id: number; text?: string; chat: { id: number | string; type?: string }; from?: { id: number } };
  channel_post?: { message_id: number; text?: string; chat: { id: number | string; type?: string } };
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number | string }; text?: string } };
}

interface InlineButton {
  text: string;
  callback_data: string;
}

/**
 * Bot Telegram của module Chi tiêu, nhận qua WEBHOOK (không quét định kỳ):
 *
 *  1. Apps Script trên Gmail của chủ hộ đẩy nguyên văn mail ngân hàng vào một nhóm có bot.
 *  2. Telegram gọi POST /telegram/webhook/<secret> → `handleUpdate()`.
 *  3. Tin đọc được (bank-parsers.ts) → ghi giao dịch qua HouseholdLedgerService (khớp định kỳ,
 *     đoán mục đích) → trả lời kèm hàng nút mục đích. Bấm nút là gán xong, không cần mở web.
 *  4. Tin không đọc được / không khớp nguồn → cất `household_inbox` (UNPARSED) để xử lý tay.
 *
 * Liên kết nhóm với hộ: ở Cài đặt hộ lấy mã, trong nhóm gõ `/link <mã>`. Một nhóm một hộ.
 * Thiếu TELEGRAM_BOT_TOKEN thì mọi lệnh gửi đi bị bỏ qua (ghi log), phần ghi sổ vẫn chạy.
 */
@Injectable()
export class HouseholdTelegramService {
  private readonly logger = new Logger(HouseholdTelegramService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: HouseholdLedgerService,
  ) {}

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    try {
      if (update.callback_query) return await this.handleCallback(update.callback_query);
      const message = update.message || update.channel_post;
      if (message?.text) return await this.handleMessage(String(message.chat.id), message.message_id, message.text);
    } catch (error) {
      // Webhook phải trả 200 kể cả khi lỗi, không thì Telegram gửi lại mãi cùng một tin.
      this.logger.error(`Telegram update lỗi: ${(error as Error).message}`);
    }
  }

  private async handleMessage(chatId: string, messageId: number, text: string) {
    const trimmed = text.trim();
    const link = /^\/link(?:@\w+)?\s+([A-Za-z0-9]{4,})/.exec(trimmed);
    if (link) return this.linkChat(chatId, link[1].toUpperCase());
    if (/^\/(start|help)/.test(trimmed)) {
      return this.send(chatId, 'Bot chi tiêu Vô địch. Vào Cài đặt của hộ trên web lấy mã rồi gõ: /link <mã>. Sau đó mọi tin ngân hàng đẩy vào nhóm này sẽ tự ghi sổ.');
    }

    const household = await this.prisma.household.findFirst({ where: { telegramChatId: chatId } });
    if (!household) return;

    // Chống xử lý hai lần khi Telegram gửi lại cùng một update.
    const seen = await this.prisma.householdInbox.findUnique({ where: { chatId_messageId: { chatId, messageId: BigInt(messageId) } } });
    if (seen) return;
    const inbox = await this.prisma.householdInbox.create({ data: { householdId: household.id, chatId, messageId: BigInt(messageId), text } });

    const parsed = parseBankMessage(text);
    if (!parsed) return this.send(chatId, 'Không đọc được tin này, đã cất vào hộp thư "cần xử lý" trên web.');

    const sources = await this.prisma.householdSource.findMany({ where: { householdId: household.id, active: true } });
    const source = pickSource(sources, parsed.bank, parsed.accountKey);
    if (!source) {
      return this.send(chatId, `Chưa có nguồn tiền nào khớp ${parsed.bank} ${parsed.accountKey ? `(${parsed.accountKey})` : ''}. Vào Nguồn tiền trên web khai số tài khoản / 4 số cuối thẻ rồi gửi lại.`);
    }
    if (parsed.direction === 'IN' && source.kind === 'CARD') {
      await this.prisma.householdInbox.update({ where: { id: inbox.id }, data: { status: 'IGNORED' } });
      return this.send(chatId, `Tiền vào thẻ ${source.name} ${formatMoney(parsed.amount)}đ — bỏ qua (trả thẻ đã ghi ở tài khoản trả, hoàn tiền thì sửa tay).`);
    }

    const result = await this.ledger.create(household.id, {
      kind: parsed.direction === 'IN' ? 'INCOME' : 'EXPENSE',
      sourceId: source.id,
      amount: parsed.amount,
      occurredAt: parsed.occurredAt,
      description: parsed.description,
      rawText: text,
      externalId: parsed.externalId,
      status: 'NEW',
      telegramChatId: chatId,
      telegramMsgId: BigInt(messageId),
    });
    await this.prisma.householdInbox.update({ where: { id: inbox.id }, data: { status: 'PARSED', transactionId: result.transaction.id } });
    if (result.duplicate) return this.send(chatId, 'Giao dịch này đã ghi trước đó, bỏ qua.');

    const purposes = await this.prisma.householdPurpose.findMany({ where: { householdId: household.id, active: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    const tx = result.transaction;
    const purposeName = tx.purposeId ? purposes.find((item) => item.id === tx.purposeId)?.name : '';
    const lines = [
      `${tx.kind === 'INCOME' ? 'Thu' : 'Chi'} ${formatMoney(Number(tx.amount))}đ · ${source.name}`,
      parsed.description,
    ];
    if (result.matched) lines.push(`Khớp khoản định kỳ: ${result.matched.recurring.name}${purposeName ? ` → ${purposeName}` : ''}`);
    else if (result.suggestedPurposeId && purposeName) lines.push(`Đoán mục đích: ${purposeName} (theo lần trước). Bấm nút nếu muốn đổi.`);
    else lines.push('Chọn mục đích:');
    const keyboard = result.matched ? [] : this.purposeKeyboard(tx.id, tx.kind, purposes, sources, source);
    await this.send(chatId, lines.join('\n'), keyboard);
  }

  private async handleCallback(query: NonNullable<TelegramUpdate['callback_query']>) {
    const data = String(query.data || '');
    const chatId = query.message ? String(query.message.chat.id) : '';
    const household = chatId ? await this.prisma.household.findFirst({ where: { telegramChatId: chatId } }) : null;
    if (!household) return this.answer(query.id, 'Nhóm chưa liên kết hộ nào.');

    const purpose = /^hp:(\d+):(\d*)$/.exec(data);
    const transfer = /^ht:(\d+):(\d+)$/.exec(data);
    let done = '';
    if (purpose) {
      const purposeId = purpose[2] ? BigInt(purpose[2]) : null;
      const tx = await this.ledger.setPurpose(household.id, BigInt(purpose[1]), purposeId);
      if (tx) done = `✓ ${tx.kind === 'INCOME' ? 'Thu' : 'Chi'} ${formatMoney(Number(tx.amount))}đ · ${tx.source.name} → ${tx.purpose?.name || 'Không mục đích'}`;
    } else if (transfer) {
      const tx = await this.ledger.convertToTransfer(household.id, BigInt(transfer[1]), BigInt(transfer[2]));
      if (tx) done = `✓ Chuyển ${formatMoney(Number(tx.amount))}đ · ${tx.source.name} → ${tx.targetSource?.name}${Number(tx.interest) ? ` (lãi ${formatMoney(Number(tx.interest))}đ)` : ''}`;
    }
    await this.answer(query.id, done ? 'Đã ghi' : 'Không tìm thấy giao dịch');
    if (done && query.message) {
      const original = String(query.message.text || '').split('\n').slice(0, 2).join('\n');
      await this.api('editMessageText', { chat_id: chatId, message_id: query.message.message_id, text: `${original}\n${done}` });
    }
  }

  private async linkChat(chatId: string, code: string) {
    const household = await this.prisma.household.findFirst({ where: { telegramLinkCode: code } });
    if (!household) return this.send(chatId, 'Mã liên kết không đúng hoặc đã dùng. Lấy mã mới ở Cài đặt hộ trên web.');
    await this.prisma.household.updateMany({ where: { telegramChatId: chatId, id: { not: household.id } }, data: { telegramChatId: null } });
    await this.prisma.household.update({ where: { id: household.id }, data: { telegramChatId: chatId, telegramLinkCode: null } });
    await this.send(chatId, `Đã liên kết nhóm này với hộ "${household.name}". Tin ngân hàng gửi vào đây sẽ tự ghi sổ.`);
  }

  /** Hàng nút: mục đích hợp với chiều tiền, cộng thêm "Trả thẻ X / Trả nợ Y" khi chi từ tài khoản. */
  private purposeKeyboard(transactionId: bigint, kind: string, purposes: HouseholdPurpose[], sources: HouseholdSource[], source: HouseholdSource): InlineButton[][] {
    const fitting = purposes.filter((purpose) => (kind === 'INCOME' ? purpose.kind === 'INCOME' : purpose.kind !== 'INCOME'));
    const rows = chunk(
      fitting.map((purpose) => ({ text: purpose.name, callback_data: `hp:${transactionId}:${purpose.id}` })),
      2,
    );
    if (kind === 'EXPENSE' && !['CARD', 'LOAN'].includes(source.kind)) {
      const debts = sources.filter((item) => ['CARD', 'LOAN'].includes(item.kind) && item.id !== source.id);
      rows.push(...chunk(debts.map((item) => ({ text: `${item.kind === 'CARD' ? 'Trả thẻ' : 'Trả nợ'} ${item.name}`, callback_data: `ht:${transactionId}:${item.id}` })), 2));
    }
    return rows;
  }

  private send(chatId: string, text: string, keyboard: InlineButton[][] = []) {
    const payload: Record<string, unknown> = { chat_id: chatId, text };
    if (keyboard.length) payload.reply_markup = { inline_keyboard: keyboard };
    return this.api('sendMessage', payload);
  }

  private answer(callbackId: string, text: string) {
    return this.api('answerCallbackQuery', { callback_query_id: callbackId, text });
  }

  /** Gọi Bot API bằng fetch có sẵn của Node 20. Không có token = chế độ "chỉ ghi sổ", không trả lời. */
  private async api(method: string, payload: Record<string, unknown>): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.logger.warn(`Thiếu TELEGRAM_BOT_TOKEN, bỏ qua ${method}`);
      return;
    }
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) this.logger.warn(`Telegram ${method} trả ${response.status}: ${(await response.text()).slice(0, 200)}`);
    } catch (error) {
      this.logger.warn(`Telegram ${method} lỗi mạng: ${(error as Error).message}`);
    }
  }
}

/**
 * Chọn nguồn khớp tin: cùng ngân hàng và khoá nhận diện (số tài khoản / 4 số cuối) khớp đuôi
 * nhau; không có khoá thì lấy nguồn duy nhất của ngân hàng đó (nhiều nguồn mà không khoá = mù).
 */
export function pickSource<T extends Pick<HouseholdSource, 'id' | 'name' | 'kind' | 'bank' | 'matchKey'>>(sources: T[], bank: string, accountKey: string): T | null {
  const sameBank = sources.filter((source) => source.bank === bank);
  const pool = sameBank.length ? sameBank : sources.filter((source) => source.bank === 'OTHER');
  if (accountKey) {
    const keyed = pool.find((source) => source.matchKey && (accountKey.endsWith(source.matchKey) || source.matchKey.endsWith(accountKey)));
    if (keyed) return keyed;
  }
  return pool.length === 1 ? pool[0] : null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}

export type { Household };
