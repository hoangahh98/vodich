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
 *      Nhưng "còn lại" CHƯA phải tiền rảnh: khoản cố định đã khai mức dự kiến mà chưa tiêu
 *      thì tiền vẫn nằm đó nhưng đã có chỗ. Nên tách thêm:
 *
 *        Ngân sách còn = Σ (dự kiến − đã chi) của khoản cố định trong tháng
 *        Còn tự do     = còn lại − ngân sách còn        ← tiền chưa hứa hẹn với ai
 *
 *      (Gửi tiết kiệm nằm ở vế trừ, rút tiết kiệm nằm ở vế cộng — nên tiền không đếm hai lần:
 *       cất vào két thì rời khỏi ví, lấy ra tiêu thì quay lại ví.)
 *
 *   5. SỔ NỢ hai chiều. Còn lại của một khoản nợ = số ban đầu − Σ tiền GỐC đã trả cho đúng
 *      khoản đó. Lãi là tiền ra khỏi nhà nhưng KHÔNG làm giảm nợ. Không trả được QUÁ số còn
 *      nợ: chặn ngay lúc ghi (xem HouseholdService.entryFields), vì trả dư thì "còn lại" âm
 *      mà mọi ô tổng đều kẹp về 0 — tiền thừa biến mất không dấu vết.
 *
 *   6. VƯỢT CHI và lấy tiền để dành ra bù. Hai kiểu vượt, khác hẳn nhau:
 *
 *        a) VƯỢT MỨC DỰ KIẾN — một khoản cố định chi nhiều hơn mức đã khai.
 *           Tiền vẫn còn trong ví (nó chỉ phá vỡ KẾ HOẠCH), nhưng phần dư của các khoản cố
 *           định chính là thứ dồn nên 🏖️ quỹ du lịch — nên phần vượt ăn thẳng vào quỹ đó.
 *
 *        b) HỤT TIỀN MẶT — tiêu nhiều hơn kiếm được, tiền mặt luỹ kế âm.
 *           Đây là thiếu tiền THẬT, chỉ có một chỗ để lấy: 🐷 tiết kiệm. Phần lấy ra được
 *           coi như một lần RÚT TIẾT KIỆM suy ra: két giảm bao nhiêu thì ví tăng lại bấy
 *           nhiêu, nếu không tổng tài sản bị trừ hai lần (ví đã âm rồi lại trừ tiếp két).
 *
 *      Thứ tự lấy vẫn là quỹ du lịch trước, tiết kiệm sau — nhưng tiết kiệm CHỈ vào cuộc khi
 *      ví thật sự âm. Ví còn tiền mà vẫn trừ két là bịa ra một lần rút tiền không có thật.
 *      Cạn cả hai mà vẫn thiếu thì `uncovered` > 0 — cảnh báo nặng nhất của module.
 *
 *      Cảnh báo đỏ trên màn hình thì rộng hơn phần bù: bật khi (a) có loại vượt mức dự kiến
 *      của THÁNG ĐANG XEM, hoặc (b) tổng chi tháng đó lớn hơn tổng thu — kể cả khi các tháng
 *      trước còn dư nhiều nên chưa phải móc tới đồng tiết kiệm nào.
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

/**
 * Quỹ du lịch — số SUY RA, không phải dòng ghi trong sổ.
 *
 *   Còn du lịch = Σ (dự kiến − đã chi) của MỌI khoản cố định
 *               − Σ các khoản chi khai vào loại tên "Tiết kiệm du lịch"
 *
 * Vì sao suy ra chứ không ghi thành dòng: nó *kế thừa* từ rất nhiều khoản cố định, nên nếu
 * ghi thành một dòng riêng thì dòng đó vừa lẫn vào danh sách khoản chi, vừa sửa được — sửa
 * xong là nó lệch khỏi các khoản đã sinh ra nó và không còn cách nào biết số nào đúng.
 * Suy ra thì luôn khớp với dữ liệu gốc, và không có gì để sửa sai.
 *
 * Tiền của quỹ này VẪN NẰM TRONG "còn lại" — nó chỉ là phần đã đánh dấu để dành đi chơi,
 * chưa rời khỏi ví. Tiêu vào nó thì khai một khoản chi bình thường vào loại cùng tên.
 */
export const TRAVEL_SAVING = 'Tiết kiệm du lịch';

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
  /** Chỉ khoản CHI mới có: mức dự kiến của khoản cố định. Khoản thu luôn bỏ trống. */
  plannedAmount?: bigint;
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
  amount: number; // tiền ĐÃ CHI/THU thật
  count: number;
  /**
   * Chiếm bao nhiêu phần trăm TỔNG CHI (hoặc tổng thu) của tháng. 0 nếu nhóm rỗng.
   *
   * KHÁC HẲN `usedPercent` — đừng lẫn. Khoản duy nhất của tháng luôn có `share` = 100%
   * dù mới tiêu một phần nhỏ mức dự kiến; chính chỗ này từng làm chủ sổ hiểu nhầm.
   */
  share: number;
  /** Tổng mức DỰ KIẾN của các khoản trong loại (chỉ khoản cố định mới có). 0 = không đặt mức. */
  planned: number;
  /** Đã tiêu bao nhiêu phần trăm mức dự kiến. 0 nếu loại không đặt mức. */
  usedPercent: number;
  /**
   * Chi VƯỢT mức dự kiến bao nhiêu tiền. 0 nếu chưa vượt hoặc loại không đặt mức.
   * Tính theo TỪNG KHOẢN rồi cộng lại, không phải `amount − planned` của cả loại: hai khoản
   * cùng loại, một khoản dư một khoản vượt thì phần dư không được che lấp phần vượt.
   */
  over: number;
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
  plannedTotal: number; // tổng mức DỰ KIẾN đã khai cho tháng
  /** Dự kiến − đã chi của tháng đang xem: tiền còn nằm trong ví nhưng đã có chỗ. */
  budgetLeft: number;
  /** Còn lại của tháng, trừ đi phần ngân sách chưa tiêu — tiền thật sự chưa hứa với ai. */
  freeThisMonth: number;
  /** Còn tự do luỹ kế: tiền mặt trừ quỹ du lịch đã chốt và ngân sách tháng này chưa tiêu. */
  freeTotal: number;
  /** Tháng đang xem chi vượt mức dự kiến bao nhiêu (cộng phần vượt của từng khoản cố định). */
  overspend: number;
  /** Như trên nhưng luỹ kế từ đầu sổ tới hết tháng đang xem — đây mới là số quỹ du lịch gánh. */
  overspendTotal: number;
  /** Tháng đang xem chi nhiều hơn thu bao nhiêu. 0 = tháng đó vẫn dư. */
  deficit: number;
  /** Tiền mặt luỹ kế đang âm bao nhiêu — số tiền THẬT phải móc từ tiết kiệm ra. */
  cashShort: number;
  /** Phần vượt mức dự kiến mà 🏖️ quỹ du lịch gánh được. */
  coverFromTravel: number;
  /** Phần hụt tiền mặt mà 🐷 tiết kiệm gánh được. Đã trừ vào `savingBalance`, cộng lại vào ví. */
  coverFromSaving: number;
  /** Cạn cả quỹ du lịch lẫn tiết kiệm mà vẫn còn thiếu bấy nhiêu — cảnh báo nặng nhất. */
  uncovered: number;
  savingNet: number; // gửi − rút trong tháng đang xem
  /** ← số của ô 🐷: tiền đã CẤT ĐI, dồn qua các tháng. Quỹ du lịch tính riêng, xem TRAVEL_SAVING. */
  savingBalance: number;
  travelYear: number; // năm của tháng đang xem, cho nhãn "Còn du lịch năm ..."
  travelThisYear: number; // quỹ du lịch dồn được trong RIÊNG năm đó (bỏ vào − lấy ra)
  travelAllTime: number; // quỹ du lịch dồn từ đầu sổ tới hết tháng đang xem
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
  /** Mốc "bây giờ" để biết tháng nào đã đóng. Test truyền vào; chạy thật thì bỏ trống. */
  now?: Date;
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

  // Quỹ du lịch: CỘNG phần dư của mọi khoản cố định, TRỪ các khoản chi khai vào loại cùng tên.
  //
  // CHỈ tính phần dư của THÁNG ĐÃ ĐÓNG. Tháng đang sống mà đã tính là sai hẳn ý nghĩa: bỉm sữa
  // khai 2tr chưa mua ngày nào thì đó là ngân sách chưa tiêu, không phải tiền tiết kiệm được —
  // giữa tháng con số quỹ sẽ bị phóng đại rồi tụt dần, nhìn chẳng tin được gì.
  const openMonth = monthKey(input.now ?? new Date());
  const travelSpendIds = new Set(
    input.expenseCategories.filter((c) => c.name.trim().toLowerCase() === TRAVEL_SAVING.toLowerCase()).map((c) => String(c.id)),
  );
  const isTravelRow = (row: EntryLike) => travelSpendIds.has(String(row.categoryId));
  const spare = (row: EntryLike) => (isTravelRow(row) ? 0 : Math.max(0, Number(row.plannedAmount ?? 0n) - amount(row)));
  // Không đặt mức dự kiến (planned = 0) thì không có gì để vượt — khoản phát sinh mà đem so
  // với 0 thì đồng nào cũng thành "vượt". Khoản tiêu vào quỹ du lịch cũng bỏ qua, đối xứng với
  // `spare`: nó đã bị trừ thẳng khỏi quỹ ở `travelBalance`, tính là vượt nữa là trừ hai lần.
  const over = (row: EntryLike) => {
    const planned = Number(row.plannedAmount ?? 0n);
    return !isTravelRow(row) && planned > 0 ? Math.max(0, amount(row) - planned) : 0;
  };
  const closed = (row: EntryLike) => row.month < openMonth;
  const travelBalance = (from?: string) => {
    const rows = from ? expenses.filter((row) => row.month >= from) : expenses;
    return sum(rows, (row) => (isTravelRow(row) ? -amount(row) : closed(row) ? spare(row) : 0));
  };
  const yearStart = `${month.slice(0, 4)}-01`;

  // Ngân sách chưa tiêu: của riêng tháng đang xem (cho dải số), và của các tháng CHƯA đóng
  // (cho số luỹ kế — tháng đã đóng thì phần dư đã nằm trong quỹ du lịch rồi, trừ nữa là trừ hai lần).
  const plannedTotal = sum(expenseRows, (row) => Number(row.plannedAmount ?? 0n));
  const budgetLeft = sum(expenseRows, spare);
  const budgetOpen = sum(expenses, (row) => (closed(row) ? 0 : spare(row)));

  // Phần VƯỢT mức dự kiến. Ngược với `spare`, nó tính cả tháng ĐANG SỐNG: tiêu lố là chuyện
  // đã rồi, không phải chờ hết tháng mới biết như phần dư.
  const overspend = sum(expenseRows, over);
  const overspendTotal = sum(expenses, over);

  // GỬI / RÚT tiết kiệm của tháng, tính CẢ quỹ du lịch. Hai số này phải trọn vẹn vì phép tính
  // tiền mặt ở dưới dựa vào chúng: "còn lại = thu + rút − chi − gửi" chỉ đúng khi không sót
  // đồng nào. Ô 🐷 trên màn hình dùng bộ `...Other` (không gồm du lịch) ở ngay dưới.
  const savingIn = sum(expenseRows, (row) => (expenseKind(row) === 'saving' ? amount(row) : 0));
  const savingOut = sum(incomeRows, (row) => (incomeKind(row) === 'saving' ? amount(row) : 0));

  // Ô 🐷 "Tiết kiệm đang có": tiền đã CẤT ĐI thật, luỹ kế qua các tháng. Không dính gì tới quỹ
  // du lịch — quỹ đó là số suy ra từ phần dư của khoản cố định, tiền vẫn nằm trong "còn lại".
  const savingRaw =
    sum(expenses, (row) => (expenseKind(row) === 'saving' ? amount(row) : 0)) -
    sum(incomes, (row) => (incomeKind(row) === 'saving' ? amount(row) : 0));
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

  const leftoverRaw = leftoverByMonth.get(month) ?? 0;
  const leftoverRawTotal = [...leftoverByMonth.values()].reduce((total, value) => total + value, 0);

  // ─── Vượt chi thì lấy tiền để dành ra bù (rule 6 đầu file) ───
  //
  // Quỹ du lịch gánh phần VƯỢT MỨC DỰ KIẾN (nó vốn dồn từ phần dư của chính các khoản cố định
  // đó). Tiết kiệm gánh phần HỤT TIỀN MẶT, và chỉ khi ví thật sự âm — ví còn tiền mà trừ két
  // là bịa ra một lần rút không có thật.
  const travelRaw = travelBalance();
  const deficit = Math.max(0, expense - income);
  const cashShort = Math.max(0, -leftoverRawTotal);
  const coverFromTravel = Math.min(Math.max(0, travelRaw), overspendTotal);
  const coverFromSaving = Math.min(Math.max(0, savingRaw), cashShort);
  const uncovered = cashShort - coverFromSaving;

  // Phần móc từ két là một lần RÚT TIẾT KIỆM suy ra: két giảm thì ví phải tăng lại đúng bấy
  // nhiêu, nếu không tổng tài sản bị trừ hai lần.
  const savingBalance = savingRaw - coverFromSaving;
  const leftover = leftoverRaw + coverFromSaving;
  const leftoverTotal = leftoverRawTotal + coverFromSaving;
  const travelAllTime = travelRaw - coverFromTravel;

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
    travelYear: Number(month.slice(0, 4)),
    // Phần bù trừ vào cả số của năm: quỹ chỉ có một, nhìn số năm nay mà chưa trừ thì tưởng
    // vẫn còn tiền đi chơi.
    travelThisYear: Math.max(0, travelBalance(yearStart) - coverFromTravel),
    travelAllTime,
    plannedTotal,
    budgetLeft,
    overspend,
    overspendTotal,
    deficit,
    cashShort,
    coverFromTravel,
    coverFromSaving,
    uncovered,
    freeThisMonth: leftover - budgetLeft,
    freeTotal: leftoverTotal - travelAllTime - budgetOpen,
    leftover,
    leftoverPrevious: leftoverTotal - leftover,
    leftoverTotal,
    incomeByCategory: groupByCategory(incomeRows, input.incomeCategories, (kind) => kind !== 'saving', over),
    expenseByCategory: groupByCategory(expenseRows, input.expenseCategories, (kind) => kind !== 'saving', over),
    savingByCategory: groupByCategory(expenseRows, input.expenseCategories, (kind) => kind === 'saving', over),
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
function groupByCategory(
  rows: EntryLike[],
  categories: CategoryLike[],
  keep: (kind: string) => boolean,
  over: (row: EntryLike) => number,
): CategoryTotal[] {
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
      planned: 0,
      usedPercent: 0,
      over: 0,
    };
    bucket.amount += amount(row);
    bucket.planned += Number(row.plannedAmount ?? 0n);
    bucket.over += over(row);
    bucket.count += 1;
    totals.set(id, bucket);
  }

  const list = [...totals.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'vi'));
  const total = list.reduce((all, item) => all + item.amount, 0);
  for (const item of list) {
    item.share = total > 0 ? Math.round((item.amount / total) * 100) : 0;
    item.usedPercent = item.planned > 0 ? Math.round((item.amount / item.planned) * 100) : 0;
  }
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
