/**
 * Tính lịch nhắc uống thuốc từ đơn đã lưu.
 *
 * Cố ý KHÔNG dùng AI ở đây: giờ uống thuốc cho trẻ con phải suy ra được và lặp lại y
 * hệt mỗi lần bấm, nên toàn bộ phần tính là code thuần và có test. AI chỉ làm việc đọc
 * chữ trong ảnh (times_per_day, days...), người dùng sửa lại được trước khi lên lịch.
 */

export type StartSlot = 'SANG' | 'TRUA' | 'TOI';

/**
 * Đi khám về lúc nào thì chọn buổi đó, lịch tự bỏ các cữ đã trôi qua của ngày đầu.
 * Ngưỡng từng buổi tính trong buildSchedule theo giờ người dùng cấu hình.
 */
export const START_SLOT_LABELS: Record<StartSlot, string> = {
  SANG: 'Bắt đầu từ cữ sáng',
  TRUA: 'Bắt đầu từ cữ trưa',
  TOI: 'Bắt đầu từ cữ tối',
};

export function safeStartSlot(value: unknown): StartSlot {
  const slot = String(value || '').toUpperCase();
  return slot === 'SANG' || slot === 'TRUA' ? slot : 'TOI';
}

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
  /** Thuốc dùng khi cần: KHÔNG lên lịch, nhắc đều đặn loại này là sai. */
  asNeeded?: boolean;
  /** Tổng số lượng được cấp + cờ "số ngày do suy ra" — dùng để soi lệch số lượng. */
  quantityCount?: number;
  quantity?: string;
  daysFromQuantity?: boolean;
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
  /**
   * Số thứ tự cữ trong CẢ liệu trình, bắt đầu từ 1.
   *
   * Đây là thứ dùng làm mã định danh sự kiện lịch. Trước đây mã gắn theo ngày+giờ, nên
   * đổi giờ uống hay đổi ngày bắt đầu là sinh ra mã mới -> điện thoại coi là sự kiện
   * khác và giữ nguyên cả loạt cũ, thành nhân đôi. Đánh theo thứ tự thì cữ số 3 vẫn là
   * cữ số 3 dù giờ có đổi, nên điện thoại ghi đè đúng chỗ.
   *
   * Luôn đánh trên TOÀN BỘ liệu trình rồi mới lọc, để bản "chỉ nạp phần còn lại" giữ
   * đúng số thứ tự gốc chứ không đánh lại từ 1.
   */
  index: number;
}

export interface ScheduleResult {
  groups: DoseGroup[];
  /** Thuốc bị bỏ qua vì thiếu số lần/ngày hoặc số ngày -> hiện cảnh báo cho người dùng điền. */
  skipped: Array<{ drugName: string; reason: string }>;
  /** Thuốc dùng khi cần — cố ý không lên lịch, chỉ liệt kê để người dùng nhớ là có. */
  asNeeded: Array<{ drugName: string; dosage: string; note: string }>;
  /**
   * Số lượng cấp không khớp số ngày ĐƠN GHI RÕ.
   * Chỉ soi khi số ngày do đơn ghi; nếu số ngày vốn được suy ra TỪ số lượng thì hai con
   * số khớp nhau theo định nghĩa, cảnh báo là báo động giả.
   */
  quantityMismatch: Array<{ drugName: string; needed: number; given: number; unit: string }>;
  lastDate: string;
}

/** Giờ nhắc theo nếp sinh hoạt từng nhà, cấu hình được ở trang lịch. */
export interface DoseTimes {
  morning: string;
  noon: string;
  evening: string;
  bedtime: string;
}

export const DEFAULT_DOSE_TIMES: DoseTimes = {
  morning: '07:00',
  noon: '12:00',
  evening: '19:00',
  bedtime: '20:30',
};

/**
 * Mốc giờ theo số lần uống mỗi ngày.
 *
 * Từ 4 lần/ngày trở lên không bám cứng ba mốc sáng/trưa/tối được: nhét thêm cữ quanh
 * ba mốc đó sẽ dồn cục buổi sáng rồi hở một khoảng dài qua đêm. Những trường hợp này
 * chia đều khoảng cách giữa mốc sáng và mốc cuối ngày, vẫn neo vào giờ người dùng đặt.
 */
function slotTable(times: DoseTimes): Record<number, string[]> {
  const { morning, noon, evening } = times;
  return {
    1: [morning],
    2: [morning, evening],
    3: [morning, noon, evening],
    4: [morning, noon, evening, addHours(evening, 2)],
    5: spread(morning, addHours(evening, 4), 5),
    6: spread(morning, addHours(evening, 3), 6),
  };
}

export function slotsFor(item: { timesPerDay: number; timing: string }, times: DoseTimes = DEFAULT_DOSE_TIMES): string[] {
  const table = slotTable(times);
  const slots = table[item.timesPerDay];
  if (!slots) return [];
  // Thuốc uống 1 lần trước khi ngủ phải rơi vào cữ tối muộn, không phải cữ sáng.
  if (item.timesPerDay === 1 && item.timing === 'TRUOC_NGU') return [times.bedtime];
  return slots;
}

/** Chia đều `count` mốc từ `from` đến `to` (đã kẹp trong ngày), làm tròn về 5 phút. */
function spread(from: string, to: string, count: number): string[] {
  const start = toMinutes(from);
  const end = Math.min(toMinutes(to), 23 * 60 + 55);
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, i) => toHHMM(Math.round((start + step * i) / 5) * 5));
}

function addHours(time: string, hours: number): string {
  return toHHMM(Math.min(toMinutes(time) + hours * 60, 23 * 60 + 55));
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function toHHMM(minutes: number): string {
  const clamped = Math.max(0, Math.min(minutes, 23 * 60 + 59));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/** Chỉ nhận HH:MM hợp lệ; giá trị rác từ form sẽ rơi về mặc định. */
export function safeDoseTimes(raw: Partial<Record<keyof DoseTimes, unknown>> = {}): DoseTimes {
  const pick = (key: keyof DoseTimes) => {
    const value = String(raw[key] ?? '').trim();
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : DEFAULT_DOSE_TIMES[key];
  };
  return { morning: pick('morning'), noon: pick('noon'), evening: pick('evening'), bedtime: pick('bedtime') };
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
export function buildSchedule(
  items: ScheduleItem[],
  startDate: string,
  startSlot: StartSlot,
  doseTimes: DoseTimes = DEFAULT_DOSE_TIMES,
): ScheduleResult {
  const skipped: Array<{ drugName: string; reason: string }> = [];
  const asNeeded: ScheduleResult['asNeeded'] = [];
  const quantityMismatch: ScheduleResult['quantityMismatch'] = [];
  const byKey = new Map<string, DoseGroup>();
  // Ngưỡng lấy từ chính giờ người dùng đặt, không cắm cứng: đặt cữ trưa lúc 13:00
  // thì "bắt đầu từ trưa" phải hiểu theo 13:00.
  const floor: Record<StartSlot, string> = {
    SANG: '00:00',
    TRUA: doseTimes.noon,
    TOI: doseTimes.evening,
  };

  for (const item of items) {
    // Thuốc khi cần: cố ý không lên lịch. Nhắc uống hạ sốt lúc bé không sốt là sai.
    if (item.asNeeded) {
      asNeeded.push({ drugName: item.drugName, dosage: item.dosage, note: item.note });
      continue;
    }
    const times = slotsFor(item, doseTimes);
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
    // Soi lệch số lượng: chỉ khi số ngày do ĐƠN GHI RÕ. Nếu số ngày vốn suy ra từ số
    // lượng thì hai con số khớp theo định nghĩa (5 ống, ngày 2 lần = 2,5 ngày), cảnh
    // báo lúc đó chỉ là báo động giả.
    const given = item.quantityCount || 0;
    if (given > 0 && !item.daysFromQuantity) {
      const unit = /gói|goi/i.test(item.quantity || '') ? 'gói'
        : /ống|ong/i.test(item.quantity || '') ? 'ống'
        : /viên|vien/i.test(item.quantity || '') ? 'viên' : '';
      if (unit && given < totalDoses) {
        quantityMismatch.push({ drugName: item.drugName, needed: totalDoses, given, unit });
      }
    }
    // Cữ đầu tiên: bỏ các mốc đã trôi qua của ngày đầu theo buổi người dùng chọn.
    let slotIndex = times.findIndex((time) => time >= floor[startSlot]);
    // Thuốc không có mốc nào từ buổi đó trở đi (vd uống 1 lần buổi sáng mà chọn bắt
    // đầu buổi tối) -> dời hẳn cữ đầu sang hôm sau, không ép uống sai giờ.
    if (slotIndex < 0) slotIndex = times.length;
    let dayOffset = 0;
    if (slotIndex >= times.length) {
      slotIndex = 0;
      dayOffset = 1;
    }

    for (let done = 0; done < totalDoses; done++) {
      const date = addDays(startDate, dayOffset);
      const time = times[slotIndex];
      const key = `${date} ${time}`;
      if (!byKey.has(key)) byKey.set(key, { date, time, lines: [], index: 0 });
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
  // Đánh số sau khi đã sắp xếp, trên toàn bộ liệu trình.
  groups.forEach((group, i) => {
    group.index = i + 1;
  });
  return { groups, skipped, asNeeded, quantityMismatch, lastDate: groups.length ? groups[groups.length - 1].date : startDate };
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
