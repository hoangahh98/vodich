import { ConnectedSocket, MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server, Socket } from 'socket.io';
import { createConnectedRedisClient, createRedisClient, isRedisConfigured, isRedisRequired, recordRedisLog, redisConnectionSummary, requiredRedisError, setRedisFeatureStatus } from '../common/redis';
import { getSessionMiddleware } from '../common/session';
import { SOCKET_EVENTS, ScorePayload, teamRoom, tournamentRoom } from '../realtime/socket-events';
import { CurrentUser } from '../types';
import { MatchScoreService, SaveScoreOk } from './match-score.service';
import { TournamentService } from './tournament.service';

@WebSocketGateway({ cors: false })
export class MatchGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly tournaments: TournamentService,
    private readonly scores: MatchScoreService,
  ) {}

  async afterInit(server: Server) {
    const sessionMiddleware = await getSessionMiddleware();
    server.engine.use(sessionMiddleware as unknown as (req: unknown, res: unknown, next: (err?: unknown) => void) => void);
    await this.configureRedisAdapter(server);
  }

  emitTournamentUpdated(tournamentId: string | bigint, reason = 'updated') {
    this.server.to(tournamentRoom(tournamentId)).emit(SOCKET_EVENTS.TOURNAMENT_UPDATED, { tournamentId: String(tournamentId), reason });
  }

  emitTeamUpdated(teamId: string | bigint, reason = 'updated') {
    this.server.to(teamRoom(teamId)).emit(SOCKET_EVENTS.TEAM_UPDATED, { teamId: String(teamId), reason });
    this.emitTeamsUpdated(reason);
  }

  emitTeamsUpdated(reason = 'updated') {
    this.server.emit(SOCKET_EVENTS.TEAMS_UPDATED, { reason });
  }

  @SubscribeMessage(SOCKET_EVENTS.JOIN_TOURNAMENT)
  join(@MessageBody() tournamentId: string, @ConnectedSocket() socket: Socket) {
    socket.join(tournamentRoom(tournamentId));
  }

  @SubscribeMessage(SOCKET_EVENTS.JOIN_TEAM)
  joinTeam(@MessageBody() teamId: string, @ConnectedSocket() socket: Socket) {
    socket.join(teamRoom(teamId));
  }

  /**
   * Ghi điểm qua socket. Giá trị trả về là ACK cho client (Nest gọi callback của socket.io với nó):
   * client chờ ack rồi mới hiện "Đã lưu"; không ack trong vài giây thì đi đường HTTP dự phòng.
   * Trước 28/9/2026 handler này tự lưu DB và exception bị nuốt im lặng — xem `MatchScoreService`.
   */
  @SubscribeMessage(SOCKET_EVENTS.SCORE)
  async score(@MessageBody() body: ScorePayload, @ConnectedSocket() socket: Socket) {
    const request = socket.request as typeof socket.request & { session?: { user?: CurrentUser } };
    const result = await this.scores.save(request.session?.user, body);
    if (!result.ok) {
      socket.emit(SOCKET_EVENTS.SCORE_REJECTED, { message: result.message, retryable: result.retryable, seq: body.seq ?? null });
      return { ok: false, message: result.message, retryable: result.retryable };
    }
    await this.broadcastScore(result, { origin: socket.id, seq: body.seq });
    return { ok: true, match: result.match };
  }

  /**
   * Phát điểm mới cho cả phòng giải. Kèm `origin` (id socket đã gửi) + `seq` (số thứ tự lần lưu của
   * client ấy) để chính máy gửi nhận ra TIẾNG VỌNG của mình mà không ghi đè state cục bộ — tiếng vọng
   * về sau khi người dùng đã bấm tiếp từng kéo người giao ngược lại đội cũ (chủ app báo 28/9/2026).
   */
  async broadcastScore(result: SaveScoreOk, meta: { origin?: string; seq?: number } = {}) {
    this.server.to(tournamentRoom(result.tournamentId)).emit(SOCKET_EVENTS.SCORE_UPDATED, {
      ...result.match,
      origin: meta.origin || null,
      seq: meta.seq ?? null,
    });
    if (result.finished && (await this.tournaments.syncKnockout(result.tournamentId))) {
      this.emitTournamentUpdated(result.tournamentId, 'knockout');
    }
  }

  private async configureRedisAdapter(server: Server) {
    if (!isRedisConfigured()) {
      setRedisFeatureStatus('socketAdapter', false, 'REDIS_URL not configured');
      if (isRedisRequired()) throw requiredRedisError('REDIS_URL is not configured for socket adapter');
      return;
    }
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
      setRedisFeatureStatus('socketAdapter', true);
    } catch (error) {
      const action = isRedisRequired() ? 'socket adapter failed' : 'socket adapter fallback to memory';
      recordRedisLog('ERROR', action, redisConnectionSummary(), error);
      setRedisFeatureStatus('socketAdapter', false, action);
      await pubClient?.quit().catch(() => undefined);
      await subClient?.quit().catch(() => undefined);
      if (isRedisRequired()) throw requiredRedisError('socket adapter failed', error);
    }
  }
}
