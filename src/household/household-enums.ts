import { oneOf } from '../common/enums';

/**
 * Tập giá trị của module Chi tiêu. Nhãn tiếng Việt đặt cạnh mã để view và Telegram dùng chung
 * một nguồn, khỏi mỗi nơi tự dịch một kiểu.
 */

/**
 * Nguồn tiền. BANK/CASH/SAVING/INVEST giữ số dư; CARD/LOAN giữ DƯ NỢ (tiền ra làm nợ tăng, tiền vào
 * làm nợ giảm); LENT là khoản CHO VAY — người khác nợ mình: chuyển tiền sang là cho vay thêm, họ trả
 * về là giảm. SAVING (sổ tiết kiệm) và INVEST (chứng khoán, vàng, quỹ...) vẫn là tiền của mình nhưng
 * để riêng: chuyển tiền sang đó tính là "cất đi" chứ không phải đảo tiền trong túi.
 */
export const SOURCE_KINDS = ['BANK', 'CARD', 'CASH', 'SAVING', 'INVEST', 'LOAN', 'LENT'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  BANK: 'Tài khoản ngân hàng',
  CARD: 'Thẻ tín dụng',
  CASH: 'Tiền mặt',
  SAVING: 'Tiết kiệm',
  INVEST: 'Đầu tư',
  LOAN: 'Khoản vay',
  LENT: 'Cho vay',
};
export const isDebtSource = (kind: string) => kind === 'CARD' || kind === 'LOAN';
/** Nguồn giữ tiền của mình nhưng để riêng — chuyển sang đây là cất đi, không phải tiêu. */
export const isSavedSource = (kind: string) => kind === 'SAVING' || kind === 'INVEST';
/** Nguồn tiêu được ngay (số dư vào ô "Có"). */
export const isSpendableSource = (kind: string) => kind === 'BANK' || kind === 'CASH';

/** Ngân hàng có mẫu đọc tin Telegram. OTHER = đọc theo mẫu chung (số tiền kèm dấu + VND). */
export const BANKS = ['TIMO', 'MSB', 'OTHER'] as const;
export const BANK_LABELS: Record<(typeof BANKS)[number], string> = { TIMO: 'Timo', MSB: 'MSB', OTHER: 'Khác' };

/**
 * Loại mục đích — luật báo cáo đi theo loại, tên mục thì hộ tự đặt:
 *  - LIVING  : chi tiêu sinh hoạt (ăn uống, đi lại, con cái...).
 *  - SAVING  : tiết kiệm (tiền cất đi, vẫn là của mình).
 *  - DEBT    : trả nợ / lãi vay, phí thẻ.
 *  - RESERVE : dự phòng (quỹ khẩn cấp, bảo hiểm...).
 *  - LENDING : cho vay (tiền đi ra, sẽ thu về).
 *  - INCOME  : nguồn thu (lương chồng, lương vợ...).
 */
export const PURPOSE_KINDS = ['LIVING', 'SAVING', 'DEBT', 'RESERVE', 'LENDING', 'INCOME'] as const;
export type PurposeKind = (typeof PURPOSE_KINDS)[number];
export const PURPOSE_KIND_LABELS: Record<PurposeKind, string> = {
  LIVING: 'Chi tiêu',
  SAVING: 'Tiết kiệm',
  DEBT: 'Trả nợ',
  RESERVE: 'Dự phòng',
  LENDING: 'Cho vay',
  INCOME: 'Thu nhập',
};

/** Giao dịch: tiền ra khỏi nguồn / vào nguồn / chuyển giữa hai nguồn. */
export const TX_KINDS = ['EXPENSE', 'INCOME', 'TRANSFER'] as const;
export type TxKind = (typeof TX_KINDS)[number];
export const TX_KIND_LABELS: Record<TxKind, string> = { EXPENSE: 'Chi', INCOME: 'Thu', TRANSFER: 'Chuyển' };

export const INTEREST_MODES = ['NONE', 'FROM_RATE'] as const;

export const normalizeSourceKind = (value: unknown) => oneOf(value, SOURCE_KINDS, 'BANK');
export const normalizeBank = (value: unknown) => oneOf(value, BANKS, 'OTHER');
export const normalizePurposeKind = (value: unknown) => oneOf(value, PURPOSE_KINDS, 'LIVING');
export const normalizeTxKind = (value: unknown) => oneOf(value, TX_KINDS, 'EXPENSE');
export const normalizeInterestMode = (value: unknown) => oneOf(value, INTEREST_MODES, 'NONE');

/** Chuỗi tháng `YYYY-MM` hợp lệ, không thì tháng hiện tại. */
export function normalizeMonth(value: unknown): string {
  const raw = String(value || '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : new Date().toISOString().slice(0, 7);
}

/** Tháng `YYYY-MM` của một mốc thời gian, theo giờ Việt Nam (tin ngân hàng ghi giờ VN). */
export function monthOf(date: Date): string {
  const vn = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vn.toISOString().slice(0, 7);
}

/** Bộ mục đích mặc định cho hộ mới — chủ hộ sửa/xoá tuỳ ý ở Cài đặt. */
export const DEFAULT_PURPOSES: { name: string; kind: PurposeKind }[] = [
  { name: 'Lương chồng', kind: 'INCOME' },
  { name: 'Lương vợ', kind: 'INCOME' },
  { name: 'Ăn uống', kind: 'LIVING' },
  { name: 'Đi lại', kind: 'LIVING' },
  { name: 'Nhà cửa, điện nước', kind: 'LIVING' },
  { name: 'Con cái', kind: 'LIVING' },
  { name: 'Mua sắm', kind: 'LIVING' },
  { name: 'Sức khoẻ', kind: 'LIVING' },
  { name: 'Khác', kind: 'LIVING' },
  { name: 'Tiết kiệm', kind: 'SAVING' },
  { name: 'Trả nợ vay', kind: 'DEBT' },
  { name: 'Dự phòng', kind: 'RESERVE' },
  { name: 'Cho vay', kind: 'LENDING' },
];

/** Gói nhãn đưa vào view (EJS không import được TS). */
export const HOUSEHOLD_LABELS = { source: SOURCE_KIND_LABELS, purpose: PURPOSE_KIND_LABELS, tx: TX_KIND_LABELS, bank: BANK_LABELS };
