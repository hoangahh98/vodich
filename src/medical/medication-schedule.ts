/**
 * Tính lịch nhắc uống thuốc từ đơn đã lưu.
 *
 * Cố ý KHÔNG dùng AI ở đây: giờ uống thuốc cho trẻ con phải suy ra được và lặp lại y
 * hệt mỗi lần bấm, nên toàn bộ phần tính là code thuần và có test. AI chỉ làm việc đọc
 * chữ trong ảnh (times_per_day, days...), người dùng sửa lại được trước khi lên lịch.
 */

export type StartSlot = 'SANG' | 'TOI';

export interface ScheduleItem {
  id: string;
  drugName: string;
  dosage: string;
  route: string;
  timing: string;
  timesPerDay: number;
  days: number;
  note: string;
  isAntibiotic: boolean;
}

export interface DoseLine {
  drugName: string;
  dosage: string;
  route: string;
  timing: string;
  isAntibiotic: boolean;
}

/** Một cữ thuốc: nhiều thuốc cùng uống tại một mốc giờ của một ngày. */
export interface DoseGroup {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  lines: DoseLine[];
}

export interface ScheduleResult {
  groups: DoseGroup[];
  /** Thuốc bị bỏ qua vì thiếu số lần/ngày hoặc số ngày -> hiện cảnh báo cho người dùng điền. */
  skipped: Array<{ drugName: string; reason: string }>;
  lastDate: string;
}

// Mốc giờ theo số lần uống mỗi ngày. Chọn giờ gắn với bữa ăn để dễ nhớ và đỡ quên.
const SLOTS: Record<number, string[]> = {
  1: ['07:30'],
  2: ['07:30', '19:30'],
  3: ['07:30', '14:00', '20:00'],
  4: ['07:00', '12:00', '17:00', '21:00'],
  5: ['07:00', '11:00', '15:00', '19:00', '22:00'],
  6: ['07:00', '10:30', '14:00', '17:30', '21:00', '23:30'],
};

// Thuốc uống trước khi ngủ thì mốc duy nhất phải là buổi tối, không phải 07:30.
const BEDTIME = '20:30';

export function slotsFor(item: { timesPerDay: number; timing: string }): string[] {
  const times = SLOTS[item.timesPerDay];
  if (!times) return [];
  if (item.timesPerDay === 1 && item.timing === 'TRUOC_NGU') return [BEDTIME];
  return times;
}

export const ROUTE_LABELS: Record<string, string> = {
  UONG: 'Uống',
  NHO_MUI: 'Nhỏ mũi',
  KHI_DUNG: 'Khí dung',
  XIT: 'Xịt',
  BOI: 'Bôi',
  KHAC: '',
};

export const TIMING_LABELS: Record<string, string> = {
  SAU_AN: 'sau ăn',
  TRUOC_AN: 'trước ăn',
  TRUOC_NGU: 'trước khi ngủ',
};

/**
 * Sinh lịch từ ngày bắt đầu.
 *
 * startSlot='TOI' nghĩa là hôm nay chỉ uống các cữ từ 12:00 trở đi (ví dụ đi khám về
 * buổi chiều, cữ đầu là tối nay). Số cữ tổng vẫn đủ timesPerDay*days nên cữ sáng bị bỏ
 * của ngày đầu sẽ được đẩy sang ngày cuối — không bị hụt liều.
 */
export function buildSchedule(items: ScheduleItem[], startDate: string, startSlot: StartSlot): ScheduleResult {
  const skipped: Array<{ drugName: string; reason: string }> = [];
  const byKey = new Map<string, DoseGroup>();

  for (const item of items) {
    const times = slotsFor(item);
    if (!times.length) {
      skipped.push({ drugName: item.drugName, reason: 'chưa rõ số lần uống mỗi ngày' });
      continue;
    }
    // Cái quyết định liệu trình là TỔNG SỐ LIỀU, không phải số ngày tròn: đơn cấp
    // 5 ống dùng ngày 2 lần thì hết vào giữa ngày thứ 3, không phải cuối ngày thứ 2 hay 3.
    const totalDoses = Math.round(times.length * item.days);
    if (totalDoses < 1) {
      skipped.push({ drugName: item.drugName, reason: 'chưa rõ dùng trong bao nhiêu ngày' });
      continue;
    }
    // Cữ đầu tiên: nếu bắt đầu buổi tối thì bỏ các mốc trước 12:00 của ngày đầu.
    let slotIndex = startSlot === 'TOI' ? times.findIndex((time) => time >= '12:00') : 0;
    if (slotIndex < 0) slotIndex = times.length; // toàn mốc sáng -> dời hẳn sang hôm sau
    let dayOffset = 0;
    if (slotIndex >= times.length) {
      slotIndex = 0;
      dayOffset = 1;
    }

    for (let done = 0; done < totalDoses; done++) {
      const date = addDays(startDate, dayOffset);
      const time = times[slotIndex];
      const key = `${date} ${time}`;
      if (!byKey.has(key)) byKey.set(key, { date, time, lines: [] });
      byKey.get(key)!.lines.push({
        drugName: item.drugName,
        dosage: item.dosage,
        route: item.route,
        timing: item.timing,
        isAntibiotic: item.isAntibiotic,
      });
      slotIndex++;
      if (slotIndex >= times.length) {
        slotIndex = 0;
        dayOffset++;
      }
    }
  }

  const groups = [...byKey.values()].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  return { groups, skipped, lastDate: groups.length ? groups[groups.length - 1].date : startDate };
}

/**
 * Cắt bỏ các cữ đã qua, chỉ giữ phần liệu trình còn lại tính từ mốc (fromDate, fromTime).
 *
 * Dùng khi lịch đã chốt và người dùng nạp lịch vào máy thứ hai, hoặc lấy lại sau vài
 * ngày: nếu sinh lại cả liệu trình từ đầu thì máy mới sẽ có một loạt cữ trong quá khứ.
 * Cữ đang diễn ra ngay tại fromTime vẫn được giữ (>=), tránh làm mất cữ sắp phải uống.
 */
export function remainingFrom(groups: DoseGroup[], fromDate: string, fromTime: string): DoseGroup[] {
  return groups.filter((group) => group.date > fromDate || (group.date === fromDate && group.time >= fromTime));
}

/** Cộng ngày trên chuỗi YYYY-MM-DD, tính bằng UTC để không lệch do múi giờ máy chủ. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const base = Date.UTC(year, month - 1, day);
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

export function describeLine(line: DoseLine): string {
  const route = ROUTE_LABELS[line.route] || '';
  const timing = TIMING_LABELS[line.timing] || '';
  const parts = [route, line.drugName].filter(Boolean).join(' ');
  const detail = [line.dosage, timing].filter(Boolean).join(', ');
  return detail ? `${parts}: ${detail}` : parts;
}
