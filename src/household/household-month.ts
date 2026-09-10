import { isDebtSource, isSavedSource } from './household-enums';

/**
 * Toán của module Chi tiêu — THUẦN, nhận mảng thuần (id đã về chuỗi, tiền đã về số) để test được
 * và để service chỉ lo truy vấn. Mọi con số hiển thị đều suy từ giao dịch, không có cột "số dư".
 */

export interface SourceRow {
  id: string;
  name: string;
  kind: string;
  /** Nhóm thẻ thông (dùng chung hạn mức). Rỗng = thẻ đứng riêng. */
  limitGroup: string;
  openingBalance: number;
  creditLimit: number;
  interestRate: number;
  statementDay: number;
  dueDay: number;
  active: boolean;
}

export interface PurposeRow {
  id: string;
  name: string;
  kind: string;
  monthlyPlan: number;
  active: boolean;
}

export interface TransactionRow {
  id: string;
  kind: string;
  sourceId: string;
  targetSourceId: string | null;
  purposeId: string | null;
  recurringId: string | null;
  amount: number;
  interest: number;
  month: string;
  status: string;
  occurredAt: Date;
  description: string;
}

export interface RecurringRow {
  id: string;
  name: string;
  kind: string;
  sourceId: string | null;
  targetSourceId: string | null;
  purposeId: string | null;
  amount: number;
  interestMode: string;
  dayOfMonth: number;
  startMonth: string;
  endMonth: string | null;
  active: boolean;
}

export interface SourceBalance {
  source: SourceRow;
  /** BANK/CASH: số dư hiện có. CARD/LOAN: dư nợ hiện tại (dương = đang nợ). */
  balance: number;
  /** CARD: hạn mức còn lại = hạn mức − dư nợ. */
  available: number;
}

/**
 * Dòng tiền THỰC vào/ra từng nguồn rồi cộng với số đầu kỳ. Với TRANSFER, nguồn đích chỉ nhận
 * phần GỐC (amount − interest): lãi đã đi khỏi túi mình chứ không vào đâu cả.
 */
export function sourceBalances(sources: SourceRow[], transactions: TransactionRow[]): Map<string, SourceBalance> {
  const net = new Map<string, number>();
  const add = (id: string | null, delta: number) => {
    if (!id) return;
    net.set(id, (net.get(id) || 0) + delta);
  };
  for (const tx of transactions) {
    if (tx.kind === 'INCOME') add(tx.sourceId, tx.amount);
    else if (tx.kind === 'EXPENSE') add(tx.sourceId, -tx.amount);
    else {
      add(tx.sourceId, -tx.amount);
      add(tx.targetSourceId, tx.amount - tx.interest);
    }
  }
  const result = new Map<string, SourceBalance>();
  for (const source of sources) {
    const flow = net.get(source.id) || 0;
    const balance = isDebtSource(source.kind) ? source.openingBalance - flow : source.openingBalance + flow;
    // Hạn mức thẻ không còn khai tay nên `available` chỉ có nghĩa với thẻ cũ còn số hạn mức trong DB;
    // thẻ mới hiện "hạn mức khả dụng" ngân hàng báo trong mail (xem `reconcileSources`).
    result.set(source.id, { source, balance, available: source.kind === 'CARD' && source.creditLimit ? source.creditLimit - balance : 0 });
  }
  return result;
}

/**
 * Ngưỡng bỏ qua khi so hạn mức khả dụng: ngân hàng chốt lệch vài trăm đồng MỖI giao dịch (khoản giữ chốt
 * lại, làm tròn) nên cửa sổ càng nhiều giao dịch càng lệch nhiều — thực tế 10/9/2026: 103đ, 375đ, 1.917đ,
 * và 3.020đ sau 12 giao dịch. Dưới ngưỡng coi như khớp.
 */
export const cardDiffTolerance = (transactionCount: number) => Math.max(2000, 500 * transactionCount);

/** Một lần ngân hàng báo số: giá trị, lúc nào, kèm id giao dịch mang tin đó (để so thứ tự). */
export interface BankMark {
  value: number;
  at: Date;
  txId: string;
}

export interface SourceCheck extends SourceBalance {
  /** Số dư ngân hàng báo gần nhất (mail Timo). Null = ngân hàng chưa báo lần nào. */
  reported: BankMark | null;
  /** Hạn mức khả dụng ngân hàng báo gần nhất (mail thẻ MSB). */
  reportedAvailable: BankMark | null;
  /** Sổ − ngân hàng. Khác 0 = sổ thiếu (hoặc thừa) giao dịch, phải thêm tay. */
  diff: number;
  /** Số dư đang hiện lấy theo mail ngân hàng (true) hay chỉ cộng từ sổ (false). */
  anchored: boolean;
}

/**
 * Khoá nhóm hạn mức của một thẻ: thẻ thông thì cả nhóm cùng mã `limitGroup`, thẻ riêng thì lấy mã riêng
 * theo id (không dùng thẳng id để thẻ vừa bỏ nhóm không rơi trúng mã cũ của nhóm).
 */
export const limitGroupKey = (source: SourceRow) => source.limitGroup || `one:${source.id}`;

/** Dòng tiền của một nguồn trong khoảng (from, to]: bỏ mốc `from`, tính cả mốc `to`. `count` = số giao dịch. */
function flowBetween(source: SourceRow, transactions: TransactionRow[], from: BankMark | null, to: BankMark | null): { flow: number; count: number } {
  const inRange = transactions.filter((tx) => {
    const afterFrom = !from || tx.occurredAt > from.at || (tx.occurredAt.getTime() === from.at.getTime() && BigInt(tx.id) > BigInt(from.txId));
    const beforeTo = !to || tx.occurredAt < to.at || (tx.occurredAt.getTime() === to.at.getTime() && BigInt(tx.id) <= BigInt(to.txId));
    return afterFrom && beforeTo;
  });
  const mine = inRange.filter((tx) => tx.sourceId === source.id || tx.targetSourceId === source.id);
  return { flow: sourceBalances([{ ...source, openingBalance: 0 }], mine).get(source.id)?.balance ?? 0, count: mine.length };
}

/**
 * Số dư từng nguồn có đối chiếu với số ngân hàng báo trong mail (luật chủ app 10/9/2026):
 *
 *  - Tài khoản: mail Timo báo số dư → NGÂN HÀNG THẮNG, số dư = số trong mail gần nhất + giao dịch ghi
 *    sau mail đó. Sổ tính ra khác số ấy thì `diff` khác 0 — app KHÔNG tự bù, chỉ báo để chủ app thêm
 *    giao dịch còn thiếu bằng tay (tự bù là mất dấu khoản thiếu, tiền thật còn lại thành sai).
 *  - Thẻ tín dụng: mail MSB chỉ có HẠN MỨC KHẢ DỤNG, không có hạn mức tổng nên không suy ra được dư nợ.
 *    Dư nợ vẫn cộng từ giao dịch; `diff` đo từ mail đầu tới mail gần nhất, khả dụng phải giảm đúng bằng
 *    phần dư nợ sổ ghi tăng — tính trên CẢ NHÓM THẺ THÔNG (`limitGroup`), vì quẹt thẻ A thì hạn mức
 *    khả dụng báo trong mail của thẻ B cũng đã trừ khoản ấy rồi. Hai thẻ thông khác hạn mức nhau vẫn
 *    đúng: mức khả dụng mỗi thẻ khác nhau nhưng CHÊNH giữa hai lần báo thì bằng nhau.
 */
export function reconcileSources(
  sources: SourceRow[],
  transactions: TransactionRow[],
  balanceMarks: Map<string, BankMark>,
  availableWindows: Map<string, { first: BankMark; last: BankMark }>,
): SourceCheck[] {
  const balances = sourceBalances(sources, transactions);
  const cardsByGroup = new Map<string, SourceRow[]>();
  for (const source of sources.filter((item) => item.kind === 'CARD')) {
    const key = limitGroupKey(source);
    cardsByGroup.set(key, [...(cardsByGroup.get(key) || []), source]);
  }
  return sources.map((source) => {
    const item = balances.get(source.id)!;
    const reported = balanceMarks.get(source.id) || null;
    const window = availableWindows.get(source.id) || null;
    if (reported) {
      const balance = reported.value + flowBetween(source, transactions, reported, null).flow;
      return { ...item, balance, reported, reportedAvailable: window ? window.last : null, diff: Math.round(item.balance - balance), anchored: true };
    }
    let diff = 0;
    if (window && window.first.txId !== window.last.txId) {
      // Thẻ thông của MSB KHÔNG đối xứng (soi dữ liệu thật 10/9/2026): thẻ CHÍNH báo hạn mức của cả cụm
      // (quẹt thẻ phụ cũng làm nó tụt), còn thẻ PHỤ báo hạn mức riêng của nó, quẹt thẻ khác không ảnh
      // hưởng. Không bắt chủ app khai chính/phụ — thử cả hai cách rồi lấy cách khớp hơn.
      const pool = cardsByGroup.get(limitGroupKey(source)) || [source];
      const group = pool.reduce((sum, card) => sum + flowBetween(card, transactions, window.first, window.last).flow, 0);
      const own = flowBetween(source, transactions, window.first, window.last);
      const diffGroup = Math.round(window.first.value - group - window.last.value);
      const diffOwn = Math.round(window.first.value - own.flow - window.last.value);
      diff = Math.abs(diffOwn) < Math.abs(diffGroup) ? diffOwn : diffGroup;
      const count = pool.reduce((sum, card) => sum + flowBetween(card, transactions, window.first, window.last).count, 0);
      if (Math.abs(diff) <= cardDiffTolerance(count)) diff = 0;
    }
    return { ...item, reported: null, reportedAvailable: window ? window.last : null, diff, anchored: false };
  });
}

export interface PurposeActual {
  purpose: PurposeRow;
  actual: number;
  plan: number;
  count: number;
}

export interface MonthReport {
  month: string;
  income: number;
  living: number;
  saving: number;
  reserve: number;
  lending: number;
  /** Trả nợ vay: tổng tiền đi, tách gốc/lãi. */
  debt: { total: number; principal: number; interest: number };
  /** Trả thẻ tín dụng: chỉ là chuyển nguồn, KHÔNG tính vào chi (đã tính lúc quẹt). */
  cardPayment: number;
  /** Tổng tiền dùng trong tháng = chi tiêu + tiết kiệm + dự phòng + cho vay + trả nợ. */
  used: number;
  /** Còn tự do = thu nhập − dùng. */
  free: number;
  unclassified: { count: number; total: number };
  byPurpose: PurposeActual[];
  /** Quẹt thẻ tín dụng trong tháng (nằm trong chi tiêu, tách ra để biết kỳ tới phải trả bao nhiêu). */
  cardSpending: number;
}

/**
 * Báo cáo một tháng. Luật chủ app chốt 9/2026:
 *  - Quẹt thẻ là chi tiêu tại lúc quẹt; trả thẻ (TRANSFER sang CARD) chỉ là chuyển nguồn.
 *  - Trả nợ vay (TRANSFER sang LOAN) tính vào "dùng" cả gốc lẫn lãi; lãi còn hiện riêng.
 *  - Giao dịch chưa có mục đích tính vào chi tiêu (LIVING) và đếm ở "chưa phân loại".
 */
export function monthReport(month: string, sources: SourceRow[], purposes: PurposeRow[], transactions: TransactionRow[]): MonthReport {
  const sourceKind = new Map(sources.map((source) => [source.id, source.kind]));
  const purposeById = new Map(purposes.map((purpose) => [purpose.id, purpose]));
  const actual = new Map<string, { actual: number; count: number }>();
  const bump = (purposeId: string | null, amount: number) => {
    if (!purposeId) return;
    const row = actual.get(purposeId) || { actual: 0, count: 0 };
    row.actual += amount;
    row.count += 1;
    actual.set(purposeId, row);
  };

  const report: MonthReport = {
    month,
    income: 0,
    living: 0,
    saving: 0,
    reserve: 0,
    lending: 0,
    debt: { total: 0, principal: 0, interest: 0 },
    cardPayment: 0,
    used: 0,
    free: 0,
    unclassified: { count: 0, total: 0 },
    byPurpose: [],
    cardSpending: 0,
  };

  for (const tx of transactions.filter((item) => item.month === month)) {
    const kind = tx.purposeId ? purposeById.get(tx.purposeId)?.kind : undefined;
    if (tx.kind === 'INCOME') {
      // Tiền vào mà gắn mục đích CHI (hoặc vào thẻ tín dụng chưa gắn gì) là HOÀN TIỀN: trừ bớt mục
      // đã chi chứ không phải thu nhập — Shopee trả lại 172k không làm lương tăng.
      const refund = (kind && kind !== 'INCOME') || (!tx.purposeId && sourceKind.get(tx.sourceId) === 'CARD');
      if (!refund) {
        report.income += tx.amount;
        bump(tx.purposeId, tx.amount);
        continue;
      }
      bump(tx.purposeId, -tx.amount);
      if (kind === 'SAVING') report.saving -= tx.amount;
      else if (kind === 'RESERVE') report.reserve -= tx.amount;
      else if (kind === 'LENDING') report.lending -= tx.amount;
      else if (kind === 'DEBT') {
        report.debt.total -= tx.amount;
        report.debt.interest -= tx.amount;
      } else report.living -= tx.amount;
      if (sourceKind.get(tx.sourceId) === 'CARD') report.cardSpending -= tx.amount;
      continue;
    }
    if (tx.kind === 'TRANSFER') {
      const targetKind = tx.targetSourceId ? sourceKind.get(tx.targetSourceId) : undefined;
      // Cho vay: tiền sang khoản LENT là cho vay thêm; từ LENT về là họ trả, trừ khỏi "cho vay" tháng này.
      if (targetKind === 'LENT') {
        report.lending += tx.amount;
        bump(tx.purposeId, tx.amount);
        continue;
      }
      if (sourceKind.get(tx.sourceId) === 'LENT') {
        report.lending -= tx.amount;
        bump(tx.purposeId, -tx.amount);
        continue;
      }
      if (targetKind === 'CARD') {
        report.cardPayment += tx.amount;
        continue;
      }
      if (targetKind === 'LOAN') {
        report.debt.total += tx.amount;
        report.debt.interest += tx.interest;
        report.debt.principal += tx.amount - tx.interest;
        bump(tx.purposeId, tx.amount);
        continue;
      }
      // Chuyển sang tài khoản/tiền mặt khác: nếu gắn mục đích tiết kiệm/dự phòng/cho vay thì tính
      // như khoản ấy (cất tiền sang sổ tiết kiệm), còn không thì chỉ là đảo tiền trong túi. Nguồn
      // đích là Tiết kiệm / Đầu tư thì tự tính là cất đi kể cả khi không gắn mục đích.
      if (kind === 'SAVING') report.saving += tx.amount;
      else if (kind === 'RESERVE') report.reserve += tx.amount;
      else if (kind === 'LENDING') report.lending += tx.amount;
      else if (isSavedSource(targetKind || '')) {
        report.saving += tx.amount;
        continue;
      } else if (isSavedSource(sourceKind.get(tx.sourceId) || '')) {
        // Rút sổ tiết kiệm / bán khoản đầu tư về tài khoản: trừ bớt phần đã cất trong tháng.
        report.saving -= tx.amount;
        continue;
      } else continue;
      bump(tx.purposeId, tx.amount);
      continue;
    }
    // EXPENSE
    if (sourceKind.get(tx.sourceId) === 'CARD') report.cardSpending += tx.amount;
    if (!tx.purposeId) {
      report.unclassified.count += 1;
      report.unclassified.total += tx.amount;
      report.living += tx.amount;
      continue;
    }
    bump(tx.purposeId, tx.amount);
    if (kind === 'SAVING') report.saving += tx.amount;
    else if (kind === 'RESERVE') report.reserve += tx.amount;
    else if (kind === 'LENDING') report.lending += tx.amount;
    else if (kind === 'DEBT') {
      report.debt.total += tx.amount;
      report.debt.interest += tx.amount;
    } else if (kind === 'INCOME') report.income -= tx.amount; // hoàn/trừ lương ghi nhầm chiều: coi như giảm thu
    else report.living += tx.amount;
  }

  report.used = report.living + report.saving + report.reserve + report.lending + report.debt.total;
  report.free = report.income - report.used;
  report.byPurpose = purposes
    .filter((purpose) => purpose.active || actual.has(purpose.id))
    .map((purpose) => ({ purpose, actual: actual.get(purpose.id)?.actual || 0, plan: purpose.monthlyPlan, count: actual.get(purpose.id)?.count || 0 }));
  return report;
}

export interface RecurringExpectation {
  recurring: RecurringRow;
  /** Tổng tiền dự kiến đi trong tháng (gốc + lãi nếu có). */
  expected: number;
  principal: number;
  interest: number;
  dueDate: Date;
  transaction: TransactionRow | null;
  paid: boolean;
  overdue: boolean;
}

/** Khoản định kỳ có hiệu lực trong tháng không. */
export function recurringActiveIn(recurring: RecurringRow, month: string): boolean {
  if (!recurring.active) return false;
  if (recurring.startMonth > month) return false;
  if (recurring.endMonth && recurring.endMonth < month) return false;
  return true;
}

/**
 * Dòng "dự kiến" của tháng cho từng khoản định kỳ. Lãi kiểu FROM_RATE tính trên dư nợ nguồn
 * đích ĐẦU THÁNG (`balancesAtStart`) × lãi suất năm / 12 — tức là chủ app không phải nhập lại
 * số lãi mỗi tháng, dư nợ giảm là lãi tự giảm.
 */
export function recurringExpectations(
  month: string,
  recurrings: RecurringRow[],
  balancesAtStart: Map<string, SourceBalance>,
  monthTransactions: TransactionRow[],
  today = new Date(),
): RecurringExpectation[] {
  const [year, monthIndex] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return recurrings
    .filter((recurring) => recurringActiveIn(recurring, month))
    .map((recurring) => {
      let interest = 0;
      if (recurring.interestMode === 'FROM_RATE' && recurring.targetSourceId) {
        const target = balancesAtStart.get(recurring.targetSourceId);
        if (target && target.balance > 0) interest = Math.round((target.balance * target.source.interestRate) / 100 / 12);
      }
      const principal = recurring.amount;
      const expected = principal + interest;
      const day = Math.min(Math.max(1, recurring.dayOfMonth || 1), lastDay);
      const dueDate = new Date(Date.UTC(year, monthIndex - 1, day, 12));
      const transaction = monthTransactions.find((tx) => tx.recurringId === recurring.id) || null;
      const paid = !!transaction;
      return { recurring, expected, principal, interest, dueDate, transaction, paid, overdue: !paid && today.getTime() > dueDate.getTime() + 24 * 60 * 60 * 1000 };
    });
}

/**
 * Giao dịch mới về (từ Telegram hay nhập tay) có phải là một khoản định kỳ đang chờ không: cùng
 * nguồn, chưa có giao dịch nào khớp, số tiền lệch không quá 2% (ngân hàng làm tròn lãi) và
 * chiều tiền đúng. Trả về khoản khớp gần nhất theo số tiền, hoặc null.
 */
export function matchRecurring(expectations: RecurringExpectation[], tx: Pick<TransactionRow, 'kind' | 'sourceId' | 'amount' | 'targetSourceId'>): RecurringExpectation | null {
  let best: RecurringExpectation | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const item of expectations) {
    if (item.paid) continue;
    const recurring = item.recurring;
    if (recurring.sourceId && recurring.sourceId !== tx.sourceId) continue;
    // Chi từ ngân hàng đọc được từ tin nhắn luôn là EXPENSE; khoản định kỳ kiểu TRANSFER (trả nợ)
    // vẫn được khớp — lúc ấy giao dịch sẽ được đổi thành TRANSFER theo khoản định kỳ.
    if (recurring.kind === 'INCOME' && tx.kind !== 'INCOME') continue;
    if (recurring.kind !== 'INCOME' && tx.kind === 'INCOME') continue;
    const gap = Math.abs(item.expected - tx.amount);
    const tolerance = Math.max(1000, item.expected * 0.02);
    if (gap > tolerance || gap >= bestGap) continue;
    best = item;
    bestGap = gap;
  }
  return best;
}

/** Tháng trước của `YYYY-MM`. */
export function previousMonth(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 2, 1));
  return date.toISOString().slice(0, 7);
}

/** Tháng sau của `YYYY-MM`. */
export function nextMonth(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthIndex, 1));
  return date.toISOString().slice(0, 7);
}

export interface LendingRow {
  /** Nội dung giao dịch (thường là tên người vay). */
  name: string;
  lent: number;
  repaid: number;
  outstanding: number;
}

/**
 * Sổ cho vay suy từ giao dịch gắn mục đích loại LENDING: chi = cho vay, thu = họ trả. Gom theo nội dung
 * (bỏ dấu, chữ thường) để "Anh A" và "anh a" là một người. Chủ app không muốn phải khai thêm nguồn cho
 * từng người (10/9/2026) — nguồn loại LENT chỉ là cách tuỳ chọn khi muốn theo dõi kỹ một người.
 */
/** Khoá gom tên người vay: bỏ dấu, chữ thường, gọn khoảng trắng — "Anh Sơn" và "anh son" là một. */
export function lendingKey(text: string): string {
  return (
    String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim() || '(khong ghi noi dung)'
  );
}

export function lendingLedger(purposes: PurposeRow[], transactions: TransactionRow[]): { rows: LendingRow[]; outstanding: number } {
  const lendingPurposes = new Set(purposes.filter((purpose) => purpose.kind === 'LENDING').map((purpose) => purpose.id));
  const byKey = new Map<string, LendingRow>();
  for (const tx of transactions) {
    if (!tx.purposeId || !lendingPurposes.has(tx.purposeId)) continue;
    if (tx.kind !== 'EXPENSE' && tx.kind !== 'INCOME') continue;
    const key = lendingKey(tx.description);
    const row = byKey.get(key) || { name: tx.description.trim() || '(không ghi nội dung)', lent: 0, repaid: 0, outstanding: 0 };
    if (tx.kind === 'EXPENSE') row.lent += tx.amount;
    else row.repaid += tx.amount;
    row.outstanding = row.lent - row.repaid;
    byKey.set(key, row);
  }
  const rows = [...byKey.values()].sort((a, b) => b.outstanding - a.outstanding || b.lent - a.lent);
  return { rows, outstanding: rows.reduce((sum, row) => sum + Math.max(0, row.outstanding), 0) };
}
