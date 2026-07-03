import { ConnectedSocket, MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { sessionMiddleware } from '../common/session';
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

  afterInit(server: Server) {
    server.engine.use(sessionMiddleware as unknown as (req: unknown, res: unknown, next: (err?: unknown) => void) => void);
  }

  emitTournamentUpdated(tournamentId: string | bigint, reason = 'updated') {
    this.server.to(`tournament:${String(tournamentId)}`).emit('tournamentUpdated', { tournamentId: String(tournamentId), reason });
  }

  @SubscribeMessage('joinTournament')
  join(@MessageBody() tournamentId: string, @ConnectedSocket() socket: Socket) {
    socket.join(`tournament:${tournamentId}`);
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
}

function stringifyBigInt<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item)));
}
