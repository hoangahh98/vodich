import { Body, Controller, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { forbidden, notFound, parseBigId } from '../common/controller-utils';
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
    const tripId = await this.manageableTrip(req, res, id);
    if (!tripId) return;
    const personId = parseBigId(body.personId);
    if (personId) await this.finance.addMemberFromPerson(tripId, personId);
    else await this.finance.addQuickMember(tripId, body.name, body.email);
    this.gateway.emitTravelTripUpdated(id, 'member-added');
    return res.redirect(`/travel/trips/${id}/members`);
  }

  @Post('/travel/trips/:tripId/members/:memberId/edit')
  async editMember(@Req() req: Request, @Res() res: Response, @Param('tripId') tripId: string, @Param('memberId') memberId: string, @Body() body: Record<string, string>) {
    const scope = await this.manageableMember(req, res, tripId, memberId);
    if (!scope) return;
    await this.finance.updateMember(scope.tripId, scope.memberId, body);
    this.gateway.emitTravelTripUpdated(tripId, 'member-updated');
    return res.redirect(`/travel/trips/${tripId}/members`);
  }

  @Post('/travel/trips/:tripId/members/:memberId/delete')
  async deleteMember(@Req() req: Request, @Res() res: Response, @Param('tripId') tripId: string, @Param('memberId') memberId: string) {
    const scope = await this.manageableMember(req, res, tripId, memberId);
    if (!scope) return;
    await this.finance.deleteMember(scope.tripId, scope.memberId);
    this.gateway.emitTravelTripUpdated(tripId, 'member-deleted');
    return res.redirect(`/travel/trips/${tripId}/members`);
  }

  @Post('/travel/trips/:id/treasurer')
  async setTreasurer(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body('treasurerMemberId') treasurerMemberId: string) {
    const tripId = await this.manageableTrip(req, res, id);
    if (!tripId) return;
    await this.finance.setTreasurer(tripId, treasurerMemberId);
    this.gateway.emitTravelTripUpdated(id, 'treasurer-updated');
    return res.redirect(`/travel/trips/${id}/members`);
  }

  @Post('/travel/trips/:id/collections')
  async updateCollections(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const tripId = await this.manageableTrip(req, res, id);
    if (!tripId) return;
    await this.finance.updateCollections(tripId, body);
    this.gateway.emitTravelTripUpdated(id, 'collections-updated');
    return res.redirect(`/travel/trips/${id}/members`);
  }

  @Post('/travel/trips/:id/collections/paid-enough')
  async markPaidEnough(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const tripId = await this.manageableTrip(req, res, id);
    if (!tripId) return;
    await this.finance.markPaidEnough(tripId);
    this.gateway.emitTravelTripUpdated(id, 'collections-paid-enough');
    return res.redirect(`/travel/trips/${id}/members`);
  }

  @Post('/travel/trips/:id/expenses')
  async addExpense(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const tripId = await this.manageableTrip(req, res, id);
    if (!tripId) return;
    await this.finance.addExpense(tripId, body);
    this.gateway.emitTravelTripUpdated(id, 'expense-added');
    return res.redirect(`/travel/trips/${id}/expenses`);
  }

  @Post('/travel/trips/:tripId/expenses/:expenseId/edit')
  async editExpense(@Req() req: Request, @Res() res: Response, @Param('tripId') tripId: string, @Param('expenseId') expenseId: string, @Body() body: Record<string, string>) {
    const scopedTrip = await this.manageableTrip(req, res, tripId);
    if (!scopedTrip) return;
    const expId = parseBigId(expenseId);
    if (!expId) return notFound(res);
    await this.finance.updateExpense(scopedTrip, expId, body);
    this.gateway.emitTravelTripUpdated(tripId, 'expense-updated');
    return res.redirect(`/travel/trips/${tripId}/expenses`);
  }

  @Post('/travel/trips/:tripId/expenses/:expenseId/delete')
  async deleteExpense(@Req() req: Request, @Res() res: Response, @Param('tripId') tripId: string, @Param('expenseId') expenseId: string) {
    const scopedTrip = await this.manageableTrip(req, res, tripId);
    if (!scopedTrip) return;
    const expId = parseBigId(expenseId);
    if (!expId) return notFound(res);
    await this.finance.deleteExpense(scopedTrip, expId);
    this.gateway.emitTravelTripUpdated(tripId, 'expense-deleted');
    return res.redirect(`/travel/trips/${tripId}/expenses`);
  }

  @Post('/travel/trips/:id/permissions')
  async addPermission(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body('adminId') adminId: string) {
    const tripId = await this.manageableTrip(req, res, id);
    const adminBigId = parseBigId(adminId);
    if (!tripId) return;
    if (!adminBigId) return notFound(res);
    await this.travel.addPermission(tripId, adminBigId);
    this.gateway.emitTravelTripUpdated(id, 'permission-added');
    return res.redirect(`/travel/trips/${id}/settings`);
  }

  @Post('/travel/trips/:tripId/permissions/:permissionId/delete')
  async removePermission(@Req() req: Request, @Res() res: Response, @Param('tripId') tripId: string, @Param('permissionId') permissionId: string) {
    const scopedTrip = await this.manageableTrip(req, res, tripId);
    const permId = parseBigId(permissionId);
    if (!scopedTrip) return;
    if (!permId) return notFound(res);
    await this.travel.removePermission(scopedTrip, permId);
    this.gateway.emitTravelTripUpdated(tripId, 'permission-deleted');
    return res.redirect(`/travel/trips/${tripId}/settings`);
  }

  /** Parse tripId + kiểm quyền quản lý; trả tripId hợp lệ hoặc null (đã gửi response 404/403). */
  private async manageableTrip(req: Request, res: Response, idParam: string): Promise<bigint | null> {
    const tripId = parseBigId(idParam);
    if (!tripId) {
      notFound(res);
      return null;
    }
    if (!(await this.travel.canManage(req.session.user as CurrentUser, tripId))) {
      forbidden(res);
      return null;
    }
    return tripId;
  }

  private async manageableMember(req: Request, res: Response, tripParam: string, memberParam: string): Promise<{ tripId: bigint; memberId: bigint } | null> {
    const memberId = parseBigId(memberParam);
    const tripId = await this.manageableTrip(req, res, tripParam);
    if (!tripId) return null;
    if (!memberId) {
      notFound(res);
      return null;
    }
    return { tripId, memberId };
  }
}
