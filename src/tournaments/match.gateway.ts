import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma.service';

@WebSocketGateway({ cors: false })
export class MatchGateway {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly prisma: PrismaService) {}

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
    const scoreA = Math.max(0, Number(body.scoreA) || 0);
    const scoreB = Math.max(0, Number(body.scoreB) || 0);
    const high = Math.max(scoreA, scoreB);
    const diff = Math.abs(scoreA - scoreB);
    const status = high >= match.tournament.maxScore || (high >= match.tournament.touchScore && diff >= 2) ? 'FINISHED' : 'PLAYING';
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
  }
}

function stringifyBigInt<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item)));
}
