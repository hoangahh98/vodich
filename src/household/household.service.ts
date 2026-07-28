import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  ALLOCATION_KINDS,
  HouseholdSummary,
  buildSummary,
  clampInt,
  currentMonth,
  monthAllowanceCost,
  normalizeCycle,
  normalizeMonth,
  ownAllowance,
  parseDateOnly,
  parseOptionalBigInt,
  parseVnd,
  previousMonth,
  sumAmount,
} from './household-calc';

export { HouseholdSummary, MemberWallet } from './household-calc';

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
    const weekStartDow = clampInt(body.weekStartDow, 0, 6, 1);
    const anchor = parseDateOnly(body.anchorDate);
    const weeklyAllowance = BigInt(parseVnd(body.weeklyAllowance));
    await this.prisma.householdConfig.update({
      where: { id: householdId },
      data: { weeklyAllowance, weekStartDow, ...(anchor ? { anchorDate: anchor } : {}) },
    });
  }

  // ─── Thành viên nhận tiền tiêu ───
  listMembers(householdId: number) {
    return this.prisma.householdMember.findMany({
      where: { householdId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  async addMember(householdId: number, body: Record<string, string>) {
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) return;
    const config = await this.requireConfig(householdId);
    const startedOn = parseDateOnly(body.startedOn) ?? config.anchorDate;
    const last = await this.prisma.householdMember.findFirst({ where: { householdId }, orderBy: { sortOrder: 'desc' } });
    await this.prisma.householdMember.create({
      data: {
        householdId,
        name,
        cycle: normalizeCycle(body.cycle),
        allowance: ownAllowance(body.allowance, config.weeklyAllowance),
        startedOn,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
  }

  async updateMember(householdId: number, id: bigint, body: Record<string, string>) {
    const member = await this.prisma.householdMember.findFirst({ where: { id, householdId } });
    if (!member) return;
    const config = await this.requireConfig(householdId);
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

  /**
   * Xoá thành viên; các khoản chi của người đó chuyển thành "chi chung" (FK SetNull).
   * Trả về số dòng đã xoá để controller phân biệt "đã xoá" với "id không thuộc sổ này".
   */
  async deleteMember(householdId: number, id: bigint): Promise<number> {
    const { count } = await this.prisma.householdMember.deleteMany({ where: { id, householdId } });
    return count;
  }

  // ─── Thu nhập & phân bổ theo tháng ───
  async monthBook(householdId: number, rawMonth?: string): Promise<MonthBook> {
    const month = normalizeMonth(rawMonth) ?? currentMonth();
    const config = await this.requireConfig(householdId);
    const [incomes, allocations, incomeMonths, allocMonths, members] = await Promise.all([
      this.prisma.householdIncome.findMany({ where: { householdId, month }, orderBy: { id: 'asc' } }),
      this.prisma.householdAllocation.findMany({ where: { householdId, month }, orderBy: { id: 'asc' } }),
      this.prisma.householdIncome.findMany({ where: { householdId }, distinct: ['month'], select: { month: true } }),
      this.prisma.householdAllocation.findMany({ where: { householdId }, distinct: ['month'], select: { month: true } }),
      this.listMembers(householdId),
    ]);

    const { allowanceCost, weeksInMonth } = monthAllowanceCost(month, config, members);
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
      weeksInMonth,
      leftover: incomeTotal - manualAllocationTotal - allowanceCost,
      months,
    };
  }

  async addIncome(householdId: number, body: Record<string, string>) {
    const month = normalizeMonth(body.month) ?? currentMonth();
    const source = String(body.source || '').trim().slice(0, 80);
    const amount = parseVnd(body.amount);
    if (!source || amount <= 0) return month;
    await this.prisma.householdIncome.create({
      data: { householdId, month, source, amount: BigInt(amount), note: String(body.note || '').trim().slice(0, 500) },
    });
    return month;
  }

  async deleteIncome(householdId: number, id: bigint) {
    const row = await this.prisma.householdIncome.findFirst({ where: { id, householdId } });
    if (row) await this.prisma.householdIncome.deleteMany({ where: { id, householdId } });
    return row?.month ?? currentMonth();
  }

  async addAllocation(householdId: number, body: Record<string, string>) {
    const month = normalizeMonth(body.month) ?? currentMonth();
    const name = String(body.name || '').trim().slice(0, 80);
    const amount = parseVnd(body.amount);
    if (!name || amount <= 0) return month;
    await this.prisma.householdAllocation.create({
      data: {
        householdId,
        month,
        kind: (ALLOCATION_KINDS as readonly string[]).includes(body.kind) ? body.kind : 'other',
        name,
        amount: BigInt(amount),
        note: String(body.note || '').trim().slice(0, 500),
      },
    });
    return month;
  }

  async deleteAllocation(householdId: number, id: bigint) {
    const row = await this.prisma.householdAllocation.findFirst({ where: { id, householdId } });
    if (row) await this.prisma.householdAllocation.deleteMany({ where: { id, householdId } });
    return row?.month ?? currentMonth();
  }

  /**
   * Chép các khoản trích của tháng trước sang tháng đang xem (bỏ qua khoản đã có
   * cùng tên) — các khoản tiết kiệm / trả nợ thường lặp lại y hệt mỗi tháng.
   */
  async copyAllocationsFromPreviousMonth(householdId: number, rawMonth?: string): Promise<{ month: string; copied: number }> {
    const month = normalizeMonth(rawMonth) ?? currentMonth();
    const previous = previousMonth(month);
    const [source, existing] = await Promise.all([
      this.prisma.householdAllocation.findMany({ where: { householdId, month: previous }, orderBy: { id: 'asc' } }),
      this.prisma.householdAllocation.findMany({ where: { householdId, month }, select: { name: true } }),
    ]);
    const taken = new Set(existing.map((a) => a.name.toLowerCase()));
    const fresh = source.filter((a) => !taken.has(a.name.toLowerCase()));
    if (fresh.length) {
      await this.prisma.householdAllocation.createMany({
        data: fresh.map((a) => ({ householdId, month, kind: a.kind, name: a.name, amount: a.amount, note: a.note })),
      });
    }
    return { month, copied: fresh.length };
  }

  // ─── Chi tiêu ───
  listTxns(householdId: number, limit = 200) {
    return this.prisma.householdTxn.findMany({
      where: { householdId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: { member: { select: { name: true } } },
    });
  }

  async addTxn(householdId: number, body: Record<string, string>) {
    const amount = parseVnd(body.amount);
    if (amount <= 0) return;
    // Không tin memberId gửi lên: người đó phải thuộc đúng sổ này, nếu không thì tính là chi chung.
    const memberId = await this.memberIdInHousehold(householdId, parseOptionalBigInt(body.memberId));
    await this.prisma.householdTxn.create({
      data: {
        householdId,
        occurredAt: parseDateOnly(body.occurredAt) ?? new Date(),
        memberId,
        amount: BigInt(amount),
        description: String(body.description || '').trim().slice(0, 500),
      },
    });
  }

  /** Sửa một khoản chi = xoá rồi nhập lại (giống module đội bóng), nên không có updateTxn. */
  async deleteTxn(householdId: number, id: bigint): Promise<number> {
    const { count } = await this.prisma.householdTxn.deleteMany({ where: { id, householdId } });
    return count;
  }

  // ─── Tổng hợp cho dashboard ───
  async summary(householdId: number): Promise<HouseholdSummary> {
    const config = await this.requireConfig(householdId);
    const [members, txns, incomeAgg, allocations] = await Promise.all([
      this.listMembers(householdId),
      this.prisma.householdTxn.findMany({ where: { householdId }, select: { amount: true, memberId: true, occurredAt: true } }),
      this.prisma.householdIncome.aggregate({ where: { householdId }, _sum: { amount: true } }),
      this.prisma.householdAllocation.findMany({ where: { householdId }, select: { kind: true, amount: true } }),
    ]);

    return buildSummary({
      config,
      members,
      txns,
      totalIncome: Number(incomeAgg._sum.amount ?? 0),
      allocations,
    });
  }

  private async memberIdInHousehold(householdId: number, memberId: bigint | null) {
    if (memberId === null) return null;
    const member = await this.prisma.householdMember.findFirst({ where: { id: memberId, householdId }, select: { id: true } });
    return member?.id ?? null;
  }

  private async requireConfig(householdId: number) {
    const config = await this.getConfig(householdId);
    if (!config) throw new Error(`Không tìm thấy sổ chi tiêu #${householdId}`);
    return config;
  }
}
