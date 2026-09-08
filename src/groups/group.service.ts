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
 * - Đội bóng LIÊN KẾT với nhóm (`team_club_group`): thêm người vào nhóm là người đó tự vào mọi đội
 *   đang liên kết (thành viên cố định). Bỏ khỏi nhóm KHÔNG tự gỡ khỏi đội — gỡ khỏi đội là quyết
 *   định riêng vì còn lịch sử đóng phí.
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

  async removeMember(user: CurrentUser, groupId: bigint, playerId: bigint) {
    return this.prisma.playerGroupMember.deleteMany({ where: { groupId, playerId, group: this.scope(user) } });
  }
}
