import { Controller, Get, Param, Post, Body, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { notFound } from '../common/controller-utils';
import { FeatureAccess } from '../common/feature.decorator';
import { render } from '../common/view';
import { drugNamesCollide } from './cabinet';
import { buildIcs } from './ics';
import { doseTimesOf, safeDate, todayInVietnam, toScheduleItems } from './medical-controller-utils';
import { MedicalScopeService } from './medical-scope.service';
import { MedicalService } from './medical.service';
import { START_SLOT_LABELS, buildSchedule, remainingFrom, safeDoseTimes, safeStartSlot } from './medication-schedule';

/** Bước cuối của luồng y tế: xem lịch uống, chốt lịch, xuất .ics nạp vào Lịch iPhone. */
@Controller()
@FeatureAccess('MEDICAL')
export class MedicalScheduleController {
  constructor(
    private readonly medical: MedicalService,
    private readonly scope: MedicalScopeService,
  ) {}

  /** Màn hình tổng quan lịch uống thuốc trước khi tải về iPhone. */
  @Get('/medical/prescriptions/:id/lich')
  async schedule(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Query('start') start?: string, @Query('slot') slot?: string) {
    const prescription = await this.scope.prescription(req, res, id);
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
    const drugSources = await this.carriedDrugSources(prescription);
    // `overlaps` ở trên là để CẢNH BÁO trùng giờ nên lấy mọi đơn đang chạy, kể cả đơn mới
    // hơn. Còn nút "chọn thuốc uống tiếp" là thao tác GHI nên phải theo luật chặt hơn —
    // không thì đơn đã dừng cũng hiện nút, bấm vào là giết đơn đang chạy.
    const canTransition = (await this.medical.transitionSources(prescription)).length > 0;
    return render(res, 'medical/schedule', {
      drugSources,
      duplicateDrugs: duplicateDrugNames(prescription.items),
      canTransition,
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
    const prescription = await this.scope.prescription(req, res, id);
    if (!prescription) return;
    await this.medical.saveDoseTimes(prescription.patientId, safeDoseTimes(body));
    const startDate = safeDate(body.start) || todayInVietnam();
    const startSlot = safeStartSlot(body.slot);
    return res.redirect(`/medical/prescriptions/${prescription.id}/lich?start=${startDate}&slot=${startSlot}`);
  }

  /** Chốt lịch để máy khác lấy về đúng phần liệu trình còn lại. */
  @Post('/medical/prescriptions/:id/lich/chot')
  async confirmSchedule(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const prescription = await this.scope.prescription(req, res, id);
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
    const prescription = await this.scope.prescription(req, res, id);
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
    const drugSources = await this.carriedDrugSources(prescription);
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
   * Nhãn nguồn khoá theo ID THUỐC, không phải tên: sau khi chuyển đơn, cùng một thuốc có
   * thể vừa được kê mới vừa được chuyển sang, thành hai dòng trùng tên. Khoá theo tên là
   * dán nhầm nhãn cho cả hai.
   */
  private async carriedDrugSources(prescription: { items: Array<{ id: bigint; carriedFromId: bigint | null }> }) {
    const carriedIds = prescription.items.map((item) => item.carriedFromId).filter((v): v is bigint => Boolean(v));
    const carrySources = await this.medical.carrySourceDates(carriedIds);
    const drugSources = new Map<string, string>();
    for (const item of prescription.items) {
      if (!item.carriedFromId) continue;
      const date = carrySources.get(item.carriedFromId.toString());
      drugSources.set(item.id.toString(), date ? date.split('-').reverse().slice(0, 2).join('/') : '');
    }
    return drugSources;
  }
}

/**
 * Cùng một thuốc nằm hai dòng trong đơn (thường do chuyển đơn mà bác sĩ cũng kê lại) thì
 * lịch sinh ra HAI cữ cùng giờ -> uống gấp đôi liều. Phải chặn bằng cảnh báo, đây là loại
 * lỗi không được để người dùng tự phát hiện.
 *
 * Bắt trùng bằng drugNamesCollide (tách từ + tập con): sau khi chuyển đơn, dòng chuyển
 * sang giữ tên đơn cũ còn dòng mới mang tên AI đọc lại, lệch một chữ thừa ("hoạt chất",
 * "(Hapacol)") là tên thô coi như khác nhau và bỏ sót cữ trùng. So từng cặp vì quan hệ
 * "tập con" không bắc cầu.
 */
function duplicateDrugNames(items: Array<{ enabled: boolean; drugName: string }>): string[] {
  const enabled = items.filter((item) => item.enabled);
  const names = new Set<string>();
  for (let a = 0; a < enabled.length; a++) {
    for (let b = a + 1; b < enabled.length; b++) {
      if (drugNamesCollide(enabled[a].drugName, enabled[b].drugName)) {
        names.add(enabled[a].drugName);
        names.add(enabled[b].drugName);
      }
    }
  }
  return [...names];
}
