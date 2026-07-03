import { Injectable } from '@nestjs/common';
import { Tournament } from '@prisma/client';
import { CurrentUser } from '../types';

type RegistrationLike = {
  player?: { displayName?: string | null; email?: string | null } | null;
  externalName?: string | null;
  externalEmail?: string | null;
  paidAmount?: unknown;
  paymentStatus?: string | null;
};

export type TournamentDetailData = {
  tournament: Tournament;
  registrations: RegistrationLike[];
  reserveRegistrations: RegistrationLike[];
  withdrawnRegistrations: RegistrationLike[];
};

@Injectable()
export class TournamentDetailViewModelBuilder {
  build(input: {
    currentUser?: CurrentUser;
    detail: TournamentDetailData;
    externalLink: string;
    minimumFee: number;
    tournamentLink: string;
  }) {
    const { currentUser, detail, externalLink, minimumFee, tournamentLink } = input;
    const { tournament, registrations, reserveRegistrations, withdrawnRegistrations } = detail;
    const totalCost = Number(tournament.courtCost) + Number(tournament.foodCost) + Number(tournament.prizeCost) + Number(tournament.otherCost);
    const totalPaid = registrations.reduce((sum, registration) => sum + Number(registration.paidAmount || 0), 0);
    const unpaidCount = registrations.filter((registration) => registration.paymentStatus !== 'PAID').length;
    const operatingCost = Number(tournament.courtCost) + Number(tournament.foodCost) + Number(tournament.otherCost);
    const prizeFund = Math.max(0, totalPaid - operatingCost);
    const manualPrize = Number(tournament.prizeRate1) > 100 || Number(tournament.prizeRate2) > 100 || Number(tournament.prizeRate3) > 100;
    const prizeRateTotal = Number(tournament.prizeRate1) + Number(tournament.prizeRate2) + Number(tournament.prizeRate3) || 100;
    const currentEmail = String(currentUser?.email || '').toLowerCase();
    const myNames = new Set(
      [...registrations, ...(reserveRegistrations || []), ...withdrawnRegistrations]
        .filter((registration) => registrationEmail(registration) === currentEmail)
        .map((registration) => registration.player ? registration.player.displayName : registration.externalName)
        .filter(Boolean) as string[],
    );

    return {
      currentEmail,
      externalLink,
      isMine: (name: string) => [...myNames].some((myName) => String(name || '').includes(myName)),
      manualPrize,
      missingFee: unpaidCount * minimumFee,
      myNames,
      operatingCost,
      paymentLabels: { PAID: 'Đã đóng', UNPAID: 'Chưa đóng' },
      prize1: manualPrize ? Number(tournament.prizeRate1) : prizeFund * Number(tournament.prizeRate1) / prizeRateTotal,
      prize2: manualPrize ? Number(tournament.prizeRate2) : prizeFund * Number(tournament.prizeRate2) / prizeRateTotal,
      prize3: manualPrize ? Number(tournament.prizeRate3) : prizeFund * Number(tournament.prizeRate3) / prizeRateTotal,
      prizeFund,
      prizeRateTotal,
      slotsLeft: Math.max(0, tournament.expectedPlayers - registrations.length),
      topDonors: topDonors(registrations, minimumFee),
      totalCost,
      totalExpected: registrations.length * minimumFee,
      totalPaid,
      tournamentLink,
      unpaidCount,
    };
  }
}

function registrationEmail(registration: RegistrationLike) {
  return String(registration.player ? registration.player.email : registration.externalEmail || '').toLowerCase();
}

function topDonors(registrations: RegistrationLike[], minimumFee: number) {
  return registrations
    .map((registration) => ({
      name: registration.player ? registration.player.displayName : registration.externalName,
      amount: Math.max(0, Number(registration.paidAmount || 0) - minimumFee),
    }))
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);
}
