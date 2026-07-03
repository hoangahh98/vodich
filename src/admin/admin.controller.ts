import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { requireUser } from '../common/controller-utils';
import { render } from '../common/view';
import { PrismaService } from '../prisma.service';

@Controller()
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  @Get('/permissions')
  async permissions(@Req() req: Request, @Res() res: Response) {
    const user = requireUser(req, res);
    if (!user) return;
    if (!this.auth.isRoot(user)) return res.status(403).render('error', { message: 'Không có quyền' });
    const admins = await this.prisma.appUser.findMany({ where: { role: 'ADMIN' }, include: { permissions: true }, orderBy: { id: 'asc' } });
    return render(res, 'permissions', { admins, features: ['TOURNAMENTS', 'TEAMS', 'TRAVEL', 'PERMISSIONS'] });
  }

  @Post('/permissions')
  async savePermissions(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string | string[]>) {
    const user = requireUser(req, res);
    if (!user || !this.auth.isRoot(user)) return res.status(403).render('error', { message: 'Không có quyền' });
    const adminId = BigInt(String(body.adminId));
    const features = Array.isArray(body.features) ? body.features : body.features ? [body.features] : [];
    await this.prisma.$transaction([
      this.prisma.adminFeaturePermission.deleteMany({ where: { adminId } }),
      this.prisma.adminFeaturePermission.createMany({
        data: features.map((feature) => ({ adminId, feature })),
        skipDuplicates: true,
      }),
    ]);
    return res.redirect('/permissions');
  }

  @Post('/admins')
  async createAdmin(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const user = requireUser(req, res);
    if (!user || !this.auth.isRoot(user)) return res.status(403).render('error', { message: 'Không có quyền' });
    await this.prisma.appUser.upsert({
      where: { username: body.username.trim().toLowerCase() },
      update: { displayName: body.displayName || body.username, passwordHash: await bcrypt.hash(body.password || '123456789', 10) },
      create: {
        username: body.username.trim().toLowerCase(),
        displayName: body.displayName || body.username,
        passwordHash: await bcrypt.hash(body.password || '123456789', 10),
        role: 'ADMIN',
      },
    });
    return res.redirect('/permissions');
  }

  @Get('/logs')
  async logs(@Req() req: Request, @Res() res: Response) {
    const user = requireUser(req, res);
    if (!user || !this.auth.isRoot(user)) return res.status(403).render('error', { message: 'Chỉ admin gốc được xem log' });
    const level = String(req.query.level || 'ERROR');
    const category = String(req.query.category || 'ALL');
    const where = {
      ...(level === 'ALL' ? {} : { level }),
      ...(category === 'ALL' ? {} : { category }),
    };
    const logs = await this.prisma.appLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    return render(res, 'logs/index', { logs, level, levels: ['ERROR', 'WARN', 'INFO', 'ALL'], category, categories: ['ALL', 'HTTP', 'REDIS'] });
  }
}
