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
/**
 * Cài đặt hiển thị của 7 loại trên, theo từng hộ (bảng `household_source_kind`, chủ app 21/9/2026):
 * bật/tắt loại mình dùng và đổi tên cho dễ hiểu. LUẬT TÍNH TIỀN VẪN THEO `kind`, tên chỉ là nhãn —
 * đừng đọc nhãn để suy ra cách tính, và đừng cho tạo `kind` mới vì không có luật nào chạy cho nó.
 */
export interface SourceKindSetting {
  kind: SourceKind;
  label: string;
  active: boolean;
}
/** Danh sách loại nguồn của một hộ: chưa khai dòng nào thì cả 7 loại đều bật, tên mặc định. */
export function sourceKindSettings(rows: { kind: string; label: string; active: boolean }[] = []): SourceKindSetting[] {
  const saved = new Map(rows.map((row) => [row.kind, row]));
  return SOURCE_KINDS.map((kind) => {
    const row = saved.get(kind);
    return { kind, label: (row?.label || '').trim() || SOURCE_KIND_LABELS[kind], active: row ? row.active : true };
  });
}

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

/**
 * Ô "Loại" ở form giao dịch có NĂM lựa chọn (chủ app 21/9/2026) — ba cái cuối đều là chuyển tiền
 * sang một nguồn khác nên DB vẫn chỉ lưu TRANSFER, phân biệt bằng LOẠI NGUỒN ĐÍCH:
 *
 * | Ô Loại    | Lưu DB   | Nguồn đích   | Hỏi gốc/lãi | Hỏi mục đích |
 * |-----------|----------|--------------|-------------|--------------|
 * | Chi       | EXPENSE  | —            | không       | có           |
 * | Thu       | INCOME   | —            | không       | có           |
 * | Trả nợ    | TRANSFER | CARD, LOAN   | CÓ          | không        |
 * | Đầu tư    | TRANSFER | INVEST       | không       | không        |
 * | Cho vay   | TRANSFER | LENT         | không       | không        |
 *
 * "Chuyển nguồn" đã bỏ khỏi ô Loại. Vẫn giữ nhãn để HIỆN những khoản TRANSFER sang nguồn khác ba
 * loại trên — bot tự tạo khi bấm "<tên> trả nợ" (LENT → tài khoản) là một ca như thế; mở form sửa
 * mà không có nhãn thì nó lặng lẽ nhảy sang loại khác.
 */
export const TX_FORM_KINDS = ['EXPENSE', 'INCOME', 'DEBT', 'INVEST', 'LEND'] as const;
export type TxFormKind = (typeof TX_FORM_KINDS)[number];
export const TX_FORM_KIND_LABELS: Record<TxFormKind | 'TRANSFER', string> = {
  EXPENSE: 'Chi',
  INCOME: 'Thu',
  DEBT: 'Trả nợ',
  INVEST: 'Đầu tư',
  LEND: 'Cho vay',
  TRANSFER: 'Chuyển nguồn',
};

/** Ba loại form đi xuống DB thành TRANSFER, kèm loại nguồn đích được phép chọn. */
export const TRANSFER_FORM_TARGETS: Record<string, SourceKind[]> = {
  DEBT: ['CARD', 'LOAN'],
  INVEST: ['INVEST'],
  LEND: ['LENT'],
};
export const isTransferForm = (value: unknown) => Object.prototype.hasOwnProperty.call(TRANSFER_FORM_TARGETS, String(value || ''));
/** Chỉ loại Trả nợ mới có gốc/lãi; Đầu tư và Cho vay chỉ có một số tiền. */
export const hasDebtParts = (value: unknown) => String(value || '') === 'DEBT';
/** Loại gửi từ form → loại lưu DB. */
export const normalizeFormTxKind = (value: unknown) => normalizeTxKind(isTransferForm(value) ? 'TRANSFER' : value);

/** Khoản TRANSFER đã lưu thì soi LOẠI NGUỒN ĐÍCH để biết form phải chọn sẵn lựa chọn nào. */
export function formKindOfTransfer(targetKind: unknown): string {
  const kind = String(targetKind || '');
  for (const [form, kinds] of Object.entries(TRANSFER_FORM_TARGETS)) {
    if ((kinds as string[]).includes(kind)) return form;
  }
  return 'TRANSFER';
}

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
export const HOUSEHOLD_LABELS = { source: SOURCE_KIND_LABELS, purpose: PURPOSE_KIND_LABELS, tx: TX_KIND_LABELS, txForm: TX_FORM_KIND_LABELS, bank: BANK_LABELS };
