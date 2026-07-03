import { Injectable } from '@nestjs/common';
import { Tournament } from '@prisma/client';
import { CurrentUser } from '../types';
import { minimumFeeForTournament } from './tournament-money';
import { TournamentCrudService } from './tournament-crud.service';
import { TournamentDetailService } from './tournament-detail.service';
import { TournamentKnockoutService } from './tournament-knockout.service';
import { TournamentRegistrationService } from './tournament-registration.service';
import { TournamentScheduleService } from './tournament-schedule.service';

@Injectable()
export class TournamentService {
  constructor(
    private readonly crud: TournamentCrudService,
    private readonly detailService: TournamentDetailService,
    private readonly knockout: TournamentKnockoutService,
    private readonly registrations: TournamentRegistrationService,
    private readonly schedule: TournamentScheduleService,
  ) {}

  listFor(user: CurrentUser) {
    return this.crud.listFor(user);
  }

  clientTournaments(email: string) {
    return this.crud.clientTournaments(email);
  }

  canView(user: CurrentUser, tournamentId: bigint) {
    return this.crud.canView(user, tournamentId);
  }

  minimumFee(tournament: Tournament): number {
    return minimumFeeForTournament(tournament);
  }

  findTournament(tournamentId: bigint) {
    return this.crud.findTournament(tournamentId);
  }

  delete(tournamentId: bigint) {
    return this.crud.delete(tournamentId);
  }

  detail(tournamentId: bigint) {
    return this.detailService.detail(tournamentId);
  }

  create(form: Record<string, unknown>) {
    return this.crud.create(form);
  }

  update(id: bigint, form: Record<string, unknown>) {
    return this.crud.update(id, form);
  }

  registerPlayer(tournamentId: bigint, playerId: bigint) {
    return this.registrations.registerPlayer(tournamentId, playerId);
  }

  registerPlayers(tournamentId: bigint, playerIds: bigint[]) {
    return this.registrations.registerPlayers(tournamentId, playerIds);
  }

  registerExternal(tournamentId: bigint, displayName: string, email: string, skillLevel?: string) {
    return this.registrations.registerExternal(tournamentId, displayName, email, skillLevel);
  }

  updatePayment(registrationId: bigint, amount: string, status: string) {
    return this.registrations.updatePayment(registrationId, amount, status);
  }

  updatePayments(body: Record<string, string>) {
    return this.registrations.updatePayments(body);
  }

  withdraw(registrationId: bigint) {
    return this.registrations.withdraw(registrationId);
  }

  restore(registrationId: bigint) {
    return this.registrations.restore(registrationId);
  }

  deleteRegistration(registrationId: bigint) {
    return this.registrations.deleteRegistration(registrationId);
  }

  updateRegistrationSkill(registrationId: bigint, skillLevel: string) {
    return this.registrations.updateRegistrationSkill(registrationId, skillLevel);
  }

  bulkRegistrations(registrationIds: bigint[], action: string) {
    return this.registrations.bulkRegistrations(registrationIds, action);
  }

  generateSchedule(tournamentId: bigint) {
    return this.schedule.generateSchedule(tournamentId);
  }

  generateManualSchedule(tournamentId: bigint, pairNames: string[]) {
    return this.schedule.generateManualSchedule(tournamentId, pairNames);
  }

  groupBoards(tournamentId: bigint) {
    return this.detailService.groupBoards(tournamentId);
  }

  rankings(tournamentId: bigint) {
    return this.detailService.rankings(tournamentId);
  }

  syncKnockout(tournamentId: bigint) {
    return this.knockout.syncKnockout(tournamentId);
  }

  prizeTotalPaid(tournamentId: bigint) {
    return this.crud.prizeTotalPaid(tournamentId);
  }

  prizeFundForForm(tournamentId: bigint, form: Record<string, unknown>) {
    return this.crud.prizeFundForForm(tournamentId, form);
  }
}
