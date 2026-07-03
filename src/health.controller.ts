import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { checkRedisReady, getRedisFeatureStatuses } from './common/redis';
import { PrismaService } from './prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('/healthz')
  healthz() {
    return { ok: true, service: 'vodich-tool' };
  }

  @Get('/readyz')
  async readyz(@Res() res: Response) {
    const db = await this.checkDatabase();
    const redis = await this.checkRedis();
    const ok = db.ok && redis.ok;
    return res.status(ok ? 200 : 503).json({ ok, db, redis });
  }

  private async checkDatabase() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async checkRedis() {
    try {
      return { ...(await checkRedisReady()), features: getRedisFeatureStatuses() };
    } catch (error) {
      return { configured: true, ok: false, error: errorMessage(error), features: getRedisFeatureStatuses() };
    }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
