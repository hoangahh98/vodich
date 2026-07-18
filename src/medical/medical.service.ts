import { Injectable } from '@nestjs/common';
import { blankToNull } from '../common/controller-utils';
import { PrismaService } from '../prisma.service';
import { CurrentUser } from '../types';
import { ExtractedPrescription } from './medical-ai.service';
import { DoseTimes } from './medication-schedule';

@Injectable()
export class MedicalService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Hồ sơ y tế là dữ liệu nhạy cảm: chỉ admin tạo ra, hoặc admin được cấp quyền, mới
   * thấy. Cùng mẫu với travel/teams. Cố ý KHÔNG cho admin gốc xem hết — bệnh án gia
   * đình người khác thì phải được cấp quyền tường minh mới xem được.
   */
  private scopeFor(user: CurrentUser) {
    const adminId = BigInt(user.id);
    return { OR: [{ ownerAdminId: adminId }, { permissions: { some: { adminId } } }] };
  }

  listPatients(user: CurrentUser) {
    return this.prisma.medPatient.findMany({
      where: this.scopeFor(user),
      orderBy: [{ name: 'asc' }],
      include: {
        _count: { select: { prescriptions: true } },
        // Đơn đã chốt lịch gần nhất, để danh sách hiện thẳng nút nạp lịch nhắc.
        prescriptions: {
          where: { scheduleStart: { not: null } },
          orderBy: [{ scheduleStart: 'desc' }, { id: 'desc' }],
          take: 1,
          include: { items: true },
        },
      },
    });
  }

  /** Trả null nếu không tồn tại HOẶC người dùng không có quyền — controller xử như 404. */
  getPatient(id: bigint, user: CurrentUser) {
    return this.prisma.medPatient.findFirst({
      where: { id, ...this.scopeFor(user) },
      include: {
        prescriptions: {
          orderBy: [{ prescribedDate: 'desc' }, { id: 'desc' }],
          include: { items: { orderBy: { id: 'asc' } } },
        },
        permissions: { include: { admin: { select: { id: true, displayName: true, username: true } } } },
      },
    });
  }

  /** Admin khác chưa được cấp quyền, để đổ vào ô chọn "cho ai xem cùng". */
  availableAdmins(patientId: bigint, ownerAdminId?: bigint | null) {
    return this.prisma.appUser.findMany({
      where: {
        role: 'ADMIN',
        id: { notIn: [ownerAdminId || 0n] },
        medicalPermissions: { none: { patientId } },
      },
      select: { id: true, displayName: true, username: true },
      orderBy: { displayName: 'asc' },
    });
  }

  addPermission(patientId: bigint, adminId: bigint) {
    return this.prisma.medPatientPermission.upsert({
      where: { patientId_adminId: { patientId, adminId } },
      create: { patientId, adminId },
      update: {},
    });
  }

  /** Ràng cả patientId để không xoá nhầm quyền của hồ sơ khác qua id truyền tay. */
  removePermission(patientId: bigint, permissionId: bigint) {
    return this.prisma.medPatientPermission.deleteMany({ where: { id: permissionId, patientId } });
  }

  createPatient(user: CurrentUser, body: Record<string, string>) {
    return this.prisma.medPatient.create({
      data: {
        name: String(body.name || '').trim() || 'Chưa đặt tên',
        birthYear: toYear(body.birthYear),
        gender: blankToNull(body.gender),
        allergies: blankToNull(body.allergies),
        conditions: blankToNull(body.conditions),
        notes: blankToNull(body.notes),
        ownerAdminId: BigInt(user.id),
      },
    });
  }

  updatePatient(id: bigint, body: Record<string, string>) {
    return this.prisma.medPatient.update({
      where: { id },
      data: {
        name: String(body.name || '').trim() || 'Chưa đặt tên',
        birthYear: toYear(body.birthYear),
        gender: blankToNull(body.gender),
        allergies: blankToNull(body.allergies),
        conditions: blankToNull(body.conditions),
        notes: blankToNull(body.notes),
      },
    });
  }

  deletePatient(id: bigint) {
    return this.prisma.medPatient.delete({ where: { id } });
  }

  /** Lưu đơn thuốc từ dữ liệu AI trích xuất (kèm ảnh nếu có). */
  async createPrescription(patientId: bigint, extracted: ExtractedPrescription, image?: { data: string; mime: string } | null) {
    return this.prisma.medPrescription.create({
      data: {
        patientId,
        prescribedDate: parseDate(extracted.prescribedDate),
        doctor: extracted.doctor || '',
        clinic: extracted.clinic || '',
        diagnosis: extracted.diagnosis || '',
        imageData: image?.data ?? null,
        imageMime: image?.mime ?? null,
        items: {
          createMany: {
            data: (extracted.items || []).slice(0, 40).map((item) => ({
              drugName: (item.drugName || 'Không rõ').slice(0, 255),
              isAntibiotic: Boolean(item.isAntibiotic),
              dosage: item.dosage || '',
              frequency: item.frequency || '',
              duration: item.duration || '',
              note: item.note || '',
              timesPerDay: item.timesPerDay || 0,
              days: item.days || 0,
              quantity: (item.quantity || '').slice(0, 80),
              quantityCount: item.quantityCount || 0,
              route: item.route || '',
              timing: item.timing || '',
            })),
          },
        },
      },
      include: { items: true },
    });
  }

  /**
   * Lưu quyết định của người dùng cho từng thuốc trong đơn: giữ hay bỏ, và sửa lại
   * số lần/ngày + số ngày nếu AI đọc sai. Đây là bước xác nhận trước khi lên lịch nhắc.
   */
  async saveItemDecisions(prescriptionId: bigint, decisions: ItemDecision[]) {
    // Chỉ cho sửa item thuộc đúng đơn này, tránh sửa nhầm đơn khác qua id truyền tay.
    const owned = await this.prisma.medPrescriptionItem.findMany({
      where: { prescriptionId },
      select: { id: true },
    });
    const allowed = new Set(owned.map((item) => item.id.toString()));
    const updates = decisions
      .filter((decision) => allowed.has(decision.id))
      .map((decision) =>
        this.prisma.medPrescriptionItem.update({
          where: { id: BigInt(decision.id) },
          data: {
            enabled: decision.enabled,
            timesPerDay: clamp(decision.timesPerDay, 0, 6),
            days: clampDays(decision.days),
          },
        }),
      );
    if (updates.length) await this.prisma.$transaction(updates);
  }

  /** Giờ nhắc uống thuốc theo nếp nhà, lưu ở người thân nên mọi đơn dùng chung. */
  saveDoseTimes(patientId: bigint, times: DoseTimes) {
    return this.prisma.medPatient.update({
      where: { id: patientId },
      data: {
        doseTimeMorning: times.morning,
        doseTimeNoon: times.noon,
        doseTimeEvening: times.evening,
        doseTimeBedtime: times.bedtime,
      },
    });
  }

  /** Chốt lịch: ghi nhớ ngày bắt đầu + cữ đầu để máy khác lấy đúng phần còn lại. */
  saveSchedule(prescriptionId: bigint, startDate: string, slot: string) {
    return this.prisma.medPrescription.update({
      where: { id: prescriptionId },
      data: { scheduleStart: new Date(`${startDate}T00:00:00Z`), scheduleSlot: slot },
    });
  }

  saveAnalysis(prescriptionId: bigint, risk: string, summary: string) {
    return this.prisma.medPrescription.update({
      where: { id: prescriptionId },
      data: { aiRisk: risk, aiSummary: summary },
    });
  }

  /** Đơn thuốc cũng phải soi qua quyền của người thân sở hữu nó, không chỉ theo id. */
  getPrescription(id: bigint, user: CurrentUser) {
    return this.prisma.medPrescription.findFirst({
      where: { id, patient: this.scopeFor(user) },
      include: { items: true, patient: true },
    });
  }

  deletePrescription(id: bigint) {
    return this.prisma.medPrescription.delete({ where: { id } });
  }

  /** Các đơn KHÁC của cùng người thân đã chốt lịch — để cảnh báo trùng giờ nhắc. */
  otherScheduled(patientId: bigint, excludeId: bigint) {
    return this.prisma.medPrescription.findMany({
      where: { patientId, id: { not: excludeId }, scheduleStart: { not: null } },
      orderBy: [{ scheduleStart: 'desc' }],
      include: { items: true },
    });
  }

  /** Lịch sử đơn thuốc trước đó của bệnh nhân (để AI đối chiếu). */
  historyForPatient(patientId: bigint, excludeId?: bigint) {
    return this.prisma.medPrescription.findMany({
      where: { patientId, ...(excludeId ? { id: { not: excludeId } } : {}) },
      orderBy: [{ prescribedDate: 'desc' }, { id: 'desc' }],
      take: 15,
      include: { items: true },
    });
  }
}

export interface ItemDecision {
  id: string;
  enabled: boolean;
  timesPerDay: number;
  days: number;
}

function clamp(value: number, min: number, max: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed) || parsed < min) return min;
  return Math.min(parsed, max);
}

/** Số ngày giữ được phần lẻ (2,5 ngày) nhưng chốt về bội của 0,5 để khớp cữ sáng/tối. */
function clampDays(value: number) {
  const parsed = Math.round(Number(value) * 2) / 2;
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 90);
}

function toYear(value?: string) {
  const year = Number(String(value || '').trim());
  return Number.isInteger(year) && year > 1900 && year < 2200 ? year : null;
}

function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
