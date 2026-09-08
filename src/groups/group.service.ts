import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isRootAdmin } from '../common/admin-scope';
import { PrismaService } from '../prisma.service';
import { TeamMemberService } from '../teams/team-member.service';
import { CurrentUser } from '../types';

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
