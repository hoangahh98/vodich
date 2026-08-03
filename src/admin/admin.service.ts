import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma.service';

const ADMIN_FEATURES = ['TOURNAMENTS', 'TEAMS', 'PERMISSIONS'] as const;

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

  /**
   * `user` là tên đăng nhập đã ghi trong log, `ANON` = các request chưa đăng nhập, `ALL` = không lọc.
   * Lọc theo tên chứ không theo id: log của tài khoản đã bị xoá vẫn tra lại được, và đó chính là
   * lúc người ta cần soi nhất.
   */
  listLogs(level: string, category: string, user = 'ALL') {
    const where = {
      ...(level === 'ALL' ? {} : { level }),
      ...(category === 'ALL' ? {} : { category }),
      ...(user === 'ALL' ? {} : user === ANON_USER ? { username: null } : { username: user }),
    };
    return this.prisma.appLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  /**
   * Các tài khoản THẬT SỰ có mặt trong log, để dựng ô lọc. Lấy từ chính bảng log chứ không
   * từ danh sách admin: liệt kê tài khoản không có dòng nào là bày ra một ô lọc luôn ra rỗng,
   * còn tài khoản đã xoá thì lại biến mất đúng lúc cần tra.
   */
  async listLogUsers(): Promise<Array<{ value: string; label: string }>> {
    const rows = await this.prisma.appLog.findMany({
      distinct: ['username'],
      select: { username: true },
      orderBy: { username: 'asc' },
      take: 200,
    });
    const named = rows.map((row) => row.username).filter((name): name is string => Boolean(name));
    const hasAnon = rows.some((row) => !row.username);
    return [
      { value: 'ALL', label: 'Tất cả' },
      ...named.map((name) => ({ value: name, label: name })),
      ...(hasAnon ? [{ value: ANON_USER, label: 'Chưa đăng nhập' }] : []),
    ];
  }
}

/** Giá trị riêng cho "chưa đăng nhập" — không thể trùng tên tài khoản thật vì có dấu cách. */
export const ANON_USER = '(chua dang nhap)';
