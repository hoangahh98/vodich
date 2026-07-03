import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
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
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: BigInt(id) } });
    return render(res, 'external-register', { tournament });
  }

  @Post('/external-register/:id')
  async externalRegisterSubmit(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: BigInt(id) } });
    const limit = this.rateLimit.consume(`external-register:${clientIp(req)}:${id}:${String(body.email || '').trim().toLowerCase()}`, { max: 5 });
    if (!limit.allowed) {
      return render(res.status(429), 'external-register', { tournament, error: `Thử lại sau ${limit.retryAfterSeconds} giây`, form: body });
    }

    try {
      const registration = await this.tournaments.registerExternal(BigInt(id), body.displayName, body.email, body.skillLevel);
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
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) return forwarded[0] || req.ip;
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip;
}
