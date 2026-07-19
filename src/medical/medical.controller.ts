import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { forbidden, notFound, parseBigId } from '../common/controller-utils';
import { FeatureAccess } from '../common/feature.decorator';
import { FeatureGuard } from '../common/feature.guard';
import { render } from '../common/view';
import { CurrentUser } from '../types';
import { MedicalAiService } from './medical-ai.service';
import { CarryOverItem, ItemDecision, MedicalService } from './medical.service';
import { RateLimitService } from '../common/rate-limit.service';
import { buildIcs } from './ics';
import { CabinetService } from './cabinet.service';
import { Leftover, leftoverOf, parseCountable } from './cabinet';
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
    private readonly cabinet: CabinetService,
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

  @Get('/medical/tu-thuoc')
  async cabinetPage(@Req() req: Request, @Res() res: Response, @Query('err') err?: string) {
    const user = currentUser(req);
    const items = await this.cabinet.list(user);
    // Tủ thuốc không gắn với người thân nào, nhưng menu y tế vẫn nên đủ mục. Nếu chỉ có
    // một người thân thì lấy luôn làm ngữ cảnh; nhiều người thì không đoán bừa.
    const patients = await this.medical.listPatients(user);
    const only = patients.length === 1 ? patients[0] : null;
    return render(res, 'medical/cabinet', {
      items,
      menuPatientId: only ? only.id.toString() : '',
      menuPrescriptionId: only?.prescriptions[0]?.id.toString() || '',
      today: todayInVietnam(),
      aiConfigured: this.ai.isConfigured(),
      aiError: String(err || ''),
    });
  }

  @Post('/medical/tu-thuoc')
  async cabinetCreate(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    await this.cabinet.create(currentUser(req), body);
    return res.redirect('/medical/tu-thuoc');
  }

  @Post('/medical/tu-thuoc/:id/edit')
  async cabinetUpdate(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const itemId = parseBigId(id);
    if (!itemId) return notFound(res);
    const updated = await this.cabinet.update(currentUser(req), itemId, body);
    if (!updated) return notFound(res);
    return res.redirect('/medical/tu-thuoc');
  }

  @Post('/medical/tu-thuoc/:id/delete')
  async cabinetDelete(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const itemId = parseBigId(id);
    if (!itemId) return notFound(res);
    if (!(await this.cabinet.remove(currentUser(req), itemId))) return notFound(res);
    return res.redirect('/medical/tu-thuoc');
  }

  /** Nhờ AI ước lượng hạn cho những thuốc CHƯA điền hạn. */
  @Post('/medical/tu-thuoc/kiem-tra-han')
  async cabinetCheckExpiry(@Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const back = '/medical/tu-thuoc';
    if (!this.ai.isConfigured()) return res.redirect(`${back}?err=${encodeURIComponent('Chưa cấu hình AI trên server (GROQ_API_KEY)')}`);
    const limit = this.rateLimit.consume(`ai:cabinet:${req.ip || 'unknown'}`, { max: 10, windowMs: 60_000 });
    if (!limit.allowed) return res.redirect(`${back}?err=${encodeURIComponent(`Thao tác quá nhanh, thử lại sau ${limit.retryAfterSeconds}s`)}`);
    const items = await this.cabinet.list(user);
    // Chỉ hỏi AI những thuốc chưa có hạn thật; đã điền hạn thì không cần đoán.
    const pending = items.filter((item) => !item.expiryDate);
    if (!pending.length) return res.redirect(`${back}?err=${encodeURIComponent('Mọi thuốc đều đã có hạn dùng, không cần đoán')}`);
    try {
      const verdicts = await this.ai.assessExpiry(
        pending.map((item) => ({
          drugName: item.drugName,
          unit: item.unit,
          quantity: item.quantity,
          purchasedAt: item.purchasedAt ? item.purchasedAt.toISOString().slice(0, 10) : 'không rõ',
        })),
        todayInVietnam(),
      );
      for (const item of pending) {
        const verdict = verdicts.find((entry) => entry.drugName === item.drugName);
        if (!verdict) continue;
        const note = [verdict.estimatedExpiry ? `Ước lượng hạn: ${verdict.estimatedExpiry}` : '', verdict.advice]
          .filter(Boolean)
          .join('. ');
        await this.cabinet.saveExpiryVerdict(item.id, verdict.risk, note);
      }
    } catch (error) {
      return res.redirect(`${back}?err=${encodeURIComponent(error instanceof Error ? error.message : 'Ước lượng hạn thất bại')}`);
    }
    return res.redirect(back);
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
      // Đơn mới nhất có thuốc nào nhà đang còn sẵn không — để khỏi mua trùng.
      cabinetMatches: await this.cabinet.matchFor(
        currentUser(req),
        (patient.prescriptions[0]?.items || []).map((item) => item.drugName),
      ),
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
      isOwner: patient.ownerAdminId?.toString() === currentUser(req).id.toString(),
      availableAdmins: await this.medical.availableAdmins(patient.id, patient.ownerAdminId),
    });
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
      // Đơn cũ chưa uống xong thì hỏi ngay thuốc nào còn dùng tiếp, trước khi lên lịch.
      const others = await this.medical.otherScheduled(patientId, prescription.id);
      if (others.length) return res.redirect(`/medical/prescriptions/${prescription.id}/chuyen-don`);
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

  /**
   * Có đơn mới trong khi đơn cũ chưa uống xong: hỏi thuốc nào còn dùng tiếp.
   * Bỏ tick hết thì lịch đơn cũ bị dừng và file .ics đơn mới sẽ kèm lệnh huỷ cữ cũ.
   */
  @Get('/medical/prescriptions/:id/chuyen-don')
  async transition(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const prescription = await this.scopedPrescription(req, res, id);
    if (!prescription) return;
    const others = await this.medical.otherScheduled(prescription.patientId, prescription.id);
    if (!others.length) return res.redirect(`/medical/prescriptions/${prescription.id}/lich`);
    // Hiện sẵn "đã uống mấy liều" để người dùng sửa nếu có hôm bỏ cữ — nếu không, app
    // mặc định coi mọi cữ đã lên lịch đều đã uống và sẽ cắt ngắn liệu trình.
    const doseTimes = doseTimesOf(prescription.patient);
    const today = todayInVietnam();
    const progress: Record<string, { total: number; taken: number }> = {};
    for (const other of others) {
      for (const item of other.items) {
        progress[item.id.toString()] = doseProgress(other, item, doseTimes, today);
      }
    }
    return render(res, 'medical/transition', {
      patient: prescription.patient,
      prescription,
      others,
      progress,
      menuPatientId: prescription.patientId.toString(),
      menuPrescriptionId: prescription.id.toString(),
    });
  }

  @Post('/medical/prescriptions/:id/chuyen-don')
  async saveTransition(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const prescription = await this.scopedPrescription(req, res, id);
    if (!prescription) return;
    const others = await this.medical.otherScheduled(prescription.patientId, prescription.id);
    // Checkbox không tick thì trình duyệt không gửi field -> vắng mặt nghĩa là ngừng thuốc đó.
    const keep = others.flatMap((other) =>
      other.items.map((item) => item.id.toString()).filter((itemId) => body[`keep_${itemId}`] !== undefined),
    );
    const doseTimes = doseTimesOf(prescription.patient);
    const today = todayInVietnam();
    // Người dùng khai lại số liều đã uống (bỏ cữ nào thì sửa xuống); vắng thì dùng số
    // app tự tính.
    const takenOverride: Record<string, number> = {};
    for (const other of others) {
      for (const item of other.items) {
        const raw = body[`taken_${item.id}`];
        const parsed = Math.round(Number(raw));
        if (raw !== undefined && Number.isFinite(parsed)) takenOverride[item.id.toString()] = parsed;
      }
    }
    for (const other of others) {
      const stopped = other.items.filter((item) => !keep.includes(item.id.toString()));
      const kept = other.items.filter((item) => keep.includes(item.id.toString()));
      // Ghi thuốc thừa vào tủ TRƯỚC khi tắt, vì sau khi tắt thì không dựng lại được
      // số liều đã uống nữa. Cùng lý do với việc tính số ngày còn lại ngay tại đây.
      const leftovers = leftoversFor(other, stopped, doseTimes, today, takenOverride);
      if (leftovers.length) await this.cabinet.addLeftovers(currentUser(req), leftovers, other.prescribedDate);
      const carryOver = carryOverFor(other, kept, doseTimes, today, takenOverride);
      await this.medical.applyTransition(other.id, prescription.id, carryOver);
    }
    return res.redirect(`/medical/prescriptions/${prescription.id}/lich`);
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
    // Nhãn nguồn khoá theo ID THUỐC, không phải tên: sau khi chuyển đơn, cùng một thuốc có
    // thể vừa được kê mới vừa được chuyển sang, thành hai dòng trùng tên. Khoá theo tên là
    // dán nhầm nhãn cho cả hai. Thuốc chuyển sang đã uống dở nên số ngày là phần CÒN LẠI —
    // nhìn ra ngay mới soát đúng.
    const carriedIds = prescription.items.map((item) => item.carriedFromId).filter((v): v is bigint => Boolean(v));
    const carrySources = await this.medical.carrySourceDates(carriedIds);
    const drugSources = new Map<string, string>();
    for (const item of prescription.items) {
      if (!item.carriedFromId) continue;
      const date = carrySources.get(item.carriedFromId.toString());
      drugSources.set(item.id.toString(), date ? date.split('-').reverse().slice(0, 2).join('/') : '');
    }
    // Cùng một thuốc nằm hai dòng trong đơn (thường do chuyển đơn mà bác sĩ cũng kê lại)
    // thì lịch sinh ra HAI cữ cùng giờ -> uống gấp đôi liều. Phải chặn bằng cảnh báo, đây
    // là loại lỗi không được để người dùng tự phát hiện.
    const nameCount = new Map<string, number>();
    for (const item of prescription.items) {
      if (!item.enabled) continue;
      const key = item.drugName.trim().toLowerCase();
      nameCount.set(key, (nameCount.get(key) || 0) + 1);
    }
    const duplicateDrugs = [
      ...new Set(prescription.items.filter((i) => i.enabled && (nameCount.get(i.drugName.trim().toLowerCase()) || 0) > 1).map((i) => i.drugName)),
    ];
    return render(res, 'medical/schedule', {
      drugSources,
      duplicateDrugs,
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

  /**
   * Lưu giờ nhắc + tính lại lịch trong một thao tác.
   * Gộp làm một vì tách hai nút "tính lại" và "lưu giờ" chỉ tổ rối, người dùng bấm
   * nhầm là lịch ra một đằng giờ lưu một nẻo.
   */
  @Post('/medical/prescriptions/:id/lich/tinh-lai')
  async recalculate(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const prescription = await this.scopedPrescription(req, res, id);
    if (!prescription) return;
    await this.medical.saveDoseTimes(prescription.patientId, safeDoseTimes(body));
    const startDate = safeDate(body.start) || todayInVietnam();
    const startSlot = safeStartSlot(body.slot);
    return res.redirect(`/medical/prescriptions/${prescription.id}/lich?start=${startDate}&slot=${startSlot}`);
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
    // Chưa chốt lịch thì chưa cho nạp: chốt xong lịch mới cố định, nạp trước rồi đổi
    // ngày/giờ sau là sinh ra một mớ sự kiện lệch nhau trong Lịch iPhone.
    if (!prescription.scheduleStart) return notFound(res, 'Bạn phải bấm vào nút chốt lịch này trước');
    const prescriptionId = prescription.id;
    const confirmedStart = prescription.scheduleStart.toISOString().slice(0, 10);
    const startDate = safeDate(start) || confirmedStart || todayInVietnam();
    const startSlot = safeStartSlot(slot || prescription.scheduleSlot);
    const built = buildSchedule(toScheduleItems(prescription.items), startDate, startSlot, doseTimesOf(prescription.patient));
    const groups = full === '1' ? built.groups : remainingFrom(built.groups, todayInVietnam(), '00:00');
    if (!groups.length) return notFound(res, 'Không còn cữ thuốc nào cần nhắc');
    // Nhãn "thuốc mới / thuốc từ đơn nào" phải có trong CHÍNH sự kiện lịch, không chỉ trên
    // web: lúc sắp cho bé uống thì người ta nhìn thông báo điện thoại chứ không mở web.
    const carriedIds = prescription.items.map((item) => item.carriedFromId).filter((v): v is bigint => Boolean(v));
    const carrySources = await this.medical.carrySourceDates(carriedIds);
    const drugSources = new Map<string, string>();
    for (const item of prescription.items) {
      if (!item.carriedFromId) continue;
      const date = carrySources.get(item.carriedFromId.toString());
      drugSources.set(item.id.toString(), date ? date.split('-').reverse().slice(0, 2).join('/') : '');
    }
    const ics = buildIcs(groups, {
      // Không có thuốc chuyển sang thì bỏ trống: đơn thuần một đợt mà dán [MOI] lên mọi
      // dòng chỉ tổ làm dài thêm phần mô tả vốn đã hay bị cắt ngắn.
      drugSources: drugSources.size ? drugSources : undefined,
      // SEQUENCE theo số phút kể từ 2020: luôn tăng, không cần lưu thêm cột nào. Giữ cho
      // đúng chuẩn thôi — iPhone không dùng tới nó khi import file (xem chú thích ics.ts).
      sequence: Math.floor((Date.now() - Date.UTC(2020, 0, 1)) / 60000),
      calendarName: `Thuốc của ${prescription.patient.name}`,
      patientName: prescription.patient.name,
      uidPrefix: `rx${prescriptionId}`,
      prescriptionLabel: prescription.prescribedDate
        ? prescription.prescribedDate.toISOString().slice(0, 10).split('-').reverse().join('/')
        : '',
      followUpDate: prescription.followUpDate ? prescription.followUpDate.toISOString().slice(0, 10) : '',
      followUpTime: doseTimesOf(prescription.patient).morning,
      followUpNote: [prescription.clinic, prescription.doctor].filter(Boolean).join(' - ') || 'Tái khám theo hẹn của bác sĩ.',
    });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    // inline chứ không attachment: iOS Safari mở thẳng màn hình "Add All" của Lịch,
    // còn attachment thì tải vào Files rồi người dùng phải tự mở thêm một bước nữa.
    res.setHeader('Content-Disposition', `inline; filename="lich-uong-thuoc-${prescriptionId}.ics"`);
    return res.send(ics);
  }

  /**
   * Chi tiết MỘT đơn thuốc.
   *
   * Tách khỏi trang người thân vì nhà đã có nhiều đơn: đổ hết mọi đơn kèm form sửa từng
   * thuốc ra một trang thì phải cuộn cả chục màn hình mới tới đơn cần xem, và dễ sửa nhầm
   * sang đơn khác. Trang người thân giờ chỉ liệt kê, bấm vào đơn nào mới mở đơn đó.
   */
  @Get('/medical/prescriptions/:id')
  async prescription(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const prescription = await this.scopedPrescription(req, res, id);
    if (!prescription) return;
    const carriedIds = prescription.items.map((item) => item.carriedFromId).filter((v): v is bigint => Boolean(v));
    // Còn đơn khác đang chạy thì phải mở được màn hình "thuốc nào uống tiếp". Trước đây
    // màn hình đó chỉ tới được bằng cú chuyển hướng ngay sau khi upload ảnh đơn: lỡ bỏ
    // qua một lần là không có đường quay lại, mà đó đúng là lúc dễ bỏ qua nhất.
    const otherRunning = await this.medical.otherScheduled(prescription.patientId, prescription.id);
    return render(res, 'medical/prescription', {
      prescription,
      otherRunningCount: otherRunning.length,
      patient: prescription.patient,
      menuPatientId: prescription.patientId.toString(),
      menuPrescriptionId: prescription.id.toString(),
      // Ngày kê của đơn gốc, để đánh dấu thuốc nào là hàng chuyển sang từ đợt trước.
      carrySources: await this.medical.carrySourceDates(carriedIds),
      cabinetMatches: await this.cabinet.matchFor(
        currentUser(req),
        prescription.items.map((item) => item.drugName),
      ),
      aiConfigured: this.ai.isConfigured(),
    });
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

/**
 * Số thuốc còn thừa của các thuốc bị ngừng: lấy số lượng được cấp trừ số liều đã lên
 * lịch tới hôm nay. Cữ của đúng hôm nay tính là đã uống cho an toàn — thà báo tồn ít
 * hơn thực tế còn hơn báo thừa rồi không mua đủ.
 */
function leftoversFor(
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
function doseProgress(
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
function carryOverFor(
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
 * Form gửi lên dạng enabled_<id>=on, times_<id>=2, days_<id>=5, prn_<id>=on.
 * Checkbox không tick thì trình duyệt KHÔNG gửi field -> vắng mặt nghĩa là bỏ thuốc đó.
 */
function parseDecisions(body: Record<string, unknown>, items: ItemRow[]): ItemDecision[] {
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
      asNeeded: Boolean(item.asNeeded),
      quantityCount: Number(item.quantityCount || 0),
      quantity: String(item.quantity || ''),
      daysFromQuantity: Boolean(item.daysFromQuantity),
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
