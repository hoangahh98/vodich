import { Tournament } from '@prisma/client';
import { roundUpToStep } from '../common/money';

/**
 * Lệ phí mỗi người: từ 9/2026 nhập tay ở Cài đặt (`feePerPlayer`). Giải cũ chưa đặt (0) thì
 * vẫn suy từ tổng chi phí / số người dự kiến như trước để số liệu cũ không đổi.
 */
export function minimumFeeForTournament(tournament: Tournament): number {
  const fee = Number(tournament.feePerPlayer || 0);
  if (fee > 0) return fee;
  const total = Number(tournament.courtCost) + Number(tournament.foodCost) + Number(tournament.prizeCost) + Number(tournament.otherCost);
  return roundUpToStep(total / Math.max(1, tournament.expectedPlayers));
}

/** Đã nhập đủ các cột tiền bắt buộc (lệ phí, sân, ăn, thưởng — "khác" không bắt buộc) chưa? */
export function hasCompleteMoney(tournament: Pick<Tournament, 'feePerPlayer' | 'courtCost' | 'foodCost' | 'prizeCost'>): boolean {
  return Number(tournament.feePerPlayer || 0) > 0 && [tournament.courtCost, tournament.foodCost, tournament.prizeCost].every((value) => value !== null && value !== undefined);
}
