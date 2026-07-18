import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { forbidden, notFound, parseBigId } from '../common/controller-utils';
import { FeatureAccess } from '../common/feature.decorator';
import { FeatureGuard } from '../common/feature.guard';
import { render } from '../common/view';
import { CurrentUser } from '../types';
import { MedicalAiService } from './medical-ai.service';
import { ItemDecision, MedicalService } from './medical.service';
import { RateLimitService } from '../common/rate-limit.service';
import { buildIcs } from './ics';
import { ScheduleItem, StartSlot, buildSchedule, remainingFrom } from './medication-schedule';

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
  async index(@Res() res: Response) {
    const patients = await this.medical.listPatients();
    return render(res, 'medical/index', { patients });
  }

  @Post('/medical/patients')
  async createPatient(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const patient = await this.medical.createPatient(req.session.user as CurrentUser, body);
    return res.redirect(`/medical/patients/${patient.id}`);
  }

  @Get('/medical/patients/:id')
  async patient(@Res() res: Response, @Param('id') id: string, @Query('err') err?: string) {
    const patientId = parseBigId(id);
    if (!patientId) return notFound(res);
    const patient = await this.medical.getPatient(patientId);
    if (!patient) return notFound(res);
    return render(res, 'medical/patient', {
      patient,
      aiConfigured: this.ai.isConfigured(),
      disclaimer: this.ai.disclaimer(),
      aiError: String(err || ''),
    });
  }

  @Post('/medical/patients/:id/edit')
  async editPatient(@Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const patientId = parseBigId(id);
    if (!patientId) return notFound(res);
    await this.medical.updatePatient(patientId, body);
    return res.redirect(`/medical/patients/${patientId}`);
  }

  @Post('/medical/patients/:id/delete')
  async deletePatient(@Res() res: Response, @Param('id') id: string) {
    const patientId = parseBigId(id);
    if (!patientId) return notFound(res);
    await this.medical.deletePatient(patientId);
    return res.redirect('/medical');
  }

  @Post('/medical/patients/:id/prescriptions')
  async addPrescription(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const patientId = parseBigId(id);
    if (!patientId) return notFound(res);
    const patient = await this.medical.getPatient(patientId);
    if (!patient) return notFound(res);
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
      await this.runAnalysis(patientId, prescription.id);
    } catch (error) {
      return res.redirect(`${back}?err=${encodeURIComponent(error instanceof Error ? error.message : 'Xử lý đơn thất bại')}`);
    }
    return res.redirect(back);
  }

  @Post('/medical/prescriptions/:id/reanalyze')
  async reanalyze(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const prescriptionId = parseBigId(id);
    if (!prescriptionId) return notFound(res);
    const prescription = await this.medical.getPrescription(prescriptionId);
    if (!prescription) return notFound(res);
    const back = `/medical/patients/${prescription.patientId}`;
    const limit = this.rateLimit.consume(`ai:medical:${req.ip || 'unknown'}`, { max: 15, windowMs: 60_000 });
    if (!limit.allowed) return res.redirect(`${back}?err=${encodeURIComponent(`Thao tác quá nhanh, thử lại sau ${limit.retryAfterSeconds}s`)}`);
    try {
      await this.runAnalysis(prescription.patientId, prescriptionId);
    } catch (error) {
      return res.redirect(`${back}?err=${encodeURIComponent(error instanceof Error ? error.message : 'Phân tích thất bại')}`);
    }
    return res.redirect(back);
  }

  @Post('/medical/prescriptions/:id/delete')
  async deletePrescription(@Res() res: Response, @Param('id') id: string) {
    const prescriptionId = parseBigId(id);
    if (!prescriptionId) return notFound(res);
    const prescription = await this.medical.getPrescription(prescriptionId);
    if (!prescription) return notFound(res);
    await this.medical.deletePrescription(prescriptionId);
    return res.redirect(`/medical/patients/${prescription.patientId}`);
  }

  /** Bước xác nhận: giữ/bỏ từng thuốc và sửa số lần/ngày trước khi lên lịch. */
  @Post('/medical/prescriptions/:id/items')
  async saveItems(@Res() res: Response, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const prescriptionId = parseBigId(id);
    if (!prescriptionId) return notFound(res);
    const prescription = await this.medical.getPrescription(prescriptionId);
    if (!prescription) return notFound(res);
    await this.medical.saveItemDecisions(prescriptionId, parseDecisions(body, prescription.items));
    return res.redirect(`/medical/prescriptions/${prescriptionId}/lich`);
  }

  /** Màn hình tổng quan lịch uống thuốc trước khi tải về iPhone. */
  @Get('/medical/prescriptions/:id/lich')
  async schedule(@Res() res: Response, @Param('id') id: string, @Query('start') start?: string, @Query('slot') slot?: string) {
    const prescriptionId = parseBigId(id);
    if (!prescriptionId) return notFound(res);
    const prescription = await this.medical.getPrescription(prescriptionId);
    if (!prescription) return notFound(res);
    // Lịch đã chốt thì mặc định hiện đúng lịch đó, không lấy lại hôm nay làm ngày bắt đầu.
    const confirmedStart = prescription.scheduleStart ? prescription.scheduleStart.toISOString().slice(0, 10) : '';
    const startDate = safeDate(start) || confirmedStart || todayInVietnam();
    const startSlot: StartSlot = (slot || prescription.scheduleSlot) === 'SANG' ? 'SANG' : 'TOI';
    const result = buildSchedule(toScheduleItems(prescription.items), startDate, startSlot);
    const today = todayInVietnam();
    const remaining = remainingFrom(result.groups, today, '00:00');
    return render(res, 'medical/schedule', {
      patient: prescription.patient,
      prescription,
      startDate,
      startSlot,
      result,
      confirmedStart,
      today,
      // Số cữ còn phải uống tính từ hôm nay — dùng để hiện trên nút nạp vào máy khác.
      remainingCount: remaining.length,
      remainingLast: remaining.length ? remaining[remaining.length - 1].date : '',
      disclaimer: this.ai.disclaimer(),
    });
  }

  /** Chốt lịch để máy khác lấy về đúng phần liệu trình còn lại. */
  @Post('/medical/prescriptions/:id/lich/chot')
  async confirmSchedule(@Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const prescriptionId = parseBigId(id);
    if (!prescriptionId) return notFound(res);
    const prescription = await this.medical.getPrescription(prescriptionId);
    if (!prescription) return notFound(res);
    const startDate = safeDate(body.start) || todayInVietnam();
    const startSlot: StartSlot = body.slot === 'SANG' ? 'SANG' : 'TOI';
    await this.medical.saveSchedule(prescriptionId, startDate, startSlot);
    return res.redirect(`/medical/prescriptions/${prescriptionId}/lich`);
  }

  /**
   * Tải file .ics để nạp thẳng vào Lịch trên iPhone.
   *
   * `full=1` nạp cả liệu trình. Mặc định chỉ nạp phần CÒN LẠI tính từ hôm nay: máy thứ
   * hai lấy lịch vào giữa liệu trình mà nạp lại từ đầu thì sẽ đầy cữ trong quá khứ.
   */
  @Get('/medical/prescriptions/:id/lich.ics')
  async scheduleIcs(
    @Res() res: Response,
    @Param('id') id: string,
    @Query('start') start?: string,
    @Query('slot') slot?: string,
    @Query('full') full?: string,
  ) {
    const prescriptionId = parseBigId(id);
    if (!prescriptionId) return notFound(res);
    const prescription = await this.medical.getPrescription(prescriptionId);
    if (!prescription) return notFound(res);
    const confirmedStart = prescription.scheduleStart ? prescription.scheduleStart.toISOString().slice(0, 10) : '';
    const startDate = safeDate(start) || confirmedStart || todayInVietnam();
    const startSlot: StartSlot = (slot || prescription.scheduleSlot) === 'SANG' ? 'SANG' : 'TOI';
    const built = buildSchedule(toScheduleItems(prescription.items), startDate, startSlot);
    const groups = full === '1' ? built.groups : remainingFrom(built.groups, todayInVietnam(), '00:00');
    if (!groups.length) return notFound(res, 'Không còn cữ thuốc nào cần nhắc');
    const ics = buildIcs(groups, {
      calendarName: `Thuốc của ${prescription.patient.name}`,
      // UID gắn với id đơn: import lại lần 2 sẽ ghi đè chứ không nhân đôi sự kiện.
      uidPrefix: `rx${prescriptionId}`,
      followUpNote: [prescription.clinic, prescription.doctor].filter(Boolean).join(' - '),
    });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    // inline chứ không attachment: iOS Safari mở thẳng màn hình "Add All" của Lịch,
    // còn attachment thì tải vào Files rồi người dùng phải tự mở thêm một bước nữa.
    res.setHeader('Content-Disposition', `inline; filename="lich-uong-thuoc-${prescriptionId}.ics"`);
    return res.send(ics);
  }

  @Get('/medical/prescriptions/:id/image')
  async image(@Res() res: Response, @Param('id') id: string) {
    const prescriptionId = parseBigId(id);
    if (!prescriptionId) return notFound(res);
    const prescription = await this.medical.getPrescription(prescriptionId);
    if (!prescription?.imageData) return notFound(res, 'Không có ảnh');
    const buffer = Buffer.from(prescription.imageData, 'base64');
    res.setHeader('Content-Type', prescription.imageMime || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(buffer);
  }

  private async runAnalysis(patientId: bigint, prescriptionId: bigint) {
    const [prescription, patient, history] = await Promise.all([
      this.medical.getPrescription(prescriptionId),
      this.medical.getPatient(patientId),
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
