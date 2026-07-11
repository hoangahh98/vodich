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
            })),
          },
        },
      },
      include: { items: true },
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

function toYear(value?: string) {
  const year = Number(String(value || '').trim());
  return Number.isInteger(year) && year > 1900 && year < 2200 ? year : null;
}

function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
