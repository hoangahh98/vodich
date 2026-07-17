import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ParsedVpbankTxn } from './household-parser';

const CONFIG_ID = 1;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface HouseholdSummary {
  weeklyBudget: number;
  monthlySavings: number;
  weeksElapsed: number;
  monthsElapsed: number;
  spentThisWeek: number;
  spentThisMonth: number;
  spentTotal: number;
  potBalance: number; // số dư chi tiêu còn lại (cộng dồn phần dư qua các tuần)
  currentShortfall: number; // đang lẹm vào tiết kiệm (>0 nghĩa là đang âm)
  savingsAccrued: number; // tiết kiệm lũy kế còn lại (sau khi trừ các lần bù)
  savingsTopupTotal: number; // tổng đã bù từ tiết kiệm sang chi tiêu
  pendingNoteCount: number;
}

/**
 * Nghiệp vụ module chi tiêu: cấu hình, tài khoản, giao dịch và SỔ TIỀN.
 *
 * Mô hình tiền (đã chốt với người dùng):
 * - Ngân sách tuần được "nạp" mỗi tuần và CỘNG DỒN phần dư (rollover).
 * - Số dư chi tiêu (potBalance) = Σ ngân sách tuần đã tới + Σ khoản bù từ tiết kiệm − Σ chi tiêu.
 * - Khi potBalance < 0 ⇒ đã lẹm vào tiết kiệm ⇒ TỰ tạo 1 khoản "bù từ tiết kiệm"
 *   (needsNote=true) để kéo số dư về 0 và giảm tiết kiệm, đồng thời BẮT người dùng ghi chú.
 * - Tiết kiệm tháng cộng dồn theo số tháng đã trôi qua kể từ mốc bắt đầu (anchorDate).
 */
@Injectable()
export class HouseholdService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Cấu hình (singleton id = 1) ───
  async getConfig() {
    const existing = await this.prisma.householdConfig.findUnique({ where: { id: CONFIG_ID } });
    if (existing) return existing;
    return this.prisma.householdConfig.create({ data: { id: CONFIG_ID } });
  }

  async updateConfig(body: Record<string, string>) {
    const weekStartDow = clampInt(body.weekStartDow, 0, 6, 1);
    const anchor = parseDateOnly(body.anchorDate);
    await this.prisma.householdConfig.upsert({
      where: { id: CONFIG_ID },
      create: {
        id: CONFIG_ID,
        weeklyBudget: BigInt(parseVnd(body.weeklyBudget)),
        monthlySavings: BigInt(parseVnd(body.monthlySavings)),
        weekStartDow,
        ...(anchor ? { anchorDate: anchor } : {}),
      },
      update: {
        weeklyBudget: BigInt(parseVnd(body.weeklyBudget)),
        monthlySavings: BigInt(parseVnd(body.monthlySavings)),
        weekStartDow,
        ...(anchor ? { anchorDate: anchor } : {}),
      },
    });
    await this.reconcileShortfall();
  }

  // ─── Tài khoản của nhà (gắn nhãn Chồng/Vợ) ───
  listAccounts() {
    return this.prisma.householdAccount.findMany({ orderBy: { id: 'asc' } });
  }

  async addAccount(body: Record<string, string>) {
    const accountNumber = String(body.accountNumber || '').replace(/\s/g, '').slice(0, 40);
    const ownerLabel = String(body.ownerLabel || '').trim().slice(0, 80);
    if (!accountNumber || !ownerLabel) return;
    const kind = body.kind === 'savings' ? 'savings' : 'spending';
    await this.prisma.householdAccount.upsert({
      where: { accountNumber },
      create: { accountNumber, ownerLabel, kind },
      update: { ownerLabel, kind },
    });
  }

  async deleteAccount(id: bigint) {
    await this.prisma.householdAccount.delete({ where: { id } }).catch(() => undefined);
  }

  // ─── Giao dịch ───
  listTxns(limit = 200) {
    return this.prisma.householdTxn.findMany({ orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: limit });
  }

  /** Lưu các giao dịch parse được từ email; upsert theo txnCode để chống trùng. Trả về số dòng mới. */
  async saveParsedTxns(parsed: ParsedVpbankTxn[]): Promise<number> {
    let added = 0;
    for (const txn of parsed) {
      const existing = await this.prisma.householdTxn.findUnique({ where: { txnCode: txn.txnCode } });
      if (existing) continue;
      await this.prisma.householdTxn.create({
        data: {
          txnCode: txn.txnCode,
          occurredAt: txn.occurredAt,
          performedBy: txn.performedBy,
          debitAccount: txn.debitAccount,
          creditAccount: txn.creditAccount,
          beneficiary: txn.beneficiary,
          amount: BigInt(Math.max(0, Math.round(txn.amount))),
          fee: BigInt(Math.max(0, Math.round(txn.fee))),
          description: txn.description,
          category: 'spending',
        },
      });
      added += 1;
    }
    if (added) await this.reconcileShortfall();
    return added;
  }

  /** Đổi phân loại 1 giao dịch (spending ↔ excluded). Khi loại trừ cần ghi chú lý do. */
  async setTxnCategory(id: bigint, category: string, note?: string) {
    const value = category === 'excluded' ? 'excluded' : 'spending';
    await this.prisma.householdTxn.update({
      where: { id },
      data: { category: value, note: note?.trim() ? note.trim() : null },
    });
    await this.reconcileShortfall();
  }

  // ─── Sổ tiết kiệm ───
  listSavingsEntries(limit = 100) {
    return this.prisma.householdSavingsEntry.findMany({ orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: limit });
  }

  pendingNoteEntries() {
    return this.prisma.householdSavingsEntry.findMany({ where: { needsNote: true }, orderBy: { id: 'asc' } });
  }

  /** Ghi chú cho một lần "lẹm tiết kiệm" đã tự tạo (bắt buộc có nội dung). */
  async acknowledgeSavings(id: bigint, note: string) {
    const text = String(note || '').trim();
    if (!text) return;
    await this.prisma.householdSavingsEntry.update({ where: { id }, data: { note: text.slice(0, 500), needsNote: false } });
  }

  /** Điều chỉnh tiết kiệm thủ công (nạp thêm / rút bớt), amount có thể âm. */
  async adjustSavings(body: Record<string, string>) {
    const amount = parseVnd(body.amount, true);
    const note = String(body.note || '').trim().slice(0, 500);
    if (!amount) return;
    await this.prisma.householdSavingsEntry.create({ data: { kind: 'adjust', amount: BigInt(amount), note, needsNote: false } });
  }

  /**
   * Đồng bộ trạng thái "lẹm tiết kiệm": xoá khoản bù tự động đang chờ, tính lại số dư,
   * nếu còn âm thì tạo lại đúng 1 khoản bù bằng phần âm (needsNote=true). Idempotent.
   */
  async reconcileShortfall() {
    const config = await this.getConfig();
    const weeklyBudget = Number(config.weeklyBudget);
    if (weeklyBudget <= 0) return; // chưa cấu hình ngân sách thì chưa tính lẹm

    await this.prisma.householdSavingsEntry.deleteMany({ where: { kind: 'topup', needsNote: true } });

    const [spending, ackTopups] = await Promise.all([
      this.sumSpending(),
      this.sumTopups(false),
    ]);
    const weeks = weeksElapsed(config.anchorDate, config.weekStartDow, new Date());
    const baseBalance = weeks * weeklyBudget + ackTopups - spending;
    if (baseBalance < 0) {
      await this.prisma.householdSavingsEntry.create({
        data: { kind: 'topup', amount: BigInt(-baseBalance), note: '', needsNote: true },
      });
    }
  }

  // ─── Tổng hợp cho dashboard ───
  async summary(): Promise<HouseholdSummary> {
    const now = new Date();
    const config = await this.getConfig();
    const weeklyBudget = Number(config.weeklyBudget);
    const monthlySavings = Number(config.monthlySavings);
    const weeks = weeksElapsed(config.anchorDate, config.weekStartDow, now);
    const months = monthsElapsed(config.anchorDate, now);

    const txns = await this.prisma.householdTxn.findMany({ where: { category: 'spending' }, select: { amount: true, occurredAt: true } });
    const wkStart = weekStart(now, config.weekStartDow);
    const moStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let spentThisWeek = 0;
    let spentThisMonth = 0;
    let spentTotal = 0;
    for (const t of txns) {
      const amt = Number(t.amount);
      spentTotal += amt;
      if (t.occurredAt >= wkStart) spentThisWeek += amt;
      if (t.occurredAt >= moStart) spentThisMonth += amt;
    }

    const topupTotal = await this.sumTopups(); // gồm cả đang chờ ghi chú
    const adjustTotal = await this.sumAdjust();
    const potBalance = weeks * weeklyBudget + topupTotal - spentTotal;
    const savingsAccrued = months * monthlySavings + adjustTotal - topupTotal;
    const pendingNoteCount = await this.prisma.householdSavingsEntry.count({ where: { needsNote: true } });

    return {
      weeklyBudget,
      monthlySavings,
      weeksElapsed: weeks,
      monthsElapsed: months,
      spentThisWeek,
      spentThisMonth,
      spentTotal,
      potBalance,
      currentShortfall: potBalance < 0 ? -potBalance : 0,
      savingsAccrued,
      savingsTopupTotal: topupTotal,
      pendingNoteCount,
    };
  }

  async uncategorizedCount() {
    return this.prisma.householdTxn.count({ where: { category: 'spending', debitAccount: '' } });
  }

  private async sumSpending(): Promise<number> {
    const agg = await this.prisma.householdTxn.aggregate({ _sum: { amount: true }, where: { category: 'spending' } });
    return Number(agg._sum.amount ?? 0);
  }

  private async sumTopups(includePending = true): Promise<number> {
    const where = includePending ? { kind: 'topup' } : { kind: 'topup', needsNote: false };
    const agg = await this.prisma.householdSavingsEntry.aggregate({ _sum: { amount: true }, where });
    return Number(agg._sum.amount ?? 0);
  }

  private async sumAdjust(): Promise<number> {
    const agg = await this.prisma.householdSavingsEntry.aggregate({ _sum: { amount: true }, where: { kind: 'adjust' } });
    return Number(agg._sum.amount ?? 0);
  }
}

// ─── Helpers thời gian & số ───

/** Đầu tuần (nửa đêm địa phương) chứa ngày `d`, theo thứ bắt đầu tuần `startDow` (0=CN..6=T7). */
function weekStart(d: Date, startDow: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (x.getDay() - startDow + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

/** Số lần "nạp ngân sách tuần" đã diễn ra từ mốc bắt đầu đến `now` (tuần chứa mốc tính là 1). */
function weeksElapsed(anchor: Date, startDow: number, now: Date): number {
  const wsAnchor = weekStart(anchor, startDow).getTime();
  const wsNow = weekStart(now, startDow).getTime();
  return Math.max(0, Math.floor((wsNow - wsAnchor) / WEEK_MS) + 1);
}

/** Số tháng đã trôi qua từ mốc bắt đầu đến `now` (tháng chứa mốc tính là 1). */
function monthsElapsed(anchor: Date, now: Date): number {
  const diff = (now.getFullYear() - anchor.getFullYear()) * 12 + (now.getMonth() - anchor.getMonth()) + 1;
  return Math.max(0, diff);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Parse tiền VND về số nguyên. allowNegative=true cho phép dấu âm (điều chỉnh tiết kiệm). */
function parseVnd(value: unknown, allowNegative = false): number {
  const raw = String(value ?? '');
  const negative = allowNegative && /-/.test(raw);
  const digits = raw.replace(/[^\d]/g, '');
  const n = digits ? Number.parseInt(digits, 10) : 0;
  return negative ? -n : n;
}

function parseDateOnly(value: unknown): Date | null {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
