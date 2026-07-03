import { Tournament } from '@prisma/client';
import { roundUpToStep } from '../common/money';

export function minimumFeeForTournament(tournament: Tournament): number {
  const total = Number(tournament.courtCost) + Number(tournament.foodCost) + Number(tournament.prizeCost) + Number(tournament.otherCost);
  return roundUpToStep(total / Math.max(1, tournament.expectedPlayers));
}
