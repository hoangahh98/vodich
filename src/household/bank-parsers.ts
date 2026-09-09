/**
 * Đọc tin biến động số dư ngân hàng (nội dung mail được Apps Script đẩy sang Telegram) thành
 * một giao dịch thô. THUẦN LOGIC, không đụng DB, để test được bằng đúng hai mail mẫu chủ app
 * đưa (VPBank NEO chuyển tiền và MSB thẻ tín dụng, 9/2026).
 *
 * Mail HTML khi lấy plain text ra thường thành từng dòng: nhãn tiếng Việt, nhãn tiếng Anh, rồi
 * giá trị — hoặc nhãn và giá trị cùng dòng. Mọi regex vì thế đều cho phép nhãn tiếng Anh xen
 * giữa (`(?:Transaction code)?`) và xuống dòng tuỳ ý (`[\s:]*`).
 */

export type ParsedBank = 'VPBANK' | 'MSB' | 'OTHER';

export interface ParsedBankMessage {
  bank: ParsedBank;
  /** OUT = tiền ra khỏi nguồn (chi/quẹt thẻ), IN = tiền vào. */
  direction: 'OUT' | 'IN';
  amount: number;
  /** Số tài khoản (VPBank) hoặc 4 số cuối thẻ (MSB) để khớp với `household_source.match_key`. */
  accountKey: string;
  description: string;
  occurredAt: Date;
  /** Mã giao dịch ngân hàng, hoặc mã tự dựng khi ngân hàng không cho — chống ghi trùng. */
  externalId: string;
}

const LABEL_GAP = '[\\s:*_]*';

function field(text: string, viLabel: string, enLabel: string, valuePattern: string): string | null {
  const re = new RegExp(`${viLabel}${LABEL_GAP}(?:${enLabel}${LABEL_GAP})?(${valuePattern})`, 'i');
  const match = re.exec(text);
  return match ? match[1].trim() : null;
}

/** "650,000.00" → 650000; "-86,093" → 86093 (dấu xử lý riêng). */
export function parseVndAmount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^\d.,]/g, '');
  // Dấu chấm/phẩy cuối cùng là phần thập phân nếu sau nó đúng 2 chữ số; còn lại là ngăn nghìn.
  const decimal = /[.,](\d{2})$/.exec(cleaned);
  const integerPart = decimal ? cleaned.slice(0, -3) : cleaned;
  const value = Number.parseInt(integerPart.replace(/[.,]/g, ''), 10);
  return Number.isFinite(value) ? value : 0;
}

/** "06/09/2026 17:06:00" hoặc "07/09/2026 18:22" (giờ VN) → Date. Thiếu giờ thì lấy 00:00. */
export function parseVnDateTime(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const match = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
  if (!match) return null;
  const [, day, month, year, hour = '0', minute = '0', second = '0'] = match;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}+07:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Mail VPBank NEO "giao dịch thành công": có mã giao dịch, tài khoản thanh toán, số tiền thanh toán. */
export function parseVpbank(text: string): ParsedBankMessage | null {
  if (!/vpbank/i.test(text)) return null;
  const amountRaw = field(text, 'Số tiền thanh toán', 'Debit Amount', '[\\d.,]+') || field(text, 'Số tiền', 'Amount', '[+-]?\\s*[\\d.,]+');
  const amount = parseVndAmount(amountRaw);
  if (!amount) return null;
  const code = field(text, 'Mã giao dịch', 'Transaction code', '[A-Z0-9]{6,}') || '';
  const account = field(text, 'Tài khoản thanh toán', 'Debit Account', '\\d{6,}') || field(text, 'Tài khoản', 'Account', '\\d{6,}') || '';
  const when = parseVnDateTime(field(text, 'Ngày, giờ giao dịch', 'Transaction date, time', '[\\d/]+(?:\\s+[\\d:]+)?') || field(text, 'Thời gian', 'Time', '[\\d/]+(?:\\s+[\\d:]+)?'));
  const service = field(text, 'Dịch vụ thanh toán', 'Billing Category', '[^\\n]+');
  const biller = field(text, 'Nhà cung cấp', 'Biller', '[^\\n]+');
  const content = field(text, 'Nội dung', 'Content', '[^\\n]+');
  const description = [service, biller, content].filter(Boolean).join(' · ') || 'VPBank';
  const direction: 'OUT' | 'IN' = /ghi có|nhận tiền|\+\s*[\d.,]+/i.test(amountRaw || '') || /ghi có|nhận được/i.test(text) ? 'IN' : 'OUT';
  const occurredAt = when || new Date();
  return {
    bank: 'VPBANK',
    direction,
    amount,
    accountKey: account,
    description: description.slice(0, 255),
    occurredAt,
    externalId: code ? `vpbank:${code}` : `vpbank:${account}:${occurredAt.toISOString()}:${amount}`,
  };
}

/** Mail MSB "biến động số dư trên Thẻ tín dụng": số thẻ che, số tiền thay đổi có dấu, nội dung, thời gian. */
export function parseMsb(text: string): ParsedBankMessage | null {
  if (!/\bMSB\b|Hàng hải/i.test(text)) return null;
  const amountRaw = field(text, 'Số tiền thay đổi', 'Changed Amount', '[+-]?\\s*[\\d.,]+\\s*(?:VND)?');
  const amount = parseVndAmount(amountRaw);
  if (!amount) return null;
  const cardMatch = /(?:x{4}[-\s]?){3}(\d{4})/i.exec(text) || /Số thẻ[^\n]*?(\d{4})\s*$/im.exec(text);
  const card = cardMatch ? cardMatch[1] : '';
  const content = field(text, 'Nội dung giao dịch', 'Content', '[^\\n]+') || 'MSB';
  const when = parseVnDateTime(field(text, 'Thời gian giao dịch', 'Transaction time', '[\\d/]+(?:\\s+[\\d:]+)?'));
  const occurredAt = when || new Date();
  const direction: 'OUT' | 'IN' = /^\s*-/.test(amountRaw || '') ? 'OUT' : /^\s*\+/.test(amountRaw || '') ? 'IN' : 'OUT';
  return {
    bank: 'MSB',
    direction,
    amount,
    accountKey: card,
    description: content.slice(0, 255),
    occurredAt,
    externalId: `msb:${card}:${occurredAt.toISOString()}:${direction}:${amount}`,
  };
}

/**
 * Mẫu chung cho ngân hàng khác: tìm số tiền có dấu kèm VND ("-120,000 VND", "+5.000.000đ") và
 * 4 số cuối tài khoản/thẻ nếu có. Đủ để ghi nháp, người dùng sửa tay sau.
 */
export function parseGeneric(text: string): ParsedBankMessage | null {
  const match = /([+-])\s*([\d][\d.,]*)\s*(?:VND|VNĐ|đ|d)\b/i.exec(text);
  if (!match) return null;
  const amount = parseVndAmount(match[2]);
  if (!amount) return null;
  const key = /(?:\*{2,}|x{2,})[-\s]?(\d{3,4})\b/i.exec(text)?.[1] || /(\d{4})\s*$/m.exec(text)?.[1] || '';
  const occurredAt = parseVnDateTime(/(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/.exec(text)?.[1]) || new Date();
  const firstLine = text.split('\n').map((line) => line.trim()).find((line) => line.length > 3) || 'Ngân hàng';
  return {
    bank: 'OTHER',
    direction: match[1] === '-' ? 'OUT' : 'IN',
    amount,
    accountKey: key,
    description: firstLine.slice(0, 255),
    occurredAt,
    externalId: `other:${key}:${occurredAt.toISOString()}:${match[1]}${amount}`,
  };
}

/** Thử lần lượt từng mẫu; null = không đọc được, cất vào hộp thư để xử lý tay. */
export function parseBankMessage(text: string): ParsedBankMessage | null {
  const normalized = String(text || '').replace(/\r/g, '');
  return parseVpbank(normalized) || parseMsb(normalized) || parseGeneric(normalized);
}
