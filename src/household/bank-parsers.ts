/**
 * Đọc tin biến động số dư ngân hàng (nội dung mail được Apps Script đẩy sang Telegram) thành
 * một giao dịch thô. THUẦN LOGIC, không đụng DB, để test được bằng đúng hai mail mẫu chủ app
 * đưa (Timo tài khoản chi tiêu và MSB thẻ tín dụng, 9/2026; VPBank đã bỏ theo ý chủ app 10/9).
 *
 * Mail HTML khi lấy plain text ra thường thành từng dòng: nhãn tiếng Việt, nhãn tiếng Anh, rồi
 * giá trị — hoặc nhãn và giá trị cùng dòng. Mọi regex vì thế đều cho phép nhãn tiếng Anh xen
 * giữa (`(?:Transaction code)?`) và xuống dòng tuỳ ý (`[\s:]*`).
 */

export type ParsedBank = 'TIMO' | 'MSB' | 'OTHER';

export interface ParsedBankMessage {
  bank: ParsedBank;
  /** OUT = tiền ra khỏi nguồn (chi/quẹt thẻ), IN = tiền vào. */
  direction: 'OUT' | 'IN';
  amount: number;
  /** 4 số cuối thẻ (MSB) để khớp với `household_source.match_key`; Timo không có, để rỗng. */
  accountKey: string;
  /** Số dư sau giao dịch nếu ngân hàng báo (Timo) — chỉ để nhắc trong tin tóm tắt, không ghi sổ. */
  balance?: number;
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

/**
 * Mail Timo (BVBank) "Thông báo thay đổi số dư tài khoản" — mọi biến động của tài khoản Spend
 * đều một dòng: "Tài khoản Spend Account vừa tăng 50.000 VND vào 09/09/2026 16:37. Số dư hiện tại:
 * 50.000 VND." rồi "Mô tả: ...". Tăng = tiền vào (lương về), giảm = tiền ra. Số dư hiện tại kèm về
 * để bot nhắc luôn trong tin tóm tắt. Không có mã giao dịch nên mã chống trùng tự dựng từ chiều,
 * giờ, số tiền và mô tả.
 */
export function parseTimo(text: string): ParsedBankMessage | null {
  if (!/timo/i.test(text)) return null;
  const move = /vừa\s+(tăng|giảm)\s+([\d.,]+)\s*VND\s+vào\s+(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i.exec(text);
  if (!move) return null;
  const amount = parseVndAmount(move[2]);
  if (!amount) return null;
  const direction: 'OUT' | 'IN' = /giảm/i.test(move[1]) ? 'OUT' : 'IN';
  const occurredAt = parseVnDateTime(move[3]) || new Date();
  const balanceRaw = /Số dư hiện tại:\s*([\d.,]+)\s*VND/i.exec(text);
  const description = (/Mô tả:\s*([^\n]+)/i.exec(text)?.[1] || 'Timo').trim().replace(/\.+$/, '');
  return {
    bank: 'TIMO',
    direction,
    amount,
    accountKey: '',
    description: description.slice(0, 255),
    occurredAt,
    balance: balanceRaw ? parseVndAmount(balanceRaw[1]) : undefined,
    externalId: `timo:${direction}:${occurredAt.toISOString()}:${amount}:${description.toLowerCase().slice(0, 40)}`,
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
  return parseTimo(normalized) || parseMsb(normalized) || parseGeneric(normalized);
}
