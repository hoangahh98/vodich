import { Injectable, Logger } from '@nestjs/common';
import { Household, HouseholdPurpose, HouseholdSource } from '@prisma/client';
import { formatMoney } from '../common/money';
import { PrismaService } from '../prisma.service';
import { ParsedBankMessage, parseBankMessage } from './bank-parsers';
import { HouseholdLedgerService } from './household-ledger.service';
import { LendingRow, SourceRow, affectsLimitOf, lendingKey, lendingLedger, sourceBalances } from './household-month';
import { toPurposeRow, toSourceRow, toTransactionRow } from './household-rows';

/** Phần của một update Telegram mà ta dùng. Bot API gửi nhiều hơn nhưng không cần khai hết. */
export interface TelegramUpdate {
  update_id?: number;
  message?: { message_id: number; text?: string; chat: { id: number | string; type?: string }; from?: { id: number }; reply_to_message?: { text?: string } };
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
  ) {}

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    try {
      if (update.callback_query) {
        await this.handleCallback(update.callback_query);
        return;
      }
      const message = update.message || update.channel_post;
      if (message?.text) await this.handleMessage(String(message.chat.id), message.message_id, message.text, update.message?.reply_to_message?.text);
    } catch (error) {
      // Webhook phải trả 200 kể cả khi lỗi, không thì Telegram gửi lại mãi cùng một tin.
      this.logger.error(`Telegram update lỗi: ${(error as Error).message}`);
    }
  }

  private async handleMessage(chatId: string, messageId: number, text: string, replyTo?: string) {
    const trimmed = text.trim();
    // Người dùng trả lời câu hỏi "Gõ tên người vay cho khoản chi #<id>" của bot → gán tên đó.
    const asked = /khoản chi #(\d+)/.exec(replyTo || '');
    if (asked && trimmed && !trimmed.startsWith('/')) {
      const household = await this.prisma.household.findFirst({ where: { telegramChatId: chatId } });
      if (!household) return;
      const name = trimmed.slice(0, 60);
      const tx = await this.ledger.setLendingPerson(household.id, BigInt(asked[1]), name);
      if (!tx) return this.send(chatId, 'Không tìm thấy khoản chi đó nữa.');
      const done = `${tx.kind === 'INCOME' ? 'Thu' : 'Chi'} ${formatMoney(Number(tx.amount))}đ · ${tx.source.name}\n✓ Cho vay ${name}. Lần sau tên này có nút sẵn.`;
      // Sửa tin tóm tắt cũ (bỏ hàng nút) nếu còn nhớ id; không thì gửi tin mới. Id thật của Telegram nhỏ,
      // còn hash chống trùng (tin cũ) là số rất lớn — không sửa nhầm.
      if (tx.telegramMsgId && tx.telegramMsgId < 2_000_000_000n) {
        const edited = await this.api('editMessageText', { chat_id: chatId, message_id: Number(tx.telegramMsgId), text: done });
        if (edited) return;
      }
      return this.send(chatId, done);
    }
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
  async ingestFromScript(chatId: string, text: string, mailId = ''): Promise<{ ok: boolean; reason?: string }> {
    const household = await this.prisma.household.findFirst({ where: { telegramChatId: chatId } });
    if (!household) return { ok: false, reason: 'Nhóm này chưa liên kết hộ nào (gõ /link <mã> trong nhóm trước).' };
    // Khoá chống trùng: id tin Gmail nếu script gửi kèm (hai mail giống hệt nhau vẫn là hai tin khác nhau),
    // không thì hash nội dung như trước.
    const outcome = await this.ingestBankText(household, chatId, textHash(mailId || text), text, mailId);
    if (outcome === 'duplicate') return { ok: true, reason: 'Tin này đã xử lý trước đó, bỏ qua.' };
    // ok = false → Apps Script CHƯA gắn nhãn "đã gửi", lần chạy sau gửi lại và bot đăng bù tin tóm tắt.
    if (outcome === 'unsent') return { ok: false, reason: 'Đã ghi sổ nhưng chưa đăng được tin lên nhóm Telegram — sẽ thử lại.' };
    return { ok: true };
  }

  /**
   * Đọc một tin ngân hàng, ghi sổ, đăng tóm tắt + nút lên nhóm. Dùng chung cho Apps Script và tin dán tay.
   * Trả 'duplicate' khi tin đã xử lý và giao dịch của nó vẫn còn; giao dịch đã bị xoá tay thì cho ghi lại
   * (chủ app xoá nhầm rồi gửi lại mail — phải ra được giao dịch mới). Trả 'unsent' khi đã ghi sổ nhưng
   * KHÔNG đăng được tin lên nhóm, để bên gọi biết mà gửi lại lần sau.
   */
  private async ingestBankText(household: Household, chatId: string, messageId: bigint, text: string, mailId = ''): Promise<'done' | 'duplicate' | 'unsent'> {
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
      // Hai mail giống hệt nhau của hai giao dịch thật chỉ khác nhau ở id tin Gmail — không kèm vào mã
      // chống trùng thì khoản thứ hai bị coi là ghi trùng và mất luôn.
      externalId: mailId ? `${parsed.externalId}:m${textHash(mailId)}` : parsed.externalId,
      // Tiền vào thẻ (mail "Biến động thanh toán") bot không hỏi gì nên coi như đã xong luôn, khỏi treo ở
      // "Cần xem lại" mãi — khoản chi thì vẫn NEW để chủ app liếc qua rồi bấm ✓ hoặc đổi mục đích.
      status: parsed.direction === 'IN' && source.kind === 'CARD' ? 'CONFIRMED' : 'NEW',
      telegramChatId: chatId,
      telegramMsgId: messageId,
      reportedBalance: parsed.balance ?? null,
      reportedAvailable: parsed.availableLimit ?? null,
    });
    await this.prisma.householdInbox.update({ where: { id: inbox.id }, data: { status: 'PARSED', transactionId: result.transaction.id } });
    // Ghi trùng thì thôi — TRỪ KHI tin tóm tắt chưa bao giờ lên được nhóm (mất TELEGRAM_BOT_TOKEN, bot bị
    // đá khỏi nhóm, Telegram lỗi). Lúc ấy sổ có khoản "cần xem lại" mà trên Telegram không có gì để bấm,
    // nên đăng bù (chủ app gặp đúng cảnh này 10/9/2026). Id tin thật của Telegram nhỏ, còn giá trị đặt lúc
    // ghi sổ là hash nội dung — số rất lớn, nhìn là biết chưa đăng.
    if (result.duplicate && isTelegramMessageId(result.transaction.telegramMsgId)) return 'duplicate';

    const purposes = await this.prisma.householdPurpose.findMany({ where: { householdId: household.id, active: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    const allTransactions = await this.prisma.householdTransaction.findMany({ where: { householdId: household.id } });
    const balances = sourceBalances(sources.map(toSourceRow), allTransactions.map(toTransactionRow));
    // Người vay đã có trong sổ (ghi bằng mục đích Cho vay) → thành nút "Cho vay: Sơn" / "Sơn trả nợ".
    const borrowers = lendingLedger(purposes.map(toPurposeRow), allTransactions.map(toTransactionRow)).rows;
    const tx = result.transaction;
    const purposeName = tx.purposeId ? purposes.find((item) => item.id === tx.purposeId)?.name : '';
    // Mail "Biến động thanh toán thẻ tín dụng" (hoàn tiền hoặc mình trả nợ thẻ): chủ app 10/9/2026 chỉ
    // muốn một dòng báo "đã hoàn tiền vào thẻ … của …", KHÔNG hỏi mục đích. Tiền vào thẻ đã tự trừ phần
    // "đã quẹt chưa trả", và nếu là lần trả thẻ thì khoản chi bên tài khoản bù lại đúng bằng số này.
    const refund = tx.kind === 'INCOME' && source.kind === 'CARD';
    const owner = source.ownerName ? ` của ${source.ownerName}` : '';
    const lines = [
      refund
        ? `Hoàn tiền vào thẻ ${source.name}${owner} +${formatMoney(Number(tx.amount))}đ · ${when}`
        : `${tx.kind === 'INCOME' ? 'Thu' : 'Chi'} ${formatMoney(Number(tx.amount))}đ · ${source.name} · ${when}`,
      parsed.description,
    ];
    const check = await this.bankCheck(household.id, source, parsed, tx.id);
    if (check) lines.push(check);
    if (refund) lines.push('Đã trừ vào phần đã quẹt chưa trả của thẻ, không cần bấm gì.');
    else if (result.matched) lines.push(`Khớp khoản định kỳ: ${result.matched.recurring.name}${purposeName ? ` → ${purposeName}` : ''}`);
    else if (result.suggestedPurposeId && purposeName) lines.push(`Đoán mục đích: ${purposeName} (theo lần trước). Bấm nút nếu muốn đổi.`);
    else if (purposeName) lines.push(`Mặc định: ${purposeName}. Bấm nút nếu muốn đổi.`);
    else lines.push('Chọn mục đích:');
    const keyboard = refund || result.matched ? [] : this.purposeKeyboard(tx.id, tx.kind, purposes, sources, source, balances, borrowers);
    // Nhớ message_id tin tóm tắt vào giao dịch để về sau còn sửa / bỏ nút (hash chống trùng đã có household_inbox lo).
    const sent = await this.send(chatId, lines.join('\n'), keyboard);
    if (!sent?.message_id) return 'unsent';
    await this.prisma.householdTransaction.updateMany({ where: { id: tx.id }, data: { telegramMsgId: BigInt(String(sent.message_id)) } });
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
    const person = /^h([lb]):(\d+):([0-9a-f]+)$/.exec(data);
    const drop = /^hx:(\d+)$/.exec(data);
    const menu = /^h([mqn]):(\d+)$/.exec(data);
    let done = '';
    if (menu) {
      const txId = BigInt(menu[2]);
      if (menu[1] === 'n') {
        // Hỏi tên bằng ForceReply: người dùng bấm trả lời tin này và gõ tên, handleMessage bắt lại theo "#id".
        await this.answer(query.id, 'Gõ tên người vay');
        await this.api('sendMessage', { chat_id: chatId, text: `Gõ tên người vay cho khoản chi #${txId} (trả lời tin này):`, reply_markup: { force_reply: true, selective: true } });
        return;
      }
      const keyboards = await this.keyboardFor(household.id, txId);
      await this.answer(query.id, keyboards ? '' : 'Không tìm thấy giao dịch');
      if (keyboards && query.message) {
        await this.api('editMessageReplyMarkup', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: menu[1] === 'm' ? keyboards.menu : keyboards.full } });
      }
      return;
    }
    if (person) {
      // Tìm lại người theo mã băm tên trong sổ cho vay hiện tại.
      const [purposes, transactions] = await Promise.all([
        this.prisma.householdPurpose.findMany({ where: { householdId: household.id } }),
        this.prisma.householdTransaction.findMany({ where: { householdId: household.id } }),
      ]);
      const row = lendingLedger(purposes.map(toPurposeRow), transactions.map(toTransactionRow)).rows.find((item) => textHash(lendingKey(item.name)).toString(16) === person[3]);
      const tx = row ? await this.ledger.setLendingPerson(household.id, BigInt(person[2]), row.name) : null;
      if (tx && row) done = person[1] === 'l' ? `✓ Cho vay ${row.name} ${formatMoney(Number(tx.amount))}đ` : `✓ ${row.name} trả nợ ${formatMoney(Number(tx.amount))}đ (không tính là thu nhập)`;
    } else if (repay) {
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
        const note = tx.targetSource?.kind === 'LOAN' ? (interest >= Number(tx.amount) ? ' — trả lãi, dư nợ không đổi' : interest ? ` — lãi ${formatMoney(interest)}đ, gốc ${formatMoney(Number(tx.amount) - interest)}đ` : ' — trả gốc, đã trừ dư nợ') : tx.targetSource?.kind === 'LENT' ? ' — cho vay, họ đang nợ thêm số này' : tx.absorbed ? ' — đã bỏ dòng hoàn tiền trùng của mail thẻ' : '';
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
    borrowers: LendingRow[] = [],
  ): InlineButton[][] {
    const owed = (item: HouseholdSource) => balances.get(String(item.id))?.balance ?? 0;
    const personCode = (row: LendingRow) => textHash(lendingKey(row.name)).toString(16);
    // Mục đích loại Cho vay không thành nút riêng: đã có menu "Cho vay…" chọn đúng người (trùng chữ gây rối).
    const fitting = purposes.filter((purpose) => (kind === 'INCOME' ? purpose.kind === 'INCOME' : purpose.kind !== 'INCOME' && purpose.kind !== 'LENDING'));
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
        }
      }
      rows.push(...chunk(buttons, 2));
      // Cho vay: một nút mở menu tên (nguồn Cho vay + tên trong sổ + Điền tên mới), thay vì liệt kê hết.
      rows.push([{ text: 'Cho vay…', callback_data: `hm:${transactionId}` }]);
    }
    // Tiền vào tài khoản có thể là người ta trả nợ chứ không phải lương — chỉ hiện người CÒN nợ.
    if (kind === 'INCOME' && ['BANK', 'CASH'].includes(source.kind)) {
      const lent = sources.filter((item) => item.kind === 'LENT' && owed(item) > 0);
      rows.push(...chunk(lent.map((item) => ({ text: `${item.name} trả nợ`, callback_data: `hr:${transactionId}:${item.id}` })), 2));
      // Người vay trong sổ còn nợ → "Sơn trả nợ". Chủ app: trả nợ chỉ hiện đúng những người đang vay.
      const owing = borrowers.filter((row) => row.outstanding > 0);
      rows.push(...chunk(owing.map((row) => ({ text: `${row.name} trả nợ`, callback_data: `hb:${transactionId}:${personCode(row)}` })), 2));
    }
    return rows;
  }

  /** Menu "Cho vay…": tên từ nguồn loại Cho vay và từ sổ cho vay, thêm "Điền tên mới" và "Quay lại". */
  private lendingMenu(transactionId: bigint, sources: HouseholdSource[], borrowers: LendingRow[]): InlineButton[][] {
    const personCode = (row: LendingRow) => textHash(lendingKey(row.name)).toString(16);
    const names: InlineButton[] = [];
    const seen = new Set<string>();
    for (const item of sources.filter((source) => source.kind === 'LENT')) {
      names.push({ text: item.name, callback_data: `ht:${transactionId}:${item.id}` });
      seen.add(lendingKey(item.name));
    }
    for (const row of borrowers) {
      if (seen.has(lendingKey(row.name))) continue;
      names.push({ text: row.name, callback_data: `hl:${transactionId}:${personCode(row)}` });
    }
    return [...chunk(names, 2), [{ text: '✏️ Điền tên mới', callback_data: `hn:${transactionId}` }, { text: '← Quay lại', callback_data: `hq:${transactionId}` }]];
  }

  /** Dựng lại bàn phím đầy đủ cho một giao dịch (khi bấm Quay lại từ menu). */
  private async keyboardFor(householdId: bigint, transactionId: bigint): Promise<{ menu: InlineButton[][]; full: InlineButton[][] } | null> {
    const tx = await this.prisma.householdTransaction.findFirst({ where: { id: transactionId, householdId }, include: { source: true } });
    if (!tx) return null;
    const [purposes, sources, transactions] = await Promise.all([
      this.prisma.householdPurpose.findMany({ where: { householdId, active: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      this.prisma.householdSource.findMany({ where: { householdId, active: true } }),
      this.prisma.householdTransaction.findMany({ where: { householdId } }),
    ]);
    const balances = sourceBalances(sources.map(toSourceRow), transactions.map(toTransactionRow));
    const borrowers = lendingLedger(purposes.map(toPurposeRow), transactions.map(toTransactionRow)).rows;
    return {
      menu: this.lendingMenu(transactionId, sources, borrowers),
      full: this.purposeKeyboard(transactionId, tx.kind, purposes, sources, tx.source, balances, borrowers),
    };
  }

  /**
   * Mail có số của ngân hàng — Timo báo SỐ DƯ tài khoản, MSB báo HẠN MỨC KHẢ DỤNG của thẻ — thì so số ấy
   * với sổ và **báo lệch**, KHÔNG tự căn lại số đầu kỳ nữa (chủ app 10/9/2026: tự bù là mất dấu khoản
   * thiếu và số tiền thật còn lại thành sai; lệch thì nói ra để chủ app thêm giao dịch tay).
   *
   * THẺ ĐÃ KHAI HẠN MỨC (chủ app 11/9/2026): hạn mức còn do SỔ tính (hạn mức khai − đã quẹt chưa trả),
   * nên so thẳng số ấy với hạn mức khả dụng trong mail này — so được ngay từ mail ĐẦU TIÊN, không phải
   * chờ có hai mail như trước.
   *
   * Thẻ CHƯA khai hạn mức và tài khoản: mốc so là mail TRƯỚC ĐÓ của chính nguồn này — từ mốc tới giờ, số
   * dư phải đổi đúng bằng dòng tiền đã ghi (thẻ thì hạn mức khả dụng giảm đúng bằng phần dư nợ tăng). Lần
   * đầu ngân hàng báo số dư cho một tài khoản thì chưa có gì để so — lấy luôn số ấy làm mốc (suy ngược số
   * đầu kỳ), vì tài khoản Timo không khai số dư bằng tay; thẻ chưa khai hạn mức thì không lấy mốc được vì
   * mail chỉ có hạn mức khả dụng.
   *
   * THẺ THÔNG (`affectsLimitOf`, quan hệ CÓ HƯỚNG): quẹt thẻ A thì hạn mức khả dụng báo trong mail của thẻ
   * B cũng đã trừ khoản ấy, nên phần quẹt tính trên cả cụm. Chưa khai mà lệch đúng bằng tiền quẹt của một
   * thẻ khác thì bot mách "hai thẻ này có vẻ thẻ thông" thay vì bắt đi tìm giao dịch thiếu.
   */
  private async bankCheck(householdId: bigint, source: HouseholdSource, parsed: ParsedBankMessage, transactionId: bigint): Promise<string> {
    const card = source.kind === 'CARD';
    const reported = card ? parsed.availableLimit : parsed.balance;
    if (reported === undefined) return '';
    const label = card ? `Hạn mức khả dụng ${source.name}` : `Số dư ${source.name}`;
    const mailSide = { OR: [{ sourceId: source.id }, { targetSourceId: source.id }] };
    const [previous, transactions, cards] = await Promise.all([
      this.prisma.householdTransaction.findFirst({
        where: { householdId, id: { not: transactionId }, ...(card ? { reportedAvailable: { not: null } } : { reportedBalance: { not: null } }), ...mailSide },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.householdTransaction.findMany({ where: { householdId } }),
      card ? this.prisma.householdSource.findMany({ where: { householdId, kind: 'CARD' } }) : Promise.resolve([]),
    ]);
    const rows = transactions.map(toTransactionRow);
    const self = toSourceRow(source);
    const flowBetween = (item: SourceRow, from: { at: Date; id: bigint } | null, to: { at: Date; id: bigint }) => {
      const inRange = rows.filter((tx) => {
        const afterFrom = !from || tx.occurredAt > from.at || (tx.occurredAt.getTime() === from.at.getTime() && BigInt(tx.id) > from.id);
        const beforeTo = tx.occurredAt < to.at || (tx.occurredAt.getTime() === to.at.getTime() && BigInt(tx.id) <= to.id);
        return afterFrom && beforeTo;
      });
      return sourceBalances([{ ...item, openingBalance: 0 }], inRange).get(item.id)?.balance ?? 0;
    };
    const now = { at: parsed.occurredAt, id: transactionId };
    const cardRows = cards.map(toSourceRow);
    // Phần hạn mức đang bị chiếm tính TỚI mail này: đã quẹt chưa trả của chính thẻ + mọi thẻ trỏ về nó.
    const limitUsedNow = () =>
      cardRows
        .filter((item) => affectsLimitOf(item, self))
        .reduce((sum, item) => sum + Math.max(0, item.openingBalance + flowBetween(item, null, now)), 0);
    if (card && Number(source.creditLimit)) {
      const ours = Number(source.creditLimit) - limitUsedNow();
      const diff = Math.round(ours - reported);
      const head = `Hạn mức còn ${source.name}: ${formatMoney(ours)}đ`;
      if (!diff) return head;
      // Lệch đúng bằng phần đã quẹt của một thẻ ngoài cụm → gần như chắc chắn quẹt thẻ ấy ăn vào thẻ này.
      const twin = cardRows.find(
        (item) => item.id !== self.id && !affectsLimitOf(item, self) && Math.round(Math.max(0, item.openingBalance + flowBetween(item, null, now))) === diff,
      );
      if (twin) {
        return `${head} (ngân hàng báo ${formatMoney(reported)}đ)
⚠ Lệch ${formatMoney(Math.abs(diff))}đ, đúng bằng phần đã quẹt chưa trả của thẻ ${twin.name} — quẹt thẻ ấy có vẻ ăn luôn vào hạn mức thẻ này (THẺ THÔNG). Vào Nguồn tiền sửa thẻ ${twin.name}, chọn "Thẻ thông của thẻ này" là ${source.name} là hết báo lệch.`;
      }
      return `${head} (ngân hàng báo ${formatMoney(reported)}đ)
⚠ Lệch ${formatMoney(Math.abs(diff))}đ — thiếu ${diff > 0 ? 'khoản quẹt thẻ' : 'khoản hoàn tiền / trả thẻ'} chưa ghi, hoặc ô Hạn mức thẻ khai chưa đúng. Vào web xem lại (app không tự bù).`;
    }
    if (!previous) {
      if (card) return `${label}: ${formatMoney(reported)}đ`;
      // Số đầu kỳ sao cho tới đúng giao dịch này sổ ra số ngân hàng báo — chỉ làm MỘT LẦN, mail sau chỉ so.
      await this.prisma.householdSource.updateMany({ where: { id: source.id, householdId }, data: { openingBalance: reported - flowBetween(self, null, now) } });
      return `${label}: ${formatMoney(reported)}đ (lấy làm mốc cho sổ)`;
    }
    const base = Number(card ? previous.reportedAvailable : previous.reportedBalance);
    const from = { at: previous.occurredAt, id: previous.id };
    // Hạn mức khả dụng của thẻ này đổi theo giao dịch của CHÍNH NÓ và của mọi thẻ khai thẻ thông là nó.
    const feeding = cardRows.filter((item) => affectsLimitOf(item, self));
    const flow = (feeding.length ? feeding : [self]).reduce((sum, item) => sum + flowBetween(item, from, now), 0);
    // Tài khoản: số dư = mốc + dòng tiền sau mốc. Thẻ: dư nợ tăng bao nhiêu thì khả dụng giảm bấy nhiêu.
    // Lệch bao nhiêu báo bấy nhiêu, không có ngưỡng bỏ qua (chủ app 10/9/2026: phải khớp từng đồng).
    const diff = Math.round((card ? base - flow : base + flowBetween(self, from, now)) - reported);
    if (!diff) return `${label}: ${formatMoney(reported)}đ`;
    // Lệch đúng bằng tiền quẹt của một thẻ khác ngoài nhóm → gần như chắc chắn hai thẻ thông nhau.
    const twin = cardRows.find((item) => item.id !== self.id && !affectsLimitOf(item, self) && Math.round(flowBetween(item, from, now)) === diff);
    if (twin) {
      return `${label}: ${formatMoney(reported)}đ
⚠ Lệch ${formatMoney(Math.abs(diff))}đ, đúng bằng tiền quẹt thẻ ${twin.name} — hai thẻ này có vẻ THẺ THÔNG (dùng chung hạn mức). Vào Nguồn tiền sửa thẻ ${source.name}, chọn "Dùng chung hạn mức với ${twin.name}" là hết báo lệch.`;
    }
    const missing = card ? (diff > 0 ? 'khoản quẹt thẻ' : 'khoản hoàn tiền / trả thẻ') : diff > 0 ? 'khoản chi' : 'khoản thu';
    return `${label}: ${formatMoney(reported)}đ
⚠ Sổ lệch ${formatMoney(Math.abs(diff))}đ so với ngân hàng — thiếu ${missing} chưa ghi. Vào web thêm giao dịch tay (app không tự bù nữa).`;
  }

  private send(chatId: string, text: string, keyboard: InlineButton[][] = []) {
    const payload: Record<string, unknown> = { chat_id: chatId, text };
    if (keyboard.length) payload.reply_markup = { inline_keyboard: keyboard };
    return this.api('sendMessage', payload);
  }

  private answer(callbackId: string, text: string) {
    return this.api('answerCallbackQuery', { callback_query_id: callbackId, text });
  }

  /**
   * Gọi Bot API bằng fetch có sẵn của Node 20. Không có token = chế độ "chỉ ghi sổ", không trả lời.
   *
   * Telegram chặn gửi dồn vào một nhóm ở khoảng 20 tin/phút: gửi cả loạt mail một lần là tin thứ 21 trở đi
   * bị 429 kèm `retry_after`. Đã dính đúng 9/9/2026 — 20 tin đầu lên nhóm, 3 khoản sau vào sổ mà không có
   * tin nào để bấm. Gặp 429 thì ĐỢI rồi gửi lại; hết lượt vẫn hỏng thì trả null, `ingestBankText` báo
   * 'unsent' để Apps Script gửi lại lần sau và bot đăng bù.
   */
  private async api(method: string, payload: Record<string, unknown>, attempt = 0): Promise<Record<string, unknown> | null> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.logger.warn(`Thiếu TELEGRAM_BOT_TOKEN, bỏ qua ${method}`);
      return null;
    }
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 300);
        const retryAfter = Number(/"retry_after":\s*(\d+)/.exec(body)?.[1] || 0);
        // Đợi tối đa 30s/lần và 2 lần: lâu hơn thì để lần script chạy sau đăng bù, khỏi treo request.
        if (response.status === 429 && retryAfter > 0 && retryAfter <= 30 && attempt < 2) {
          this.logger.warn(`Telegram ${method} bị chặn gửi dồn, đợi ${retryAfter}s rồi gửi lại`);
          await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
          return this.api(method, payload, attempt + 1);
        }
        this.logger.warn(`Telegram ${method} trả ${response.status}: ${body.slice(0, 200)}`);
        return null;
      }
      const body = (await response.json()) as { result?: Record<string, unknown> };
      return body.result || null;
    } catch (error) {
      this.logger.warn(`Telegram ${method} lỗi mạng: ${(error as Error).message}`);
      return null;
    }
  }
}

/**
 * Chọn nguồn khớp tin: cùng ngân hàng và khoá nhận diện (số tài khoản / 4 số cuối) khớp đuôi
 * nhau; không có khoá thì lấy nguồn duy nhất của ngân hàng đó (nhiều nguồn mà không khoá = mù).
 */
export function pickSource<T extends Pick<HouseholdSource, 'id' | 'name' | 'kind' | 'bank' | 'matchKey'>>(sources: T[], bank: string, accountKey: string): T | null {
  // Chỉ tài khoản / thẻ mới nhận tin ngân hàng; nguồn cũ lỡ mang bank = TIMO (tiền mặt, cho vay) không được tính.
  const candidates = sources.filter((source) => source.kind === 'BANK' || source.kind === 'CARD');
  const sameBank = candidates.filter((source) => source.bank === bank);
  const pool = sameBank.length ? sameBank : candidates.filter((source) => source.bank === 'OTHER');
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

/**
 * `telegram_msg_id` đang giữ id TIN THẬT của Telegram (đã đăng lên nhóm) hay chỉ là hash nội dung mail
 * đặt tạm lúc ghi sổ (chưa đăng được)? Id thật của Telegram nhỏ, hash là số 52-bit rất lớn.
 */
export const isTelegramMessageId = (value: bigint | null) => value !== null && value < 2_000_000_000n;

/** Hash 52-bit ổn định của nội dung tin (FNV-1a) — khoá chống trùng khi không có message_id. */
export function textHash(text: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const char of String(text || '')) {
    hash ^= BigInt(char.codePointAt(0) || 0);
    hash = (hash * 0x100000001b3n) & 0xfffffffffffffn;
  }
  return hash;
}
