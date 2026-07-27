import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

const CONFIG_ID = 1;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOCATION_KINDS = ['savings', 'debt', 'other'] as const;
const CYCLES = ['weekly', 'monthly'] as const;

export interface MemberWallet {
  id: bigint;
  name: string;
  active: boolean;
  cycle: string; // weekly | monthly
  allowance: number; // tiền cầm tay mỗi kỳ
  weeklyBudget: number; // ngân sách nhà dành ra mỗi tuần cho người này
  hasOwnRate: boolean;
  startedOn: Date;
  weeks: number; // số tuần nhà đã dành ngân sách
  months: number; // số tháng đã trôi (chỉ có nghĩa với cycle = monthly)
  budgetTotal: number; // tổng ngân sách đã trích khỏi quỹ chung cho người này
  periodLabel: string; // "Tuần này" | "Tháng này"
  rollover: boolean; // true = số dư dồn sang kỳ sau (chỉ cycle = monthly)
  handedTotal: number; // tổng tiền đã cầm tay (cycle = monthly thì cộng dồn qua các tháng)
  spentThisPeriod: number;
  remaining: number; // weekly: mức tuần − chi tuần này · monthly: Σ đã nhận − Σ đã tiêu
  spentTotal: number;
  overspend: number; // phần vượt mà QUỸ CHUNG phải bù
  kidSavings: number; // quỹ tiết kiệm riêng còn lại (chỉ cycle = monthly)
  kidShortfall: number; // phần con đã tiêu lẹm vào quỹ tiết kiệm của mình
}

export interface HouseholdSummary {
  defaultWeeklyAllowance: number;
  weekStartDow: number;
  anchorDate: Date;
  wallets: MemberWallet[];
  weeklyPayout: number; // ngân sách tiền tiêu cả nhà mỗi tuần
  totalIncome: number;
  manualAllocation: number; // các khoản trích nhập tay
  savingsTotal: number;
  debtTotal: number;
  otherAllocationTotal: number;
  allowanceBudget: number; // tiền tiêu đã trích khỏi quỹ chung (mọi thành viên)
  kidSavingsTotal: number; // phần đang nằm trong quỹ tiết kiệm của con
  commonSpent: number;
  overspendTotal: number; // nhà đã phải bù thêm khi ai đó tiêu quá ví
  potBalance: number;
  spentThisWeek: number;
  spentThisMonth: number;
  spentTotal: number;
}

export interface MonthBook {
  month: string; // YYYY-MM
  incomes: Array<{ id: bigint; source: string; amount: bigint; note: string }>;
  allocations: Array<{ id: bigint; kind: string; name: string; amount: bigint; note: string }>;
  incomeTotal: number;
  allocationTotal: number; // trích tay + tiền tiêu tự trích
  manualAllocationTotal: number;
  allowanceCost: number; // tiền tiêu cả nhà của tháng này (tự trích)
  weeksInMonth: number;
  leftover: number;
  months: string[];
}

/**
 * Nghiệp vụ module chi tiêu gia đình — sổ NHẬP TAY, không quét email.
 *
 * Mô hình tiền (đã chốt với người dùng):
 * - Lương 2 vợ chồng (và thu khác) gộp vào QUỸ CHUNG theo tháng.
 * - Mỗi tháng trích ra các khoản cố định: tiết kiệm, trả nợ, khoản khác (nhập tay).
 * - Tiền tiêu của cả nhà TỰ trích khỏi quỹ chung: mỗi đầu tuần dành ra mức tuần chuẩn
 *   (mặc định 500k) cho từng thành viên.
 * - cycle = weekly (vợ chồng): ví KHÔNG cộng dồn — đầu tuần nạp lại đủ mức, số dư tuần cũ
 *   bị xoá. Tiêu quá mức tuần thì phần vượt NHÀ bù ⇒ trừ tiếp vào quỹ chung.
 * - cycle = monthly (con): tiền cầm tay CỘNG DỒN qua các tháng (thừa để sang tháng sau).
 *   Phần ngân sách tuần nhà dành mà con chưa cầm tay là QUỸ TIẾT KIỆM CỦA CON. Con tiêu quá
 *   phần cầm tay thì lẹm dần vào chính quỹ đó (tiết kiệm ít đi); hết quỹ mới đến lượt nhà bù.
 * - Khoản chi gắn với 1 người ⇒ trừ ví người đó; không gắn ai ⇒ chi chung, trừ quỹ chung.
 *
 * Quỹ chung còn lại = Σ thu − Σ trích tay − Σ tiền tiêu đã trích − Σ chi chung − Σ tiêu vượt ví.
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
    const weeklyAllowance = BigInt(parseVnd(body.weeklyAllowance));
    await this.prisma.householdConfig.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID, weeklyAllowance, weekStartDow, ...(anchor ? { anchorDate: anchor } : {}) },
      update: { weeklyAllowance, weekStartDow, ...(anchor ? { anchorDate: anchor } : {}) },
    });
  }

  // ─── Thành viên nhận tiền tiêu ───
  listMembers() {
    return this.prisma.householdMember.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  }

  async addMember(body: Record<string, string>) {
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) return;
    const config = await this.getConfig();
    const startedOn = parseDateOnly(body.startedOn) ?? config.anchorDate;
    const last = await this.prisma.householdMember.findFirst({ orderBy: { sortOrder: 'desc' } });
    await this.prisma.householdMember.create({
      data: {
        name,
        cycle: normalizeCycle(body.cycle),
        allowance: ownAllowance(body.allowance, config.weeklyAllowance),
        startedOn,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
  }

  async updateMember(id: bigint, body: Record<string, string>) {
    const member = await this.prisma.householdMember.findUnique({ where: { id } });
    if (!member) return;
    const config = await this.getConfig();
    const name = String(body.name || '').trim().slice(0, 80);
    const startedOn = parseDateOnly(body.startedOn);
    await this.prisma.householdMember.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        cycle: body.cycle === undefined ? member.cycle : normalizeCycle(body.cycle),
        allowance: ownAllowance(body.allowance, config.weeklyAllowance),
        ...(startedOn ? { startedOn } : {}),
        active: body.active === undefined ? member.active : body.active === 'on' || body.active === 'true',
      },
    });
  }

  /** Xoá thành viên; các khoản chi của người đó chuyển thành "chi chung" (FK SetNull). */
  async deleteMember(id: bigint) {
    await this.prisma.householdMember.delete({ where: { id } }).catch(() => undefined);
  }

  // ─── Thu nhập & phân bổ theo tháng ───
  async monthBook(rawMonth?: string): Promise<MonthBook> {
    const month = normalizeMonth(rawMonth) ?? currentMonth();
    const config = await this.getConfig();
    const [incomes, allocations, incomeMonths, allocMonths, members] = await Promise.all([
      this.prisma.householdIncome.findMany({ where: { month }, orderBy: { id: 'asc' } }),
      this.prisma.householdAllocation.findMany({ where: { month }, orderBy: { id: 'asc' } }),
      this.prisma.householdIncome.findMany({ distinct: ['month'], select: { month: true } }),
      this.prisma.householdAllocation.findMany({ distinct: ['month'], select: { month: true } }),
      this.listMembers(),
    ]);

    // Tiền tiêu của tháng = Σ (mức tuần chuẩn × số tuần của tháng mà người đó được nhận).
    const weekStarts = weekStartsInMonth(month, config.weekStartDow);
    const allowanceCost = members.reduce((total, m) => {
      if (!m.active) return total;
      const from = weekStart(effectiveStart(m.startedOn, config.anchorDate), config.weekStartDow);
      const weeks = weekStarts.filter((ws) => ws >= from).length;
      return total + weeks * weeklyBudgetOf(m, config.weeklyAllowance);
    }, 0);

    const incomeTotal = sumAmount(incomes);
    const manualAllocationTotal = sumAmount(allocations);
    const months = Array.from(new Set([...incomeMonths, ...allocMonths].map((r) => r.month).concat(month))).sort().reverse();

    return {
      month,
      incomes: incomes.map((i) => ({ id: i.id, source: i.source, amount: i.amount, note: i.note })),
      allocations: allocations.map((a) => ({ id: a.id, kind: a.kind, name: a.name, amount: a.amount, note: a.note })),
      incomeTotal,
      allocationTotal: manualAllocationTotal + allowanceCost,
      manualAllocationTotal,
      allowanceCost,
      weeksInMonth: weekStarts.length,
      leftover: incomeTotal - manualAllocationTotal - allowanceCost,
      months,
    };
  }

  async addIncome(body: Record<string, string>) {
    const month = normalizeMonth(body.month) ?? currentMonth();
    const source = String(body.source || '').trim().slice(0, 80);
    const amount = parseVnd(body.amount);
    if (!source || amount <= 0) return month;
    await this.prisma.householdIncome.create({
      data: { month, source, amount: BigInt(amount), note: String(body.note || '').trim().slice(0, 500) },
    });
    return month;
  }

  async deleteIncome(id: bigint) {
    const row = await this.prisma.householdIncome.findUnique({ where: { id } });
    await this.prisma.householdIncome.delete({ where: { id } }).catch(() => undefined);
    return row?.month ?? currentMonth();
  }

  async addAllocation(body: Record<string, string>) {
    const month = normalizeMonth(body.month) ?? currentMonth();
    const name = String(body.name || '').trim().slice(0, 80);
    const amount = parseVnd(body.amount);
    if (!name || amount <= 0) return month;
    await this.prisma.householdAllocation.create({
      data: {
        month,
        kind: (ALLOCATION_KINDS as readonly string[]).includes(body.kind) ? body.kind : 'other',
        name,
        amount: BigInt(amount),
        note: String(body.note || '').trim().slice(0, 500),
      },
    });
    return month;
  }

  async deleteAllocation(id: bigint) {
    const row = await this.prisma.householdAllocation.findUnique({ where: { id } });
    await this.prisma.householdAllocation.delete({ where: { id } }).catch(() => undefined);
    return row?.month ?? currentMonth();
  }

  /**
   * Chép các khoản trích của tháng trước sang tháng đang xem (bỏ qua khoản đã có
   * cùng tên) — các khoản tiết kiệm / trả nợ thường lặp lại y hệt mỗi tháng.
   */
  async copyAllocationsFromPreviousMonth(rawMonth?: string): Promise<{ month: string; copied: number }> {
    const month = normalizeMonth(rawMonth) ?? currentMonth();
    const previous = previousMonth(month);
    const [source, existing] = await Promise.all([
      this.prisma.householdAllocation.findMany({ where: { month: previous }, orderBy: { id: 'asc' } }),
      this.prisma.householdAllocation.findMany({ where: { month }, select: { name: true } }),
    ]);
    const taken = new Set(existing.map((a) => a.name.toLowerCase()));
    const fresh = source.filter((a) => !taken.has(a.name.toLowerCase()));
    if (fresh.length) {
      await this.prisma.householdAllocation.createMany({
        data: fresh.map((a) => ({ month, kind: a.kind, name: a.name, amount: a.amount, note: a.note })),
      });
    }
    return { month, copied: fresh.length };
  }

  // ─── Chi tiêu ───
  listTxns(limit = 200) {
    return this.prisma.householdTxn.findMany({
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: { member: { select: { name: true } } },
    });
  }

  async addTxn(body: Record<string, string>) {
    const amount = parseVnd(body.amount);
    if (amount <= 0) return;
    await this.prisma.householdTxn.create({
      data: {
        occurredAt: parseDateOnly(body.occurredAt) ?? new Date(),
        memberId: parseOptionalBigInt(body.memberId),
        amount: BigInt(amount),
        description: String(body.description || '').trim().slice(0, 500),
      },
    });
  }

  /** Sửa một khoản chi = xoá rồi nhập lại (giống module đội bóng), nên không có updateTxn. */
  async deleteTxn(id: bigint) {
    await this.prisma.householdTxn.delete({ where: { id } }).catch(() => undefined);
  }

  // ─── Tổng hợp cho dashboard ───
  async summary(): Promise<HouseholdSummary> {
    const now = new Date();
    const config = await this.getConfig();
    const defaultAllowance = Number(config.weeklyAllowance);

    const [members, txns, incomeAgg, allocations] = await Promise.all([
      this.listMembers(),
      this.prisma.householdTxn.findMany({ select: { amount: true, memberId: true, occurredAt: true } }),
      this.prisma.householdIncome.aggregate({ _sum: { amount: true } }),
      this.prisma.householdAllocation.findMany({ select: { kind: true, amount: true } }),
    ]);

    const wkStart = weekStart(now, config.weekStartDow);
    const moStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Gom chi tiêu của từng người theo KỲ để tính ví (không cộng dồn) và phần tiêu lẹm.
    const spentByMemberPeriod = new Map<string, Map<string, number>>();
    const spentByMember = new Map<string, number>();
    let commonSpent = 0;
    let spentThisWeek = 0;
    let spentThisMonth = 0;
    let spentTotal = 0;
    const cycleOf = new Map(members.map((m) => [String(m.id), m.cycle]));
    for (const t of txns) {
      const amount = Number(t.amount);
      spentTotal += amount;
      if (t.occurredAt >= wkStart) spentThisWeek += amount;
      if (t.occurredAt >= moStart) spentThisMonth += amount;
      if (t.memberId === null) {
        commonSpent += amount;
        continue;
      }
      const key = String(t.memberId);
      spentByMember.set(key, (spentByMember.get(key) ?? 0) + amount);
      const period = cycleOf.get(key) === 'monthly' ? monthKey(t.occurredAt) : dateKey(weekStart(t.occurredAt, config.weekStartDow));
      const byPeriod = spentByMemberPeriod.get(key) ?? new Map<string, number>();
      byPeriod.set(period, (byPeriod.get(period) ?? 0) + amount);
      spentByMemberPeriod.set(key, byPeriod);
    }

    const wallets: MemberWallet[] = members.map((m) => {
      const key = String(m.id);
      const monthly = m.cycle === 'monthly';
      const weeklyBudget = weeklyBudgetOf(m, config.weeklyAllowance);
      const allowance = Number(m.allowance ?? config.weeklyAllowance);
      const from = effectiveStart(m.startedOn, config.anchorDate);
      const weeks = m.active ? countWeeks(from, config.weekStartDow, now) : 0;
      const months = m.active ? countMonths(from, now) : 0;

      const byPeriod = spentByMemberPeriod.get(key) ?? new Map<string, number>();
      const currentPeriod = monthly ? monthKey(now) : dateKey(wkStart);
      const spentThisPeriod = byPeriod.get(currentPeriod) ?? 0;
      const spentTotal = spentByMember.get(key) ?? 0;
      const budgetTotal = weeks * weeklyBudget;

      // Con (monthly): tiền cầm tay CỘNG DỒN qua các tháng — thừa thì để sang tháng sau.
      // Người lớn (weekly): mỗi tuần nạp lại, số dư tuần cũ bị xoá.
      const handedTotal = monthly ? months * allowance : weeks * allowance;
      const remaining = monthly ? handedTotal - spentTotal : allowance - spentThisPeriod;

      // Nhà dành mức tuần chuẩn nhưng con chỉ cầm tay mức tháng ⇒ phần chênh là quỹ của con.
      // Con tiêu quá phần cầm tay thì lẹm dần vào chính quỹ đó; hết quỹ mới đến lượt nhà bù.
      const savingsBase = monthly ? Math.max(0, budgetTotal - handedTotal) : 0;
      const kidShortfall = monthly ? Math.max(0, spentTotal - handedTotal) : 0;

      return {
        id: m.id,
        name: m.name,
        active: m.active,
        cycle: m.cycle,
        allowance,
        weeklyBudget,
        hasOwnRate: m.allowance !== null,
        startedOn: m.startedOn,
        weeks,
        months,
        budgetTotal,
        periodLabel: monthly ? 'Tháng này' : 'Tuần này',
        rollover: monthly,
        handedTotal,
        spentThisPeriod,
        remaining,
        spentTotal,
        overspend: monthly
          ? Math.max(0, kidShortfall - savingsBase) // vượt cả quỹ tiết kiệm của con
          : [...byPeriod.values()].reduce((total, spent) => total + Math.max(0, spent - allowance), 0),
        kidSavings: Math.max(0, savingsBase - kidShortfall),
        kidShortfall: Math.min(kidShortfall, savingsBase),
      };
    });

    const totalIncome = Number(incomeAgg._sum.amount ?? 0);
    const savingsTotal = sumAllocation(allocations, 'savings');
    const debtTotal = sumAllocation(allocations, 'debt');
    const otherAllocationTotal = sumAllocation(allocations, 'other');
    const manualAllocation = savingsTotal + debtTotal + otherAllocationTotal;
    const allowanceBudget = wallets.reduce((total, w) => total + w.budgetTotal, 0);
    const overspendTotal = wallets.reduce((total, w) => total + w.overspend, 0);

    return {
      defaultWeeklyAllowance: defaultAllowance,
      weekStartDow: config.weekStartDow,
      anchorDate: config.anchorDate,
      wallets,
      weeklyPayout: wallets.filter((w) => w.active).reduce((total, w) => total + w.weeklyBudget, 0),
      totalIncome,
      manualAllocation,
      savingsTotal,
      debtTotal,
      otherAllocationTotal,
      allowanceBudget,
      kidSavingsTotal: wallets.reduce((total, w) => total + w.kidSavings, 0),
      commonSpent,
      overspendTotal,
      potBalance: totalIncome - manualAllocation - allowanceBudget - commonSpent - overspendTotal,
      spentThisWeek,
      spentThisMonth,
      spentTotal,
    };
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

/** Ngày nhà bắt đầu dành ngân sách cho một người: muộn hơn giữa ngày theo dõi và ngày người đó vào. */
function effectiveStart(startedOn: Date, anchorDate: Date): Date {
  return startedOn > anchorDate ? startedOn : anchorDate;
}

/** Số lần "nạp tiền tuần" đã diễn ra từ `from` đến `now` (tuần chứa `from` tính là 1). */
function countWeeks(from: Date, startDow: number, now: Date): number {
  const wsFrom = weekStart(from, startDow).getTime();
  const wsNow = weekStart(now, startDow).getTime();
  return Math.max(0, Math.floor((wsNow - wsFrom) / WEEK_MS) + 1);
}

/** Số tháng đã trôi qua từ `from` đến `now` (tháng chứa `from` tính là 1). */
function countMonths(from: Date, now: Date): number {
  const diff = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth()) + 1;
  return Math.max(0, diff);
}

/**
 * Các ngày đầu tuần được tính vào tháng `YYYY-MM`. Mỗi tuần thuộc về tháng chứa NGÀY
 * ĐẦU TUẦN của nó, nên cộng 12 tháng lại vẫn đúng 52/53 tuần, không đếm trùng.
 */
function weekStartsInMonth(month: string, startDow: number): Date[] {
  const [year, mon] = month.split('-').map((v) => Number.parseInt(v, 10));
  const first = new Date(year, mon - 1, 1);
  const last = new Date(year, mon, 0);
  const out: Date[] = [];
  const cursor = weekStart(first, startDow);
  if (cursor < first) cursor.setDate(cursor.getDate() + 7);
  while (cursor <= last) {
    out.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return out;
}

/**
 * Ngân sách nhà dành ra mỗi tuần cho một người. Người nhận theo tuần thì đúng bằng mức
 * của họ; người nhận theo tháng (con) vẫn được dành mức tuần CHUẨN của nhà — phần con
 * không cầm tay chính là quỹ tiết kiệm của con.
 */
function weeklyBudgetOf(member: { cycle: string; allowance: bigint | null }, defaultWeekly: bigint): number {
  if (member.cycle === 'monthly') return Number(defaultWeekly);
  return Number(member.allowance ?? defaultWeekly);
}

function normalizeCycle(value: unknown): string {
  return (CYCLES as readonly string[]).includes(String(value)) ? String(value) : 'weekly';
}

/** Mức riêng của thành viên; bỏ trống hoặc trùng mức mặc định ⇒ null để bám theo cài đặt. */
function ownAllowance(value: unknown, defaultWeekly: bigint): bigint | null {
  const amount = parseVnd(value);
  return amount > 0 && amount !== Number(defaultWeekly) ? BigInt(amount) : null;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentMonth(): string {
  return monthKey(new Date());
}

function normalizeMonth(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : null;
}

function previousMonth(month: string): string {
  const [year, mon] = month.split('-').map((v) => Number.parseInt(v, 10));
  return monthKey(new Date(year, mon - 2, 1));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Parse tiền VND về số nguyên không âm (mọi khoản trong module này đều là số dương). */
function parseVnd(value: unknown): number {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  const n = digits ? Number.parseInt(digits, 10) : 0;
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function parseOptionalBigInt(value: unknown): bigint | null {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return null; // '' ⇒ chi chung
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/** Ngày người dùng chọn → nửa đêm UTC (cùng quy ước với các module khác, khớp cột DATE). */
function parseDateOnly(value: unknown): Date | null {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sumAmount(rows: Array<{ amount: bigint }>): number {
  return rows.reduce((total, row) => total + Number(row.amount), 0);
}

function sumAllocation(rows: Array<{ kind: string; amount: bigint }>, kind: string): number {
  return rows.filter((r) => r.kind === kind).reduce((total, r) => total + Number(r.amount), 0);
}
