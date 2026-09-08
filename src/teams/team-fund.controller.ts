import { Body, Controller, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { notFound, parseBigId } from '../common/controller-utils';
import { AdminOnly, FeatureAccess } from '../common/feature.decorator';
import { MatchGateway } from '../tournaments/match.gateway';
import { currentMonth } from './team.controller';
import { TeamService } from './team.service';

@Controller()
@FeatureAccess('TEAMS')
@AdminOnly()
export class TeamFundController {
  constructor(
    private readonly teams: TeamService,
    private readonly matchGateway: MatchGateway,
  ) {}

  @Post('/teams/:id/fund')
  async setTeamFund(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!(await this.teams.canManage(req.session.user!, BigInt(id)))) return forbidden(res);
    await this.teams.setFund(BigInt(id), body.month, body);
    this.matchGateway.emitTeamUpdated(id, 'fund');
    return res.redirect(`/teams/${id}/overview?month=${body.month || currentMonth()}`);
  }

  @Post('/teams/:id/payments')
  async updateTeamPayments(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!(await this.teams.canManage(req.session.user!, BigInt(id)))) return forbidden(res);
    const month = body.month || currentMonth();
    await this.teams.updatePayments(BigInt(id), month, body);
    this.matchGateway.emitTeamUpdated(id, 'payments');
    return res.redirect(`/teams/${id}/income?month=${month}`);
  }

  @Post('/teams/:id/guest-receipts')
  async addGuestReceipt(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const teamId = parseBigId(id);
    if (!teamId) return notFound(res);
    if (!(await this.teams.canManage(req.session.user!, teamId))) return forbidden(res);
    const month = body.month || currentMonth();
    try {
      await this.teams.addGuestReceipt(teamId, month, body);
    } catch (error) {
      req.session.flash = error instanceof Error ? error.message : 'Không ghi được khoản thu';
    }
    this.matchGateway.emitTeamUpdated(id, 'payments');
    return res.redirect(`/teams/${id}/income?month=${month}`);
  }

  @Post('/teams/:teamId/guest-receipts/:receiptId/delete')
  async deleteGuestReceipt(@Req() req: Request, @Res() res: Response, @Param('teamId') teamId: string, @Param('receiptId') receiptId: string, @Body('month') month: string) {
    const id = parseBigId(teamId);
    const rid = parseBigId(receiptId);
    if (!id || !rid) return notFound(res);
    if (!(await this.teams.canManage(req.session.user!, id))) return forbidden(res);
    await this.teams.deleteGuestReceipt(id, rid);
    this.matchGateway.emitTeamUpdated(teamId, 'payments');
    return res.redirect(`/teams/${teamId}/income?month=${month || currentMonth()}`);
  }
}

function forbidden(res: Response) {
  return res.status(403).render('error', { message: 'Không có quyền' });
}
