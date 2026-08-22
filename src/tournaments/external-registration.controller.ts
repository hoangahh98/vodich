import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { notFound, parseBigId } from '../common/controller-utils';
import { Public } from '../common/feature.decorator';
import { RateLimitService } from '../common/rate-limit.service';
import { render } from '../common/view';
import { PrismaService } from '../prisma.service';
import { MatchGateway } from './match.gateway';
import { TournamentService } from './tournament.service';

// Người ngoài tự đăng ký giải qua link chia sẻ nên chưa có tài khoản.
// Đã có rate-limit theo IP + email ở POST để không bị spam.
@Public()
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
    const tournament = await this.openTournament(id);
    if (!tournament) return notFound(res, 'Không tìm thấy giải đấu');
    return render(res, 'external-register', { tournament });
  }

  @Post('/external-register/:id')
  async externalRegisterSubmit(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const tournament = await this.openTournament(id);
    if (!tournament) return notFound(res, 'Không tìm thấy giải đấu');
    const limit = this.rateLimit.consume(`external-register:${clientIp(req)}:${id}:${String(body.email || '').trim().toLowerCase()}`, { max: 5 });
    if (!limit.allowed) {
      return render(res.status(429), 'external-register', { tournament, error: `Thử lại sau ${limit.retryAfterSeconds} giây`, form: body });
    }

    try {
      const registration = await this.tournaments.registerExternal(tournament.id, body.displayName, body.email, body.skillLevel);
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
  /**
   * Giải mà người ngoài ĐƯỢC PHÉP nhìn thấy qua link chia sẻ: phải tồn tại VÀ đang mở đăng ký
   * ngoài. Trả `null` cho mọi trường hợp còn lại để nơi gọi báo "không tìm thấy".
   *
   * Trước đây chỉ POST kiểm `externalRegistrationEnabled`, còn GET thì cứ tìm thấy là render.
   * Hệ quả: ai cũng dò được `/external-register/1,2,3...` để lấy TÊN của mọi giải trong hệ
   * thống, kể cả giải chưa hề mở đăng ký ngoài — endpoint này là public nên không cần tài
   * khoản. Kèm theo đó là người lạ điền hết form rồi mới bị POST từ chối.
   *
   * Cố tình trả "không tìm thấy" thay vì "giải chưa mở đăng ký": phân biệt hai câu đó chính là
   * xác nhận giải có tồn tại, tức là vẫn dò ra được danh sách id đang dùng.
   */
  private async openTournament(id: string) {
    const tournamentId = parseBigId(id);
    if (!tournamentId) return null;
    return this.prisma.tournament.findFirst({ where: { id: tournamentId, externalRegistrationEnabled: true } });
  }
}

function clientIp(req: Request) {
  return req.ip || 'unknown';
}
