/**
 * MODULE THỬ NGHIỆM — XOÁ ĐƯỢC.
 *
 * Dựng file .ics để trả lời đúng một câu hỏi: trên iPhone, mở một file METHOD:CANCEL
 * tải từ Safari có xoá được sự kiện đã nạp trước đó bằng METHOD:PUBLISH hay không.
 *
 * Cố ý KHÔNG sửa src/medical/ics.ts. Toàn bộ phần dựng file nằm ở đây để lúc thử xong
 * chỉ việc xoá thư mục src/ics-test và gỡ ICS_TEST khỏi app.module.ts là sạch, không
 * để lại dấu vết nào trong luồng thuốc thật.
 *
 * Chỉ mượn lại foldLine (gấp dòng 75 octet — logic khó, chép lại dễ sai) và describeLine
 * từ code thật; cả hai đều chỉ đọc, không đụng gì vào chúng.
 */
import { foldLine } from '../medical/ics';
import { DoseGroup, describeLine } from '../medical/medication-schedule';

export interface TestIcsOptions {
  /** Tiền tố UID — phải GIỐNG HỆT giữa file publish và file cancel thì mới đối chiếu được. */
  uidPrefix: string;
  calendarName: string;
  patientName: string;
  /**
   * Có gắn ORGANIZER/ATTENDEE hay không.
   *
   * Đây chính là biến số của phép thử. METHOD:CANCEL trong RFC 5546 là tin nhắn lịch
   * giữa người tổ chức và người dự, máy nhận đối chiếu ATTENDEE với danh tính tài khoản
   * rồi mới xử lý. Lịch thuốc thật KHÔNG có hai trường này, nên phải thử cả hai kiểu:
   * không có (đúng như thật) và có (để biết cơ chế có chạy được trên iOS hay không).
   */
  attendeeEmail?: string;
  /** Phải TĂNG ở file cancel so với file publish, không thì app Lịch coi là bản cũ và bỏ qua. */
  sequence: number;
}

export function buildTestPublishIcs(groups: DoseGroup[], options: TestIcsOptions): string {
  const stamp = nowStamp();
  const lines = header('PUBLISH', options.calendarName);

  for (const group of groups) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${doseUid(options.uidPrefix, group.index)}`,
      `DTSTAMP:${stamp}`,
      `SEQUENCE:${options.sequence}`,
      `DTSTART:${toStamp(group.date, group.time)}`,
      `DTEND:${toStamp(group.date, addMinutes(group.time, 15))}`,
      `SUMMARY:${escapeText(`[THU] ${options.patientName} - cu ${group.index}`)}`,
      `DESCRIPTION:${escapeText(group.lines.map(describeLine).join('\n'))}`,
      ...attendeeLines(options.attendeeEmail),
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(`[THU] cu ${group.index}`)}`,
      'TRIGGER:PT0S',
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return finish(lines);
}

/**
 * File huỷ thuần: METHOD:CANCEL, không kèm sự kiện mới nào.
 *
 * RFC 5546 chỉ cho một METHOD cho mỗi file, nên đây bắt buộc phải là file riêng — không
 * gộp được với file publish. Đó cũng là lý do bản dọn dẹp hiện tại phải nhét
 * STATUS:CANCELLED vào file PUBLISH thay vì làm đúng chuẩn.
 */
export function buildTestCancelIcs(groups: DoseGroup[], options: TestIcsOptions): string {
  const stamp = nowStamp();
  const lines = header('CANCEL', options.calendarName);

  for (const group of groups) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${doseUid(options.uidPrefix, group.index)}`,
      `DTSTAMP:${stamp}`,
      `SEQUENCE:${options.sequence}`,
      // DTSTART là bắt buộc với mọi VEVENT theo RFC 5545. Thiếu nó thì iPhone coi cả
      // file là hỏng và bỏ qua trong im lặng — sẽ bị nhầm là "CANCEL không chạy".
      `DTSTART:${toStamp(group.date, group.time)}`,
      `DTEND:${toStamp(group.date, addMinutes(group.time, 15))}`,
      `SUMMARY:${escapeText(`[THU] ${options.patientName} - cu ${group.index}`)}`,
      ...attendeeLines(options.attendeeEmail),
      'STATUS:CANCELLED',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return finish(lines);
}

/**
 * PHÉP THỬ C — bản sao chính xác của thứ đang chạy thật.
 *
 * METHOD:PUBLISH kèm các sự kiện STATUS:CANCELLED, đúng như cancelEvent() trong
 * src/medical/ics.ts sinh ra cho bản "dọn dẹp". Câu hỏi: iPhone import một sự kiện
 * STATUS:CANCELLED trùng UID thì có XOÁ sự kiện cũ không, hay chỉ lặng lẽ bỏ qua?
 *
 * Nếu bỏ qua thì tính năng dọn lịch đơn cũ chưa bao giờ hoạt động.
 *
 * Kèm một sự kiện CÒN SỐNG làm chứng nhân. Không có nó thì "không thấy gì xảy ra" là
 * mơ hồ — không phân biệt được "iOS đọc file rồi phớt lờ lệnh huỷ" với "iOS từ chối cả
 * file". Chứng nhân hiện lên = file đã được xử lý, nên cữ cũ còn nguyên là do lệnh huỷ
 * bị bỏ qua chứ không phải do file hỏng.
 */
export function buildTestCleanupIcs(groups: DoseGroup[], options: TestIcsOptions): string {
  const stamp = nowStamp();
  const lines = header('PUBLISH', options.calendarName);
  const first = groups[0];

  lines.push(
    'BEGIN:VEVENT',
    `UID:${options.uidPrefix}-chungnhan@vodich`,
    `DTSTAMP:${stamp}`,
    `SEQUENCE:${options.sequence}`,
    `DTSTART:${toStamp(first.date, '12:00')}`,
    `DTEND:${toStamp(first.date, '12:15')}`,
    'SUMMARY:[THU] CHUNG NHAN - file da duoc xu ly',
    `DESCRIPTION:${escapeText('Thấy sự kiện này = iPhone đã đọc file. Nếu các cữ [THU] khác vẫn còn thì lệnh huỷ bị bỏ qua.')}`,
    'END:VEVENT',
  );

  for (const group of groups) {
    // Giữ nguyên hình dạng cancelEvent() của code thật: SUMMARY ngắn, không VALARM.
    lines.push(
      'BEGIN:VEVENT',
      `UID:${doseUid(options.uidPrefix, group.index)}`,
      `DTSTAMP:${stamp}`,
      `SEQUENCE:${options.sequence}`,
      `DTSTART:${toStamp(group.date, group.time)}`,
      `DTEND:${toStamp(group.date, addMinutes(group.time, 15))}`,
      'SUMMARY:Da ngung',
      'STATUS:CANCELLED',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return finish(lines);
}

function header(method: 'PUBLISH' | 'CANCEL', calendarName: string): string[] {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vo dich//Thu METHOD CANCEL//VI',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
}

/**
 * ORGANIZER phải có mặt cùng ATTENDEE thì tin nhắn iTIP mới hợp lệ; gửi mỗi ATTENDEE
 * là file sai chuẩn và bị bỏ qua. Địa chỉ organizer dùng tên miền .invalid vì không
 * bao giờ được gửi thư thật tới nó.
 */
function attendeeLines(email?: string): string[] {
  const address = String(email || '').trim();
  if (!address) return [];
  return [
    'ORGANIZER;CN=Lich thuoc:mailto:lich@vodich.invalid',
    `ATTENDEE;CN=Toi;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${address}`,
  ];
}

/** Giống hệt cách đặt UID của lịch thật (src/medical/ics.ts) để phép thử phản ánh đúng. */
function doseUid(prefix: string, index: number): string {
  return `${prefix}-d${index}@vodich`;
}

function finish(lines: string[]): string {
  // iCalendar bắt buộc CRLF; dùng LF là kiểu lỗi iPhone từ chối file mà không báo gì.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function toStamp(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

function addMinutes(time: string, minutes: number): string {
  const [hour, minute] = time.split(':').map(Number);
  const total = hour * 60 + minute + minutes;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

function escapeText(value: string): string {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}
