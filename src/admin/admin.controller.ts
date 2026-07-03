import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    const admins = (
      await this.prisma.appUser.findMany({ where: { role: 'ADMIN' }, include: { permissions: true }, orderBy: { id: 'asc' } })
    ).filter((admin) => admin.username.toLowerCase() !== 'admin');
    return render(res, 'permissions', { admins, features: ['TOURNAMENTS', 'TEAMS', 'TRAVEL', 'PERMISSIONS'] });
  }

  @Post('/permissions')
  async savePermissions(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string | string[] | undefined>) {
    const user = requireUser(req, res);
    if (!user || !this.auth.isRoot(user)) return res.status(403).render('error', { message: 'Không có quyền' });
    const adminIds = Object.keys(body)
      .filter((key) => key.startsWith('username_'))
      .map((key) => BigInt(key.replace('username_', '')));
    const allowedFeatures = new Set(['TOURNAMENTS', 'TEAMS', 'TRAVEL', 'PERMISSIONS']);
    const operations: Prisma.PrismaPromise<unknown>[] = [];
    for (const adminId of adminIds) {
      const username = String(body[`username_${adminId}`] || '').trim().toLowerCase();
      if (!username || username === 'admin') continue;
      const displayName = String(body[`displayName_${adminId}`] || username).trim();
      const password = String(body[`password_${adminId}`] || '').trim();
      const selected = body[`features_${adminId}`];
      const features = (Array.isArray(selected) ? selected : selected ? [selected] : []).filter((feature) => allowedFeatures.has(String(feature)));
      operations.push(
        this.prisma.appUser.update({
          where: { id: adminId },
          data: {
            username,
            displayName: displayName || username,
            ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
          },
        }),
        this.prisma.adminFeaturePermission.deleteMany({ where: { adminId } }),
      );
      if (features.length) {
        operations.push(
          this.prisma.adminFeaturePermission.createMany({
            data: features.map((feature) => ({ adminId, feature: String(feature) })),
            skipDuplicates: true,
          }),
        );
      }
    }
    if (operations.length) await this.prisma.$transaction(operations);
    return res.redirect('/permissions');
  }

  @Post('/admins')
  async createAdmin(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const user = requireUser(req, res);
    if (!user || !this.auth.isRoot(user)) return res.status(403).render('error', { message: 'Không có quyền' });
    const username = body.username.trim().toLowerCase();
    if (!username || username === 'admin') return res.redirect('/permissions');
    const existing = await this.prisma.appUser.findUnique({ where: { username } });
    if (existing) return res.redirect('/permissions');
    await this.prisma.appUser.create({
      data: {
        username,
        displayName: body.displayName?.trim() || username,
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
