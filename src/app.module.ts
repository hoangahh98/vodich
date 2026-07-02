import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AuthService } from './auth/auth.service';
import { LogService } from './logs/log.service';
import { AppController } from './app.controller';
import { TournamentService } from './tournaments/tournament.service';
import { MatchGateway } from './tournaments/match.gateway';
import { TeamService } from './teams/team.service';
import { LocalsMiddleware } from './common/locals.middleware';

@Module({
  controllers: [AppController],
  providers: [PrismaService, AuthService, LogService, TournamentService, TeamService, MatchGateway, LocalsMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LocalsMiddleware, LogService).forRoutes('*');
  }
}
