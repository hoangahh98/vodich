import { isDebtSource, isSavedSource } from './household-enums';

/**
 * Toán của module Chi tiêu — THUẦN, nhận mảng thuần (id đã về chuỗi, tiền đã về số) để test được
 * và để service chỉ lo truy vấn. Mọi con số hiển thị đều suy từ giao dịch, không có cột "số dư".
 */

export interface SourceRow {
  id: string;
  name: string;
  kind: string;
  /** Thẻ thông: id thẻ mà giao dịch của thẻ NÀY cũng làm đổi hạn mức. Null = không thẻ nào ăn theo. */
  limitSharesWith: string | null;
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
  /**
   * CARD: phần hạn mức đang bị chiếm = đã quẹt chưa trả của CHÍNH thẻ này cộng của mọi thẻ khai thẻ
   * thông là nó (quẹt thẻ ăn theo cũng ngốn hạn mức thẻ này). Từng thẻ kẹp ≥ 0 để thẻ đang "trả quá"
   * (sổ thiếu khoản quẹt) không nới hạn mức cho thẻ khác.
   */
  limitUsed: number;
  /** CARD: hạn mức còn = hạn mức khai tay − `limitUsed`, kẹp trong [0, hạn mức]. 0 = chưa khai hạn mức. */
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
    result.set(source.id, { source, balance, limitUsed: 0, available: 0 });
  }
  // HẠN MỨC CÒN của thẻ tín dụng (chủ app chốt 11/9/2026, thay luật "không khai hạn mức" ngày 10/9 vì
  // chờ mail báo hạn mức khả dụng thì số cứ lệch): hạn mức KHAI TAY trừ phần đã quẹt chưa trả — tức trừ
  // giao dịch quẹt thẻ, cộng lại giao dịch hoàn tiền / trả thẻ. Số này sổ có ngay, không phải chờ mail.
  // THẺ THÔNG vẫn phải nhớ: thẻ ăn theo bị trừ cả phần quẹt của mấy thẻ trỏ về nó (`affectsLimitOf`).
  const cards = sources.filter((item) => item.kind === 'CARD');
  for (const source of cards) {
    const item = result.get(source.id)!;
    item.limitUsed = cards.filter((card) => affectsLimitOf(card, source)).reduce((sum, card) => sum + Math.max(0, result.get(card.id)!.balance), 0);
    item.available = source.creditLimit ? Math.max(0, source.creditLimit - item.limitUsed) : 0;
  }
  return result;
}

/** Một lần ngân hàng báo số: giá trị, lúc nào, kèm id giao dịch mang tin đó (để so thứ tự). */
export interface BankMark {
  value: number;
  at: Date;
  txId: string;
}

/** Một giao dịch có mang số ngân hàng báo (mail Timo báo số dư, mail thẻ MSB báo hạn mức khả dụng). */
export interface ReportedRow {
  id: string;
  sourceId: string;
  targetSourceId: string | null;
  reportedBalance: number | null;
  reportedAvailable: number | null;
  occurredAt: Date;
}

/**
 * Gom số ngân hàng báo về đúng nguồn của nó, `rows` xếp MỚI → CŨ.
 *
 * Số dư thuộc phía TÀI KHOẢN, hạn mức khả dụng thuộc phía THẺ — xét RIÊNG từng số chứ không chọn
 * chung một "phía mail" cho cả dòng: một khoản trả thẻ (chuyển Timo → thẻ) mang cả số dư Timo lẫn
 * hạn mức khả dụng của thẻ, chọn chung thì hạn mức của thẻ bị gán nhầm sang Timo và ô "Ngân hàng báo
 * còn" của thẻ đứng im ở mail cũ (chủ app 11/9/2026: luôn lấy theo mail gần nhất).
 *
 * `availableWindows`: `last` là mail GẦN NHẤT, `first` là mail CŨ NHẤT của thẻ đó.
 */
export function collectBankMarks(rows: ReportedRow[], kindOf: (sourceId: string) => string) {
  const balanceMarks = new Map<string, BankMark>();
  const availableWindows = new Map<string, { first: BankMark; last: BankMark }>();
  // Phía nào của giao dịch là nguồn mà con số này nói về: ưu tiên nguồn, không hợp loại thì sang đích.
  const sideOf = (row: ReportedRow, kinds: string[]) => {
    if (kinds.includes(kindOf(row.sourceId))) return row.sourceId;
    if (row.targetSourceId && kinds.includes(kindOf(row.targetSourceId))) return row.targetSourceId;
    return row.sourceId;
  };
  for (const row of rows) {
    const mark = (value: number): BankMark => ({ value, at: row.occurredAt, txId: row.id });
    if (row.reportedBalance !== null) {
      // Lần đầu gặp một nguồn là mail gần nhất của nó (danh sách đang mới → cũ).
      const side = sideOf(row, ['BANK', 'CASH', 'SAVING', 'INVEST']);
      if (!balanceMarks.has(side)) balanceMarks.set(side, mark(row.reportedBalance));
    }
    if (row.reportedAvailable !== null) {
      const side = sideOf(row, ['CARD']);
      const current = availableWindows.get(side);
      const last = current ? current.last : mark(row.reportedAvailable);
      availableWindows.set(side, { first: mark(row.reportedAvailable), last });
    }
  }
  return { balanceMarks, availableWindows };
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
 * Giao dịch của `card` có làm đổi hạn mức khả dụng của `target` không: luôn đúng với chính nó, và đúng khi
 * `card` khai thẻ thông là `target`. Quan hệ CÓ HƯỚNG (chủ app 10/9/2026): thẻ 4768 và 8867 mỗi thẻ hạn
 * mức riêng nhưng đều trỏ về 3065 nên 3065 ăn theo cả hai, còn 4768 không ăn theo 8867. Hai thẻ thông nhau
 * (hai thẻ của vợ) thì trỏ lẫn nhau.
 */
export const affectsLimitOf = (card: SourceRow, target: SourceRow) => card.id === target.id || card.limitSharesWith === target.id;

/** Dòng tiền của một nguồn trong khoảng (from, to]: bỏ mốc `from`, tính cả mốc `to`. */
function flowBetween(source: SourceRow, transactions: TransactionRow[], from: BankMark | null, to: BankMark | null): number {
  const inRange = transactions.filter((tx) => {
    const afterFrom = !from || tx.occurredAt > from.at || (tx.occurredAt.getTime() === from.at.getTime() && BigInt(tx.id) > BigInt(from.txId));
    const beforeTo = !to || tx.occurredAt < to.at || (tx.occurredAt.getTime() === to.at.getTime() && BigInt(tx.id) <= BigInt(to.txId));
    return afterFrom && beforeTo;
  });
  return sourceBalances([{ ...source, openingBalance: 0 }], inRange).get(source.id)?.balance ?? 0;
}

/**
 * Số dư từng nguồn có đối chiếu với số ngân hàng báo trong mail (luật chủ app 10/9/2026):
 *
 *  - Tài khoản: mail Timo báo số dư → NGÂN HÀNG THẮNG, số dư = số trong mail gần nhất + giao dịch ghi
 *    sau mail đó. Sổ tính ra khác số ấy thì `diff` khác 0 — app KHÔNG tự bù, chỉ báo để chủ app thêm
 *    giao dịch còn thiếu bằng tay (tự bù là mất dấu khoản thiếu, tiền thật còn lại thành sai).
 *  - Thẻ tín dụng ĐÃ KHAI HẠN MỨC (chủ app 11/9/2026): hạn mức còn do SỔ tính (hạn mức khai − đã quẹt
 *    chưa trả của cả cụm thẻ thông), nên so thẳng số ấy với hạn mức khả dụng trong mail GẦN NHẤT — tính
 *    tại đúng thời điểm mail đó, không phải lúc này, vì sổ có thể đã ghi thêm giao dịch sau mail.
 *    `diff` > 0 = sổ còn nhiều hạn mức hơn ngân hàng → thiếu khoản quẹt (hoặc ô hạn mức khai to quá).
 *  - Thẻ CHƯA khai hạn mức: không có hạn mức tổng thì không suy ra dư nợ, `diff` đo từ mail đầu tới mail
 *    gần nhất — khả dụng phải giảm đúng bằng phần dư nợ sổ ghi tăng, tính trên CẢ CỤM THẺ THÔNG vì quẹt
 *    thẻ A thì mail thẻ B cũng đã trừ khoản ấy rồi. Hai thẻ khác hạn mức nhau vẫn đúng: chỉ so CHÊNH
 *    giữa hai lần báo của cùng một thẻ.
 */
export function reconcileSources(
  sources: SourceRow[],
  transactions: TransactionRow[],
  balanceMarks: Map<string, BankMark>,
  availableWindows: Map<string, { first: BankMark; last: BankMark }>,
): SourceCheck[] {
  const balances = sourceBalances(sources, transactions);
  const cards = sources.filter((item) => item.kind === 'CARD');
  return sources.map((source) => {
    const item = balances.get(source.id)!;
    const reported = balanceMarks.get(source.id) || null;
    const window = availableWindows.get(source.id) || null;
    if (reported) {
      const balance = reported.value + flowBetween(source, transactions, reported, null);
      return { ...item, balance, reported, reportedAvailable: window ? window.last : null, diff: Math.round(item.balance - balance), anchored: true };
    }
    let diff = 0;
    if (source.kind === 'CARD' && source.creditLimit && window) {
      // Đã khai hạn mức: so số tuyệt đối với mail gần nhất, tính phần đã quẹt chưa trả của cả cụm thẻ
      // thông TÍNH TỚI đúng mail đó (`affectsLimitOf`), từng thẻ kẹp ≥ 0 như khi hiện hạn mức còn.
      const usedThen = cards
        .filter((card) => affectsLimitOf(card, source))
        .reduce((sum, card) => sum + Math.max(0, card.openingBalance + flowBetween(card, transactions, null, window.last)), 0);
      diff = Math.round(source.creditLimit - usedThen - window.last.value);
    } else if (window && window.first.txId !== window.last.txId) {
      // Hạn mức khả dụng của thẻ này đổi theo giao dịch của CHÍNH NÓ và của mọi thẻ khai thẻ thông là nó.
      // Hạn mức mỗi thẻ một khác không sao: chỉ so CHÊNH giữa hai lần báo của CÙNG một thẻ, không bao giờ
      // so số tuyệt đối giữa các thẻ. Lệch bao nhiêu báo bấy nhiêu, KHÔNG có ngưỡng bỏ qua (chủ app
      // 10/9/2026: phải khớp từng đồng, lệch thẻ nào thì tra soát thẻ đó).
      const spent = cards.filter((card) => affectsLimitOf(card, source)).reduce((sum, card) => sum + flowBetween(card, transactions, window.first, window.last), 0);
      diff = Math.round(window.first.value - spent - window.last.value);
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
