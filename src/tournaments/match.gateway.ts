import { ConnectedSocket, MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { createConnectedRedisClient, createRedisClient, isRedisConfigured, recordRedisLog, redisConnectionSummary } from '../common/redis';
import { getSessionMiddleware } from '../common/session';
import { PrismaService } from '../prisma.service';
import { CurrentUser } from '../types';
import { TournamentService } from './tournament.service';

@WebSocketGateway({ cors: false })
export class MatchGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tournaments: TournamentService,
    private readonly auth: AuthService,
  ) {}

  async afterInit(server: Server) {
    const sessionMiddleware = await getSessionMiddleware();
    server.engine.use(sessionMiddleware as unknown as (req: unknown, res: unknown, next: (err?: unknown) => void) => void);
    await this.configureRedisAdapter(server);
  }

  emitTournamentUpdated(tournamentId: string | bigint, reason = 'updated') {
    this.server.to(`tournament:${String(tournamentId)}`).emit('tournamentUpdated', { tournamentId: String(tournamentId), reason });
  }

  emitTeamUpdated(teamId: string | bigint, reason = 'updated') {
    this.server.to(`team:${String(teamId)}`).emit('teamUpdated', { teamId: String(teamId), reason });
    this.emitTeamsUpdated(reason);
  }

  emitTeamsUpdated(reason = 'updated') {
    this.server.emit('teamsUpdated', { reason });
  }

  @SubscribeMessage('joinTournament')
  join(@MessageBody() tournamentId: string, @ConnectedSocket() socket: Socket) {
    socket.join(`tournament:${tournamentId}`);
  }

  @SubscribeMessage('joinTeam')
  joinTeam(@MessageBody() teamId: string, @ConnectedSocket() socket: Socket) {
    socket.join(`team:${teamId}`);
  }

  @SubscribeMessage('score')
  async score(
    @MessageBody() body: { tournamentId: string; matchId: string; scoreA: number; scoreB: number; servingTeam?: string; scoreOrder?: number },
    @ConnectedSocket() socket: Socket,
  ) {
    if (!(await this.canUpdateScore(socket))) {
      socket.emit('scoreRejected', { message: 'Không có quyền ghi điểm' });
      return;
    }
    const match = await this.prisma.matchGame.findUnique({
      where: { id: BigInt(body.matchId) },
      include: { tournament: true },
    });
    if (!match) return;
    const tournamentId = match.tournamentId;
    let scoreA = Math.max(0, Number(body.scoreA) || 0);
    let scoreB = Math.max(0, Number(body.scoreB) || 0);
    const isKnockout = match.stage !== 'Vòng bảng' && match.stage !== 'Vòng tròn';
    const touchScore = Math.max(1, isKnockout ? match.tournament.knockoutTouchScore || 15 : match.tournament.touchScore || 11);
    const maxScore = Math.max(1, isKnockout ? match.tournament.knockoutMaxScore || 19 : match.tournament.maxScore || 15);
    const maxAllowed = (opponentScore: number) => {
      if (opponentScore >= touchScore - 1) return Math.min(opponentScore + 2, maxScore);
      return Math.min(touchScore, maxScore);
    };
    scoreA = Math.min(scoreA, maxAllowed(scoreB));
    scoreB = Math.min(scoreB, maxAllowed(scoreA));
    const high = Math.max(scoreA, scoreB);
    const diff = Math.abs(scoreA - scoreB);
    const status = high >= maxScore || (high >= touchScore && diff >= 2) ? 'FINISHED' : 'PLAYING';
    const updated = await this.prisma.matchGame.update({
      where: { id: match.id },
      data: {
        scoreA,
        scoreB,
        servingTeam: body.servingTeam === 'B' ? 'B' : 'A',
        scoreOrder: body.scoreOrder === 1 ? 1 : 2,
        status,
        updatedAt: new Date(),
      },
    });
    this.server.to(`tournament:${String(tournamentId)}`).emit('scoreUpdated', stringifyBigInt(updated));
    if (status === 'FINISHED' && (await this.tournaments.syncKnockout(match.tournamentId))) {
      this.emitTournamentUpdated(tournamentId, 'knockout');
    }
  }

  private async canUpdateScore(socket: Socket): Promise<boolean> {
    const request = socket.request as typeof socket.request & { session?: { user?: CurrentUser } };
    const user = request.session?.user;
    if (!user || user.role !== 'ADMIN') return false;
    const featureSet = await this.auth.featureSet(user);
    return this.auth.can(user, 'TOURNAMENTS', featureSet);
  }

  private async configureRedisAdapter(server: Server) {
    if (!isRedisConfigured()) return;
    let pubClient: Awaited<ReturnType<typeof createConnectedRedisClient>>;
    let subClient: ReturnType<typeof createRedisClient>;
    try {
      pubClient = await createConnectedRedisClient('socket-pub');
      subClient = createRedisClient('socket-sub');
      if (!pubClient || !subClient) return;
      await subClient.connect();
      recordRedisLog('INFO', 'socket-sub connected', redisConnectionSummary());
      server.adapter(createAdapter(pubClient, subClient));
      recordRedisLog('INFO', 'socket adapter enabled', redisConnectionSummary());
    } catch (error) {
      recordRedisLog('ERROR', 'socket adapter fallback to memory', redisConnectionSummary(), error);
      await pubClient?.quit().catch(() => undefined);
      await subClient?.quit().catch(() => undefined);
    }
  }
}

function stringifyBigInt<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item)));
}
