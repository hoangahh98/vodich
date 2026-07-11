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
    // Endpoint public: chỉ trả trạng thái boolean, không lộ message lỗi/host:port nội bộ.
    return res.status(ok ? 200 : 503).json({ ok, db, redis });
  }

  private async checkDatabase() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch (error) {
      console.error('[readyz] database check failed', error);
      return { ok: false };
    }
  }

  private async checkRedis() {
    try {
      const status = await checkRedisReady();
      return { configured: status.configured, required: status.required, ok: status.ok, features: publicFeatureFlags() };
    } catch (error) {
      console.error('[readyz] redis check failed', error);
      return { configured: true, ok: false, features: publicFeatureFlags() };
    }
  }
}

/** Chỉ phơi cờ enabled cho từng feature, ẩn `details` (chứa host:port Redis). */
function publicFeatureFlags() {
  return Object.fromEntries(
    Object.entries(getRedisFeatureStatuses()).map(([feature, status]) => [feature, { enabled: status.enabled }]),
  );
}
