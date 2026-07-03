import { Body, Controller, Param, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AdminOnly, FeatureAccess } from '../common/feature.decorator';
import { FeatureGuard } from '../common/feature.guard';
import { MatchGateway } from '../tournaments/match.gateway';
import { currentMonth } from './team.controller';
import { TeamService } from './team.service';

@Controller()
@UseGuards(FeatureGuard)
@FeatureAccess('TEAMS')
@AdminOnly()
export class TeamExpenseController {
  constructor(
    private readonly teams: TeamService,
    private readonly matchGateway: MatchGateway,
  ) {}

  @Post('/teams/:id/expenses')
  async addTeamExpense(@Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const month = body.month || currentMonth();
    await this.teams.addExpense(BigInt(id), month, body.expenseDate, body.content, body.amount, body.notes);
    this.matchGateway.emitTeamUpdated(id, 'expenses');
    return res.redirect(`/teams/${id}/overview?month=${month}`);
  }

  @Post('/teams/:teamId/expenses/:expenseId/delete')
  async deleteTeamExpense(@Res() res: Response, @Param('teamId') teamId: string, @Param('expenseId') expenseId: string, @Body('month') month: string) {
    await this.teams.deleteExpense(BigInt(teamId), BigInt(expenseId));
    this.matchGateway.emitTeamUpdated(teamId, 'expenses');
    return res.redirect(`/teams/${teamId}/overview?month=${month || currentMonth()}`);
  }
}
