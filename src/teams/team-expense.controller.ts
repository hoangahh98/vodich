import { Body, Controller, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
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
  async addTeamExpense(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!(await this.teams.canManage(req.session.user!, BigInt(id)))) return forbidden(res);
    const month = body.month || currentMonth();
    await this.teams.addExpense(BigInt(id), month, body.expenseDate, body.content, body.amount, body.notes);
    this.matchGateway.emitTeamUpdated(id, 'expenses');
    return res.redirect(`/teams/${id}/overview?month=${month}`);
  }

  @Post('/teams/:teamId/expenses/:expenseId/delete')
  async deleteTeamExpense(@Req() req: Request, @Res() res: Response, @Param('teamId') teamId: string, @Param('expenseId') expenseId: string, @Body('month') month: string) {
    if (!(await this.teams.canManage(req.session.user!, BigInt(teamId)))) return forbidden(res);
    await this.teams.deleteExpense(BigInt(teamId), BigInt(expenseId));
    this.matchGateway.emitTeamUpdated(teamId, 'expenses');
    return res.redirect(`/teams/${teamId}/overview?month=${month || currentMonth()}`);
  }
}

function forbidden(res: Response) {
  return res.status(403).render('error', { message: 'Không có quyền' });
}
