import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { minimumFeeForTournament } from './tournament-money';

@Injectable()
export class TournamentRegistrationService {
  constructor(private readonly prisma: PrismaService) {}

  async registerPlayer(tournamentId: bigint, playerId: bigint) {
    return this.registerPlayers(tournamentId, [playerId]);
  }

  async registerPlayers(tournamentId: bigint, playerIds: bigint[]) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const uniqueIds = [...new Set(playerIds.map((id) => id.toString()))].map((id) => BigInt(id));
    const players = await this.prisma.player.findMany({ where: { id: { in: uniqueIds } }, orderBy: { displayName: 'asc' } });
    const activeCount = await this.prisma.tournamentRegistration.count({ where: { tournamentId, status: 'ACTIVE' } });
    let slotsLeft = Math.max(0, tournament.expectedPlayers - activeCount);
    let reserveCount = 0;
    for (const player of players) {
      const status = slotsLeft > 0 ? 'ACTIVE' : 'RESERVE';
      if (status === 'ACTIVE') slotsLeft--;
      if (status === 'RESERVE') reserveCount++;
      await this.prisma.tournamentRegistration.upsert({
        where: { tournamentId_playerId: { tournamentId, playerId: player.id } },
        update: { status, withdrawnAt: null, paidAmount: minimumFeeForTournament(tournament) },
        create: {
          tournamentId,
          playerId: player.id,
          skillLevel: player.skillLevel,
          source: 'INTERNAL',
          status,
          paidAmount: minimumFeeForTournament(tournament),
          paymentStatus: 'UNPAID',
        },
      });
    }
    return { added: players.length, reserveCount };
  }

  async registerExternal(tournamentId: bigint, displayName: string, email: string, skillLevel?: string) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    if (!tournament.externalRegistrationEnabled) throw new Error('Giải chưa mở đăng ký ngoài');
    const normalizedEmail = email.trim().toLowerCase();
    const existingPlayer = await this.prisma.player.findUnique({ where: { email: normalizedEmail } });
    const activeCount = await this.prisma.tournamentRegistration.count({ where: { tournamentId, status: 'ACTIVE' } });
    const status = activeCount < tournament.expectedPlayers ? 'ACTIVE' : 'RESERVE';
    if (existingPlayer) {
      return this.prisma.tournamentRegistration.upsert({
        where: { tournamentId_playerId: { tournamentId, playerId: existingPlayer.id } },
        update: { status, withdrawnAt: null, skillLevel: blankToNull(skillLevel) || existingPlayer.skillLevel },
        create: {
          tournamentId,
          playerId: existingPlayer.id,
          skillLevel: blankToNull(skillLevel) || existingPlayer.skillLevel,
          source: 'INTERNAL',
          status,
          paidAmount: minimumFeeForTournament(tournament),
          paymentStatus: 'UNPAID',
        },
        include: { player: true },
      });
    }
    return this.prisma.tournamentRegistration.upsert({
      where: { tournamentId_externalEmail: { tournamentId, externalEmail: normalizedEmail } },
      update: { status, withdrawnAt: null, externalName: displayName.trim(), skillLevel: blankToNull(skillLevel) },
      create: {
        tournamentId,
        externalName: displayName.trim(),
        externalEmail: normalizedEmail,
        skillLevel: blankToNull(skillLevel),
        source: 'EXTERNAL',
        status,
        paidAmount: minimumFeeForTournament(tournament),
        paymentStatus: 'UNPAID',
      },
      include: { player: true },
    });
  }

  async withdraw(registrationId: bigint) {
    await this.prisma.tournamentRegistration.update({
      where: { id: registrationId },
      data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
    });
  }

  async restore(registrationId: bigint) {
    const registration = await this.prisma.tournamentRegistration.findUniqueOrThrow({
      where: { id: registrationId },
      include: { tournament: true },
    });
    const activeCount = await this.prisma.tournamentRegistration.count({
      where: { tournamentId: registration.tournamentId, status: 'ACTIVE' },
    });
    await this.prisma.tournamentRegistration.update({
      where: { id: registrationId },
      data: {
        status: activeCount < registration.tournament.expectedPlayers ? 'ACTIVE' : 'RESERVE',
        withdrawnAt: null,
        paidAmount: Number(registration.paidAmount || 0) > 0 ? registration.paidAmount : minimumFeeForTournament(registration.tournament),
      },
    });
  }

  async deleteRegistration(registrationId: bigint) {
    await this.prisma.tournamentRegistration.delete({ where: { id: registrationId } });
  }

  async updateRegistrationSkill(registrationId: bigint, skillLevel: string) {
    await this.prisma.tournamentRegistration.update({
      where: { id: registrationId },
      data: { skillLevel: blankToNull(skillLevel) },
    });
  }

  async bulkRegistrations(registrationIds: bigint[], action: string) {
    const ids = [...new Set(registrationIds.map((id) => id.toString()))].map((id) => BigInt(id));
    if (!ids.length) return;
    if (action === 'delete') {
      await this.prisma.tournamentRegistration.deleteMany({ where: { id: { in: ids } } });
      return;
    }
    if (action === 'withdraw') {
      await this.prisma.tournamentRegistration.updateMany({
        where: { id: { in: ids } },
        data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
      });
      return;
    }
    if (action === 'restore') {
      for (const id of ids) {
        await this.restore(id);
      }
    }
  }
}

function blankToNull(value?: string) {
  return value && value.trim() ? value.trim() : null;
}
