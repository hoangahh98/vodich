import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaService } from './prisma.service';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { HttpLogInterceptor } from './logs/http-log.interceptor';
import { LogService } from './logs/log.service';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { HealthController } from './health.controller';
import { HomeController } from './home.controller';
import { GamesController } from './games/games.controller';
import { KnightController } from './games/knight.controller';
import { KnightService } from './games/knight.service';
import { KnightAiService } from './games/knight-ai.service';
import { MedicalController } from './medical/medical.controller';
import { MedicalService } from './medical/medical.service';
import { MedicalAiService } from './medical/medical-ai.service';
import { CabinetService } from './medical/cabinet.service';
import { HouseholdController } from './household/household.controller';
import { HouseholdService } from './household/household.service';
import { HouseholdEmailService } from './household/household-email.service';
import { PlayersController } from './players/players.controller';
import { PlayersService } from './players/players.service';
import { TournamentService } from './tournaments/tournament.service';
import { TournamentCrudService } from './tournaments/tournament-crud.service';
import { TournamentDetailService } from './tournaments/tournament-detail.service';
import { TournamentDetailViewModelBuilder } from './tournaments/tournament-detail-view-model';
import { TournamentKnockoutService } from './tournaments/tournament-knockout.service';
import { TournamentPaymentService } from './tournaments/tournament-payment.service';
import { TournamentRegistrationService } from './tournaments/tournament-registration.service';
import { TournamentScheduleService } from './tournaments/tournament-schedule.service';
import { TournamentController } from './tournaments/tournament.controller';
import { TournamentRegistrationController } from './tournaments/tournament-registration.controller';
import { TournamentScheduleController } from './tournaments/tournament-schedule.controller';
import { ExternalRegistrationController } from './tournaments/external-registration.controller';
import { MatchGateway } from './tournaments/match.gateway';
import { TeamService } from './teams/team.service';
import { TeamCrudService } from './teams/team-crud.service';
import { TeamDetailService } from './teams/team-detail.service';
import { TeamExpenseController } from './teams/team-expense.controller';
import { TeamExpenseService } from './teams/team-expense.service';
import { TeamFundController } from './teams/team-fund.controller';
import { TeamFundService } from './teams/team-fund.service';
import { TeamMemberController } from './teams/team-member.controller';
import { TeamMemberService } from './teams/team-member.service';
import { TeamController } from './teams/team.controller';
import { TravelController } from './travel/travel.controller';
import { TravelFinanceController } from './travel/travel-finance.controller';
import { TravelFinanceService } from './travel/travel-finance.service';
import { TravelService } from './travel/travel.service';
import { TravelAiService } from './travel/travel-ai.service';
import { AiService } from './common/ai.service';
import { LocalsMiddleware } from './common/locals.middleware';
import { RateLimitService } from './common/rate-limit.service';
import { FeatureGuard } from './common/feature.guard';
// TẠM THỜI: module thử METHOD:CANCEL. Xoá dòng này + src/ics-test là gỡ sạch.
import { IcsTestController } from './ics-test/ics-test.controller';

@Module({
  controllers: [AuthController, HealthController, HomeController, GamesController, KnightController, PlayersController, TournamentController, TournamentRegistrationController, TournamentScheduleController, ExternalRegistrationController, TeamController, TeamMemberController, TeamFundController, TeamExpenseController, TravelController, TravelFinanceController, MedicalController, HouseholdController, AdminController, IcsTestController],
  providers: [
    PrismaService,
    AuthService,
    LogService,
    KnightService,
    KnightAiService,
    PlayersService,
    AdminService,
    TournamentService,
    TournamentCrudService,
    TournamentDetailService,
    TournamentDetailViewModelBuilder,
    TournamentKnockoutService,
    TournamentPaymentService,
    TournamentRegistrationService,
    TournamentScheduleService,
    TeamService,
    TeamCrudService,
    TeamDetailService,
    TeamExpenseService,
    TeamFundService,
    TeamMemberService,
    TravelService,
    TravelFinanceService,
    TravelAiService,
    MedicalService,
    MedicalAiService,
    CabinetService,
    HouseholdService,
    HouseholdEmailService,
    AiService,
    MatchGateway,
    LocalsMiddleware,
    RateLimitService,
    FeatureGuard,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpLogInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LocalsMiddleware).forRoutes('*');
  }
}
