import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { notFound, parseBigId } from '../common/controller-utils';
import { RateLimitService } from '../common/rate-limit.service';
import { render } from '../common/view';
import { PrismaService } from '../prisma.service';
import { MatchGateway } from './match.gateway';
import { TournamentService } from './tournament.service';

@Controller()
export class ExternalRegistrationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tournaments: TournamentService,
    private readonly matchGateway: MatchGateway,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get('/external-register/:id')
  async externalRegister(@Res() res: Response, @Param('id') id: string) {
    const tournamentId = parseBigId(id);
    if (!tournamentId) return notFound(res, 'Không tìm thấy giải đấu');
    const tournament = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) return notFound(res, 'Không tìm thấy giải đấu');
    return render(res, 'external-register', { tournament });
  }

  @Post('/external-register/:id')
  async externalRegisterSubmit(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const tournamentId = parseBigId(id);
    if (!tournamentId) return notFound(res, 'Không tìm thấy giải đấu');
    const tournament = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) return notFound(res, 'Không tìm thấy giải đấu');
    const limit = this.rateLimit.consume(`external-register:${clientIp(req)}:${id}:${String(body.email || '').trim().toLowerCase()}`, { max: 5 });
    if (!limit.allowed) {
      return render(res.status(429), 'external-register', { tournament, error: `Thử lại sau ${limit.retryAfterSeconds} giây`, form: body });
    }

    try {
      const registration = await this.tournaments.registerExternal(tournamentId, body.displayName, body.email, body.skillLevel);
      this.matchGateway.emitTournamentUpdated(id, 'registrations');
      return render(res, 'external-success', { registration: { ...registration, tournamentId: id } });
    } catch (error) {
      return render(res.status(400), 'external-register', {
        tournament,
        error: error instanceof Error ? error.message : 'Đăng ký thất bại',
        form: body,
      });
    }
  }
}

function clientIp(req: Request) {
  return req.ip || 'unknown';
}
