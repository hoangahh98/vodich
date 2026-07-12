import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { forbidden, notFound, parseBigId } from '../common/controller-utils';
import { AdminOnly, FeatureAccess } from '../common/feature.decorator';
import { FeatureGuard } from '../common/feature.guard';
import { render } from '../common/view';
import { MatchGateway } from '../tournaments/match.gateway';
import { CurrentUser } from '../types';
import { isTravelSchemaMissing } from './travel-errors';
import { travelExpenseCategories } from './travel-finance.service';
import { TravelService, travelSuggestionCategories } from './travel.service';
import { TravelSummaryBuilder } from './travel-summary';
import { TravelAiService } from './travel-ai.service';
import { RateLimitService } from '../common/rate-limit.service';
import { safeTravelSection } from './travel-sections';

@Controller()
@UseGuards(FeatureGuard)
@FeatureAccess('TRAVEL')
export class TravelController {
  private readonly summaryBuilder = new TravelSummaryBuilder();

  constructor(
    private readonly travel: TravelService,
    private readonly gateway: MatchGateway,
    private readonly travelAi: TravelAiService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get('/travel')
  async index(@Req() req: Request, @Res() res: Response) {
    const user = req.session.user as CurrentUser;
    try {
      const [trips, destinations] = await Promise.all([this.travel.listTrips(user), this.travel.destinations()]);
      return render(res, 'travel/index', { trips, destinations });
    } catch (error) {
      if (isTravelSchemaMissing(error)) {
        return render(res.status(503), 'travel/setup');
      }
      throw error;
    }
  }

  @Post('/travel/trips')
  @AdminOnly()
  async createTrip(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const trip = await this.travel.createTrip(req.session.user as CurrentUser, body);
    this.gateway.emitTravelTripsUpdated('trip-created');
    return res.redirect(`/travel/trips/${trip.id}`);
  }

  @Post('/travel/trips/:id/edit')
  @AdminOnly()
  async editTrip(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const tripId = parseBigId(id);
    if (!tripId) return notFound(res);
    if (!(await this.travel.canManage(req.session.user as CurrentUser, tripId))) return forbidden(res);
    await this.travel.updateTrip(tripId, body);
    this.gateway.emitTravelTripUpdated(id, 'trip-updated');
    return res.redirect(`/travel/trips/${id}/settings`);
  }

  @Post('/travel/trips/:id/delete')
  @AdminOnly()
  async deleteTrip(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const tripId = parseBigId(id);
    if (!tripId) return notFound(res);
    if (!(await this.travel.canManage(req.session.user as CurrentUser, tripId))) return forbidden(res);
    await this.travel.deleteTrip(tripId);
    this.gateway.emitTravelTripsUpdated('trip-deleted');
    return res.redirect('/travel');
  }

  @Post('/travel/trips/:id/ai-plan')
  @AdminOnly()
  async generateAiPlan(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const tripId = parseBigId(id);
    if (!tripId) return notFound(res);
    if (!(await this.travel.canManage(req.session.user as CurrentUser, tripId))) return forbidden(res);
    const limit = this.rateLimit.consume(`ai:travel:${req.ip || 'unknown'}`, { max: 10, windowMs: 60_000 });
    if (!limit.allowed) return res.redirect(`/travel/trips/${id}/ai?err=${encodeURIComponent(`Thao tác quá nhanh, thử lại sau ${limit.retryAfterSeconds}s`)}`);
    try {
      await this.travelAi.generateForTrip(tripId, {
        days: Number(body.days) || undefined,
        people: Number(body.people) || undefined,
        notes: body.notes,
      });
    } catch (error) {
      // Không chặn trang: lưu ý lỗi qua query để view hiển thị nhẹ nhàng.
      const message = error instanceof Error ? error.message : 'Tạo gợi ý AI thất bại';
      return res.redirect(`/travel/trips/${id}/ai?err=${encodeURIComponent(message)}`);
    }
    this.gateway.emitTravelTripUpdated(id, 'ai-plan');
    return res.redirect(`/travel/trips/${id}/ai`);
  }

  @Get('/travel/trips/:id')
  tripDetailRedirect(@Res() res: Response, @Param('id') id: string) {
    return res.redirect(`/travel/trips/${id}/overview`);
  }

  @Get('/travel/trips/:id/:section')
  async detail(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('section') sectionParam: string) {
    const user = req.session.user as CurrentUser;
    const tripId = parseBigId(id);
    if (!tripId) return notFound(res);
    if (!(await this.travel.canView(user, tripId))) return forbidden(res);
    const isTravelAdmin = user.role === 'ADMIN';
    const detail = await this.travel.detail(tripId, isTravelAdmin);
    const summary = this.summaryBuilder.build(detail.members, detail.expenses, detail.trip.treasurerMemberId);
    const viewerMemberId = user.role === 'CLIENT' ? detail.members.find((member) => member.email.toLowerCase() === user.email.toLowerCase() || member.player?.email?.toLowerCase() === user.email.toLowerCase())?.id : null;
    const hasPlaces = Boolean(detail.trip.destination && detail.destinationSuggestions.length);
    // Chọn mục hiển thị; ẩn mục không hợp lệ cho từng vai trò/ngữ cảnh.
    let section = safeTravelSection(sectionParam);
    if (section === 'places' && !hasPlaces) section = 'overview';
    if (section === 'settings' && !isTravelAdmin) section = 'overview';
    return render(res, 'travel/detail', {
      ...detail,
      section,
      hasPlaces,
      summary,
      viewerMemberId,
      expenseCategories: travelExpenseCategories,
      suggestionCategories: travelSuggestionCategories,
      isTravelAdmin,
      aiPlan: this.travelAi.parseStored(detail.trip.aiPlan),
      aiPlanAt: detail.trip.aiPlanAt,
      aiConfigured: this.travelAi.isConfigured(),
      aiError: String(req.query.err || ''),
      today: new Date().toISOString().slice(0, 10),
    });
  }

  @Get('/travel/suggestions')
  @AdminOnly()
  async suggestions(@Res() res: Response, @Query('destinationId') destinationId?: string, @Query('category') category?: string) {
    const selectedDestinationId = parseBigId(destinationId) ?? undefined;
    const [destinations, suggestions] = await Promise.all([this.travel.destinations(), this.travel.suggestions(selectedDestinationId, category)]);
    return render(res, 'travel/suggestions', { destinations, suggestions, selectedDestinationId, selectedCategory: category || '', categories: travelSuggestionCategories });
  }

  @Post('/travel/suggestions/destinations')
  @AdminOnly()
  async createDestination(@Res() res: Response, @Body('name') name: string) {
    await this.travel.createDestination(name);
    return res.redirect('/travel/suggestions');
  }

  @Post('/travel/suggestions')
  @AdminOnly()
  async createSuggestion(@Res() res: Response, @Body() body: Record<string, string>) {
    await this.travel.saveSuggestion(body);
    return res.redirect('/travel/suggestions');
  }

  @Post('/travel/suggestions/:id/edit')
  @AdminOnly()
  async editSuggestion(@Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const suggestionId = parseBigId(id);
    if (!suggestionId) return notFound(res);
    await this.travel.saveSuggestion(body, suggestionId);
    return res.redirect('/travel/suggestions');
  }

  @Post('/travel/suggestions/:id/delete')
  @AdminOnly()
  async deleteSuggestion(@Res() res: Response, @Param('id') id: string) {
    const suggestionId = parseBigId(id);
    if (!suggestionId) return notFound(res);
    await this.travel.deleteSuggestion(suggestionId);
    return res.redirect('/travel/suggestions');
  }
}
