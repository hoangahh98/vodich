import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  CATEGORY_KINDS,
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

export { CategoryTotal, DebtView, MonthReport, MonthTotals } from './household-calc';

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
    active: boolean;
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

  async updateConfig(householdId: number, body: Record<string, string>) {
    const anchor = parseDateOnly(body.anchorDate);
    await this.prisma.householdConfig.update({
      where: { id: householdId },
      data: {
        name: text(body.name, 120) || 'Sổ chi tiêu gia đình',
        ...(anchor ? { anchorDate: anchor } : {}),
      },
    });
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
    return this.addCategory('householdIncomeCategory', householdId, body);
  }

  addExpenseCategory(householdId: number, body: Record<string, string>) {
    return this.addCategory('householdExpenseCategory', householdId, body);
  }

  updateIncomeCategory(householdId: number, id: bigint, body: Record<string, string>) {
    return this.updateCategory('householdIncomeCategory', householdId, id, body);
  }

  updateExpenseCategory(householdId: number, id: bigint, body: Record<string, string>) {
    return this.updateCategory('householdExpenseCategory', householdId, id, body);
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

  async deleteIncome(householdId: number, id: bigint) {
    const row = await this.prisma.householdIncome.findFirst({ where: { id, householdId } });
    if (row) await this.prisma.householdIncome.deleteMany({ where: { id, householdId } });
    return row?.month ?? currentMonth();
  }

  /**
   * Chép các khoản thu của tháng trước sang tháng đang xem — lương thường lặp y hệt.
   *
   * CHỈ chép loại `normal`. Khoản "người ta trả nợ" chép sang là tự trừ gốc một lần không có
   * thật, còn "rút tiết kiệm" chép sang là tự móc két một lần không có thật — cả hai đều làm
   * sai số của người dùng mà họ không hề bấm gì.
   */
  async copyIncomeFromPreviousMonth(householdId: number, rawMonth?: string): Promise<WriteResult> {
    const month = normalizeMonth(rawMonth) ?? currentMonth();
    const previous = previousMonth(month);
    const [source, existing, plainCategories] = await Promise.all([
      this.prisma.householdIncome.findMany({ where: { householdId, month: previous }, orderBy: { id: 'asc' } }),
      this.prisma.householdIncome.findMany({ where: { householdId, month }, select: { categoryId: true } }),
      this.prisma.householdIncomeCategory.findMany({ where: { householdId, kind: 'normal' }, select: { id: true } }),
    ]);
    const plain = new Set(plainCategories.map((row) => String(row.id)));
    const taken = new Set(existing.map((row) => String(row.categoryId)));
    const fresh = source.filter((row) => plain.has(String(row.categoryId)) && !taken.has(String(row.categoryId)));
    if (!fresh.length) {
      return { month, err: `Tháng ${label(previous)} không có khoản thu nào mới để chép` };
    }
    await this.prisma.householdIncome.createMany({
      data: fresh.map((row) => ({
        householdId,
        categoryId: row.categoryId,
        month,
        occurredAt: firstDayOf(month),
        amount: row.amount,
        note: row.note,
      })),
    });
    return { month, msg: `Đã chép ${fresh.length} khoản thu từ tháng ${label(previous)}` };
  }

  // ─── Khoản chi ───

  addExpense(householdId: number, body: Record<string, string>) {
    return this.addEntry('expense', householdId, body);
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
        active: parseBool(body.active, debt.active),
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

  // ─── Nạp danh mục mẫu ───

  /**
   * Dựng sẵn vài loại thu/chi thường gặp để sổ mới có cái mà sửa, thay vì bắt gõ lại từ con
   * số không. Chỉ nạp phần nào đang RỖNG, nên bấm hai lần không sinh trùng.
   * KHÔNG nạp sẵn khoản nợ hay số tiền nào — tiền là của chủ sổ, tự khai.
   */
  async seedTemplate(householdId: number, rawMonth?: string): Promise<WriteResult> {
    const month = normalizeMonth(rawMonth) ?? currentMonth();
    const [incomeCount, expenseCount] = await Promise.all([
      this.prisma.householdIncomeCategory.count({ where: { householdId } }),
      this.prisma.householdExpenseCategory.count({ where: { householdId } }),
    ]);
    const added: string[] = [];

    if (!incomeCount) {
      await this.prisma.householdIncomeCategory.createMany({
        data: SEED_INCOME_CATEGORIES.map((row, index) => ({ householdId, ...row, sortOrder: index + 1 })),
      });
      added.push('loại thu nhập');
    }

    if (!expenseCount) {
      await this.prisma.householdExpenseCategory.createMany({
        data: SEED_EXPENSE_CATEGORIES.map((row, index) => ({ householdId, ...row, sortOrder: index + 1 })),
      });
      added.push('loại chi phí');
    }

    return added.length
      ? { month, msg: `Đã nạp mẫu: ${added.join(' và ')}` }
      : { month, err: 'Các loại đã có sẵn, không nạp thêm gì' };
  }

  // ─── Dùng chung ───

  private async addCategory(
    model: 'householdIncomeCategory' | 'householdExpenseCategory',
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
        kind: pickOne(body.kind, CATEGORY_KINDS, 'normal'),
        note: text(body.note, 500),
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
    return { month, msg: 'Đã thêm loại mới' };
  }

  private async updateCategory(
    model: 'householdIncomeCategory' | 'householdExpenseCategory',
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
        kind: body.kind === undefined ? category.kind : pickOne(body.kind, CATEGORY_KINDS, 'normal'),
        note: text(body.note, 500),
        active: parseBool(body.active, category.active),
      },
    });
    return { month, msg: 'Đã lưu loại' };
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
  private async addEntry(kind: 'income' | 'expense', householdId: number, body: Record<string, string>): Promise<WriteResult> {
    const occurredAt = parseDateOnly(body.occurredAt) ?? today();
    const month = monthOf(occurredAt);
    const fallbackMonth = normalizeMonth(body.month) ?? month;
    const isIncome = kind === 'income';

    const category = await this.ownedCategory(isIncome ? 'householdIncomeCategory' : 'householdExpenseCategory', householdId, body.categoryId);
    if (!category) return { month: fallbackMonth, err: `Chưa chọn loại ${isIncome ? 'thu nhập' : 'chi phí'}` };

    let amount = parseVnd(body.amount);
    let principal = 0n;
    let interest = 0n;
    let debtId: bigint | null = null;

    if (category.kind === 'debt') {
      const wanted: (typeof DEBT_DIRECTIONS)[number] = isIncome ? 'lend' : 'owe';
      const debt = await this.prisma.householdDebt.findFirst({
        where: { id: parseOptionalBigInt(body.debtId) ?? -1n, householdId, direction: wanted },
        select: { id: true },
      });
      if (!debt) {
        return {
          month: fallbackMonth,
          err: isIncome
            ? 'Chưa chọn khoản cho vay để ghi tiền người ta trả về'
            : 'Chưa chọn khoản nợ để trừ tiền gốc',
        };
      }
      debtId = debt.id;
      principal = BigInt(parseVnd(body.principal));
      interest = BigInt(parseVnd(body.interest));
      amount = Number(principal + interest);
      if (amount <= 0) return { month: fallbackMonth, err: 'Gốc và lãi đều đang để trống' };
    }

    if (amount <= 0) return { month: fallbackMonth, err: 'Số tiền phải lớn hơn 0' };

    const data = {
      householdId,
      categoryId: category.id,
      month,
      occurredAt,
      amount: BigInt(amount),
      principal,
      interest,
      debtId,
      note: text(body.note, 500),
    };
    if (isIncome) await this.prisma.householdIncome.create({ data });
    else await this.prisma.householdExpense.create({ data });

    return { month, msg: isIncome ? 'Đã ghi khoản thu' : 'Đã ghi khoản chi' };
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
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
}

const CATEGORY_ORDER = [{ sortOrder: 'asc' as const }, { id: 'asc' as const }];
const ENTRY_ORDER = [{ occurredAt: 'desc' as const }, { id: 'desc' as const }];

const SEED_INCOME_CATEGORIES = [
  { name: 'Lương vợ', kind: 'normal', note: '' },
  { name: 'Lương chồng', kind: 'normal', note: '' },
  { name: 'Thưởng / OT', kind: 'normal', note: '' },
  { name: 'Thu khác', kind: 'normal', note: '' },
  { name: 'Rút tiết kiệm', kind: 'saving', note: 'Lấy tiền từ két ra tiêu — không phải thu nhập' },
  { name: 'Người ta trả nợ', kind: 'debt', note: 'Gốc trừ vào khoản mình cho vay trong sổ nợ' },
];

const SEED_EXPENSE_CATEGORIES = [
  { name: 'Ăn uống', kind: 'normal', note: '' },
  { name: 'Sinh hoạt', kind: 'normal', note: '' },
  { name: 'Xăng xe / đi lại', kind: 'normal', note: '' },
  { name: 'Tiền học của con', kind: 'normal', note: '' },
  { name: 'Bỉm sữa của con', kind: 'normal', note: '' },
  { name: 'Đưa ông bà', kind: 'normal', note: '' },
  { name: 'Chi phí phát sinh', kind: 'normal', note: '' },
  { name: 'Tiết kiệm 2 vợ chồng', kind: 'saving', note: 'Dồn qua các tháng' },
  { name: 'Tiết kiệm con', kind: 'saving', note: 'Dồn qua các tháng' },
  { name: 'Dự phòng', kind: 'saving', note: 'Dồn qua các tháng' },
  { name: 'Trả nợ', kind: 'debt', note: 'Nhập gốc & lãi, gốc trừ vào khoản nợ được chọn' },
];

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
