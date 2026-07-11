import { Injectable } from '@nestjs/common';
import { normalizePaymentStatus } from '../common/enums';
import { parseMoney } from '../common/money';
import { PrismaService } from '../prisma.service';
import { minimumFeeForTournament } from './tournament-money';

@Injectable()
export class TournamentPaymentService {
  constructor(private readonly prisma: PrismaService) {}

  async updatePayment(registrationId: bigint, amount: string, status: string) {
    await this.prisma.tournamentRegistration.update({
      where: { id: registrationId },
      data: { paidAmount: parseMoney(amount), paymentStatus: normalizePaymentStatus(status) },
    });
  }

  async updatePayments(tournamentId: bigint, body: Record<string, string>) {
    const ids = Object.keys(body)
      .filter((key) => key.startsWith('amount_'))
      .map((key) => BigInt(key.replace('amount_', '')));
    // Chỉ nạp/ghi các registration thuộc đúng giải này (chống IDOR chéo giải).
    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: { id: { in: ids }, tournamentId },
      include: { tournament: true },
    });
    const registrationMap = new Map(registrations.map((registration) => [registration.id.toString(), registration]));
    const updates = registrations.map((registration) => {
      const id = registration.id;
      const parsedAmount = parseMoney(body[`amount_${id}`]);
      const status = normalizePaymentStatus(body[`status_${id}`]);
      return this.prisma.tournamentRegistration.update({
        where: { id },
        data: {
          paidAmount: parsedAmount || minimumFeeForTournament(registrationMap.get(id.toString())!.tournament),
          paymentStatus: status,
        },
      });
    });
    if (!updates.length) return [];
    return this.prisma.$transaction(updates);
  }
}
