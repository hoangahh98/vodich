import { Injectable } from '@nestjs/common';
import { parseMoney } from '../common/money';
import { PrismaService } from '../prisma.service';
import { minimumFeeForTournament } from './tournament-money';

@Injectable()
export class TournamentPaymentService {
  constructor(private readonly prisma: PrismaService) {}

  async updatePayment(registrationId: bigint, amount: string, status: string) {
    await this.prisma.tournamentRegistration.update({
      where: { id: registrationId },
      data: { paidAmount: parseMoney(amount), paymentStatus: status },
    });
  }

  async updatePayments(body: Record<string, string>) {
    const ids = Object.keys(body)
      .filter((key) => key.startsWith('amount_'))
      .map((key) => BigInt(key.replace('amount_', '')));
    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: { id: { in: ids } },
      include: { tournament: true },
    });
    const registrationMap = new Map(registrations.map((registration) => [registration.id.toString(), registration]));
    const updates = Object.entries(body)
      .filter(([key]) => key.startsWith('amount_'))
      .map(([key, amount]) => {
        const id = BigInt(key.replace('amount_', ''));
        const parsedAmount = parseMoney(amount);
        const registration = registrationMap.get(id.toString());
        return this.prisma.tournamentRegistration.update({
          where: { id },
          data: {
            paidAmount: parsedAmount || (registration ? minimumFeeForTournament(registration.tournament) : 0),
            paymentStatus: body[`status_${id}`] || 'UNPAID',
          },
        });
      });
    if (!updates.length) return [];
    return this.prisma.$transaction(updates);
  }
}
