import { Injectable } from '@nestjs/common';
import { parseMoney } from '../common/money';
import { PrismaService } from '../prisma.service';
import { minimumFeeForTournament } from './tournament-money';

/**
 * Đóng phí giải làm giống Khoản thu đội bóng (9/2026): `paid_amount` là tiền THẬT đã thu, trạng
 * thái suy ra (đủ lệ phí trở lên = PAID), không còn ô tích ✓/✕. Nút "Tất cả đã đóng" nâng mọi ô
 * lên đủ lệ phí, ai đã đóng hơn thì giữ.
 */
@Injectable()
export class TournamentPaymentService {
  constructor(private readonly prisma: PrismaService) {}

  async updatePayment(registrationId: bigint, amount: string) {
    const registration = await this.prisma.tournamentRegistration.findUniqueOrThrow({ where: { id: registrationId }, include: { tournament: true } });
    const paid = parseMoney(amount);
    await this.prisma.tournamentRegistration.update({
      where: { id: registrationId },
      data: { paidAmount: paid, paymentStatus: statusFor(paid, minimumFeeForTournament(registration.tournament)) },
    });
  }

  async updatePayments(tournamentId: bigint, body: Record<string, string>) {
    const markAllPaid = body.markAllPaid === '1';
    const ids = Object.keys(body)
      .filter((key) => key.startsWith('amount_'))
      .map((key) => BigInt(key.replace('amount_', '')));
    // Chỉ nạp/ghi các registration thuộc đúng giải này (chống IDOR chéo giải).
    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: { id: { in: ids }, tournamentId },
      include: { tournament: true },
    });
    const updates = registrations.map((registration) => {
      const fee = minimumFeeForTournament(registration.tournament);
      const typed = parseMoney(body[`amount_${registration.id}`]);
      const paid = markAllPaid ? Math.max(typed, fee) : typed;
      return this.prisma.tournamentRegistration.update({
        where: { id: registration.id },
        data: { paidAmount: paid, paymentStatus: statusFor(paid, fee) },
      });
    });
    if (!updates.length) return [];
    return this.prisma.$transaction(updates);
  }
}

function statusFor(paid: number, fee: number) {
  return paid > 0 && paid >= fee ? 'PAID' : 'UNPAID';
}
