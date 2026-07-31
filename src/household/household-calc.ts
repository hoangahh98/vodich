/**
 * Toàn bộ phép tính của module chi tiêu — thuần, không đụng Prisma, không đụng Nest.
 *
 * RULE (chỉ có bấy nhiêu, cố ý giữ ít):
 *
 *   1. Chủ sổ tự khai LOẠI THU NHẬP và LOẠI CHI PHÍ. Mỗi khoản thu/chi thuộc một loại.
 *   2. Mỗi loại có `kind` quyết định tiền chảy vào ô nào ở Tổng quan:
 *
 *        loại CHI PHÍ                                loại THU NHẬP
 *        --------------------------------------      ---------------------------------------
 *        fixed    | 💸 Chi phí — CỐ ĐỊNH             normal | 💵 Thu nhập
 *        variable | 💸 Chi phí — PHÁT SINH           saving | 🐷 RÚT tiết kiệm (không phải thu)
 *        saving   | 🐷 GỬI tiết kiệm (không phải chi) debt   | 💵 Thu, gốc trừ khoản NGƯỜI TA NỢ MÌNH
 *        debt     | 💸 Chi phí, gốc trừ khoản MÌNH NỢ
 *
 *      Chỉ `fixed` mới chép được sang tháng sau — đó là lý do tách cố định / phát sinh.
 *
 *   3. TIẾT KIỆM DỒN QUA CÁC THÁNG:
 *
 *        Tiết kiệm đang có = Σ (gửi − rút) của MỌI tháng từ đầu sổ tới tháng đang xem
 *
 *      Đây là điểm khác lớn nhất so với mô hình cũ: không còn quỹ nào "không cộng dồn",
 *      không còn chuyện cuối tháng dồn phần thừa sang quỹ khác. Mọi loại đánh dấu tiết
 *      kiệm đều chảy vào CHUNG MỘT ô.
 *
 *   4. Tiền mặt còn lại của một tháng — mọi thứ vào trừ mọi thứ ra, kể cả tiền cất đi:
 *
 *        Còn lại tháng này = Σ mọi khoản thu − Σ mọi khoản chi
 *        Còn lại luỹ kế    = còn lại của MỌI tháng trước + còn lại tháng này
 *
 *      (Gửi tiết kiệm nằm ở vế trừ, rút tiết kiệm nằm ở vế cộng — nên tiền không đếm hai lần:
 *       cất vào két thì rời khỏi ví, lấy ra tiêu thì quay lại ví.)
 *
 *   5. SỔ NỢ hai chiều. Còn lại của một khoản nợ = số ban đầu − Σ tiền GỐC đã trả cho đúng
 *      khoản đó. Lãi là tiền ra khỏi nhà nhưng KHÔNG làm giảm nợ.
 *
 * Vì tiết kiệm và tiền còn lại đều là số luỹ kế, mọi thứ được tính lại từ tháng đầu tiên có
 * dữ liệu cho tới tháng đang xem — sổ một gia đình chỉ vài trăm dòng nên rẻ, và sửa một con
 * số ở tháng cũ là mọi tháng sau tự đúng theo, không cần chốt sổ.
 */

const MAX_MONTHS = 600; // chặn vòng lặp nếu dữ liệu có tháng rác ở quá khứ xa
const TREND_MONTHS = 6; // số tháng bày ở biểu đồ xu hướng và gửi cho trợ lý AI

/**
 * Kiểu của loại CHI PHÍ. Chi phí tách làm hai để biết khoản nào tháng nào cũng phải trả:
 * - `fixed`    — chi phí CỐ ĐỊNH (học phí, gửi xe, tiền nhà): lặp đều, chép được sang tháng sau.
 * - `variable` — chi phí PHÁT SINH (ăn ngoài, cưới hỏi, sửa xe): không lặp, không chép.
 * Cả hai đều cộng vào ô 💸 Chi phí; `saving` và `debt` xem chú thích đầu file.
 */
export const EXPENSE_KINDS = ['fixed', 'variable', 'saving', 'debt'] as const;
export const INCOME_KINDS = ['normal', 'saving', 'debt'] as const;
export const DEBT_DIRECTIONS = ['owe', 'lend'] as const;

export type ExpenseKind = (typeof EXPENSE_KINDS)[number];
export type IncomeKind = (typeof INCOME_KINDS)[number];
export type DebtDirection = (typeof DEBT_DIRECTIONS)[number];

// ─── Dữ liệu vào (đúng hình dạng Prisma trả về, nhưng không phụ thuộc Prisma) ───

export interface ConfigLike {
  anchorDate: Date;
}

export interface CategoryLike {
  id: bigint;
  name: string;
  kind: string;
  active: boolean;
}

export interface EntryLike {
  categoryId: bigint | null;
  month: string;
  amount: bigint;
  principal: bigint;
  interest: bigint;
  debtId: bigint | null;
}

export interface DebtLike {
  id: bigint;
  direction: string;
  name: string;
  counterparty: string;
  initialAmount: bigint;
  startDate: Date;
  dueDate: Date | null;
  note: string;
}

// ─── Dữ liệu ra ───

export interface CategoryTotal {
  id: string; // '' = khoản của loại đã bị xoá
  name: string;
  kind: string;
  amount: number;
  count: number;
  /** Phần trăm trong tổng của chính nhóm đó — để vẽ thanh tỷ trọng, 0 nếu nhóm rỗng. */
  share: number;
}

export interface DebtView {
  id: bigint;
  direction: string;
  name: string;
  counterparty: string;
  initialAmount: number;
  startDate: Date;
  dueDate: Date | null;
  note: string;
  principalPaid: number; // tổng gốc đã trả tới hết tháng đang xem
  interestPaid: number; // tổng lãi đã trả tới hết tháng đang xem
  principalThisMonth: number;
  interestThisMonth: number;
  remaining: number; // số ban đầu − tổng gốc đã trả
  /**
   * Đã trả/thu xong. Màn hình dùng cờ này để gập khoản đó xuống mục "Đã xong" và bỏ nó khỏi
   * ô chọn khi khai chi/thu.
   *
   * Bắt buộc `initialAmount > 0`: khoản vừa khai mà chưa điền số tiền cũng có còn lại = 0,
   * nhận nhầm là xong thì nó biến mất khỏi danh sách ngay lúc người dùng đang định điền tiếp.
   */
  settled: boolean;
  progress: number; // % gốc đã trả, 0..100
}

/** Con số gọn của một tháng — dùng cho dải xu hướng và cho ngữ cảnh gửi trợ lý AI. */
export interface MonthTotals {
  month: string;
  income: number;
  expense: number;
  savingIn: number;
  savingOut: number;
  leftover: number;
}

export interface MonthReport extends MonthTotals {
  months: string[]; // các tháng có dữ liệu, mới nhất trước
  expenseFixed: number; // phần chi phí cố định + trả nợ của tháng
  expenseVariable: number; // phần chi phí phát sinh của tháng
  savingNet: number; // gửi − rút trong tháng đang xem
  savingBalance: number; // ← số của ô 🐷: tiết kiệm dồn qua các tháng
  leftoverPrevious: number;
  leftoverTotal: number;
  incomeByCategory: CategoryTotal[];
  expenseByCategory: CategoryTotal[];
  savingByCategory: CategoryTotal[];
  debtPrincipalPaid: number; // gốc mình trả trong tháng đang xem
  debtInterestPaid: number;
  debtPrincipalCollected: number; // gốc người ta trả cho mình trong tháng đang xem
  debtInterestCollected: number;
  debts: DebtView[];
  oweRemaining: number; // tổng mình còn nợ người ta
  lendRemaining: number; // tổng người ta còn nợ mình
  debtNet: number; // lendRemaining − oweRemaining (dương = mình đang cho vay nhiều hơn)
  trend: MonthTotals[]; // 6 tháng gần nhất tính tới tháng đang xem, cũ → mới
}

export interface LedgerInput {
  config: ConfigLike;
  month: string;
  incomeCategories: CategoryLike[];
  expenseCategories: CategoryLike[];
  incomes: EntryLike[];
  expenses: EntryLike[];
  debts: DebtLike[];
}

// ─── Tính ───

export function buildMonthReport(input: LedgerInput): MonthReport {
  const month = normalizeMonth(input.month) ?? monthKey(new Date());
  const incomeKind = kindLookup(input.incomeCategories, 'normal');
  const expenseKind = kindLookup(input.expenseCategories, 'variable');

  // Chỉ tính tới tháng đang xem: đứng ở tháng 6 thì không được thấy tiền của tháng 7.
  const incomes = input.incomes.filter((row) => row.month <= month);
  const expenses = input.expenses.filter((row) => row.month <= month);
  const thisMonth = <T extends { month: string }>(rows: T[]) => rows.filter((row) => row.month === month);

  const incomeRows = thisMonth(incomes);
  const expenseRows = thisMonth(expenses);

  // Tiết kiệm là số LUỸ KẾ nên cộng trên toàn bộ lịch sử; thu/chi thì chỉ của tháng đang xem.
  const savingBalance = sum(expenses, (row) => (expenseKind(row) === 'saving' ? amount(row) : 0)) -
    sum(incomes, (row) => (incomeKind(row) === 'saving' ? amount(row) : 0));

  const savingIn = sum(expenseRows, (row) => (expenseKind(row) === 'saving' ? amount(row) : 0));
  const savingOut = sum(incomeRows, (row) => (incomeKind(row) === 'saving' ? amount(row) : 0));
  const income = sum(incomeRows, (row) => (incomeKind(row) === 'saving' ? 0 : amount(row)));
  const expense = sum(expenseRows, (row) => (expenseKind(row) === 'saving' ? 0 : amount(row)));
  // Tách cố định / phát sinh để biết mỗi tháng bao nhiêu là khoản KHÔNG tránh được.
  // Khoản trả nợ gộp vào cố định: tháng nào cũng phải trả.
  const expenseFixed = sum(expenseRows, (row) => (['fixed', 'debt'].includes(expenseKind(row)) ? amount(row) : 0));

  // Tiền còn lại: mọi thứ vào trừ mọi thứ ra. Tính cho từng tháng rồi cộng dồn, vì đó là số
  // duy nhất người dùng cần khi hỏi "từ đầu năm tới giờ nhà mình còn dư bao nhiêu".
  const leftoverByMonth = new Map<string, number>();
  const bump = (m: string, delta: number) => leftoverByMonth.set(m, (leftoverByMonth.get(m) ?? 0) + delta);
  for (const row of incomes) bump(row.month, amount(row));
  for (const row of expenses) bump(row.month, -amount(row));

  const leftover = leftoverByMonth.get(month) ?? 0;
  const leftoverTotal = [...leftoverByMonth.values()].reduce((total, value) => total + value, 0);

  const debts = buildDebtViews(input.debts, incomes, expenses, month);

  return {
    month,
    months: knownMonths(input, month),
    income,
    expense,
    savingIn,
    savingOut,
    expenseFixed,
    expenseVariable: expense - expenseFixed,
    savingNet: savingIn - savingOut,
    savingBalance,
    leftover,
    leftoverPrevious: leftoverTotal - leftover,
    leftoverTotal,
    incomeByCategory: groupByCategory(incomeRows, input.incomeCategories, (kind) => kind !== 'saving'),
    expenseByCategory: groupByCategory(expenseRows, input.expenseCategories, (kind) => kind !== 'saving'),
    savingByCategory: groupByCategory(expenseRows, input.expenseCategories, (kind) => kind === 'saving'),
    debtPrincipalPaid: sum(expenseRows, (row) => (row.debtId === null ? 0 : Number(row.principal))),
    debtInterestPaid: sum(expenseRows, (row) => (row.debtId === null ? 0 : Number(row.interest))),
    debtPrincipalCollected: sum(incomeRows, (row) => (row.debtId === null ? 0 : Number(row.principal))),
    debtInterestCollected: sum(incomeRows, (row) => (row.debtId === null ? 0 : Number(row.interest))),
    debts,
    oweRemaining: sum(debts, (debt) => (debt.direction === 'owe' ? Math.max(0, debt.remaining) : 0)),
    lendRemaining: sum(debts, (debt) => (debt.direction === 'lend' ? Math.max(0, debt.remaining) : 0)),
    debtNet:
      sum(debts, (debt) => (debt.direction === 'lend' ? Math.max(0, debt.remaining) : 0)) -
      sum(debts, (debt) => (debt.direction === 'owe' ? Math.max(0, debt.remaining) : 0)),
    trend: buildTrend(leftoverByMonth, incomes, expenses, incomeKind, expenseKind, month),
  };
}

/**
 * Còn lại của từng khoản nợ. Tiền GỐC của khoản chi trừ vào khoản MÌNH NỢ, tiền gốc của
 * khoản thu trừ vào khoản MÌNH CHO VAY — nên một dòng ghi nhầm chiều không âm thầm làm
 * giảm nợ bên kia.
 */
function buildDebtViews(debts: DebtLike[], incomes: EntryLike[], expenses: EntryLike[], month: string): DebtView[] {
  return debts.map((debt) => {
    const rows = (debt.direction === 'lend' ? incomes : expenses).filter((row) => row.debtId === debt.id);
    const rowsThisMonth = rows.filter((row) => row.month === month);
    const initialAmount = Number(debt.initialAmount);
    const principalPaid = sum(rows, (row) => Number(row.principal));
    const remaining = initialAmount - principalPaid;
    return {
      id: debt.id,
      direction: debt.direction,
      name: debt.name,
      counterparty: debt.counterparty,
      initialAmount,
      startDate: debt.startDate,
      dueDate: debt.dueDate,
      note: debt.note,
      principalPaid,
      interestPaid: sum(rows, (row) => Number(row.interest)),
      principalThisMonth: sum(rowsThisMonth, (row) => Number(row.principal)),
      interestThisMonth: sum(rowsThisMonth, (row) => Number(row.interest)),
      remaining,
      settled: initialAmount > 0 && remaining <= 0,
      progress: initialAmount > 0 ? Math.min(100, Math.round((principalPaid / initialAmount) * 100)) : 0,
    };
  });
}

/** Gộp các khoản của tháng theo loại, nhiều tiền nhất trước. Loại đã xoá gom vào một dòng. */
function groupByCategory(rows: EntryLike[], categories: CategoryLike[], keep: (kind: string) => boolean): CategoryTotal[] {
  const byId = new Map(categories.map((category) => [String(category.id), category]));
  const kindOf = (row: EntryLike) => byId.get(String(row.categoryId ?? ''))?.kind ?? 'normal';
  const totals = new Map<string, CategoryTotal>();

  for (const row of rows) {
    const kind = kindOf(row);
    if (!keep(kind)) continue;
    const id = row.categoryId === null ? '' : String(row.categoryId);
    const category = byId.get(id);
    const bucket = totals.get(id) ?? {
      id,
      name: category?.name ?? '(loại đã xoá)',
      kind: category?.kind ?? 'normal',
      amount: 0,
      count: 0,
      share: 0,
    };
    bucket.amount += amount(row);
    bucket.count += 1;
    totals.set(id, bucket);
  }

  const list = [...totals.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'vi'));
  const total = list.reduce((all, item) => all + item.amount, 0);
  for (const item of list) item.share = total > 0 ? Math.round((item.amount / total) * 100) : 0;
  return list;
}

/** Sáu tháng gần nhất tính ngược từ tháng đang xem, cũ → mới. Tháng trống vẫn có mặt (số 0). */
function buildTrend(
  leftoverByMonth: Map<string, number>,
  incomes: EntryLike[],
  expenses: EntryLike[],
  incomeKind: (row: EntryLike) => string,
  expenseKind: (row: EntryLike) => string,
  month: string,
): MonthTotals[] {
  const months: string[] = [];
  let cursor = month;
  for (let i = 0; i < TREND_MONTHS; i++) {
    months.unshift(cursor);
    cursor = previousMonth(cursor);
  }
  return months.map((m) => {
    const incomeRows = incomes.filter((row) => row.month === m);
    const expenseRows = expenses.filter((row) => row.month === m);
    return {
      month: m,
      income: sum(incomeRows, (row) => (incomeKind(row) === 'saving' ? 0 : amount(row))),
      expense: sum(expenseRows, (row) => (expenseKind(row) === 'saving' ? 0 : amount(row))),
      savingIn: sum(expenseRows, (row) => (expenseKind(row) === 'saving' ? amount(row) : 0)),
      savingOut: sum(incomeRows, (row) => (incomeKind(row) === 'saving' ? amount(row) : 0)),
      leftover: leftoverByMonth.get(m) ?? 0,
    };
  });
}

/**
 * Kiểu của loại mà một khoản trỏ vào. Loại đã bị xoá (`categoryId` null) rơi về `fallback` —
 * tiền vẫn ra/vào thật, không được biến mất khỏi công thức chỉ vì mất cái nhãn.
 *
 * Bên chi phí fallback là `variable`, để `expenseFixed + expenseVariable` luôn đúng bằng
 * `expense`: nếu rơi về một kiểu lạ thì khoản đó không thuộc bên nào và hai số cộng lại hụt.
 */
function kindLookup(categories: CategoryLike[], fallback: string): (row: EntryLike) => string {
  const byId = new Map(categories.map((category) => [String(category.id), category.kind]));
  return (row: EntryLike) => byId.get(String(row.categoryId ?? '')) ?? fallback;
}

/** Các tháng đã có dữ liệu (kèm tháng đang xem), mới nhất trước — dùng cho ô chọn tháng. */
function knownMonths(input: LedgerInput, month: string): string[] {
  const all = new Set<string>([month, monthKey(input.config.anchorDate)]);
  for (const row of input.incomes) all.add(row.month);
  for (const row of input.expenses) all.add(row.month);
  return [...all].filter(isMonth).sort().reverse().slice(0, MAX_MONTHS);
}

const amount = (row: EntryLike) => Number(row.amount);

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

// ─── Helpers thời gian & số ───

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function currentMonth(): string {
  return monthKey(new Date());
}

function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function normalizeMonth(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  return isMonth(raw) ? raw : null;
}

export function previousMonth(month: string): string {
  const [year, mon] = month.split('-').map((v) => Number.parseInt(v, 10));
  return monthKey(new Date(year, mon - 2, 1));
}

/** Tháng của một ngày cụ thể — mọi dòng dữ liệu đều được xếp vào tháng theo ngày xảy ra. */
export function monthOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Parse tiền VND về số nguyên không âm (mọi khoản trong module này đều là số dương). */
export function parseVnd(value: unknown): number {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  const n = digits ? Number.parseInt(digits, 10) : 0;
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function parseOptionalBigInt(value: unknown): bigint | null {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
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

export function pickOne<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const raw = String(value ?? '');
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export function parseBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const raw = String(value);
  return raw === 'on' || raw === 'true' || raw === '1';
}
