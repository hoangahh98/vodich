import { CurrentUser } from '../types';

export function isRootAdmin(user: CurrentUser | undefined): boolean {
  return !!user && user.role === 'ADMIN' && user.email.toLowerCase() === rootAdminUsername();
}

export function rootAdminUsername(): string {
  return (process.env.APP_ADMIN_USERNAME || 'admin').toLowerCase();
}

/**
 * Điều kiện lọc "tài nguyên mà admin này được đụng vào": chủ sở hữu HOẶC được cấp quyền.
 *
 * Mọi module có chủ sở hữu (giải đấu, đội bóng, chuyến đi, hồ sơ y tế, sổ chi tiêu) đều
 * dùng chung đúng một hàm này. Trước đây mỗi service tự chép lại biểu thức OR — sửa sót
 * một chỗ là rò dữ liệu sang admin khác, nên phải có một nguồn duy nhất.
 */
export function ownedOrSharedWhere(user: CurrentUser): OwnerScopeWhere {
  const adminId = BigInt(user.id);
  return { OR: [{ ownerAdminId: adminId }, { permissions: { some: { adminId } } }] };
}

export interface OwnerScopeWhere {
  OR: [{ ownerAdminId: bigint }, { permissions: { some: { adminId: bigint } } }];
}

/**
 * Danh sách admin CÓ THỂ được thêm vào một tài nguyên: là admin, không phải admin gốc
 * (gốc vốn thấy hết), không phải chủ sở hữu, và chưa được cấp quyền.
 *
 * `notYetGranted` là bộ lọc theo quan hệ riêng của từng module, ví dụ
 * `{ teamPermissions: { none: { teamId } } }`.
 */
export function availableAdminsWhere(ownerAdminId: bigint | null | undefined, notYetGranted: Record<string, unknown>) {
  return {
    role: 'ADMIN',
    username: { not: rootAdminUsername() },
    id: { notIn: [ownerAdminId || 0n] },
    ...notYetGranted,
  };
}

export const AVAILABLE_ADMINS_ORDER = [{ displayName: 'asc' as const }, { username: 'asc' as const }];
