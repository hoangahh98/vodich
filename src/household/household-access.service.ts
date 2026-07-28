import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AVAILABLE_ADMINS_ORDER, availableAdminsWhere, isRootAdmin, ownedOrSharedWhere } from '../common/admin-scope';
import { CurrentUser } from '../types';

const BOOK_INCLUDE = {
  ownerAdmin: { select: { id: true, username: true, displayName: true } },
  permissions: { include: { admin: { select: { id: true, username: true, displayName: true } } }, orderBy: { id: 'asc' as const } },
};

/**
 * Ai được vào sổ chi tiêu nào — tách khỏi HouseholdService để phần "quyền" và phần
 * "nghiệp vụ tiền" không lẫn vào nhau.
 *
 * Quy tắc giống module giải đấu / đội bóng:
 * - Admin gốc thấy mọi sổ.
 * - Admin thường thấy sổ mình tạo + sổ được người khác cấp quyền.
 * - CLIENT không bao giờ vào được (module này đã gắn @AdminOnly ở controller).
 * - Chỉ CHỦ SỔ (hoặc admin gốc) được cấp/gỡ quyền — người được mời không mời tiếp được.
 */
@Injectable()
export class HouseholdAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Các sổ admin này được vào, sổ của chính mình xếp trước. */
  async listBooks(user: CurrentUser) {
    if (user.role !== 'ADMIN') return [];
    const books = await this.prisma.householdConfig.findMany({
      where: isRootAdmin(user) ? {} : ownedOrSharedWhere(user),
      include: BOOK_INCLUDE,
      orderBy: { id: 'asc' },
    });
    const adminId = BigInt(user.id);
    return books.sort((a, b) => rank(a.ownerAdminId, adminId) - rank(b.ownerAdminId, adminId) || Number(a.id - b.id));
  }

  /**
   * Sổ đang mở. `requested` là id người dùng gửi lên — CHỈ được chấp nhận nếu nằm trong
   * danh sách sổ họ được vào, nếu không thì rơi về sổ đầu tiên (không báo lỗi, tránh dò id).
   * Admin chưa có sổ nào thì tạo mới ngay, để module dùng được từ lần vào đầu tiên.
   */
  async resolveBook(user: CurrentUser, requested?: unknown) {
    let books = await this.listBooks(user);
    if (!books.length) {
      await this.createBookFor(user);
      books = await this.listBooks(user);
    }
    const wanted = Number.parseInt(String(requested ?? ''), 10);
    const current = books.find((book) => book.id === wanted) ?? books[0];
    return { books, current };
  }

  private createBookFor(user: CurrentUser) {
    return this.prisma.householdConfig.create({ data: { ownerAdminId: BigInt(user.id) } });
  }

  /** Chỉ chủ sổ (hoặc admin gốc) mới được đụng vào phân quyền. */
  isOwner(user: CurrentUser, book: { ownerAdminId: bigint | null }) {
    return isRootAdmin(user) || book.ownerAdminId?.toString() === user.id;
  }

  availableAdmins(householdId: number, ownerAdminId?: bigint | null) {
    return this.prisma.appUser.findMany({
      where: availableAdminsWhere(ownerAdminId, { householdPermissions: { none: { householdId } } }),
      orderBy: AVAILABLE_ADMINS_ORDER,
    });
  }

  addPermission(householdId: number, adminId: bigint) {
    return this.prisma.householdPermission.create({ data: { householdId, adminId } });
  }

  /** Lọc kèm householdId: gửi lên permissionId của sổ khác cũng không gỡ được. */
  removePermission(householdId: number, permissionId: bigint) {
    return this.prisma.householdPermission.deleteMany({ where: { id: permissionId, householdId } });
  }
}

function rank(ownerAdminId: bigint | null, adminId: bigint) {
  return ownerAdminId === adminId ? 0 : 1;
}
