import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { isRootAdmin, rootAdminUsername } from '../common/admin-scope';
import { CurrentUser } from '../types';
import { cleanText } from './team-utils';

@Injectable()
export class TeamCrudService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: CurrentUser) {
    const [teams, memberCounts] = await Promise.all([
      this.prisma.teamClub.findMany({
        where: user.role === 'ADMIN' && !isRootAdmin(user) ? this.adminTeamWhere(user) : {},
        orderBy: { id: 'desc' },
      }),
      this.prisma.teamMember.groupBy({
        by: ['teamId'],
        where: { active: true },
        _count: { _all: true },
      }),
    ]);
    const countByTeamId = new Map(memberCounts.map((item) => [item.teamId.toString(), item._count._all]));
    return teams.map((team) => ({
      ...team,
      activeMemberCount: countByTeamId.get(team.id.toString()) || 0,
    }));
  }

  create(user: CurrentUser, name: string, description?: string) {
    return this.prisma.teamClub.create({ data: { name: name.trim(), description: cleanText(description), ownerAdminId: BigInt(user.id) } });
  }

  updateTeam(id: bigint, name: string, description?: string) {
    return this.prisma.teamClub.update({
      where: { id },
      data: { name: name.trim(), description: cleanText(description), updatedAt: new Date() },
    });
  }

  async canManage(user: CurrentUser, teamId: bigint) {
    if (user.role !== 'ADMIN') return false;
    if (isRootAdmin(user)) return true;
    return (await this.prisma.teamClub.count({ where: { id: teamId, ...this.adminTeamWhere(user) } })) > 0;
  }

  async availableAdmins(teamId: bigint, ownerAdminId?: bigint | null) {
    return this.prisma.appUser.findMany({
      where: {
        role: 'ADMIN',
        username: { not: rootAdminUsername() },
        id: { notIn: [ownerAdminId || 0n] },
        teamPermissions: { none: { teamId } },
      },
      orderBy: [{ displayName: 'asc' }, { username: 'asc' }],
    });
  }

  addPermission(teamId: bigint, adminId: bigint) {
    return this.prisma.teamClubPermission.create({ data: { teamId, adminId } });
  }

  removePermission(permissionId: bigint) {
    return this.prisma.teamClubPermission.delete({ where: { id: permissionId } });
  }

  private adminTeamWhere(user: CurrentUser) {
    const adminId = BigInt(user.id);
    return { OR: [{ ownerAdminId: adminId }, { permissions: { some: { adminId } } }] };
  }
}
