import { Injectable, Logger } from '@nestjs/common';
import { Household, HouseholdPurpose, HouseholdSource } from '@prisma/client';
import { formatMoney } from '../common/money';
import { PrismaService } from '../prisma.service';
import { parseBankMessage } from './bank-parsers';
import { HouseholdConfigService } from './household-config.service';
import { HouseholdLedgerService } from './household-ledger.service';
import { sourceBalances } from './household-month';
import { toSourceRow, toTransactionRow } from './household-rows';

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
 * Bot Telegram của module Chi tiêu:
 *
 *  1. Apps Script trên Gmail của chủ hộ gửi nguyên văn mail ngân hàng THẲNG VÀO APP
 *     (POST /telegram/ingest/<secret>, kèm id nhóm) → `ingestBankText()`.
 *     KHÔNG gửi mail vào nhóm bằng token của bot: Telegram không bao giờ đưa tin do chính bot gửi
 *     về webhook, nên bot sẽ im lặng (đã dính đúng lỗi này 10/9/2026), và nhóm ngập nguyên văn mail.
 *  2. Tin đọc được (bank-parsers.ts) → ghi giao dịch qua HouseholdLedgerService (khớp định kỳ,
 *     đoán mục đích, mặc định Chi tiêu) → bot đăng lên nhóm bản TÓM TẮT kèm hàng nút mục đích.
 *     Bấm nút là gán xong, không cần mở web (callback_query về qua webhook).
 *  3. Tin không đọc được / không khớp nguồn → cất `household_inbox` (UNPARSED) để xử lý tay.
 *  4. Người trong nhóm tự dán nội dung mail vào nhóm cũng được: webhook nhận tin của NGƯỜI và đi
 *     cùng đường `ingestBankText()`.
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
    private readonly config: HouseholdConfigService,
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
      return this.send(chatId, `Bot chi tiêu Vô địch. Vào Cài đặt của hộ trên web lấy mã rồi gõ: /link <mã>. Sau đó mọi tin ngân hàng đẩy vào nhóm này sẽ tự ghi sổ.\nId nhóm này (điền vào Apps Script): ${chatId}`);
    }

    const household = await this.prisma.household.findFirst({ where: { telegramChatId: chatId } });
    if (!household) return;
    await this.ingestBankText(household, chatId, BigInt(messageId), text);
  }

  /**
   * Cửa vào cho Apps Script (POST /telegram/ingest): `chatId` là id nhóm đã liên kết, dùng để tìm hộ.
   * Không có message_id của Telegram nên lấy hash nội dung làm khoá chống trùng trong hộp thư; giao
   * dịch còn được chống trùng lần nữa bằng `externalId` (mã giao dịch ngân hàng).
   */
  async ingestFromScript(chatId: string, text: string): Promise<{ ok: boolean; reason?: string }> {
    const household = await this.prisma.household.findFirst({ where: { telegramChatId: chatId } });
    if (!household) return { ok: false, reason: 'Nhóm này chưa liên kết hộ nào (gõ /link <mã> trong nhóm trước).' };
    const outcome = await this.ingestBankText(household, chatId, textHash(text), text);
    return outcome === 'duplicate' ? { ok: true, reason: 'Tin này đã xử lý trước đó, bỏ qua.' } : { ok: true };
  }

  /**
   * Đọc một tin ngân hàng, ghi sổ, đăng tóm tắt + nút lên nhóm. Dùng chung cho Apps Script và tin dán tay.
   * Trả 'duplicate' khi tin đã xử lý và giao dịch của nó vẫn còn; giao dịch đã bị xoá tay thì cho ghi lại
   * (chủ app xoá nhầm rồi đánh dấu mail chưa đọc để gửi lại — phải ra được giao dịch mới).
   */
  private async ingestBankText(household: Household, chatId: string, messageId: bigint, text: string): Promise<'done' | 'duplicate'> {
    const seen = await this.prisma.householdInbox.findUnique({ where: { chatId_messageId: { chatId, messageId } } });
    if (seen) {
      const stillThere = seen.transactionId ? await this.prisma.householdTransaction.count({ where: { id: seen.transactionId, householdId: household.id } }) : 0;
      if (stillThere || seen.status === 'UNPARSED') return 'duplicate';
      await this.prisma.householdInbox.delete({ where: { id: seen.id } });
    }
    const inbox = await this.prisma.householdInbox.create({ data: { householdId: household.id, chatId, messageId, text } });

    const parsed = parseBankMessage(text);
    if (!parsed) {
      await this.send(chatId, `Không đọc được tin ngân hàng này, đã cất vào "Tin Telegram chưa đọc được" trên web.\n${text.trim().slice(0, 200)}`);
      return 'done';
    }

    const sources = await this.prisma.householdSource.findMany({ where: { householdId: household.id, active: true } });
    const source = pickSource(sources, parsed.bank, parsed.accountKey);
    if (!source) {
      // Không khớp nguồn: xoá dòng hộp thư để khai nguồn xong gửi lại là ăn ngay.
      await this.prisma.householdInbox.delete({ where: { id: inbox.id } });
      await this.send(chatId, `Chưa có nguồn tiền nào khớp ${parsed.bank}${parsed.accountKey ? ` (${parsed.accountKey})` : ''}. Vào Nguồn tiền trên web khai số tài khoản / 4 số cuối thẻ rồi gửi lại.`);
      return 'done';
    }
    const when = parsed.occurredAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

    // Tiền VÀO thẻ tín dụng: nếu vừa ghi trả thẻ đúng số đó từ tài khoản (±3 ngày) thì đây là bản sao
    // của lần trả — bỏ qua. Không thì là hoàn tiền (Shopee trả lại...): ghi Thu vào thẻ để giảm dư nợ.
    if (parsed.direction === 'IN' && source.kind === 'CARD') {
      const windowMs = 3 * 24 * 60 * 60 * 1000;
      const payment = await this.prisma.householdTransaction.findFirst({
        where: {
          householdId: household.id,
          kind: 'TRANSFER',
          targetSourceId: source.id,
          amount: parsed.amount,
          occurredAt: { gte: new Date(parsed.occurredAt.getTime() - windowMs), lte: new Date(parsed.occurredAt.getTime() + windowMs) },
        },
      });
      if (payment) {
        await this.prisma.householdInbox.update({ where: { id: inbox.id }, data: { status: 'IGNORED', transactionId: payment.id } });
        await this.send(chatId, `Thẻ ${source.name} nhận ${formatMoney(parsed.amount)}đ (${when}) — là lần trả thẻ đã ghi, không ghi thêm.`);
        return 'done';
      }
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
      telegramMsgId: messageId,
      reportedBalance: parsed.balance ?? null,
    });
    await this.prisma.householdInbox.update({ where: { id: inbox.id }, data: { status: 'PARSED', transactionId: result.transaction.id } });
    if (result.duplicate) return 'duplicate';

    const purposes = await this.prisma.householdPurpose.findMany({ where: { householdId: household.id, active: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    const allTransactions = await this.prisma.householdTransaction.findMany({ where: { householdId: household.id } });
    const balances = sourceBalances(sources.map(toSourceRow), allTransactions.map(toTransactionRow));
    const tx = result.transaction;
    const purposeName = tx.purposeId ? purposes.find((item) => item.id === tx.purposeId)?.name : '';
    const refund = tx.kind === 'INCOME' && source.kind === 'CARD';
    const lines = [
      `${refund ? 'Hoàn tiền vào thẻ' : tx.kind === 'INCOME' ? 'Thu' : 'Chi'} ${formatMoney(Number(tx.amount))}đ · ${source.name} · ${when}`,
      parsed.description,
    ];
    if (parsed.balance !== undefined) lines.push(await this.syncBalance(household.id, source, parsed.balance));
    if (refund) lines.push('Đã trừ dư nợ thẻ. Chọn mục đích được hoàn (trừ bớt mục đó); nếu đây là lần trả thẻ thì bấm Bỏ qua.');
    else if (result.matched) lines.push(`Khớp khoản định kỳ: ${result.matched.recurring.name}${purposeName ? ` → ${purposeName}` : ''}`);
    else if (result.suggestedPurposeId && purposeName) lines.push(`Đoán mục đích: ${purposeName} (theo lần trước). Bấm nút nếu muốn đổi.`);
    else if (purposeName) lines.push(`Mặc định: ${purposeName}. Bấm nút nếu muốn đổi.`);
    else lines.push('Chọn mục đích:');
    const keyboard = refund
      ? [...this.purposeKeyboard(tx.id, 'EXPENSE', purposes, sources, source, balances), [{ text: 'Bỏ qua (đã ghi trả thẻ)', callback_data: `hx:${tx.id}` }]]
      : result.matched
        ? []
        : this.purposeKeyboard(tx.id, tx.kind, purposes, sources, source, balances);
    await this.send(chatId, lines.join('\n'), keyboard);
    return 'done';
  }

  private async handleCallback(query: NonNullable<TelegramUpdate['callback_query']>) {
    const data = String(query.data || '');
    const chatId = query.message ? String(query.message.chat.id) : '';
    const household = chatId ? await this.prisma.household.findFirst({ where: { telegramChatId: chatId } }) : null;
    if (!household) return this.answer(query.id, 'Nhóm chưa liên kết hộ nào.');

    const purpose = /^hp:(\d+):(\d*)$/.exec(data);
    const transfer = /^ht:(\d+):(\d+)(?::([PI]))?$/.exec(data);
    const keep = /^hk:(\d+)$/.exec(data);
    const repay = /^hr:(\d+):(\d+)$/.exec(data);
    const drop = /^hx:(\d+)$/.exec(data);
    let done = '';
    if (repay) {
      const tx = await this.ledger.convertToRepayment(household.id, BigInt(repay[1]), BigInt(repay[2]));
      if (tx) done = `✓ ${tx.source.name} trả nợ ${formatMoney(Number(tx.amount))}đ → ${tx.targetSource?.name} (không tính là thu nhập)`;
    } else if (keep) {
      const tx = await this.ledger.setPurpose(household.id, BigInt(keep[1]), null);
      if (tx) done = `✓ Giữ hoàn tiền ${formatMoney(Number(tx.amount))}đ vào ${tx.source.name}`;
    } else if (drop) {
      const removed = await this.ledger.delete(household.id, BigInt(drop[1]));
      if (removed.count) done = '✓ Đã bỏ, không tính vào sổ';
    } else if (purpose) {
      const purposeId = purpose[2] ? BigInt(purpose[2]) : null;
      const tx = await this.ledger.setPurpose(household.id, BigInt(purpose[1]), purposeId);
      if (tx) done = `✓ ${tx.kind === 'INCOME' ? (tx.source.kind === 'CARD' ? 'Hoàn' : 'Thu') : 'Chi'} ${formatMoney(Number(tx.amount))}đ · ${tx.source.name} → ${tx.purpose?.name || 'Không mục đích'}`;
    } else if (transfer) {
      const part = transfer[3] === 'P' ? 'PRINCIPAL' : transfer[3] === 'I' ? 'INTEREST' : 'AUTO';
      const tx = await this.ledger.convertToTransfer(household.id, BigInt(transfer[1]), BigInt(transfer[2]), part);
      if (tx) {
        const interest = Number(tx.interest);
        const note = tx.targetSource?.kind === 'LOAN' ? (interest >= Number(tx.amount) ? ' — trả lãi, dư nợ không đổi' : interest ? ` — lãi ${formatMoney(interest)}đ, gốc ${formatMoney(Number(tx.amount) - interest)}đ` : ' — trả gốc, đã trừ dư nợ') : tx.targetSource?.kind === 'LENT' ? ' — cho vay, họ đang nợ thêm số này' : '';
        done = `✓ Chuyển ${formatMoney(Number(tx.amount))}đ · ${tx.source.name} → ${tx.targetSource?.name}${note}`;
      }
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
    await this.send(chatId, `Đã liên kết nhóm này với hộ "${household.name}". Tin ngân hàng gửi vào đây sẽ tự ghi sổ.\nId nhóm này (điền vào Apps Script): ${chatId}`);
  }

  /** Hàng nút: mục đích hợp với chiều tiền, cộng thêm "Trả thẻ X / Trả nợ Y" khi chi từ tài khoản. */
  private purposeKeyboard(
    transactionId: bigint,
    kind: string,
    purposes: HouseholdPurpose[],
    sources: HouseholdSource[],
    source: HouseholdSource,
    balances: Map<string, { balance: number }>,
  ): InlineButton[][] {
    const owed = (item: HouseholdSource) => balances.get(String(item.id))?.balance ?? 0;
    const fitting = purposes.filter((purpose) => (kind === 'INCOME' ? purpose.kind === 'INCOME' : purpose.kind !== 'INCOME'));
    const rows = chunk(
      fitting.map((purpose) => ({ text: purpose.name, callback_data: `hp:${transactionId}:${purpose.id}` })),
      2,
    );
    if (kind === 'EXPENSE' && ['BANK', 'CASH'].includes(source.kind)) {
      const buttons: InlineButton[] = [];
      for (const item of sources.filter((other) => other.id !== source.id)) {
        if (item.kind === 'CARD' && owed(item) > 0) buttons.push({ text: `Trả thẻ ${item.name}`, callback_data: `ht:${transactionId}:${item.id}` });
        else if (item.kind === 'LOAN' && owed(item) > 0) {
          // Khoản vay: gốc hay lãi là hai chuyện khác nhau — lãi chỉ mất tiền, gốc mới trừ dư nợ.
          buttons.push({ text: `Trả gốc ${item.name}`, callback_data: `ht:${transactionId}:${item.id}:P` });
          buttons.push({ text: `Trả lãi ${item.name}`, callback_data: `ht:${transactionId}:${item.id}:I` });
        } else if (item.kind === 'LENT') buttons.push({ text: `Cho vay: ${item.name}`, callback_data: `ht:${transactionId}:${item.id}` });
      }
      rows.push(...chunk(buttons, 2));
    }
    // Tiền vào tài khoản có thể là người ta trả nợ chứ không phải lương — chỉ hiện người CÒN nợ.
    if (kind === 'INCOME' && ['BANK', 'CASH'].includes(source.kind)) {
      const lent = sources.filter((item) => item.kind === 'LENT' && owed(item) > 0);
      rows.push(...chunk(lent.map((item) => ({ text: `${item.name} trả nợ`, callback_data: `hr:${transactionId}:${item.id}` })), 2));
    }
    return rows;
  }

  /**
   * Ngân hàng báo số dư sau giao dịch (Timo) thì lấy số ấy làm CHUẨN: căn lại số đầu kỳ của nguồn sao cho
   * app tính ra đúng số ngân hàng — chủ app không muốn nhập số dư đầu rồi ngồi so lệch (10/9/2026). Có
   * lệch thì nói trong dòng tóm tắt (thường là khoản ghi tay sai hoặc tin bị bỏ) chứ không báo động riêng.
   */
  private async syncBalance(householdId: bigint, source: HouseholdSource, reported: number): Promise<string> {
    const [sources, transactions] = await Promise.all([
      this.prisma.householdSource.findMany({ where: { householdId } }),
      this.prisma.householdTransaction.findMany({ where: { householdId } }),
    ]);
    const computed = sourceBalances(sources.map(toSourceRow), transactions.map(toTransactionRow)).get(String(source.id))?.balance ?? 0;
    const diff = computed - reported;
    if (Math.abs(diff) < 1) return `Số dư ${source.name}: ${formatMoney(reported)}đ`;
    const opening = await this.config.openingFor(householdId, source.id, source.kind, reported);
    await this.prisma.householdSource.updateMany({ where: { id: source.id, householdId }, data: { openingBalance: opening } });
    return `Số dư ${source.name}: ${formatMoney(reported)}đ (app đang ${diff > 0 ? 'thừa' : 'thiếu'} ${formatMoney(Math.abs(diff))}đ, đã căn lại theo ngân hàng)`;
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

/** Hash 52-bit ổn định của nội dung tin (FNV-1a) — khoá chống trùng khi không có message_id. */
export function textHash(text: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const char of String(text || '')) {
    hash ^= BigInt(char.codePointAt(0) || 0);
    hash = (hash * 0x100000001b3n) & 0xfffffffffffffn;
  }
  return hash;
}
