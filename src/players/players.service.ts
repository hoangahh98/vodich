import { Injectable } from '@nestjs/common';
import { blankToNull } from '../common/controller-utils';
import { PrismaService } from '../prisma.service';

@Injectable()
export class PlayersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.player.findMany({ orderBy: { displayName: 'asc' } });
  }

  find(id: bigint) {
    return this.prisma.player.findUnique({ where: { id } });
  }

  /** Kèm số giải/đội mà người này được xem — đếm theo bộ lọc phạm vi của admin đang xem (PlayerAccessService.countFilters). */
  listWithAccess(countFilters: { tournamentAccess: { where: Record<string, unknown> }; teamAccess: { where: Record<string, unknown> } }) {
    return this.prisma.player.findMany({
      orderBy: { displayName: 'asc' },
      include: { _count: { select: countFilters } },
    });
  }

  async upsert(body: Record<string, string>) {
    const email = body.email.trim().toLowerCase();
    const data = {
      displayName: body.displayName.trim(),
      skillLevel: blankToNull(body.skillLevel),
    };
    return this.prisma.player.upsert({
      where: { email },
      update: data,
      create: { ...data, email },
    });
  }

  async bulkUpdate(body: Record<string, string>) {
    const ids = Object.keys(body)
      .filter((key) => key.startsWith('displayName_'))
      .map((key) => BigInt(key.replace('displayName_', '')));
    const updates = ids.map((id) =>
      this.prisma.player.update({
        where: { id },
        data: {
          displayName: String(body[`displayName_${id}`] || '').trim(),
          email: String(body[`email_${id}`] || '').trim().toLowerCase(),
          skillLevel: blankToNull(body[`skillLevel_${id}`]),
        },
      }),
    );
    if (updates.length) await this.prisma.$transaction(updates);
  }

  /**
   * Xoá hẳn một người khỏi danh sách chung. Nhóm, đội (kèm phí các tháng), quyền xem tự xoá theo
   * khoá ngoại (Cascade); đăng ký giải thì xoá tay vì khoá ngoại chỉ SetNull — để lại dòng không
   * tên trong giải. Khoản thu vãng lai giữ lại dưới dạng tên khách để quỹ đội không hụt.
   */
  async remove(id: bigint) {
    const player = await this.prisma.player.findUnique({ where: { id } });
    if (!player) return null;
    return this.prisma.$transaction([
      this.prisma.teamGuestReceipt.updateMany({ where: { playerId: id }, data: { playerId: null, guestName: player.displayName } }),
      this.prisma.tournamentRegistration.deleteMany({ where: { playerId: id } }),
      this.prisma.player.delete({ where: { id } }),
    ]);
  }
}
