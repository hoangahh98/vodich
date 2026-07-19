/**
 * Sinh file .ics (iCalendar) cho lịch nhắc uống thuốc.
 *
 * Mở file này trên iPhone -> Lịch hỏi "Add All" -> mỗi cữ thành 1 sự kiện có chuông báo.
 * Cố ý KHÔNG dùng RRULE: mỗi cữ là một sự kiện riêng. Đơn có nhiều thuốc kết thúc lệch
 * ngày nhau, dùng RRULE rất dễ nhắc tiếp thuốc đã hết -> nguy hiểm.
 *
 * GIỚI HẠN ĐÃ KIỂM CHỨNG HAI VÒNG (19/07/2026) — đọc trước khi định sửa:
 *
 * File .ics tải về là chép MỘT CHIỀU. Import xong là xong, server không còn với tới những
 * sự kiện đó nữa.
 *
 * VÒNG 1 — nạp bằng Safari thẳng vào Lịch iPhone (iCloud). Thử ba cách, trượt cả ba:
 *
 *   1. METHOD:CANCEL         -> iPhone bỏ qua METHOD, hiện "Thêm tất cả" như import thường.
 *   2. STATUS:CANCELLED      -> bị bỏ qua nguyên vẹn: không xoá, mà cũng không thêm.
 *   3. Ghi đè (cùng UID,     -> KHÔNG ghi đè. Sự kiện cũ nằm nguyên, sự kiện mới thêm vào
 *      SEQUENCE cao hơn)        bên cạnh -> nhân đôi lịch.
 *
 * Cách 2 kiểm chứng chắc chắn bằng một sự kiện "chứng nhân" còn sống nhét cùng file:
 * chứng nhân hiện lên bình thường nên chắc chắn iPhone CÓ đọc và xử lý file. Đã loại trừ
 * nhiễu: cùng PRODID, cùng nhóm lịch, cùng UID.
 *
 * VÒNG 2 — đổi phía nhận sang GOOGLE CALENDAR (import qua trình duyệt máy tính), phòng khi
 * thứ trượt ở vòng 1 chỉ là bộ import cục bộ của iOS. CŨNG TRƯỢT: Google đọc file (lịch mới
 * vào bình thường), sự kiện cũ nằm CÙNG MỘT lịch nên UID có cơ hội khớp, nhưng các mục
 * STATUS:CANCELLED bị lặng lẽ bỏ qua — không xoá cũ, không mọc rác. Y hệt iCloud.
 *
 * => Vấn đề KHÔNG nằm ở Apple mà ở mô hình đẩy file: phía nhận nào cũng chỉ thêm, không xoá.
 * ĐỪNG THỬ NỀN TẢNG THỨ BA (Outlook, Yahoo...) — cùng một ngõ cụt, đã tốn hai vòng rồi.
 *
 * Hệ quả: SỬA LỊCH ĐÃ NẠP QUA FILE LÀ KHÔNG THỂ. Đó là lý do lịch bị khoá sau khi chốt
 * (xem medical.controller.ts).
 *
 * CƠ CHẾ ĐANG DÙNG (chốt 19/07/2026): THỦ CÔNG. Mỗi lần có lịch mới thì tạo một NHÓM LỊCH
 * MỚI trên máy, nạp vào đó, rồi xoá tay nhóm cũ. Đã cân nhắc feed đăng ký webcal:// (giải
 * được bài toán) nhưng chủ dự án thấy quá phức tạp và chọn thủ công — đây là quyết định về
 * độ phức tạp, không phải hiểu nhầm kỹ thuật. Đừng tự ý dựng lại.
 *
 * Vì vậy: NẠP LẠI LUÔN LÀ THÊM MỚI, không bao giờ ghi đè. Bấm "Nạp lịch nhắc" hai lần là
 * hai bộ sự kiện chồng nhau. Không sửa được từ phía server — đừng thêm lại cơ chế huỷ.
 */
import { DoseGroup, describeLine } from './medication-schedule';

export interface IcsOptions {
  calendarName: string;
  /**
   * Tiền tố UID. RFC 5545 bắt buộc mọi VEVENT phải có UID nên trường này không bỏ được.
   *
   * ĐỪNG trông cậy nó để ghi đè: đã thử, iPhone không đối chiếu UID khi import file, nạp
   * lại là thêm sự kiện mới bên cạnh. Giữ UID ổn định chỉ còn ý nghĩa cho các app lịch
   * khác (máy tính, Google Calendar) và để tra cứu khi cần.
   */
  uidPrefix: string;
  /**
   * SEQUENCE của sự kiện. Giữ cho đúng chuẩn, nhưng iPhone không dùng tới nó trên đường
   * import file — tăng hay không cũng vậy.
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
   * Nhãn nguồn theo ID THUỐC: id -> ngày kê của đơn GỐC (dd/mm), rỗng nếu tra không ra.
   * Thuốc không có mặt trong map là thuốc mới kê trong chính đơn này.
   *
   * Cần trong file .ics chứ không chỉ trên web: lúc đứng trước mặt bé sắp cho uống thì
   * người ta nhìn thông báo trên điện thoại, không mở web ra đối chiếu. Thuốc chuyển từ
   * đơn cũ đã uống dở nên hết sớm hơn — không phân biệt được là dễ cho uống tiếp thứ đã
   * hết, hoặc bỏ sót thứ còn phải uống.
   */
  drugSources?: Map<string, string>;
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
    // Nhãn nguồn đặt ngay ĐẦU dòng để nhìn phát thấy, không phải đọc hết dòng mới biết.
    // Có dấu tiếng Việt bình thường: phần mô tả vốn đã đầy chữ có dấu ("Uống", "trước ăn")
    // và app Lịch hiển thị tốt. Chỉ tránh EMOJI ở đây — dòng mô tả hay bị cắt ngắn, chữ bị
    // cắt thì vẫn đoán được, emoji bị cắt thì thành ô vuông vô nghĩa.
    const sources = options.drugSources;
    const body = group.lines
      .map((line) => {
        if (!sources || !sources.size) return describeLine(line);
        if (!sources.has(line.itemId)) return `[Đơn mới] ${describeLine(line)}`;
        const from = sources.get(line.itemId);
        return `[${from ? `Đơn ${from}` : 'Đơn cũ'}] ${describeLine(line)}`;
      })
      .join('\n');
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
 * UID gắn với SỐ THỨ TỰ cữ, không phải ngày+giờ — cữ số 3 vẫn là cữ số 3 dù đổi giờ uống.
 *
 * Trước đây đặt vậy để iPhone ghi đè đúng sự kiện cũ, nhưng đã kiểm chứng là iPhone không
 * đối chiếu UID khi import file (xem chú thích đầu file). Vẫn giữ cách đánh này vì nó
 * đúng về mặt ngữ nghĩa và các app lịch khác có dùng tới.
 */
function doseUid(prefix: string, index: number): string {
  return `${prefix}-d${index}@vodich`;
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
