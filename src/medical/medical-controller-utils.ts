import { Request } from 'express';
import { CurrentUser } from '../types';
import { Leftover, leftoverOf, parseCountable } from './cabinet';
import { CarryOverItem, ItemDecision } from './medical.service';
import { DoseTimes, ScheduleItem, buildSchedule, safeStartSlot } from './medication-schedule';

/**
 * Hàm dùng chung của các controller module y tế — thuần, không phụ thuộc Nest.
 *
 * Tách ra từ medical.controller.ts (962 dòng, 24 route) khi chẻ file đó thành bốn
 * controller theo luồng: hồ sơ người thân, tủ thuốc, đơn thuốc, lịch uống. Mấy hàm này
 * là phép tính (còn thừa bao nhiêu thuốc, đã uống mấy liều) nên để riêng thì test được
 * trực tiếp và bốn controller dùng lại y hệt một bản.
 */

export function currentUser(req: Request): CurrentUser {
  return req.session.user as CurrentUser;
}

/** Server chạy UTC trên Render, nhưng "hôm nay" phải theo giờ Việt Nam (UTC+7). */
export function todayInVietnam(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Chỉ nhận YYYY-MM-DD hợp lệ; ngày rác từ query sẽ bị bỏ để rơi về hôm nay. */
export function safeDate(value?: string): string {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? '' : raw;
}

/** Tách base64 (bỏ tiền tố data:...;base64,) và giới hạn kích thước. */
export function parseImage(raw?: string, mime?: string): { data: string; mime: string } | null {
  let value = String(raw || '').trim();
  if (!value) return null;
  let detectedMime = String(mime || '').trim();
  const match = value.match(/^data:(.+?);base64,(.*)$/s);
  if (match) {
    detectedMime = detectedMime || match[1];
    value = match[2];
  }
  if (!value || value.length > 12_000_000) return null;
  return { data: value, mime: detectedMime || 'image/jpeg' };
}

export type PatientTimes = { doseTimeMorning: string; doseTimeNoon: string; doseTimeEvening: string; doseTimeBedtime: string };

export function doseTimesOf(patient: PatientTimes): DoseTimes {
  return {
    morning: patient.doseTimeMorning,
    noon: patient.doseTimeNoon,
    evening: patient.doseTimeEvening,
    bedtime: patient.doseTimeBedtime,
  };
}

export type ItemRow = { id: bigint; timesPerDay: number; days: number };

/**
 * Form gửi lên dạng enabled_<id>=on, times_<id>=2, days_<id>=5, prn_<id>=on.
 * Checkbox không tick thì trình duyệt KHÔNG gửi field -> vắng mặt nghĩa là bỏ thuốc đó.
 */
export function parseDecisions(body: Record<string, unknown>, items: ItemRow[]): ItemDecision[] {
  return items.map((item) => {
    const key = item.id.toString();
    return {
      id: key,
      enabled: body[`enabled_${key}`] !== undefined,
      asNeeded: body[`prn_${key}`] !== undefined,
      timesPerDay: Number(body[`times_${key}`] ?? item.timesPerDay),
      days: Number(body[`days_${key}`] ?? item.days),
    };
  });
}

export function toScheduleItems(items: Array<ItemRow & Record<string, unknown>>): ScheduleItem[] {
  return items
    .filter((item) => item.enabled !== false)
    .map((item) => ({
      id: item.id.toString(),
      drugName: String(item.drugName || ''),
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

/**
 * Số thuốc còn thừa của các thuốc bị ngừng: lấy số lượng được cấp trừ số liều đã lên
 * lịch tới hôm nay. Cữ của đúng hôm nay tính là đã uống cho an toàn — thà báo tồn ít
 * hơn thực tế còn hơn báo thừa rồi không mua đủ.
 */
export function leftoversFor(
  prescription: { scheduleStart: Date | null; scheduleSlot: string },
  stoppedItems: Array<ItemRow & Record<string, unknown>>,
  doseTimes: DoseTimes,
  today: string,
  takenOverride: Record<string, number> = {},
): Leftover[] {
  if (!prescription.scheduleStart) return [];
  const startDate = prescription.scheduleStart.toISOString().slice(0, 10);
  const slot = safeStartSlot(prescription.scheduleSlot);
  return stoppedItems
    .map((item) => {
      const scheduled = buildSchedule(toScheduleItems([{ ...item, enabled: true, asNeeded: false }]), startDate, slot, doseTimes);
      const scheduledTaken = scheduled.groups.filter((group) => group.date <= today).reduce((sum, g) => sum + g.lines.length, 0);
      const override = takenOverride[item.id.toString()];
      const taken = Number.isFinite(override) ? Math.max(0, override) : scheduledTaken;
      return leftoverOf({ drugName: String(item.drugName || ''), quantity: String(item.quantity || ''), dosesTaken: taken });
    })
    .filter((entry): entry is Leftover => Boolean(entry));
}

/** Tổng số liều và số liều đã lên lịch tới hôm nay của một thuốc trong đơn cũ. */
export function doseProgress(
  prescription: { scheduleStart: Date | null; scheduleSlot: string },
  item: ItemRow & Record<string, unknown>,
  doseTimes: DoseTimes,
  today: string,
): { total: number; taken: number } {
  if (!prescription.scheduleStart) return { total: 0, taken: 0 };
  const startDate = prescription.scheduleStart.toISOString().slice(0, 10);
  const built = buildSchedule(
    toScheduleItems([{ ...item, enabled: true, asNeeded: false }]),
    startDate,
    safeStartSlot(prescription.scheduleSlot),
    doseTimes,
  );
  const total = built.groups.reduce((sum, g) => sum + g.lines.length, 0);
  const taken = built.groups.filter((g) => g.date <= today).reduce((sum, g) => sum + g.lines.length, 0);
  return { total, taken };
}

/**
 * Thuốc đơn cũ còn dùng tiếp -> chuyển sang đơn mới với số ngày CÒN LẠI.
 *
 * Trừ đúng phần đã uống, nếu không bé sẽ bị kê lại từ đầu cả liệu trình. Số ngày để số
 * thực (bội 0,5) vì phần còn lại hay rơi vào nửa ngày. Còn dưới nửa ngày thì coi như
 * xong, không chuyển.
 */
export function carryOverFor(
  prescription: { scheduleStart: Date | null; scheduleSlot: string },
  keptItems: Array<ItemRow & Record<string, unknown>>,
  doseTimes: DoseTimes,
  today: string,
  /** Số liều đã uống do người dùng khai lại (bỏ cữ nào thì sửa xuống). */
  takenOverride: Record<string, number> = {},
): CarryOverItem[] {
  if (!prescription.scheduleStart) return [];
  const startDate = prescription.scheduleStart.toISOString().slice(0, 10);
  const slot = safeStartSlot(prescription.scheduleSlot);
  return keptItems
    .map((item) => {
      const timesPerDay = Number(item.timesPerDay || 0);
      if (!timesPerDay) return null;
      const scheduled = buildSchedule(toScheduleItems([{ ...item, enabled: true, asNeeded: false }]), startDate, slot, doseTimes);
      const total = scheduled.groups.reduce((sum, g) => sum + g.lines.length, 0);
      const scheduledTaken = scheduled.groups.filter((g) => g.date <= today).reduce((sum, g) => sum + g.lines.length, 0);
      const override = takenOverride[item.id.toString()];
      const taken = Number.isFinite(override) ? Math.max(0, Math.min(override, total)) : scheduledTaken;
      const leftDoses = Math.max(0, total - taken);
      const days = Math.round((leftDoses / timesPerDay) * 2) / 2;
      if (days < 0.5) return null;
      return {
        drugName: String(item.drugName || ''),
        isAntibiotic: Boolean(item.isAntibiotic),
        dosage: String(item.dosage || ''),
        frequency: String(item.frequency || ''),
        note: String(item.note || ''),
        timesPerDay,
        days,
        // Số lượng còn lại, không phải số lượng cấp ban đầu.
        quantity: `${leftDoses} ${parseCountable(String(item.quantity || ''))?.unit || ''}`.trim(),
        route: String(item.route || ''),
        timing: String(item.timing || ''),
        // Thuốc này đã là hàng chuyển từ đợt trước thì giữ nguyên gốc ban đầu.
        carriedFromId: (item.carriedFromId as bigint | null) ?? null,
      };
    })
    .filter((entry): entry is CarryOverItem => Boolean(entry));
}
