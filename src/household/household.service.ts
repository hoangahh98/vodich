import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  EXTRA_SOURCES,
  FIXED_MODES,
  FUND_DIRECTIONS,
  FUND_KINDS,
  MonthReport,
  buildMonthReport,
  clampInt,
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

export { MonthReport, FundView, DebtView, FixedCostView, WeekView } from './household-calc';

/** Mọi thứ một màn hình của module cần: số đã tính sẵn + các dòng thô để dựng form sửa. */
export interface HouseholdBook {
  report: MonthReport;
  incomes: Array<{ id: bigint; source: string; amount: bigint; note: string }>;
  funds: Array<{ id: bigint; name: string; kind: string; monthlyAmount: bigint; startMonth: string; active: boolean }>;
  fundEntries: Array<{ id: bigint; fundId: bigint; occurredAt: Date; direction: string; amount: bigint; note: string }>;
  debts: Array<{ id: bigint; name: string; initialAmount: bigint; startMonth: string; active: boolean; note: string }>;
  fixedCosts: Array<{
    id: bigint;
    name: string;
    mode: string;
    capAmount: bigint;
    weeklyRate: bigint | null;
    startMonth: string;
    active: boolean;
    note: string;
  }>;
  fixedSpends: Array<{ id: bigint; costId: bigint; occurredAt: Date; amount: bigint; note: string }>;
  extraCosts: Array<{
    id: bigint;
    occurredAt: Date;
    name: string;
    amount: bigint;
    source: string;
    fixedCostId: bigint | null;
    fundId: bigint | null;
    note: string;
  }>;
}

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
        weeklyRate: BigInt(parseVnd(body.weeklyRate)),
        weekStartDow: clampInt(body.weekStartDow, 0, 6, 1),
        ...(anchor ? { anchorDate: anchor } : {}),
      },
    });
  }

  // ─── Sổ của một tháng ───

  /**
   * Đọc TOÀN BỘ sổ rồi mới tính. Số dư quỹ và tiền "còn thừa" đều cộng dồn qua các tháng,
   * nên không thể chỉ lấy đúng một tháng — sổ một gia đình chỉ vài trăm dòng nên đọc hết là rẻ.
   */
  async book(householdId: number, rawMonth?: string): Promise<HouseholdBook> {
    const month = normalizeMonth(rawMonth) ?? currentMonth();
    const config = await this.requireConfig(householdId);
    const [incomes, funds, fundEntries, debts, debtPayments, fixedCosts, fixedSpends, extraCosts] = await Promise.all([
      this.prisma.householdIncome.findMany({ where: { householdId }, orderBy: { id: 'asc' } }),
      this.prisma.householdFund.findMany({ where: { householdId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      this.prisma.householdFundEntry.findMany({ where: { householdId }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.householdDebt.findMany({ where: { householdId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      this.prisma.householdDebtPayment.findMany({ where: { householdId } }),
      this.prisma.householdFixedCost.findMany({ where: { householdId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      this.prisma.householdFixedSpend.findMany({ where: { householdId }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.householdExtraCost.findMany({ where: { householdId }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] }),
    ]);

    const report = buildMonthReport({
      config,
      month,
      incomes,
      funds,
      fundEntries,
      debts,
      debtPayments,
      fixedCosts,
      fixedSpends,
      extraCosts,
    });

    // Các danh sách trả về đã lọc theo tháng đang xem — phần cộng dồn nằm hết trong `report`.
    return {
      report,
      incomes: incomes.filter((r) => r.month === month),
      funds,
      fundEntries: fundEntries.filter((r) => r.month === month),
      debts,
      fixedCosts,
      fixedSpends: fixedSpends.filter((r) => r.month === month),
      extraCosts: extraCosts.filter((r) => r.month === month),
    };
  }

  // ─── 1. Thu ───
  async addIncome(householdId: number, body: Record<string, string>) {
    const month = normalizeMonth(body.month) ?? currentMonth();
    const source = text(body.source, 80);
    const amount = parseVnd(body.amount);
    if (!source || amount <= 0) return month;
    await this.prisma.householdIncome.create({
      data: { householdId, month, source, amount: BigInt(amount), note: text(body.note, 500) },
    });
    return month;
  }

  async deleteIncome(householdId: number, id: bigint) {
    const row = await this.prisma.householdIncome.findFirst({ where: { id, householdId } });
    if (row) await this.prisma.householdIncome.deleteMany({ where: { id, householdId } });
    return row?.month ?? currentMonth();
  }

  /** Chép các khoản thu của tháng trước sang tháng đang xem — lương thường lặp y hệt. */
  async copyIncomeFromPreviousMonth(householdId: number, rawMonth?: string) {
    const month = normalizeMonth(rawMonth) ?? currentMonth();
    const [source, existing] = await Promise.all([
      this.prisma.householdIncome.findMany({ where: { householdId, month: previousMonth(month) }, orderBy: { id: 'asc' } }),
      this.prisma.householdIncome.findMany({ where: { householdId, month }, select: { source: true } }),
    ]);
    const taken = new Set(existing.map((r) => r.source.toLowerCase()));
    const fresh = source.filter((r) => !taken.has(r.source.toLowerCase()));
    if (fresh.length) {
      await this.prisma.householdIncome.createMany({
        data: fresh.map((r) => ({ householdId, month, source: r.source, amount: r.amount, note: r.note })),
      });
    }
    return { month, copied: fresh.length };
  }

  // ─── 2. Tiết kiệm ───
  async addFund(householdId: number, body: Record<string, string>) {
    const name = text(body.name, 80);
    if (!name) return;
    const last = await this.prisma.householdFund.findFirst({ where: { householdId }, orderBy: { sortOrder: 'desc' } });
    await this.prisma.householdFund.create({
      data: {
        householdId,
        name,
        kind: pickOne(body.kind, FUND_KINDS, 'accumulate'),
        monthlyAmount: BigInt(parseVnd(body.monthlyAmount)),
        startMonth: normalizeMonth(body.startMonth) ?? currentMonth(),
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
  }

  async updateFund(householdId: number, id: bigint, body: Record<string, string>) {
    const fund = await this.prisma.householdFund.findFirst({ where: { id, householdId } });
    if (!fund) return;
    await this.prisma.householdFund.update({
      where: { id },
      data: {
        name: text(body.name, 80) || fund.name,
        kind: body.kind === undefined ? fund.kind : pickOne(body.kind, FUND_KINDS, fund.kind as 'accumulate'),
        monthlyAmount: BigInt(parseVnd(body.monthlyAmount)),
        startMonth: normalizeMonth(body.startMonth) ?? fund.startMonth,
        active: parseBool(body.active, fund.active),
      },
    });
  }

  async deleteFund(householdId: number, id: bigint): Promise<number> {
    // Khoản phát sinh từng khai "lấy từ quỹ này" chuyển thành khoản chi mới, để tiền đã ra
    // khỏi nhà vẫn nằm trong công thức thay vì biến mất cùng cái quỹ.
    await this.detachExtras(householdId, { fundId: id });
    const { count } = await this.prisma.householdFund.deleteMany({ where: { id, householdId } });
    return count;
  }

  /** Nạp thêm / rút ra khỏi một quỹ. Tháng luôn lấy theo NGÀY xảy ra, không theo tháng đang xem. */
  async addFundEntry(householdId: number, body: Record<string, string>) {
    const occurredAt = parseDateOnly(body.occurredAt) ?? new Date();
    const month = monthOf(occurredAt);
    const amount = parseVnd(body.amount);
    const fundId = await this.ownedId('householdFund', householdId, body.fundId);
    if (!fundId || amount <= 0) return normalizeMonth(body.month) ?? month;
    await this.prisma.householdFundEntry.create({
      data: {
        householdId,
        fundId,
        month,
        occurredAt,
        direction: pickOne(body.direction, FUND_DIRECTIONS, 'out'),
        amount: BigInt(amount),
        note: text(body.note, 500),
      },
    });
    return month;
  }

  async deleteFundEntry(householdId: number, id: bigint) {
    const row = await this.prisma.householdFundEntry.findFirst({ where: { id, householdId } });
    if (row) await this.prisma.householdFundEntry.deleteMany({ where: { id, householdId } });
    return row?.month ?? currentMonth();
  }

  // ─── 3. Trả nợ ───
  async addDebt(householdId: number, body: Record<string, string>) {
    const name = text(body.name, 80);
    if (!name) return;
    const last = await this.prisma.householdDebt.findFirst({ where: { householdId }, orderBy: { sortOrder: 'desc' } });
    await this.prisma.householdDebt.create({
      data: {
        householdId,
        name,
        initialAmount: BigInt(parseVnd(body.initialAmount)),
        startMonth: normalizeMonth(body.startMonth) ?? currentMonth(),
        note: text(body.note, 500),
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
  }

  async updateDebt(householdId: number, id: bigint, body: Record<string, string>) {
    const debt = await this.prisma.householdDebt.findFirst({ where: { id, householdId } });
    if (!debt) return;
    await this.prisma.householdDebt.update({
      where: { id },
      data: {
        name: text(body.name, 80) || debt.name,
        initialAmount: BigInt(parseVnd(body.initialAmount)),
        startMonth: normalizeMonth(body.startMonth) ?? debt.startMonth,
        note: text(body.note, 500),
        active: parseBool(body.active, debt.active),
      },
    });
  }

  async deleteDebt(householdId: number, id: bigint): Promise<number> {
    const { count } = await this.prisma.householdDebt.deleteMany({ where: { id, householdId } });
    return count;
  }

  /**
   * Gốc + lãi của một khoản nợ trong một tháng. Ghi ĐÈ chứ không cộng thêm: mỗi khoản nợ
   * chỉ có một dòng mỗi tháng (khoá duy nhất ở DB), nên bấm Lưu nhiều lần cũng không trả trùng.
   */
  async saveDebtPayment(householdId: number, body: Record<string, string>) {
    const month = normalizeMonth(body.month) ?? currentMonth();
    const debtId = await this.ownedId('householdDebt', householdId, body.debtId);
    if (!debtId) return month;
    const principal = BigInt(parseVnd(body.principal));
    const interest = BigInt(parseVnd(body.interest));
    const note = text(body.note, 500);
    const existing = await this.prisma.householdDebtPayment.findFirst({ where: { householdId, debtId, month } });
    if (existing) {
      await this.prisma.householdDebtPayment.updateMany({
        where: { id: existing.id, householdId },
        data: { principal, interest, note },
      });
    } else {
      await this.prisma.householdDebtPayment.create({ data: { householdId, debtId, month, principal, interest, note } });
    }
    return month;
  }

  // ─── 4. Chi phí cố định ───
  async addFixedCost(householdId: number, body: Record<string, string>) {
    const name = text(body.name, 80);
    if (!name) return;
    const last = await this.prisma.householdFixedCost.findFirst({ where: { householdId }, orderBy: { sortOrder: 'desc' } });
    await this.prisma.householdFixedCost.create({
      data: {
        householdId,
        name,
        mode: pickOne(body.mode, FIXED_MODES, 'once'),
        capAmount: BigInt(parseVnd(body.capAmount)),
        weeklyRate: ownRate(body.weeklyRate),
        startMonth: normalizeMonth(body.startMonth) ?? currentMonth(),
        note: text(body.note, 500),
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
  }

  async updateFixedCost(householdId: number, id: bigint, body: Record<string, string>) {
    const cost = await this.prisma.householdFixedCost.findFirst({ where: { id, householdId } });
    if (!cost) return;
    await this.prisma.householdFixedCost.update({
      where: { id },
      data: {
        name: text(body.name, 80) || cost.name,
        mode: body.mode === undefined ? cost.mode : pickOne(body.mode, FIXED_MODES, cost.mode as 'once'),
        capAmount: BigInt(parseVnd(body.capAmount)),
        weeklyRate: ownRate(body.weeklyRate),
        startMonth: normalizeMonth(body.startMonth) ?? cost.startMonth,
        note: text(body.note, 500),
        active: parseBool(body.active, cost.active),
      },
    });
  }

  async deleteFixedCost(householdId: number, id: bigint): Promise<number> {
    await this.detachExtras(householdId, { fixedCostId: id });
    const { count } = await this.prisma.householdFixedCost.deleteMany({ where: { id, householdId } });
    return count;
  }

  async addFixedSpend(householdId: number, body: Record<string, string>) {
    const occurredAt = parseDateOnly(body.occurredAt) ?? new Date();
    const month = monthOf(occurredAt);
    const amount = parseVnd(body.amount);
    const costId = await this.ownedId('householdFixedCost', householdId, body.costId);
    if (!costId || amount <= 0) return normalizeMonth(body.month) ?? month;
    await this.prisma.householdFixedSpend.create({
      data: { householdId, costId, month, occurredAt, amount: BigInt(amount), note: text(body.note, 500) },
    });
    return month;
  }

  async deleteFixedSpend(householdId: number, id: bigint) {
    const row = await this.prisma.householdFixedSpend.findFirst({ where: { id, householdId } });
    if (row) await this.prisma.householdFixedSpend.deleteMany({ where: { id, householdId } });
    return row?.month ?? currentMonth();
  }

  // ─── 5. Chi phí phát sinh ───

  /**
   * Nguồn tiền quyết định khoản này có trừ thêm vào phần còn thừa hay không, nên id nguồn
   * phải thuộc đúng sổ này — gửi lên id của sổ khác thì hạ về "khoản chi mới".
   *
   * Giao diện gửi lên MỘT ô chọn `pick` dạng `new` / `fixed:<id>` / `fund:<id>` để người
   * dùng chỉ phải chọn một lần thay vì vừa chọn loại vừa chọn khoản.
   */
  async addExtraCost(householdId: number, body: Record<string, string>) {
    const occurredAt = parseDateOnly(body.occurredAt) ?? new Date();
    const month = monthOf(occurredAt);
    const name = text(body.name, 120);
    const amount = parseVnd(body.amount);
    if (!name || amount <= 0) return normalizeMonth(body.month) ?? month;

    const [rawSource, rawId] = String(body.pick ?? 'new').split(':');
    let source = pickOne(rawSource, EXTRA_SOURCES, 'new');
    let fixedCostId: bigint | null = null;
    let fundId: bigint | null = null;
    if (source === 'fixed') fixedCostId = await this.ownedId('householdFixedCost', householdId, rawId);
    if (source === 'fund') fundId = await this.ownedId('householdFund', householdId, rawId);
    if ((source === 'fixed' && !fixedCostId) || (source === 'fund' && !fundId)) source = 'new';

    await this.prisma.householdExtraCost.create({
      data: {
        householdId,
        month,
        occurredAt,
        name,
        amount: BigInt(amount),
        source,
        fixedCostId,
        fundId,
        note: text(body.note, 500),
      },
    });
    return month;
  }

  async deleteExtraCost(householdId: number, id: bigint) {
    const row = await this.prisma.householdExtraCost.findFirst({ where: { id, householdId } });
    if (row) await this.prisma.householdExtraCost.deleteMany({ where: { id, householdId } });
    return row?.month ?? currentMonth();
  }

  // ─── Nạp danh mục mẫu ───

  /**
   * Dựng sẵn đúng các dòng trong bảng tính chiphi.xlsx để sổ mới có cái mà sửa, thay vì bắt
   * gõ lại từ con số không. Chỉ nạp phần nào đang RỖNG, nên bấm hai lần không sinh trùng.
   */
  async seedTemplate(householdId: number, rawMonth?: string) {
    const month = normalizeMonth(rawMonth) ?? currentMonth();
    const [funds, debts, fixedCosts, incomes] = await Promise.all([
      this.prisma.householdFund.count({ where: { householdId } }),
      this.prisma.householdDebt.count({ where: { householdId } }),
      this.prisma.householdFixedCost.count({ where: { householdId } }),
      this.prisma.householdIncome.count({ where: { householdId, month } }),
    ]);
    const added: string[] = [];

    if (!incomes) {
      await this.prisma.householdIncome.createMany({
        data: [
          { householdId, month, source: 'Lương vợ', amount: 30000000n, note: '' },
          { householdId, month, source: 'Lương chồng', amount: 35000000n, note: '' },
        ],
      });
      added.push('khoản thu');
    }

    if (!funds) {
      await this.prisma.householdFund.createMany({
        data: [
          { householdId, name: 'Tiết kiệm 2 vợ chồng', kind: 'accumulate', monthlyAmount: 20000000n, startMonth: month, sortOrder: 1 },
          { householdId, name: 'Tiết kiệm con', kind: 'accumulate', monthlyAmount: 2000000n, startMonth: month, sortOrder: 2 },
          { householdId, name: 'Dự phòng', kind: 'reserve', monthlyAmount: 3000000n, startMonth: month, sortOrder: 3 },
          { householdId, name: 'Y tế', kind: 'reserve', monthlyAmount: 3000000n, startMonth: month, sortOrder: 4 },
          { householdId, name: 'Đi chơi', kind: 'fun', monthlyAmount: 0n, startMonth: month, sortOrder: 5 },
        ],
      });
      added.push('quỹ tiết kiệm');
    }

    if (!debts) {
      const debt = await this.prisma.householdDebt.create({
        data: { householdId, name: 'Ngân hàng', initialAmount: 904000000n, startMonth: month, sortOrder: 1 },
      });
      await this.prisma.householdDebtPayment.create({
        data: { householdId, debtId: debt.id, month, principal: 4000000n, interest: 5000000n },
      });
      added.push('khoản nợ');
    }

    if (!fixedCosts) {
      await this.prisma.householdFixedCost.createMany({
        data: [
          { householdId, name: 'Gửi xe ô tô', mode: 'once', capAmount: 800000n, startMonth: month, sortOrder: 1, note: 'Thường chi hết luôn 1 lần' },
          { householdId, name: 'Xăng xe', mode: 'gradual', capAmount: 2000000n, startMonth: month, sortOrder: 2, note: 'Cập nhật theo mỗi lần đổ' },
          { householdId, name: 'Tiền học của con', mode: 'once', capAmount: 6000000n, startMonth: month, sortOrder: 3, note: 'Thường chi hết luôn 1 lần' },
          { householdId, name: 'Bỉm sữa của con', mode: 'gradual', capAmount: 2000000n, startMonth: month, sortOrder: 4, note: 'Cập nhật theo mỗi lần mua' },
          { householdId, name: 'Đưa ông bà', mode: 'once', capAmount: 9000000n, startMonth: month, sortOrder: 5, note: 'Thường chi hết luôn 1 lần' },
          { householdId, name: 'Gửi xe máy', mode: 'once', capAmount: 350000n, startMonth: month, sortOrder: 6, note: 'Thường chi hết luôn 1 lần' },
          { householdId, name: 'Sinh hoạt vợ', mode: 'weekly', capAmount: 0n, startMonth: month, sortOrder: 7, note: 'Theo tuần, tính từ thứ Hai đầu tiên của tháng' },
          { householdId, name: 'Sinh hoạt chồng', mode: 'weekly', capAmount: 0n, startMonth: month, sortOrder: 8, note: 'Theo tuần, tính từ thứ Hai đầu tiên của tháng' },
          { householdId, name: 'Sinh hoạt con', mode: 'gradual', capAmount: 500000n, startMonth: month, sortOrder: 9, note: 'Cập nhật theo việc chi tiêu của con' },
        ],
      });
      added.push('chi phí cố định');
    }

    return { month, added };
  }

  // ─── Dùng chung ───

  /** Id của một dòng con, CHỈ khi nó thuộc đúng sổ này — nếu không thì null. */
  private async ownedId(
    model: 'householdFund' | 'householdFixedCost' | 'householdDebt',
    householdId: number,
    raw: unknown,
  ): Promise<bigint | null> {
    const id = parseOptionalBigInt(raw);
    if (id === null) return null;
    const row = await (this.prisma[model] as { findFirst(args: unknown): Promise<{ id: bigint } | null> }).findFirst({
      where: { id, householdId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /** Cắt liên kết nguồn của các khoản phát sinh trước khi xoá quỹ / khoản cố định của chúng. */
  private detachExtras(householdId: number, link: { fundId?: bigint; fixedCostId?: bigint }) {
    return this.prisma.householdExtraCost.updateMany({
      where: { householdId, ...link },
      data: { source: 'new', fundId: null, fixedCostId: null },
    });
  }

  private async requireConfig(householdId: number) {
    const config = await this.getConfig(householdId);
    if (!config) throw new Error(`Không tìm thấy sổ chi tiêu #${householdId}`);
    return config;
  }
}

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

/** Mức tuần riêng của một khoản; bỏ trống ⇒ null để bám theo mức chung ở Cài đặt. */
function ownRate(value: unknown): bigint | null {
  const amount = parseVnd(value);
  return amount > 0 ? BigInt(amount) : null;
}
