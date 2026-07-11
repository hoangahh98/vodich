import { Injectable } from '@nestjs/common';
import { CurrentUser } from '../types';
import { TeamCrudService } from './team-crud.service';
import { TeamDetailService } from './team-detail.service';
import { TeamExpenseService } from './team-expense.service';
import { TeamFundService } from './team-fund.service';
import { TeamMemberService } from './team-member.service';

@Injectable()
export class TeamService {
  constructor(
    private readonly crud: TeamCrudService,
    private readonly detail: TeamDetailService,
    private readonly expenses: TeamExpenseService,
    private readonly fund: TeamFundService,
    private readonly members: TeamMemberService,
  ) {}

  list(user: CurrentUser) {
    return this.crud.list(user);
  }

  create(user: CurrentUser, name: string, description?: string) {
    return this.crud.create(user, name, description);
  }

  updateTeam(id: bigint, name: string, description?: string) {
    return this.crud.updateTeam(id, name, description);
  }

  canManage(user: CurrentUser, teamId: bigint) {
    return this.crud.canManage(user, teamId);
  }

  canView(user: CurrentUser, teamId: bigint) {
    return this.crud.canView(user, teamId);
  }

  detailForMonth(id: bigint, month: string) {
    return this.detail.detailForMonth(id, month);
  }

  detailCurrentMonth(id: bigint) {
    return this.detail.detail(id);
  }

  addMember(teamId: bigint, playerId: bigint, memberType: string, notes?: string, month?: string) {
    return this.members.addMember(teamId, playerId, memberType, notes, month);
  }

  addMembers(teamId: bigint, playerIds: bigint[], memberType: string, notes?: string, month?: string) {
    return this.members.addMembers(teamId, playerIds, memberType, notes, month);
  }

  updateMember(teamId: bigint, memberId: bigint, memberType: string, notes?: string) {
    return this.members.updateMember(teamId, memberId, memberType, notes);
  }

  removeMember(teamId: bigint, memberId: bigint) {
    return this.members.removeMember(teamId, memberId);
  }

  setFund(teamId: bigint, month: string, monthlyFee: string, courtCost: string, previousBalance?: string, notes?: string) {
    return this.fund.setFund(teamId, month, monthlyFee, courtCost, previousBalance, notes);
  }

  updatePayments(teamId: bigint, month: string, body: Record<string, string>) {
    return this.fund.updatePayments(teamId, month, body);
  }

  addExpense(teamId: bigint, month: string, expenseDate: string, content: string, amount: string, notes?: string) {
    return this.expenses.addExpense(teamId, month, expenseDate, content, amount, notes);
  }

  deleteExpense(teamId: bigint, id: bigint) {
    return this.expenses.deleteExpense(teamId, id);
  }

  addPermission(teamId: bigint, adminId: bigint) {
    return this.crud.addPermission(teamId, adminId);
  }

  removePermission(teamId: bigint, permissionId: bigint) {
    return this.crud.removePermission(teamId, permissionId);
  }
}
