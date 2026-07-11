import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { isRootAdmin, rootAdminUsername } from '../common/admin-scope';
import { CurrentUser } from '../types';
import { cleanText } from './team-utils';

@Injectable()
export class TeamCrudService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: CurrentUser) {
    const teams = await this.prisma.teamClub.findMany({
      where: this.teamWhereForUser(user),
      orderBy: { id: 'desc' },
    });
    if (!teams.length) return [];

    const memberCounts = await this.prisma.teamMember.groupBy({
      by: ['teamId'],
      where: { active: true, teamId: { in: teams.map((team) => team.id) } },
      _count: { _all: true },
    });
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

  async canView(user: CurrentUser, teamId: bigint) {
    if (user.role === 'ADMIN') return this.canManage(user, teamId);
    return (await this.prisma.teamClub.count({ where: { id: teamId, ...this.clientTeamWhere(user) } })) > 0;
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

  removePermission(teamId: bigint, permissionId: bigint) {
    return this.prisma.teamClubPermission.deleteMany({ where: { id: permissionId, teamId } });
  }

  private adminTeamWhere(user: CurrentUser): Prisma.TeamClubWhereInput {
    const adminId = BigInt(user.id);
    return { OR: [{ ownerAdminId: adminId }, { permissions: { some: { adminId } } }] };
  }

  private clientTeamWhere(user: CurrentUser): Prisma.TeamClubWhereInput {
    return {
      members: {
        some: {
          active: true,
          OR: [{ playerId: BigInt(user.id) }, { player: { is: { email: { equals: user.email, mode: 'insensitive' } } } }],
        },
      },
    };
  }

  private teamWhereForUser(user: CurrentUser): Prisma.TeamClubWhereInput {
    if (user.role === 'CLIENT') return this.clientTeamWhere(user);
    if (!isRootAdmin(user)) return this.adminTeamWhere(user);
    return {};
  }
}
