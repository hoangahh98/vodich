import { Body, Controller, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AdminOnly, FeatureAccess } from '../common/feature.decorator';
import { FeatureGuard } from '../common/feature.guard';
import { MatchGateway } from '../tournaments/match.gateway';
import { CurrentUser } from '../types';
import { TravelFinanceService } from './travel-finance.service';
import { TravelService } from './travel.service';

@Controller()
@UseGuards(FeatureGuard)
@FeatureAccess('TRAVEL')
@AdminOnly()
export class TravelFinanceController {
  constructor(
    private readonly travel: TravelService,
    private readonly finance: TravelFinanceService,
    private readonly gateway: MatchGateway,
  ) {}

  @Post('/travel/trips/:id/members')
  async addMember(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!(await this.travel.canManage(req.session.user as CurrentUser, BigInt(id)))) return forbidden(res);
    if (body.personId) await this.finance.addMemberFromPerson(BigInt(id), BigInt(body.personId));
    else await this.finance.addQuickMember(BigInt(id), body.name, body.email);
    this.gateway.emitTravelTripUpdated(id, 'member-added');
    return res.redirect(`/travel/trips/${id}`);
  }

  @Post('/travel/trips/:tripId/members/:memberId/edit')
  async editMember(@Req() req: Request, @Res() res: Response, @Param('tripId') tripId: string, @Param('memberId') memberId: string, @Body() body: Record<string, string>) {
    if (!(await this.travel.canManage(req.session.user as CurrentUser, BigInt(tripId)))) return forbidden(res);
    await this.finance.updateMember(BigInt(tripId), BigInt(memberId), body);
    this.gateway.emitTravelTripUpdated(tripId, 'member-updated');
    return res.redirect(`/travel/trips/${tripId}`);
  }

  @Post('/travel/trips/:tripId/members/:memberId/delete')
  async deleteMember(@Req() req: Request, @Res() res: Response, @Param('tripId') tripId: string, @Param('memberId') memberId: string) {
    if (!(await this.travel.canManage(req.session.user as CurrentUser, BigInt(tripId)))) return forbidden(res);
    await this.finance.deleteMember(BigInt(tripId), BigInt(memberId));
    this.gateway.emitTravelTripUpdated(tripId, 'member-deleted');
    return res.redirect(`/travel/trips/${tripId}`);
  }

  @Post('/travel/trips/:id/treasurer')
  async setTreasurer(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body('treasurerMemberId') treasurerMemberId: string) {
    if (!(await this.travel.canManage(req.session.user as CurrentUser, BigInt(id)))) return forbidden(res);
    await this.finance.setTreasurer(BigInt(id), treasurerMemberId);
    this.gateway.emitTravelTripUpdated(id, 'treasurer-updated');
    return res.redirect(`/travel/trips/${id}`);
  }

  @Post('/travel/trips/:id/collections')
  async updateCollections(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!(await this.travel.canManage(req.session.user as CurrentUser, BigInt(id)))) return forbidden(res);
    await this.finance.updateCollections(BigInt(id), body);
    this.gateway.emitTravelTripUpdated(id, 'collections-updated');
    return res.redirect(`/travel/trips/${id}`);
  }

  @Post('/travel/trips/:id/collections/paid-enough')
  async markPaidEnough(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    if (!(await this.travel.canManage(req.session.user as CurrentUser, BigInt(id)))) return forbidden(res);
    await this.finance.markPaidEnough(BigInt(id));
    this.gateway.emitTravelTripUpdated(id, 'collections-paid-enough');
    return res.redirect(`/travel/trips/${id}`);
  }

  @Post('/travel/trips/:id/expenses')
  async addExpense(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    if (!(await this.travel.canManage(req.session.user as CurrentUser, BigInt(id)))) return forbidden(res);
    await this.finance.addExpense(BigInt(id), body);
    this.gateway.emitTravelTripUpdated(id, 'expense-added');
    return res.redirect(`/travel/trips/${id}`);
  }

  @Post('/travel/trips/:tripId/expenses/:expenseId/edit')
  async editExpense(@Req() req: Request, @Res() res: Response, @Param('tripId') tripId: string, @Param('expenseId') expenseId: string, @Body() body: Record<string, string>) {
    if (!(await this.travel.canManage(req.session.user as CurrentUser, BigInt(tripId)))) return forbidden(res);
    await this.finance.updateExpense(BigInt(tripId), BigInt(expenseId), body);
    this.gateway.emitTravelTripUpdated(tripId, 'expense-updated');
    return res.redirect(`/travel/trips/${tripId}`);
  }

  @Post('/travel/trips/:tripId/expenses/:expenseId/delete')
  async deleteExpense(@Req() req: Request, @Res() res: Response, @Param('tripId') tripId: string, @Param('expenseId') expenseId: string) {
    if (!(await this.travel.canManage(req.session.user as CurrentUser, BigInt(tripId)))) return forbidden(res);
    await this.finance.deleteExpense(BigInt(tripId), BigInt(expenseId));
    this.gateway.emitTravelTripUpdated(tripId, 'expense-deleted');
    return res.redirect(`/travel/trips/${tripId}`);
  }

  @Post('/travel/trips/:id/permissions')
  async addPermission(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body('adminId') adminId: string) {
    if (!(await this.travel.canManage(req.session.user as CurrentUser, BigInt(id)))) return forbidden(res);
    await this.travel.addPermission(BigInt(id), BigInt(adminId));
    this.gateway.emitTravelTripUpdated(id, 'permission-added');
    return res.redirect(`/travel/trips/${id}`);
  }

  @Post('/travel/trips/:tripId/permissions/:permissionId/delete')
  async removePermission(@Req() req: Request, @Res() res: Response, @Param('tripId') tripId: string, @Param('permissionId') permissionId: string) {
    if (!(await this.travel.canManage(req.session.user as CurrentUser, BigInt(tripId)))) return forbidden(res);
    await this.travel.removePermission(BigInt(permissionId));
    this.gateway.emitTravelTripUpdated(tripId, 'permission-deleted');
    return res.redirect(`/travel/trips/${tripId}`);
  }
}

function forbidden(res: Response) {
  return res.status(403).render('error', { message: 'Không có quyền' });
}
