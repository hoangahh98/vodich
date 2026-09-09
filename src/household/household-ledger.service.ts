import { Injectable } from '@nestjs/common';
import { HouseholdTransaction, Prisma } from '@prisma/client';
import { parseMoney } from '../common/money';
import { PrismaService } from '../prisma.service';
import { HouseholdConfigService } from './household-config.service';
import { monthOf, normalizeTxKind } from './household-enums';
import { RecurringExpectation, matchRecurring, recurringExpectations, sourceBalances } from './household-month';
import { normalizeDescription, toRecurringRow, toSourceRow, toTransactionRow } from './household-rows';

export interface TransactionInput {
  kind: string;
  sourceId: bigint;
  targetSourceId?: bigint | null;
  purposeId?: bigint | null;
  amount: number;
  interest?: number;
  occurredAt: Date;
  description?: string;
  rawText?: string | null;
  externalId?: string | null;
  status?: 'NEW' | 'CONFIRMED';
  telegramChatId?: string | null;
  telegramMsgId?: bigint | null;
  /** Số dư ngân hàng báo sau giao dịch (nếu mail có). */
  reportedBalance?: number | null;
}

export interface CreateResult {
  transaction: HouseholdTransaction;
  /** Khoản định kỳ đã tự khớp (nếu có). */
  matched: RecurringExpectation | null;
  /** Mục đích máy đoán theo lần trước cùng nội dung (chỉ khi chưa có mục đích và không khớp định kỳ). */
  suggestedPurposeId: bigint | null;
  /** Đã có giao dịch cùng `externalId` — không ghi thêm. */
  duplicate: boolean;
}

/**
 * Sổ giao dịch: ghi/sửa/xoá, gán mục đích, khớp khoản định kỳ, đoán mục đích theo lịch sử.
 * Đây là cửa vào DUY NHẤT để tạo giao dịch — form nhập tay, nút "Ghi nhận" ở khoản định kỳ và
 * webhook Telegram đều đi qua `create()` để luật khớp/đoán áp như nhau.
 */
@Injectable()
export class HouseholdLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: HouseholdConfigService,
  ) {}

  async create(householdId: bigint, input: TransactionInput): Promise<CreateResult> {
    if (input.externalId) {
      const existing = await this.prisma.householdTransaction.findFirst({ where: { householdId, externalId: input.externalId } });
      if (existing) return { transaction: existing, matched: null, suggestedPurposeId: null, duplicate: true };
    }
    const month = monthOf(input.occurredAt);
    const kind = normalizeTxKind(input.kind);
    let data: Prisma.HouseholdTransactionUncheckedCreateInput = {
      householdId,
      kind,
      sourceId: input.sourceId,
      targetSourceId: kind === 'TRANSFER' ? input.targetSourceId || null : null,
      purposeId: input.purposeId || null,
      amount: Math.max(0, Math.round(input.amount)),
      interest: kind === 'TRANSFER' ? Math.max(0, Math.round(input.interest || 0)) : 0,
      occurredAt: input.occurredAt,
      month,
      description: String(input.description || '').trim().slice(0, 255),
      rawText: input.rawText || null,
      externalId: input.externalId || null,
      status: input.status || 'CONFIRMED',
      telegramChatId: input.telegramChatId || null,
      telegramMsgId: input.telegramMsgId || null,
      reportedBalance: input.reportedBalance ?? null,
    };

    // 1) Khớp khoản định kỳ đang chờ trong tháng: trúng thì mượn luôn mục đích, loại, nguồn đích, lãi.
    const matched = matchRecurring(await this.expectationsFor(householdId, month), {
      kind,
      sourceId: String(input.sourceId),
      targetSourceId: data.targetSourceId ? String(data.targetSourceId) : null,
      amount: data.amount as number,
    });
    if (matched) {
      const recurring = matched.recurring;
      data = {
        ...data,
        recurringId: BigInt(recurring.id),
        kind: recurring.kind,
        targetSourceId: recurring.kind === 'TRANSFER' && recurring.targetSourceId ? BigInt(recurring.targetSourceId) : data.targetSourceId,
        purposeId: data.purposeId || (recurring.purposeId ? BigInt(recurring.purposeId) : null),
        interest: recurring.kind === 'TRANSFER' ? matched.interest : 0,
        status: 'CONFIRMED',
      };
    }

    // 2) Chưa có mục đích: đoán theo lần trước cùng nội dung. Vẫn để NEW để người dùng liếc qua.
    let suggestedPurposeId: bigint | null = null;
    if (!data.purposeId && !matched && data.kind === 'EXPENSE') {
      suggestedPurposeId = await this.suggestPurpose(householdId, data.description || '');
      if (suggestedPurposeId) data.purposeId = suggestedPurposeId;
    }
    // 3) Tin tự động (NEW) mà vẫn chưa có mục đích: mặc định vào Chi tiêu (mục "Khác" hoặc mục chi tiêu
    //    đầu tiên) — chủ app: không bấm gì thì cứ tính là chi tiêu, khỏi treo "chưa phân loại".
    if (!data.purposeId && data.status === 'NEW' && data.kind === 'EXPENSE') {
      data.purposeId = await this.defaultLivingPurpose(householdId);
    }

    const transaction = await this.prisma.householdTransaction.create({ data });
    return { transaction, matched, suggestedPurposeId, duplicate: false };
  }

  /** Form nhập tay ở trang giao dịch. */
  async createFromForm(householdId: bigint, form: Record<string, string | undefined>) {
    const sourceId = await this.config.ownSourceId(householdId, form.sourceId);
    if (!sourceId) return null;
    const occurredAt = parseDateInput(form.occurredAt);
    const amount = parseMoney(form.amount);
    return this.create(householdId, {
      kind: normalizeTxKind(form.kind),
      sourceId,
      targetSourceId: await this.config.ownSourceId(householdId, form.targetSourceId),
      purposeId: await this.config.ownPurposeId(householdId, form.purposeId),
      amount,
      interest: interestFromForm(form, amount),
      occurredAt,
      description: form.description,
      status: 'CONFIRMED',
    });
  }

  /** Sửa một giao dịch (form trong hàng). Không đổi externalId/rawText để vẫn chống trùng. */
  async update(householdId: bigint, transactionId: bigint, form: Record<string, string | undefined>) {
    const sourceId = await this.config.ownSourceId(householdId, form.sourceId);
    if (!sourceId) return;
    const kind = normalizeTxKind(form.kind);
    const occurredAt = parseDateInput(form.occurredAt);
    const amount = Math.max(0, parseMoney(form.amount));
    await this.prisma.householdTransaction.updateMany({
      where: { id: transactionId, householdId },
      data: {
        kind,
        sourceId,
        targetSourceId: kind === 'TRANSFER' ? await this.config.ownSourceId(householdId, form.targetSourceId) : null,
        purposeId: await this.config.ownPurposeId(householdId, form.purposeId),
        amount,
        interest: kind === 'TRANSFER' ? interestFromForm(form, amount) : 0,
        occurredAt,
        month: monthOf(occurredAt),
        description: String(form.description || '').trim().slice(0, 255),
        status: 'CONFIRMED',
      },
    });
  }

  /** Gán mục đích (từ ô chọn trong bảng hoặc nút Telegram) — coi như đã xác nhận. */
  async setPurpose(householdId: bigint, transactionId: bigint, purposeId: bigint | null) {
    await this.prisma.householdTransaction.updateMany({ where: { id: transactionId, householdId }, data: { purposeId, status: 'CONFIRMED' } });
    return this.prisma.householdTransaction.findFirst({ where: { id: transactionId, householdId }, include: { purpose: true, source: true } });
  }

  /**
   * Biến một khoản chi vừa đọc từ tin ngân hàng thành CHUYỂN NGUỒN (trả thẻ / trả nợ): người dùng
   * bấm nút "Trả thẻ MSB" trên Telegram là xong, khỏi mở web sửa. Với nguồn đích là khoản vay thì
   * lãi = lãi dự kiến của khoản định kỳ nếu khớp, không thì 0 (sửa tay sau).
   */
  async convertToTransfer(householdId: bigint, transactionId: bigint, targetSourceId: bigint, part: 'PRINCIPAL' | 'INTEREST' | 'AUTO' = 'AUTO') {
    const target = await this.prisma.householdSource.findFirst({ where: { id: targetSourceId, householdId } });
    const tx = await this.prisma.householdTransaction.findFirst({ where: { id: transactionId, householdId } });
    if (!target || !tx) return null;
    let interest = 0;
    let recurringId = tx.recurringId;
    // Trả thẻ không có mục đích (chỉ là chuyển nguồn); trả nợ vay gắn mục "Trả nợ" (loại DEBT) nếu có,
    // để bảng theo mục đích không dồn tiền trả nợ vào "Khác" (mục mặc định lúc tin về).
    let purposeId: bigint | null = target.kind === 'LOAN' ? await this.purposeOfKind(householdId, 'DEBT') : target.kind === 'LENT' ? await this.purposeOfKind(householdId, 'LENDING') : null;
    const matched = matchRecurring(
      (await this.expectationsFor(householdId, tx.month)).filter((item) => item.recurring.targetSourceId === String(targetSourceId)),
      { kind: 'TRANSFER', sourceId: String(tx.sourceId), targetSourceId: String(targetSourceId), amount: Number(tx.amount) },
    );
    if (matched) {
      interest = matched.interest;
      recurringId = BigInt(matched.recurring.id);
      purposeId = matched.recurring.purposeId ? BigInt(matched.recurring.purposeId) : purposeId;
    }
    // Người bấm nút "Trả lãi": cả khoản là lãi, dư nợ không đổi. "Trả gốc": không có lãi.
    if (target.kind === 'LOAN' && part === 'INTEREST') interest = Number(tx.amount);
    if (part === 'PRINCIPAL') interest = 0;
    await this.prisma.householdTransaction.updateMany({
      where: { id: transactionId, householdId },
      data: { kind: 'TRANSFER', targetSourceId, interest, recurringId, purposeId, status: 'CONFIRMED' },
    });
    return this.prisma.householdTransaction.findFirst({ where: { id: transactionId, householdId }, include: { purpose: true, source: true, targetSource: true } });
  }

  delete(householdId: bigint, transactionId: bigint) {
    return this.prisma.householdTransaction.deleteMany({ where: { id: transactionId, householdId } });
  }

  /**
   * Nút "Ghi nhận" trên dòng định kỳ dự kiến: tạo giao dịch đúng số dự kiến (gốc + lãi) của tháng
   * đang xem. Dùng khi tiền đi bằng đường không có tin nhắn (tiền mặt, tự động trích nợ...).
   */
  async recordExpectation(householdId: bigint, recurringId: bigint, month: string, occurredAt?: Date) {
    const expectation = (await this.expectationsFor(householdId, month)).find((item) => item.recurring.id === String(recurringId));
    if (!expectation || expectation.paid) return null;
    const recurring = expectation.recurring;
    if (!recurring.sourceId) return null;
    const transaction = await this.prisma.householdTransaction.create({
      data: {
        householdId,
        kind: recurring.kind,
        sourceId: BigInt(recurring.sourceId),
        targetSourceId: recurring.kind === 'TRANSFER' && recurring.targetSourceId ? BigInt(recurring.targetSourceId) : null,
        purposeId: recurring.purposeId ? BigInt(recurring.purposeId) : null,
        recurringId,
        amount: expectation.expected,
        interest: recurring.kind === 'TRANSFER' ? expectation.interest : 0,
        occurredAt: occurredAt || expectation.dueDate,
        month,
        description: recurring.name,
        status: 'CONFIRMED',
      },
    });
    return transaction;
  }

  /** Mục đích đầu tiên đang dùng của một loại (bộ mặc định có "Trả nợ vay" loại DEBT, "Cho vay" loại LENDING). */
  async purposeOfKind(householdId: bigint, kind: string): Promise<bigint | null> {
    const purpose = await this.prisma.householdPurpose.findFirst({ where: { householdId, kind, active: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    return purpose?.id || null;
  }

  /**
   * Tiền VÀO tài khoản mà là người ta trả nợ (bấm nút "<tên> trả nợ" trên Telegram): đổi khoản thu thành
   * CHUYỂN từ khoản cho vay về tài khoản — không phải thu nhập, chỉ là tiền quay về, khoản cho vay giảm.
   */
  async convertToRepayment(householdId: bigint, transactionId: bigint, lentSourceId: bigint) {
    const lent = await this.prisma.householdSource.findFirst({ where: { id: lentSourceId, householdId, kind: 'LENT' } });
    const tx = await this.prisma.householdTransaction.findFirst({ where: { id: transactionId, householdId } });
    if (!lent || !tx) return null;
    await this.prisma.householdTransaction.updateMany({
      where: { id: transactionId, householdId },
      data: { kind: 'TRANSFER', sourceId: lentSourceId, targetSourceId: tx.sourceId, interest: 0, purposeId: await this.purposeOfKind(householdId, 'LENDING'), status: 'CONFIRMED' },
    });
    return this.prisma.householdTransaction.findFirst({ where: { id: transactionId, householdId }, include: { purpose: true, source: true, targetSource: true } });
  }

  /** Mục chi tiêu mặc định: "Khác" nếu có, không thì mục LIVING đầu tiên đang dùng. */
  async defaultLivingPurpose(householdId: bigint): Promise<bigint | null> {
    const living = await this.prisma.householdPurpose.findMany({ where: { householdId, kind: 'LIVING', active: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    const other = living.find((purpose) => /^khác$/i.test(purpose.name.trim()));
    return (other || living[0])?.id || null;
  }

  /** Mục đích của lần gần nhất có cùng nội dung (đã xác nhận). Null nếu chưa từng thấy. */
  async suggestPurpose(householdId: bigint, description: string): Promise<bigint | null> {
    const key = normalizeDescription(description);
    if (key.length < 3) return null;
    const recent = await this.prisma.householdTransaction.findMany({
      where: { householdId, kind: 'EXPENSE', status: 'CONFIRMED', purposeId: { not: null } },
      orderBy: { id: 'desc' },
      take: 300,
      select: { description: true, purposeId: true },
    });
    const hit = recent.find((tx) => normalizeDescription(tx.description) === key);
    return hit?.purposeId || null;
  }

  /** Dòng định kỳ dự kiến của một tháng (tính dư nợ đầu tháng để ra lãi). */
  async expectationsFor(householdId: bigint, month: string): Promise<RecurringExpectation[]> {
    const [sources, recurrings, transactions] = await Promise.all([
      this.prisma.householdSource.findMany({ where: { householdId } }),
      this.prisma.householdRecurring.findMany({ where: { householdId, active: true } }),
      this.prisma.householdTransaction.findMany({ where: { householdId, month: { lte: month } } }),
    ]);
    const txRows = transactions.map(toTransactionRow);
    const sourceRows = sources.map(toSourceRow);
    const balancesAtStart = sourceBalances(sourceRows, txRows.filter((tx) => tx.month < month));
    return recurringExpectations(month, recurrings.map(toRecurringRow), balancesAtStart, txRows.filter((tx) => tx.month === month));
  }
}

/** `datetime-local` hoặc `date` từ form (giờ VN). Trống/hỏng thì lấy hiện tại. */
export function parseDateInput(raw: string | undefined): Date {
  const value = String(raw || '').trim();
  if (!value) return new Date();
  const date = new Date(/T\d{2}:\d{2}/.test(value) ? `${value}:00+07:00` : `${value}T12:00:00+07:00`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/**
 * Phần lãi của một khoản chuyển theo ô "Khoản chuyển này là": Trả gốc → 0 (cả khoản trừ dư nợ), Trả lãi
 * → cả khoản (dư nợ không đổi, chỉ mất tiền), Gốc + lãi → số nhập tay, không quá tổng.
 */
export function interestFromForm(form: Record<string, string | undefined>, amount: number): number {
  const part = String(form.debtPart || 'MIXED');
  if (part === 'PRINCIPAL') return 0;
  if (part === 'INTEREST') return Math.max(0, amount);
  return Math.min(Math.max(0, parseMoney(form.interest)), Math.max(0, amount));
}
