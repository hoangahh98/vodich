import { Injectable } from '@nestjs/common';
import { blankToNull } from '../common/controller-utils';
import { PrismaService } from '../prisma.service';
import { CurrentUser } from '../types';
import { ExtractedPrescription } from './medical-ai.service';

@Injectable()
export class MedicalService {
  constructor(private readonly prisma: PrismaService) {}

  listPatients() {
    return this.prisma.medPatient.findMany({
      orderBy: [{ name: 'asc' }],
      include: { _count: { select: { prescriptions: true } } },
    });
  }

  getPatient(id: bigint) {
    return this.prisma.medPatient.findUnique({
      where: { id },
      include: {
        prescriptions: {
          orderBy: [{ prescribedDate: 'desc' }, { id: 'desc' }],
          include: { items: { orderBy: { id: 'asc' } } },
        },
      },
    });
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

  getPrescription(id: bigint) {
    return this.prisma.medPrescription.findUnique({ where: { id }, include: { items: true, patient: true } });
  }

  deletePrescription(id: bigint) {
    return this.prisma.medPrescription.delete({ where: { id } });
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
