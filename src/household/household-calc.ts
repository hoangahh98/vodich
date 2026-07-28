/**
 * Toàn bộ phép tính của module chi tiêu — thuần, không đụng Prisma, không đụng Nest.
 *
 * Tách khỏi HouseholdService để phần khó nhất (ví tuần không cộng dồn, ví tháng cộng dồn
 * của con, phần nhà phải bù) test được trực tiếp bằng dữ liệu dựng tay, không cần DB.
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
 *   phần cầm tay thì lẹm dần vào chính quỹ đó; hết quỹ mới đến lượt nhà bù.
 * - Khoản chi gắn với 1 người ⇒ trừ ví người đó; không gắn ai ⇒ chi chung, trừ quỹ chung.
 *
 * Quỹ chung còn lại = Σ thu − Σ trích tay − Σ tiền tiêu đã trích − Σ chi chung − Σ tiêu vượt ví.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const ALLOCATION_KINDS = ['savings', 'debt', 'other'] as const;
export const CYCLES = ['weekly', 'monthly'] as const;

export interface ConfigLike {
  weeklyAllowance: bigint;
  weekStartDow: number;
  anchorDate: Date;
}

export interface MemberLike {
  id: bigint;
  name: string;
  cycle: string;
  allowance: bigint | null;
  startedOn: Date;
  active: boolean;
}

export interface TxnLike {
  amount: bigint;
  memberId: bigint | null;
  occurredAt: Date;
}

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

/** Gom chi tiêu theo người và theo KỲ của người đó (tuần hay tháng tuỳ cycle). */
function groupSpending(txns: TxnLike[], members: MemberLike[], config: ConfigLike, now: Date) {
  const cycleOf = new Map(members.map((m) => [String(m.id), m.cycle]));
  const wkStart = weekStart(now, config.weekStartDow);
  const moStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const byMemberPeriod = new Map<string, Map<string, number>>();
  const byMember = new Map<string, number>();
  let commonSpent = 0;
  let spentThisWeek = 0;
  let spentThisMonth = 0;
  let spentTotal = 0;

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
    byMember.set(key, (byMember.get(key) ?? 0) + amount);
    const period = cycleOf.get(key) === 'monthly' ? monthKey(t.occurredAt) : dateKey(weekStart(t.occurredAt, config.weekStartDow));
    const periods = byMemberPeriod.get(key) ?? new Map<string, number>();
    periods.set(period, (periods.get(period) ?? 0) + amount);
    byMemberPeriod.set(key, periods);
  }

  return { byMemberPeriod, byMember, commonSpent, spentThisWeek, spentThisMonth, spentTotal, wkStart };
}

/** Ví của MỘT người: bao nhiêu đã được dành ra, đã cầm tay, đã tiêu, còn lại bao nhiêu. */
function buildWallet(
  member: MemberLike,
  config: ConfigLike,
  spending: ReturnType<typeof groupSpending>,
  now: Date,
): MemberWallet {
  const key = String(member.id);
  const monthly = member.cycle === 'monthly';
  const weeklyBudget = weeklyBudgetOf(member, config.weeklyAllowance);
  const allowance = Number(member.allowance ?? config.weeklyAllowance);
  const from = effectiveStart(member.startedOn, config.anchorDate);
  const weeks = member.active ? countWeeks(from, config.weekStartDow, now) : 0;
  const months = member.active ? countMonths(from, now) : 0;

  const byPeriod = spending.byMemberPeriod.get(key) ?? new Map<string, number>();
  const currentPeriod = monthly ? monthKey(now) : dateKey(spending.wkStart);
  const spentThisPeriod = byPeriod.get(currentPeriod) ?? 0;
  const spentTotal = spending.byMember.get(key) ?? 0;
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
    id: member.id,
    name: member.name,
    active: member.active,
    cycle: member.cycle,
    allowance,
    weeklyBudget,
    hasOwnRate: member.allowance !== null,
    startedOn: member.startedOn,
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
}

export function buildSummary(input: {
  config: ConfigLike;
  members: MemberLike[];
  txns: TxnLike[];
  totalIncome: number;
  allocations: Array<{ kind: string; amount: bigint }>;
  now?: Date;
}): HouseholdSummary {
  const now = input.now ?? new Date();
  const { config, members, allocations, totalIncome } = input;
  const spending = groupSpending(input.txns, members, config, now);
  const wallets = members.map((member) => buildWallet(member, config, spending, now));

  const savingsTotal = sumAllocation(allocations, 'savings');
  const debtTotal = sumAllocation(allocations, 'debt');
  const otherAllocationTotal = sumAllocation(allocations, 'other');
  const manualAllocation = savingsTotal + debtTotal + otherAllocationTotal;
  const allowanceBudget = wallets.reduce((total, w) => total + w.budgetTotal, 0);
  const overspendTotal = wallets.reduce((total, w) => total + w.overspend, 0);

  return {
    defaultWeeklyAllowance: Number(config.weeklyAllowance),
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
    commonSpent: spending.commonSpent,
    overspendTotal,
    potBalance: totalIncome - manualAllocation - allowanceBudget - spending.commonSpent - overspendTotal,
    spentThisWeek: spending.spentThisWeek,
    spentThisMonth: spending.spentThisMonth,
    spentTotal: spending.spentTotal,
  };
}

/** Tiền tiêu tự trích của một tháng = Σ (mức tuần chuẩn × số tuần người đó được nhận trong tháng). */
export function monthAllowanceCost(month: string, config: ConfigLike, members: MemberLike[]) {
  const weekStarts = weekStartsInMonth(month, config.weekStartDow);
  const allowanceCost = members.reduce((total, m) => {
    if (!m.active) return total;
    const from = weekStart(effectiveStart(m.startedOn, config.anchorDate), config.weekStartDow);
    const weeks = weekStarts.filter((ws) => ws >= from).length;
    return total + weeks * weeklyBudgetOf(m, config.weeklyAllowance);
  }, 0);
  return { allowanceCost, weeksInMonth: weekStarts.length };
}

// ─── Helpers thời gian & số ───

/** Đầu tuần (nửa đêm địa phương) chứa ngày `d`, theo thứ bắt đầu tuần `startDow` (0=CN..6=T7). */
export function weekStart(d: Date, startDow: number): Date {
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

export function normalizeCycle(value: unknown): string {
  return (CYCLES as readonly string[]).includes(String(value)) ? String(value) : 'weekly';
}

/** Mức riêng của thành viên; bỏ trống hoặc trùng mức mặc định ⇒ null để bám theo cài đặt. */
export function ownAllowance(value: unknown, defaultWeekly: bigint): bigint | null {
  const amount = parseVnd(value);
  return amount > 0 && amount !== Number(defaultWeekly) ? BigInt(amount) : null;
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function currentMonth(): string {
  return monthKey(new Date());
}

export function normalizeMonth(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : null;
}

export function previousMonth(month: string): string {
  const [year, mon] = month.split('-').map((v) => Number.parseInt(v, 10));
  return monthKey(new Date(year, mon - 2, 1));
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Parse tiền VND về số nguyên không âm (mọi khoản trong module này đều là số dương). */
export function parseVnd(value: unknown): number {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  const n = digits ? Number.parseInt(digits, 10) : 0;
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function parseOptionalBigInt(value: unknown): bigint | null {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return null; // '' ⇒ chi chung
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/** Ngày người dùng chọn → nửa đêm UTC (cùng quy ước với các module khác, khớp cột DATE). */
export function parseDateOnly(value: unknown): Date | null {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function sumAmount(rows: Array<{ amount: bigint }>): number {
  return rows.reduce((total, row) => total + Number(row.amount), 0);
}

function sumAllocation(rows: Array<{ kind: string; amount: bigint }>, kind: string): number {
  return rows.filter((r) => r.kind === kind).reduce((total, r) => total + Number(r.amount), 0);
}
