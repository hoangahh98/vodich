import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { LogService } from './logs/log.service';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { HealthController } from './health.controller';
import { HomeController } from './home.controller';
import { PlayersController } from './players/players.controller';
import { PlayersService } from './players/players.service';
import { TournamentService } from './tournaments/tournament.service';
import { TournamentCrudService } from './tournaments/tournament-crud.service';
import { TournamentDetailService } from './tournaments/tournament-detail.service';
import { TournamentDetailViewModelBuilder } from './tournaments/tournament-detail-view-model';
import { TournamentKnockoutService } from './tournaments/tournament-knockout.service';
import { TournamentRegistrationService } from './tournaments/tournament-registration.service';
import { TournamentScheduleService } from './tournaments/tournament-schedule.service';
import { TournamentController } from './tournaments/tournament.controller';
import { TournamentRegistrationController } from './tournaments/tournament-registration.controller';
import { TournamentScheduleController } from './tournaments/tournament-schedule.controller';
import { ExternalRegistrationController } from './tournaments/external-registration.controller';
import { MatchGateway } from './tournaments/match.gateway';
import { TeamService } from './teams/team.service';
import { TeamController } from './teams/team.controller';
import { LocalsMiddleware } from './common/locals.middleware';

@Module({
  controllers: [AuthController, HealthController, HomeController, PlayersController, TournamentController, TournamentRegistrationController, TournamentScheduleController, ExternalRegistrationController, TeamController, AdminController],
  providers: [PrismaService, AuthService, LogService, PlayersService, AdminService, TournamentService, TournamentCrudService, TournamentDetailService, TournamentDetailViewModelBuilder, TournamentKnockoutService, TournamentRegistrationService, TournamentScheduleService, TeamService, MatchGateway, LocalsMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LocalsMiddleware, LogService).forRoutes('*');
  }
}
