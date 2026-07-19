/**
 * Feed lịch đăng ký: /lich/<token>.ics
 *
 * VÌ SAO CÓ FILE NÀY — đọc trước khi sửa.
 *
 * Đường tải file .ics (medical.controller.ts) là chép MỘT CHIỀU: nạp xong thì server không
 * với tới sự kiện đó nữa, không sửa được mà cũng không xoá được. Đã thử đủ cách trên cả
 * iCloud lẫn Google Calendar, trượt cả hai (xem chú thích đầu ics.ts).
 *
 * Feed đăng ký lật ngược quan hệ đó. Điện thoại tự gọi URL này theo chu kỳ và SOI GƯƠNG
 * kết quả: cữ nào không còn trong file thì tự biến mất khỏi máy. Không cần STATUS:CANCELLED,
 * không cần đối chiếu UID, không phụ thuộc phía nhận là Apple hay Google. Muốn xoá lịch thì
 * chỉ việc dừng đơn ở web — lần kéo sau là sạch.
 *
 * BA RÀNG BUỘC KHÔNG ĐƯỢC PHÁ:
 *
 * 1. KHÔNG guard, không session. App Lịch không mang theo cookie đăng nhập. Token trong URL
 *    chính là thứ thay cho mật khẩu -> ai có URL là đọc được lịch thuốc của bé. Vì vậy token
 *    phải dài và ngẫu nhiên thật (crypto.randomBytes), và đã được che trong log
 *    (maskSecretPath ở logs/log.service.ts).
 *
 * 2. TRẢ VỀ TOÀN BỘ SỰ THẬT HIỆN TẠI, không phải phần chênh lệch. Feed là ảnh chụp: thiếu
 *    cữ nào là cữ đó bị xoá khỏi máy người dùng. Đừng bao giờ lọc kiểu "chỉ trả cữ mới".
 *
 * 3. KHÔNG BAO GIỜ NÉM LỖI 500. App Lịch gặp lỗi có thể lặng lẽ bỏ luôn lịch đăng ký. Token
 *    sai thì trả 404; không có cữ nào thì trả lịch RỖNG hợp lệ chứ không phải lỗi.
 */
import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../prisma.service';
import { buildIcs } from './ics';
import { buildSchedule, safeStartSlot } from './medication-schedule';
import { DoseGroup } from './medication-schedule';

@Controller()
export class CalendarFeedController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('/lich/:token.ics')
  async feed(@Res() res: Response, @Param('token') token: string) {
    // Chặn sớm: token đúng định dạng mới tra DB, khỏi cho người ta dò bằng chuỗi bất kỳ.
    const clean = String(token || '');
    if (!/^[0-9a-f]{64}$/.test(clean)) return notFoundIcs(res);

    const patient = await this.prisma.medPatient.findUnique({
      where: { calendarToken: clean },
      include: {
        prescriptions: {
          // Chỉ đơn ĐANG CHẠY: đã chốt lịch và chưa bị dừng. Đơn bị dừng rơi khỏi feed,
          // và đó chính là cơ chế xoá — không cần lệnh huỷ nào.
          where: { scheduleStart: { not: null }, scheduleStopped: false },
          include: { items: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!patient) return notFoundIcs(res);

    const doseTimes = {
      morning: patient.doseTimeMorning,
      noon: patient.doseTimeNoon,
      evening: patient.doseTimeEvening,
      bedtime: patient.doseTimeBedtime,
    };

    // Gom mọi đơn đang chạy vào MỘT lịch. Nhà có hai đơn song song thì cả hai cùng hiện,
    // phân biệt bằng ngày kê đơn trong tiêu đề — giống hệt đường tải file.
    const events: string[] = [];
    for (const prescription of patient.prescriptions) {
      const startDate = prescription.scheduleStart!.toISOString().slice(0, 10);
      const built = buildSchedule(
        toScheduleItems(prescription.items),
        startDate,
        safeStartSlot(prescription.scheduleSlot),
        doseTimes,
      );
      if (!built.groups.length) continue;
      events.push(
        eventsOf(built.groups, {
          uidPrefix: `rx${prescription.id}`,
          patientName: patient.name,
          prescriptionLabel: prescription.prescribedDate
            ? prescription.prescribedDate.toISOString().slice(0, 10).split('-').reverse().join('/')
            : '',
          followUpDate: prescription.followUpDate ? prescription.followUpDate.toISOString().slice(0, 10) : '',
          followUpTime: doseTimes.morning,
          followUpNote:
            [prescription.clinic, prescription.doctor].filter(Boolean).join(' - ') || 'Tái khám theo hẹn của bác sĩ.',
        }),
      );
    }

    return sendIcs(res, wrapCalendar(`Thuốc của ${patient.name}`, events.join('')));
  }
}

/**
 * Dựng phần VEVENT của một đơn bằng cách mượn lại buildIcs rồi bóc vỏ VCALENDAR.
 *
 * Mượn thay vì chép: buildIcs giữ những chi tiết đã trả giá mới biết (gấp dòng 75 octet,
 * giờ floating, escape RFC 5545, VALARM). Chép lại là sớm muộn hai đường lệch nhau.
 */
interface EventOptions {
  uidPrefix: string;
  patientName: string;
  prescriptionLabel: string;
  followUpDate: string;
  followUpTime: string;
  followUpNote: string;
}

function eventsOf(groups: DoseGroup[], options: EventOptions): string {
  const full = buildIcs(groups, {
    calendarName: '',
    // SEQUENCE cố định 0: feed không dựa vào ghi đè, mỗi lần kéo là thay cả lịch. Để nó
    // nhảy số mỗi lần gọi chỉ làm file khác nhau vô cớ.
    sequence: 0,
    ...options,
  });
  const start = full.indexOf('BEGIN:VEVENT');
  const end = full.lastIndexOf('END:VEVENT');
  if (start < 0 || end < 0) return '';
  return full.slice(start, end + 'END:VEVENT'.length) + '\r\n';
}

function wrapCalendar(calendarName: string, events: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vo dich//Lich uong thuoc//VI',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    // Gợi ý chu kỳ kéo lại. Chỉ là GỢI Ý — iOS tự quyết theo cài đặt máy, thường 15 phút
    // tới vài giờ. Đừng hứa với người dùng con số này.
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    '',
  ].join('\r\n') + events + 'END:VCALENDAR\r\n';
}

function sendIcs(res: Response, body: string) {
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  // Không cho cache: đây là thứ quyết định lịch trên máy người dùng, phục vụ bản cũ là
  // sai lịch uống thuốc.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.send(body);
}

/**
 * Token sai -> 404 kèm một lịch RỖNG HỢP LỆ chứ không phải trang lỗi HTML.
 * App Lịch nhận HTML ở nơi nó chờ iCalendar có thể huỷ luôn đăng ký.
 */
function notFoundIcs(res: Response) {
  res.status(404);
  return sendIcs(res, wrapCalendar('Lịch không tồn tại', ''));
}

/** Giống hệt cách medical.controller.ts nạp thuốc vào bộ lên lịch. */
function toScheduleItems(items: Array<Record<string, unknown>>) {
  return items
    .filter((item) => item.enabled)
    .map((item) => ({
      id: String(item.id),
      drugName: String(item.drugName),
      dosage: String(item.dosage || ''),
      route: String(item.route || ''),
      timing: String(item.timing || ''),
      timesPerDay: Number(item.timesPerDay || 0),
      days: Number(item.days || 0),
      note: String(item.note || ''),
      isAntibiotic: Boolean(item.isAntibiotic),
      asNeeded: Boolean(item.asNeeded),
      quantityCount: Number(item.quantityCount || 0),
      quantity: String(item.quantity || ''),
      daysFromQuantity: Boolean(item.daysFromQuantity),
    }));
}

function escapeText(value: string): string {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}
