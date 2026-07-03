import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma.service';
import { TournamentService } from './tournament.service';

@WebSocketGateway({ cors: false })
export class MatchGateway {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tournaments: TournamentService,
  ) {}

  emitTournamentUpdated(tournamentId: string | bigint, reason = 'updated') {
    this.server.to(`tournament:${String(tournamentId)}`).emit('tournamentUpdated', { tournamentId: String(tournamentId), reason });
  }

  @SubscribeMessage('joinTournament')
  join(@MessageBody() tournamentId: string, @ConnectedSocket() socket: Socket) {
    socket.join(`tournament:${tournamentId}`);
  }

  @SubscribeMessage('score')
  async score(@MessageBody() body: { tournamentId: string; matchId: string; scoreA: number; scoreB: number; servingTeam?: string; scoreOrder?: number }) {
    const match = await this.prisma.matchGame.findUnique({
      where: { id: BigInt(body.matchId) },
      include: { tournament: true },
    });
    if (!match) return;
    let scoreA = Math.max(0, Number(body.scoreA) || 0);
    let scoreB = Math.max(0, Number(body.scoreB) || 0);
    const touchScore = Math.max(1, match.tournament.touchScore || 11);
    const maxScore = Math.max(1, match.tournament.maxScore || 15);
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
    this.server.to(`tournament:${body.tournamentId}`).emit('scoreUpdated', stringifyBigInt(updated));
    if (status === 'FINISHED' && (await this.tournaments.syncKnockout(match.tournamentId))) {
      this.emitTournamentUpdated(body.tournamentId, 'knockout');
    }
  }
}

function stringifyBigInt<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item)));
}
