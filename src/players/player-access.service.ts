import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { isRootAdmin, ownedOrSharedWhere } from '../common/admin-scope';
import { CurrentUser } from '../types';

export interface AccessTarget {
  id: bigint;
  name: string;
  granted: boolean;
}

/**
 * Cấp/thu quyền XEM giải đấu, đội bóng cho từng thành viên (màn hình Thành viên).
 *
 * Phạm vi (xem docs/bao-mat.md, mục 3b):
 * - Admin gốc: thấy và cấp được mọi giải, mọi đội.
 * - Admin phụ: chỉ thấy và cấp được giải/đội mình tạo ra hoặc được chia sẻ quyền quản lý
 *   (`ownedOrSharedWhere`), và chỉ trong module mình được cấp (TOURNAMENTS / TEAMS).
 *
 * Phạm vi được áp NGAY TRONG TRUY VẤN cả lúc đọc lẫn lúc ghi: id giải gửi lên mà nằm ngoài
 * phạm vi thì bị lọc bỏ trước khi chạm bảng quyền, và lệnh xoá cũng chỉ xoá trong phạm vi —
 * admin phụ không thể thu quyền mà admin khác đã cấp cho giải của họ.
 */
@Injectable()
export class PlayerAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async targetsFor(user: CurrentUser, featureSet: Set<string>, playerId: bigint): Promise<{ tournaments: AccessTarget[]; teams: AccessTarget[] }> {
    const [tournaments, teams] = await Promise.all([
      featureSet.has('TOURNAMENTS')
        ? this.prisma.tournament.findMany({
            where: this.tournamentScope(user),
            orderBy: { id: 'desc' },
            select: { id: true, name: true, playerAccess: { where: { playerId }, select: { id: true } } },
          })
        : Promise.resolve([]),
      featureSet.has('TEAMS')
        ? this.prisma.teamClub.findMany({
            where: this.teamScope(user),
            orderBy: { id: 'desc' },
            select: { id: true, name: true, playerAccess: { where: { playerId }, select: { id: true } } },
          })
        : Promise.resolve([]),
    ]);
    return {
      tournaments: tournaments.map((item) => ({ id: item.id, name: item.name, granted: item.playerAccess.length > 0 })),
      teams: teams.map((item) => ({ id: item.id, name: item.name, granted: item.playerAccess.length > 0 })),
    };
  }

  /**
   * Ghi lại bộ quyền của một thành viên theo đúng những ô đã tích. Chỉ những giải/đội TRONG
   * phạm vi của admin đang thao tác mới bị đụng tới: bỏ tích thì thu, tích thì cấp, còn phần
   * ngoài phạm vi giữ nguyên dù form có gửi id lên.
   */
  async save(user: CurrentUser, featureSet: Set<string>, playerId: bigint, tournamentIds: bigint[], teamIds: bigint[]) {
    const grantedBy = BigInt(user.id);
    if (featureSet.has('TOURNAMENTS')) {
      const scoped = await this.prisma.tournament.findMany({ where: this.tournamentScope(user), select: { id: true } });
      const scopedIds = scoped.map((item) => item.id);
      const wanted = new Set(tournamentIds.map(String));
      const keep = scopedIds.filter((id) => wanted.has(String(id)));
      await this.prisma.$transaction([
        this.prisma.playerTournamentAccess.deleteMany({ where: { playerId, tournamentId: { in: scopedIds, notIn: keep } } }),
        this.prisma.playerTournamentAccess.createMany({
          data: keep.map((tournamentId) => ({ playerId, tournamentId, grantedByAdminId: grantedBy })),
          skipDuplicates: true,
        }),
      ]);
    }
    if (featureSet.has('TEAMS')) {
      const scoped = await this.prisma.teamClub.findMany({ where: this.teamScope(user), select: { id: true } });
      const scopedIds = scoped.map((item) => item.id);
      const wanted = new Set(teamIds.map(String));
      const keep = scopedIds.filter((id) => wanted.has(String(id)));
      await this.prisma.$transaction([
        this.prisma.playerTeamAccess.deleteMany({ where: { playerId, teamId: { in: scopedIds, notIn: keep } } }),
        this.prisma.playerTeamAccess.createMany({
          data: keep.map((teamId) => ({ playerId, teamId, grantedByAdminId: grantedBy })),
          skipDuplicates: true,
        }),
      ]);
    }
  }

  /** Bộ lọc đếm số quyền hiện ra ở danh sách thành viên — cũng theo phạm vi của admin đang xem. */
  countFilters(user: CurrentUser, featureSet: Set<string>) {
    return {
      tournamentAccess: { where: featureSet.has('TOURNAMENTS') ? { tournament: this.tournamentScope(user) } : { id: -1n } },
      teamAccess: { where: featureSet.has('TEAMS') ? { team: this.teamScope(user) } : { id: -1n } },
    };
  }

  tournamentScope(user: CurrentUser) {
    return isRootAdmin(user) ? {} : ownedOrSharedWhere(user);
  }

  teamScope(user: CurrentUser) {
    return isRootAdmin(user) ? {} : ownedOrSharedWhere(user);
  }
}

/**
 * Hai hàm tiện ích cho luồng tự động: admin thêm người vào giải/đội thì cấp luôn quyền xem
 * (chính admin đó vừa quyết định cho họ tham gia), xoá khỏi giải/đội thì thu lại. Gọi bằng
 * `prisma` trực tiếp để service đăng ký/thành viên dùng được mà không phải tiêm thêm service.
 */
export async function grantTournamentAccess(prisma: PrismaService, tournamentId: bigint, playerIds: bigint[]) {
  if (!playerIds.length) return;
  await prisma.playerTournamentAccess.createMany({ data: playerIds.map((playerId) => ({ playerId, tournamentId })), skipDuplicates: true });
}

export async function revokeTournamentAccess(prisma: PrismaService, tournamentId: bigint, playerIds: bigint[]) {
  if (!playerIds.length) return;
  await prisma.playerTournamentAccess.deleteMany({ where: { tournamentId, playerId: { in: playerIds } } });
}

export async function grantTeamAccess(prisma: PrismaService, teamId: bigint, playerIds: bigint[]) {
  if (!playerIds.length) return;
  await prisma.playerTeamAccess.createMany({ data: playerIds.map((playerId) => ({ playerId, teamId })), skipDuplicates: true });
}

export async function revokeTeamAccess(prisma: PrismaService, teamId: bigint, playerIds: bigint[]) {
  if (!playerIds.length) return;
  await prisma.playerTeamAccess.deleteMany({ where: { teamId, playerId: { in: playerIds } } });
}
