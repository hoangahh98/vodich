/**
 * Tập giá trị hợp lệ dùng chung cho toàn app, tránh magic string rải rác và
 * chống lưu giá trị rác do client gửi thẳng vào DB.
 */

export const PLAY_TYPES = ['SINGLES', 'DOUBLES'] as const;
export const TOURNAMENT_FORMATS = ['ROUND_ROBIN', 'GROUP_KNOCKOUT', 'AMERICANO'] as const;

/**
 * Quy tắc ghép cặp đôi:
 *  - `BY_SKILL`  — cân bằng theo trình (mạnh ghép yếu). Hành vi mặc định từ trước tới nay,
 *                  nên phải là giá trị fallback để giải cũ không đổi cách bốc.
 *  - `RANDOM`    — bỏ qua trình, xáo thuần ngẫu nhiên.
 */
export const PAIRING_RULES = ['BY_SKILL', 'RANDOM'] as const;
export type PairingRule = (typeof PAIRING_RULES)[number];

export function normalizePairingRule(value: unknown): PairingRule {
  return oneOf(value, PAIRING_RULES, 'BY_SKILL');
}
export const PAYMENT_STATUSES = ['PAID', 'UNPAID'] as const;
export const MEMBER_TYPES = ['FIXED', 'GUEST'] as const;
export const SPLIT_MODES = ['SHARED', 'PRIVATE'] as const;

/** Trả về value nếu nằm trong danh sách cho phép, ngược lại trả về fallback. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const candidate = String(value ?? '').trim();
  return (allowed as readonly string[]).includes(candidate) ? (candidate as T) : fallback;
}

export function normalizePaymentStatus(value: unknown): (typeof PAYMENT_STATUSES)[number] {
  return oneOf(value, PAYMENT_STATUSES, 'UNPAID');
}

export function normalizeMemberType(value: unknown): (typeof MEMBER_TYPES)[number] {
  return oneOf(value, MEMBER_TYPES, 'FIXED');
}
