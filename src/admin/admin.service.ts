import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma.service';

const ADMIN_FEATURES = ['TOURNAMENTS', 'TEAMS', 'TRAVEL', 'MEDICAL', 'HOUSEHOLD', 'PERMISSIONS'] as const;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  readonly features = ADMIN_FEATURES;

  async listDelegatedAdmins() {
    const admins = await this.prisma.appUser.findMany({
      where: { role: 'ADMIN' },
      include: { permissions: true },
      orderBy: { id: 'asc' },
    });
    return admins.filter((admin) => admin.username.toLowerCase() !== 'admin');
  }

  async savePermissions(body: Record<string, string | string[] | undefined>) {
    const adminIds = Object.keys(body)
      .filter((key) => key.startsWith('username_'))
      .map((key) => BigInt(key.replace('username_', '')));
    const allowedFeatures = new Set<string>(ADMIN_FEATURES);
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
  }

  async createDelegatedAdmin(body: Record<string, string>) {
    const username = body.username.trim().toLowerCase();
    if (!username || username === 'admin') return;
    const existing = await this.prisma.appUser.findUnique({ where: { username } });
    if (existing) return;
    await this.prisma.appUser.create({
      data: {
        username,
        displayName: body.displayName?.trim() || username,
        passwordHash: await bcrypt.hash(body.password || '123456789', 10),
        role: 'ADMIN',
      },
    });
  }

  listLogs(level: string, category: string) {
    const where = {
      ...(level === 'ALL' ? {} : { level }),
      ...(category === 'ALL' ? {} : { category }),
    };
    return this.prisma.appLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  }
}
