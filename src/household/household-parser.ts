/**
 * Trích xuất thông tin giao dịch từ email báo "chuyển tiền đi" của VPBank.
 *
 * Email VPBank có bố cục bảng song ngữ (Việt/Anh) dạng `Nhãn : Giá trị`. Khi 2 vợ
 * chồng auto-forward vào hòm Gmail chung, phần thân giữ nguyên các nhãn này. Ta tìm
 * TỪNG trường độc lập theo nhãn tiếng Việt (không phụ thuộc thứ tự cột/xuống dòng)
 * nên bền với khác biệt layout khi forward.
 *
 * Nguyên tắc tiền: MỌI email tiền-ra = 1 khoản chi (kể cả chuyển nội bộ 2 vợ chồng).
 * Số tiền chi = "Số tiền trích nợ" (tiền rời khỏi tài khoản).
 */

export interface ParsedVpbankTxn {
  txnCode: string;
  occurredAt: Date;
  amount: number; // VND, số nguyên dương
  performedBy: string;
  debitAccount: string;
  creditAccount: string;
  beneficiary: string;
  fee: number;
  description: string;
}

/** Chuẩn hoá: bỏ HTML, gộp mọi khoảng trắng (kể cả nbsp U+00A0) về 1 space. */
function normalize(raw: string): string {
  return String(raw || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** Bỏ dấu tiếng Việt để so nhãn không phụ thuộc cách gõ dấu (VD "Số"/"So"). */
function deaccent(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Tìm giá trị ngay sau một nhãn. `flat` là chuỗi đã bỏ dấu (deaccent) để offset khớp;
 * `label` truyền vào cũng ở dạng không dấu. Giá trị lấy ra là ASCII (số/ngày/tên/nội
 * dung chuyển khoản) nên việc bỏ dấu không ảnh hưởng.
 */
function pickAfter(flat: string, label: string, valueRe: RegExp): string | null {
  const anchor = new RegExp(label.replace(/\s+/g, '\\s+'), 'i').exec(flat);
  if (!anchor) return null;
  const start = anchor.index + anchor[0].length;
  const rest = flat.slice(start, start + 120);
  const match = valueRe.exec(rest);
  return match ? (match[1] ?? match[0]).trim() : null;
}

/** "50,000 VND" / "50.000" / "1,050,000" → 50000 / 50000 / 1050000 (VND không có phần lẻ). */
export function parseVndAmount(value: unknown): number {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  if (!digits) return 0;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
}

/** "17/07/2026 22:18:59" (dd/mm/yyyy HH:MM:SS) → Date. Trả null nếu không hợp lệ. */
export function parseVpbankDate(value: string): Date | null {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min, ss] = m;
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Parse 1 email VPBank → giao dịch. Trả null nếu thiếu trường thiết yếu
 * (mã giao dịch / thời gian / số tiền) hoặc không phải email VPBank.
 */
export function parseVpbankEmail(raw: string): ParsedVpbankTxn | null {
  const flat = deaccent(normalize(raw));
  if (!/vpbank/i.test(flat)) return null;

  const txnCode = pickAfter(flat, 'Ma giao dich', /([A-Za-z0-9]+(?:\/[A-Za-z0-9]+)+|[A-Za-z0-9]{6,})/);
  const rawDate =
    pickAfter(flat, 'Ngay, gio giao dich', /(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})/) ||
    pickAfter(flat, 'Ngay gio giao dich', /(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})/);
  const occurredAt = rawDate ? parseVpbankDate(rawDate) : null;
  const amount = parseVndAmount(pickAfter(flat, 'So tien trich no', /([\d.,]+)\s*VND/i));

  if (!txnCode || !occurredAt || amount <= 0) return null;

  const debitAccount = pickAfter(flat, 'Tai khoan trich no', /(\d{6,})/) || '';
  const creditAccount = pickAfter(flat, 'Tai khoan ghi co', /(\d{6,})/) || '';
  const performedBy = pickAfter(flat, 'Kinh gui Khach hang', /([A-Z][A-Z ]{2,60}?)(?:\s+Dear\b|\s{2,}|$)/) || '';
  const beneficiary = pickAfter(flat, 'Ten nguoi huong', /([A-Z][A-Z ]{2,60}?)(?:\s+Beneficiary\b|\s+Loai\b|\s{2,}|$)/) || '';
  const fee = parseVndAmount(pickAfter(flat, 'So tien phi', /([\d.,]+)\s*VND/i));
  const description = pickAfter(flat, 'Noi dung chuyen tien', /[:\s]*(.+?)(?:\s+Details of Payment|$)/) || '';

  return {
    txnCode: txnCode.slice(0, 160),
    occurredAt,
    amount,
    performedBy: performedBy.trim().slice(0, 255),
    debitAccount,
    creditAccount,
    beneficiary: beneficiary.trim().slice(0, 255),
    fee,
    description: description.trim().slice(0, 500),
  };
}
