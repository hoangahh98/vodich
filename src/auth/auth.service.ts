import { Injectable, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma.service';
import { AppFeature, CurrentUser, UserRole } from '../types';

const CLIENT_PASSWORD = '123456789';
const WEAK_ADMIN_PASSWORDS = new Set(['', '123456789', 'admin', 'password']);

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly rootUsername = process.env.APP_ADMIN_USERNAME || 'admin';
  private readonly rootPassword = process.env.APP_ADMIN_PASSWORD || '123456789';

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (process.env.SKIP_ADMIN_BOOTSTRAP === 'true') return;
    if (process.env.NODE_ENV === 'production' && WEAK_ADMIN_PASSWORDS.has(this.rootPassword)) {
      console.warn(
        '[auth] APP_ADMIN_PASSWORD đang để giá trị mặc định/yếu ở production. Hãy đặt mật khẩu admin mạnh và đổi lại mật khẩu tài khoản admin gốc.',
      );
    }
    const existing = await this.prisma.appUser.findUnique({ where: { username: this.rootUsername } });
    if (!existing) {
      await this.prisma.appUser.create({
        data: {
          username: this.rootUsername,
          passwordHash: await bcrypt.hash(this.rootPassword, 10),
          displayName: 'Admin',
          role: 'ADMIN',
        },
      });
    }
  }

  async login(username: string, password: string, role: UserRole): Promise<CurrentUser> {
    const normalized = username.trim().toLowerCase();
    if (role === 'ADMIN') {
      const admin = await this.prisma.appUser.findUnique({ where: { username: normalized } });
      if (!admin || admin.role !== 'ADMIN' || !(await bcrypt.compare(password, admin.passwordHash))) {
        throw new Error('Tài khoản hoặc mật khẩu không đúng');
      }
      return { id: admin.id.toString(), email: admin.username, displayName: admin.displayName, role: 'ADMIN' };
    }

    if (password !== CLIENT_PASSWORD) {
      throw new Error('Mật khẩu không đúng');
    }
    const player = await this.prisma.player.findUnique({ where: { email: normalized } });
    if (player) {
      return { id: player.id.toString(), email: player.email, displayName: player.displayName, role: 'CLIENT' };
    }
    const registration = await this.prisma.tournamentRegistration.findFirst({
      where: { externalEmail: { equals: normalized, mode: 'insensitive' }, status: { in: ['ACTIVE', 'RESERVE'] } },
      orderBy: { id: 'asc' },
    });
    if (!registration || !registration.externalEmail) {
      throw new Error('Không tìm thấy client');
    }
    return {
      id: registration.id.toString(),
      email: registration.externalEmail,
      displayName: registration.externalName || registration.externalEmail,
      role: 'CLIENT',
    };
  }

  async featureSet(user?: CurrentUser): Promise<Set<AppFeature>> {
    if (!user) return new Set();
    if (user.role === 'CLIENT') return new Set(['TOURNAMENTS', 'TEAMS', 'TRAVEL']);
    if (this.isRoot(user)) return new Set(['TOURNAMENTS', 'TEAMS', 'TRAVEL', 'MEDICAL', 'PERMISSIONS']);
    const permissions = await this.prisma.adminFeaturePermission.findMany({ where: { adminId: BigInt(user.id) } });
    return new Set(permissions.map((permission) => permission.feature as AppFeature));
  }

  isRoot(user?: CurrentUser): boolean {
    return !!user && user.role === 'ADMIN' && user.email.toLowerCase() === this.rootUsername.toLowerCase();
  }

  can(user: CurrentUser | undefined, feature: AppFeature, featureSet?: Set<string>): boolean {
    if (!user) return false;
    if (this.isRoot(user)) return true;
    if (user.role === 'CLIENT') return ['TOURNAMENTS', 'TEAMS', 'TRAVEL'].includes(feature);
    return featureSet ? featureSet.has(feature) : false;
  }
}
