import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  EXPENSE_KINDS,
  TRAVEL_SAVING,
  INCOME_KINDS,
  DEBT_DIRECTIONS,
  MonthReport,
  buildMonthReport,
  currentMonth,
  monthOf,
  normalizeMonth,
  parseBool,
  parseDateOnly,
  parseOptionalBigInt,
  parseVnd,
  pickOne,
  previousMonth,
} from './household-calc';

export { CategoryTotal, DebtView, MonthReport, MonthTotals, TRAVEL_SAVING } from './household-calc';

/** Một loại thu / loại chi như màn hình cần: đủ để dựng form sửa. */
export interface CategoryRow {
  id: bigint;
  name: string;
  kind: string;
  active: boolean;
  note: string;
}

/** Một khoản thu / khoản chi đã khai. */
export interface EntryRow {
  id: bigint;
  categoryId: bigint | null;
  occurredAt: Date;
  amount: bigint;
  principal: bigint;
  interest: bigint;
  debtId: bigint | null;
  note: string;
}

/** Mọi thứ một màn hình của module cần: số đã tính sẵn + các dòng thô của tháng đang xem. */
export interface HouseholdBook {
  report: MonthReport;
  incomeCategories: CategoryRow[];
  expenseCategories: CategoryRow[];
  incomes: EntryRow[];
  expenses: EntryRow[];
  debts: Array<{
    id: bigint;
    direction: string;
    name: string;
    counterparty: string;
    initialAmount: bigint;
    startDate: Date;
    dueDate: Date | null;
    note: string;
  }>;
}

/**
 * Kết quả một thao tác ghi: tháng cần quay về + lời báo cho người dùng.
 * Là `type` chứ không phải `interface` để controller đổ thẳng vào query string được
 * (interface không có index signature ngầm).
 */
export type WriteResult = {
  month: string;
  msg?: string;
  err?: string;
};

/**
 * Truy cập dữ liệu của MỘT sổ chi tiêu. Mọi phương thức đều nhận `householdId` là tham số
 * ĐẦU TIÊN và đưa nó vào mệnh đề `where` — kể cả khi đã có id của dòng con.
 *
 * Đó là chủ ý: lọc theo id sổ ngay trong câu truy vấn nghĩa là một admin gửi lên id khoản
 * chi của sổ người khác cũng không xoá/sửa được, thay vì phải nhớ kiểm tra quyền ở controller.
 *
 * Phần tính toán nằm ở household-calc.ts (thuần, test được không cần DB).
 * Việc chọn sổ nào và ai được vào nằm ở HouseholdAccessService.
 */
@Injectable()
export class HouseholdService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Cấu hình của sổ ───

  getConfig(householdId: number) {
    return this.prisma.householdConfig.findUnique({ where: { id: householdId } });
  }

  // ─── Sổ của một tháng ───

  /**
   * Đọc TOÀN BỘ sổ rồi mới tính. Số dư tiết kiệm và tiền còn lại đều cộng dồn qua các tháng
   * nên không thể chỉ lấy đúng một tháng — sổ một gia đình chỉ vài trăm dòng nên đọc hết là rẻ.
   */
  async book(householdId: number, rawMonth?: string): Promise<HouseholdBook> {
    const month = normalizeMonth(rawMonth) ?? currentMonth();
    const config = await this.requireConfig(householdId);
    const [incomeCategories, expenseCategories, incomes, expenses, debts] = await Promise.all([
      this.prisma.householdIncomeCategory.findMany({ where: { householdId }, orderBy: CATEGORY_ORDER }),
      this.prisma.householdExpenseCategory.findMany({ where: { householdId }, orderBy: CATEGORY_ORDER }),
      this.prisma.householdIncome.findMany({ where: { householdId }, orderBy: ENTRY_ORDER }),
      this.prisma.householdExpense.findMany({ where: { householdId }, orderBy: ENTRY_ORDER }),
      this.prisma.householdDebt.findMany({ where: { householdId }, orderBy: CATEGORY_ORDER }),
    ]);

    const report = buildMonthReport({ config, month, incomeCategories, expenseCategories, incomes, expenses, debts });

    // Các danh sách trả về đã lọc theo tháng đang xem — phần cộng dồn nằm hết trong `report`.
    return {
      report,
      incomeCategories,
      expenseCategories,
      incomes: incomes.filter((row) => row.month === month),
      expenses: expenses.filter((row) => row.month === month),
      debts,
    };
  }

  // ─── Loại thu nhập / loại chi phí ───

  addIncomeCategory(householdId: number, body: Record<string, string>) {
    return this.addCategory('householdIncomeCategory', INCOME_KINDS, householdId, body);
  }

  addExpenseCategory(householdId: number, body: Record<string, string>) {
    return this.addCategory('householdExpenseCategory', EXPENSE_KINDS, householdId, body);
  }

  updateIncomeCategory(householdId: number, id: bigint, body: Record<string, string>) {
    return this.updateCategory('householdIncomeCategory', INCOME_KINDS, householdId, id, body);
  }

  updateExpenseCategory(householdId: number, id: bigint, body: Record<string, string>) {
    return this.updateCategory('householdExpenseCategory', EXPENSE_KINDS, householdId, id, body);
  }

  /**
   * Xoá một loại. Các khoản đã khai theo loại đó KHÔNG mất — khoá ngoại đặt `SetNull` nên
   * chúng thành "(loại đã xoá)" và vẫn nằm trong công thức. Tiền đã ra khỏi nhà thì phải
   * còn trong sổ, kể cả khi cái nhãn bị bỏ đi.
   */
  deleteIncomeCategory(householdId: number, id: bigint) {
    return this.prisma.householdIncomeCategory.deleteMany({ where: { id, householdId } });
  }

  deleteExpenseCategory(householdId: number, id: bigint) {
    return this.prisma.householdExpenseCategory.deleteMany({ where: { id, householdId } });
  }

  // ─── Khoản thu ───

  addIncome(householdId: number, body: Record<string, string>) {
    return this.addEntry('income', householdId, body);
  }

  updateIncome(householdId: number, id: bigint, body: Record<string, string>) {
    return this.updateEntry('income', householdId, id, body);
  }

  async deleteIncome(householdId: number, id: bigint) {
    const row = await this.prisma.householdIncome.findFirst({ where: { id, householdId } });
    if (row) await this.prisma.householdIncome.deleteMany({ where: { id, householdId } });
    return row?.month ?? currentMonth();
  }

  /** Chép các khoản thu loại thường của tháng trước sang tháng đang xem — lương lặp y hệt. */
  copyIncomeFromPreviousMonth(householdId: number, rawMonth?: string): Promise<WriteResult> {
    return this.copyFromPreviousMonth('income', householdId, rawMonth);
  }

  // ─── Khoản chi ───

  addExpense(householdId: number, body: Record<string, string>) {
    return this.addEntry('expense', householdId, body);
  }

  /** Chép các khoản chi CỐ ĐỊNH của tháng trước — đó là những khoản tháng nào cũng phải trả. */
  copyExpenseFromPreviousMonth(householdId: number, rawMonth?: string): Promise<WriteResult> {
    return this.copyFromPreviousMonth('expense', householdId, rawMonth);
  }

  updateExpense(householdId: number, id: bigint, body: Record<string, string>) {
    return this.updateEntry('expense', householdId, id, body);
  }

  async deleteExpense(householdId: number, id: bigint) {
    const row = await this.prisma.householdExpense.findFirst({ where: { id, householdId } });
    if (row) await this.prisma.householdExpense.deleteMany({ where: { id, householdId } });
    return row?.month ?? currentMonth();
  }

  // ─── Sổ nợ ───

  async addDebt(householdId: number, body: Record<string, string>): Promise<WriteResult> {
    const month = normalizeMonth(body.month) ?? currentMonth();
    const name = text(body.name, 80);
    if (!name) return { month, err: 'Chưa đặt tên cho khoản nợ' };
    const last = await this.prisma.householdDebt.findFirst({ where: { householdId }, orderBy: { sortOrder: 'desc' } });
    await this.prisma.householdDebt.create({
      data: {
        householdId,
        direction: pickOne(body.direction, DEBT_DIRECTIONS, 'owe'),
        name,
        counterparty: text(body.counterparty, 80),
        initialAmount: BigInt(parseVnd(body.initialAmount)),
        startDate: parseDateOnly(body.startDate) ?? firstDayOf(month),
        dueDate: parseDateOnly(body.dueDate),
        note: text(body.note, 500),
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
    return { month, msg: 'Đã thêm khoản nợ' };
  }

  async updateDebt(householdId: number, id: bigint, body: Record<string, string>): Promise<WriteResult> {
    const month = normalizeMonth(body.month) ?? currentMonth();
    const debt = await this.prisma.householdDebt.findFirst({ where: { id, householdId } });
    if (!debt) return { month, err: 'Không tìm thấy khoản nợ trong sổ này' };
    await this.prisma.householdDebt.update({
      where: { id },
      data: {
        direction: body.direction === undefined ? debt.direction : pickOne(body.direction, DEBT_DIRECTIONS, 'owe'),
        name: text(body.name, 80) || debt.name,
        counterparty: text(body.counterparty, 80),
        initialAmount: BigInt(parseVnd(body.initialAmount)),
        startDate: parseDateOnly(body.startDate) ?? debt.startDate,
        dueDate: parseDateOnly(body.dueDate),
        note: text(body.note, 500),
      },
    });
    return { month, msg: 'Đã lưu khoản nợ' };
  }

  /**
   * Xoá một khoản nợ. Các khoản chi/thu từng trỏ vào nó vẫn còn (khoá ngoại `SetNull`) vì đó
   * là tiền thật đã trả — chỉ mất phần "trả cho khoản nào".
   */
  async deleteDebt(householdId: number, id: bigint): Promise<number> {
    const { count } = await this.prisma.householdDebt.deleteMany({ where: { id, householdId } });
    return count;
  }

  // ─── Dùng chung ───

  /**
   * Chép các khoản LẶP LẠI của tháng trước sang tháng đang xem: bên thu là loại `normal`
   * (lương), bên chi là loại `fixed` (học phí, gửi xe, tiền nhà).
   *
   * CHỈ chép đúng một kiểu đó. Chép "trả nợ" sang là tự trừ gốc một lần không có thật; chép
   * "gửi/rút tiết kiệm" sang là tự đụng vào két một lần không có thật; chép "phát sinh" sang
   * là bịa ra một khoản chưa hề tiêu. Cả ba đều làm sai số của người dùng mà họ không bấm gì.
   *
   * Loại nào tháng này đã có khoản rồi thì bỏ qua, nên bấm hai lần không sinh trùng.
   */
  private async copyFromPreviousMonth(side: 'income' | 'expense', householdId: number, rawMonth?: string): Promise<WriteResult> {
    const month = normalizeMonth(rawMonth) ?? currentMonth();
    const previous = previousMonth(month);
    const isIncome = side === 'income';
    // Hai bảng thu/chi có hình dạng y hệt nhau; ép về một kiểu hẹp để khỏi viết đôi toàn bộ
    // hàm này (kiểu union của Prisma không gọi thẳng được).
    const entries = (isIncome ? this.prisma.householdIncome : this.prisma.householdExpense) as unknown as EntryModel;
    const categories = (isIncome ? this.prisma.householdIncomeCategory : this.prisma.householdExpenseCategory) as unknown as CategoryModel;
    const kind = isIncome ? 'normal' : 'fixed';
    const what = isIncome ? 'khoản thu' : 'khoản chi cố định';

    const [source, existing, repeatable] = await Promise.all([
      entries.findMany({ where: { householdId, month: previous }, orderBy: { id: 'asc' } }),
      entries.findMany({ where: { householdId, month }, select: { categoryId: true } }),
      categories.findMany({ where: { householdId, kind }, select: { id: true } }),
    ]);

    const allowed = new Set(repeatable.map((row) => String(row.id)));
    const taken = new Set(existing.map((row) => String(row.categoryId)));
    const fresh = source.filter((row) => allowed.has(String(row.categoryId)) && !taken.has(String(row.categoryId)));
    if (!fresh.length) return { month, err: `Tháng ${label(previous)} không có ${what} nào mới để chép` };

    const data = fresh.map((row) => ({
      householdId,
      categoryId: row.categoryId,
      month,
      occurredAt: firstDayOf(month),
      amount: row.amount,
      note: row.note,
    }));
    if (isIncome) await this.prisma.householdIncome.createMany({ data });
    else await this.prisma.householdExpense.createMany({ data });

    return { month, msg: `Đã chép ${fresh.length} ${what} từ tháng ${label(previous)}` };
  }

  private async addCategory(
    model: 'householdIncomeCategory' | 'householdExpenseCategory',
    kinds: readonly string[],
    householdId: number,
    body: Record<string, string>,
  ): Promise<WriteResult> {
    const month = normalizeMonth(body.month) ?? currentMonth();
    const name = text(body.name, 80);
    if (!name) return { month, err: 'Chưa đặt tên cho loại này' };
    const last = await this.categories(model).findFirst({ where: { householdId }, orderBy: { sortOrder: 'desc' } });
    await this.categories(model).create({
      data: {
        householdId,
        name,
        kind: pickOne(body.kind, kinds, kinds[0]),
        note: text(body.note, 500),
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
    return { month, msg: 'Đã thêm loại mới' };
  }

  private async updateCategory(
    model: 'householdIncomeCategory' | 'householdExpenseCategory',
    kinds: readonly string[],
    householdId: number,
    id: bigint,
    body: Record<string, string>,
  ): Promise<WriteResult> {
    const month = normalizeMonth(body.month) ?? currentMonth();
    const category = await this.categories(model).findFirst({ where: { id, householdId } });
    if (!category) return { month, err: 'Không tìm thấy loại này trong sổ' };
    await this.categories(model).update({
      where: { id },
      data: {
        name: text(body.name, 80) || category.name,
        kind: body.kind === undefined ? category.kind : pickOne(body.kind, kinds, kinds[0]),
        note: text(body.note, 500),
        active: parseBool(body.active, category.active),
      },
    });
    return { month, msg: 'Đã lưu loại' };
  }

  /**
   * Sửa một khoản đã ghi. Dùng lại đúng bộ kiểm của `addEntry` (loại phải thuộc sổ này, khoản
   * nợ phải đúng chiều, số tiền phải hợp lệ) rồi ghi đè.
   *
   * CỐ Ý KHÔNG đụng tới dòng "dư chuyển sang quỹ du lịch" đã sinh ra lúc tạo: nó là một khoản
   * chi độc lập, hiện ngay trong danh sách và sửa/xoá được như mọi dòng khác. Tự động tính lại
   * nó ở đây nghĩa là một thao tác sửa lại âm thầm đổi một dòng khác — đúng kiểu phép tính ẩn
   * mà module này tránh từ đầu.
   */
  private async updateEntry(
    side: 'income' | 'expense',
    householdId: number,
    id: bigint,
    body: Record<string, string>,
  ): Promise<WriteResult> {
    const isIncome = side === 'income';
    const table = isIncome ? this.prisma.householdIncome : this.prisma.householdExpense;
    const existing = await (table as unknown as { findFirst(args: unknown): Promise<{ id: bigint; month: string } | null> }).findFirst({
      where: { id, householdId },
    });
    if (!existing) return { month: currentMonth(), err: `Không tìm thấy khoản ${isIncome ? 'thu' : 'chi'} trong sổ này` };

    const fields = await this.entryFields(side, householdId, body, id);
    if ('err' in fields) return { month: existing.month, ...fields };

    const data = isIncome ? fields.data : { ...fields.data, plannedAmount: BigInt(fields.planned) };
    if (isIncome) await this.prisma.householdIncome.updateMany({ where: { id, householdId }, data });
    else await this.prisma.householdExpense.updateMany({ where: { id, householdId }, data });

    return { month: fields.data.month, msg: `Đã lưu khoản ${isIncome ? 'thu' : 'chi'}` };
  }

  /**
   * Ghi một khoản thu hoặc một khoản chi. Tháng luôn suy ra từ NGÀY xảy ra, không theo tháng
   * đang xem — ghi lùi ngày là dòng đó tự về đúng tháng của nó.
   *
   * Loại `debt` thì số tiền = gốc + lãi và phải chọn một khoản nợ ĐÚNG CHIỀU: khoản chi chỉ
   * trả được khoản MÌNH NỢ, khoản thu chỉ thu được khoản NGƯỜI TA NỢ MÌNH. Chọn sai chiều
   * (hoặc chọn khoản của sổ khác) thì từ chối ghi, chứ không âm thầm bỏ liên kết — người
   * dùng sẽ tưởng đã trừ nợ xong.
   */
  /**
   * Dựng (và kiểm) các trường của một khoản thu/chi từ form. Dùng chung cho cả ghi mới lẫn
   * sửa, nên hai đường không thể lệch quy tắc nhau — đúng chỗ dễ sinh lỗ hổng nhất.
   */
  private async entryFields(
    side: 'income' | 'expense',
    householdId: number,
    body: Record<string, string>,
    excludeId?: bigint,
  ): Promise<{ err: string } | { data: EntryData; planned: number }> {
    const occurredAt = parseDateOnly(body.occurredAt) ?? today();
    const month = monthOf(occurredAt);
    const isIncome = side === 'income';

    const category = await this.ownedCategory(isIncome ? 'householdIncomeCategory' : 'householdExpenseCategory', householdId, body.categoryId);
    if (!category) return { err: `Chưa chọn loại ${isIncome ? 'thu nhập' : 'chi phí'}` };

    let amount = parseVnd(body.amount);
    let planned = 0;
    let principal = 0n;
    let interest = 0n;
    let debtId: bigint | null = null;

    // Khoản CỐ ĐỊNH có hai con số: mức dự kiến (sizing) và tiền đã chi thật. `amount` luôn là
    // tiền THẬT — mọi công thức tính từ nó. Bỏ trống ô "đã chi" là ĐÃ CHI 0đ (chưa tiêu đồng
    // nào), không phải "chi đúng dự kiến" — khi đó cả mức dự kiến dồn sang quỹ du lịch.
    if (category.kind === 'fixed') {
      planned = amount;
      amount = parseVnd(body.actualAmount);
    }

    if (category.kind === 'debt') {
      const wanted: (typeof DEBT_DIRECTIONS)[number] = isIncome ? 'lend' : 'owe';
      const debt = await this.prisma.householdDebt.findFirst({
        where: { id: parseOptionalBigInt(body.debtId) ?? -1n, householdId, direction: wanted },
        select: { id: true, initialAmount: true },
      });
      if (!debt) {
        return { err: isIncome ? 'Chưa chọn khoản cho vay để ghi tiền người ta trả về' : 'Chưa chọn khoản nợ để trừ tiền gốc' };
      }
      debtId = debt.id;
      principal = BigInt(parseVnd(body.principal));
      interest = BigInt(parseVnd(body.interest));
      amount = Number(principal + interest);
      if (amount <= 0) return { err: 'Gốc và lãi đều đang để trống' };

      // Không trả được QUÁ số còn nợ. Trả dư thì "còn lại" của khoản đó âm, mà mọi ô tổng đều
      // kẹp về 0 (household-calc) — tiền thừa biến mất im lặng, đúng kiểu sai số khó truy nhất.
      // Lúc SỬA một dòng thì bỏ chính nó ra khỏi phần đã trả, không thì tự đụng trần của mình.
      const remaining = Number(debt.initialAmount) - (await this.principalPaid(side, householdId, debt.id, excludeId));
      if (Number(principal) > remaining) {
        const left = remaining > 0 ? `chỉ còn ${vnd(remaining)}` : 'đã tất toán';
        return {
          err: isIncome
            ? `Khoản cho vay này ${left} chưa thu về — ghi gốc nhiều hơn thế là sai sổ`
            : `Khoản nợ này ${left} — không trả gốc nhiều hơn số còn nợ được`,
        };
      }
    }

    // Loại cố định chỉ cần có MỨC DỰ KIẾN: đã chi 0đ là hợp lệ (chưa tiêu đồng nào tháng này).
    if (category.kind === 'fixed' ? planned <= 0 : amount <= 0) {
      return { err: category.kind === 'fixed' ? 'Số tiền dự kiến phải lớn hơn 0' : 'Số tiền phải lớn hơn 0' };
    }

    return {
      planned,
      data: {
        householdId,
        categoryId: category.id,
        month,
        occurredAt,
        amount: BigInt(amount),
        principal,
        interest,
        debtId,
        note: text(body.note, 500),
      },
    };
  }

  /**
   * Ghi một khoản thu hoặc một khoản chi. Tháng luôn suy ra từ NGÀY xảy ra, không theo tháng
   * đang xem — ghi lùi ngày là dòng đó tự về đúng tháng của nó.
   */
  private async addEntry(side: 'income' | 'expense', householdId: number, body: Record<string, string>): Promise<WriteResult> {
    const fallbackMonth = normalizeMonth(body.month) ?? currentMonth();
    const fields = await this.entryFields(side, householdId, body);
    if ('err' in fields) return { month: fallbackMonth, ...fields };

    const { data, planned } = fields;
    const month = data.month;
    if (side === 'income') {
      await this.prisma.householdIncome.create({ data });
      return { month, msg: 'Đã ghi khoản thu' };
    }

    await this.prisma.householdExpense.create({ data: { ...data, plannedAmount: BigInt(planned) } });

    // Phần dư giữa dự kiến và đã chi KHÔNG được ghi thành dòng riêng: nó là số SUY RA ở
    // household-calc (ô "Còn du lịch"). Ghi thành dòng thì dòng đó vừa lẫn vào danh sách
    // khoản chi vừa sửa được — sửa xong là lệch khỏi các khoản cố định đã sinh ra nó.
    const spare = planned - Number(data.amount);
    return { month, msg: spare > 0 ? `Đã ghi khoản chi · dư ${vnd(spare)} vào quỹ du lịch` : 'Đã ghi khoản chi' };
  }

  /**
   * Tổng tiền GỐC đã ghi cho một khoản nợ, bỏ qua dòng `excludeId` (dòng đang được sửa).
   * Bên chi trừ khoản MÌNH NỢ, bên thu trừ khoản MÌNH CHO VAY — đúng như household-calc tính,
   * nên số "còn nợ" mà màn hình bày ra và số mà bộ kiểm dùng luôn là một.
   */
  private async principalPaid(side: 'income' | 'expense', householdId: number, debtId: bigint, excludeId?: bigint): Promise<number> {
    const table = (side === 'income' ? this.prisma.householdIncome : this.prisma.householdExpense) as unknown as EntryModel;
    const rows = await table.findMany({
      where: { householdId, debtId, ...(excludeId === undefined ? {} : { id: { not: excludeId } }) },
      select: { principal: true },
    });
    return rows.reduce((total, row) => total + Number(row.principal ?? 0n), 0);
  }

  /** Một loại của ĐÚNG sổ này — gửi lên id loại của sổ khác thì trả null. */
  private ownedCategory(
    model: 'householdIncomeCategory' | 'householdExpenseCategory',
    householdId: number,
    raw: unknown,
  ): Promise<{ id: bigint; kind: string } | null> {
    const id = parseOptionalBigInt(raw);
    if (id === null) return Promise.resolve(null);
    return this.categories(model).findFirst({ where: { id, householdId }, select: { id: true, kind: true } });
  }

  /** Hai bảng loại có hình dạng y hệt nhau, nên dùng chung một kiểu để khỏi viết đôi. */
  private categories(model: 'householdIncomeCategory' | 'householdExpenseCategory') {
    return this.prisma[model] as unknown as CategoryModel;
  }

  private async requireConfig(householdId: number) {
    const config = await this.getConfig(householdId);
    if (!config) throw new Error(`Không tìm thấy sổ chi tiêu #${householdId}`);
    return config;
  }
}

/** Phần giao nhau của hai model loại thu / loại chi — đủ cho các thao tác dùng chung ở trên. */
interface CategoryModel {
  findFirst(args: unknown): Promise<{ id: bigint; name: string; kind: string; active: boolean; sortOrder: number } | null>;
  findMany(args: unknown): Promise<Array<{ id: bigint }>>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
}

/** Các trường chung của một khoản thu/chi khi ghi xuống DB. */
interface EntryData {
  householdId: number;
  categoryId: bigint;
  month: string;
  occurredAt: Date;
  amount: bigint;
  principal: bigint;
  interest: bigint;
  debtId: bigint | null;
  note: string;
}

/** Phần giao nhau của hai bảng khoản thu / khoản chi. */
interface EntryModel {
  findMany(args: unknown): Promise<Array<{ categoryId: bigint | null; amount: bigint; note: string; principal?: bigint }>>;
}

const CATEGORY_ORDER = [{ sortOrder: 'asc' as const }, { id: 'asc' as const }];
const ENTRY_ORDER = [{ occurredAt: 'desc' as const }, { id: 'desc' as const }];

function vnd(value: number): string {
  return `${new Intl.NumberFormat('en-US').format(value)}đ`;
}

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

/** Ngày hôm nay quy về nửa đêm UTC — cùng quy ước với parseDateOnly, khớp cột DATE. */
function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function firstDayOf(month: string): Date {
  return new Date(`${month}-01T00:00:00Z`);
}

function label(month: string): string {
  return `${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;
}
