import { Injectable } from '@nestjs/common';
import { blankToNull } from '../common/controller-utils';
import { PrismaService } from '../prisma.service';

@Injectable()
export class PlayersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.player.findMany({ orderBy: { displayName: 'asc' } });
  }

  async upsert(body: Record<string, string>) {
    const email = body.email.trim().toLowerCase();
    const data = {
      displayName: body.displayName.trim(),
      skillLevel: blankToNull(body.skillLevel),
      notes: blankToNull(body.notes),
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
          notes: blankToNull(body[`notes_${id}`]),
        },
      }),
    );
    if (updates.length) await this.prisma.$transaction(updates);
  }
}
