import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AVAILABLE_ADMINS_ORDER, availableAdminsWhere, isRootAdmin, ownedOrSharedWhere } from '../common/admin-scope';
import { clientHouseholdWhere } from '../common/player-scope';
import { PrismaService } from '../prisma.service';
import { CurrentUser } from '../types';
import { DEFAULT_PURPOSES, normalizeMonth } from './household-enums';
import { lendingLedger, monthReport, recurringExpectations, sourceBalances } from './household-month';
import { toPurposeRow, toRecurringRow, toSourceRow, toTransactionRow } from './household-rows';

/**
 * Hộ chi tiêu: tạo/sửa/xoá, phạm vi admin (chủ hoặc được chia sẻ — `ownedOrSharedWhere`), quyền
 * xem của thành viên (tài khoản CLIENT như vận động viên, bảng `player_household_access`), và
 * gom dữ liệu cho trang chi tiết. Nghiệp vụ ghi giao dịch nằm ở HouseholdLedgerService, cấu
 * hình nguồn/mục đích/định kỳ ở HouseholdConfigService.
 */
@Injectable()
export class HouseholdService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: CurrentUser) {
    const households = await this.prisma.household.findMany({
      where: this.whereForUser(user),
      orderBy: { id: 'desc' },
      include: { _count: { select: { sources: true, playerAccess: true } } },
    });
    if (!households.length) return [];
    const pending = await this.prisma.householdTransaction.groupBy({
      by: ['householdId'],
      where: { householdId: { in: households.map((item) => item.id) }, kind: 'EXPENSE', OR: [{ purposeId: null }, { status: 'NEW' }] },
      _count: { _all: true },
    });
    const pendingById = new Map(pending.map((item) => [String(item.householdId), item._count._all]));
    return households.map((household) => ({ ...household, unclassifiedCount: pendingById.get(String(household.id)) || 0 }));
  }

  /** Tạo hộ kèm bộ mục đích mặc định để bấm là dùng được ngay, khỏi phải khai từ số không. */
  async create(user: CurrentUser, name: string, description?: string) {
    const household = await this.prisma.household.create({
      data: { name: name.trim() || 'Sổ chi tiêu', description: description?.trim() || null, ownerAdminId: BigInt(user.id) },
    });
    await this.prisma.householdPurpose.createMany({
      data: DEFAULT_PURPOSES.map((purpose, index) => ({ householdId: household.id, name: purpose.name, kind: purpose.kind, sortOrder: index })),
    });
    return household;
  }

  update(id: bigint, name: string, description?: string) {
    return this.prisma.household.update({ where: { id }, data: { name: name.trim(), description: description?.trim() || null, updatedAt: new Date() } });
  }

  /** Xoá hộ kèm toàn bộ nguồn, giao dịch, định kỳ (cascade ở DB). Controller đã kiểm canManage. */
  delete(id: bigint) {
    return this.prisma.household.delete({ where: { id } });
  }

  async canManage(user: CurrentUser, householdId: bigint) {
    if (user.role !== 'ADMIN') return false;
    if (isRootAdmin(user)) return true;
    return (await this.prisma.household.count({ where: { id: householdId, ...ownedOrSharedWhere(user) } })) > 0;
  }

  async canView(user: CurrentUser, householdId: bigint) {
    if (user.role === 'ADMIN') return this.canManage(user, householdId);
    return (await this.prisma.household.count({ where: { id: householdId, ...clientHouseholdWhere(user) } })) > 0;
  }

  availableAdmins(householdId: bigint, ownerAdminId?: bigint | null) {
    return this.prisma.appUser.findMany({
      where: availableAdminsWhere(ownerAdminId, { householdPermissions: { none: { householdId } } }),
      orderBy: AVAILABLE_ADMINS_ORDER,
    });
  }

  addPermission(householdId: bigint, adminId: bigint) {
    return this.prisma.householdPermission.upsert({
      where: { householdId_adminId: { householdId, adminId } },
      create: { householdId, adminId },
      update: {},
    });
  }

  removePermission(householdId: bigint, permissionId: bigint) {
    return this.prisma.householdPermission.deleteMany({ where: { id: permissionId, householdId } });
  }

  /** Thành viên trong nhà = vận động viên được cấp quyền xem hộ này (đăng nhập bằng email + mật khẩu chung). */
  addMembers(user: CurrentUser, householdId: bigint, playerIds: bigint[]) {
    if (!playerIds.length) return Promise.resolve();
    return this.prisma.playerHouseholdAccess.createMany({
      data: playerIds.map((playerId) => ({ householdId, playerId, grantedByAdminId: BigInt(user.id) })),
      skipDuplicates: true,
    });
  }

  removeMember(householdId: bigint, accessId: bigint) {
    return this.prisma.playerHouseholdAccess.deleteMany({ where: { id: accessId, householdId } });
  }

  availablePlayers(householdId: bigint) {
    return this.prisma.player.findMany({ where: { householdAccess: { none: { householdId } } }, orderBy: { displayName: 'asc' } });
  }

  /** Mã liên kết Telegram: gõ `/link <mã>` trong nhóm có bot là hộ nhận tin từ nhóm đó. */
  async ensureLinkCode(householdId: bigint): Promise<string> {
    const household = await this.prisma.household.findUniqueOrThrow({ where: { id: householdId } });
    if (household.telegramLinkCode) return household.telegramLinkCode;
    const code = randomBytes(4).toString('hex').toUpperCase();
    await this.prisma.household.update({ where: { id: householdId }, data: { telegramLinkCode: code } });
    return code;
  }

  unlinkTelegram(householdId: bigint) {
    return this.prisma.household.update({ where: { id: householdId }, data: { telegramChatId: null, telegramLinkCode: null } });
  }

  /**
   * Toàn bộ dữ liệu cho trang chi tiết một tháng. Lấy MỌI giao dịch của hộ (số dư/dư nợ phải cộng
   * từ đầu), rồi phần toán ở household-month.ts lo báo cáo tháng và dòng định kỳ dự kiến.
   */
  async detail(householdId: bigint, monthInput: unknown) {
    const month = normalizeMonth(monthInput);
    const household = await this.prisma.household.findUniqueOrThrow({
      where: { id: householdId },
      include: {
        ownerAdmin: true,
        permissions: { include: { admin: true }, orderBy: { id: 'asc' } },
        playerAccess: { include: { player: true }, orderBy: { id: 'asc' } },
      },
    });
    const [sources, purposes, recurrings, transactions, inbox, admins, players] = await Promise.all([
      this.prisma.householdSource.findMany({ where: { householdId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      this.prisma.householdPurpose.findMany({ where: { householdId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      this.prisma.householdRecurring.findMany({ where: { householdId }, orderBy: [{ dayOfMonth: 'asc' }, { id: 'asc' }] }),
      this.prisma.householdTransaction.findMany({ where: { householdId }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.householdInbox.findMany({ where: { householdId, status: 'UNPARSED' }, orderBy: { id: 'desc' }, take: 20 }),
      this.availableAdmins(householdId, household.ownerAdminId),
      this.availablePlayers(householdId),
    ]);

    const sourceRows = sources.map(toSourceRow);
    const purposeRows = purposes.map(toPurposeRow);
    const txRows = transactions.map(toTransactionRow);
    const recurringRows = recurrings.map(toRecurringRow);
    const balances = sourceBalances(sourceRows, txRows);
    const balancesAtStart = sourceBalances(
      sourceRows,
      txRows.filter((tx) => tx.month < month),
    );
    const monthTransactions = txRows.filter((tx) => tx.month === month);
    const report = monthReport(month, sourceRows, purposeRows, txRows);
    const expectations = recurringExpectations(month, recurringRows, balancesAtStart, monthTransactions);

    const sourceName = new Map(sources.map((source) => [String(source.id), source.name]));
    const sourceKindById = new Map(sources.map((source) => [String(source.id), source.kind]));
    const purposeById = new Map(purposes.map((purpose) => [String(purpose.id), purpose]));
    const recurringName = new Map(recurrings.map((recurring) => [String(recurring.id), recurring.name]));
    const rows = monthTransactions.map((tx) => ({
      ...tx,
      sourceName: sourceName.get(tx.sourceId) || '?',
      sourceKind: sourceKindById.get(tx.sourceId) || 'BANK',
      // Tiền vào thẻ tín dụng là hoàn tiền → chọn mục đích CHI như khoản chi; tiền vào tài khoản là thu nhập.
      refund: tx.kind === 'INCOME' && sourceKindById.get(tx.sourceId) === 'CARD',
      targetName: tx.targetSourceId ? sourceName.get(tx.targetSourceId) || '?' : '',
      purposeName: tx.purposeId ? purposeById.get(tx.purposeId)?.name || '' : '',
      purposeKind: tx.purposeId ? purposeById.get(tx.purposeId)?.kind || '' : '',
      recurringName: tx.recurringId ? recurringName.get(tx.recurringId) || '' : '',
    }));
    // "Cần xem lại": chưa có mục đích, hoặc máy ghi từ Telegram mà chưa ai xác nhận (status NEW).
    const needsReview = (tx: { kind: string; purposeId: string | null; status: string; sourceId: string }) =>
      (tx.kind === 'EXPENSE' || (tx.kind === 'INCOME' && sourceKindById.get(tx.sourceId) === 'CARD')) && (!tx.purposeId || tx.status === 'NEW');
    const unclassified = rows.filter(needsReview);
    const unclassifiedAll = txRows.filter(needsReview).length;
    const unclassifiedTotal = unclassified.reduce((sum, tx) => sum + tx.amount, 0);
    // Số dư ngân hàng báo gần nhất (Timo gửi kèm mỗi giao dịch) để so với số app tính.
    const reportedRows = await this.prisma.householdTransaction.findMany({
      where: { householdId, reportedBalance: { not: null } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      distinct: ['sourceId'],
      select: { sourceId: true, reportedBalance: true, occurredAt: true },
    });
    const reportedBySource = new Map(reportedRows.map((row) => [String(row.sourceId), { balance: Number(row.reportedBalance), at: row.occurredAt }]));
    const balanceList = sourceRows.map((source) => {
      const item = balances.get(source.id)!;
      const reported = reportedBySource.get(source.id) || null;
      return { ...item, reported, diff: reported ? item.balance - reported.balance : 0 };
    });
    const totals = {
      cash: balanceList.filter((item) => ['BANK', 'CASH'].includes(item.source.kind)).reduce((sum, item) => sum + item.balance, 0),
      debt: balanceList.filter((item) => ['CARD', 'LOAN'].includes(item.source.kind)).reduce((sum, item) => sum + item.balance, 0),
      lent: balanceList.filter((item) => item.source.kind === 'LENT').reduce((sum, item) => sum + item.balance, 0),
    };
    // Cho vay ghi bằng mục đích (không cần nguồn riêng) — gom theo nội dung, cộng vào tổng cho vay.
    const lending = lendingLedger(purposeRows, txRows);
    totals.lent += lending.outstanding;
    // Tháng có dữ liệu để chọn nhanh (thêm tháng đang xem và tháng hiện tại).
    const months = [...new Set([...txRows.map((tx) => tx.month), month, normalizeMonth(null)])].sort().reverse();

    return {
      household,
      selectedMonth: month,
      sources,
      purposes,
      recurrings,
      admins,
      players,
      members: household.playerAccess,
      inbox,
      balances: balanceList,
      balanceById: Object.fromEntries(balanceList.map((item) => [item.source.id, item])),
      totals,
      lending,
      report,
      expectations,
      transactions: rows,
      unclassified,
      unclassifiedAll,
      unclassifiedTotal,
      months,
      linked: !!household.telegramChatId,
    };
  }

  private whereForUser(user: CurrentUser): Prisma.HouseholdWhereInput {
    if (user.role === 'CLIENT') return clientHouseholdWhere(user);
    if (!isRootAdmin(user)) return ownedOrSharedWhere(user);
    return {};
  }
}
