import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isRootAdmin } from '../common/admin-scope';
import { PrismaService } from '../prisma.service';
import { TeamMemberService } from '../teams/team-member.service';
import { monthDate } from '../teams/team-utils';
import { CurrentUser } from '../types';

export interface RemovalPreview {
  group: { id: bigint; name: string };
  player: { id: bigint; displayName: string; email: string };
  month: string;
  teams: Array<{
    team: { id: bigint; name: string };
    isMember: boolean;
    willLeave: boolean;
    coveredBy: string[];
    current: { paid: number; expected: number; shortfall: number };
    debts: Array<{ month: string; shortfall: number }>;
    totalPaid: number;
  }>;
  unpaidTournaments: Array<{ tournamentId: bigint; name: string; amount: number }>;
  hasWarnings: boolean;
}

/**
 * Nhóm thành viên: một tập vận động viên đặt tên sẵn (ví dụ "Hội tối thứ 3") để khi tạo đội bóng
 * hay thêm người vào giải chỉ cần chọn nhóm thay vì tích từng người.
 *
 * - Đội bóng LIÊN KẾT với nhóm (`team_club_group`): thành viên đội ĐI THEO NHÓM. Thêm người vào nhóm
 *   là người đó vào mọi đội đang liên kết (cố định); đưa ra khỏi nhóm (hay gỡ nhóm khỏi đội, xoá nhóm)
 *   là người đó rời đội từ tháng hiện tại — trừ khi họ còn ở một nhóm khác cũng liên kết với đội đó.
 *   Tháng cũ giữ nguyên (xem team-month.service.ts).
 * - Giải đấu chỉ LẤY danh sách người của nhóm lúc thêm (gộp, bỏ trùng với người chọn lẻ), không
 *   liên kết lâu dài.
 *
 * Phạm vi: admin gốc thấy mọi nhóm; admin phụ chỉ thấy nhóm mình tạo — áp ngay trong truy vấn.
 */
@Injectable()
export class GroupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teamMembers: TeamMemberService,
  ) {}

  scope(user: CurrentUser): Prisma.PlayerGroupWhereInput {
    return isRootAdmin(user) ? {} : { ownerAdminId: BigInt(user.id) };
  }

  list(user: CurrentUser) {
    return this.prisma.playerGroup.findMany({
      where: this.scope(user),
      include: {
        members: { include: { player: true }, orderBy: { player: { displayName: 'asc' } } },
        teams: { include: { team: { select: { id: true, name: true } } } },
      },
      orderBy: { name: 'asc' },
    });
  }

  create(user: CurrentUser, name: string) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('Tên nhóm không được để trống');
    return this.prisma.playerGroup.create({ data: { name: trimmed, ownerAdminId: BigInt(user.id) } });
  }

  delete(user: CurrentUser, groupId: bigint) {
    return this.prisma.playerGroup.deleteMany({ where: { id: groupId, ...this.scope(user) } });
  }

  /** Chỉ giữ lại id nhóm nằm trong phạm vi của admin — id lạ gửi lên bị bỏ, không ném lỗi. */
  async scopedIds(user: CurrentUser, groupIds: bigint[]): Promise<bigint[]> {
    if (!groupIds.length) return [];
    const rows = await this.prisma.playerGroup.findMany({ where: { id: { in: groupIds }, ...this.scope(user) }, select: { id: true } });
    return rows.map((row) => row.id);
  }

  /** Người thuộc các nhóm (trong phạm vi), bỏ trùng — một người ở hai nhóm chỉ tính một lần. */
  async playerIdsOfGroups(user: CurrentUser, groupIds: bigint[]): Promise<bigint[]> {
    if (!groupIds.length) return [];
    const rows = await this.prisma.playerGroupMember.findMany({
      where: { groupId: { in: groupIds }, group: this.scope(user) },
      select: { playerId: true },
    });
    return [...new Set(rows.map((row) => row.playerId.toString()))].map((id) => BigInt(id));
  }

  /**
   * Thêm người vào nhóm, rồi đưa luôn họ vào mọi đội đang liên kết với nhóm. Trả về số người
   * thật sự được thêm vào nhóm (0 nếu nhóm không thuộc phạm vi của admin).
   */
  async addMembers(user: CurrentUser, groupId: bigint, playerIds: bigint[], month?: string): Promise<number> {
    const group = await this.prisma.playerGroup.findFirst({ where: { id: groupId, ...this.scope(user) }, select: { id: true } });
    if (!group || !playerIds.length) return 0;
    const unique = [...new Set(playerIds.map(String))].map((id) => BigInt(id));
    const result = await this.prisma.playerGroupMember.createMany({
      data: unique.map((playerId) => ({ groupId, playerId })),
      skipDuplicates: true,
    });
    const links = await this.prisma.teamClubGroup.findMany({ where: { groupId }, select: { teamId: true } });
    for (const link of links) {
      for (const playerId of unique) {
        await this.teamMembers.addMember(link.teamId, playerId, 'FIXED', undefined, month);
      }
    }
    return result.count;
  }

  /**
   * Soi trước khi đưa một người ra khỏi nhóm: rời đội nào, tháng này đã thu bao nhiêu, còn nợ tháng
   * nào, giải nào chưa đóng — để admin biết còn phải thu gì trước khi bấm. Không ghi gì.
   */
  async removalPreview(user: CurrentUser, groupId: bigint, playerId: bigint, month?: string): Promise<RemovalPreview | null> {
    const monthKey = month || new Date().toISOString().slice(0, 7);
    const fundMonth = monthDate(monthKey);
    const [group, player] = await Promise.all([
      this.prisma.playerGroup.findFirst({ where: { id: groupId, ...this.scope(user) }, select: { id: true, name: true } }),
      this.prisma.player.findUnique({ where: { id: playerId }, select: { id: true, displayName: true, email: true } }),
    ]);
    if (!group || !player) return null;
    const links = await this.prisma.teamClubGroup.findMany({ where: { groupId }, include: { team: { select: { id: true, name: true } } } });
    const teams: RemovalPreview['teams'] = [];
    for (const link of links) {
      const teamId = link.teamId;
      const [member, otherGroups, funds] = await Promise.all([
        this.prisma.teamMember.findFirst({ where: { teamId, playerId, active: true }, include: { payments: { orderBy: { fundMonth: 'asc' } } } }),
        this.prisma.playerGroupMember.findMany({ where: { playerId, groupId: { not: groupId }, group: { teams: { some: { teamId } } } }, include: { group: { select: { name: true } } } }),
        this.prisma.teamMonthFund.findMany({ where: { teamId }, select: { fundMonth: true, monthlyFee: true } }),
      ]);
      const feeByMonth = new Map(funds.map((fund) => [fund.fundMonth.toISOString().slice(0, 7), Number(fund.monthlyFee)]));
      const rows = member?.payments || [];
      const rowOf = (key: string) => rows.find((row) => row.fundMonth.toISOString().slice(0, 7) === key);
      const currentRow = rowOf(monthKey);
      const currentExpected = currentRow?.memberType === 'GUEST' ? 0 : feeByMonth.get(monthKey) || 0;
      const currentPaid = Number(currentRow?.paidAmount || 0);
      const debts = rows
        .filter((row) => row.fundMonth < fundMonth && (row.memberType || member?.memberType) === 'FIXED')
        .map((row) => {
          const key = row.fundMonth.toISOString().slice(0, 7);
          return { month: key, shortfall: Math.max(0, (feeByMonth.get(key) || 0) - Number(row.paidAmount || 0)) };
        })
        .filter((debt) => debt.shortfall > 0);
      teams.push({
        team: link.team,
        isMember: Boolean(member),
        willLeave: Boolean(member) && otherGroups.length === 0,
        coveredBy: otherGroups.map((row) => row.group.name),
        current: { paid: currentPaid, expected: currentExpected, shortfall: Math.max(0, currentExpected - currentPaid) },
        debts,
        totalPaid: rows.reduce((sum, row) => sum + Number(row.paidAmount || 0), 0),
      });
    }
    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: { playerId, status: { in: ['ACTIVE', 'RESERVE'] }, paymentStatus: { not: 'PAID' } },
      include: { tournament: { select: { id: true, name: true } } },
      orderBy: { id: 'desc' },
    });
    const unpaidTournaments = registrations.map((registration) => ({ tournamentId: registration.tournamentId, name: registration.tournament.name, amount: Number(registration.paidAmount || 0) }));
    const hasWarnings = unpaidTournaments.length > 0 || teams.some((item) => item.current.shortfall > 0 || item.debts.length > 0);
    return { group, player, month: monthKey, teams, unpaidTournaments, hasWarnings };
  }

  async removeMember(user: CurrentUser, groupId: bigint, playerId: bigint, month?: string) {
    const result = await this.prisma.playerGroupMember.deleteMany({ where: { groupId, playerId, group: this.scope(user) } });
    if (result.count) await this.detachFromLinkedTeams(groupId, [playerId], month);
    return result;
  }

  /** Xoá nhóm: người chỉ thuộc nhóm này rời các đội đang liên kết, rồi mới xoá (liên kết cascade theo). */
  async deleteWithTeams(user: CurrentUser, groupId: bigint, month?: string) {
    const group = await this.prisma.playerGroup.findFirst({ where: { id: groupId, ...this.scope(user) }, include: { members: { select: { playerId: true } } } });
    if (!group) return { count: 0 };
    await this.detachFromLinkedTeams(groupId, group.members.map((member) => member.playerId), month);
    return this.prisma.playerGroup.deleteMany({ where: { id: groupId } });
  }

  /** Gỡ nhóm khỏi MỘT đội: người chỉ thuộc nhóm này rời đội; người còn ở nhóm khác đang liên kết thì ở lại. */
  async detachTeamFromGroup(teamId: bigint, groupId: bigint, month?: string) {
    const members = await this.prisma.playerGroupMember.findMany({ where: { groupId }, select: { playerId: true } });
    await this.detachPlayers(teamId, groupId, members.map((member) => member.playerId), month);
    await this.prisma.teamClubGroup.deleteMany({ where: { teamId, groupId } });
  }

  private async detachFromLinkedTeams(groupId: bigint, playerIds: bigint[], month?: string) {
    const links = await this.prisma.teamClubGroup.findMany({ where: { groupId }, select: { teamId: true } });
    for (const link of links) await this.detachPlayers(link.teamId, groupId, playerIds, month);
  }

  private async detachPlayers(teamId: bigint, groupId: bigint, playerIds: bigint[], month?: string) {
    if (!playerIds.length) return;
    const stillCovered = await this.prisma.playerGroupMember.findMany({
      where: { playerId: { in: playerIds }, groupId: { not: groupId }, group: { teams: { some: { teamId } } } },
      select: { playerId: true },
    });
    const keep = new Set(stillCovered.map((row) => row.playerId.toString()));
    for (const playerId of playerIds) {
      if (!keep.has(playerId.toString())) await this.teamMembers.removePlayer(teamId, playerId, month);
    }
  }
}
