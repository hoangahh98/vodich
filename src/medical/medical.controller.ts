import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { forbidden, notFound, parseBigId, safeNext } from '../common/controller-utils';
import { FeatureAccess } from '../common/feature.decorator';
import { FeatureGuard } from '../common/feature.guard';
import { render } from '../common/view';
import { CurrentUser } from '../types';
import { MedicalAiService } from './medical-ai.service';
import { ItemDecision, MedicalService } from './medical.service';
import { RateLimitService } from '../common/rate-limit.service';
import { buildIcs } from './ics';
import {
  DoseTimes,
  START_SLOT_LABELS,
  ScheduleItem,
  buildSchedule,
  remainingFrom,
  safeDoseTimes,
  safeStartSlot,
} from './medication-schedule';

@Controller()
@UseGuards(FeatureGuard)
@FeatureAccess('MEDICAL')
export class MedicalController {
  constructor(
    private readonly medical: MedicalService,
    private readonly ai: MedicalAiService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get('/medical')
  async index(@Req() req: Request, @Res() res: Response) {
    const patients = await this.medical.listPatients(currentUser(req));
    const today = todayInVietnam();
    // Người thân nào đang có lịch đã chốt và CÒN cữ phải uống thì hiện luôn nút nạp
    // lịch ngoài danh sách. Uống hết liệu trình là nút tự biến mất.
    const activeSchedules = patients.map((patient) => {
      const prescription = patient.prescriptions[0];
      if (!prescription?.scheduleStart) return null;
      const startDate = prescription.scheduleStart.toISOString().slice(0, 10);
      const startSlot = safeStartSlot(prescription.scheduleSlot);
      const { groups } = buildSchedule(toScheduleItems(prescription.items), startDate, startSlot, doseTimesOf(patient));
      const remaining = remainingFrom(groups, today, '00:00');
      if (!remaining.length) return null;
      return {
        prescriptionId: prescription.id.toString(),
        remainingCount: remaining.length,
        lastDate: remaining[remaining.length - 1].date,
      };
    });
    return render(res, 'medical/index', { patients, activeSchedules });
  }

  @Post('/medical/patients')
  async createPatient(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const patient = await this.medical.createPatient(req.session.user as CurrentUser, body);
    return res.redirect(`/medical/patients/${patient.id}`);
  }

  @Get('/medical/patients/:id')
  async patient(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Query('err') err?: string) {
    const patient = await this.scopedPatient(req, res, id);
    if (!patient) return;
    return render(res, 'medical/patient', {
      patient,
      // Điều hướng nằm ở menu ba gạch, không dùng nút mũi tên trong trang.
      // Lịch nhắc trỏ vào đơn mới nhất (danh sách đã sắp giảm dần theo ngày kê).
      menuPatientId: patient.id.toString(),
      menuPrescriptionId: patient.prescriptions[0]?.id.toString() || '',
      // Chỉ chủ hồ sơ mới được cấp/thu quyền, người được cấp thì không.
      isOwner: patient.ownerAdminId?.toString() === currentUser(req).id.toString(),
      availableAdmins: await this.medical.availableAdmins(patient.id, patient.ownerAdminId),
      aiConfigured: this.ai.isConfigured(),
      aiError: String(err || ''),
    });
  }

  @Post('/medical/patients/:id/edit')
  async editPatient(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const patient = await this.scopedPatient(req, res, id);
    if (!patient) return;
    await this.medical.updatePatient(patient.id, body);
    return res.redirect(`/medical/patients/${patient.id}/cau-hinh`);
  }

  @Post('/medical/patients/:id/delete')
  async deletePatient(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const patient = await this.scopedPatient(req, res, id);
    if (!patient) return;
    await this.medical.deletePatient(patient.id);
    return res.redirect('/medical');
  }

  /** Trang cấu hình của một người thân: giờ nhắc, ai được xem, sửa/xóa hồ sơ. */
  @Get('/medical/patients/:id/cau-hinh')
  async patientSettings(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const patient = await this.scopedPatient(req, res, id);
    if (!patient) return;
    return render(res, 'medical/settings', {
      patient,
      menuPatientId: patient.id.toString(),
      menuPrescriptionId: patient.prescriptions[0]?.id.toString() || '',
      doseTimes: doseTimesOf(patient),
      isOwner: patient.ownerAdminId?.toString() === currentUser(req).id.toString(),
      availableAdmins: await this.medical.availableAdmins(patient.id, patient.ownerAdminId),
    });
  }

  /** Lưu giờ nhắc uống thuốc. Gọi từ cả trang cấu hình lẫn trang lịch. */
  @Post('/medical/patients/:id/gio-uong')
  async saveDoseTimes(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const patient = await this.scopedPatient(req, res, id);
    if (!patient) return;
    await this.medical.saveDoseTimes(patient.id, safeDoseTimes(body));
    const next = safeNext(body.next);
    return res.redirect(next || `/medical/patients/${patient.id}/cau-hinh`);
  }

  /** Cho admin khác xem cùng hồ sơ này. Chỉ chủ hồ sơ được làm. */
  @Post('/medical/patients/:id/permissions')
  async addPermission(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body('adminId') adminId: string) {
    const patient = await this.ownedPatient(req, res, id);
    if (!patient) return;
    const target = parseBigId(adminId);
    if (!target) return notFound(res);
    await this.medical.addPermission(patient.id, target);
    return res.redirect(`/medical/patients/${patient.id}/cau-hinh`);
  }

  @Post('/medical/patients/:patientId/permissions/:permissionId/delete')
  async removePermission(@Req() req: Request, @Res() res: Response, @Param('patientId') patientId: string, @Param('permissionId') permissionId: string) {
    const patient = await this.ownedPatient(req, res, patientId);
    if (!patient) return;
    const permId = parseBigId(permissionId);
    if (!permId) return notFound(res);
    await this.medical.removePermission(patient.id, permId);
    return res.redirect(`/medical/patients/${patient.id}/cau-hinh`);
  }

  @Post('/medical/patients/:id/prescriptions')
  async addPrescription(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const patient = await this.scopedPatient(req, res, id);
    if (!patient) return;
    const patientId = patient.id;
    const back = `/medical/patients/${patientId}`;
    if (!this.ai.isConfigured()) return res.redirect(`${back}?err=${encodeURIComponent('Chưa cấu hình AI trên server (GROQ_API_KEY)')}`);
    const limit = this.rateLimit.consume(`ai:medical:${req.ip || 'unknown'}`, { max: 15, windowMs: 60_000 });
    if (!limit.allowed) return res.redirect(`${back}?err=${encodeURIComponent(`Thao tác quá nhanh, thử lại sau ${limit.retryAfterSeconds}s`)}`);
    const image = parseImage(body.imageData, body.imageMime);
    if (!image) return res.redirect(`${back}?err=${encodeURIComponent('Cần chọn ảnh đơn thuốc')}`);
    try {
      const extracted = await this.ai.extractFromImage(image.data, image.mime);
      if (!extracted.items.length) return res.redirect(`${back}?err=${encodeURIComponent('AI không đọc được thuốc trong ảnh, thử ảnh rõ hơn')}`);
      const prescription = await this.medical.createPrescription(patientId, extracted, image);
      await this.runAnalysis(patientId, prescription.id, currentUser(req));
    } catch (error) {
      return res.redirect(`${back}?err=${encodeURIComponent(error instanceof Error ? error.message : 'Xử lý đơn thất bại')}`);
    }
    return res.redirect(back);
  }

  @Post('/medical/prescriptions/:id/reanalyze')
  async reanalyze(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const prescription = await this.scopedPrescription(req, res, id);
    if (!prescription) return;
    const back = `/medical/patients/${prescription.patientId}`;
    const limit = this.rateLimit.consume(`ai:medical:${req.ip || 'unknown'}`, { max: 15, windowMs: 60_000 });
    if (!limit.allowed) return res.redirect(`${back}?err=${encodeURIComponent(`Thao tác quá nhanh, thử lại sau ${limit.retryAfterSeconds}s`)}`);
    try {
      await this.runAnalysis(prescription.patientId, prescription.id, currentUser(req));
    } catch (error) {
      return res.redirect(`${back}?err=${encodeURIComponent(error instanceof Error ? error.message : 'Phân tích thất bại')}`);
    }
    return res.redirect(back);
  }

  @Post('/medical/prescriptions/:id/delete')
  async deletePrescription(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const prescription = await this.scopedPrescription(req, res, id);
    if (!prescription) return;
    await this.medical.deletePrescription(prescription.id);
    return res.redirect(`/medical/patients/${prescription.patientId}`);
  }

  /** Bước xác nhận: giữ/bỏ từng thuốc và sửa số lần/ngày trước khi lên lịch. */
  @Post('/medical/prescriptions/:id/items')
  async saveItems(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const prescription = await this.scopedPrescription(req, res, id);
    if (!prescription) return;
    await this.medical.saveItemDecisions(prescription.id, parseDecisions(body, prescription.items));
    // Lưu xong ở lại trang đơn thuốc; muốn lên lịch thì vào "📅 Lịch uống" ở menu.
    return res.redirect(`/medical/patients/${prescription.patientId}`);
  }

  /** Màn hình tổng quan lịch uống thuốc trước khi tải về iPhone. */
  @Get('/medical/prescriptions/:id/lich')
  async schedule(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Query('start') start?: string, @Query('slot') slot?: string) {
    const prescription = await this.scopedPrescription(req, res, id);
    if (!prescription) return;
    // Lịch đã chốt thì mặc định hiện đúng lịch đó, không lấy lại hôm nay làm ngày bắt đầu.
    const confirmedStart = prescription.scheduleStart ? prescription.scheduleStart.toISOString().slice(0, 10) : '';
    const startDate = safeDate(start) || confirmedStart || todayInVietnam();
    const startSlot = safeStartSlot(slot || prescription.scheduleSlot);
    const result = buildSchedule(toScheduleItems(prescription.items), startDate, startSlot, doseTimesOf(prescription.patient));
    const today = todayInVietnam();
    const remaining = remainingFrom(result.groups, today, '00:00');
    const doseTimes = doseTimesOf(prescription.patient);
    // Đơn cũ chưa uống xong mà nạp thêm lịch đơn mới thì trong Lịch iPhone sẽ có 2 sự
    // kiện chồng cùng giờ, dễ cho uống nhầm gấp đôi. Phải cảnh báo tường minh.
    const others = await this.medical.otherScheduled(prescription.patientId, prescription.id);
    const overlaps = others
      .map((other) => {
        const otherStart = other.scheduleStart!.toISOString().slice(0, 10);
        const built = buildSchedule(toScheduleItems(other.items), otherStart, safeStartSlot(other.scheduleSlot), doseTimes);
        const left = remainingFrom(built.groups, today, '00:00');
        if (!left.length) return null;
        return {
          date: other.prescribedDate ? other.prescribedDate.toISOString().slice(0, 10) : '',
          remainingCount: left.length,
          lastDate: left[left.length - 1].date,
          drugs: [...new Set(left.flatMap((g) => g.lines.map((l) => l.drugName)))],
        };
      })
      .filter(Boolean);
    return render(res, 'medical/schedule', {
      patient: prescription.patient,
      prescription,
      menuPatientId: prescription.patientId.toString(),
      menuPrescriptionId: prescription.id.toString(),
      startDate,
      startSlot,
      slotLabels: START_SLOT_LABELS,
      doseTimes,
      overlaps,
      result,
      confirmedStart,
      today,
      // Số cữ còn phải uống tính từ hôm nay — dùng để hiện trên nút nạp vào máy khác.
      remainingCount: remaining.length,
      remainingLast: remaining.length ? remaining[remaining.length - 1].date : '',
    });
  }

  /** Chốt lịch để máy khác lấy về đúng phần liệu trình còn lại. */
  @Post('/medical/prescriptions/:id/lich/chot')
  async confirmSchedule(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const prescription = await this.scopedPrescription(req, res, id);
    if (!prescription) return;
    const startDate = safeDate(body.start) || todayInVietnam();
    const startSlot = safeStartSlot(body.slot);
    await this.medical.saveSchedule(prescription.id, startDate, startSlot);
    return res.redirect(`/medical/prescriptions/${prescription.id}/lich`);
  }

  /**
   * Tải file .ics để nạp thẳng vào Lịch trên iPhone.
   *
   * `full=1` nạp cả liệu trình. Mặc định chỉ nạp phần CÒN LẠI tính từ hôm nay: máy thứ
   * hai lấy lịch vào giữa liệu trình mà nạp lại từ đầu thì sẽ đầy cữ trong quá khứ.
   */
  @Get('/medical/prescriptions/:id/lich.ics')
  async scheduleIcs(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') id: string,
    @Query('start') start?: string,
    @Query('slot') slot?: string,
    @Query('full') full?: string,
  ) {
    const prescription = await this.scopedPrescription(req, res, id);
    if (!prescription) return;
    const prescriptionId = prescription.id;
    const confirmedStart = prescription.scheduleStart ? prescription.scheduleStart.toISOString().slice(0, 10) : '';
    const startDate = safeDate(start) || confirmedStart || todayInVietnam();
    const startSlot = safeStartSlot(slot || prescription.scheduleSlot);
    const built = buildSchedule(toScheduleItems(prescription.items), startDate, startSlot, doseTimesOf(prescription.patient));
    const groups = full === '1' ? built.groups : remainingFrom(built.groups, todayInVietnam(), '00:00');
    if (!groups.length) return notFound(res, 'Không còn cữ thuốc nào cần nhắc');
    const ics = buildIcs(groups, {
      calendarName: `Thuốc của ${prescription.patient.name}`,
      // UID gắn với id đơn: import lại lần 2 sẽ ghi đè chứ không nhân đôi sự kiện.
      uidPrefix: `rx${prescriptionId}`,
      prescriptionLabel: prescription.prescribedDate
        ? prescription.prescribedDate.toISOString().slice(0, 10).split('-').reverse().slice(0, 2).join('/')
        : '',
      followUpNote: [prescription.clinic, prescription.doctor].filter(Boolean).join(' - '),
    });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    // inline chứ không attachment: iOS Safari mở thẳng màn hình "Add All" của Lịch,
    // còn attachment thì tải vào Files rồi người dùng phải tự mở thêm một bước nữa.
    res.setHeader('Content-Disposition', `inline; filename="lich-uong-thuoc-${prescriptionId}.ics"`);
    return res.send(ics);
  }

  @Get('/medical/prescriptions/:id/image')
  async image(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    // Ảnh đơn thuốc là dữ liệu nhạy cảm nhất ở đây (tên, tuổi, chẩn đoán của bé)
    // nên phải qua đúng bộ lọc quyền như mọi route khác.
    const prescription = await this.scopedPrescription(req, res, id);
    if (!prescription) return;
    if (!prescription.imageData) return notFound(res, 'Không có ảnh');
    const buffer = Buffer.from(prescription.imageData, 'base64');
    res.setHeader('Content-Type', prescription.imageMime || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(buffer);
  }

  /**
   * Lấy người thân theo id NHƯNG chỉ khi người dùng có quyền; nếu không thì trả 404
   * (đã gửi response) và trả null. Cố ý dùng 404 chứ không 403: 403 sẽ tiết lộ rằng
   * hồ sơ đó có tồn tại.
   */
  private async scopedPatient(req: Request, res: Response, idParam: string) {
    const patientId = parseBigId(idParam);
    if (!patientId) {
      notFound(res);
      return null;
    }
    const patient = await this.medical.getPatient(patientId, currentUser(req));
    if (!patient) {
      notFound(res);
      return null;
    }
    return patient;
  }

  /** Như scopedPatient nhưng đòi đúng chủ hồ sơ — dùng cho việc cấp/thu quyền. */
  private async ownedPatient(req: Request, res: Response, idParam: string) {
    const patient = await this.scopedPatient(req, res, idParam);
    if (!patient) return null;
    if (patient.ownerAdminId?.toString() !== currentUser(req).id.toString()) {
      forbidden(res, 'Chỉ người tạo hồ sơ mới được phân quyền');
      return null;
    }
    return patient;
  }

  private async scopedPrescription(req: Request, res: Response, idParam: string) {
    const prescriptionId = parseBigId(idParam);
    if (!prescriptionId) {
      notFound(res);
      return null;
    }
    const prescription = await this.medical.getPrescription(prescriptionId, currentUser(req));
    if (!prescription) {
      notFound(res);
      return null;
    }
    return prescription;
  }

  private async runAnalysis(patientId: bigint, prescriptionId: bigint, user: CurrentUser) {
    const [prescription, patient, history] = await Promise.all([
      this.medical.getPrescription(prescriptionId, user),
      this.medical.getPatient(patientId, user),
      this.medical.historyForPatient(patientId, prescriptionId),
    ]);
    if (!prescription || !patient) return;
    const analysis = await this.ai.analyze(
      { name: patient.name, birthYear: patient.birthYear, gender: patient.gender, allergies: patient.allergies, conditions: patient.conditions },
      prescription.items.map((item) => ({
        drugName: item.drugName,
        isAntibiotic: item.isAntibiotic,
        dosage: item.dosage,
        frequency: item.frequency,
        duration: item.duration,
        note: item.note,
      })),
      history.map((entry) => ({
        date: entry.prescribedDate ? entry.prescribedDate.toISOString().slice(0, 10) : '',
        items: entry.items.map((item) => ({ drugName: item.drugName, isAntibiotic: item.isAntibiotic, duration: item.duration })),
      })),
    );
    await this.medical.saveAnalysis(prescriptionId, analysis.risk, analysis.summary);
  }
}

function currentUser(req: Request): CurrentUser {
  return req.session.user as CurrentUser;
}

type PatientTimes = { doseTimeMorning: string; doseTimeNoon: string; doseTimeEvening: string; doseTimeBedtime: string };

function doseTimesOf(patient: PatientTimes): DoseTimes {
  return {
    morning: patient.doseTimeMorning,
    noon: patient.doseTimeNoon,
    evening: patient.doseTimeEvening,
    bedtime: patient.doseTimeBedtime,
  };
}

type ItemRow = { id: bigint; timesPerDay: number; days: number };

/**
 * Form gửi lên dạng enabled_<id>=on, times_<id>=2, days_<id>=5.
 * Checkbox không tick thì trình duyệt KHÔNG gửi field -> vắng mặt nghĩa là bỏ thuốc đó.
 */
function parseDecisions(body: Record<string, unknown>, items: ItemRow[]): ItemDecision[] {
  return items.map((item) => {
    const key = item.id.toString();
    return {
      id: key,
      enabled: body[`enabled_${key}`] !== undefined,
      timesPerDay: Number(body[`times_${key}`] ?? item.timesPerDay),
      days: Number(body[`days_${key}`] ?? item.days),
    };
  });
}

function toScheduleItems(items: Array<ItemRow & Record<string, unknown>>): ScheduleItem[] {
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
    }));
}

/** Chỉ nhận YYYY-MM-DD hợp lệ; ngày rác từ query sẽ bị bỏ để rơi về hôm nay. */
function safeDate(value?: string): string {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? '' : raw;
}

/** Server chạy UTC trên Render, nhưng "hôm nay" phải theo giờ Việt Nam (UTC+7). */
function todayInVietnam(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Tách base64 (bỏ tiền tố data:...;base64,) và giới hạn kích thước. */
function parseImage(raw?: string, mime?: string): { data: string; mime: string } | null {
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
