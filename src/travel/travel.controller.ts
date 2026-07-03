import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AdminOnly, FeatureAccess } from '../common/feature.decorator';
import { FeatureGuard } from '../common/feature.guard';
import { render } from '../common/view';
import { MatchGateway } from '../tournaments/match.gateway';
import { CurrentUser } from '../types';
import { TravelFinanceService, travelExpenseCategories } from './travel-finance.service';
import { TravelService, travelSuggestionCategories } from './travel.service';
import { TravelSummaryBuilder } from './travel-summary';

@Controller()
@UseGuards(FeatureGuard)
@FeatureAccess('TRAVEL')
export class TravelController {
  private readonly summaryBuilder = new TravelSummaryBuilder();

  constructor(
    private readonly travel: TravelService,
    private readonly finance: TravelFinanceService,
    private readonly gateway: MatchGateway,
  ) {}

  @Get('/travel')
  async index(@Req() req: Request, @Res() res: Response) {
    const user = req.session.user as CurrentUser;
    const [trips, destinations] = await Promise.all([this.travel.listTrips(user), this.travel.destinations()]);
    return render(res, 'travel/index', { trips, destinations });
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
    if (!(await this.travel.canManage(req.session.user as CurrentUser, BigInt(id)))) return forbidden(res);
    await this.travel.updateTrip(BigInt(id), body);
    this.gateway.emitTravelTripUpdated(id, 'trip-updated');
    return res.redirect(`/travel/trips/${id}`);
  }

  @Post('/travel/trips/:id/delete')
  @AdminOnly()
  async deleteTrip(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    if (!(await this.travel.canManage(req.session.user as CurrentUser, BigInt(id)))) return forbidden(res);
    await this.travel.deleteTrip(BigInt(id));
    this.gateway.emitTravelTripsUpdated('trip-deleted');
    return res.redirect('/travel');
  }

  @Get('/travel/trips/:id')
  async detail(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const user = req.session.user as CurrentUser;
    if (!(await this.travel.canView(user, BigInt(id)))) return forbidden(res);
    const detail = await this.travel.detail(BigInt(id));
    const summary = this.summaryBuilder.build(detail.members, detail.expenses, detail.trip.treasurerMemberId);
    const viewerMemberId = user.role === 'CLIENT' ? detail.members.find((member) => member.email.toLowerCase() === user.email.toLowerCase() || member.player?.email?.toLowerCase() === user.email.toLowerCase())?.id : null;
    return render(res, 'travel/detail', {
      ...detail,
      summary,
      viewerMemberId,
      expenseCategories: travelExpenseCategories,
      suggestionCategories: travelSuggestionCategories,
      isTravelAdmin: user.role === 'ADMIN',
      today: new Date().toISOString().slice(0, 10),
    });
  }

  @Get('/travel/people')
  @AdminOnly()
  async people(@Res() res: Response) {
    return render(res, 'travel/people', { people: await this.travel.people() });
  }

  @Post('/travel/people')
  @AdminOnly()
  async createPerson(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    await this.travel.createPerson(req.session.user as CurrentUser, body);
    return res.redirect('/travel/people');
  }

  @Post('/travel/people/:id/edit')
  @AdminOnly()
  async editPerson(@Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    await this.travel.updatePerson(BigInt(id), body);
    return res.redirect('/travel/people');
  }

  @Post('/travel/people/:id/delete')
  @AdminOnly()
  async deletePerson(@Res() res: Response, @Param('id') id: string) {
    await this.travel.deletePerson(BigInt(id));
    return res.redirect('/travel/people');
  }

  @Get('/travel/suggestions')
  @AdminOnly()
  async suggestions(@Res() res: Response, @Query('destinationId') destinationId?: string, @Query('category') category?: string) {
    const selectedDestinationId = destinationId ? BigInt(destinationId) : undefined;
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
    await this.travel.saveSuggestion(body, BigInt(id));
    return res.redirect('/travel/suggestions');
  }

  @Post('/travel/suggestions/:id/delete')
  @AdminOnly()
  async deleteSuggestion(@Res() res: Response, @Param('id') id: string) {
    await this.travel.deleteSuggestion(BigInt(id));
    return res.redirect('/travel/suggestions');
  }
}

function forbidden(res: Response) {
  return res.status(403).render('error', { message: 'Không có quyền' });
}
