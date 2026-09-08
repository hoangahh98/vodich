import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { grantTeamAccess, revokeTeamAccess } from '../players/player-access.service';
import { TeamMonthService } from './team-month.service';
import { cleanText, monthDate, normalizeMemberType } from './team-utils';

/**
 * Thành viên đội và ảnh chụp theo tháng (xem team-month.service.ts): mọi thay đổi người/loại đều
 * nhận `month` và chỉ chạm vào tháng đó trở đi.
 */
@Injectable()
export class TeamMemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly months: TeamMonthService,
  ) {}

  async addMember(teamId: bigint, playerId: bigint, memberType: string, notes?: string, month?: string) {
    const normalizedMemberType = normalizeMemberType(memberType);
    const member = await this.prisma.teamMember.upsert({
      where: { teamId_playerId: { teamId, playerId } },
      update: { active: true, memberType: normalizedMemberType, notes: cleanText(notes) },
      create: { teamId, playerId, memberType: normalizedMemberType, notes: cleanText(notes) },
    });
    await grantTeamAccess(this.prisma, teamId, [playerId]);
    // Ghi loại vào ảnh chụp tháng này (người quay lại đội trong cùng tháng thì cập nhật loại), rồi
    // chốt tháng để mức phí tự chia lại.
    await this.months.snapshotMemberType(member.id, month, normalizedMemberType);
    await this.months.ensureMonth(teamId, month);
    return member;
  }

  async addMembers(teamId: bigint, playerIds: bigint[], memberType: string, notes?: string, month?: string) {
    const uniqueIds = [...new Set(playerIds.map((id) => id.toString()))].map((id) => BigInt(id));
    for (const playerId of uniqueIds) {
      await this.addMember(teamId, playerId, memberType, notes, month);
    }
    return uniqueIds.length;
  }

  /**
   * Liên kết đội với các nhóm rồi đưa toàn bộ người của nhóm vào đội (cố định). Id nhóm và danh
   * sách người do controller lấy qua GroupService trong phạm vi của admin — ở đây không kiểm lại.
   */
  async linkGroups(teamId: bigint, groupIds: bigint[], playerIds: bigint[], month?: string) {
    if (groupIds.length) {
      await this.prisma.teamClubGroup.createMany({ data: groupIds.map((groupId) => ({ teamId, groupId })), skipDuplicates: true });
    }
    return this.addMembers(teamId, playerIds, 'FIXED', undefined, month);
  }

  /** Chỉ gỡ liên kết — thành viên đã vào đội vẫn giữ nguyên. */
  unlinkGroup(teamId: bigint, groupId: bigint) {
    return this.prisma.teamClubGroup.deleteMany({ where: { teamId, groupId } });
  }

  async updateMember(teamId: bigint, memberId: bigint, memberType: string, notes?: string, month?: string) {
    const normalizedMemberType = normalizeMemberType(memberType);
    const result = await this.prisma.teamMember.updateMany({
      where: { id: memberId, teamId },
      data: { memberType: normalizedMemberType, notes: cleanText(notes) },
    });
    if (!result.count) throw new NotFoundException('Không tìm thấy thành viên trong đội');
    await this.months.snapshotMemberType(memberId, month, normalizedMemberType);
    await this.months.ensureMonth(teamId, month);
    return result;
  }

  /** Rời đội theo playerId (dùng khi người đó bị đưa ra khỏi nhóm liên kết). Không có trong đội thì bỏ qua. */
  async removePlayer(teamId: bigint, playerId: bigint, month?: string) {
    const member = await this.prisma.teamMember.findFirst({ where: { teamId, playerId, active: true }, select: { id: true } });
    if (!member) return;
    await this.removeMember(teamId, member.id, month);
  }

  /**
   * Rời đội TỪ THÁNG `month` trở đi: các tháng trước giữ nguyên (kể cả tiền đã đóng); dòng phí của
   * tháng này và các tháng sau bị bỏ nếu chưa đóng, còn dòng đã đóng thì giữ vì tiền đã thu thật.
   * Sau đó mức phí tháng này (và các tháng sau ở chế độ AUTO) tự chia lại cho người còn lại.
   */
  async removeMember(teamId: bigint, memberId: bigint, month?: string) {
    const member = await this.prisma.teamMember.findFirst({ where: { id: memberId, teamId }, select: { playerId: true } });
    const result = await this.prisma.teamMember.updateMany({
      where: { id: memberId, teamId },
      data: { active: false },
    });
    if (!result.count) throw new NotFoundException('Không tìm thấy thành viên trong đội');
    const fundMonth = monthDate(month);
    await this.prisma.teamMemberPayment.deleteMany({ where: { memberId, fundMonth: { gte: fundMonth }, paymentStatus: { not: 'PAID' } } });
    if (member) await revokeTeamAccess(this.prisma, teamId, [member.playerId]);
    await this.months.recompute(teamId, fundMonth);
    return result;
  }
}
