/**
 * Toàn bộ phép tính của module chi tiêu — thuần, không đụng Prisma, không đụng Nest.
 *
 * Dựng đúng theo bảng tính chiphi.xlsx của chủ nhà. Mỗi tháng là một "sổ" độc lập gồm
 * 5 phần, và tiền chảy đúng một chiều:
 *
 *   1. THU               — lương vợ, lương chồng, OT, thu khác.
 *   2. TIẾT KIỆM         — mỗi quỹ tự nạp một mức cố định hàng tháng.
 *                          `accumulate` cộng dồn mãi · `reserve` (dự phòng, y tế) KHÔNG cộng
 *                          dồn, hết tháng còn thừa bao nhiêu dồn hết sang quỹ `fun` (Đi chơi).
 *   3. TRẢ NỢ            — gốc + lãi nhập tay theo tháng; nợ còn lại = nợ ban đầu − Σ gốc đã trả.
 *   4. CHI PHÍ CỐ ĐỊNH   — mỗi khoản có TRẦN/tháng và cách tính "đã chi" riêng (xem `FIXED_MODES`).
 *   5. CHI PHÍ PHÁT SINH — chi mới thì trừ thẳng vào tiền còn thừa; cũng có thể lấy từ một
 *                          khoản chi phí cố định hoặc một quỹ tiết kiệm (khi đó chỉ ghi vào
 *                          chỗ đó, KHÔNG trừ thêm lần nữa).
 *
 * Công thức chốt hạ, khớp ô "còn thừa tháng này" của bảng tính:
 *
 *   Còn thừa tháng này = Σ thu
 *                      − (gốc + lãi) trả nợ
 *                      − Σ mức nạp tiết kiệm
 *                      − Σ ĐÃ CHI của chi phí cố định   (không phải trần — trần chưa dùng hết thì còn thừa)
 *                      − Σ chi phí phát sinh nguồn "mới"
 *
 *   Tổng còn thừa = còn thừa của MỌI tháng trước + còn thừa tháng này.
 *
 * Vì "còn thừa" và số dư quỹ đều cộng dồn, mọi thứ được tính lại từ tháng đầu tiên có dữ
 * liệu cho tới tháng đang xem — sổ một gia đình chỉ vài trăm dòng nên rẻ, và đổi một con số
 * ở tháng cũ là mọi tháng sau tự đúng theo, không cần chốt sổ.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_MONTHS = 600; // chặn vòng lặp nếu dữ liệu có tháng rác ở quá khứ xa

export const FUND_KINDS = ['accumulate', 'reserve', 'fun'] as const;
export const FIXED_MODES = ['once', 'gradual', 'weekly'] as const;
export const EXTRA_SOURCES = ['new', 'fixed', 'fund'] as const;
export const FUND_DIRECTIONS = ['in', 'out'] as const;

// ─── Dữ liệu vào (đúng hình dạng Prisma trả về, nhưng không phụ thuộc Prisma) ───

export interface ConfigLike {
  weeklyRate: bigint;
  weekStartDow: number;
  anchorDate: Date;
}

export interface IncomeLike {
  month: string;
  amount: bigint;
}

export interface FundLike {
  id: bigint;
  name: string;
  kind: string;
  monthlyAmount: bigint;
  startMonth: string;
  active: boolean;
}

export interface FundEntryLike {
  fundId: bigint;
  month: string;
  direction: string;
  amount: bigint;
}

export interface DebtLike {
  id: bigint;
  name: string;
  initialAmount: bigint;
  startMonth: string;
  active: boolean;
}

export interface DebtPaymentLike {
  debtId: bigint;
  month: string;
  principal: bigint;
  interest: bigint;
}

export interface FixedCostLike {
  id: bigint;
  name: string;
  mode: string;
  capAmount: bigint;
  weeklyRate: bigint | null;
  startMonth: string;
  active: boolean;
}

export interface FixedSpendLike {
  costId: bigint;
  month: string;
  occurredAt: Date;
  amount: bigint;
}

export interface ExtraCostLike {
  month: string;
  occurredAt: Date;
  amount: bigint;
  source: string;
  fixedCostId: bigint | null;
  fundId: bigint | null;
}

// ─── Dữ liệu ra ───

export interface FundView {
  id: bigint;
  name: string;
  kind: string;
  active: boolean;
  monthlyAmount: number;
  deposited: number; // đã nạp trong tháng đang xem (mức mặc định + nạp thêm)
  used: number; // đã rút ra dùng trong tháng đang xem
  leftThisMonth: number; // deposited − used
  balance: number; // số dư tới cuối tháng đang xem
  carriesToFun: boolean; // true = phần thừa cuối tháng dồn sang quỹ Đi chơi
  receivesCarry: boolean; // true = chính là quỹ Đi chơi nhận phần thừa đó
}

export interface DebtView {
  id: bigint;
  name: string;
  active: boolean;
  initialAmount: number;
  principal: number; // gốc trả trong tháng đang xem
  interest: number; // lãi trả trong tháng đang xem
  paidThisMonth: number;
  principalPaid: number; // tổng gốc đã trả tới hết tháng đang xem
  remaining: number; // nợ còn lại = nợ ban đầu − tổng gốc đã trả
}

export interface FixedCostView {
  id: bigint;
  name: string;
  mode: string;
  active: boolean;
  cap: number; // trần của tháng đang xem
  spent: number; // đã chi
  left: number; // cap − spent (âm = vượt trần)
  weeklyRate: number; // chỉ có nghĩa với mode weekly
  autoFilled: boolean; // true = số "đã chi" đang do hệ thống tự điền, chưa ghi khoản nào
  weeks: WeekView[]; // chỉ có nghĩa với mode weekly
}

export interface WeekView {
  index: number; // 1..n
  start: Date;
  end: Date; // ngày cuối tuần (đã trong tuần đó)
  closed: boolean; // tuần đã trôi qua ⇒ mặc định coi như chi hết mức tuần
  amount: number;
  manual: boolean; // true = có ghi khoản chi thật cho tuần này
}

export interface MonthTotals {
  incomeTotal: number;
  fundDeposit: number;
  fundUsed: number;
  debtPrincipal: number;
  debtInterest: number;
  debtPaid: number;
  fixedCap: number;
  fixedSpent: number;
  extraNew: number;
  extraFromFixed: number;
  extraFromFund: number;
  extraTotal: number;
  leftover: number;
}

export interface MonthReport extends MonthTotals {
  month: string;
  months: string[]; // các tháng có dữ liệu, mới nhất trước
  weeksInMonth: number;
  weekStarts: Date[];
  funds: FundView[];
  debts: DebtView[];
  fixedCosts: FixedCostView[];
  fundBalanceTotal: number; // tổng số dư mọi quỹ tới cuối tháng đang xem
  reserveCarryThisMonth: number; // phần dự phòng/y tế sẽ dồn sang Đi chơi cuối tháng này
  funFundName: string | null; // tên quỹ nhận phần thừa đó
  debtRemainingTotal: number;
  leftoverPrevious: number; // còn thừa lũy kế của MỌI tháng trước
  leftoverTotal: number; // = leftoverPrevious + leftover
}

// ─── Tính một tháng ───

interface Indexed {
  config: ConfigLike;
  now: Date;
  funds: FundLike[];
  debts: DebtLike[];
  fixedCosts: FixedCostLike[];
  incomeByMonth: Map<string, number>;
  fundEntries: Map<string, { in: number; out: number }>; // key = fundId|month
  debtPayments: Map<string, { principal: number; interest: number }>; // key = debtId|month
  fixedSpends: Map<string, Array<{ occurredAt: Date; amount: number }>>; // key = costId|month
  extraNewByMonth: Map<string, number>;
  extraByFixed: Map<string, Array<{ occurredAt: Date; amount: number }>>; // key = costId|month
  extraByFund: Map<string, number>; // key = fundId|month
}

const key = (id: bigint, month: string) => `${id}|${month}`;

/**
 * Danh mục đang "Tạm dừng" thì ngừng chạy TỪ THÁNG NÀY TRỞ ĐI, các tháng đã qua giữ nguyên
 * số cũ — nếu không, bấm tạm dừng một khoản là lịch sử vài tháng trước tự đổi theo.
 */
function runsIn(item: { startMonth: string; active: boolean }, month: string, data: Indexed): boolean {
  if (month < item.startMonth) return false;
  return item.active || month < monthKey(data.now);
}

/** Số tiền một quỹ được nạp trong tháng: mức mặc định (nếu quỹ đã bắt đầu) + các lần nạp thêm. */
function fundDeposit(fund: FundLike, month: string, data: Indexed): number {
  const base = runsIn(fund, month, data) ? Number(fund.monthlyAmount) : 0;
  return base + (data.fundEntries.get(key(fund.id, month))?.in ?? 0);
}

/** Tiền rút khỏi quỹ trong tháng: rút trực tiếp + các khoản phát sinh khai là lấy từ quỹ này. */
function fundUsed(fund: FundLike, month: string, data: Indexed): number {
  return (data.fundEntries.get(key(fund.id, month))?.out ?? 0) + (data.extraByFund.get(key(fund.id, month)) ?? 0);
}

/** Trần của một khoản chi cố định trong tháng. Kiểu `weekly` thì trần = số tuần × mức tuần. */
function fixedCap(cost: FixedCostLike, month: string, data: Indexed): number {
  if (!runsIn(cost, month, data)) return 0;
  if (cost.mode !== 'weekly') return Number(cost.capAmount);
  return weekStartsInMonth(month, data.config.weekStartDow).length * weeklyRateOf(cost, data.config);
}

/**
 * "Đã chi" của một khoản cố định trong tháng, kèm chi tiết từng tuần (chỉ kiểu `weekly`).
 *
 * Các lần chi thật gồm cả khoản phát sinh khai là lấy từ chính khoản này — nhờ vậy khoản
 * phát sinh đó không bị trừ hai lần (một lần ở đây, một lần ở phần còn thừa).
 */
function fixedSpentOf(cost: FixedCostLike, month: string, data: Indexed) {
  const entries = [
    ...(data.fixedSpends.get(key(cost.id, month)) ?? []),
    ...(data.extraByFixed.get(key(cost.id, month)) ?? []),
  ];
  const manualTotal = entries.reduce((total, e) => total + e.amount, 0);

  // Khoản đang tạm dừng thì hết trần và hết phần tự điền, nhưng tiền ĐÃ ghi ra thì vẫn là
  // tiền đã ra khỏi nhà — vẫn phải tính, không được xoá khỏi công thức.
  if (!runsIn(cost, month, data)) return { spent: manualTotal, autoFilled: false, weeks: [] as WeekView[] };

  if (cost.mode === 'weekly') {
    const rate = weeklyRateOf(cost, data.config);
    const starts = weekStartsInMonth(month, data.config.weekStartDow);
    const weeks: WeekView[] = [];
    const matched = new Set<number>();
    let spent = 0;

    starts.forEach((start, index) => {
      const nextStart = new Date(start.getTime() + 7 * DAY_MS);
      const inWeek = entries.filter((e, i) => {
        const hit = e.occurredAt >= start && e.occurredAt < nextStart;
        if (hit) matched.add(i);
        return hit;
      });
      const manual = inWeek.reduce((total, e) => total + e.amount, 0);
      // Hết tuần nào thì tuần đó mặc định coi như đã tiêu hết mức tuần — trừ khi đã ghi số thật.
      const closed = nextStart.getTime() <= data.now.getTime();
      const amount = inWeek.length ? manual : closed ? rate : 0;
      spent += amount;
      weeks.push({
        index: index + 1,
        start,
        end: new Date(nextStart.getTime() - DAY_MS),
        closed,
        amount,
        manual: inWeek.length > 0,
      });
    });

    // Khoản ghi rơi ngoài các tuần của tháng (mấy ngày đầu tháng trước thứ Hai đầu tiên)
    // vẫn phải được tính, nếu không tiền tự bốc hơi khỏi sổ.
    spent += entries.reduce((total, e, i) => (matched.has(i) ? total : total + e.amount), 0);
    return { spent, autoFilled: weeks.some((w) => w.closed && !w.manual), weeks };
  }

  // `once`: thường chi hết luôn một lần — chưa ghi khoản nào thì coi như đã chi đủ trần.
  // Tháng chưa tới thì chưa chi đồng nào.
  if (cost.mode === 'once' && manualTotal === 0) {
    const started = month <= monthKey(data.now);
    return { spent: started ? Number(cost.capAmount) : 0, autoFilled: started, weeks: [] };
  }

  return { spent: manualTotal, autoFilled: false, weeks: [] };
}

/** Toàn bộ con số của MỘT tháng — dùng cho cả tháng đang xem lẫn các tháng trước (để cộng dồn). */
function computeMonth(month: string, data: Indexed) {
  const incomeTotal = data.incomeByMonth.get(month) ?? 0;

  const funds = data.funds.map((fund) => {
    const deposited = fundDeposit(fund, month, data);
    const used = fundUsed(fund, month, data);
    return { fund, deposited, used, leftThisMonth: deposited - used };
  });
  const fundDepositTotal = funds.reduce((total, f) => total + f.deposited, 0);
  const fundUsedTotal = funds.reduce((total, f) => total + f.used, 0);
  // Dự phòng / y tế không cộng dồn: hết tháng còn thừa bao nhiêu dồn hết sang quỹ Đi chơi.
  const reserveCarry = funds
    .filter((f) => f.fund.kind === 'reserve')
    .reduce((total, f) => total + Math.max(0, f.leftThisMonth), 0);

  const debts = data.debts.map((debt) => {
    const paid = data.debtPayments.get(key(debt.id, month));
    return { debt, principal: paid?.principal ?? 0, interest: paid?.interest ?? 0 };
  });
  const debtPrincipal = debts.reduce((total, d) => total + d.principal, 0);
  const debtInterest = debts.reduce((total, d) => total + d.interest, 0);

  const fixedCosts = data.fixedCosts.map((cost) => {
    const { spent, autoFilled, weeks } = fixedSpentOf(cost, month, data);
    const cap = fixedCap(cost, month, data);
    return { cost, cap, spent, autoFilled, weeks };
  });
  const fixedCapTotal = fixedCosts.reduce((total, f) => total + f.cap, 0);
  const fixedSpentTotal = fixedCosts.reduce((total, f) => total + f.spent, 0);

  const extraNew = data.extraNewByMonth.get(month) ?? 0;

  return {
    month,
    incomeTotal,
    funds,
    fundDepositTotal,
    fundUsedTotal,
    reserveCarry,
    debts,
    debtPrincipal,
    debtInterest,
    fixedCosts,
    fixedCapTotal,
    fixedSpentTotal,
    extraNew,
    leftover: incomeTotal - debtPrincipal - debtInterest - fundDepositTotal - fixedSpentTotal - extraNew,
  };
}

// ─── Dựng sổ của tháng đang xem ───

export interface LedgerInput {
  config: ConfigLike;
  month: string;
  incomes: IncomeLike[];
  funds: FundLike[];
  fundEntries: FundEntryLike[];
  debts: DebtLike[];
  debtPayments: DebtPaymentLike[];
  fixedCosts: FixedCostLike[];
  fixedSpends: FixedSpendLike[];
  extraCosts: ExtraCostLike[];
  now?: Date;
}

export function buildMonthReport(input: LedgerInput): MonthReport {
  const now = input.now ?? new Date();
  const data = indexInput(input, now);
  const month = input.month;

  // Cộng dồn từ tháng đầu tiên có dữ liệu tới tháng đang xem: "còn thừa" và số dư quỹ đều
  // là số lũy kế, nên không thể tính riêng lẻ một tháng.
  const timeline = monthsUpTo(firstMonth(input, now), month).map((m) => computeMonth(m, data));
  const current = timeline[timeline.length - 1];
  const previous = timeline.slice(0, -1);

  const funFund = input.funds.find((f) => f.kind === 'fun') ?? null;
  const carryIntoFun = previous.reduce((total, m) => total + m.reserveCarry, 0);

  const funds: FundView[] = current.funds.map((row, index) => {
    const reserve = row.fund.kind === 'reserve';
    const isFun = funFund !== null && row.fund.id === funFund.id;
    // Quỹ không cộng dồn thì số dư chỉ là phần của chính tháng này.
    const accumulated = reserve
      ? row.leftThisMonth
      : timeline.reduce((total, m) => total + m.funds[index].leftThisMonth, 0);
    return {
      id: row.fund.id,
      name: row.fund.name,
      kind: row.fund.kind,
      active: row.fund.active,
      monthlyAmount: Number(row.fund.monthlyAmount),
      deposited: row.deposited,
      used: row.used,
      leftThisMonth: row.leftThisMonth,
      balance: accumulated + (isFun ? carryIntoFun : 0),
      carriesToFun: reserve,
      receivesCarry: isFun,
    };
  });

  const debts: DebtView[] = current.debts.map((row, index) => {
    const principalPaid = timeline.reduce((total, m) => total + m.debts[index].principal, 0);
    return {
      id: row.debt.id,
      name: row.debt.name,
      active: row.debt.active,
      initialAmount: Number(row.debt.initialAmount),
      principal: row.principal,
      interest: row.interest,
      paidThisMonth: row.principal + row.interest,
      principalPaid,
      remaining: Number(row.debt.initialAmount) - principalPaid,
    };
  });

  const fixedCosts: FixedCostView[] = current.fixedCosts.map((row) => ({
    id: row.cost.id,
    name: row.cost.name,
    mode: row.cost.mode,
    active: row.cost.active,
    cap: row.cap,
    spent: row.spent,
    left: row.cap - row.spent,
    weeklyRate: weeklyRateOf(row.cost, input.config),
    autoFilled: row.autoFilled,
    weeks: row.weeks,
  }));

  const extraFromFixed = input.extraCosts
    .filter((e) => e.month === month && e.source === 'fixed' && e.fixedCostId !== null)
    .reduce((total, e) => total + Number(e.amount), 0);
  const extraFromFund = input.extraCosts
    .filter((e) => e.month === month && e.source === 'fund' && e.fundId !== null)
    .reduce((total, e) => total + Number(e.amount), 0);
  const leftoverPrevious = previous.reduce((total, m) => total + m.leftover, 0);

  return {
    month,
    months: knownMonths(input, month),
    weeksInMonth: weekStartsInMonth(month, input.config.weekStartDow).length,
    weekStarts: weekStartsInMonth(month, input.config.weekStartDow),
    incomeTotal: current.incomeTotal,
    funds,
    fundDeposit: current.fundDepositTotal,
    fundUsed: current.fundUsedTotal,
    fundBalanceTotal: funds.reduce((total, f) => total + f.balance, 0),
    reserveCarryThisMonth: current.reserveCarry,
    funFundName: funFund?.name ?? null,
    debts,
    debtPrincipal: current.debtPrincipal,
    debtInterest: current.debtInterest,
    debtPaid: current.debtPrincipal + current.debtInterest,
    debtRemainingTotal: debts.reduce((total, d) => total + d.remaining, 0),
    fixedCosts,
    fixedCap: current.fixedCapTotal,
    fixedSpent: current.fixedSpentTotal,
    extraNew: current.extraNew,
    extraFromFixed,
    extraFromFund,
    extraTotal: current.extraNew + extraFromFixed + extraFromFund,
    leftover: current.leftover,
    leftoverPrevious,
    leftoverTotal: leftoverPrevious + current.leftover,
  };
}

function indexInput(input: LedgerInput, now: Date): Indexed {
  const incomeByMonth = new Map<string, number>();
  for (const row of input.incomes) {
    incomeByMonth.set(row.month, (incomeByMonth.get(row.month) ?? 0) + Number(row.amount));
  }

  const fundEntries = new Map<string, { in: number; out: number }>();
  for (const row of input.fundEntries) {
    const k = key(row.fundId, row.month);
    const bucket = fundEntries.get(k) ?? { in: 0, out: 0 };
    if (row.direction === 'in') bucket.in += Number(row.amount);
    else bucket.out += Number(row.amount);
    fundEntries.set(k, bucket);
  }

  const debtPayments = new Map<string, { principal: number; interest: number }>();
  for (const row of input.debtPayments) {
    const k = key(row.debtId, row.month);
    const bucket = debtPayments.get(k) ?? { principal: 0, interest: 0 };
    bucket.principal += Number(row.principal);
    bucket.interest += Number(row.interest);
    debtPayments.set(k, bucket);
  }

  const fixedSpends = new Map<string, Array<{ occurredAt: Date; amount: number }>>();
  for (const row of input.fixedSpends) {
    const k = key(row.costId, row.month);
    const bucket = fixedSpends.get(k) ?? [];
    bucket.push({ occurredAt: row.occurredAt, amount: Number(row.amount) });
    fixedSpends.set(k, bucket);
  }

  const extraNewByMonth = new Map<string, number>();
  const extraByFixed = new Map<string, Array<{ occurredAt: Date; amount: number }>>();
  const extraByFund = new Map<string, number>();
  for (const row of input.extraCosts) {
    const amount = Number(row.amount);
    if (row.source === 'fixed' && row.fixedCostId !== null) {
      const k = key(row.fixedCostId, row.month);
      const bucket = extraByFixed.get(k) ?? [];
      bucket.push({ occurredAt: row.occurredAt, amount });
      extraByFixed.set(k, bucket);
    } else if (row.source === 'fund' && row.fundId !== null) {
      const k = key(row.fundId, row.month);
      extraByFund.set(k, (extraByFund.get(k) ?? 0) + amount);
    } else {
      // Kể cả dòng khai nguồn "fixed"/"fund" nhưng khoản gốc đã bị xoá: coi là chi mới,
      // vì tiền vẫn ra khỏi nhà, không được biến mất khỏi công thức.
      extraNewByMonth.set(row.month, (extraNewByMonth.get(row.month) ?? 0) + amount);
    }
  }

  return {
    config: input.config,
    now,
    funds: input.funds,
    debts: input.debts,
    fixedCosts: input.fixedCosts,
    incomeByMonth,
    fundEntries,
    debtPayments,
    fixedSpends,
    extraNewByMonth,
    extraByFixed,
    extraByFund,
  };
}

/** Tháng sớm nhất phải tính lại: sớm nhất trong mốc theo dõi, các danh mục và mọi dòng dữ liệu. */
function firstMonth(input: LedgerInput, now: Date): string {
  const candidates = [
    monthKey(input.config.anchorDate),
    ...input.funds.map((f) => f.startMonth),
    ...input.debts.map((d) => d.startMonth),
    ...input.fixedCosts.map((c) => c.startMonth),
    ...input.incomes.map((i) => i.month),
    ...input.fundEntries.map((e) => e.month),
    ...input.debtPayments.map((p) => p.month),
    ...input.fixedSpends.map((s) => s.month),
    ...input.extraCosts.map((e) => e.month),
  ].filter(isMonth);
  const earliest = candidates.sort()[0] ?? monthKey(now);
  return earliest < input.month ? earliest : input.month;
}

/** Các tháng đã có dữ liệu (kèm tháng đang xem), mới nhất trước — dùng cho ô chọn tháng. */
function knownMonths(input: LedgerInput, month: string): string[] {
  const all = new Set<string>([month, monthKey(input.config.anchorDate)]);
  for (const row of input.incomes) all.add(row.month);
  for (const row of input.fundEntries) all.add(row.month);
  for (const row of input.debtPayments) all.add(row.month);
  for (const row of input.fixedSpends) all.add(row.month);
  for (const row of input.extraCosts) all.add(row.month);
  return [...all].filter(isMonth).sort().reverse();
}

function monthsUpTo(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  while (cursor <= to && out.length < MAX_MONTHS) {
    out.push(cursor);
    cursor = nextMonth(cursor);
  }
  return out.length ? out : [to];
}

// ─── Helpers thời gian & số ───

/** Đầu tuần (nửa đêm địa phương) chứa ngày `d`, theo thứ bắt đầu tuần `startDow` (0=CN..6=T7). */
export function weekStart(d: Date, startDow: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (x.getDay() - startDow + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

/**
 * Các tuần được tính vào tháng `YYYY-MM`: bắt đầu từ THỨ HAI ĐẦU TIÊN của tháng, mỗi 7 ngày
 * một tuần. Đây chính là cách chủ nhà đếm "tháng này mấy tuần" để ra 2 triệu hay 2 triệu rưỡi.
 */
export function weekStartsInMonth(month: string, startDow: number): Date[] {
  const [year, mon] = month.split('-').map((v) => Number.parseInt(v, 10));
  if (!Number.isFinite(year) || !Number.isFinite(mon)) return [];
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

function weeklyRateOf(cost: { weeklyRate: bigint | null }, config: ConfigLike): number {
  return Number(cost.weeklyRate ?? config.weeklyRate);
}

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

export function nextMonth(month: string): string {
  const [year, mon] = month.split('-').map((v) => Number.parseInt(v, 10));
  return monthKey(new Date(year, mon, 1));
}

export function previousMonth(month: string): string {
  const [year, mon] = month.split('-').map((v) => Number.parseInt(v, 10));
  return monthKey(new Date(year, mon - 2, 1));
}

/** Tháng của một ngày cụ thể — mọi dòng dữ liệu đều được xếp vào tháng theo ngày xảy ra. */
export function monthOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
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
