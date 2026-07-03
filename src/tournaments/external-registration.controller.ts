import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
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
  ) {}

  @Get('/external-register/:id')
  async externalRegister(@Res() res: Response, @Param('id') id: string) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: BigInt(id) } });
    return render(res, 'external-register', { tournament });
  }

  @Post('/external-register/:id')
  async externalRegisterSubmit(@Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const registration = await this.tournaments.registerExternal(BigInt(id), body.displayName, body.email, body.skillLevel);
    this.matchGateway.emitTournamentUpdated(id, 'registrations');
    return render(res, 'external-success', { registration: { ...registration, tournamentId: id } });
  }
}
