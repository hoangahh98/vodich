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
   * Ngày kê đơn (dd/mm), gắn vào tiêu đề sự kiện. Đơn cũ chưa uống xong mà có đơn mới
   * thì trong Lịch sẽ có 2 sự kiện chồng cùng giờ — không ghi rõ đơn nào thì không
   * tài nào phân biệt được trên màn hình điện thoại.
   */
  prescriptionLabel?: string;
  /** Ngày tái khám YYYY-MM-DD (nếu có) -> thêm 1 sự kiện nhắc. */
  followUpDate?: string;
  followUpNote?: string;
  /**
   * Các cữ của đơn CŨ cần huỷ, kèm đúng tiền tố UID đã dùng lúc xuất đơn đó.
   * Gửi lại chính UID cũ với STATUS:CANCELLED + SEQUENCE tăng là cách duy nhất để
   * báo cho app Lịch biết những sự kiện đó không còn nữa — server không tự xoá được
   * sự kiện đã nằm trong máy người dùng.
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
    const label = options.prescriptionLabel ? `Đơn ${options.prescriptionLabel}` : 'Thuốc';
    // Danh sách thuốc đưa luôn lên tiêu đề: thông báo trên điện thoại chỉ hiện tiêu đề,
    // để trong phần mô tả thì phải mở sự kiện ra mới biết cữ này uống những gì.
    const drugs = group.lines.map((line) => [line.drugName, line.dosage].filter(Boolean).join(' ')).join(' · ');
    const title = `${antibiotic ? '💊❗' : '💊'} ${label}${antibiotic ? ' (có kháng sinh)' : ''} · ${drugs}`;
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
  const surplusStart = groups.length ? Math.max(...groups.map((g) => g.index)) + 1 : 1;
  for (let index = surplusStart; index <= (options.previousDoseCount || 0); index++) {
    lines.push(...cancelEvent(doseUid(options.uidPrefix, index), stamp, sequence));
  }

  for (const cancel of options.cancels || []) {
    for (const group of cancel.groups) {
      lines.push(...cancelEvent(doseUid(cancel.uidPrefix, group.index), stamp, sequence));
    }
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
 * UID gắn với SỐ THỨ TỰ cữ, không phải ngày+giờ.
 *
 * Đổi giờ uống hay đổi ngày bắt đầu thì cữ số 3 vẫn là cữ số 3, nên app Lịch ghi đè
 * đúng sự kiện cũ. Nếu gắn theo ngày+giờ thì mỗi lần sửa giờ là sinh UID mới và cả
 * loạt sự kiện cũ nằm lại -> nhân đôi lịch.
 */
function doseUid(prefix: string, index: number): string {
  return `${prefix}-d${index}@vodich`;
}

/** Sự kiện huỷ: chỉ cần UID cũ + STATUS:CANCELLED + SEQUENCE tăng. */
function cancelEvent(uid: string, stamp: string, sequence: number): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `SEQUENCE:${sequence}`,
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
