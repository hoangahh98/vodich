/**
 * Sinh file .ics (iCalendar) cho lịch nhắc uống thuốc.
 *
 * Mở file này trên iPhone -> Lịch hỏi "Add All" -> mỗi cữ thành 1 sự kiện có chuông báo.
 * Cố ý KHÔNG dùng RRULE: mỗi cữ là một sự kiện riêng. Đơn có nhiều thuốc kết thúc lệch
 * ngày nhau, dùng RRULE rất dễ nhắc tiếp thuốc đã hết -> nguy hiểm.
 *
 * GHI ĐÈ VÀ HUỶ CHỈ ĂN TRÊN GOOGLE, KHÔNG ĂN TRÊN iCLOUD — đọc trước khi sửa:
 *
 * Cơ chế đối chiếu UID ở dưới (ghi đè khi nạp lại, và cancels[] để huỷ cữ đơn cũ) dựa
 * hoàn toàn vào việc phía nhận có đối chiếu UID hay không. Đã thử trên iPhone thật
 * (19/07/2026), nạp file bằng Safari thẳng vào Lịch iCloud: CẢ BA đều trượt.
 *
 *   1. METHOD:CANCEL         -> iPhone bỏ qua METHOD, hiện "Thêm tất cả" như import thường.
 *   2. STATUS:CANCELLED      -> bị bỏ qua nguyên vẹn: không xoá, mà cũng không thêm.
 *   3. Ghi đè (cùng UID,     -> KHÔNG ghi đè. Sự kiện cũ nằm nguyên, sự kiện mới thêm vào
 *      SEQUENCE cao hơn)        bên cạnh -> nhân đôi lịch.
 *
 * Cách 2 kiểm chứng chắc chắn bằng một sự kiện "chứng nhân" còn sống nhét cùng file:
 * chứng nhân hiện lên bình thường nên chắc chắn iPhone CÓ đọc và xử lý file.
 *
 * Vì vậy toàn bộ phần huỷ ở đây chỉ có nghĩa khi lịch nằm trên TÀI KHOẢN GOOGLE (nạp qua
 * Google Calendar rồi để iPhone đồng bộ về). Đường iCloud trực tiếp thì phần này là code
 * chết — chạy không lỗi và không có tác dụng gì.
 *
 * TÍNH TỚI 19/07/2026 ĐƯỜNG GOOGLE VẪN CHƯA ĐƯỢC KIỂM CHỨNG. Xác nhận được thì sửa chú
 * thích này; trượt nốt thì gỡ hẳn cancels[]/previousDoseCount thay vì để lại lần hai.
 */
import { DoseGroup, describeLine } from './medication-schedule';

export interface IcsOptions {
  calendarName: string;
  /**
   * Tiền tố UID, cần ổn định để import lại lần 2 ghi đè chứ không nhân đôi sự kiện.
   * Ghi đè chỉ ăn khi phía nhận đối chiếu UID — Google có, iCloud thì không (xem đầu file).
   */
  uidPrefix: string;
  /**
   * Tổng số cữ của lần xuất TRƯỚC. Nếu lần này ít cữ hơn (bỏ bớt thuốc, rút ngắn liệu
   * trình) thì phần dôi ra phải được gửi lệnh huỷ, nếu không chúng nằm lại trong Lịch
   * mãi mãi vì không có gì ghi đè lên.
   */
  previousDoseCount?: number;
  /**
   * SEQUENCE của sự kiện. Phải TĂNG so với lần xuất trước thì app Lịch mới chịu ghi đè;
   * để nguyên 0 là nó coi như bản cũ và bỏ qua, sửa giờ xong nạp lại sẽ không ăn.
   */
  sequence?: number;
  /**
   * Ngày kê đơn (dd/mm/yyyy), gắn vào tiêu đề sự kiện. Đơn cũ chưa uống xong mà có đơn
   * mới thì trong Lịch sẽ có 2 sự kiện chồng cùng giờ — không ghi rõ đơn nào thì không
   * tài nào phân biệt được trên màn hình điện thoại.
   */
  prescriptionLabel?: string;
  /** Tên người thân, để nhà nhiều người còn biết lời nhắc này của ai. */
  patientName?: string;
  /** Ngày tái khám YYYY-MM-DD (nếu có) -> thêm 1 sự kiện nhắc sáng hôm đó. */
  followUpDate?: string;
  /** Giờ nhắc tái khám — dùng cữ sáng của nhà để báo ngay đầu ngày hôm đó. */
  followUpTime?: string;
  followUpNote?: string;
  /**
   * Các cữ của đơn CŨ cần huỷ, kèm đúng tiền tố UID đã dùng lúc xuất đơn đó.
   * Gửi lại chính UID cũ với STATUS:CANCELLED + SEQUENCE tăng là cách duy nhất để
   * báo cho app Lịch biết những sự kiện đó không còn nữa — server không tự xoá được
   * sự kiện đã nằm trong máy người dùng.
   *
   * Chỉ điền khi người dùng chủ động chọn bản dọn dẹp (?cleanup=1). STATUS:CANCELLED nằm
   * trong file METHOD:PUBLISH là phi chuẩn (RFC 5546 bảo huỷ phải dùng file METHOD:CANCEL
   * riêng), nên trộn vào mọi file sẽ làm tăng rủi ro cả file bị từ chối.
   */
  cancels?: Array<{ uidPrefix: string; groups: DoseGroup[] }>;
}

export function buildIcs(groups: DoseGroup[], options: IcsOptions): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vo dich//Lich uong thuoc//VI',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.calendarName)}`,
  ];

  const sequence = options.sequence ?? 0;

  for (const group of groups) {
    const start = toStamp(group.date, group.time);
    const end = toStamp(group.date, addMinutes(group.time, 15));
    const antibiotic = group.lines.some((line) => line.isAntibiotic);
    // Không nhắc lại giờ trong tiêu đề: app Lịch đã hiện giờ ngay bên dưới rồi.
    // Tiêu đề chỉ cần đủ để phân biệt hai đơn chồng nhau, nên ghi ngày kê đơn.
    // "có kháng sinh" nói thẳng bằng chữ vì nhìn biểu tượng không ai đoán ra nghĩa gì.
    // Tiêu đề để gọn: chỉ đủ phân biệt hai đơn chồng nhau. Giờ thì Lịch đã hiện sẵn
    // ngay bên dưới, chi tiết thuốc nằm ở phần mô tả.
    const label = ['Đơn thuốc', options.patientName, options.prescriptionLabel].filter(Boolean).join(' ');
    const title = `${antibiotic ? '💊❗' : '💊'} ${label}${antibiotic ? ' (có kháng sinh)' : ''}`;
    const body = group.lines.map(describeLine).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${doseUid(options.uidPrefix, group.index)}`,
      `DTSTAMP:${stamp}`,
      `SEQUENCE:${sequence}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${escapeText(title)}`,
      `DESCRIPTION:${escapeText(body)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(title)}`,
      'TRIGGER:PT0S',
      'END:VALARM',
      'END:VEVENT',
    );
  }

  // Cữ dôi ra so với lần xuất trước (bỏ bớt thuốc / rút ngắn liệu trình): phải huỷ,
  // nếu không chúng nằm lại trong Lịch mãi vì lần này không có gì ghi đè lên.
  const last = groups[groups.length - 1];
  const surplusStart = groups.length ? Math.max(...groups.map((g) => g.index)) + 1 : 1;
  for (let index = surplusStart; index <= (options.previousDoseCount || 0); index++) {
    // Không còn biết giờ gốc của những cữ này, mượn mốc cuối cùng cho hợp lệ.
    lines.push(...cancelEvent(doseUid(options.uidPrefix, index), stamp, sequence, last?.date || '20200101', last?.time || '07:00'));
  }

  for (const cancel of options.cancels || []) {
    for (const group of cancel.groups) {
      lines.push(...cancelEvent(doseUid(cancel.uidPrefix, group.index), stamp, sequence, group.date, group.time));
    }
  }

  if (options.followUpDate) {
    // Nhắc ngay SÁNG hôm tái khám để hôm đó còn nhớ mà đưa bé đi.
    const time = options.followUpTime || '07:00';
    const title = `🏥 Tái khám${options.patientName ? ' ' + options.patientName : ''}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${options.uidPrefix}-taikham@vodich`,
      `DTSTAMP:${stamp}`,
      `SEQUENCE:${sequence}`,
      `DTSTART:${toStamp(options.followUpDate, time)}`,
      `DTEND:${toStamp(options.followUpDate, addMinutes(time, 30))}`,
      `SUMMARY:${escapeText(title)}`,
      `DESCRIPTION:${escapeText(options.followUpNote || 'Tái khám theo hẹn của bác sĩ.')}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(title)}`,
      'TRIGGER:PT0S',
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  // iCalendar bắt buộc CRLF và gấp dòng ở 75 octet.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/**
 * Gấp dòng theo RFC 5545: mỗi dòng tối đa 75 octet, phần nối tiếp bắt đầu bằng một dấu
 * cách. Không phải chuyện làm đẹp — iPhone từ chối cả file nếu dòng quá dài, mà từ chối
 * im lặng: bấm "Thêm tất cả" xong không có gì xảy ra, không báo lỗi.
 *
 * Đếm theo OCTET chứ không phải ký tự (tiếng Việt có dấu 2 byte, emoji 4 byte), và
 * tuyệt đối không cắt giữa một ký tự nhiều byte.
 */
export function foldLine(line: string): string {
  const LIMIT = 75;
  if (Buffer.byteLength(line, 'utf8') <= LIMIT) return line;

  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  // Dòng nối tiếp tốn 1 octet cho dấu cách đứng đầu.
  let limit = LIMIT;

  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    if (currentBytes + size > limit) {
      out.push(current);
      current = '';
      currentBytes = 0;
      limit = LIMIT - 1;
    }
    current += char;
    currentBytes += size;
  }
  if (current) out.push(current);
  return out[0] + out.slice(1).map((part) => `\r\n ${part}`).join('');
}

/**
 * UID gắn với SỐ THỨ TỰ cữ, không phải ngày+giờ.
 *
 * Đổi giờ uống hay đổi ngày bắt đầu thì cữ số 3 vẫn là cữ số 3, nên app Lịch ghi đè
 * đúng sự kiện cũ. Nếu gắn theo ngày+giờ thì mỗi lần sửa giờ là sinh UID mới và cả
 * loạt sự kiện cũ nằm lại -> nhân đôi lịch.
 */
function doseUid(prefix: string, index: number): string {
  return `${prefix}-d${index}@vodich`;
}

/**
 * Sự kiện huỷ: UID cũ + STATUS:CANCELLED + SEQUENCE tăng.
 *
 * DTSTART là BẮT BUỘC với mọi VEVENT theo RFC 5545. Thiếu nó thì iPhone coi cả file là
 * hỏng và bấm "Thêm tất cả" không ra gì cả — không báo lỗi, chỉ đứng yên. App Lịch đối
 * chiếu theo UID nên giờ ở đây chỉ cần hợp lệ, không cần trùng giờ gốc.
 */
function cancelEvent(uid: string, stamp: string, sequence: number, date: string, time: string): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `SEQUENCE:${sequence}`,
    `DTSTART:${toStamp(date, time)}`,
    `DTEND:${toStamp(date, addMinutes(time, 15))}`,
    'SUMMARY:Đã ngừng',
    'STATUS:CANCELLED',
    'END:VEVENT',
  ];
}

/**
 * Giờ "floating" (không có hậu tố Z, không TZID): iPhone hiểu là giờ địa phương của máy.
 * Đúng ý ở đây — 19:30 phải là 19:30 giờ Việt Nam bất kể server chạy ở đâu.
 */
function toStamp(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

function addMinutes(time: string, minutes: number): string {
  const [hour, minute] = time.split(':').map(Number);
  const total = hour * 60 + minute + minutes;
  const wrapped = total % (24 * 60);
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/** RFC 5545: phải escape \ ; , và xuống dòng, nếu không file lỗi và iPhone từ chối mở. */
function escapeText(value: string): string {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}
