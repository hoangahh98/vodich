import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { LogService } from './logs/log.service';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { HomeController } from './home.controller';
import { PlayersController } from './players/players.controller';
import { PlayersService } from './players/players.service';
import { TournamentService } from './tournaments/tournament.service';
import { TournamentRegistrationService } from './tournaments/tournament-registration.service';
import { TournamentController } from './tournaments/tournament.controller';
import { MatchGateway } from './tournaments/match.gateway';
import { TeamService } from './teams/team.service';
import { TeamController } from './teams/team.controller';
import { LocalsMiddleware } from './common/locals.middleware';

@Module({
  controllers: [AuthController, HomeController, PlayersController, TournamentController, TeamController, AdminController],
  providers: [PrismaService, AuthService, LogService, PlayersService, AdminService, TournamentService, TournamentRegistrationService, TeamService, MatchGateway, LocalsMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LocalsMiddleware, LogService).forRoutes('*');
  }
}
