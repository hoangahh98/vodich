/**
 * Sinh file .ics (iCalendar) cho lịch nhắc uống thuốc.
 *
 * Mở file này trên iPhone -> Lịch hỏi "Add All" -> mỗi cữ thành 1 sự kiện có chuông báo.
 * Cố ý KHÔNG dùng RRULE: mỗi cữ là một sự kiện riêng. Đơn có nhiều thuốc kết thúc lệch
 * ngày nhau, dùng RRULE rất dễ nhắc tiếp thuốc đã hết -> nguy hiểm.
 */
import { DoseGroup, describeLine } from './medication-schedule';

export interface IcsOptions {
  calendarName: string;
  /** Tiền tố UID, cần ổn định để import lại lần 2 ghi đè chứ không nhân đôi sự kiện. */
  uidPrefix: string;
  /**
   * Ngày kê đơn (dd/mm), gắn vào tiêu đề sự kiện. Đơn cũ chưa uống xong mà có đơn mới
   * thì trong Lịch sẽ có 2 sự kiện chồng cùng giờ — không ghi rõ đơn nào thì không
   * tài nào phân biệt được trên màn hình điện thoại.
   */
  prescriptionLabel?: string;
  /** Ngày tái khám YYYY-MM-DD (nếu có) -> thêm 1 sự kiện nhắc. */
  followUpDate?: string;
  followUpNote?: string;
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

  for (const group of groups) {
    const start = toStamp(group.date, group.time);
    const end = toStamp(group.date, addMinutes(group.time, 15));
    const antibiotic = group.lines.some((line) => line.isAntibiotic);
    const suffix = options.prescriptionLabel ? ` · đơn ${options.prescriptionLabel}` : '';
    const title = `${antibiotic ? '💊⚠️' : '💊'} Cữ thuốc ${group.time}${suffix}`;
    const body = group.lines.map(describeLine).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${options.uidPrefix}-${group.date.replace(/-/g, '')}-${group.time.replace(':', '')}@vodich`,
      `DTSTAMP:${stamp}`,
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
    lines.push(
      'BEGIN:VEVENT',
      `UID:${options.uidPrefix}-taikham@vodich`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toStamp(options.followUpDate, '09:00')}`,
      `DTEND:${toStamp(options.followUpDate, '09:30')}`,
      'SUMMARY:🏥 Tái khám',
      `DESCRIPTION:${escapeText(options.followUpNote || 'Tái khám theo hẹn của bác sĩ.')}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:🏥 Tái khám',
      // Nhắc trước 1 ngày để còn kịp sắp xếp đưa bé đi khám.
      'TRIGGER:-P1D',
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  // iCalendar bắt buộc CRLF.
  return lines.join('\r\n') + '\r\n';
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
